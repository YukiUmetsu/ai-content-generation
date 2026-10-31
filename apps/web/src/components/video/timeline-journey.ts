/**
 * TJ1: pure, clock-free helpers for the `timeline-journey` scene.
 *
 * Dates: historical years (negative = BCE, no year 0) on the proleptic Gregorian
 * calendar, formatted only through Intl so every locale, era and numbering system
 * comes from the platform. Schedule: every event's transition, arrival and copy
 * cues as absolute frames. Rail: proportional ("elapsed") or even positions.
 * Nothing here reads a clock or the DOM.
 */
import type { SceneTemplateSpec, TimelineDate, TimelineJourneyEvent, TimelineTransition } from "./scene-templates";

export type TimelineDatePrecision = "year" | "month" | "day";
export interface ResolvedTimelineDate {
  /** Historical year: 1 CE is 1, 1 BCE is -1. */
  year: number; month?: number; day?: number;
  precision: TimelineDatePrecision;
  /** Astronomical decimal year (1 BCE = 0), used for proportional spacing and ordering. */
  t: number;
}
const ISO = /^([+-]?\d{4,6})(?:-(\d{2})(?:-(\d{2}))?)?(?:[T ].*)?$/;
const astro = (year: number) => year < 0 ? year + 1 : year;
const daysIn = (astroYear: number, month: number) => {
  const d = new Date(Date.UTC(2000, 0, 1)); d.setUTCFullYear(astroYear, month, 0); return d.getUTCDate();
};
/** A UTC Date at the start of a historical day; safe for years 0–99 and BCE. */
export function timelineDateValue(year: number, month = 1, day = 1): Date {
  const d = new Date(Date.UTC(2000, 0, 1)); d.setUTCFullYear(astro(year), month - 1, day); return d;
}
function build(year: number, month?: number, day?: number): ResolvedTimelineDate | undefined {
  if (!Number.isSafeInteger(year) || year === 0 || Math.abs(year) > 270000) return undefined;
  if (month !== undefined && !(Number.isInteger(month) && month >= 1 && month <= 12)) return undefined;
  if (day !== undefined && (month === undefined || !(Number.isInteger(day) && day >= 1 && day <= daysIn(astro(year), month)))) return undefined;
  const a = astro(year), length = daysIn(a, 2) === 29 ? 366 : 365;
  const dayOfYear = month === undefined ? 0 : (timelineDateValue(year, month, day ?? 1).getTime() - timelineDateValue(year, 1, 1).getTime()) / 864e5;
  return { year, month, day, precision: day !== undefined ? "day" : month !== undefined ? "month" : "year", t: a + dayOfYear / length };
}
/**
 * Resolves an event's date. `when` (historical year, optional month and day) wins over `date`.
 * `date` is ISO 8601 ("1903", "1903-12", "1903-12-17", expanded "-000499"); its precision is
 * the number of fields given. ISO years are astronomical, so "-0499" is 500 BCE.
 */
