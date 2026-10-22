import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MotionMediaShowcase } from "./MotionMediaShowcase";

describe("MotionMediaShowcase", () => {
  it("compiles a deterministic motion direction and mounts the capture stage", () => {
    render(<MotionMediaShowcase locale="en" />);
    expect(screen.getByRole("heading", { name: "Motion & media lab" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Motion" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("slider", { name: "Animation frame" })).toBeInTheDocument();
    expect(screen.getByTestId("motion-director-status")).toHaveAttribute("data-status", "ready");
    expect(document.querySelector("[data-km-video-capture]")).toBeInTheDocument();
    expect(screen.getByText(/synthetic values/i)).toBeInTheDocument();
  });

  it("switches between infographic and still-export previews", async () => {
    const user = userEvent.setup();
    render(<MotionMediaShowcase locale="en" />);

    await user.click(screen.getByRole("tab", { name: "Media" }));
    expect(screen.getByRole("tree", { name: "Artboard layers" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Infographic" }));
    expect(screen.getByRole("img", { name: /Illustrative HVAC installed cost/i })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Still export" }));
    expect(screen.getByText("Small-format check")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download SVG/i })).toBeInTheDocument();
  });

  it("shows the Japanese interface and localized illustrative-data disclaimer", async () => {
    const user = userEvent.setup();
    render(<MotionMediaShowcase locale="ja" />);
    expect(screen.getByRole("heading", { name: "モーションとメディアのラボ" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "図解" }));
    expect(screen.getByText(/合計 \$12,400 は説明用の合成データ/)).toBeInTheDocument();
  });
});
