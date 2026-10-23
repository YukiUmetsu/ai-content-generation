import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "@/App";

describe("Studio shell", () => {
  it("opens directly into a focused create workspace with a real preview and a tool guide", async () => {
    render(<App />);

    expect(screen.getByRole("link", { name: /skip to workspace/i })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: /main navigation/i })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: /studio tools/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/how to use this tool/i)).toBeInTheDocument();

    expect(screen.queryByRole("navigation", { name: /breadcrumb/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("searchbox", { name: /find tools/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/nothing to preview yet/i)).not.toBeInTheDocument();
    expect(screen.getByText("Updates as you edit")).toBeInTheDocument();
    expect(screen.getByTestId("video-opening")).toBeInTheDocument();
    expect(screen.getByTestId("metric-reveal")).toBeInTheDocument();
    expect(screen.getByTestId("thumbnail-preview")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: /view settings/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /switch to (light|dark) mode/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /shortcuts/i })).toBeInTheDocument();
    expect(screen.queryByText("ContentGen")).not.toBeInTheDocument();
    expect(screen.queryByText("Untitled project")).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: /view settings/i }));
    const settingsDialog = within(screen.getByRole("dialog"));
    expect(settingsDialog.getByText("Density")).toBeInTheDocument();
    expect(settingsDialog.getByText("Language")).toBeInTheDocument();
  });

  it("lets the tool guide close and reopen from its own header and the preview toolbar", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /close tool guide/i }));
    expect(screen.getByRole("button", { name: /show tool guide/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /show tool guide/i }));
    expect(screen.getByRole("button", { name: /close tool guide/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /hide tool guide/i }));
    expect(screen.getByRole("button", { name: /show tool guide/i })).toBeInTheDocument();
  });

  it("updates the shared preview when a brand palette color changes", async () => {
    const user = userEvent.setup();
    render(<App />);

    const canvasInput = screen.getAllByLabelText(/hex$/i)[0];
    await user.clear(canvasInput);
    await user.type(canvasInput, "#FF5733");

    await waitFor(() => {
      expect(screen.getByTestId("video-opening").style.getPropertyValue("--ba-canvas")).toBe("#FF5733");
    });
  });

  it("opens the now-live platform planner with per-platform preview and Kumiki safe-area checks", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: /platform layouts/i }));
    expect(screen.queryByText(/The editor isn't connected yet/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button",{name:/Export layout plan JSON/i})).toBeInTheDocument();
    expect(screen.getByRole("combobox",{name:/Platform/i})).toBeInTheDocument();
    await waitFor(()=>expect(screen.getByTestId("platform-layout-frame")).toHaveAttribute("data-profile","youtube-shorts"));
    await user.selectOptions(screen.getByRole("combobox",{name:/Platform/i}),"youtube");
    await waitFor(()=>expect(screen.getByTestId("platform-layout-frame")).toHaveAttribute("data-profile","youtube"));
    expect(within(screen.getByLabelText(/how to use this tool/i)).getByText("Live preview")).toBeInTheDocument();
  });
});
