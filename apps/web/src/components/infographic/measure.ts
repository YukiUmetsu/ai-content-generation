/**
 * Deterministic text measurement, line breaking and locale-aware formatting.
 *
 * The infographic engine lays text out **before** the IR is emitted, so the DOM
 * preview and the SVG exporter place identical glyph runs and cannot diverge
 * (docs/11 "explicit fidelity"). To make that possible without a browser, width
 * is computed from a documented **per-character advance model** rather than real
 * font metrics: every backend, on every machine, produces the same line breaks.
 * The trade-off is a small approximation error against the real font, which is
 * acceptable for layout decisions (where the box, not the glyph, is authoritative)
 * and is surfaced honestly rather than hidden.
 *
 * Line breaking rules:
 * - `\n` always forces a break.
 * - Word boundaries come from `Intl.Segmenter` (word granularity) when available,
 *   so CJK ideographs and scripts without spaces break correctly; otherwise a
 *   deterministic fallback breaks on whitespace and between CJK ideographs.
 * - A single word wider than the measure is broken at character granularity
 *   rather than overflowing (so long URLs and unbreakable tokens stay inside the box).
 */

/** The typographic inputs a measurement depends on. */
export interface TextStyleRef {
  fontSize: number;
  family: string;
  /** @default 400 */
  weight?: number;
  italic?: boolean;
  /** Extra tracking in design px, applied per character. @default 0 */
  letterSpacing?: number;
}

export interface WrapOptions extends TextStyleRef {
  /** Available width in design px. */
  maxWidth: number;
  /** Truncation budget; when exceeded, `truncated` is set and an ellipsis is appended. */
  maxLines?: number;
  /** BCP-47 tag; only used to pick the segmentation rules. */
  language?: string;
}

export interface WrapResult {
  lines: string[];
  /** Width of the widest line, in design px. */
  width: number;
  /** True when `maxLines` forced truncation. */
  truncated: boolean;
}

