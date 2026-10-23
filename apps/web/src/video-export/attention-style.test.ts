import { describe, expect, it } from "vitest";
import type { GeneralVisualPlan } from "../../scripts/video-production/general-visual-plan.mjs";
import { compileChapterAttention, sampleChapterAttention } from "./attention-style";

const chapter = {
  id: "beat-01", intent: "general-intro", startFrame: 0, endFrame: 90,
  claimRefs: ["unverified-claim"], evidenceRefs: [], eventIds: [],
  visual: {
    headline: "Follow the heat", subhead: "The familiar assumption misses a step",
    emphasis: "LOOK CLOSER", items: ["Outdoor energy", "Heat pump"],
    hookStrategy: "unexpected-reveal", typographyStyle: "wipe",
  },
} as const;
const plan = {
  manifest: { fps: { num: 30, den: 1 } },
  payoffEventId: "topic-payoff",
  chapters: [chapter],
} as unknown as GeneralVisualPlan;

describe("pinned Kumiki attention compiler integration", () => {
  it("compiles a real Kumiki hook and typography plan with no hidden clock", () => {
    const compiled = compileChapterAttention(plan.chapters[0], plan);
    expect(compiled?.hook?.metadata.strategy).toBe("unexpected-reveal");
    expect(compiled?.typography?.metadata.style).toBe("wipe");
    expect(compiled?.hook?.diagnostics.filter(x => x.severity === "error")).toEqual([]);
    expect(compiled?.typography?.diagnostics.filter(x => x.severity === "error")).toEqual([]);
    const start = sampleChapterAttention(compiled!, 0, 90);
    const reveal = sampleChapterAttention(compiled!, 89, 90);
    expect(start.showDiagram).toBe(false);
    expect(reveal.showDiagram).toBe(true);
    expect(start.wipeWidth).toBeLessThan(reveal.wipeWidth);
    expect(reveal.titleOpacity).toBe(1);
    expect(sampleChapterAttention(compiled!, 42, 90)).toEqual(sampleChapterAttention(compiled!, 42, 90));
  });
  it("honors reduced motion without changing narrative reveal timing", () => {
    const compiled = compileChapterAttention(plan.chapters[0], plan)!;
    const reduced = sampleChapterAttention(compiled, 0, 90, true);
    expect(reduced.titleScale).toBe(1);
    expect(reduced.titleOpacity).toBe(1);
    expect(reduced.wipeWidth).toBe(780);
    expect(reduced.showDiagram).toBe(false);
  });
  it("makes an action-first title visible immediately and avoids numeric/statistic fabrications", () => {
    const action = { ...plan.chapters[0], visual: { ...plan.chapters[0].visual, hookStrategy: "action-first" as const, typographyStyle: "snap" as const } };
    const result = compileChapterAttention(action, plan)!;
    const start = sampleChapterAttention(result, 0, 90);
    expect(start.titleOpacity).toBeGreaterThan(0.5);
    expect(start.showDiagram).toBe(true);
    expect(result.hook?.metadata.strategy).toBe("action-first");
  });
  it("does not retrofit legacy general scenes with arbitrary attention effects", () => {
    const legacy = { ...plan.chapters[0], visual: { ...plan.chapters[0].visual,
      hookStrategy: undefined, typographyStyle: undefined } };
    expect(compileChapterAttention(legacy, plan)).toBeNull();
  });
});
