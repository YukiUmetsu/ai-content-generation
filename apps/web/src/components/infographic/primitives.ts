/**
 * Shared geometry and primitive-building helpers for infographic renderers.
 *
 * Every block/visualizer/template builds its output out of these factories so
 * that three things stay true no matter which module produced a primitive:
 *
 * 1. **Determinism.** Ids come from a counter-based factory, numbers are rounded
 *    once at the boundary, and nothing reads a clock or `Math.random`.
 * 2. **Backend parity.** Text is wrapped here, before it becomes a
 *    {@link TextPrimitive}, so the DOM preview and the SVG exporter emit the
 *    same glyph runs and line counts.
 * 3. **Honest fit.** {@link layoutText} reports `overflow` / `shrink` instead of
 *    silently clipping, so a caller can emit a diagnostic or paginate
 *    (docs/12 §5: never silently truncate).
 *
 * The module is intentionally self-contained: it imports only from sibling
 * infographic modules, never from `src/`, so the registry item installs cleanly
 * on its own.
 */

import {
  blockHeight,
  baselineOffset,
  measureText,
  wrapText,
  type TextStyleRef,
  type WrapResult,
} from "./measure";
import type {
  DashPattern,
  ElevationPaint,
  GradientPaint,
  InfographicPrimitive,
  LinePrimitive,
  MarkerKind,
  PathPrimitive,
  PolylinePrimitive,
  RectInfo,
  RectPrimitive,
  ResolvedStyle,
  SectionRenderContext,
  TextAlign,
  TextPrimitive,
} from "./types";

// ---------------------------------------------------------------------------
// Numeric + id helpers
// ---------------------------------------------------------------------------

/** Round to a fixed precision so IR output is stable across machines. */
export function round(value: number, precision = 3): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Map `value` from `[inMin, inMax]` onto `[outMin, outMax]`. */
export function mapRange(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number
): number {
  if (inMax === inMin) return outMin;
  return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
}

/** A nice, human-readable axis step near `raw` (1/2/2.5/5 × 10ⁿ). */
export function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const exponent = Math.floor(Math.log10(raw));
  const magnitude = 10 ** exponent;
  const normalized = raw / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * Create the deterministic id factory passed to every section renderer.
 * Calling the same factory in the same order always yields the same ids, which
 * is what makes golden-frame tests and layout caching viable.
 */
export function createIdFactory(prefix: string): (hint: string) => string {
  const counters = new Map<string, number>();
  return (hint: string) => {
    const next = (counters.get(hint) ?? 0) + 1;
    counters.set(hint, next);
    return `${prefix}-${hint}-${next}`;
  };
}

// ---------------------------------------------------------------------------
// Rect helpers
// ---------------------------------------------------------------------------

export function rectRight(rect: RectInfo): number {
  return rect.x + rect.width;
}

export function rectBottom(rect: RectInfo): number {
  return rect.y + rect.height;
}

export function rectCenter(rect: RectInfo): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Inset a rect by a uniform amount or per-side insets. Never inverts. */
export function insetRect(rect: RectInfo, amount: number | Partial<Insets>): RectInfo {
  const insets: Insets =
    typeof amount === "number"
      ? { top: amount, right: amount, bottom: amount, left: amount }
      : { top: amount.top ?? 0, right: amount.right ?? 0, bottom: amount.bottom ?? 0, left: amount.left ?? 0 };
  const width = Math.max(0, rect.width - insets.left - insets.right);
  const height = Math.max(0, rect.height - insets.top - insets.bottom);
  return { x: rect.x + insets.left, y: rect.y + insets.top, width, height };
}

/** Translate a rect (never resize) so it sits fully inside `bounds`. */
export function clampRect(rect: RectInfo, bounds: RectInfo): RectInfo {
  const x = clamp(rect.x, bounds.x, Math.max(bounds.x, rectRight(bounds) - rect.width));
  const y = clamp(rect.y, bounds.y, Math.max(bounds.y, rectBottom(bounds) - rect.height));
  return { x, y, width: rect.width, height: rect.height };
}

/** Split a rect into rows by relative weights, with fixed gaps between them. */
export function splitRows(rect: RectInfo, weights: readonly number[], gap: number): RectInfo[] {
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  const available = rect.height - gap * Math.max(0, weights.length - 1);
  if (total <= 0 || weights.length === 0) return [];
  const rows: RectInfo[] = [];
  let y = rect.y;
  weights.forEach((weight, index) => {
    const height = index === weights.length - 1 ? rectBottom(rect) - y : (Math.max(0, weight) / total) * available;
    rows.push({ x: rect.x, y: round(y), width: rect.width, height: round(Math.max(0, height)) });
    y = round(y + height + gap);
  });
  return rows;
}

/** Split a rect into columns by relative weights, with fixed gaps between them. */
export function splitColumns(rect: RectInfo, weights: readonly number[], gap: number): RectInfo[] {
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  const available = rect.width - gap * Math.max(0, weights.length - 1);
  if (total <= 0 || weights.length === 0) return [];
  const output: RectInfo[] = [];
  let x = rect.x;
  weights.forEach((weight, index) => {
    const width = index === weights.length - 1 ? rectRight(rect) - x : (Math.max(0, weight) / total) * available;
    output.push({ x: round(x), y: rect.y, width: round(Math.max(0, width)), height: rect.height });
    x = round(x + width + gap);
  });
  return output;
}

