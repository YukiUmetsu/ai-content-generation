import { describe, expect, it } from "vitest";
import { evaluateChartStory } from "@/components/infographic/chart-story";
import type { QuantitativeChart } from "../../scripts/video-production/general-visual-plan.mjs";
import { buildQuantitativeChartStory } from "./quantitative-chart-story";

const chart: QuantitativeChart = {
  kind: "quantitative-chart-v1",
  categories: ["Before", "After", "Unknown"],
  series: [{ id: "cost", label: "Annual cost", values: [12, 20, null] }],
  unit: "USD",
  provenance: { basis: "illustrative", disclosure: "Illustrative USD amounts based on synthetic inputs.", claimRefs: ["claim-cost"], assumptions: ["Before = 12", "After = 20"] },
};

const settings = { beatId: "beat-cost", title: "What changes?", durationFrames: 90, fps: { num: 30, den: 1 }, locale: "en-US" as const, evidence: [] };

describe("quantitative chart story adapter", () => {
  it("turns declared values into a zero-baseline Kumiki bar story with deterministic direct seeks", () => {
    const result = buildQuantitativeChartStory({ ...settings, chart });
    expect(result.spec.scenarios[0].spec).toMatchObject({
      recipe: "bar", categories: chart.categories, unit: "USD", missingPolicy: "gap", scale: { kind: "linear", zero: true },
      series: chart.series,
    });
    expect(result.spec.beats.map((beat) => beat.kind)).toEqual(["establish", "reveal"]);
    expect(result.spec.beats.reduce((n, beat) => n + beat.durationFrames, 0)).toBe(90);
    const first = evaluateChartStory(result.spec, 0);
    const last = evaluateChartStory(result.spec, 89);
    expect(first.seriesOpacity.cost).toBe(0);
    expect(last.seriesOpacity.cost).toBeCloseTo(1);
    expect(evaluateChartStory(result.spec, 47)).toEqual(evaluateChartStory(result.spec, 47));
    expect(result.disclosure).toContain("Illustrative");
    expect(result.sourceText).toContain("Before = 12");
  });

  it("preserves exact measured snapshot IDs, titles and passage locators without certifying review", () => {
    const measured: QuantitativeChart = { ...chart, provenance: {
      basis: "measured", disclosure: "Measured values; source review remains required.", claimRefs: ["claim-cost"], evidenceRefs: ["snapshot-7"],
    } };
    const result = buildQuantitativeChartStory({ ...settings, chart: measured, evidence: [{
      id: "snapshot-7", title: "Published record", sourceUri: "https://example.org/report", retrievedAt: "2026-10-22T00:00:00.000Z",
      passageLocator: "Table 2", snapshotSha256: "a".repeat(64),
    }] });
    expect(result.provenanceBasis).toBe("measured");
    expect(result.sourceText).toContain("snapshot-7");
    expect(result.sourceText).toContain("Published record");
    expect(result.sourceText).toContain("Table 2");
    expect(result.disclosure).toContain("review remains required");
    expect(result.spec.scenarios[0].spec.sourceNote).toContain("snapshot-7");
  });

  it("refuses a measured chart with unresolved source snapshots", () => {
    const measured: QuantitativeChart = { ...chart, provenance: {
      basis: "measured", disclosure: "Measured from source.", claimRefs: ["claim-cost"], evidenceRefs: ["missing"],
    } };
    expect(() => buildQuantitativeChartStory({ ...settings, chart: measured })).toThrow(/missing.*source|source.*missing/i);
  });

  it("refuses impossible single-frame chart chapters rather than returning a blank chart", () => {
    expect(() => buildQuantitativeChartStory({ ...settings, chart, durationFrames: 1 })).toThrow(/frames|short/i);
  });
});
