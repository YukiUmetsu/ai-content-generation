import type { FontAsset, Size, TextSpec, TextSpan } from "./document";
import { round } from "./document";

/**
 * Measures the advance width of `text` for a CSS `font` shorthand. Implementations
 * must be pure: the same font/text pair always yields the same number. Callers
 * inject a canvas-backed measurer in the browser or a deterministic stand-in in
 * jsdom/tests so preview and export share one layout.
 */
export type MeasureText = (font: string, text: string) => number;

/** One run of a single line that maps back to one `TextSpec.spans` entry. */
export interface TextLineRun {
  /** Visible text of the run, already trimmed at the line edges. */
  text: string;
  /** Index into `TextSpec.spans`. */
  spanIndex: number;
  /** Inclusive offset into the concatenated plain text of all spans. */
  startIndex: number;
  /** Exclusive offset into the concatenated plain text of all spans. */
  endIndex: number;
  /** Advance width in design px, including this run's letter spacing. */
  width: number;
}

/** One laid-out line, composed of runs so each span keeps its own styling. */
export interface TextLineLayout {
  /** Plain concatenation of the line's runs. */
  text: string;
  /** Sum of the run widths, in design px. */
  width: number;
  runs: TextLineRun[];
}

/** Deterministic outcome of laying a spec out inside a box. */
export interface TextLayoutResult {
  /** Effective font size in design px after any `shrink` adjustment. */
  size: number;
  /** Lines kept for painting, in order. */
  lines: TextLineLayout[];
  /** `lines.length`; kept separate so consumers do not recompute it. */
  lineCount: number;
  /** Widest kept line, in design px. */
  width: number;
  /** Total kept line-box height, in design px. */
  height: number;
  /** True when the laid-out content exceeds the box vertically. */
  overflow: boolean;
  /** True when content was dropped by `maxLines` or the box height. */
  truncated: boolean;
  /** True when a fallback family had to stand in for the declared primary. */
  usedFallbackFamily: boolean;
}

const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "emoji",
  "math",
  "fangsong",
]);

const SIMPLE_FAMILY = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const WHITESPACE_ONLY = /^\s+$/;

