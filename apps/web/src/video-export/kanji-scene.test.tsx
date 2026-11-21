import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { SHODO_GLYPHS } from "@/components/video/shodo/shodo-glyphs";
import { kanjiCardWriting } from "@/components/video/shodo/shodo-kanji-card-plan";
import { readKanjiStudyPlan, sameStrokes } from "./kanji-plan";
import type { KanjiStudyVisualPlan } from "./kanji-plan";
import { KanjiStudyExport } from "./kanji-scene";

const SHORTS = { left: .08, right: .12, top: .09, bottom: .19 };
const TIMING = { intro: 2, write: 3, review: 3, info: 2 };
const TEXT = { meanings: "THREE", onyomi: "SAN (サン)", kunyomi: "mi (み)", jlpt: "N5" as const, words: [{ word: "三月", ruby: "さんがつ", romaji: "sangatsu", meaning: "March" }] };
// What the producer timed the narration to: Kumiki's planning in Node, from the same glyph and card text.
const strokes = kanjiCardWriting(SHODO_GLYPHS["三"], { layout: "portrait", density: "compact", safeInset: SHORTS, content: TEXT, timing: TIMING }).strokes;
const plan: KanjiStudyVisualPlan = {
  schemaVersion: 1, kind: "kanji-study-visual-plan",
  manifest: { schemaVersion: 1, id: "kanji-short-4e09", durationFrames: 30 * 10, width: 1080, height: 1920, fps: { num: 30, den: 1 }, preset: "youtube-shorts" },
  card: {
    char: "三", glyph: SHODO_GLYPHS["三"], layout: "portrait", density: "compact", heading: "Kanji study", safeInset: SHORTS,
    timing: TIMING, intro: { reading: "さん", convertAt: .6, emphasizeAt: 1.5 }, ...TEXT,
    wordHighlights: [{ word: 0, at: 8, hold: 1.5 }], strokeNumbers: true, reducedMotion: false,
  },
  strokes: JSON.parse(JSON.stringify(strokes)),
};

afterEach(cleanup);

describe("kanji study export plan", () => {
  it("accepts a short whose phases fill the manifest, and names the first problem otherwise", () => {
    expect(readKanjiStudyPlan(plan)).toBe(plan);
    const bad = (change: (p: KanjiStudyVisualPlan) => KanjiStudyVisualPlan) => () => readKanjiStudyPlan(change(structuredClone(plan)));
    expect(bad(p => ({ ...p, manifest: { ...p.manifest, durationFrames: 301 } }))).toThrow(/phases last 300 frames, the manifest 301/u);
    expect(bad(p => ({ ...p, manifest: { ...p.manifest, width: 1920, height: 1080 } }))).toThrow(/1080 × 1920/u);
    expect(bad(p => ({ ...p, card: { ...p.card, glyph: SHODO_GLYPHS["一"] } }))).toThrow(/glyph does not match/u);
    expect(bad(p => ({ ...p, card: { ...p.card, reducedMotion: undefined } }))).toThrow(/reducedMotion to false/u);
    expect(bad(p => ({ ...p, card: { ...p.card, wordHighlights: [{ word: 1, at: 8 }] } }))).toThrow(/word highlights/u);
    expect(bad(p => ({ ...p, card: { ...p.card, words: [] } }))).toThrow(/useful words/u);
    expect(bad(p => ({ ...p, card: { ...p.card, safeInset: undefined } }))).toThrow(/safe bands/u);
    expect(bad(p => ({ ...p, strokes: { write: [], review: p.strokes.review } }))).toThrow(/stroke times/u);
    expect(bad(p => ({ ...p, card: { ...p.card, words: [{ ...TEXT.words[0], word: "語".repeat(41) }] } }))).toThrow(/text limits/u);
  });

  it("draws the strokes that the narration was timed to, to the millisecond", () => {
    const { container } = render(<KanjiStudyExport plan={plan} />);
    const drawn = JSON.parse(container.querySelector<HTMLElement>("[data-km-kanji-card]")!.dataset.kmStrokeTimes!);
    expect(sameStrokes(drawn, plan.strokes)).toBe(true);
    const shifted = { ...plan.strokes, write: plan.strokes.write.map(([a, b]) => [a + .01, b] as const) };
    expect(sameStrokes(drawn, shifted)).toBe(false);
    expect(sameStrokes(null, plan.strokes)).toBe(false);
  });

  it("registers the export handshake with the plan's manifest and draws the card at frame 0", () => {
    const { container } = render(<KanjiStudyExport plan={plan} />);
    expect(window.__kmVideoExport?.manifest).toEqual(plan.manifest);
    const card = container.querySelector<HTMLElement>("[data-km-kanji-card]");
    expect(card?.dataset.kmKanjiFrame).toBe("0");
    expect(card?.dataset.kmKanjiPhase).toBe("intro");
    expect(container.querySelector("[data-km-video-capture]")?.getAttribute("data-output-width")).toBe("1080");
  });
});