export function resolveTimelineDate(event: { date?: string; when?: TimelineDate }): ResolvedTimelineDate | undefined {
  if (event.when) return build(event.when.year, event.when.month, event.when.day);
  if (typeof event.date !== "string") return undefined;
  const m = ISO.exec(event.date.trim());
  if (m) {
    const y = Number(m[1]);
    return build(y <= 0 ? y - 1 : y, m[2] ? Number(m[2]) : undefined, m[3] ? Number(m[3]) : undefined);
  }
  // Legacy free-form dates that Date.parse accepts keep working, at day precision.
  const ms = Date.parse(event.date);
  if (Number.isNaN(ms)) return undefined;
  const d = new Date(ms);
  return build(d.getFullYear() <= 0 ? d.getFullYear() - 1 : d.getFullYear(), d.getMonth() + 1, d.getDate());
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function dtf(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = locale + JSON.stringify(options);
  let f = fmtCache.get(key);
  if (!f) { f = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }); fmtCache.set(key, f); }
  return f;
}
export type DateFormatPreference = "auto" | TimelineDatePrecision;
const rank = { year: 0, month: 1, day: 2 } as const;
/** Long-form date line, never more precise than the data. */
export function formatTimelineDate(date: ResolvedTimelineDate, locale: string, preference: DateFormatPreference = "auto"): string {
  const p = preference === "auto" || rank[preference] > rank[date.precision] ? date.precision : preference;
  return dtf(locale, { year: "numeric", month: p === "year" ? undefined : "long", day: p === "day" ? "numeric" : undefined,
    era: date.year < 0 ? "short" : undefined }).format(timelineDateValue(date.year, date.month ?? 1, date.day ?? 1));
}
export type ReadoutPart = { type: "digits" | "text"; value: string };
/** The year as locale parts; the year number is a "digits" part so it can roll. */
export function yearParts(year: number, locale: string, era = year < 0): ReadoutPart[] {
  return dtf(locale, { year: "numeric", era: era ? "short" : undefined }).formatToParts(timelineDateValue(year))
    .map(p => ({ type: p.type === "year" ? "digits" : "text", value: p.value }));
}
/** Period range, e.g. "1903 – 1981" or "1903年～1981年". */
export function formatTimelineRange(first: ResolvedTimelineDate, last: ResolvedTimelineDate, locale: string): string {
  const era = first.year < 0 || last.year < 0;
  // formatRange is ES2021 (the project's lib is ES2020); every supported runtime ships it.
  const f = dtf(locale, { year: "numeric", era: era ? "short" : undefined }) as Intl.DateTimeFormat & { formatRange?: (a: Date, b: Date) => string };
  const a = timelineDateValue(first.year), b = timelineDateValue(last.year);
  return f.formatRange ? f.formatRange(a, b) : `${f.format(a)} – ${f.format(b)}`;
}
/** Whole calendar years elapsed between two dates (precision-aware). */
export function elapsedYears(a: ResolvedTimelineDate, b: ResolvedTimelineDate): number {
  let years = astro(b.year) - astro(a.year);
  const am = a.month ?? 1, ad = a.day ?? 1, bm = b.month ?? 1, bd = b.day ?? 1;
  if (a.month !== undefined && b.month !== undefined && (bm < am || (bm === am && b.day !== undefined && a.day !== undefined && bd < ad))) years--;
  return Math.max(0, years);
}
/** "77 years" as parts; the integer is a "digits" part. */
export function spanParts(years: number, locale: string): ReadoutPart[] {
  return new Intl.NumberFormat(locale, { style: "unit", unit: "year", unitDisplay: "long", useGrouping: false }).formatToParts(years)
    .map(p => ({ type: p.type === "integer" ? "digits" : "text", value: p.value }));
}
/** The locale's ten digit glyphs, so the odometer rolls Arabic-Indic or other decimal digits too. */
export function digitGlyphs(locale: string): string[] {
  const f = new Intl.NumberFormat(locale, { useGrouping: false });
  return Array.from({ length: 10 }, (_, i) => f.format(i));
}
/**
 * Mechanical odometer positions for a non-negative value, one per column, most significant first.
 * Column k shows floor(value / 10^k) mod 10 and rolls to the next digit only while every lower
 * column passes 9 → 0, so higher digits never drift. Positions are in digit steps (9.5 = halfway 9→0).
 */
export function odometerColumns(value: number, columns: number): number[] {
  const v = Math.max(0, value);
  return Array.from({ length: columns }, (_, i) => {
    const k = columns - 1 - i, unit = Math.pow(10, k);
    if (k === 0) return v % 10;
    const below = v % unit, carry = Math.max(0, Math.min(1, below - (unit - 1)));
    return (Math.floor(v / unit) % 10) + carry;
  });
}

