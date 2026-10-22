import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "@/App";

describe("Studio shell", () => {
  it("renders a compact shell and keeps view settings accessible", async () => {
    render(<App />);

    expect(screen.getByRole("link", { name: /skip to workspace/i })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: /main navigation/i })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: /studio tools/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/properties/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /view settings/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /switch to (light|dark) mode/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /shortcuts/i })).toBeInTheDocument();
    expect(screen.queryByText("ContentGen")).not.toBeInTheDocument();
    expect(screen.queryByText("Untitled project")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Light" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Compact" })).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: /view settings/i }));
    const settingsDialog = within(screen.getByRole("dialog"));
    expect(settingsDialog.getByText("Density")).toBeInTheDocument();
    expect(settingsDialog.getByText("Language")).toBeInTheDocument();
  });
});
