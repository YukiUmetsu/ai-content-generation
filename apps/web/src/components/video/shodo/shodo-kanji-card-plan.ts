/**
 * Kanji study card (SHO1): pure planning. Layout, phases, the brush plan with its stroke times,
 * the typed intro and the word highlights. No React and no DOM, so a production tool can plan in
 * Node exactly the video that `ShodoKanjiCard` draws in the browser.
 */
import { shodoBrushClearance } from "./shodo-brush";
import type { ShodoGlyph } from "./shodo-glyphs";
import { SHODO_REST_HEIGHT, planShodoWriting, shodoRestLean } from "./shodo-hand";
import type { ShodoPlan } from "./shodo-hand";
import { DEFAULT_SHODO_STYLE, SHODO_INKS, resolveShodoStyle } from "./shodo-style";
import type { DeepPartial, ShodoStyle } from "./shodo-style";

/** Frame rate of the card's video clock. */
export const KANJI_CARD_FPS = 30;

export interface KanjiCardWord { word: string; ruby: string; romaji: string; meaning: string }
/** JLPT level, from N5 (easiest) to N1. */
export type JlptLevel = "N5" | "N4" | "N3" | "N2" | "N1";
export const KANJI_CARD_JLPT_LEVELS: readonly JlptLevel[] = ["N5", "N4", "N3", "N2", "N1"];
export type KanjiCardLayout = "landscape" | "portrait";
/** "compact" gives the 9:16 card a shorter, denser reading card and a taller writing box. Landscape has one size. */
export type KanjiCardDensity = "regular" | "compact";
export type KanjiCardPhase = "intro" | "write" | "review" | "info";
export type KanjiCardSection = "label" | "meanings" | "readings" | "jlpt" | "words";

/** What the card says about the character. Every field is data from the host. */
export interface KanjiCardContent {
  meanings?: string;
  onyomi?: string;
  kunyomi?: string;
  /** JLPT level. No level (or null) shows no badge. */
  jlpt?: JlptLevel | null;
  words?: readonly KanjiCardWord[];
  /** Strokes (writing order from 1) written in vermilion ink (朱墨) to highlight them. Default: none. */
  vermilionStrokes?: readonly number[];
}

/** Ink for the whole character: black sumi (default) or vermilion shuboku (朱墨). */
export type KanjiCardInk = "sumi" | "vermilion";

/**
 * The card's fixed words, for another language or wording. `heading` formats the label over the
 * paper: `{heading}` is the heading as given, `{HEADING}` in capitals, `{char}` the character.
 * `cardName` and `writingName` are the accessible names of the reading card and the writing.
 */
export interface KanjiCardLabels { onyomi: string; kunyomi: string; words: string; jlpt: string; heading: string; cardName: string; writingName: string }
export const DEFAULT_KANJI_CARD_LABELS: Readonly<KanjiCardLabels> = {
  onyomi: "ON'YOMI", kunyomi: "KUN'YOMI", words: "USEFUL WORDS", jlpt: "JLPT", heading: "{HEADING}: {char}",
  cardName: "{char} readings and words", writingName: "The kanji {char} written with a brush",
};

/** The labels with defaults for any key that is missing or not a text. */
export function kanjiCardLabels(labels: Partial<KanjiCardLabels> | undefined): KanjiCardLabels {
  const out = { ...DEFAULT_KANJI_CARD_LABELS };
  for (const key of Object.keys(out) as (keyof KanjiCardLabels)[]) if (typeof labels?.[key] === "string") out[key] = labels[key] as string;
  return out;
}

/** A label template with `{heading}`, `{HEADING}` (capitals, by the language of `locale`) and `{char}` filled in. */
export function kanjiCardLabelText(template: string, values: { heading?: string; char: string }, locale?: string): string {
  return template.replace(/\{(heading|HEADING|char)\}/gu, (_, key: string) =>
    key === "char" ? values.char : key === "HEADING" ? (values.heading ?? "").toLocaleUpperCase(locale) : values.heading ?? "");
}

/**
 * Colours (#RRGGBB) and font stacks of the card's text, for a brand or a look. The paper, ink and
 * brush are set with `brushStyle`.
 */
export interface KanjiCardTheme {
  /** Main text and the typed character. */
  ink: string;
  /** Terms, furigana and the romaji of a word that is not highlighted. */
  muted: string;
  /** Badge, highlight ring, caret and the romaji of the highlighted word (vermilion by default). */
  accent: string;
  /** The reading card. */
  card: string;
  /** A word tile, and a highlighted word tile. */
  tile: string;
  tileHighlight: string;
  /** The line under the title. */
  rule: string;
  /** The bar between the character and its meaning. */
  bar: string;
  /** The soft shadow under a highlighted word. */
  glow: string;
  /** The arrow guide of single vermilion strokes (the stroke numbers use `accent`). */
  guide: string;
  /** Display font: label, title, terms and badge. */
  display: string;
  /** Serif font for the character and the words. */
  serif: string;
  /** Sans font for the typed character. */
  sans: string;
  /** Body font: readings, furigana, romaji and meanings. */
  body: string;
}
export const DEFAULT_KANJI_CARD_THEME: Readonly<KanjiCardTheme> = {
  ink: "#1B1A18", muted: "#665B51", accent: "#B3301A", card: "#FBFAF7", tile: "#F3EFE7", tileHighlight: "#F9E0D4", rule: "#C9C3B8",
  bar: "#A39A8E", glow: "#6E2814", guide: "#D8432A",
  display: "'Oswald', 'Arial Narrow', system-ui, sans-serif",
  serif: "'Hiragino Mincho ProN', 'Yu Mincho', 'Noto Serif JP', serif",
  sans: "'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', 'Yu Gothic', system-ui, sans-serif",
  body: "system-ui, sans-serif",
};

