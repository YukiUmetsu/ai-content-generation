import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { inspectSafeFrame, safeFrameContentRect } from "@/components/visual/safe-frame";
import type { GeneralVisualPlan } from "../../scripts/video-production/general-visual-plan.mjs";
import { PortraitGeneralExportScene, portraitProfile } from "./portrait-general-scene";

const visual = (headline: string, items: string[], style = "snap") => ({
  headline, subhead: "What happens after pressing Send?",
  emphasis: "THE ROUTE", items,
  typographyStyle: style as "snap",
});
const plan = {
  schemaVersion: 1, kind: "general-explainer-visual-plan", title: "Packets",
  locale: "en-US",
  manifest: { schemaVersion: 1, id: "portrait-smoke", durationFrames: 360,
    width: 1080, height: 1920, fps: { num: 30, den: 1 }, preset: "youtube-shorts" },
  chapters: [
    { id: "beat-01", intent: "general-intro", startFrame: 0, endFrame: 120,
      claimRefs: ["c1"], evidenceRefs: [], eventIds: [],
      visual: { ...visual("Where does the message travel?", ["Sender", "Receiver"]), hookStrategy: "unexpected-reveal" } },
    { id: "beat-02", intent: "general-comparison", startFrame: 120, endFrame: 240,
      claimRefs: ["c1"], evidenceRefs: [], eventIds: [],
      visual: visual("The network chooses a route", ["Direct path", "Routed path"]) },
    { id: "beat-03", intent: "general-payoff", startFrame: 240, endFrame: 360,
      claimRefs: ["c1"], evidenceRefs: [], eventIds: ["topic-payoff"],
      visual: visual("The receiver reconstructs the message", ["Packets", "Readable message"]) },
  ],
  claims: [{ id: "c1", status: "unverified", text: "A model narration needs editorial review" }],
  evidence: [], events: { "topic-payoff": 240 }, payoffEventId: "topic-payoff",
  disclaimer: "UNVERIFIED DRAFT", commercialReady: false,
} as GeneralVisualPlan;

describe("native portrait video export", () => {
  it("reuses Kumiki's exact safe-inset profile across supported short platforms", () => {
    for (const id of ["youtube-shorts", "instagram-reels", "tiktok"] as const) {
      const profile = portraitProfile(id);
      expect([profile.width, profile.height]).toEqual([1080, 1920]);
      const content = safeFrameContentRect(profile);
      expect(content.x).toBeCloseTo(.08);
      expect(content.y).toBeCloseTo(.09);
      expect(content.height).toBeCloseTo(.72);
      const report = inspectSafeFrame(profile, [
        { id: "title", kind: "text", rect: { x: .11, y: .2, width: .6, height: .12 } },
        { id: "diagram", kind: "subject", critical: true,
          rect: { x: .11, y: .45, width: .7, height: .31 } },
      ]);
      expect(report.ok).toBe(true);
      expect(inspectSafeFrame(profile, [{ id: "bad", kind: "text",
        rect: { x: .11, y: .9, width: .6, height: .06 } }]).ok).toBe(false);
    }
  });
  it("composes independently in 1080x1920, with measured-safe text and opening reveal", () => {
    const opening = renderToStaticMarkup(createElement(PortraitGeneralExportScene, { plan, frame: 0 }));
    expect(opening).toContain('viewBox="0 0 1080 1920"');
    expect(opening).toContain('data-safe-frame-status="ok"');
    expect(opening).toContain('data-portrait-general-scene=""');
    expect(opening).toContain('data-portrait-recipe="unexpected-reveal"');
    expect(opening).toContain('data-portrait-copy="heading"');
    expect(opening).not.toContain('data-portrait-node="0"');
    const arrived = renderToStaticMarkup(createElement(PortraitGeneralExportScene, { plan, frame: 110 }));
    expect(arrived).toContain('data-portrait-node="0"');
    expect(arrived).toContain('data-portrait-node="1"');
    const payoffStart = renderToStaticMarkup(createElement(PortraitGeneralExportScene, { plan, frame: 240 }));
    expect(payoffStart).not.toContain('data-portrait-copy="heading"');
    const payoff = renderToStaticMarkup(createElement(PortraitGeneralExportScene, { plan, frame: 300 }));
    expect(payoff).toContain('data-portrait-copy="heading"');
  });
  it("renders a two-subject comparison without using the old landscape layout", () => {
    const result = renderToStaticMarkup(createElement(PortraitGeneralExportScene, { plan, frame: 210 }));
    expect(result).toContain("VS");
    expect(result).toContain('x="118" y="975"');
    expect(result).toContain('x="510" y="975"');
    expect(result).not.toContain('viewBox="0 0 1920 1080"');
  });
});
