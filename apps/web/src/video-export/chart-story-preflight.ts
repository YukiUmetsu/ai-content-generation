/** Browser-export guard: a chart is an actual rendered scene, never a silent empty overlay. */
export async function waitForChartStoryReadiness(stage: HTMLElement, timeoutMs = 5000): Promise<void> {
  const container = stage.querySelector<HTMLElement>("[data-general-chart-container]");
  if (!container) return;
  const deadline = performance.now() + timeoutMs;
  while (true) {
    const chart = container.querySelector<HTMLElement>("[data-km-chart-story]");
    if (!chart) throw new Error("Chart renderer is missing from the expected video scene");
    const status = chart.dataset.chartStoryStatus;
    if (status === "ready") return;
    if (status === "error") throw new Error("Chart renderer reported a layout or data diagnostic error; refusing capture");
    if (status !== "pending") throw new Error(`Unknown chart renderer status: ${status ?? "missing"}`);
    if (performance.now() >= deadline) throw new Error("Chart font/render readiness still pending after timeout");
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}