const HEX = /^#[0-9a-f]{6}$/iu;
const COLOUR_KEYS = ["ink", "muted", "accent", "card", "tile", "tileHighlight", "rule", "bar", "glow", "guide"] as const;
const FONT_KEYS = ["display", "serif", "sans", "body"] as const;
// A CSS font family: quoted, or words that are each an identifier ("M PLUS 1p" must be quoted: "1p" is not one).
const FAMILY = /^(?:"[^"]+"|'[^']+'|-?[_a-zA-Z\u00a0-\uffff][-_a-zA-Z0-9\u00a0-\uffff]*(?:\s+-?[_a-zA-Z\u00a0-\uffff][-_a-zA-Z0-9\u00a0-\uffff]*)*)$/u;

// CSS-wide keywords are not family names: unquoted, they make the whole `font` shorthand invalid.
const CSS_WIDE = /^(?:inherit|initial|unset|revert|revert-layer|default)$/iu;

/**
 * Every problem of a theme, one message per key (empty when it is valid). A missing or undefined
 * key uses its default. With `unknownKeys` (default), a key the theme does not have is a problem
 * too, for a description to be checked; the card itself ignores such keys.
 */
export function kanjiCardThemeIssues(theme: Partial<KanjiCardTheme> | undefined, { unknownKeys = true }: { unknownKeys?: boolean } = {}): string[] {
  const issues: string[] = [];
  const known: readonly string[] = [...COLOUR_KEYS, ...FONT_KEYS];
  if (unknownKeys) for (const key of Object.keys(theme ?? {})) if (!known.includes(key)) issues.push(`${key} is not a theme key (${known.join(", ")})`);
  for (const key of COLOUR_KEYS) { const v = theme?.[key]; if (v !== undefined && !(typeof v === "string" && HEX.test(v))) issues.push(`${key} must be a #RRGGBB colour`); }
  for (const key of FONT_KEYS) {
    const v = theme?.[key];
    if (v !== undefined && !(typeof v === "string" && v.split(",").every(family => FAMILY.test(family.trim()) && !CSS_WIDE.test(family.trim()))))
      issues.push(`${key} must be a CSS font stack; quote a family name with digits or symbols, as in "'M PLUS 1p', sans-serif"`);
  }
  return issues;
}

/**
 * The theme with defaults for any key that is missing or undefined; keys the theme does not have
 * are ignored (a host may pass a larger brand object). An invalid value throws a RangeError that
 * names every bad key.
 */
export function kanjiCardTheme(theme: Partial<KanjiCardTheme> | undefined): KanjiCardTheme {
  const issues = kanjiCardThemeIssues(theme, { unknownKeys: false });
  if (issues.length) throw new RangeError(`Kanji card theme: ${issues.join("; ")}.`);
  const out = { ...DEFAULT_KANJI_CARD_THEME };
  for (const key of [...COLOUR_KEYS, ...FONT_KEYS]) if (theme?.[key] !== undefined) out[key] = theme[key] as string;
  return out;
}

/** Seconds for each phase of the video. A phase of 0 seconds is skipped. */
export interface KanjiCardTiming {
  /** The typed character before the brush writes (see `KanjiCardIntro`). Default: 0 (no intro). */
  intro?: number;
  /** First writing, with its short hold at the end. Default: the natural pace of the brush. */
  write?: number;
  /** Second writing, which shows the order number of each stroke. Default: the same as `write`. */
  review?: number;
  /** Hold of the finished card at the end. Default: 4. */
  info?: number;
}

/**
 * The intro phase types the character as a phone or computer keyboard does: a caret, the
 * reading in kana (underlined while it is composed), then the conversion to the character.
 */
export interface KanjiCardIntro {
  /** Kana typed before the conversion, for example "みず". Without it the character is typed directly. */
  reading?: string;
  /** Seconds from the start of the intro when the reading converts to the character. Default: 60 % of the intro. */
  convertAt?: number;
  /**
   * Seconds from the start of the intro when the typed character is emphasized with a short
   * highlight pulse, for example when a voice-over says its name. Default: none.
   */
  emphasizeAt?: number;
  /** Seconds per typed kana, 0.05..0.6. Default: 0.16. */
  typeStep?: number;
}

/**
 * Bands at the edges of the frame that a platform covers with its own buttons and text: left and
 * right as fractions of the frame's width, top and bottom of its height, each 0..0.4. For
 * example the `safeInset` of a `VideoPlatformPreset`.
 */
export interface KanjiCardSafeInset { left: number; right: number; top: number; bottom: number }

export interface KanjiCardTimeline {
  fps: number;
  /** Frame ranges [start, end) of each phase. */
  intro: readonly [number, number];
  write: readonly [number, number];
  review: readonly [number, number];
  info: readonly [number, number];
  frames: number;
}

const seconds = (value: number | undefined, fallback: number) => Math.max(0, value !== undefined && Number.isFinite(value) ? value : fallback);

/** Frame ranges of the four phases for a writing that takes `writing` seconds at its natural pace. */
export function kanjiCardTimeline(writing: number, timing: KanjiCardTiming = {}, fps = KANJI_CARD_FPS): KanjiCardTimeline {
  const intro = seconds(timing.intro, 0);
  const write = seconds(timing.write, writing);
  const review = seconds(timing.review, write > 0 ? write : writing);
  const info = seconds(timing.info, 4);
  const n = Math.round(intro * fps), w = Math.round(write * fps), r = Math.round(review * fps), i = Math.round(info * fps);
  return { fps, intro: [0, n], write: [n, n + w], review: [n + w, n + w + r], info: [n + w + r, n + w + r + i], frames: Math.max(1, n + w + r + i) };
}

