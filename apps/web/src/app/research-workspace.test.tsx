import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResearchWorkspace } from "./research-workspace";

vi.mock("./related-youtube-panel", () => ({ RelatedYoutubePanel: () => <p>Video lookup</p> }));

describe("Research workspace navigation", () => {
  beforeEach(() => localStorage.clear());
  it("keeps research topics separate from saved-evidence queries", async () => {
    const user = userEvent.setup();
    render(<ResearchWorkspace locale="en" onUseVideo={() => true} onCreateStoryboard={() => true} />);

    const tabs = screen.getByRole("tablist", { name: "Research sections" });
    expect(tabs.querySelectorAll('[role="tab"]')).toHaveLength(4);
    expect(screen.getByRole("tab", { name: "Research" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("YouTube inspiration (optional)")).toBeInTheDocument();
    expect(screen.queryByText("Video lookup")).not.toBeInTheDocument();
    await user.click(screen.getByText("YouTube inspiration (optional)"));
    expect(await screen.findByText("Video lookup")).toBeInTheDocument();
    await user.click(screen.getByText("YouTube inspiration (optional)"));
    await waitFor(() => expect(screen.queryByText("Video lookup")).not.toBeInTheDocument());

    await user.type(screen.getByRole("textbox", { name: "Research topic" }), "heat pump cost");
    await user.click(screen.getByRole("tab", { name: "Evidence Library" }));
    expect(screen.getByRole("textbox", { name: "Search stored evidence" })).toHaveValue("");
    await user.type(screen.getByRole("textbox", { name: "Search stored evidence" }), "home insurance");
    await user.click(screen.getByRole("tab", { name: "Research" }));

    expect(screen.getByRole("textbox", { name: "Research topic" })).toHaveValue("heat pump cost");
    await user.click(screen.getByRole("tab", { name: "Evidence Library" }));
    expect(screen.getByRole("textbox", { name: "Search stored evidence" })).toHaveValue("home insurance");
    expect(screen.getByRole("tab", { name: "Packaging" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "YouTube Intelligence" })).toBeInTheDocument();
  });
});
