/**
 * Kanji study card (SHO1): pure planning. Layout, phases, the brush plan with its stroke times,
 * the typed intro and the word highlights. No React and no DOM, so a production tool can plan in
 * Node exactly the video that `ShodoKanjiCard` draws in the browser.
 */
import type { ShodoGlyph } from "./shodo-glyphs";
import { planShodoWriting } from "./shodo-hand";
import type { ShodoPlan } from "./shodo-hand";
import { DEFAULT_SHODO_STYLE, SHODO_INKS, resolveShodoStyle } from "./shodo-style";

/** Frame rate of the card's video clock. */
export const KANJI_CARD_FPS = 30;

export interface KanjiCardWord { word: string; ruby: string; romaji: string; meaning: string }
/** JLPT level, from N5 (easiest) to N1. */
export type JlptLevel = "N5" | "N4" | "N3" | "N2" | "N1";
export const KANJI_CARD_JLPT_LEVELS: readonly JlptLevel[] = ["N5", "N4", "N3", "N2", "N1"];
export type KanjiCardLayout = "landscape" | "portrait";
/** "compact" gives the 9:16 card a shorter reading card and a taller writing panel. Landscape has one size. */
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

/** Text sizes of the card, design px. */
export interface KanjiCardType {
  label: number; pad: readonly [number, number]; gap: number; head: number; headKanji: number;
  reading: number; badge: number; title: number; word: number; ruby: number; gloss: number;
  /** Smallest text size of the stroke-order numbers, design px (they are 0.42 of the brush diameter, at least this). */
  number: number;
  /** Height reserved for the text of the 9:16 card, design px (padding not included). */
  text: number;
}

// Text sizes in design px. Portrait sizes keep body text at 13 px or more on a 390 px wide phone
// (24 design px of the 720 px wide frame); stroke numbers of at least 28 design px are 15 px tall.
const KANJI_CARD_TYPES: Record<"landscape" | "portrait" | "portrait-compact", KanjiCardType> = {
  landscape: { label: 33, pad: [40, 34], gap: 22, head: 31, headKanji: 38, reading: 19, badge: 16, title: 24, word: 46, ruby: 16, gloss: 20, number: 0, text: 640 },
  portrait: { label: 42, pad: [34, 36], gap: 26, head: 38, headKanji: 48, reading: 26, badge: 23, title: 26, word: 58, ruby: 22, gloss: 25, number: 28, text: 462 },
  "portrait-compact": { label: 34, pad: [24, 36], gap: 15, head: 34, headKanji: 42, reading: 24, badge: 21, title: 22, word: 50, ruby: 20, gloss: 24, number: 28, text: 350 },
};

/** The text sizes for a layout and density. */
export function kanjiCardType(layout: KanjiCardLayout, density: KanjiCardDensity = "regular"): KanjiCardType {
  return layout === "portrait" ? KANJI_CARD_TYPES[density === "compact" ? "portrait-compact" : "portrait"] : KANJI_CARD_TYPES.landscape;
}

export interface KanjiCardGeometry {
  width: number; height: number;
  /** The writing panel (the sheet) and the info card, design px. */
  paper: { x: number; y: number; width: number; height: number };
  card: { x: number; y: number; width: number; height: number } | null;
  /** Where the ink of the character fits, design px: the paper, inside the safe bands and under the label. */
  writing: { x: number; y: number; width: number; height: number };
  /** Padding of the card text, design px: top, right, bottom, left. */
  cardPad: readonly [number, number, number, number];
  /**
   * The 9:16 card's bottom safe band, design px, or null. The card ends above it and the band
   * shows the dark felt underlay (下敷き), where a platform's white caption text stays readable.
   */
  band: { x: number; y: number; width: number; height: number } | null;
  /** Largest em size of the character, design px. */
  em: number;
  label: { x: number; y: number };
  type: KanjiCardType;
  density: KanjiCardDensity;
}

const NO_INSET: KanjiCardSafeInset = { left: 0, right: 0, top: 0, bottom: 0 };

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
 * inside them; the 9:16 card keeps the height of its text, so the paper above it gets shorter.
 * The compact 9:16 card is shorter, so the paper is taller.
 */
