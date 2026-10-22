import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { GeneralVisualPlan } from "../../scripts/video-production/general-visual-plan.mjs";
import { GeneralExportScene } from "./general-scene";

const plan: GeneralVisualPlan = {
  schemaVersion: 1, kind: "general-explainer-visual-plan", title: "The invisible network",
  manifest: { schemaVersion: 1, id: "test", durationFrames: 180, width: 1920, height: 1080, fps: { num: 30, den: 1 }, preset: "youtube" },
  chapters: [
    { id: "question", intent: "general-intro", visual: { headline: "WHAT HAPPENS TO A MESSAGE?", subhead: "An illustrative model", emphasis: "QUESTION", items: ["Phone", "Router", "Destination"] }, startFrame: 0, endFrame: 60, claimRefs: [], evidenceRefs: [], eventIds: [] },
    { id: "path", intent: "general-flow", visual: { headline: "A PACKET MOVES", subhead: "Across the network", emphasis: "PROCESS", items: ["Phone", "Router", "Network", "Receiver"] }, startFrame: 60, endFrame: 120, claimRefs: [], evidenceRefs: [], eventIds: [] },
    { id: "answer", intent: "general-payoff", visual: { headline: "DELIVERED, NOT MAGIC", subhead: "A useful mental model", emphasis: "ANSWER", items: ["Send", "Route", "Deliver"] }, startFrame: 120, endFrame: 180, claimRefs: [], evidenceRefs: [], eventIds: ["message-arrives"] },
  ],
  claims: [], evidence: [], events: { "message-arrives": 120 }, payoffEventId: "message-arrives", commercialReady: false,
  disclaimer: "UNVERIFIED EDITORIAL DRAFT · REVIEW CLAIMS AND RIGHTS",
};

describe("generic deterministic explainer scene", () => {
  it("renders meaningful visual labels and accessible 16:9 SVG", () => {
    const svg = renderToStaticMarkup(<GeneralExportScene plan={plan} frame={94} />);
    expect(svg).toContain('viewBox="0 0 1920 1080"');
    expect(svg).toContain("A PACKET MOVES");
    expect(svg).toContain("Router");
    expect(svg).toContain("UNVERIFIED EDITORIAL DRAFT");
  });

  it("uses Kumiki's process journey to move exactly one semantic subject through flow stages", () => {
    const start = renderToStaticMarkup(<GeneralExportScene plan={plan} frame={65} />);
    const middle = renderToStaticMarkup(<GeneralExportScene plan={plan} frame={94} />);
    expect(start).toContain("data-km-diagram-stage");
    expect(middle).toContain("data-diagram-node=\"step-2\"");
    expect(middle).toContain("data-process-journey-subject=\"topic-flow\"");
    expect(middle.match(/data-process-journey-subject=/g)).toHaveLength(1);
    expect(middle).toContain('data-diagram-overlaps="0"');
    expect(start).not.toEqual(middle);
    expect(middle).not.toContain("<foreignObject");
  });

  it("has no DOM payoff content until after its event, then reveals named nodes", () => {
    const at = renderToStaticMarkup(<GeneralExportScene plan={plan} frame={120} />);
    const after = renderToStaticMarkup(<GeneralExportScene plan={plan} frame={155} />);
    expect(at).not.toContain("DELIVERED, NOT MAGIC");
    expect(at).not.toContain(">Deliver</text>");
    expect(after).toContain("DELIVERED, NOT MAGIC");
    expect(after).toContain("Deliver");
  });

  it("fits three comparison cards entirely within the right-hand canvas", () => {
    const comparison: GeneralVisualPlan = { ...plan, chapters: plan.chapters.map((chapter) => chapter.id === "path"
      ? { ...chapter, intent: "general-comparison", visual: { ...chapter.visual, items: ["Option A", "Option B", "Option C"] } }
      : chapter) };
    const svg = renderToStaticMarkup(<GeneralExportScene plan={comparison} frame={119} />);
    const cards = [...svg.matchAll(/<rect x="([\d.]+)" y="470" width="([\d.]+)"/g)];
    expect(cards).toHaveLength(3);
    for (const card of cards) expect(Number(card[1]) + Number(card[2])).toBeLessThanOrEqual(1800);
  });

  it("shows qualitative breakdowns as equal-sized categories, never invented quantitative bars", () => {
    const breakdown: GeneralVisualPlan = { ...plan, chapters: plan.chapters.map((chapter) => chapter.id === "path"
      ? { ...chapter, intent: "general-breakdown", visual: { ...chapter.visual, items: ["Labor", "Materials", "Permits", "Equipment"] } }
      : chapter) };
    const svg = renderToStaticMarkup(<GeneralExportScene plan={breakdown} frame={119} />);
    expect(svg).toContain('data-general-breakdown="qualitative"');
    expect(svg).toContain("QUALITATIVE · NOT TO SCALE");
    expect(svg.match(/data-general-node=/g)).toHaveLength(4);
    expect(svg.match(/width="680" height="94"/g)).toHaveLength(4);
    expect(svg).not.toContain('height="23"');
  });

  it("draws a measured chart with visible source title, locator and exact disclosure instead of an unrelated diagram", () => {
    const chartPlan: GeneralVisualPlan = {
      ...plan,
      evidence: [{ id: "source-1", title: "Budget report", sourceUri: "https://example.org/report",
        retrievedAt: "2026-10-22T00:00:00.000Z", passageLocator: "Table 4", snapshotSha256: "a".repeat(64) }],
      chapters: plan.chapters.map((chapter) => chapter.id === "path" ? { ...chapter, visual: {
        ...chapter.visual,
        chart: { kind: "quantitative-chart-v1", categories: ["A", "B"], unit: "USD",
          series: [{ id: "cost", label: "Annual cost", values: [10, 15] }],
          provenance: { basis: "measured", disclosure: "Measured values; editorial review still required.", claimRefs: ["claim-a"], evidenceRefs: ["source-1"] },
        },
      } } : chapter),
    };
    const rendered = renderToStaticMarkup(<GeneralExportScene plan={chartPlan} frame={75} />);
    expect(rendered).toContain('data-km-chart-story=""');
    expect(rendered).toContain('data-chart-provenance-basis="measured"');
    expect(rendered).toContain("Measured values; editorial review still required.");
    expect(rendered).toContain("Budget report");
    expect(rendered).toContain("Table 4");
    expect(rendered).toContain('data-chart-story-status="ready"');
    expect(rendered).not.toContain('data-general-node=');
  });
});