/** Estimated advance of text in em: CJK is full width, Latin about .52em, spaces .28em. */
const cjk = /[⺀-鿿가-힯豈-﫿＀-￯]/;
export function textWidthEm(text: string): number {
  let w = 0;
  for (const ch of text) w += cjk.test(ch) ? 1 : ch === " " ? .28 : /[A-Z0-9]/.test(ch) ? .64 : /[iljt.,'’:;|!]/.test(ch) ? .3 : .52;
  return w;
}
/** Longest unbreakable run: CJK characters break anywhere, Latin words do not. */
export function longestWordEm(text: string): number {
  return Math.max(0, ...text.split(/\s+/).map(word => cjk.test(word) ? 1.6 : textWidthEm(word)));
}
/**
 * Type size (px) that keeps text within `maxLines` of a `widthPx` column, between `minPx`
 * and `basePx`. Below the minimum the copy is allowed to take more lines; it is never clipped.
 */
export function fitTextSize(text: string, basePx: number, minPx: number, widthPx: number, maxLines: number, lineSlack = 1.18): number {
  const em = textWidthEm(text) * lineSlack;
  const byLines = em > 0 ? maxLines * widthPx / em : basePx;
  const byWord = longestWordEm(text) > 0 ? widthPx / longestWordEm(text) : basePx;
  return Math.max(minPx, Math.min(basePx, byLines, byWord));
}

export interface TimelineEventBeat {
  index: number;
  /** Transition into this event starts. */
  start: number;
  /** The visual switch for cuts and the copy handover. */
  cut: number;
  /** The event is fully on screen; the date has landed. */
  arrive: number;
  /** Next transition starts (or the summary). */
  end: number;
  transition: TimelineTransition;
  cues: { title: number; caption: number; source: number };
}
export interface TimelineSchedule {
  anchorEnd: number;
  summaryStart: number;
  summaryArrive: number;
  events: TimelineEventBeat[];
}
export const TIMELINE_MIN_HOLD = 48;
export const TIMELINE_DEFAULT_TRANSITION = 30;
const SUMMARY_TRANSITION = 36;
/** Anchor and summary windows. cueFrames[0] ends the anchor and cueFrames[2] starts the summary. */
export function timelineWindows(spec: SceneTemplateSpec<"timeline-journey">): { anchorEnd: number; summaryStart: number } {
  const d = spec.durationFrames;
  if (spec.cueFrames) return { anchorEnd: spec.cueFrames[0], summaryStart: spec.cueFrames[2] };
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));
  return { anchorEnd: clamp(d * .07, 24, 84), summaryStart: d - clamp(d * .15, 48, 168) };
}
/** Absolute frames for every event. Explicit `frames` are honoured; the rest share what is left. */
export function timelineJourneySchedule(spec: SceneTemplateSpec<"timeline-journey">): TimelineSchedule {
  const c = spec.content, events = c.events as TimelineJourneyEvent[];
  const { anchorEnd, summaryStart } = timelineWindows(spec);
  const explicit = events.reduce((sum, e) => sum + (e.frames ?? 0), 0);
  const implicit = events.filter(e => e.frames === undefined).length;
  const share = implicit ? Math.floor((summaryStart - anchorEnd - explicit) / implicit) : 0;
  let at = anchorEnd;
  const beats = events.map((e, i) => {
    const length = i === events.length - 1 ? summaryStart - at : e.frames ?? share;
    const transition = e.transition ?? c.transition ?? "truck";
    const span = Math.min(e.transitionFrames ?? c.transitionFrames ?? TIMELINE_DEFAULT_TRANSITION, Math.max(0, length - TIMELINE_MIN_HOLD));
    const start = at, arrive = start + span, cut = start + Math.round(span / 2);
    const cue = (offset: number | undefined, fallback: number) => Math.max(start, Math.min(start + length - 1, arrive + (offset ?? fallback)));
    at += length;
    return { index: i, start, cut, arrive, end: at, transition,
      cues: { title: cue(e.cues?.title, -4), caption: cue(e.cues?.caption, 8), source: cue(e.cues?.source, 14) } };
  });
  return { anchorEnd, summaryStart, summaryArrive: Math.min(spec.durationFrames - 1, summaryStart + SUMMARY_TRANSITION), events: beats };
}

/** Rail positions 0..1. "elapsed" is proportional to time; "equal" is even in chronological order. */
export function timelineRailPositions(dates: ResolvedTimelineDate[], spacing: "equal" | "elapsed"): number[] {
  const n = dates.length;
  if (spacing === "elapsed") {
    const min = Math.min(...dates.map(d => d.t)), max = Math.max(...dates.map(d => d.t)), range = Math.max(1e-9, max - min);
    return dates.map(d => (d.t - min) / range);
  }
  const order = dates.map((d, i) => ({ t: d.t, i })).sort((a, b) => a.t - b.t || a.i - b.i);
  const out = new Array<number>(n);
  order.forEach((o, k) => { out[o.i] = n === 1 ? 0 : k / (n - 1); });
  return out;
}
/** Proportional scale marks: a round step giving at most `maxMarks` graduations. Positions 0..1. */
export function timelineGraduations(dates: ResolvedTimelineDate[], maxMarks = 12): { step: number; marks: number[] } {
  const min = Math.min(...dates.map(d => d.t)), max = Math.max(...dates.map(d => d.t)), range = max - min;
  if (!(range > 0)) return { step: 0, marks: [] };
  let step = 1;
  for (let p = 1; ; p *= 10) {
    const found = [1, 2, 5].map(m => m * p).find(s => range / s <= maxMarks);
    if (found) { step = found; break; }
  }
  const marks: number[] = [];
  for (let y = Math.ceil(min / step) * step; y <= max; y += step) marks.push((y - min) / range);
  return { step, marks };
}