/** The phase at `frame`, the frame within the phase and the length of the phase in frames. */
export function kanjiCardPhaseAt(timeline: KanjiCardTimeline, frame: number): { phase: KanjiCardPhase; local: number; length: number } {
  for (const phase of ["intro", "write", "review"] as const) {
    const [a, b] = timeline[phase];
    if (frame < b) return { phase, local: Math.max(0, frame - a), length: b - a };
  }
  const [a, b] = timeline.info;
  return { phase: "info", local: Math.max(0, frame - a), length: b - a };
}

/** When the brush is on the paper for each stroke, in seconds of the video, for each writing pass. */
export interface KanjiCardStrokeTimes {
  write: readonly (readonly [number, number])[];
  review: readonly (readonly [number, number])[];
}

/**
 * The time of each stroke in the video: [start, end] while the brush is on the paper, in writing
 * order, for the first writing and for the review. A pass of 0 s has no strokes. A host uses it
 * to place a voice-over or sounds on the strokes (for example a word as the brush lands). Pure.
 */
export function kanjiCardStrokeTimes(plan: Pick<ShodoPlan, "duration" | "strokes">, timeline: KanjiCardTimeline): KanjiCardStrokeTimes {
  const pass = ([a, b]: readonly [number, number]) => b <= a || !(plan.duration > 0) ? [] : plan.strokes.filter(s => s.kind !== "link").map(s => {
    const at = (t: number) => Math.round((a + t / plan.duration * (b - a)) / timeline.fps * 1000) / 1000;
    return [at(s.t0), at(s.t1)] as const;
  });
  return { write: pass(timeline.write), review: pass(timeline.review) };
}

/**
 * One cue for the useful words: highlight word `word` (index in `words`, from 0) from `at`
 * seconds after the start of the video, for `hold` seconds (default `KANJI_WORD_HOLD`). The
 * times are plain seconds, so a voice-over cue list (the start time of each spoken word) can
 * give them directly.
 */
export interface KanjiWordHighlight { word: number; at: number; hold?: number }

/** The highlighted word (null for none) and the strength of its highlight, 0..1. */
export interface KanjiWordHighlightState { word: number | null; strength: number }

/** Default time that a word stays highlighted, s (eases included). */
export const KANJI_WORD_HOLD = 2.5;
/** Time of the ease in and of the ease out, s. */
export const KANJI_WORD_EASE = .25;

const smoothstep = (x: number) => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); };

/**
 * The useful word that is highlighted at a time of the video, and how strongly. Pure.
 * - One word at a time. When cues overlap, the later cue wins (by `at`, then by list order),
 *   and the earlier highlight ends where the later one starts.
 * - A highlight eases in during the first `ease` seconds after `at` and eases out during the
 *   last `ease` seconds before it ends (`at + hold`, or the next cue's `at` if that is earlier).
 * - A cue with a word index outside `count`, or with a time that is not a finite number, is ignored.
 */
export function wordHighlightAt(
  schedule: readonly KanjiWordHighlight[], time: number, options: { count?: number; ease?: number } = {},
): KanjiWordHighlightState {
  const ease = Math.max(1e-3, options.ease ?? KANJI_WORD_EASE);
  const cues = schedule.map((cue, order) => ({ cue, order }))
    .filter(({ cue }) => Number.isInteger(cue.word) && cue.word >= 0 && (options.count === undefined || cue.word < options.count) && Number.isFinite(cue.at))
    .sort((a, b) => a.cue.at - b.cue.at || a.order - b.order);
  // Only the latest cue that has started can be active: it ends every earlier one.
  let k = -1;
  for (let i = 0; i < cues.length; i++) if (cues[i].cue.at <= time) k = i;
  if (k < 0) return { word: null, strength: 0 };
  const { cue } = cues[k];
  const hold = cue.hold !== undefined && Number.isFinite(cue.hold) && cue.hold > 0 ? cue.hold : KANJI_WORD_HOLD;
  const end = Math.min(cue.at + hold, k + 1 < cues.length ? cues[k + 1].cue.at : Infinity);
  const strength = Math.min(smoothstep((time - cue.at) / ease), smoothstep((end - time) / ease));
  return strength > 0 ? { word: cue.word, strength } : { word: null, strength: 0 };
}

/**
 * A demo cue list: each of `count` words in turn over a video of `length` seconds. The first word
 * starts at 20 % and the last at 80 % of the video, evenly spaced; each one holds for 2.5 s, or
 * until the next one if that is sooner.
 */
export function spreadWordHighlights(count: number, length: number): KanjiWordHighlight[] {
  if (!(count > 0) || !(length > 0)) return [];
  const gap = count > 1 ? length * .6 / (count - 1) : 0;
  return Array.from({ length: count }, (_, word) => ({ word, at: Math.round((length * .2 + gap * word) * 100) / 100, hold: Math.min(KANJI_WORD_HOLD, gap || KANJI_WORD_HOLD) }));
}

/**
 * Reads a cue list such as "0@3, 1@6.5, 2@9+1.5": word index (from 0) @ seconds, with an
 * optional "+hold" in seconds. Commas, semicolons and new lines separate the cues. A cue
 * that does not match the pattern is ignored.
 */
export function parseWordHighlights(text: string): KanjiWordHighlight[] {
  const out: KanjiWordHighlight[] = [];
  for (const part of text.split(/[,;\n]+/)) {
    const m = /^\s*(\d+)\s*@\s*(\d+(?:\.\d+)?)\s*(?:\+\s*(\d+(?:\.\d+)?))?\s*$/.exec(part);
    if (m) out.push(m[3] !== undefined ? { word: Number(m[1]), at: Number(m[2]), hold: Number(m[3]) } : { word: Number(m[1]), at: Number(m[2]) });
  }
  return out;
}

