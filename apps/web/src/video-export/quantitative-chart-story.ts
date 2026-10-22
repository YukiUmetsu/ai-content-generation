import type { QuantitativeChart, GeneralVisualPlan } from "../../scripts/video-production/general-visual-plan.mjs";
import type { ChartStorySpec } from "@/components/infographic/chart-story";

type SourceSnapshot = GeneralVisualPlan["evidence"][number];

interface QuantitativeChartStoryInput {
  chart: QuantitativeChart;
  beatId: string;
  title: string;
  durationFrames: number;
  fps: { num: number; den: number };
  locale: "en-US" | "ja-JP";
  evidence: readonly SourceSnapshot[];
}

interface QuantitativeChartStory {
  spec: ChartStorySpec;
  provenanceBasis: "measured" | "illustrative";
  disclosure: string;
  sourceText: string;
}

/** ContentGen owns the provenance contract; Kumiki owns the chart marks and motion. */
export function buildQuantitativeChartStory({ chart, beatId, title, durationFrames, fps, locale, evidence }: QuantitativeChartStoryInput): QuantitativeChartStory {
  if (chart.kind !== "quantitative-chart-v1" || !Number.isSafeInteger(durationFrames) || durationFrames < 2) {
    throw new Error("A quantitative chart requires its validated data and at least two video frames");
  }
  const provenance = chart.provenance;
  let sourceText: string;
  let sourceNote: string;
  if (provenance.basis === "measured") {
    const byId = new Map(evidence.map((item) => [item.id, item]));
    const missing = provenance.evidenceRefs.filter((id) => !byId.has(id));
    if (!provenance.evidenceRefs.length || missing.length) {
      throw new Error(`Measured chart source snapshot missing: ${missing.join(", ") || "no source references"}`);
    }
    sourceText = provenance.evidenceRefs.map((id) => {
      const entry = byId.get(id)!;
      return `${id}: ${entry.title} (${entry.passageLocator})`;
    }).join(" · ");
    sourceNote = `Measured · Source refs: ${provenance.evidenceRefs.join(", ")}`;
  } else {
    sourceText = `Illustrative assumptions: ${provenance.assumptions.join("; ")}`;
    sourceNote = "Illustrative inputs — not observations";
  }

  const setupFrames = Math.max(1, Math.min(24, Math.floor(durationFrames * 0.2)));
  const revealFrames = durationFrames - setupFrames;
  const scenarioId = `observed-${beatId}`;
  const spec: ChartStorySpec = {
    id: `contentgen-chart-${beatId.replace(/[^\p{L}\p{N}_-]/gu, "-")}`,
    fps: { ...fps },
    title,
    language: locale === "ja-JP" ? "ja" : "en",
    scenarios: [{ id: scenarioId, label: provenance.basis === "measured" ? "Measured values" : "Illustrative values", spec: {
      recipe: "bar", categories: [...chart.categories], series: chart.series.map((series) => ({ ...series, values: [...series.values] })),
      unit: chart.unit, missingPolicy: "gap", scale: { kind: "linear", zero: true }, sourceNote,
    } }],
    initialScenarioId: scenarioId,
    moveFrames: Math.min(24, Math.max(1, revealFrames)),
    beats: [
      { id: `${beatId}-establish`, kind: "establish", durationFrames: setupFrames },
      { id: `${beatId}-reveal`, kind: "reveal", seriesIds: chart.series.map((series) => series.id), durationFrames: revealFrames },
    ],
  };
  return { spec, provenanceBasis: provenance.basis, disclosure: provenance.disclosure, sourceText };
}