/**
 * Split a rect into equal columns with fixed gaps (left-to-right).
 */
export function columns(rect: RectInfo, count: number, gap: number): RectInfo[] {
  if (count <= 0) return [];
  const width = (rect.width - gap * (count - 1)) / count;
  return Array.from({ length: count }, (_, index) => ({
    x: round(rect.x + index * (width + gap)),
    y: rect.y,
    width: round(width),
    height: rect.height,
  }));
}

/** Split a rect into equal rows with fixed gaps (top-to-bottom). */
export function rows(rect: RectInfo, count: number, gap: number): RectInfo[] {
  if (count <= 0) return [];
  const height = (rect.height - gap * (count - 1)) / count;
  return Array.from({ length: count }, (_, index) => ({
    x: rect.x,
    y: round(rect.y + index * (height + gap)),
    width: rect.width,
    height: round(height),
  }));
}

/** A `columns` × `rows` cell grid, returned in row-major order. */
export function gridCells(
  rect: RectInfo,
  columnCount: number,
  rowCount: number,
  gap: number
): RectInfo[] {
  const cells: RectInfo[] = [];
  for (const row of rows(rect, rowCount, gap)) cells.push(...columns(row, columnCount, gap));
  return cells;
}

export function rectsOverlap(a: RectInfo, b: RectInfo): boolean {
  return a.x < rectRight(b) && b.x < rectRight(a) && a.y < rectBottom(b) && b.y < rectBottom(a);
}

