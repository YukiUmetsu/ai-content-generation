/** Node access to the Kumiki kanji study card's planning, so narration is timed to the real brush
 * strokes before any frame is captured. The export page plans again from the same glyph and gets
 * the same strokes: `kanjiCardWriting` is pure.
 */
import { loadShodoGlyph } from "@/components/video/shodo/shodo-glyph-source";
import { SHODO_KANJIVG_BASE, SHODO_KANJIVG_CREDIT, SHODO_KANJIVG_RELEASE } from "@/components/video/shodo/shodo-glyph-source";
import { kanjiVgFileName } from "@/components/video/shodo/shodo-glyphs";
import type { ShodoGlyph } from "@/components/video/shodo/shodo-glyphs";
import { kanjiCardWriting } from "@/components/video/shodo/shodo-kanji-card-plan";
import type { KanjiCardWritingOptions } from "@/components/video/shodo/shodo-kanji-card-plan";

export { SHODO_KANJIVG_BASE, SHODO_KANJIVG_CREDIT, SHODO_KANJIVG_RELEASE, kanjiVgFileName };
// The export page's own plan check, so production refuses a plan the page would refuse, before any network call.
export { KANJI_SHORT_PRESETS, KANJI_WORD_LIMITS, readKanjiStudyPlan } from "@/video-export/kanji-plan";

/** The glyph for one character from KanjiVG SVG text the caller has already fetched and checked. */
export async function glyphFromKanjiVg(char: string, svg: string): Promise<ShodoGlyph> {
  // FNV-1a of the SVG: the loader caches by base URL, so different SVG text never shares a result.
  let hash = 0x811c9dc5;
  for (let i = 0; i < svg.length; i++) hash = Math.imul(hash ^ svg.charCodeAt(i), 0x01000193) >>> 0;
  return loadShodoGlyph(char, {
    preferBundled: false,
    baseUrl: `contentgen-kanjivg:${hash.toString(16)}:${svg.length}:`,
    fetcher: async () => ({ ok: true, status: 200, text: async () => svg }),
  });
}

/** Layout, phases, ink box and per-stroke times of the card, in seconds of the video. */
export function planKanjiCard(glyph: ShodoGlyph, options: KanjiCardWritingOptions) {
  const { timeline, strokes, inkBox, plan } = kanjiCardWriting(glyph, options);
  return { timeline, strokes, inkBox, writingSeconds: plan.duration };
}
