import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inspectShodoGlyph, parseKanjiVgSvg, shodoKaishoForm } from "@/components/video/shodo/shodo-glyphs";
import { SHODO_REVIEWED_KANJI } from "@/components/video/shodo/shodo-reviewed-kanji";
import { planShodoWriting } from "@/components/video/shodo/shodo-hand";
import { DEFAULT_SHODO_STYLE } from "@/components/video/shodo/shodo-style";
import { glyphFromKanjiVg, kanjiVgTextHash } from "./kanji-entry";

// The KanjiVG release the reviewed forms were checked against, from the local cache the kanji shorts use.
const CACHE = new URL("../../../../data/kanji-shorts/cache/kanjivg/r20260714/", import.meta.url);
const svgFor = (file: string): string | null => {
  const path = new URL(`${file}.svg`, CACHE);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
};

describe("reviewed kaisho forms", () => {
  it("covers 先, 学 and 毎 with valid strokes", () => {
    expect(Object.keys(SHODO_REVIEWED_KANJI).sort()).toEqual(["先", "学", "毎"]);
    for (const glyph of Object.values(SHODO_REVIEWED_KANJI)) expect(inspectShodoGlyph(glyph)).toEqual([]);
  });

  it("keeps KanjiVG's stroke order, centrelines and turns; only the listed joins move", () => {
    for (const [char, reviewed] of Object.entries(SHODO_REVIEWED_KANJI)) {
      const svg = svgFor(reviewed.reviewed.file);
      if (!svg) continue; // the KanjiVG cache is local; without it the check is skipped, not passed
      const baseline = shodoKaishoForm(parseKanjiVgSvg(svg, char));
      expect(reviewed.strokes.length).toBe(baseline.strokes.length);
      const moved = new Set((reviewed.moved ?? []).map(m => `${m.stroke}:${m.point}`));
      reviewed.strokes.forEach((stroke, i) => {
        const base = baseline.strokes[i];
        expect(stroke.kind, `${char} stroke ${i + 1} kind`).toBe(base.kind);
        expect(stroke.turns, `${char} stroke ${i + 1} turns`).toEqual(base.turns);
        expect(stroke.end, `${char} stroke ${i + 1} end`).toEqual(base.end);
        expect(stroke.start, `${char} stroke ${i + 1} start`).toEqual(base.start);
        expect(stroke.points.length, `${char} stroke ${i + 1} point count`).toBe(base.points.length);
        stroke.points.forEach((p, k) => {
          if (moved.has(`${i}:${k}`)) {
            // A moved point really moved, and stays near KanjiVG's point (a join or a whole-stroke move: up to about 150 units).
            const d = Math.hypot(p[0] - base.points[k][0], p[1] - base.points[k][1]);
            expect(d, `${char} stroke ${i + 1} point ${k + 1} moved by ${d.toFixed(1)}`).toBeGreaterThan(0);
            expect(d, `${char} stroke ${i + 1} point ${k + 1} moved by ${d.toFixed(1)}`).toBeLessThan(200);
          } else {
            expect(p, `${char} stroke ${i + 1} point ${k + 1}`).toEqual(base.points[k]);
          }
        });
        // A stroke whose points all move is moved as a whole: one offset for every point, so its shape is KanjiVG's.
        if (stroke.points.every((_, k) => moved.has(`${i}:${k}`))) {
          const offsets = stroke.points.map((p, k) => [p[0] - base.points[k][0], p[1] - base.points[k][1]]);
          for (const o of offsets) {
            expect(o[0], `${char} stroke ${i + 1} moves as a whole (x)`).toBeCloseTo(offsets[0][0], 6);
            expect(o[1], `${char} stroke ${i + 1} moves as a whole (y)`).toBeCloseTo(offsets[0][1], 6);
          }
        }
      });
    }
  });

  it("is used only for the KanjiVG text it was reviewed against", async () => {
    const svg = svgFor(SHODO_REVIEWED_KANJI["先"].reviewed.file);
    if (!svg) return;
    const reviewed = await glyphFromKanjiVg("先", svg);
    expect(reviewed.strokes[0].weight).toBe(SHODO_REVIEWED_KANJI["先"].strokes[0].weight);
    expect(reviewed.strokes).toEqual(SHODO_REVIEWED_KANJI["先"].strokes);
    // Different KanjiVG text (here, one extra space) falls back to the KanjiVG rules, not the review.
    const changed = svg + " ";
    expect(kanjiVgTextHash(changed)).not.toBe(SHODO_REVIEWED_KANJI["先"].reviewed.svgHash);
    const fallback = await glyphFromKanjiVg("先", changed);
    expect(fallback.strokes[0].weight).not.toBe(SHODO_REVIEWED_KANJI["先"].strokes[0].weight);
  });

  it("starts 学's 7th stroke exactly at the tip of the 6th stroke's hane", () => {
    const glyph = SHODO_REVIEWED_KANJI["学"];
    // The planner's last contact of a stroke is where its hane ends (glyph units: one item of 1000).
    const plan = planShodoWriting({ style: DEFAULT_SHODO_STYLE, items: [{ glyph, x: 0, y: 0, size: 1000 }], exit: "rest", lead: 0 });
    const tip = plan.strokes.find(s => s.stroke === 5)!.samples.at(-1)!;
    const start = glyph.strokes[6].points[0];
    expect(Math.hypot(start[0] - tip.x, start[1] - tip.y)).toBeLessThan(0.05);
  });
});
