import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { GeneralVisualPlan } from "../../scripts/video-production/general-visual-plan.mjs";
import { GeneralExportScene } from "./general-scene";

const plan: GeneralVisualPlan = {
  schemaVersion: 1, kind: "general-explainer-visual-plan", title: "The invisible network",
  manifest: { schemaVersion: 1, id: "test", durationFrames: 180, width: 1920, height: 1080, fps: { num: 30, den: 1 }, preset: "youtube" },
  chapters: [
    { id: "question", intent: "general-intro", visual: { headline: "WHAT HAPPENS TO A MESSAGE?", subhead: "An illustrative model", emphasis: "QUESTION", items: ["Phone", "Router", "Destination"] }, startFrame: 0, endFrame: 60, claimRefs: [], eventIds: [] },
    { id: "path", intent: "general-flow", visual: { headline: "A PACKET MOVES", subhead: "Across the network", emphasis: "PROCESS", items: ["Phone", "Router", "Network", "Receiver"] }, startFrame: 60, endFrame: 120, claimRefs: [], eventIds: [] },
    { id: "answer", intent: "general-payoff", visual: { headline: "DELIVERED, NOT MAGIC", subhead: "A useful mental model", emphasis: "ANSWER", items: ["Send", "Route", "Deliver"] }, startFrame: 120, endFrame: 180, claimRefs: [], eventIds: ["message-arrives"] },
  ],
  events: { "message-arrives": 120 }, payoffEventId: "message-arrives", commercialReady: false,
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
});