export function kanjiCardGeometry(
  layout: KanjiCardLayout, withCard: boolean, bands: Partial<KanjiCardSafeInset> = NO_INSET, withLabel = true, density: KanjiCardDensity = "regular",
): KanjiCardGeometry {
  const inset = kanjiCardSafeInset(bands);
  const portrait = layout === "portrait", type = kanjiCardType(layout, density);
  const used: KanjiCardDensity = portrait ? density : "regular";
  const width = portrait ? 720 : 1280, height = portrait ? 1280 : 720;
  const L = inset.left * width, R = inset.right * width, T = inset.top * height, B = inset.bottom * height;
  const [padY, padX] = type.pad;
  const label = portrait ? { x: Math.max(36, L), y: Math.max(32, T) } : { x: Math.max(44, L), y: Math.max(36, T) };
  const banded = L > 0 || R > 0 || T > 0 || B > 0;
  if (portrait) {
    // With a bottom band the card ends above it, so its text needs no extra padding there.
    const cardPad = [padY, Math.max(padX, R), padY, Math.max(padX, L)] as const;
    const bottom = height - B;
    const split = withCard ? bottom - cardPad[2] - type.text - cardPad[0] : bottom;
    const paper = { x: 0, y: 0, width, height: withCard || B > 0 ? split : height };
    const top = banded ? (withLabel ? label.y + type.label * 1.5 : T) : 0;
    return {
      width, height, paper, cardPad, density: used,
      card: withCard ? { x: 0, y: split, width, height: bottom - split } : null,
      band: B > 0 ? { x: 0, y: bottom, width, height: B } : null,
      writing: banded ? { x: L, y: top, width: width - L - R, height: split - top } : paper,
      em: 600, label, type,
    };
  }
  const split = withCard ? 880 : width;
  const paper = { x: 0, y: 0, width: split, height };
  const cardPad = [Math.max(padY, T), Math.max(padX, R), Math.max(padY, B), padX] as const;
  const top = banded ? (withLabel ? label.y + type.label * 1.5 : T) : 0;
  return {
    width, height, paper, cardPad, density: used, band: null,
    card: withCard ? { x: split, y: 0, width: width - split, height } : null,
    writing: banded ? { x: L, y: top, width: (withCard ? split : width - R) - L, height: height - B - top } : paper,
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
 * Plans the writing with the ink centred in the writing box. The character is made smaller
 * only when its ink would reach the label band or the edge of the box. With `seconds`, the
 * hand's speed is fitted so that the writing takes about that long.
 */
export function planKanjiCardWriting(
  glyph: ShodoGlyph, g: KanjiCardGeometry,
  options: { vermilion?: readonly number[]; withLabel?: boolean; seconds?: number; ink?: KanjiCardInk; speed?: number } = {},
): ShodoPlan {
  const { vermilion = [], withLabel = true, seconds: target, ink = "sumi" } = options;
  const natural = Number.isFinite(options.speed) ? Math.min(4, Math.max(.25, options.speed as number)) : KANJI_CARD_SPEED;
  const strokeInk = Object.fromEntries(vermilion.map(n => [n - 1, SHODO_INKS.shuboku]));
  const rest: [number, number] = [g.paper.x + g.paper.width - 90, g.paper.y + g.paper.height * .83];
  const inkstone: [number, number] = [g.width + 80, g.height / 2];
  const body = ink === "vermilion" ? { ...SHODO_INKS.shuboku } : undefined;
  const at = (speed: number, x: number, y: number, size: number) => planShodoWriting({
    style: resolveShodoStyle({ hand: { speed }, ink: body }, DEFAULT_SHODO_STYLE),
    items: [{ glyph, x, y, size, strokeInk }], rest, inkstone, exit: "hover",
  });
  const [x0, y0, x1, y1] = kanjiInkBox(at(natural, 0, 0, g.em));
  const box = g.writing;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const margin = Math.min(box.width, box.height) * .045;
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

/** True when the card shows any text: the reading card exists only then. */
export function kanjiCardHasCard(content: KanjiCardContent, sections: Partial<Record<KanjiCardSection, boolean>> = {}): boolean {
  const show = { meanings: true, readings: true, jlpt: true, words: true, ...sections };
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
  /** The card's text: the reading card shows only when some of it shows (see `kanjiCardHasCard`). */
  content?: KanjiCardContent;
  /** Parts to show, as on the card. `label: false` hides the label. */
  sections?: Partial<Record<KanjiCardSection, boolean>>;
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
  const withLabel = options.sections?.label !== false;
  const withCard = kanjiCardHasCard({ ...options.content, vermilionStrokes: undefined }, options.sections);
  const geometry = kanjiCardGeometry(options.layout ?? "landscape", withCard, options.safeInset, withLabel, options.density ?? "regular");
  const plan = planKanjiCardWriting(glyph, geometry, {
    vermilion: options.vermilionStrokes, withLabel, seconds: kanjiCardPace(options.timing), ink: options.ink, speed: options.speed,
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

/** Seconds per typed kana, and how long the conversion highlight and the fade out take. */
export const KANJI_TYPE_STEP = .16;
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
  // The conversion finishes inside the intro, so the character never first appears over the brush.
  const latest = Math.max(0, introLength - GROW - .1);
  const convertAt = Math.min(latest, Math.max(0, intro?.convertAt !== undefined && Number.isFinite(intro.convertAt) ? intro.convertAt : introLength * .6));
  if (options.reducedMotion) {
    // Reduced motion: the same words at the same times, without typing, caret, growth, push-in or bump.
    // The reading shows until the conversion; the highlights only fade.
    const opacity = time <= introLength ? 1 : 1 - smoothstep((time - introLength) / FADE_OUT);
    if (time < convertAt && kana.length) return { ...none, text: kana.join(""), composing: true, opacity };
    const e = intro?.emphasizeAt !== undefined && Number.isFinite(intro.emphasizeAt) ? time - intro.emphasizeAt : -1;
    const emphasis = e < 0 ? 0 : e < .1 ? smoothstep(e / .1) : 1 - smoothstep((e - .1) / .5);
    return { ...none, text: char, opacity, converted: emphasis * .8 };
  }
  const typeStart = Math.max(0, convertAt - .12 - kana.length * KANJI_TYPE_STEP);
  const opacity = time <= introLength ? 1 : 1 - smoothstep((time - introLength) / FADE_OUT);
  // The caret blinks twice a second; it stays on while text is being typed.
  const blink = Math.floor(time * 2) % 2 === 0;
  if (time < convertAt) {
    const typed = Math.min(kana.length, Math.floor((time - typeStart) / KANJI_TYPE_STEP) + 1);
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