const CJK_RANGE = /[\u1100-\u11FF\u2E80-\u9FFF\uAC00-\uD7A3\uF900-\uFAFF\uFF00-\uFF60\uFFE0-\uFFE6]/;
const WIDE_PUNCTUATION = /[，。！？、；：（）《》〈〉「」『』【】〔〕“”‘’—…·]/;
const NARROW_PUNCTUATION = /[.,;:!|'`"()[\]{}]/;
const DIGIT = /[0-9]/;
const UPPER = /[A-Z]/;
const SPACE = /\s/;
const MONO_FAMILY = /mono/i;

/** Advance as a fraction of the font size for one character. */
function advanceRatio(char: string, style: TextStyleRef): number {
  if (SPACE.test(char)) return 0.28;
  if (CJK_RANGE.test(char) || WIDE_PUNCTUATION.test(char)) return 1;
  if (MONO_FAMILY.test(style.family)) return 0.6;
  if (DIGIT.test(char)) return 0.6;
  if (UPPER.test(char)) return 0.68;
  if (NARROW_PUNCTUATION.test(char)) return 0.32;
  return 0.53;
}

/** Measure a single (unbroken) run of text in design px. */
export function measureText(text: string, style: TextStyleRef): number {
  const { fontSize, letterSpacing = 0 } = style;
  let width = 0;
  for (const char of text) width += advanceRatio(char, style) * fontSize + letterSpacing;
  return width;
}

export interface TextLineMetrics {
  /** Distance from one baseline to the next, in design px. */
  lineStep: number;
  /** Ascent above the baseline for the first line, in design px. */
  ascent: number;
}

/** Baseline metrics for a block of laid-out text. */
export function lineMetrics(fontSize: number, lineHeight: number): TextLineMetrics {
  const lineStep = fontSize * lineHeight;
  return { lineStep, ascent: (lineStep + fontSize * 0.7) / 2 };
}

/** Total height of `lineCount` lines, in design px. */
export function blockHeight(lineCount: number, fontSize: number, lineHeight: number): number {
  if (lineCount <= 0) return 0;
  return (lineCount - 1) * fontSize * lineHeight + fontSize * lineHeight;
}

/** Baseline `y` for line `index` relative to the block's top edge. */
export function baselineOffset(index: number, fontSize: number, lineHeight: number): number {
  const { lineStep, ascent } = lineMetrics(fontSize, lineHeight);
  return index * lineStep + ascent;
}

interface Segmenter {
  segment(input: string): Iterable<{ segment: string; isWordLike?: boolean }>;
}

let cachedSegmenter: Segmenter | null | undefined;

function getSegmenter(): Segmenter | null {
  if (cachedSegmenter !== undefined) return cachedSegmenter;
  const intl = Intl as unknown as { Segmenter?: new (locale?: string, options?: object) => Segmenter };
  if (typeof intl.Segmenter !== "function") {
    cachedSegmenter = null;
    return null;
  }
  try {
    cachedSegmenter = new intl.Segmenter(undefined, { granularity: "word" });
  } catch {
    cachedSegmenter = null;
  }
  return cachedSegmenter;
}

/** Split a paragraph into tokens that may each be kept whole or broken further. */
function tokenize(text: string): string[] {
  const segmenter = getSegmenter();
  if (segmenter) {
    const tokens: string[] = [];
    for (const { segment, isWordLike } of segmenter.segment(text)) {
      if (segment.length === 0) continue;
      if (isWordLike || SPACE.test(segment) || segment === "\t") {
        tokens.push(segment);
      } else {
        // Punctuation/symbols: keep attached to the previous token when possible.
        const last = tokens[tokens.length - 1];
        if (last && !SPACE.test(last)) tokens[tokens.length - 1] = last + segment;
        else tokens.push(segment);
      }
    }
    return tokens;
  }
  // Fallback: whitespace words, with CJK ideographs broken into single glyphs.
  const tokens: string[] = [];
  for (const chunk of text.split(/(\s+)/)) {
    if (chunk === "") continue;
    if (SPACE.test(chunk)) {
      tokens.push(chunk);
      continue;
    }
    let buffer = "";
    for (const char of chunk) {
      if (CJK_RANGE.test(char) || WIDE_PUNCTUATION.test(char)) {
        if (buffer) {
          tokens.push(buffer);
          buffer = "";
        }
        tokens.push(char);
      } else {
        buffer += char;
      }
    }
    if (buffer) tokens.push(buffer);
  }
  return tokens;
}

/** Break one unbroken token that is wider than the measure into character runs. */
function breakOversized(token: string, style: TextStyleRef, maxWidth: number): string[] {
  const pieces: string[] = [];
  let current = "";
  for (const char of token) {
    const candidate = current + char;
    if (current && measureText(candidate, style) > maxWidth) {
      pieces.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }
  if (current) pieces.push(current);
  return pieces.length > 0 ? pieces : [token];
}

const ELLIPSIS = "…";

/**
 * Wrap `text` to `maxWidth`, returning the laid-out lines.
 *
 * When `maxLines` is set the result is truncated to that many lines and the last
 * kept line gets an ellipsis; `truncated` reports it so callers can refuse to
 * silently drop content (docs/12 §8). Callers that must not lose facts should
 * leave `maxLines` unset and act on the resulting height instead.
 */
export function wrapText(text: string, options: WrapOptions): WrapResult {
  const { maxWidth, maxLines, language } = options;
  void language;
  const style: TextStyleRef = {
    fontSize: options.fontSize,
    family: options.family,
    weight: options.weight,
    italic: options.italic,
    letterSpacing: options.letterSpacing,
  };

  const paragraphs = text.split("\n");
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph === "") {
      lines.push("");
      continue;
    }
    const tokens = tokenize(paragraph);
    let current = "";
    for (const token of tokens) {
      const candidate = current + token;
      if (measureText(candidate.trimEnd(), style) <= maxWidth || current === "") {
        if (current === "" && measureText(token.trimEnd(), style) > maxWidth) {
          const pieces = breakOversized(token, style, maxWidth);
          for (let index = 0; index < pieces.length; index += 1) {
            if (index === pieces.length - 1) current = pieces[index];
            else lines.push(pieces[index]);
          }
        } else {
          current = candidate;
        }
        continue;
      }
      lines.push(current.trimEnd());
      const next = SPACE.test(token) ? "" : token;
      if (next && measureText(next, style) > maxWidth) {
        const pieces = breakOversized(next, style, maxWidth);
        for (let index = 0; index < pieces.length; index += 1) {
          if (index === pieces.length - 1) current = pieces[index];
          else lines.push(pieces[index]);
        }
      } else {
        current = next;
      }
    }
    if (current !== "") lines.push(current.trimEnd());
    else if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  }

  while (lines.length > 0 && lines[lines.length - 1] === "" && paragraphs.length > 1) lines.pop();
  const cleaned = lines.filter((line, index) => !(line === "" && index === lines.length - 1));

  let truncated = false;
  let result = cleaned;
  if (maxLines !== undefined && cleaned.length > maxLines && maxLines > 0) {
    truncated = true;
    result = cleaned.slice(0, maxLines);
    const last = result[maxLines - 1] ?? "";
    result[maxLines - 1] = `${last}${ELLIPSIS}`;
  }

  const width = result.reduce((max, line) => Math.max(max, measureText(line, style)), 0);
  return { lines: result.length > 0 ? result : [""], width, truncated };
}

