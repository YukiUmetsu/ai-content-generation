/** Node access to the Kumiki kanji study card's planning, so narration is timed to the real brush
 * strokes before any frame is captured. The export page plans again from the same glyph and gets
 * the same strokes: `kanjiCardWriting` is pure.
 */
import { loadShodoGlyph } from "@/components/video/shodo/shodo-glyph-source";
import { SHODO_KANJIVG_BASE, SHODO_KANJIVG_CREDIT, SHODO_KANJIVG_RELEASE } from "@/components/video/shodo/shodo-glyph-source";
import { kanjiVgFileName } from "@/components/video/shodo/shodo-glyphs";
import { SHODO_REVIEWED_KANJI } from "@/components/video/shodo/shodo-reviewed-kanji";
import type { ShodoGlyph } from "@/components/video/shodo/shodo-glyphs";
import { kanjiCardWriting } from "@/components/video/shodo/shodo-kanji-card-plan";
// The card's theme check, so a bad colour or font in the config stops production before any network call.
export { KANJI_CARD_CUE_SECTIONS, kanjiCardConvertAt, kanjiCardTheme, kanjiCardThemeIssues } from "@/components/video/shodo/shodo-kanji-card-plan";
import type { KanjiCardWritingOptions } from "@/components/video/shodo/shodo-kanji-card-plan";

export { SHODO_KANJIVG_BASE, SHODO_KANJIVG_CREDIT, SHODO_KANJIVG_RELEASE, kanjiVgFileName };
// The export page's own plan check, so production refuses a plan the page would refuse, before any network call.
export { KANJI_SHORT_PRESETS, KANJI_WORD_LIMITS, readKanjiStudyPlan } from "@/video-export/kanji-plan";

/** FNV-1a (32-bit, hex) of a text: the loader caches by it, and a reviewed form checks it. */
export function kanjiVgTextHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return hash.toString(16);
}

/** The glyph for one character from KanjiVG SVG text the caller has already fetched and checked. */
export async function glyphFromKanjiVg(char: string, svg: string): Promise<ShodoGlyph> {
  // A reviewed kaisho form is used only for the KanjiVG text it was checked against.
  const reviewed = SHODO_REVIEWED_KANJI[char];
  if (reviewed && reviewed.reviewed.svgLength === svg.length && reviewed.reviewed.svgHash === kanjiVgTextHash(svg)) {
    return { char: reviewed.char, source: reviewed.source, strokes: reviewed.strokes, ...(reviewed.parts ? { parts: reviewed.parts } : {}) };
  }
  // FNV-1a of the SVG: the loader caches by base URL, so different SVG text never shares a result.
  const hash = kanjiVgTextHash(svg);
  return loadShodoGlyph(char, {
    preferBundled: false,
    baseUrl: `contentgen-kanjivg:${hash}:${svg.length}:`,
    fetcher: async () => ({ ok: true, status: 200, text: async () => svg }),
  });
}

/** Layout, phases, ink box and per-stroke times of the card, in seconds of the video. */
export function planKanjiCard(glyph: ShodoGlyph, options: KanjiCardWritingOptions) {
  const { timeline, strokes, inkBox, plan } = kanjiCardWriting(glyph, options);
  return { timeline, strokes, inkBox, writingSeconds: plan.duration };
}