/** Text sizes and spacing of the card, design px. */
export interface KanjiCardType {
  label: number; pad: readonly [number, number]; gap: number; head: number; headKanji: number;
  reading: number; badge: number; title: number; word: number; ruby: number; gloss: number;
  /** Smallest text size of the stroke-order numbers, design px (they are 0.42 of the brush diameter, at least this). */
  number: number;
  /** Height reserved for the text of the 9:16 card, design px (padding not included). */
  text: number;
  /** Space above the useful words' title. */
  section: number;
  /** Space above and below the text inside a 9:16 word tile. */
  tilePad: readonly [number, number];
  /** 9:16: space between the practice box and the writing in it, above and below. */
  inkPad: number;
  /** 9:16: space between the practice box and the reading card. */
  cardGap: number;
}

// Text sizes in design px. Portrait sizes keep body text at 13 px or more on a 390 px wide phone
// (24 design px of the 720 px wide frame); stroke numbers of at least 28 design px are 15 px tall.
const KANJI_CARD_TYPES: Record<"landscape" | "portrait" | "portrait-compact", KanjiCardType> = {
  landscape: { label: 33, pad: [40, 34], gap: 22, head: 31, headKanji: 38, reading: 19, badge: 16, title: 24, word: 46, ruby: 16, gloss: 20, number: 0, text: 640,
    section: 6.6, tilePad: [15.4, 17.6], inkPad: 0, cardGap: 0 },
  portrait: { label: 42, pad: [34, 36], gap: 26, head: 38, headKanji: 48, reading: 26, badge: 23, title: 26, word: 58, ruby: 22, gloss: 25, number: 28, text: 462,
    section: 7.8, tilePad: [18.2, 20.8], inkPad: 0, cardGap: 0 },
  // Compact (a phone short): the readings sit on one line each, so the useful words get large tiles
  // with room around them, and the character gets air above and below in its box.
  "portrait-compact": { label: 34, pad: [20, 36], gap: 12, head: 32, headKanji: 40, reading: 24, badge: 20, title: 26, word: 58, ruby: 22, gloss: 24, number: 28, text: 360,
    section: 18, tilePad: [18, 20], inkPad: 36, cardGap: 28 },
};

/** Columns of the 9:16 word tiles for `n` words. */
export const kanjiCardColumns = (n: number) => n <= 3 ? n : n === 4 ? 2 : 3;

const CJK = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/u;
type Face = "body" | "display" | "serif";
// Advance widths in em of the default fonts, measured in Chrome on macOS (system-ui semibold,
// Oswald bold, Hiragino Mincho): CJK, capitals, digits, lower case, space, punctuation.
const FACE_EM: Record<Face, readonly [number, number, number, number, number, number]> = {
  body: [.95, .65, .6, .5, .2, .29], display: [.95, .564, .5, .45, .23, .21], serif: [1, .65, .6, .5, .25, .3],
};
/** Rough width of a line of text in em, in one of the card's faces. */
function textEm(text: string, face: Face): number {
  const [cjk, caps, digit, lower, space, punct] = FACE_EM[face];
  let em = 0;
  for (const ch of text) em += CJK.test(ch) ? cjk : ch === " " ? space : /\p{P}|\p{S}/u.test(ch) ? punct : /\p{N}/u.test(ch) ? digit : /\p{Lu}/u.test(ch) ? caps : lower;
  return em;
}
// A line that only just overflows by this estimate usually fits: the card's fit shrinks it a little if not.
const linesOf = (width: number, room: number) => room > 0 ? Math.max(1, Math.ceil(width / room - .06)) : 1;

/** Width inside one 9:16 word tile, design px, for `count` words in a text column `width` design px wide. */
export function kanjiCardTileRoom(width: number, count: number, t: KanjiCardType): number {
  const cols = kanjiCardColumns(Math.max(1, count));
  return (width - (cols - 1) * t.gap * .7) / cols - 2 * t.gap * .45;
}

/**
 * Text size of the words in the 9:16 word tiles, design px: the type's size, or smaller when the
 * widest word would not fit in a tile `room` design px wide. One size for every tile.
 */
export function kanjiCardWordSize(words: readonly Pick<KanjiCardWord, "word">[], room: number, t: KanjiCardType): number {
  const widest = Math.max(0, ...words.map(w => textEm(w.word, "serif")));
  return widest > 0 && room > 0 ? Math.min(t.word, room / widest) : t.word;
}

/**
 * Height that the compact 9:16 card's text needs, design px, at full size, for a text column
 * `width` design px wide: estimated from the text (wrapped meanings, readings on one line or
 * two, word tiles with wrapped romaji or meanings) with the default labels and fonts. The card
 * reserves this height, so short text leaves the character more room and long text keeps its
 * size; when the estimate is short, the card's text shrinks a little to fit. Pure, so Node plans
 * what the card draws.
 */
