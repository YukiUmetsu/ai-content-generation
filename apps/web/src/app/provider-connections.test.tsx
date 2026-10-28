import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProviderConnections } from "./provider-connections";
import { deleteProviderKey, loadProviderConnections, saveProviderKey } from "@/lib/api/provider-credentials";

vi.mock("@/lib/api/provider-credentials", () => ({
  loadProviderConnections: vi.fn(),
  saveProviderKey: vi.fn(),
  deleteProviderKey: vi.fn(),
}));

const missing = { id: "youtube" as const, configured: false, source: "missing" as const };
const keychain = { id: "youtube" as const, configured: true, source: "keychain" as const };
const fish = {id:"fish" as const,configured:false,source:"missing" as const};

beforeEach(() => {
  // Resetting every mock also clears the test environment's matchMedia shim,
  // which makes motion-enabled Buttons fail during React's next render.
  vi.clearAllMocks();
  vi.mocked(loadProviderConnections).mockResolvedValue([missing,fish]);
  vi.mocked(saveProviderKey).mockResolvedValue(keychain);
  vi.mocked(deleteProviderKey).mockResolvedValue(undefined);
});

describe("ProviderConnections", () => {
  it("shows local Keychain state, a password-only key field, and no readback", async () => {
    vi.mocked(loadProviderConnections).mockResolvedValue([keychain,fish]);
    render(<ProviderConnections locale="en" />);
    expect(await screen.findByText(/Saved in macOS Keychain/i)).toBeInTheDocument();
    const field = screen.getByLabelText(/YouTube Data API key/i);
    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveValue("");
    expect(screen.getAllByText(/never displayed again/i)).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Remove saved key/i })).toBeInTheDocument();
  });

  it("saves through the secure API, clears the field, and refreshes status", async () => {
    vi.mocked(loadProviderConnections).mockResolvedValueOnce([missing,fish]).mockResolvedValueOnce([keychain,fish]);
    const user = userEvent.setup();
    render(<ProviderConnections locale="en" />);
    await screen.findAllByText(/Not configured/i);
    const field = screen.getByLabelText(/YouTube Data API key/i);
    await user.type(field, "youtube-private-key");
    await user.click(screen.getAllByRole("button", { name: /Save to Keychain/i })[0]);
    await waitFor(() => expect(saveProviderKey).toHaveBeenCalledWith("youtube","youtube-private-key"));
    await waitFor(() => expect(field).toHaveValue(""));
    expect(await screen.findByText(/Saved in macOS Keychain/i)).toBeInTheDocument();
    expect(screen.queryByText("youtube-private-key")).not.toBeInTheDocument();
  });

  it("requires confirmation to delete and reflects fallback environment status", async () => {
    vi.mocked(loadProviderConnections).mockResolvedValueOnce([keychain,fish]).mockResolvedValueOnce([
      { id: "youtube", configured: true, source: "environment" },fish,
    ]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const user = userEvent.setup();
    render(<ProviderConnections locale="en" />);
    await screen.findByText(/Saved in macOS Keychain/i);
    await user.click(screen.getByRole("button", { name: /Remove saved key/i }));
    expect(deleteProviderKey).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Remove saved key/i }));
    await waitFor(() => expect(deleteProviderKey).toHaveBeenCalledWith("youtube"));
    await waitFor(() => expect(screen.getAllByRole("status")[0]).toHaveTextContent("Environment variable in use"));
    expect(confirm).toHaveBeenCalledTimes(2);
    confirm.mockRestore();
  });

  it("shows unavailable storage and Japanese help without leaking errors", async () => {
    vi.mocked(loadProviderConnections).mockResolvedValue([
      { id: "youtube", configured: false, source: "unavailable" },fish,
    ]);
    render(<ProviderConnections locale="ja" />);
    expect(await screen.findByText(/キーチェーンを利用できません/)).toBeInTheDocument();
    expect(screen.getByLabelText(/YouTube Data API キー/)).toHaveAttribute("type", "password");
    expect(screen.getAllByRole("button", { name: /キーチェーンに保存/ })[0]).toBeDisabled();
  });

  it("saves Fish Audio independently without retaining the secret or exposing Pexels API keys", async () => {
    const user=userEvent.setup();
    vi.mocked(loadProviderConnections).mockResolvedValueOnce([missing,fish])
      .mockResolvedValue([missing,{...fish,configured:true,source:"keychain"}]);
    render(<ProviderConnections locale="en" />);
    await screen.findAllByText("Not configured");
    const fishInput=screen.getByLabelText(/Fish Audio API key/i);
    await user.type(fishInput,"fish-private-secret");
    await user.click(screen.getAllByRole("button",{name:"Save to Keychain"})[1]);
    await waitFor(()=>expect(saveProviderKey).toHaveBeenCalledWith("fish","fish-private-secret"));
    expect(fishInput).toHaveValue("");
    expect(screen.queryByLabelText(/Pexels API key/i)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("private-secret");
  });
});