// ---------------------------------------------------------------------------
// Locale-aware formatting
// ---------------------------------------------------------------------------

export interface NumberFormatOptions {
  /** BCP-47 tag. */
  language?: string;
  /** Fixed fraction digits; the underlying value is unchanged. */
  precision?: number;
  /** Grouping. @default true */
  grouping?: boolean;
  /** Compact notation for very large headline numbers. @default false */
  compact?: boolean;
  /** Exponent for scientific notation; `undefined` uses plain form. */
  scientific?: boolean;
}

/**
 * Format a numeric value for display. Deterministic for a given tag+options,
 * and never changes the value being represented — only its presentation
 * (docs/12 §4 "presentation rounding must be labeled and reproducible").
 */
export function formatNumber(value: number, options: NumberFormatOptions = {}): string {
  const { language, precision, grouping = true, compact = false, scientific = false } = options;
  if (!Number.isFinite(value)) return "—";
  const formatter = new Intl.NumberFormat(language, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
    useGrouping: grouping,
    notation: compact ? "compact" : scientific ? "scientific" : "standard",
  });
  return formatter.format(value);
}

/**
 * A ratio expressed as a percentage with a fixed precision. `0.124` → `"12.4%"`.
 * Unlike {@link formatNumber} this scales by 100, so callers can keep the
 * underlying value as a fraction.
 */
export function formatPercent(fraction: number, precision = 1, language?: string): string {
  if (!Number.isFinite(fraction)) return "—";
  const base = formatNumber(fraction * 100, { precision, language });
  return `${base}%`;
}

/** A signed change with an explicit sign, so direction is never color-only. */
export function formatSigned(value: number, options: NumberFormatOptions = {}): string {
  const magnitude = formatNumber(Math.abs(value), options);
  if (value > 0) return `+${magnitude}`;
  if (value < 0) return `−${magnitude}`;
  return magnitude;
}

/**
 * Render a milestone label. ISO date-times are formatted with `Intl.DateTimeFormat`;
 * any other string (a relative label like `"T+2"` or `"Phase 1"`) is returned as-is.
 */
export function formatMilestoneLabel(at: string, language?: string): string {
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) return at;
  if (!/^\d{4}-\d{2}-\d{2}/.test(at)) return at;
  const hasTime = /T\d{2}:\d{2}/.test(at);
  return new Intl.DateTimeFormat(language, {
    year: "numeric",
    month: "short",
    day: "numeric",
    // A date-only ISO string parses as UTC midnight, so formatting in the
    // runtime's local zone shifts it a day for negative offsets. Pin UTC so a
    // date renders the same everywhere; timed values keep the author's zone.
    ...(hasTime ? { hour: "2-digit", minute: "2-digit" } : { timeZone: "UTC" }),
  }).format(parsed);
}

/** Sort key for a milestone: numeric time for ISO dates, otherwise source order. */
export function milestoneSortKey(at: string, index: number): number {
  const parsed = new Date(at);
  return Number.isNaN(parsed.getTime()) ? index : parsed.getTime();
}

/** True when every milestone carries an ISO date-time. */
export function hasTemporalScale(values: readonly string[]): boolean {
  return values.length > 0 && values.every((value) => !Number.isNaN(new Date(value).getTime()));
}