export function kanjiCardTextHeight(content: KanjiCardContent, sections: Partial<Record<KanjiCardSection, boolean>> | undefined, width: number, t: KanjiCardType): number {
  const show = kanjiCardSections(sections), L = DEFAULT_KANJI_CARD_LABELS;
  const level = show.jlpt && content.jlpt && KANJI_CARD_JLPT_LEVELS.includes(content.jlpt) ? content.jlpt : null;
  const meanings = show.meanings && content.meanings ? content.meanings : "";
  const parts: number[] = [];
  if (meanings || level) {
    // The badge (with its padding and border) and the character with its bar keep their width; the meanings wrap.
    const badge = level ? (textEm(`${L.jlpt} ${level}`, "display") + .06 * 8 + 1.6) * t.badge + 6 : 0;
    const lead = meanings ? t.headKanji + t.head * .9 : 0;
    const lines = meanings ? linesOf(textEm(meanings, "display") * t.head, width - lead - badge - t.head * .3) : 1;
    parts.push(Math.max(t.headKanji, lines * t.head * 1.12) + t.gap * .6 + 1);
  }
  const readings = show.readings ? ([[L.onyomi, content.onyomi], [L.kunyomi, content.kunyomi]] as const).filter(([, v]) => !!v) : [];
  if (readings.length) {
    const items = readings.map(([term, value]) => (textEm(term, "display") + .06 * term.length) * t.reading * .84 + .45 * t.reading + textEm(value ?? "", "body") * t.reading);
    const row = items.reduce((a, b) => a + b, 0) + t.gap * 1.6 * (items.length - 1);
    const lines = row <= width * 1.02 ? 1 : items.reduce((n, w) => n + linesOf(w, width), 0);
    parts.push(lines * t.reading * 1.3 + (lines - 1) * t.gap * .4);
  }
  const words = show.words ? content.words ?? [] : [];
  if (words.length) {
    parts.push(t.section + t.title);
    const cols = kanjiCardColumns(words.length);
    const room = kanjiCardTileRoom(width, words.length, t);
    const most = (f: (w: KanjiCardWord) => number) => Math.max(...words.map(f));
    // The words shrink to fit their tiles, so each takes one line.
    const glossLines = most(w => linesOf(textEm(w.romaji, "body") * t.gloss, room)) + most(w => linesOf(textEm(w.meaning, "body") * t.gloss, room));
    const tile = t.tilePad[0] + t.ruby * 1.2 + kanjiCardWordSize(words, room, t) * 1.08 + t.gap * .35 + glossLines * t.gloss * 1.25 + t.tilePad[1];
    const rows = Math.ceil(words.length / cols);
    parts.push(rows * tile + (rows - 1) * t.gap * .7);
  }
  return Math.ceil(parts.reduce((a, b) => a + b, 0) + t.gap * Math.max(0, parts.length - 1));
}

/** The text sizes for a layout and density. */
export function kanjiCardType(layout: KanjiCardLayout, density: KanjiCardDensity = "regular"): KanjiCardType {
  return layout === "portrait" ? KANJI_CARD_TYPES[density === "compact" ? "portrait-compact" : "portrait"] : KANJI_CARD_TYPES.landscape;
}

export interface KanjiCardRect { x: number; y: number; width: number; height: number }

export interface KanjiCardGeometry {
  width: number; height: number;
  /** The sheet of paper, design px: the whole 9:16 frame, or the left panel of the 16:9 frame. */
  paper: KanjiCardRect;
  /**
   * The reading card, design px, or null. In 9:16 it lies on the paper with a margin all around
   * and ends above the bottom safe band, so the band is plain paper; in 16:9 it is the right panel.
   */
  card: KanjiCardRect | null;
  /** Corner radius of the card, design px (0 for a panel that runs to the frame edges). */
  cardRadius: number;
  /** Where the ink of the character fits, design px: inside the safe bands and under the label. */
  writing: KanjiCardRect;
  /** Space kept between the ink and the edges of `writing`, design px. */
  inkMargin: number;
  /** The practice box printed around the writing, design px, or null for the sheet's own box. */
  cell: KanjiCardRect | null;
  /** Where the stroke-order numbers may go, design px: the paper around the writing, inside the safe bands. */
  guides: KanjiCardRect;
  /** Padding of the card text, design px: top, right, bottom, left. */
  cardPad: readonly [number, number, number, number];
  /** Largest em size of the character, design px. */
  em: number;
  label: { x: number; y: number };
  type: KanjiCardType;
  density: KanjiCardDensity;
}

const NO_INSET: KanjiCardSafeInset = { left: 0, right: 0, top: 0, bottom: 0 };

/** Margin between the 9:16 card or practice box and the frame edges, design px. */
export const KANJI_CARD_MARGIN = 24;

/** Largest share of the frame that two opposite bands may cover together, so the writing panel keeps room. */
export const KANJI_CARD_MAX_BANDS = .45;

/**
 * The safe bands, each limited to 0..0.4 of the frame (a value that is not a number counts as 0).
 * Opposite bands together cover at most 0.45 of the frame; larger pairs shrink in proportion.
 */
export function kanjiCardSafeInset(inset: Partial<KanjiCardSafeInset> | undefined): KanjiCardSafeInset {
  const band = (v: number | undefined) => typeof v === "number" && Number.isFinite(v) ? Math.min(.4, Math.max(0, v)) : 0;
  const pair = (a: number, b: number) => { const k = a + b > KANJI_CARD_MAX_BANDS ? KANJI_CARD_MAX_BANDS / (a + b) : 1; return [a * k, b * k]; };
  const [left, right] = pair(band(inset?.left), band(inset?.right));
  const [top, bottom] = pair(band(inset?.top), band(inset?.bottom));
  return { left, right, top, bottom };
}

/**
 * Layout of the frame in design px. With safe bands, the label, the ink and the card text move
 * inside them.
 * - 9:16: the paper fills the frame. The reading card lies on it with `KANJI_CARD_MARGIN` at the
 *   sides and ends above the bottom band (or the margin), so a band is plain paper. The practice
 *   box spans the paper between the label and the card (`type.cardGap` above the card), and the
 *   character is centred in it, `type.inkPad` from its top and bottom, clear of the wider side band.
 * - 16:9: the paper is the left panel and the card the right one.
 */