/** Total area shared by two rects (0 when they do not overlap). */
export function overlapArea(a: RectInfo, b: RectInfo): number {
  const width = Math.min(rectRight(a), rectRight(b)) - Math.max(a.x, b.x);
  const height = Math.min(rectBottom(a), rectBottom(b)) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

/** How far a rect exceeds `bounds` on each side (0 when inside). */
export function overflowOf(rect: RectInfo, bounds: RectInfo): number {
  const top = Math.max(0, bounds.y - rect.y);
  const left = Math.max(0, bounds.x - rect.x);
  const bottom = Math.max(0, rectBottom(rect) - rectBottom(bounds));
  const right = Math.max(0, rectRight(rect) - rectRight(bounds));
  return Math.max(top, left, bottom, right);
}

// ---------------------------------------------------------------------------
// Type roles
// ---------------------------------------------------------------------------

export type TypeRole =
  | "display"
  | "title"
  | "h2"
  | "h3"
  | "label"
  | "body"
  | "caption"
  | "annotation"
  | "statHuge"
  | "statLarge";

function familyFor(style: ResolvedStyle, role: TypeRole): string {
  switch (role) {
    case "display":
    case "title":
      return style.font.display;
    case "h2":
    case "h3":
      return style.font.heading;
    case "label":
      return style.font.heading;
    case "statHuge":
    case "statLarge":
      return style.font.display;
    default:
      return style.font.body;
  }
}

function lineHeightFor(style: ResolvedStyle, role: TypeRole): number {
  switch (role) {
    case "display":
      return style.lineHeight.display;
    case "title":
    case "h2":
    case "h3":
      return style.lineHeight.heading;
    case "annotation":
    case "label":
    case "caption":
      return style.lineHeight.annotation;
    default:
      return style.lineHeight.body;
  }
}

function weightFor(style: ResolvedStyle, role: TypeRole): number {
  switch (role) {
    case "display":
    case "title":
      return style.weight.display;
    case "h2":
    case "h3":
      return style.weight.heading;
    case "label":
    case "caption":
    case "annotation":
      return style.weight.label;
    case "statHuge":
    case "statLarge":
      return style.weight.display;
    default:
      return style.weight.body;
  }
}

/**
 * Build the measurement inputs for a type role. Passing `overrides` is the only
 * sanctioned way to deviate from the art direction's ramp, so custom sizes stay
 * visible at the call site.
 */
export function typeStyle(
  style: ResolvedStyle,
  role: TypeRole,
  overrides?: Partial<TextStyleRef>
): TextStyleRef {
  const resolved: TextStyleRef = {
    fontSize: style.type[role],
    family: familyFor(style, role),
    weight: weightFor(style, role),
    letterSpacing: role === "display" ? style.letterSpacing.display : role === "label" ? style.letterSpacing.label : 0,
  };
  return { ...resolved, ...overrides };
}

export function lineHeightForRole(style: ResolvedStyle, role: TypeRole): number {
  return lineHeightFor(style, role);
}

/** Apply the art direction's uppercase rule to a label. */
export function labelCase(style: ResolvedStyle, text: string): string {
  return style.uppercaseLabels ? text.toLocaleUpperCase("en-US") : text;
}

// ---------------------------------------------------------------------------
// Text layout
// ---------------------------------------------------------------------------

export type FitState = "ok" | "shrink" | "overflow";

export interface LayoutTextInput {
  text: string;
  /** Origin/measure box. `width` is the measure; `height` bounds the block. */
  box: RectInfo;
  style: TextStyleRef;
  color: string;
  role?: string;
  semanticId?: string;
  /** @default "start" */
  align?: TextAlign;
  /** Unitless line-height multiplier. @default context.style.lineHeight.body */
  lineHeight?: number;
  /** @default "top" */
  valign?: "top" | "middle" | "bottom";
  /** Truncation budget; prefer `maxHeight` + diagnostics over hard truncation. */
  maxLines?: number;
  /** Height budget within `box`; requires `shrink` or reports `overflow`. */
  maxHeight?: number;
  /** Deterministic font-size reduction when `maxHeight` is exceeded. */
  shrink?: { floor: number; step?: number };
  opacity?: number;
  /** Marks the run for legibility boosting in the preview. */
  strong?: boolean;
  /** Fixed-width figures for numbers that stack or animate. */
  tabular?: boolean;
  language?: string;
}

export interface LayoutTextResult {
  primitive: TextPrimitive;
  /** Height actually occupied, in design px. */
  height: number;
  /** Height the text would need unconstrained. */
  requiredHeight: number;
  fit: FitState;
  wrap: WrapResult;
}

/**
 * Wrap, vertically place and (optionally) shrink text inside a box.
 *
 * Shrinking is bounded by `shrink.floor`; the docs/12 §5 rule is that content is
 * never shrunk below a legibility floor. When even the floor does not fit the
 * result is `overflow` — the caller decides whether to paginate, split the block
 * or report `section-overflow`; nothing is clipped silently.
 */
export function layoutText(input: LayoutTextInput, context: SectionRenderContext): LayoutTextResult {
  const { box } = input;
  const baseStyle = input.style;
  const lineHeight = input.lineHeight ?? context.style.lineHeight.body;
  const floor = input.shrink?.floor;
  const step = input.shrink?.step ?? 1;

  let fontSize = baseStyle.fontSize;
  let wrap = wrapText(input.text, {
    ...baseStyle,
    fontSize,
    maxWidth: box.width,
    maxLines: input.maxLines,
    language: input.language,
  });
  let required = blockHeight(wrap.lines.length, fontSize, lineHeight);
  let fit: FitState = "ok";

  if (input.maxHeight !== undefined && required > input.maxHeight + 0.5) {
    if (floor !== undefined && fontSize > floor) {
      fit = "shrink";
      while (fontSize - step >= floor) {
        fontSize -= step;
        wrap = wrapText(input.text, {
          ...baseStyle,
          fontSize,
          maxWidth: box.width,
          maxLines: input.maxLines,
          language: input.language,
        });
        required = blockHeight(wrap.lines.length, fontSize, lineHeight);
        if (required <= input.maxHeight + 0.5) break;
      }
      if (required > input.maxHeight + 0.5) fit = "overflow";
    } else {
      fit = "overflow";
    }
  }

  const height = round(required);
  const valign = input.valign ?? "top";
  let y = box.y;
  if (valign === "middle") y = box.y + Math.max(0, (box.height - height) / 2);
  else if (valign === "bottom") y = box.y + Math.max(0, box.height - height);

  const primitive: TextPrimitive = {
    kind: "text",
    id: context.id(input.role ?? "text"),
    semanticId: input.semanticId,
    role: input.role,
    x: round(box.x),
    y: round(y),
    width: round(box.width),
    height,
    lines: wrap.lines,
    fontSize: round(fontSize),
    lineHeight,
    family: baseStyle.family,
    weight: baseStyle.weight,
    italic: baseStyle.italic,
    color: input.color,
    align: input.align ?? "start",
    letterSpacing: baseStyle.letterSpacing,
    strong: input.strong,
    tabular: input.tabular,
    opacity: input.opacity,
  };

  return { primitive, height, requiredHeight: round(blockHeight(wrap.lines.length, baseStyle.fontSize, lineHeight)), fit, wrap };
}

/**
 * {@link layoutText} with the art direction's type role resolved for you, so the
 * font size, family, weight, tracking and line-height always come from the same
 * role. Prefer this over hand-assembling a {@link TextStyleRef}.
 *
 * `typeRole` selects the ramp; `role` (inherited from {@link LayoutTextInput})
 * tags the emitted primitive for tests and diagnostics.
 */
export function layoutTextForRole(
  input: Omit<LayoutTextInput, "style" | "lineHeight"> & {
    typeRole: TypeRole;
    overrides?: Partial<TextStyleRef>;
    lineHeight?: number;
  },
  context: SectionRenderContext
): LayoutTextResult {
  const { typeRole, overrides, lineHeight, ...rest } = input;
  return layoutText(
    {
      ...rest,
      style: typeStyle(context.style, typeRole, overrides),
      lineHeight: lineHeight ?? lineHeightForRole(context.style, typeRole),
    },
    context
  );
}

// ---------------------------------------------------------------------------
// Stroke helpers
// ---------------------------------------------------------------------------

/**
 * Convert a dash token into an SVG `stroke-dasharray` value.
 *
 * This is the single source of truth for both backends: the DOM preview
 * (`react.tsx`) and the static exporter (`svg.ts`) call it, so a dashed or
 * dotted stroke cannot drift between what is shown and what is exported. The
 * dash geometry scales with the stroke width so a hairline rule and a heavy
 * connector read as the same rhythm. A non-positive width falls back to `1`
 * so the pattern never collapses to nothing. `solid`/`undefined` return `null`.
 */
export function strokeDashArray(dash: string | undefined, strokeWidth: number): string | null {
  const width = strokeWidth > 0 ? strokeWidth : 1;
  switch (dash) {
    case "dashed":
      return `${round(width * 3)} ${round(width * 2)}`;
    case "dotted":
      return `${round(width)} ${round(width * 2)}`;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Primitive factories
// ---------------------------------------------------------------------------

export interface SurfaceOptions {
  fill?: string;
  gradient?: GradientPaint;
  elevation?: ElevationPaint;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
  dash?: DashPattern;
  opacity?: number;
  role?: string;
  semanticId?: string;
}

export function rectPrimitive(
  box: RectInfo,
  options: SurfaceOptions,
  context: SectionRenderContext
): RectPrimitive {
  return {
    kind: "rect",
    id: context.id(options.role ?? "rect"),
    semanticId: options.semanticId,
    role: options.role,
    x: round(box.x),
    y: round(box.y),
    width: round(box.width),
    height: round(box.height),
    radius: options.radius !== undefined ? round(options.radius) : undefined,
    fill: options.fill,
    gradient: options.gradient,
    elevation: options.elevation,
    stroke: options.stroke,
    strokeWidth: options.strokeWidth,
    dash: options.dash,
    opacity: options.opacity,
  };
}

export function ellipsePrimitive(
  box: RectInfo,
  options: Omit<SurfaceOptions, "radius" | "dash">,
  context: SectionRenderContext
) {
  return {
    kind: "ellipse" as const,
    id: context.id(options.role ?? "ellipse"),
    semanticId: options.semanticId,
    role: options.role,
    x: round(box.x),
    y: round(box.y),
    width: round(box.width),
    height: round(box.height),
    fill: options.fill,
    stroke: options.stroke,
    strokeWidth: options.strokeWidth,
    opacity: options.opacity,
  };
}

export interface LineOptions {
  stroke: string;
  strokeWidth: number;
  dash?: DashPattern;
  markerStart?: MarkerKind;
  markerEnd?: MarkerKind;
  role?: string;
  semanticId?: string;
  opacity?: number;
}

export function linePrimitive(
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: LineOptions,
  context: SectionRenderContext
): LinePrimitive {
  return {
    kind: "line",
    id: context.id(options.role ?? "line"),
    semanticId: options.semanticId,
    role: options.role,
    x1: round(from.x),
    y1: round(from.y),
    x2: round(to.x),
    y2: round(to.y),
    stroke: options.stroke,
    strokeWidth: options.strokeWidth,
    dash: options.dash,
    markerStart: options.markerStart,
    markerEnd: options.markerEnd,
    opacity: options.opacity,
  };
}

export interface PolylineOptions {
  closed?: boolean;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  dash?: DashPattern;
  markerEnd?: MarkerKind;
  role?: string;
  semanticId?: string;
  opacity?: number;
}

export function polylinePrimitive(
  points: Array<[number, number]>,
  options: PolylineOptions,
  context: SectionRenderContext
): PolylinePrimitive {
  return {
    kind: "polyline",
    id: context.id(options.role ?? "polyline"),
    semanticId: options.semanticId,
    role: options.role,
    points: points.map(([x, y]) => [round(x), round(y)] as [number, number]),
    closed: options.closed,
    fill: options.fill,
    stroke: options.stroke,
    strokeWidth: options.strokeWidth,
    dash: options.dash,
    markerEnd: options.markerEnd,
    opacity: options.opacity,
  };
}

export interface PathOptions {
  fill?: string;
  gradient?: GradientPaint;
  elevation?: ElevationPaint;
  stroke?: string;
  strokeWidth?: number;
  dash?: DashPattern;
  markerEnd?: MarkerKind;
  role?: string;
  semanticId?: string;
  opacity?: number;
}

export function pathPrimitive(
  d: string,
  options: PathOptions,
  context: SectionRenderContext
): PathPrimitive {
  return {
    kind: "path",
    id: context.id(options.role ?? "path"),
    semanticId: options.semanticId,
    role: options.role,
    d,
    fill: options.fill,
    gradient: options.gradient,
    elevation: options.elevation,
    stroke: options.stroke,
    strokeWidth: options.strokeWidth,
    dash: options.dash,
    markerEnd: options.markerEnd,
    opacity: options.opacity,
  };
}

// ---------------------------------------------------------------------------
// Composite helpers shared by blocks, visualizers and templates
// ---------------------------------------------------------------------------

/** A hairline rule spanning a rect's width at its top or bottom edge. */
export function rulePrimitive(
  box: RectInfo,
  style: ResolvedStyle,
  context: SectionRenderContext,
  options?: { edge?: "top" | "bottom"; color?: string; width?: number; dash?: DashPattern; role?: string }
): LinePrimitive {
  const edge = options?.edge ?? "top";
  const y = edge === "top" ? box.y : rectBottom(box);
  return linePrimitive(
    { x: box.x, y },
    { x: rectRight(box), y },
    {
      stroke: options?.color ?? style.color.rule,
      strokeWidth: options?.width ?? style.stroke.hairline,
      dash: options?.dash ?? style.dash.rule,
      role: options?.role ?? "rule",
    },
    context
  );
}

/** Vertical accent bar aligned to a block's leading edge. */
export function accentBar(
  box: RectInfo,
  style: ResolvedStyle,
  context: SectionRenderContext,
  options?: { color?: string; width?: number; role?: string }
): RectPrimitive {
  return rectPrimitive(
    { x: box.x, y: box.y, width: options?.width ?? style.stroke.strong, height: box.height },
    { fill: options?.color ?? style.color.accent, role: options?.role ?? "accent-bar" },
    context
  );
}

/**
 * Elevation for a surface at `level`, or `undefined` when the art direction is
 * flat (`surface.shadow: false`). Blocks ask for a level; the art direction
 * decides whether depth exists at all, so print-like directions stay flat.
 */
export function elevationFor(style: ResolvedStyle, level: ElevationPaint["level"] = 1): ElevationPaint | undefined {
  return style.surface.shadow ? { level, color: style.color.shadow } : undefined;
}

/**
 * Draw a block surface honoring the art direction's `surface` flags, so
 * switching profile turns panels on/off without touching block code.
 */
export function surfacePrimitives(
  box: RectInfo,
  style: ResolvedStyle,
  context: SectionRenderContext,
  options?: {
    role?: string;
    fill?: string;
    semanticId?: string;
    radius?: number;
    /** Elevation level when the art direction allows depth. @default 1 */
    level?: ElevationPaint["level"];
  }
): InfographicPrimitive[] {
  const output: InfographicPrimitive[] = [];
  if (style.surface.fill) {
    output.push(
      rectPrimitive(
        box,
        {
          fill: options?.fill ?? style.color.surface,
          radius: options?.radius ?? style.radius.md,
          role: options?.role ?? "surface",
          semanticId: options?.semanticId,
          elevation: elevationFor(style, options?.level ?? 1),
        },
        context
      )
    );
  }
  if (style.surface.border) {
    output.push(
      rectPrimitive(
        box,
        {
          stroke: style.color.rule,
          strokeWidth: style.stroke.hairline,
          radius: options?.radius ?? style.radius.md,
          role: "surface-border",
        },
        context
      )
    );
  }
  return output;
}

export interface HeadingBlockOptions {
  /** Small label above the heading. */
  eyebrow?: string;
  /** Accent treatment in addition to the art direction's default. */
  accent?: boolean;
  role?: string;
  semanticId?: string;
  /** @default "h3" */
  typeRole?: TypeRole;
  color?: string;
  /** @default false */
  center?: boolean;
}

export interface HeadingBlockResult {
  primitives: InfographicPrimitive[];
  /** Vertical space consumed, in design px. */
  height: number;
  /** True when the heading did not fit inside `box`. */
  overflow: boolean;
}

/**
 * Heading + optional eyebrow + art-direction accent treatment. Returns the
 * consumed height so callers can flow content beneath it without guessing.
 */
export function headingBlock(
  box: RectInfo,
  text: string,
  style: ResolvedStyle,
  context: SectionRenderContext,
  options: HeadingBlockOptions = {}
): HeadingBlockResult {
  const typeRole = options.typeRole ?? "h3";
  const primitives: InfographicPrimitive[] = [];
  let cursor = box.y;
  let overflow = false;

  const barWidth = style.stroke.strong;

  if (options.eyebrow) {
    const eyebrowStyle = typeStyle(style, "label", { family: style.font.heading });
    const eyebrow = layoutText(
      {
        text: labelCase(style, options.eyebrow),
        box: { x: box.x, y: cursor, width: box.width, height: 0 },
        style: eyebrowStyle,
        color: style.color.accent,
        role: "eyebrow",
        align: options.center ? "center" : "start",
      },
      context
    );
    primitives.push(eyebrow.primitive);
    cursor += eyebrow.height + style.spacing[1];
  }

  const headingStyle = typeStyle(style, typeRole);
  const dotSize = style.stroke.strong * 2;
  const textX =
    box.x +
    (options.accent && style.accentUsage === "bar"
      ? barWidth + style.spacing[1]
      : options.accent && style.accentUsage === "dot"
        ? dotSize + style.spacing[1]
        : 0);
  const heading = layoutText(
    {
      text,
      box: { x: textX, y: cursor, width: box.width - (textX - box.x), height: 0 },
      style: headingStyle,
      color: options.color ?? style.color.ink,
      role: options.role ?? "heading",
      semanticId: options.semanticId,
      align: options.center ? "center" : "start",
    },
    context
  );
  if (heading.height > box.height && box.height > 0) overflow = true;
  primitives.push(heading.primitive);
  // The heading occupies exactly its own height; an accent may push the block a
  // little further, and that is what the returned height must report.
  let bottom = cursor + heading.height;

  if (options.accent) {
    switch (style.accentUsage) {
      case "underline": {
        const y = round(cursor + heading.height + style.spacing[0] * 0.5);
        primitives.push(
          linePrimitive(
            { x: box.x, y },
            { x: box.x + Math.min(box.width, heading.wrap.width), y },
            { stroke: style.color.accent, strokeWidth: style.stroke.strong, role: "accent-rule" },
            context
          )
        );
        cursor = y + style.spacing[1];
        bottom = Math.max(bottom, cursor);
        break;
      }
      case "bar": {
        primitives.push(
          rectPrimitive(
            { x: box.x, y: cursor, width: barWidth, height: heading.height },
            { fill: style.color.accent, role: "accent-bar" },
            context
          )
        );
        break;
      }
      case "dot": {
        // Centred on the first line's x-height band, in the gutter the text was
        // indented by, so it never sits on top of the first letter.
        const radius = dotSize;
        const firstLine = heading.primitive.fontSize * heading.primitive.lineHeight;
        primitives.push(
          rectPrimitive(
            { x: box.x, y: round(cursor + firstLine * 0.55 - radius / 2), width: radius, height: radius },
            { fill: style.color.accent, radius: style.radius.pill, role: "accent-dot" },
            context
          )
        );
        break;
      }
      case "fill": {
        const boxRect: RectInfo = {
          x: round(box.x - style.spacing[0]),
          y: round(cursor - style.spacing[0] * 0.5),
          width: round(box.width + style.spacing[0] * 2),
          height: round(heading.height + style.spacing[0] * 2),
        };
        // The fill sits *behind* the heading: insert it before the heading
        // text, or it paints over the words it is meant to highlight.
        const headingIndex = primitives.indexOf(heading.primitive);
        primitives.splice(
          headingIndex,
          0,
          rectPrimitive(
            { ...boxRect },
            { fill: style.color.surfaceAlt, radius: style.radius.md, role: "accent-fill" },
            context
          )
        );
        break;
      }
      default:
        break;
    }
  }

  const height = Math.max(bottom - box.y, heading.height);
  return { primitives, height: round(height), overflow };
}

/** A source/evidence footnote line. Returns `null` when there is nothing to cite. */
export function evidenceNote(
  box: RectInfo,
  refs: readonly string[],
  style: ResolvedStyle,
  context: SectionRenderContext,
  options?: { sourceLabel?: string }
): TextPrimitive | null {
  const labels = refs
    .map((ref) => context.evidenceLabel(ref))
    .filter((label): label is string => Boolean(label));
  if (labels.length === 0) return null;
  const source = options?.sourceLabel;
  const text = `${source ? `${source} ` : ""}${labels.map((label) => `[${label}]`).join(" ")}`;
  return layoutText(
    {
      text,
      box,
      style: typeStyle(style, "caption", { family: style.font.body, weight: style.weight.body }),
      color: style.color.inkSubtle,
      role: "evidence-note",
      tabular: true,
    },
    context
  ).primitive;
}

/** A rounded label chip (used for units, periods, step states, legend keys). */
export function chipPrimitives(
  box: RectInfo,
  text: string,
  style: ResolvedStyle,
  context: SectionRenderContext,
  options?: { fill?: string; color?: string; role?: string; semanticId?: string; align?: TextAlign }
): { primitives: InfographicPrimitive[]; width: number } {
  const paddingX = style.spacing[1];
  const textStyle = typeStyle(style, "label", { family: style.font.heading });
  const label = labelCase(style, text);
  const textWidth = measureText(label, textStyle);
  const width = round(Math.min(box.width, textWidth + paddingX * 2));
  const rect: RectInfo = { x: box.x, y: box.y, width, height: round(textStyle.fontSize * 1.9) };
  const primitives: InfographicPrimitive[] = [
    rectPrimitive(
      rect,
      {
        fill: options?.fill ?? style.color.surfaceAlt,
        radius: style.radius.pill,
        role: options?.role ?? "chip",
        semanticId: options?.semanticId,
      },
      context
    ),
    layoutText(
      {
        text: label,
        box: { x: rect.x + paddingX, y: rect.y, width: rect.width - paddingX * 2, height: rect.height },
        style: textStyle,
        color: options?.color ?? style.color.inkMuted,
        role: "chip-label",
        align: options?.align ?? "center",
        valign: "middle",
        maxLines: 1,
      },
      context
    ).primitive,
  ];
  return { primitives, width };
}

// ---------------------------------------------------------------------------
// Connectors
// ---------------------------------------------------------------------------

export interface Point {
  x: number;
  y: number;
}

export type ConnectorRoute = "straight" | "orthogonal" | "curve";

/**
 * Resolve the waypoints of a connector. `orthogonal` uses a mid-axis split so
 * routing is symmetric and readable; `curve` returns a two-point line that the
 * caller expands into a cubic path (see {@link connectorPrimitives}).
 */
export function routePoints(from: Point, to: Point, route: ConnectorRoute): Point[] {
  if (route === "orthogonal") {
    const horizontalFirst = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y);
    if (horizontalFirst) {
      const midX = round((from.x + to.x) / 2);
      return [from, { x: midX, y: from.y }, { x: midX, y: to.y }, to];
    }
    const midY = round((from.y + to.y) / 2);
    return [from, { x: from.x, y: midY }, { x: to.x, y: midY }, to];
  }
  return [from, to];
}

function arrowHeadPoints(tip: Point, from: Point, size: number): string {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  const spread = 0.42;
  const left = {
    x: round(tip.x - Math.cos(angle - spread) * size),
    y: round(tip.y - Math.sin(angle - spread) * size),
  };
  const right = {
    x: round(tip.x - Math.cos(angle + spread) * size),
    y: round(tip.y - Math.sin(angle + spread) * size),
  };
  return `M ${round(tip.x)} ${round(tip.y)} L ${left.x} ${left.y} L ${right.x} ${right.y} Z`;
}

/** The point `distance` back from `tip` towards `from` (never past `from`). */
function towards(tip: Point, from: Point, distance: number): Point {
  const length = Math.hypot(tip.x - from.x, tip.y - from.y);
  if (length === 0 || distance <= 0) return tip;
  const t = Math.min(distance, length) / length;
  return { x: round(tip.x - (tip.x - from.x) * t), y: round(tip.y - (tip.y - from.y) * t) };
}

/**
 * SVG path through `points` with each interior corner rounded by a quadratic
 * curve of up to `radius` (clamped to half of each adjoining segment). Uses
 * absolute `M`/`L`/`Q` commands only, so {@link primitiveBounds} stays exact.
 */
export function roundedPolylinePath(points: readonly Point[], radius: number): string {
  if (points.length === 0) return "";
  const parts = [`M ${round(points[0].x)} ${round(points[0].y)}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];
    const inLength = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const outLength = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(radius, inLength / 2, outLength / 2);
    if (r < 0.5) {
      parts.push(`L ${round(corner.x)} ${round(corner.y)}`);
      continue;
    }
    const entry = towards(corner, previous, r);
    const exit = towards(corner, next, r);
    parts.push(`L ${entry.x} ${entry.y}`, `Q ${round(corner.x)} ${round(corner.y)} ${exit.x} ${exit.y}`);
  }
  const last = points[points.length - 1];
  if (points.length > 1) parts.push(`L ${round(last.x)} ${round(last.y)}`);
  return parts.join(" ");
}

export interface ConnectorOptions {
  style: ResolvedStyle;
  /** @default style.connector.route */
  route?: ConnectorRoute;
  /** @default style.connector.arrow */
  arrow?: MarkerKind;
  color?: string;
  width?: number;
  dash?: DashPattern;
  /** Extra clearance at each end, so the line does not touch the node edge. */
  clearance?: number;
  /** Elbow rounding for orthogonal routes. @default max(radius.sm, 0.75 × marker) */
  cornerRadius?: number;
  role?: string;
  semanticId?: string;
}

/**
 * Draw a connector between two points, including the arrowhead marker that the
 * IR expresses as a filled path (so preview and export draw identical geometry;
 * neither relies on SVG `marker-end`).
 */
export function connectorPrimitives(
  from: Point,
  to: Point,
  options: ConnectorOptions,
  context: SectionRenderContext
): InfographicPrimitive[] {
  const { style } = options;
  const route = options.route ?? style.connector.route;
  const clearance = options.clearance ?? 0;
  const color = options.color ?? style.color.connector;
  const width = options.width ?? style.stroke.connector;
  const arrow = options.arrow ?? style.connector.arrow;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const start: Point = { x: from.x + (dx / length) * clearance, y: from.y + (dy / length) * clearance };
  const end: Point = { x: to.x - (dx / length) * clearance, y: to.y - (dy / length) * clearance };

  const primitives: InfographicPrimitive[] = [];
  const markerSize = style.connector.markerSize;
  // An arrowhead owns the last `markerSize` of the route: the stroke stops a
  // little inside the head's base so the tip stays sharp and nothing pokes out.
  const headLength = arrow === "arrow" ? markerSize * 0.85 : 0;
  let tail: Point;

  if (route === "curve") {
    const midX = (start.x + end.x) / 2;
    tail = { x: midX, y: end.y };
    const stop = towards(end, tail, headLength);
    const d = `M ${round(start.x)} ${round(start.y)} C ${round(midX)} ${round(start.y)} ${round(midX)} ${round(end.y)} ${round(stop.x)} ${round(stop.y)}`;
    primitives.push(
      pathPrimitive(
        d,
        {
          fill: "none",
          stroke: color,
          strokeWidth: width,
          dash: options.dash,
          role: options.role ?? "connector",
          semanticId: options.semanticId,
        },
        context
      )
    );
  } else {
    const points = routePoints(start, end, route);
    tail = points[points.length - 2] ?? start;
    const trimmed = [...points.slice(0, -1), towards(end, tail, headLength)];
    primitives.push(
      pathPrimitive(
        roundedPolylinePath(trimmed, options.cornerRadius ?? Math.max(style.radius.sm, markerSize * 0.75)),
        {
          fill: "none",
          stroke: color,
          strokeWidth: width,
          dash: options.dash,
          role: options.role ?? "connector",
          semanticId: options.semanticId,
        },
        context
      )
    );
  }

  if (arrow === "arrow") {
    primitives.push(
      pathPrimitive(arrowHeadPoints(end, tail, markerSize), { fill: color, role: "connector-arrow", semanticId: options.semanticId }, context)
    );
  } else if (arrow === "bar") {
    const angle = Math.atan2(end.y - tail.y, end.x - tail.x) + Math.PI / 2;
    const half = markerSize * 0.5;
    primitives.push(
      linePrimitive(
        { x: end.x - Math.cos(angle) * half, y: end.y - Math.sin(angle) * half },
        { x: end.x + Math.cos(angle) * half, y: end.y + Math.sin(angle) * half },
        { stroke: color, strokeWidth: width, role: "connector-bar" },
        context
      )
    );
  } else if (arrow === "dot") {
    const radius = markerSize * 0.4;
    primitives.push(
      rectPrimitive(
        { x: end.x - radius, y: end.y - radius, width: radius * 2, height: radius * 2 },
        { fill: color, radius: style.radius.pill, role: "connector-dot" },
        context
      )
    );
  }

  return primitives;
}

/** Baseline `y` for a text primitive's line `index`, in absolute canvas space. */
export function textBaseline(primitive: TextPrimitive, index: number): number {
  return round(primitive.y + baselineOffset(index, primitive.fontSize, primitive.lineHeight));
}

/** Effective width of one line of a text primitive, honoring letter spacing. */
export function textLineWidth(primitive: TextPrimitive, line: string): number {
  return measureText(line, {
    fontSize: primitive.fontSize,
    family: primitive.family,
    letterSpacing: primitive.letterSpacing,
  });
}

// ---------------------------------------------------------------------------
// Primitive bounds (containment guard)
// ---------------------------------------------------------------------------

const PATH_NUMBER = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;

/**
 * Bounding box of one primitive, or `null` when it has no measurable extent.
 *
 * Arced paths (`A`/`a` commands — donut slices) are deliberately skipped: their
 * arc arguments do not share the coordinate-pair grammar the other commands use,
 * so a naive scan would invent a box. They are always inside their own frame.
 */
export function primitiveBounds(primitive: InfographicPrimitive): RectInfo | null {
  switch (primitive.kind) {
    case "rect":
    case "ellipse":
      return { x: primitive.x, y: primitive.y, width: primitive.width, height: primitive.height };
    case "text":
      return { x: primitive.x, y: primitive.y, width: primitive.width, height: primitive.height };
    case "line": {
      const x = Math.min(primitive.x1, primitive.x2);
      const y = Math.min(primitive.y1, primitive.y2);
      return {
        x,
        y,
        width: Math.abs(primitive.x2 - primitive.x1),
        height: Math.abs(primitive.y2 - primitive.y1),
      };
    }
    case "polyline": {
      if (primitive.points.length === 0) return null;
      const xs = primitive.points.map((point) => point[0]);
      const ys = primitive.points.map((point) => point[1]);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
    }
    case "path": {
      if (/[Aa]/.test(primitive.d)) return null;
      const numbers = (primitive.d.match(PATH_NUMBER) ?? []).map(Number);
      if (numbers.length < 2) return null;
      const xs: number[] = [];
      const ys: number[] = [];
      for (let index = 0; index + 1 < numbers.length; index += 2) {
        xs.push(numbers[index]);
        ys.push(numbers[index + 1]);
      }
      if (xs.length === 0) return null;
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
    }
    default:
      return null;
  }
}

/** Bounding box of a primitive list, or `null` when nothing is measurable. */
export function primitivesBounds(primitives: readonly InfographicPrimitive[]): RectInfo | null {
  let box: RectInfo | null = null;
  for (const primitive of primitives) {
    const next = primitiveBounds(primitive);
    if (!next) continue;
    if (!box) {
      box = { ...next };
      continue;
    }
    const right = Math.max(rectRight(box), rectRight(next));
    const bottom = Math.max(rectBottom(box), rectBottom(next));
    box = {
      x: Math.min(box.x, next.x),
      y: Math.min(box.y, next.y),
      width: right - Math.min(box.x, next.x),
      height: bottom - Math.min(box.y, next.y),
    };
  }
  return box;
}

/**
 * How far a box exceeds `frame` on the worst side, in design px (0 when inside).
 */
export function boundsOverflow(box: RectInfo | null, frame: RectInfo): number {
  if (!box) return 0;
  const top = frame.y - box.y;
  const left = frame.x - box.x;
  const bottom = rectBottom(box) - rectBottom(frame);
  const right = rectRight(box) - rectRight(frame);
  return Math.max(0, top, left, bottom, right);
}
