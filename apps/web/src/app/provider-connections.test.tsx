import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProviderConnections } from "./provider-connections";
import { deleteYoutubeKey, loadProviderConnections, saveYoutubeKey } from "@/lib/api/provider-credentials";

vi.mock("@/lib/api/provider-credentials", () => ({
  loadProviderConnections: vi.fn(),
  saveYoutubeKey: vi.fn(),
  deleteYoutubeKey: vi.fn(),
}));

const missing = { id: "youtube" as const, configured: false, source: "missing" as const };
const keychain = { id: "youtube" as const, configured: true, source: "keychain" as const };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadProviderConnections).mockResolvedValue([missing]);
  vi.mocked(saveYoutubeKey).mockResolvedValue(keychain);
  vi.mocked(deleteYoutubeKey).mockResolvedValue(undefined);
});

describe("ProviderConnections", () => {
  it("shows local Keychain state, a password-only key field, and no readback", async () => {
    vi.mocked(loadProviderConnections).mockResolvedValue([keychain]);
    render(<ProviderConnections locale="en" />);
    expect(await screen.findByText(/Saved in macOS Keychain/i)).toBeInTheDocument();
    const field = screen.getByLabelText(/YouTube Data API key/i);
    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveValue("");
    expect(screen.getByText(/never displayed again/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Remove saved key/i })).toBeInTheDocument();
  });

  it("saves through the secure API, clears the field, and refreshes status", async () => {
    vi.mocked(loadProviderConnections).mockResolvedValueOnce([missing]).mockResolvedValueOnce([keychain]);
    const user = userEvent.setup();
    render(<ProviderConnections locale="en" />);
    await screen.findByText(/Not configured/i);
    const field = screen.getByLabelText(/YouTube Data API key/i);
    await user.type(field, "youtube-private-key");
    await user.click(screen.getByRole("button", { name: /Save to Keychain/i }));
    await waitFor(() => expect(saveYoutubeKey).toHaveBeenCalledWith("youtube-private-key"));
    await waitFor(() => expect(field).toHaveValue(""));
    expect(await screen.findByText(/Saved in macOS Keychain/i)).toBeInTheDocument();
    expect(screen.queryByText("youtube-private-key")).not.toBeInTheDocument();
  });

  it("requires confirmation to delete and reflects fallback environment status", async () => {
    vi.mocked(loadProviderConnections).mockResolvedValueOnce([keychain]).mockResolvedValueOnce([
      { id: "youtube", configured: true, source: "environment" },
    ]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const user = userEvent.setup();
    render(<ProviderConnections locale="en" />);
    await screen.findByText(/Saved in macOS Keychain/i);
    await user.click(screen.getByRole("button", { name: /Remove saved key/i }));
    expect(deleteYoutubeKey).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Remove saved key/i }));
    await waitFor(() => expect(deleteYoutubeKey).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Environment variable in use"));
    expect(confirm).toHaveBeenCalledTimes(2);
    confirm.mockRestore();
  });

  it("shows unavailable storage and Japanese help without leaking errors", async () => {
    vi.mocked(loadProviderConnections).mockResolvedValue([
      { id: "youtube", configured: false, source: "unavailable" },
    ]);
    render(<ProviderConnections locale="ja" />);
    expect(await screen.findByText(/キーチェーンを利用できません/)).toBeInTheDocument();
    expect(screen.getByLabelText(/YouTube Data API キー/)).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: /キーチェーンに保存/ })).toBeDisabled();
  });
});
