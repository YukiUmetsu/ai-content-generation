import { describe, expect, it } from "vitest";
import { waitForChartStoryReadiness } from "./chart-story-preflight";

function stageWithChart(status?: string) {
  const stage = document.createElement("div");
  const container = document.createElement("div");
  container.dataset.generalChartContainer = "";
  if (status) {
    const chart = document.createElement("div");
    chart.dataset.kmChartStory = "";
    chart.dataset.chartStoryStatus = status;
    container.appendChild(chart);
  }
  stage.appendChild(container);
  return stage;
}

describe("chart frame readiness", () => {
  it("allows a ready chart and a non-chart scene", async () => {
    await expect(waitForChartStoryReadiness(stageWithChart("ready"), 1)).resolves.toBeUndefined();
    await expect(waitForChartStoryReadiness(document.createElement("div"), 1)).resolves.toBeUndefined();
  });

  it("fails on a chart renderer diagnostic error rather than capturing its defective frame", async () => {
    await expect(waitForChartStoryReadiness(stageWithChart("error"), 1)).rejects.toThrow(/chart.*diagnostic|chart.*error/i);
  });

  it("fails on a missing expected chart instead of silently rendering the background", async () => {
    await expect(waitForChartStoryReadiness(stageWithChart(), 1)).rejects.toThrow(/missing.*chart|chart.*missing/i);
  });

  it("fails a chart still pending past the bounded font/render readiness deadline", async () => {
    await expect(waitForChartStoryReadiness(stageWithChart("pending"), 1)).rejects.toThrow(/pending|timeout/i);
  });
});