export function kanjiCardGeometry(
  layout: KanjiCardLayout, withCard: boolean, bands: Partial<KanjiCardSafeInset> = NO_INSET, withLabel = true, density: KanjiCardDensity = "regular",
  text?: { content: KanjiCardContent; sections?: Partial<Record<KanjiCardSection, boolean>> },
): KanjiCardGeometry {
  const inset = kanjiCardSafeInset(bands);
  const portrait = layout === "portrait", type = kanjiCardType(layout, density);
  const used: KanjiCardDensity = portrait ? density : "regular";
  const width = portrait ? 720 : 1280, height = portrait ? 1280 : 720;
  const L = inset.left * width, R = inset.right * width, T = inset.top * height, B = inset.bottom * height;
  const [padY, padX] = type.pad;
  const banded = L > 0 || R > 0 || T > 0 || B > 0;
  if (portrait) {
    const M = KANJI_CARD_MARGIN;
    // The card text starts where the label does: past the margin and its padding, and past the band.
    const label = { x: Math.max(M + padX, L), y: Math.max(32, T) };
    const cardPad = [padY, Math.max(padX, R - M), padY, Math.max(padX, L - M)] as const;
    // Nothing is drawn below the bottom band or the margin: it is plain paper.
    const floor = height - Math.max(B, M);
    // The compact card reserves the height its own text needs (see kanjiCardTextHeight); the others a fixed height.
    const textHeight = density === "compact" && text ? Math.min(type.text * 1.6, kanjiCardTextHeight(text.content, text.sections, width - 2 * M - cardPad[1] - cardPad[3], type)) : type.text;
    const cardTop = floor - cardPad[0] - textHeight - cardPad[2];
    const top = withLabel ? label.y + type.label * 1.5 : Math.max(T, M);
    const bottom = withCard ? cardTop - type.cardGap : floor;
    const side = Math.max(L, R, M);
    // The air above and below the character gives way first when the box is short.
    const pad = Math.min(type.inkPad, (bottom - top) * .06);
    const writing = { x: side, y: top + pad, width: width - 2 * side, height: bottom - top - 2 * pad };
    return {
      width, height, paper: { x: 0, y: 0, width, height }, cardPad, density: used,
      card: withCard ? { x: M, y: cardTop, width: width - 2 * M, height: floor - cardTop } : null,
      cardRadius: withCard ? 18 : 0,
      cell: { x: M, y: top, width: width - 2 * M, height: bottom - top },
      writing, inkMargin: Math.min(16, Math.min(writing.width, writing.height) * .045),
      guides: { x: Math.max(L, M), y: top, width: width - Math.max(L, M) - Math.max(R, M), height: bottom - top },
      em: 900, label, type,
    };
  }
  const label = { x: Math.max(44, L), y: Math.max(36, T) };
  const split = withCard ? 880 : width;
  const paper = { x: 0, y: 0, width: split, height };
  const cardPad = [Math.max(padY, T), Math.max(padX, R), Math.max(padY, B), padX] as const;
  const top = banded ? (withLabel ? label.y + type.label * 1.5 : T) : 0;
  const writing = banded ? { x: L, y: top, width: (withCard ? split : width - R) - L, height: height - B - top } : paper;
  return {
    width, height, paper, cardPad, density: used, cardRadius: 0, cell: null, writing, guides: writing,
    card: withCard ? { x: split, y: 0, width: width - split, height } : null,
    inkMargin: Math.min(writing.width, writing.height) * .045,
    em: 540, label, type,
  };
}

/** Default hand speed of the card when no write time is set. */
export const KANJI_CARD_SPEED = 1.6;

/** Union of the contact bounds of every stroke, design px. */
export function kanjiInkBox(plan: Pick<ShodoPlan, "strokes">): [number, number, number, number] {
  return plan.strokes.reduce<[number, number, number, number]>((a, s) =>
    [Math.min(a[0], s.bounds[0]), Math.min(a[1], s.bounds[1]), Math.max(a[2], s.bounds[2]), Math.max(a[3], s.bounds[3])],
  [Infinity, Infinity, -Infinity, -Infinity]);
}

/**
 * Where the brush rests before and after a pass and where it dips for an ink change, design px:
 * just outside the frame, on the side away from the reading card (right of a 9:16 frame, below a
 * 16:9 one). So the brush comes in from outside, leaves the frame after the last stroke and never
 * crosses the card for ink. Far enough out that no part of the brush or its shadow shows, at the
 * rest height or down at the inkstone (see `shodoBrushClearance`).
 */
export function kanjiCardBrushStations(g: KanjiCardGeometry, style: ShodoStyle, size: number): { rest: [number, number]; inkstone: [number, number] } {
  const D = style.brush.diameter * style.hand.width * size / 1000;
  const lean = shodoRestLean(style), heights = [0, size * SHODO_REST_HEIGHT] as const;
  const w = g.writing;
  if (g.height > g.width) {
    const x = g.width + shodoBrushClearance([1, 0], lean, heights, style.brush, D);
    return { rest: [x, w.y + w.height * .7], inkstone: [x, w.y + w.height * .35] };
  }
  const y = g.height + shodoBrushClearance([0, 1], lean, heights, style.brush, D);
  return { rest: [w.x + w.width * .7, y], inkstone: [w.x + w.width * .35, y] };
}

/**
 * Plans the writing with the ink centred in the writing box. The character is made smaller
 * only when its ink would reach the label band or the edge of the box. With `seconds`, the
 * hand's speed is fitted so that the writing takes about that long. The brush comes in from
 * outside the frame at once and leaves it after the last stroke (`kanjiCardBrushStations`).
 */
