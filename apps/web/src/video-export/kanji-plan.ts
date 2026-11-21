/** The contract of a kanji study short's export plan, checked again by the page. */
import type { VideoExportManifest } from "@/components/video/video-export-stage";
import type { ShodoKanjiCardProps } from "@/components/video/shodo/shodo-kanji-card";
import type { ShodoGlyph } from "@/components/video/shodo/shodo-glyphs";

export interface KanjiStudyVisualPlan {
  schemaVersion: 1;
  kind: "kanji-study-visual-plan";
  manifest: VideoExportManifest;
  card: Omit<ShodoKanjiCardProps, "frame" | "pixelRatio" | "style" | "className">;
}

const SHORT_PRESETS = new Set(["youtube-shorts", "instagram-reels", "tiktok"]);
const finite = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const text = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max;

/** The plan, or an error that names the first problem. The producer validated it; the page checks again. */
export function readKanjiStudyPlan(input: unknown): KanjiStudyVisualPlan {
  const plan = input as KanjiStudyVisualPlan;
  const m = plan?.manifest, c = plan?.card as KanjiStudyVisualPlan["card"] | undefined;
  const problem = (what: string) => { throw new Error(`Kanji study plan: ${what}`); };
  if (plan?.schemaVersion !== 1 || plan.kind !== "kanji-study-visual-plan") problem("unsupported plan");
  if (m?.schemaVersion !== 1 || m.width !== 1080 || m.height !== 1920 || !SHORT_PRESETS.has(m.preset ?? "") ||
    !Number.isSafeInteger(m.durationFrames) || m.durationFrames < 1 || m.fps?.num !== 30 || m.fps?.den !== 1) problem("the manifest must be a 1080 × 1920, 30 fps short");
  if (!c || typeof c.char !== "string" || [...c.char].length !== 1) problem("one character is required");
  const glyph = c!.glyph as ShodoGlyph | undefined;
  if (!glyph || glyph.char !== c!.char || !Array.isArray(glyph.strokes) || !glyph.strokes.length) problem("the glyph does not match the character");
  const t = c!.timing;
  if (!t || !["intro", "write", "review", "info"].every(k => finite(t[k as keyof typeof t], 0, 600))) problem("all four phase times are required");
  const frames = ["intro", "write", "review", "info"].reduce((sum, k) => sum + Math.round((t![k as keyof typeof t] as number) * 30), 0);
  if (frames !== m!.durationFrames) problem(`the phases last ${frames} frames, the manifest ${m!.durationFrames}`);
  if (!Array.isArray(c!.words) || !c!.words.length || c!.words.length > 6 ||
    c!.words.some(w => !text(w?.word, 40) || !text(w?.ruby, 60) || !text(w?.romaji, 60) || !text(w?.meaning, 80))) problem("one to six useful words are required");
  if (!Array.isArray(c!.wordHighlights) || c!.wordHighlights.some(cue => !Number.isInteger(cue.word) || cue.word < 0 || cue.word >= c!.words!.length ||
    !finite(cue.at, 0, 600) || cue.hold !== undefined && !finite(cue.hold, .05, 60))) problem("the word highlights are invalid");
  const inset = c!.safeInset;
  if (!inset || !["left", "right", "top", "bottom"].every(k => finite(inset[k as keyof typeof inset], 0, .4))) problem("the safe bands are required");
  if (c!.reducedMotion !== false) problem("an export must set reducedMotion to false, so that it does not follow the capture browser's setting");
  return plan;
}
