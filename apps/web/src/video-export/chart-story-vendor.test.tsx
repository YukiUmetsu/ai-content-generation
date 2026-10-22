import { render, screen } from "@testing-library/react";
import { ChartStoryView } from "../components/infographic/chart-story-react";
import { checkChartClaim, evaluateChartStory, validateChartStory } from "../components/infographic/chart-story";
import type { ChartStorySpec } from "../components/infographic/chart-story";

// Synthetic numbers exercise the pinned registry API; no real-world claim is implied.
const example: ChartStorySpec = {
  id: "vendor-smoke",
  fps: { num: 30, den: 1 },
  title: "Illustrative quantities",
  initialScenarioId: "baseline",
  scenarios: [{
    id: "baseline",
    label: "Illustrative example",
    spec: {
      recipe: "bar",
      categories: ["A", "B"],
      scale: { kind: "linear", zero: true },
      series: [{ id: "quantity", label: "Sample quantity", values: [10, 20] }],
    },
  }],
  beats: [
    { id: "establish", kind: "establish", durationFrames: 30 },
    { id: "reveal", kind: "reveal", seriesIds: ["quantity"], durationFrames: 30 },
    { id: "conclude", kind: "conclude", durationFrames: 40, claim: {
      text: "B is 20 in this synthetic example",
      support: { kind: "value", seriesId: "quantity", index: 1, value: 20 },
    } },
  ],
};

describe("pinned Kumiki ChartStory consumer smoke", () => {
  it("exports a frame-addressable scene and rejects unsupported conclusions", () => {
    expect(validateChartStory(example).filter(item => item.severity === "error")).toEqual([]);
    expect(evaluateChartStory(example, 65).beat.id).toBe("conclude");
    expect(checkChartClaim(example, {
      text: "An unsupported number",
      support: { kind: "value", seriesId: "quantity", index: 1, value: 99 },
    }).ok).toBe(false);

    render(<ChartStoryView spec={example} frame={65} width={1280} height={720} />);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", expect.stringContaining("Illustrative quantities"));
    const stage = document.querySelector("[data-km-chart-story]");
    expect(stage).toHaveAttribute("data-chart-story-beat", "conclude");
    expect(stage).toHaveAttribute("data-chart-story-status", "ready");
  });
});