export function planKanjiCardWriting(
  glyph: ShodoGlyph, g: KanjiCardGeometry,
  options: { vermilion?: readonly number[]; withLabel?: boolean; seconds?: number; ink?: KanjiCardInk; speed?: number; brushStyle?: DeepPartial<ShodoStyle> } = {},
): ShodoPlan {
  const { vermilion = [], withLabel = true, seconds: target, ink = "sumi", brushStyle = {} } = options;
  const natural = Number.isFinite(options.speed) ? Math.min(4, Math.max(.25, options.speed as number)) : KANJI_CARD_SPEED;
  const strokeInk = Object.fromEntries(vermilion.map(n => [n - 1, SHODO_INKS.shuboku]));
  // The host's brush, ink, paper and hand; the card sets the hand's speed, and "vermilion" sets the ink.
  const inkStyle = ink === "vermilion" ? { ...brushStyle.ink, ...SHODO_INKS.shuboku } : brushStyle.ink;
  const at = (speed: number, x: number, y: number, size: number) => {
    const style = resolveShodoStyle({ ...brushStyle, hand: { ...brushStyle.hand, speed }, ink: inkStyle }, DEFAULT_SHODO_STYLE);
    // No lead: a brush outside the frame has nothing to show before it moves in.
    return planShodoWriting({ style, items: [{ glyph, x, y, size, strokeInk }], ...kanjiCardBrushStations(g, style, size), exit: "rest", lead: 0 });
  };
  const [x0, y0, x1, y1] = kanjiInkBox(at(natural, 0, 0, g.em));
  const box = g.writing;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const margin = g.inkMargin;
  const top = Math.max(box.y + margin, withLabel ? g.label.y + g.type.label * 1.5 : -Infinity);
  const k = Math.min(1,
    (box.width / 2 - margin) / ((x1 - x0) / 2),
    (cy - top) / ((y1 - y0) / 2),
    (box.y + box.height - margin - cy) / ((y1 - y0) / 2));
  const size = g.em * k, x = cx - k * (x0 + x1) / 2, y = cy - k * (y0 + y1) / 2;
  if (!target || !(target > 0)) return at(natural, x, y, size);
  // The writing takes less time at a higher speed: bisect the speed on a log scale.
  let lo = Math.log(.25), hi = Math.log(4);
  if (at(4, x, y, size).duration >= target) return at(4, x, y, size);
  if (at(.25, x, y, size).duration <= target) return at(.25, x, y, size);
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (at(Math.exp(mid), x, y, size).duration > target) lo = mid; else hi = mid;
  }
  return at(Math.exp((lo + hi) / 2), x, y, size);
}

/** Which parts show: every part unless its section is `false` (a missing or undefined section shows). */
export function kanjiCardSections(sections: Partial<Record<KanjiCardSection, boolean>> | undefined): Record<KanjiCardSection, boolean> {
  return {
    label: sections?.label !== false, meanings: sections?.meanings !== false, readings: sections?.readings !== false,
    jlpt: sections?.jlpt !== false, words: sections?.words !== false,
  };
}

/** True when the card shows any text: the reading card exists only then. */
export function kanjiCardHasCard(content: KanjiCardContent, sections: Partial<Record<KanjiCardSection, boolean>> = {}): boolean {
  const show = kanjiCardSections(sections);
  return !!(show.meanings && content.meanings || show.readings && (content.onyomi || content.kunyomi)
    || show.jlpt && content.jlpt || show.words && content.words?.length);
}

/** The seconds that the hand's pace is fitted to: the first writing that has a set length. */
export function kanjiCardPace(timing: KanjiCardTiming | undefined): number | undefined {
  return timing?.write ? timing.write : timing?.write === 0 && timing.review ? timing.review : undefined;
}

export interface KanjiCardWritingOptions {
  layout?: KanjiCardLayout;
  density?: KanjiCardDensity;
  safeInset?: Partial<KanjiCardSafeInset>;
  /** The card's text: the reading card shows only when some of it shows (see `kanjiCardHasCard`). Its `vermilionStrokes` count too. */
  content?: KanjiCardContent;
  /** Parts to show, as on the card. `label: false` hides the label. */
  sections?: Partial<Record<KanjiCardSection, boolean>>;
  /** Brush, ink, paper and hand settings over the default style; the card sets the hand's speed. */
  brushStyle?: DeepPartial<ShodoStyle>;
  timing?: KanjiCardTiming;
  ink?: KanjiCardInk;
  speed?: number;
  vermilionStrokes?: readonly number[];
}

/**
 * Everything the card plans for one character: the layout, the brush plan, the phases and the
 * stroke times. Given the same glyph and the same layout, density, bands, content, sections,
 * timing, ink, speed and vermilion strokes as `ShodoKanjiCard`, it is exactly what the card draws,
 * so a host can time a voice-over to the strokes before it renders anything.
 */
export function kanjiCardWriting(glyph: ShodoGlyph, options: KanjiCardWritingOptions = {}) {
  // Untyped callers could still pass the options this function had before; they would be ignored silently.
  for (const old of ["withCard", "withLabel"]) if (old in options) throw new TypeError(`kanjiCardWriting: "${old}" is no longer an option; pass the card's content and sections.`);
  const withLabel = kanjiCardSections(options.sections).label;
  const withCard = kanjiCardHasCard(options.content ?? {}, options.sections);
  const vermilionStrokes = options.vermilionStrokes ?? options.content?.vermilionStrokes;
  const geometry = kanjiCardGeometry(options.layout ?? "landscape", withCard, options.safeInset, withLabel, options.density ?? "regular",
    { content: options.content ?? {}, sections: options.sections });
  const plan = planKanjiCardWriting(glyph, geometry, {
    vermilion: vermilionStrokes, withLabel, seconds: kanjiCardPace(options.timing), ink: options.ink, speed: options.speed, brushStyle: options.brushStyle,
  });
  const timeline = kanjiCardTimeline(plan.duration, options.timing);
  return { geometry, plan, timeline, strokes: kanjiCardStrokeTimes(plan, timeline), inkBox: kanjiInkBox(plan) };
}