/** Generic keywords stay bare; names with spaces or punctuation must be quoted. */
function quoteFamily(family: string): string {
  if (GENERIC_FAMILIES.has(family)) return family;
  if (SIMPLE_FAMILY.test(family)) return family;
  return `"${family.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function formatNumber(value: number): string {
  return String(round(value));
}

/**
 * Builds the CSS `font-family` chain: the primary family followed by the
 * declared fallbacks, each quoted only when CSS requires it. Duplicate entries
 * are removed so a stack cannot repeat itself.
 */
export function fontFamilyChain(font: FontAsset): string {
  const seen = new Set<string>();
  const families: string[] = [];
  for (const candidate of [font.family, ...font.fallback]) {
    const family = candidate.trim();
    if (family.length === 0 || seen.has(family)) continue;
    seen.add(family);
    families.push(quoteFamily(family));
  }
  return families.length > 0 ? families.join(", ") : "system-ui, sans-serif";
}

/**
 * CSS `font` shorthand for measuring and rendering, e.g.
 * `500 italic 32px "Geist Variable", system-ui, sans-serif`.
 *
 * `span` overrides the asset's weight/italic so a run can be bolder or slanted
 * without needing a second font record.
 */
export function fontString(font: FontAsset, size: number, span?: Pick<TextSpan, "weight" | "italic">): string {
  const weight = span?.weight ?? font.weight;
  const italic = span?.italic ?? font.style === "italic";
  const prefix = italic ? `${formatNumber(weight)} italic` : formatNumber(weight);
  return `${prefix} ${formatNumber(size)}px ${fontFamilyChain(font)}`;
}

/**
 * Canvas-backed {@link MeasureText}. The returned function reports `0` when no
 * 2D context exists (jsdom without the canvas package, workers), which lets the
 * caller detect the missing capability and inject its own measurer.
 */
export function createCanvasMeasurer(fonts: Record<string, FontAsset>): MeasureText {
  // The fonts map is accepted so every helper takes the document's font table.
  // Measurement only needs the shorthand string, so it is intentionally unused:
  // this keeps the measurer free of any hidden lookup that could disagree with
  // the layout's own font resolution.
  void fonts;

  let context: CanvasRenderingContext2D | null = null;
  if (typeof document !== "undefined") {
    try {
      context = document.createElement("canvas").getContext("2d");
    } catch {
      context = null;
    }
  }

  return (font, text) => {
    if (!context || text.length === 0) return 0;
    context.font = font;
    return context.measureText(text).width;
  };
}

interface SegmentPart {
  segment: string;
  index: number;
  isWordLike?: boolean;
}

interface SegmenterInstance {
  segment(input: string): Iterable<SegmentPart>;
}

interface SegmenterConstructor {
  new (
    locales?: string | string[],
    options?: { granularity?: "word" }
  ): SegmenterInstance;
}

function createSegmenter(language: string | undefined): SegmenterInstance | undefined {
  if (typeof Intl === "undefined" || !("Segmenter" in Intl)) return undefined;
  const Segmenter = (Intl as unknown as { Segmenter?: SegmenterConstructor }).Segmenter;
  if (!Segmenter) return undefined;
  try {
    return new Segmenter(language, { granularity: "word" });
  } catch {
    // An invalid BCP-47 tag must not disable wrapping for the whole document.
    try {
      return new Segmenter(undefined, { granularity: "word" });
    } catch {
      return undefined;
    }
  }
}

function isWhitespaceOnly(text: string): boolean {
  return text.length > 0 && WHITESPACE_ONLY.test(text);
}

// Scripts that may break between characters without whitespace. Thai is split
// per character in the fallback because without `Intl.Segmenter` there are no
// dictionary boundaries to trust; CJK behaves the same way typographically.
const FALLBACK_BREAKABLE = /[\u0E00-\u0E7F\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFF60\u3000-\u30FF]/u;

function fallbackSegments(text: string): string[] {
  const segments: string[] = [];
  let word = "";

  const flushWord = (): void => {
    if (word.length > 0) {
      segments.push(word);
      word = "";
    }
  };

  for (const character of text) {
    if (isWhitespaceOnly(character)) {
      flushWord();
      const last = segments[segments.length - 1];
      if (last !== undefined && isWhitespaceOnly(last)) segments[segments.length - 1] = last + character;
      else segments.push(character);
    } else if (FALLBACK_BREAKABLE.test(character)) {
      flushWord();
      segments.push(character);
    } else {
      word += character;
    }
  }
  flushWord();
  return segments;
}

/**
 * Locale-aware segmentation into unbreakable units, using `Intl.Segmenter`
 * (`word` granularity) when the runtime provides it. Whitespace is returned as
 * its own unit so the layout can break and trim there; punctuation is bound to
 * the preceding word so a line never starts with a stray comma and `3.14`
 * stays together.
 *
 * Without `Intl.Segmenter` this falls back to whitespace-delimited units and
 * per-character units for CJK/Thai, which preserves Latin words while still
 * allowing scripts without spaces to wrap. `language` is a BCP-47 tag; an
 * invalid tag falls back to the runtime's default locale.
 */
export function segmentText(text: string, language?: string): string[] {
  if (text.length === 0) return [];

  const segmenter = createSegmenter(language);
  if (!segmenter) return fallbackSegments(text);

  const segments: string[] = [];
  for (const part of segmenter.segment(text)) {
    const segment = part.segment;
    if (segment.length === 0) continue;

    if (isWhitespaceOnly(segment)) {
      segments.push(segment);
      continue;
    }

    const previous = segments[segments.length - 1];
    if (part.isWordLike === false && previous !== undefined && !isWhitespaceOnly(previous)) {
      segments[segments.length - 1] = previous + segment;
    } else {
      segments.push(segment);
    }
  }
  return segments;
}

interface ResolvedFont {
  font: FontAsset;
  weight: number;
  italic: boolean;
  /** True when the declared primary could not be trusted and a chain stands in. */
  fallback: boolean;
}

function resolveFont(fontId: string, span: TextSpan, fonts: Record<string, FontAsset>): ResolvedFont {
  const font = fonts[fontId];
  if (!font) {
    // Layout must survive a dangling reference (validation reports it as an
    // error elsewhere) rather than throwing while painting a preview.
    return {
      font: {
        id: fontId,
        family: "system-ui",
        weight: 400,
        style: "normal",
        fallback: ["sans-serif"],
        availability: "unknown",
      },
      weight: span.weight ?? 400,
      italic: span.italic ?? false,
      fallback: true,
    };
  }

  return {
    font,
    weight: span.weight ?? font.weight,
    italic: span.italic ?? font.style === "italic",
    // "unknown" means the environment may substitute the primary, so a declared
    // chain is reported as used even though the exact face is runtime-dependent.
    fallback: font.availability === "unknown" && font.fallback.length > 0,
  };
}

function resolveSpans(spec: TextSpec, fonts: Record<string, FontAsset>): ResolvedFont[] {
  return spec.spans.map((span) => resolveFont(span.fontId ?? spec.fontId, span, fonts));
}

/**
 * Measured advance of one segment. Letter spacing is approximated as
 * `letterSpacing * (segment.length - 1)` because tracking follows every
 * character except the one whose advance already ends the segment; this ignores
 * kerning and counts UTF-16 units rather than graphemes, which is acceptable
 * because the DOM renderer applies real CSS tracking and only wrapping decisions
 * depend on this estimate.
 */
function segmentWidth(
  text: string,
  resolved: ResolvedFont,
  size: number,
  letterSpacing: number,
  measure: MeasureText
): number {
  if (text.length === 0) return 0;
  const tracking = letterSpacing !== 0 ? letterSpacing * Math.max(0, text.length - 1) : 0;
  const font = fontString(resolved.font, size, { weight: resolved.weight, italic: resolved.italic });
  return round(measure(font, text) + tracking);
}

interface Unit {
  text: string;
  spanIndex: number;
  startIndex: number;
  endIndex: number;
  width: number;
  whitespace: boolean;
  /** An explicit `\n`: forces a line break and contributes no width. */
  hardBreak: boolean;
}

/**
 * Flattens every span into measured units, preserving offsets into the
 * concatenated plain text. Parallel spans are concatenated without an implicit
 * separator, matching `textSpecToString`.
 */
function buildUnits(
  spec: TextSpec,
  size: number,
  resolved: ResolvedFont[],
  measure: MeasureText
): Unit[] {
  const units: Unit[] = [];
  let spanOffset = 0;

  spec.spans.forEach((span, spanIndex) => {
    const spanFont = resolved[spanIndex];
    const paragraphs = span.text.split("\n");
    let localOffset = 0;

    paragraphs.forEach((paragraph, paragraphIndex) => {
      if (paragraphIndex > 0) {
        units.push({
          text: "\n",
          spanIndex,
          startIndex: spanOffset + localOffset,
          endIndex: spanOffset + localOffset + 1,
          width: 0,
          whitespace: true,
          hardBreak: true,
        });
        localOffset += 1;
      }

      for (const segment of segmentText(paragraph, spec.language)) {
        const whitespace = isWhitespaceOnly(segment);
        // Collapse any run of whitespace to a single space, matching CSS normal
        // wrapping: preview (DOM) and export must agree, and a doubled space is
        // not a layout feature. Source offsets still cover the original run.
        const text = whitespace ? " " : segment;
        units.push({
          text,
          spanIndex,
          startIndex: spanOffset + localOffset,
          endIndex: spanOffset + localOffset + segment.length,
          width: segmentWidth(text, spanFont, size, spec.letterSpacing, measure),
          whitespace,
          hardBreak: false,
        });
        localOffset += segment.length;
      }
    });

    spanOffset += span.text.length;
  });

  return units;
}

/**
 * Greedy wrapping at segment boundaries. Whitespace at the start of a line is
 * dropped and trailing whitespace is ignored when deciding whether the next
 * word fits, so a break never costs a visible space. A unit wider than the box
 * still gets its own line: segments are never split or dropped.
 */
function wrapUnits(units: Unit[], boxWidth: number, explicitOnly = false): Unit[][] {
  const lines: Unit[][] = [];
  let current: Unit[] = [];
  let currentWidth = 0;
  let trailingWidth = 0;

  const flush = (): void => {
    lines.push(current);
    current = [];
    currentWidth = 0;
    trailingWidth = 0;
  };

  for (const unit of units) {
    if (unit.hardBreak) {
      flush();
      continue;
    }

    if (unit.whitespace) {
      if (current.length === 0) continue;
      current.push(unit);
      currentWidth += unit.width;
      trailingWidth += unit.width;
      continue;
    }

    if (current.length === 0) {
      current.push(unit);
      currentWidth = unit.width;
      trailingWidth = 0;
      continue;
    }

    if (explicitOnly || currentWidth - trailingWidth + unit.width <= boxWidth) {
      current.push(unit);
      currentWidth += unit.width;
      trailingWidth = 0;
    } else {
      flush();
      current.push(unit);
      currentWidth = unit.width;
      trailingWidth = 0;
    }
  }

  flush();
  return lines;
}

/** Trims line-edge whitespace and folds consecutive same-span units into runs. */
function finalizeLine(units: Unit[]): TextLineLayout {
  let start = 0;
  let end = units.length;
  while (start < end && units[start].whitespace) start += 1;
  while (end > start && units[end - 1].whitespace) end -= 1;

  const runs: TextLineRun[] = [];
  for (let index = start; index < end; index += 1) {
    const unit = units[index];
    const previous = runs[runs.length - 1];
    if (previous && previous.spanIndex === unit.spanIndex) {
      previous.text += unit.text;
      previous.endIndex = unit.endIndex;
      previous.width = round(previous.width + unit.width);
    } else {
      runs.push({
        text: unit.text,
        spanIndex: unit.spanIndex,
        startIndex: unit.startIndex,
        endIndex: unit.endIndex,
        width: unit.width,
      });
    }
  }

  return {
    text: runs.map((run) => run.text).join(""),
    width: round(runs.reduce((total, run) => total + run.width, 0)),
    runs,
  };
}

interface BuiltLayout {
  lines: TextLineLayout[];
  width: number;
  height: number;
  lineHeight: number;
}

function buildLayout(
  spec: TextSpec,
  box: Size,
  size: number,
  resolved: ResolvedFont[],
  measure: MeasureText
): BuiltLayout {
  const lineHeight = spec.lineHeight * size;
  const lines = wrapUnits(buildUnits(spec, size, resolved, measure), box.width,
    spec.lineBreak === "explicit-only").map(finalizeLine);
  const width = round(lines.reduce((widest, line) => Math.max(widest, line.width), 0));
  return {
    lines,
    width,
    height: round(lines.length * lineHeight),
    lineHeight,
  };
}

/**
 * A `shrink` candidate fits only when no line exceeds the box width (possible
 * for one unbreakable segment), the whole block fits the box height and the
 * line budget is respected. Truncation is never treated as a fit.
 */
function fitsCandidate(layout: BuiltLayout, box: Size, maxLines: number | undefined): boolean {
  if (layout.lines.some((line) => line.width > box.width)) return false;
  if (layout.height > box.height) return false;
  if (maxLines !== undefined && layout.lines.length > maxLines) return false;
  return true;
}

function capLines(lines: TextLineLayout[], limit: number): TextLineLayout[] {
  if (limit >= lines.length) return lines;
  return lines.slice(0, Math.max(0, limit));
}

function toResult(
  size: number,
  lines: TextLineLayout[],
  lineHeight: number,
  overflow: boolean,
  truncated: boolean,
  usedFallbackFamily: boolean
): TextLayoutResult {
  return {
    size: round(size),
    lines,
    lineCount: lines.length,
    width: round(lines.reduce((widest, line) => Math.max(widest, line.width), 0)),
    height: round(lines.length * lineHeight),
    overflow,
    truncated,
    usedFallbackFamily,
  };
}

/**
 * Intrinsic single-line width of the whole spec at `spec.size`, including
 * tracking. Explicit `\n` characters mark breaks and add no width, but every
 * paragraph still contributes to the single-line total. Whitespace runs are
 * collapsed to a single space, matching how the layout paints them, so the
 * figure never overstates the visible line.
 */
export function measureTextWidth(
  spec: TextSpec,
  fonts: Record<string, FontAsset>,
  measure: MeasureText
): number {
  const resolved = resolveSpans(spec, fonts);
  let width = 0;
  spec.spans.forEach((span, spanIndex) => {
    for (const paragraph of span.text.split("\n")) {
      for (const segment of segmentText(paragraph, spec.language)) {
        const text = isWhitespaceOnly(segment) ? " " : segment;
        width += segmentWidth(text, resolved[spanIndex], spec.size, spec.letterSpacing, measure);
      }
    }
  });
  return round(width);
}

/**
 * Lays a text spec out inside `box` and applies its deterministic fit policy:
 *
 * - `none` wraps but never truncates, reporting vertical overflow.
 * - `wrap` wraps, caps at `maxLines` and reports the dropped lines.
 * - `clip` wraps, then keeps only what `maxLines` and the box height allow.
 * - `shrink` binary-searches thousandth-of-a-pixel steps for the largest size
 *   that fits width, height and `maxLines`, falling back to `minSize` with
 *   `overflow: true`.
 *
 * Pure for a given `measure`: identical inputs produce identical lines, sizes
 * and flags, which is what keeps the DOM preview and the SVG export in sync.
 */
export function layoutText(
  spec: TextSpec,
  box: Size,
  fonts: Record<string, FontAsset>,
  measure: MeasureText
): TextLayoutResult {
  const resolved = resolveSpans(spec, fonts);
  const usedFallbackFamily = resolved.some((entry) => entry.fallback);

  if (spec.fit === "shrink") {
    const ceiling = Math.max(0.001, spec.maxSize ?? spec.size);
    const requestedFloor = spec.minSize ?? Math.max(1, spec.size * 0.4);
    const floor = Math.min(Math.max(0.001, requestedFloor), ceiling);
    const build = (size: number): BuiltLayout => buildLayout(spec, box, size, resolved, measure);

    const atCeiling = build(ceiling);
    if (fitsCandidate(atCeiling, box, spec.maxLines)) {
      return toResult(ceiling, atCeiling.lines, atCeiling.lineHeight, false, false, usedFallbackFamily);
    }

    const atFloor = build(floor);
    if (!fitsCandidate(atFloor, box, spec.maxLines)) {
      // The smallest permitted size still cannot honour the box. Report the
      // failure honestly instead of silently going below the authored floor.
      const limit = spec.maxLines ?? atFloor.lines.length;
      const kept = capLines(atFloor.lines, limit);
      return toResult(
        floor,
        kept,
        atFloor.lineHeight,
        true,
        kept.length < atFloor.lines.length,
        usedFallbackFamily
      );
    }

    // Search on thousandths so the reported size is stable, reproducible and
    // exactly the size the lines were measured at.
    const SCALE = 1000;
    let low = Math.ceil(floor * SCALE);
    let high = Math.floor(ceiling * SCALE);

    if (high < low) {
      // Sub-thousandth range: the floor already fits, so no search is needed.
      return toResult(floor, atFloor.lines, atFloor.lineHeight, false, false, usedFallbackFamily);
    }

    if (low === high) {
      return toResult(low / SCALE, atFloor.lines, atFloor.lineHeight, false, false, usedFallbackFamily);
    }

    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      const candidate = build(mid / SCALE);
      if (fitsCandidate(candidate, box, spec.maxLines)) low = mid;
      else high = mid - 1;
    }

    const chosen = build(low / SCALE);
    return toResult(low / SCALE, chosen.lines, chosen.lineHeight, false, false, usedFallbackFamily);
  }

  const built = buildLayout(spec, box, spec.size, resolved, measure);

  if (spec.fit === "none") {
    return toResult(
      spec.size,
      built.lines,
      built.lineHeight,
      built.height > box.height,
      false,
      usedFallbackFamily
    );
  }

  if (spec.fit === "wrap") {
    const limit = spec.maxLines ?? built.lines.length;
    const kept = capLines(built.lines, limit);
    return toResult(
      spec.size,
      kept,
      built.lineHeight,
      built.height > box.height,
      kept.length < built.lines.length,
      usedFallbackFamily
    );
  }

  // `clip`: the number of whole lines the box can show is the floor of the
  // height budget; `maxLines` may tighten it further.
  const heightLimit =
    built.lineHeight > 0
      ? Math.max(0, Math.floor(box.height / built.lineHeight))
      : built.lines.length;
  const limit = spec.maxLines === undefined ? heightLimit : Math.min(spec.maxLines, heightLimit);
  const kept = capLines(built.lines, limit);
  return toResult(
    spec.size,
    kept,
    built.lineHeight,
    round(kept.length * built.lineHeight) > box.height,
    kept.length < built.lines.length,
    usedFallbackFamily
  );
}