/** What the typed intro shows at one moment. */
export interface KanjiCardTypedState {
  /** The text on screen: part of the reading while it is composed, then the character. */
  text: string;
  /** True while the text is the reading being composed (drawn underlined). */
  composing: boolean;
  /** 0..1 strength of the conversion highlight behind the character. */
  converted: number;
  /** 0..1 growth from the reading's size to the character's size. */
  grow: number;
  /** Size of the typed character relative to its full size: a slow push-in while it holds, and a small bump on emphasis. */
  scale: number;
  /** Whether the caret shows. */
  caret: boolean;
  /** 0..1 opacity of the whole typed text. */
  opacity: number;
}

/** Default seconds per typed kana, and the pause between the last kana and the conversion. */
export const KANJI_TYPE_STEP = .16;
export const KANJI_TYPE_SETTLE = .12;
const typeStepOf = (step: number | undefined) => step !== undefined && Number.isFinite(step) ? Math.min(.6, Math.max(.05, step)) : KANJI_TYPE_STEP;

/**
 * The `intro.convertAt` that starts the typing at `startAt` seconds: the reading's kana at
 * `typeStep` each, then the short pause before the conversion. For a host that wants the typed
 * character on screen as soon as possible.
 */
export function kanjiCardConvertAt(readingLength: number, { startAt = .15, typeStep }: { startAt?: number; typeStep?: number } = {}): number {
  return Math.round((startAt + KANJI_TYPE_SETTLE + Math.max(0, readingLength) * typeStepOf(typeStep)) * 1000) / 1000;
}
const CONVERT_GLOW = .5, GROW = .22, FADE_OUT = .35, PUSH_FROM = .93;

/**
 * The typed intro at `time` seconds from the start of the intro phase (it may run past the
 * intro: the typed character fades out during the first 0.35 s of the writing). Pure.
 * - A caret blinks until the typing starts.
 * - The reading is typed one kana every 0.16 s so that it is complete just before `convertAt`.
 * - At `convertAt` the reading turns into the character, which grows to its full size and holds.
 */
export function kanjiCardTypedAt(
  char: string, intro: KanjiCardIntro | undefined, introLength: number, time: number, options: { reducedMotion?: boolean } = {},
): KanjiCardTypedState {
  const none: KanjiCardTypedState = { text: "", composing: false, converted: 0, grow: 1, scale: 1, caret: false, opacity: 0 };
  if (!(introLength > 0) || time < 0 || time > introLength + FADE_OUT) return none;
  const kana = [...(intro?.reading ?? "").trim()];
  const step = typeStepOf(intro?.typeStep);
  // The conversion finishes inside the intro, so the character never first appears over the brush.
  const latest = Math.max(0, introLength - GROW - .1);
  const convertAt = Math.min(latest, Math.max(0, intro?.convertAt !== undefined && Number.isFinite(intro.convertAt) ? intro.convertAt : introLength * .6));
  if (options.reducedMotion) {
    // Reduced motion: the same words at the same times, without typing, caret, growth, push-in or bump.
    // The reading shows until the conversion; the highlights only fade.
    const opacity = time <= introLength ? 1 : 1 - smoothstep((time - introLength) / FADE_OUT);
    // Before the conversion: the reading, or nothing when there is none (full motion shows only a caret then).
    if (time < convertAt) return kana.length ? { ...none, text: kana.join(""), composing: true, opacity } : none;
    const e = intro?.emphasizeAt !== undefined && Number.isFinite(intro.emphasizeAt) ? time - intro.emphasizeAt : -1;
    const emphasis = e < 0 ? 0 : e < .1 ? smoothstep(e / .1) : 1 - smoothstep((e - .1) / .5);
    return { ...none, text: char, opacity, converted: emphasis * .8 };
  }
  const typeStart = Math.max(0, convertAt - KANJI_TYPE_SETTLE - kana.length * step);
  const opacity = time <= introLength ? 1 : 1 - smoothstep((time - introLength) / FADE_OUT);
  // The caret blinks twice a second; it stays on while text is being typed.
  const blink = Math.floor(time * 2) % 2 === 0;
  if (time < convertAt) {
    const typed = Math.min(kana.length, Math.floor((time - typeStart) / step) + 1);
    if (time < typeStart || typed <= 0) return { ...none, caret: blink, opacity };
    return { text: kana.slice(0, typed).join(""), composing: true, converted: 0, grow: 0, scale: PUSH_FROM, caret: true, opacity };
  }
  const since = time - convertAt;
  // While it holds, the character moves slowly toward the viewer (a push-in), so the picture never stands still.
  const hold = Math.max(GROW, introLength - convertAt);
  const push = PUSH_FROM + (1 - PUSH_FROM) * smoothstep((since - GROW) / (hold - GROW || 1));
  // Emphasis: a highlight that rises in 0.1 s and fades over 0.5 s, with a 4 % bump.
  const e = intro?.emphasizeAt !== undefined && Number.isFinite(intro.emphasizeAt) ? time - intro.emphasizeAt : -1;
  const emphasis = e < 0 ? 0 : e < .1 ? smoothstep(e / .1) : 1 - smoothstep((e - .1) / .5);
  return {
    text: char, composing: false, opacity,
    // The conversion highlight is strongest while the character is small, and gone soon after it has grown.
    converted: Math.max(1 - smoothstep(since / CONVERT_GLOW), emphasis * .8),
    grow: kana.length ? smoothstep(since / GROW) : 1,
    scale: push * (1 + .04 * emphasis),
    caret: since < .4,
  };
}
