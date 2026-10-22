/**
 * Shared grammar for the economic charts (`CostWaterfall`, `LifecycleCostTimeline`,
 * `BreakEvenComparison`).
 *
 * The charts draw **precomputed** values. Kumiki never prices, discounts,
 * amortizes or inflates anything; it only refuses to blur what the author
 * declared. Three rules hold throughout:
 *
 * 1. **Units and bases are declared, never inferred.** A money unit names its
 *    currency (or a plain unit) and its basis (`nominal`, `real`,
 *    `present-value`). Series with a different cadence or basis are rejected with
 *    a diagnostic, never silently converted.
 * 2. **Exact reconciliation.** Sums are taken in integer minor units (cents,
 *    yen…) so totals add up exactly; display rounding is a labeled presentation
 *    step that never changes a total.
 * 3. **`null` is unknown.** Missing values are drawn and captioned as missing,
 *    distinct from zero and from negative values.
 *
 * Output is the infographic primitive IR (rect/line/polyline/path/text), so the
 * React preview (`EconomicChartView`) and the static SVG exporter draw identical
 * geometry. Rendering is a pure function of the spec and an absolute frame.
 */

import { getArtDirection } from "./art-direction";
import { formatNumber } from "./measure";
import {
  createIdFactory,
  layoutTextForRole,
  niceStep,
  overlapArea,
  rectPrimitive,
  round,
  textLineWidth,
} from "./primitives";
import type { TypeRole } from "./primitives";
import type {
  ArtDirectionId,
  InfographicDiagnostic,
  InfographicPrimitive,
  RectInfo,
  ResolvedStyle,
  SectionRenderContext,
  TextAlign,
  TextPrimitive,
} from "./types";

// ---------------------------------------------------------------------------
// Units, bases and provenance
// ---------------------------------------------------------------------------

/** What a money amount means. Kumiki labels it; it never converts between bases. */
export type CurrencyBasis = "nominal" | "real" | "present-value";

export interface MoneyUnit {
  /** ISO 4217 code (`"USD"`, `"EUR"`, `"JPY"`). Omit for non-currency quantities and set `unit`. */
  currency?: string;
  /** Plain unit for non-currency charts, e.g. `"kWh"` or `"hours"`. */
  unit?: string;
  /** Minor-unit digits used for exact sums. @default the currency's own (USD 2, JPY 0), or 2 for plain units. */
  minorDigits?: number;
  /** Required for time-based charts so real and nominal values are never mixed. */
  basis?: CurrencyBasis;
  /** Reference for `real` / `present-value`, e.g. `"2025 dollars"` or `"discounted at the source's rate"`. */
  basisReference?: string;
}

/** Where the numbers came from. Shown in the footer; required for honest charts. */
export interface DataProvenance {
  source?: string;
  /** Date or period the data describes, e.g. `"2026 quotes"`. */
  asOf?: string;
  note?: string;
  /** Marks example data so a caption says so. */
  illustrative?: boolean;
}

export const BASIS_LABELS: Record<CurrencyBasis, string> = {
  nominal: "nominal",
  real: "real (inflation-adjusted)",
  "present-value": "present value",
};

const minorCache = new Map<string, number>();

/** Minor-unit digits for exact sums (USD → 2, JPY → 0). */
export function minorDigitsOf(unit: MoneyUnit): number {
  if (unit.minorDigits !== undefined) return Math.max(0, Math.min(6, Math.round(unit.minorDigits)));
  if (!unit.currency) return 2;
  const cached = minorCache.get(unit.currency);
  if (cached !== undefined) return cached;
  let digits = 2;
  try {
    digits = new Intl.NumberFormat("en", { style: "currency", currency: unit.currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    digits = 2;
  }
  minorCache.set(unit.currency, digits);
  return digits;
}

/** Quantize to integer minor units, rounding half away from zero. Float noise (0.145 × 100) is removed first. */
export function toMinor(value: number, digits: number): number {
  const scaled = Number((Math.abs(value) * 10 ** digits).toPrecision(15));
  return Math.sign(value) * Math.round(scaled);
}

export function fromMinor(minor: number, digits: number): number {
  return minor / 10 ** digits;
}

export interface MoneyFormatOptions {
  language?: string;
  /** Compact notation (`$12K`) for ticks and dense labels. */
  compact?: boolean;
  /** Prefix `+` / `−` so direction never depends on color. */
  signed?: boolean;
  /** Fraction digits; defaults to 0 for amounts ≥ 100 and the minor digits otherwise. */
  precision?: number;
}

/** Locale-aware money (or plain-unit) text. Never changes the value, only its presentation. */
export function formatMoney(value: number, unit: MoneyUnit, options: MoneyFormatOptions = {}): string {
  if (!Number.isFinite(value)) return "—";
  const { language, compact = false, signed = false } = options;
  const magnitude = Math.abs(value);
  // Compact keeps significant digits for small fractional amounts (e.g. $0.153 per kWh) instead of rounding them to $0.
  const fractional = Math.abs(magnitude - Math.round(magnitude)) > 1e-9;
  const precision = options.precision ?? (compact
    ? magnitude >= 1000 ? (magnitude < 10000 ? 1 : 0) : fractional && magnitude < 100 ? minorDigitsOf(unit) : 0
    : magnitude >= 100 ? 0 : minorDigitsOf(unit));
  let text: string;
  if (unit.currency) {
    try {
      text = new Intl.NumberFormat(language, {
        style: "currency",
        currency: unit.currency,
        notation: compact ? "compact" : "standard",
        minimumFractionDigits: compact ? 0 : precision,
        maximumFractionDigits: precision,
      }).format(magnitude);
    } catch {
      text = `${formatNumber(magnitude, { language, precision, compact })} ${unit.currency}`;
    }
  } else {
    text = `${formatNumber(magnitude, { language, precision, compact })}${unit.unit ? ` ${unit.unit}` : ""}`;
  }
  if (value < 0) return `−${text}`;
  if (signed && value > 0) return `+${text}`;
  return text;
}

/** Axis tick formatter: compact for large steps, enough fraction digits for small ones (never more than the minor digits). */
export function tickFormatter(step: number, unit: MoneyUnit, language?: string, signed = false): (v: number) => string {
  if (step >= 1) return (v) => formatMoney(v, unit, { language, compact: true, signed });
  const digits = Math.min(Math.max(minorDigitsOf(unit), 0) || 2, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)));
  return (v) => formatMoney(v, unit, { language, precision: digits, signed });
}

/** The unit line under a chart title: `"USD · real (inflation-adjusted), 2025 dollars"`. */
export function unitLine(unit: MoneyUnit, extra?: string): string {
  const parts: string[] = [];
  const name = unit.currency ?? unit.unit;
  if (name) parts.push(name);
  if (unit.basis) parts.push(`${BASIS_LABELS[unit.basis]}${unit.basisReference ? `, ${unit.basisReference}` : ""}`);
  if (extra) parts.push(extra);
  return parts.join(" · ");
}

/** Footer lines for provenance; an undeclared source is stated, not hidden. */
export function provenanceLines(provenance: DataProvenance | undefined): string[] {
  const lines: string[] = [];
  const p = provenance ?? {};
  const source = p.source ? `Source: ${p.source}${p.asOf ? ` (${p.asOf})` : ""}.` : "Source: not declared.";
  lines.push(p.illustrative ? `Illustrative data. ${source}` : source);
  if (p.note) lines.push(p.note);
  return lines;
}

// ---------------------------------------------------------------------------
// Time axis (years or months)
// ---------------------------------------------------------------------------

export interface TimeAxisSpec {
  /** Period length. Series must declare the same cadence. */
  unit: "year" | "month";
  /** Axis value of the first period: a calendar year (`2026`) or a relative index (`1`). */
  start: number;
  /** Number of periods on the horizon. */
  count: number;
  /** `calendar` prints `2031` / `Mar 2026`; `relative` prints `Yr 6` / `Mo 6`. @default calendar for years ≥ 1000, else relative */
  labels?: "calendar" | "relative";
  /** For calendar months: the first month as `YYYY-MM`. @default "2026-01" */
  startMonth?: string;
  /** Axis title, e.g. `"Year of ownership"`. */
  title?: string;
}

export type Cadence = "per-year" | "per-month";

export function cadenceOf(axis: TimeAxisSpec): Cadence {
  return axis.unit === "year" ? "per-year" : "per-month";
}

export function axisLabelMode(axis: TimeAxisSpec): "calendar" | "relative" {
  return axis.labels ?? (axis.unit === "year" && axis.start >= 1000 ? "calendar" : "relative");
}

/** Label for period index `i` (0-based), or for a fractional axis position. */
export function periodLabel(axis: TimeAxisSpec, index: number, language?: string, long = false): string {
  const value = axis.start + index;
  const shown = Number.isInteger(value) ? String(value) : formatNumber(value, { precision: 1, language, grouping: false });
  if (axisLabelMode(axis) === "relative") return axis.unit === "year" ? `${long ? "Year" : "Yr"} ${shown}` : `${long ? "Month" : "Mo"} ${shown}`;
  if (axis.unit === "year") return shown;
  const [y, m] = (axis.startMonth ?? "2026-01").split("-").map(Number);
  const date = new Date(Date.UTC(y, (m || 1) - 1 + Math.floor(index), 1));
  return new Intl.DateTimeFormat(language ?? "en", { month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

/** Period index (0-based, may be fractional) for an authored axis value; `null` when off the horizon. */
export function periodIndexOf(axis: TimeAxisSpec, at: number): number | null {
  const index = at - axis.start;
  if (!Number.isFinite(index) || index < 0 || index > axis.count - 1 + 1e-9) return null;
  return index;
}

/** A series aligned to the time axis, validated for cadence and basis. Returns `null` (with diagnostics) if unusable. */
export function checkAlignedSeries(
  label: string,
  path: string,
  values: readonly (number | null)[],
  meta: { cadence?: Cadence; basis?: CurrencyBasis },
  axis: TimeAxisSpec,
  unit: MoneyUnit,
  report: (d: InfographicDiagnostic) => void,
  options: { requireCadence?: boolean } = {}
): (number | null)[] | null {
  const want = cadenceOf(axis);
  if (meta.cadence && meta.cadence !== want) {
    report({ code: "cadence-mismatch", severity: "error", message: `"${label}" is ${meta.cadence} but the axis is ${want}; convert it before charting (Kumiki never rescales monthly/yearly values). Omitted.`, path });
    return null;
  }
  if (!meta.cadence && options.requireCadence) {
    report({ code: "cadence-undeclared", severity: "warning", message: `"${label}" does not declare a cadence; assumed ${want} to match the axis.`, path });
  }
  if (meta.basis && unit.basis && meta.basis !== unit.basis) {
    report({ code: "basis-mismatch", severity: "error", message: `"${label}" is in ${BASIS_LABELS[meta.basis]} terms but the chart is ${BASIS_LABELS[unit.basis]}; values in different bases cannot share an axis. Omitted.`, path });
    return null;
  }
  if (values.length !== axis.count) {
    report({ code: "series-length-mismatch", severity: "error", message: `"${label}" has ${values.length} values for ${axis.count} periods; missing periods are treated as unknown and extra values are ignored.`, path });
  }
  return Array.from({ length: axis.count }, (_, i) => {
    const v = values[i];
    return v === undefined || v === null || !Number.isFinite(v) ? null : v;
  });
}

// ---------------------------------------------------------------------------
// Render context, chrome and checks
// ---------------------------------------------------------------------------

export interface EconomicChartOptions {
  /** Design-px canvas. Use 1920×1080 / 1080×1920 for video, or any size. */
  width: number;
  height: number;
  /** Art direction id or a resolved (possibly overridden) style. @default "minimal-technical" */
  style?: ArtDirectionId | ResolvedStyle;
  /** BCP-47 tag for numbers, dates and line breaking. @default "en" */
  language?: string;
  /** Absolute frame for the timed reveal; omit for the fully revealed chart. */
  frame?: number;
  /** Outer padding in design px. @default 5% of the shorter edge */
  padding?: number;
  /** Draw the canvas background. @default true */
  background?: boolean;
}

export interface EconomicChartResult {
  width: number;
  height: number;
  /** Canvas color, for hosts that letterbox. */
  background: string;
  primitives: InfographicPrimitive[];
  /** Accessible one-paragraph description of what is drawn. */
  summary: string;
  title: string;
  diagnostics: InfographicDiagnostic[];
  /** Plot rect(s) by name, for annotation and camera targets. */
  anchors: Record<string, RectInfo>;
  /** Frame at which the reveal completes (holds after). */
  revealEnd: number;
}

export interface ChartScope {
  style: ResolvedStyle;
  language: string;
  context: SectionRenderContext;
  diagnostics: InfographicDiagnostic[];
  primitives: InfographicPrimitive[];
  push: (...p: InfographicPrimitive[]) => void;
  text: (input: TextInput) => TextPrimitive;
}

export interface TextInput {
  text: string;
  box: RectInfo;
  typeRole: TypeRole;
  color?: string;
  role?: string;
  semanticId?: string;
  align?: TextAlign;
  valign?: "top" | "middle" | "bottom";
  weight?: number;
  size?: number;
  opacity?: number;
  tabular?: boolean;
  maxLines?: number;
}

export function resolveChartStyle(style: EconomicChartOptions["style"]): ResolvedStyle {
  if (!style) return getArtDirection("minimal-technical");
  return typeof style === "string" ? getArtDirection(style) : style;
}

/** A deterministic render scope: ids, diagnostics and a text helper bound to one style. */
export function createChartScope(prefix: string, options: EconomicChartOptions): ChartScope {
  const style = resolveChartStyle(options.style);
  const language = options.language ?? "en";
  const diagnostics: InfographicDiagnostic[] = [];
  const context: SectionRenderContext = {
    style,
    language,
    evidence: new Map(),
    evidenceLabel: () => undefined,
    id: createIdFactory(prefix),
    report: (d) => diagnostics.push(d),
  };
  const primitives: InfographicPrimitive[] = [];
  const scope: ChartScope = {
    style,
    language,
    context,
    diagnostics,
    primitives,
    push: (...p) => { primitives.push(...p); },
    text: (input) => {
      const result = layoutTextForRole(
        {
          text: input.text,
          box: input.box,
          typeRole: input.typeRole,
          overrides: { ...(input.weight ? { weight: input.weight } : {}), ...(input.size ? { fontSize: input.size } : {}) },
          color: input.color ?? style.color.ink,
          role: input.role,
          semanticId: input.semanticId,
          align: input.align,
          valign: input.valign,
          opacity: input.opacity,
          tabular: input.tabular,
          maxLines: input.maxLines,
          language,
        },
        context
      );
      if (result.wrap.truncated) {
        diagnostics.push({ code: "text-truncated", severity: "warning", message: `Label "${input.text}" was truncated to ${input.maxLines} line(s).`, primitiveId: result.primitive.id });
      }
      return result.primitive;
    },
  };
  return scope;
}

/** Measured width of a single-line label in a type role. */
export function labelWidth(scope: ChartScope, text: string, typeRole: TypeRole, weight?: number, size?: number): number {
  const probe = scope.text({ text, box: { x: 0, y: 0, width: 1e5, height: 1e3 }, typeRole, weight, size });
  return Math.max(0, ...probe.lines.map((l) => textLineWidth(probe, l)));
}

/** Height of one text line in a type role. */
export function lineBox(style: ResolvedStyle, typeRole: TypeRole, size?: number): number {
  const fs = size ?? style.type[typeRole];
  const lh = typeRole === "title" || typeRole === "h2" || typeRole === "h3" ? style.lineHeight.heading : typeRole === "body" ? style.lineHeight.body : style.lineHeight.annotation;
  return round(fs * lh);
}

export interface ChromeResult {
  /** The area left for the plot(s) and legend. */
  body: RectInfo;
  title: string;
}

/**
 * Background, title, unit/basis line and footer captions. The footer is laid out
 * first (bottom-up) so captions are never pushed off the canvas; the remaining
 * rect is returned for the plot.
 */
export function drawChrome(
  scope: ChartScope,
  options: EconomicChartOptions,
  heading: { title: string; subtitle?: string; unit: string },
  footer: readonly string[]
): ChromeResult {
  const { style } = scope;
  const { width, height } = options;
  const pad = options.padding ?? Math.round(Math.min(width, height) * 0.05);
  if (options.background !== false) {
    scope.push(rectPrimitive({ x: 0, y: 0, width, height }, { fill: style.color.canvas, role: "infographic-background" }, scope.context));
  }
  const inner = { x: pad, y: pad, width: width - pad * 2, height: height - pad * 2 };
  const gap = style.spacing[1] ?? 16;
  let y = inner.y;
  const portrait = height > width;
  const titleSize = Math.min(style.type.h2, Math.round(Math.min(width, height) * (portrait ? 0.052 : 0.042)));
  const title = scope.text({ text: heading.title, box: { x: inner.x, y, width: inner.width, height: 400 }, typeRole: "h2", size: titleSize, role: "chart-title" });
  scope.push(title);
  y += title.height + gap * 0.5;
  if (heading.subtitle) {
    const sub = scope.text({ text: heading.subtitle, box: { x: inner.x, y, width: Math.min(inner.width, style.measureMax * 1.6), height: 400 }, typeRole: "body", color: style.color.inkMuted, role: "chart-subtitle" });
    scope.push(sub);
    y += sub.height + gap * 0.35;
  }
  if (heading.unit) {
    const unit = scope.text({ text: heading.unit, box: { x: inner.x, y, width: inner.width, height: 200 }, typeRole: "caption", color: style.color.inkSubtle, role: "chart-unit", tabular: true });
    scope.push(unit);
    y += unit.height;
  }
  y += gap * 1.25;

  // Footer: bottom-up.
  let bottom = inner.y + inner.height;
  const captions: TextPrimitive[] = [];
  for (const line of [...footer].reverse()) {
    const probe = scope.text({ text: line, box: { x: inner.x, y: 0, width: inner.width, height: 400 }, typeRole: "caption", color: style.color.inkMuted, role: "chart-caption" });
    bottom -= probe.height;
    probe.y = round(bottom);
    captions.unshift(probe);
    bottom -= gap * 0.25;
  }
  scope.push(...captions);
  if (captions.length) bottom -= gap;
  return { body: { x: inner.x, y, width: inner.width, height: Math.max(0, bottom - y) }, title: heading.title };
}

/**
 * Nice value axis that includes zero unless `zero: false`. `tight` keeps a small
 * negative extent (e.g. one credit) from claiming a whole tick step: the domain
 * ends just past the data and only ticks inside it are drawn.
 */
export function valueAxis(min: number, max: number, options: { zero?: boolean; target?: number; tight?: boolean } = {}) {
  const zero = options.zero ?? true;
  let lo = zero ? Math.min(0, min) : min;
  let hi = zero ? Math.max(0, max) : max;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
  if (hi - lo < 1e-9) { const pad = Math.abs(hi) * 0.1 || 1; hi += pad; if (!zero) lo -= pad; }
  const step = niceStep((hi - lo) / Math.max(1, (options.target ?? 5) - 1));
  const a = Math.floor(lo / step + 1e-9) * step;
  const b = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  const dMin = options.tight && lo < a + step * 0.999 && lo < 0 ? Math.min(lo * 1.18, lo - step * 0.08) : a;
  const lowest = Math.max(a, dMin);
  for (let t = a; t <= b + step * 1e-6 && ticks.length < 40; t += step) if (t >= lowest - step * 1e-6 || !options.tight) ticks.push(round(t, 6));
  return { min: options.tight ? Math.max(a, dMin) : a, max: b, step, ticks, truncated: !zero && a > 0 };
}

/** Linear scale helper. */
export function scaleLinear(d0: number, d1: number, r0: number, r1: number) {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v: number) => r0 + (v - d0) * k;
}

/** Ease-out reveal progress in [0, 1] for an absolute frame. `frame === undefined` → 1. */
export function revealProgress(frame: number | undefined, start: number, duration: number): number {
  if (frame === undefined) return 1;
  if (duration <= 0) return frame >= start ? 1 : 0;
  const t = Math.max(0, Math.min(1, (frame - start) / duration));
  return 1 - (1 - t) ** 3;
}

/** Linear (un-eased) progress, for playheads that must move at constant speed. */
export function linearProgress(frame: number | undefined, start: number, duration: number): number {
  if (frame === undefined) return 1;
  if (duration <= 0) return frame >= start ? 1 : 0;
  return Math.max(0, Math.min(1, (frame - start) / duration));
}

/** Ink box of a text primitive: the measured width of its lines, honoring alignment. */
export function textInkBounds(p: TextPrimitive): RectInfo {
  const w = Math.max(0, ...p.lines.map((l) => textLineWidth(p, l)));
  const x = p.align === "end" ? p.x + p.width - w : p.align === "center" ? p.x + (p.width - w) / 2 : p.x;
  return { x, y: p.y, width: w, height: p.height };
}

/**
 * Deterministic text-collision and containment guard over rendered bounds: any
 * two visible labels whose ink boxes overlap, or a label leaving the canvas, is
 * reported. Cheap enough to run on every frame of a reveal.
 */
export function checkTextLayout(primitives: readonly InfographicPrimitive[], width: number, height: number, report: (d: InfographicDiagnostic) => void) {
  const texts = primitives.filter((p): p is TextPrimitive => p.kind === "text" && (p.opacity ?? 1) > 0.05 && p.lines.some((l) => l.trim()));
  const boxes = texts.map(textInkBounds);
  for (let i = 0; i < texts.length; i++) {
    const b = boxes[i];
    if (b.x < -0.5 || b.y < -0.5 || b.x + b.width > width + 0.5 || b.y + b.height > height + 0.5) {
      report({ code: "text-outside-canvas", severity: "error", message: `Label "${texts[i].lines.join(" ")}" leaves the canvas.`, primitiveId: texts[i].id });
    }
    for (let j = i + 1; j < texts.length; j++) {
      const area = overlapArea(b, boxes[j]);
      if (area > Math.min(b.height, boxes[j].height) * 2) {
        report({ code: "text-collision", severity: "error", message: `Labels "${texts[i].lines.join(" ")}" and "${texts[j].lines.join(" ")}" overlap.`, primitiveId: texts[i].id, targetId: texts[j].id });
      }
    }
  }
}

/**
 * Spread label centers apart along one axis (e.g. line-end labels) so boxes of
 * `size` never overlap, staying inside [min, max]. Order is preserved.
 */
export function spreadLabels(centers: readonly number[], size: number, min: number, max: number): number[] {
  const order = centers.map((c, i) => [c, i] as const).sort((a, b) => a[0] - b[0]);
  const out = order.map(([c]) => Math.max(min + size / 2, Math.min(max - size / 2, c)));
  for (let k = 1; k < out.length; k++) out[k] = Math.max(out[k], out[k - 1] + size);
  const overflow = out.length ? out[out.length - 1] - (max - size / 2) : 0;
  if (overflow > 0) {
    out[out.length - 1] -= overflow;
    for (let k = out.length - 2; k >= 0; k--) out[k] = Math.min(out[k], out[k + 1] - size);
  }
  const result = new Array<number>(centers.length);
  order.forEach(([, i], k) => { result[i] = out[k]; });
  return result;
}

/**
 * Lanes for event labels with vertical guides down to a plot. Lane 0 is nearest
 * the plot. A label never overlaps another in its lane, and no guide crosses a
 * label: a label may not cover the guide of an event in a farther lane, and its
 * own guide may not pass through a label in a nearer lane.
 */
export function assignGuideLanes(items: readonly { x: number; span: [number, number] }[], gap: number): number[] {
  const n = items.length;
  const lanes = new Array<number>(n).fill(0);
  const inside = (x: number, s: [number, number]) => x >= s[0] - gap / 2 && x <= s[1] + gap / 2;
  const overlap = (a: [number, number], b: [number, number]) => a[0] < b[1] + gap && b[0] < a[1] + gap;
  // Relax constraints: a label covering another event's guide sits farther out than that event's label;
  // overlapping labels never share a lane. Mutual covering (a cycle) cannot be solved by lanes and is left
  // to the text-collision guard.
  for (let iter = 0, changed = true; changed && iter < n * n + 4; iter++) {
    changed = false;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const covers = inside(items[j].x, items[i].span) && !inside(items[i].x, items[j].span);
      const covered = inside(items[i].x, items[j].span) && !inside(items[j].x, items[i].span);
      if (covers && lanes[i] <= lanes[j]) { lanes[i] = lanes[j] + 1; changed = true; }
      else if (!covers && !covered && lanes[i] === lanes[j] && overlap(items[i].span, items[j].span) && (items[i].x > items[j].x || (items[i].x === items[j].x && i > j))) { lanes[i]++; changed = true; }
    }
  }
  return lanes.map((l) => Math.min(l, n));
}

/** Greedy lane assignment for horizontal labels at `[x0, x1]` spans; returns a lane per span. */
export function assignLanes(spans: readonly [number, number][], gap: number): number[] {
  const ends: number[] = [];
  return spans.map(([a, b]) => {
    let lane = ends.findIndex((e) => a >= e + gap);
    if (lane < 0) { lane = ends.length; ends.push(b); } else ends[lane] = b;
    return lane;
  });
}

/** Legend row(s): swatch + label chips, wrapped to the width. Returns the height used. */
export function drawLegend(
  scope: ChartScope,
  box: RectInfo,
  items: readonly { id: string; label: string; color: string; dashed?: boolean; dim?: boolean; marker?: "square" | "line" }[]
): number {
  const { style } = scope;
  const lh = lineBox(style, "label");
  const sw = Math.round(style.type.label * 0.8), gap = style.spacing[1] ?? 16;
  let x = box.x, y = box.y;
  for (const item of items) {
    const w = labelWidth(scope, item.label, "label") * 1.08 + sw + 14;
    if (x > box.x && x + w > box.x + box.width) { x = box.x; y += lh + 6; }
    const opacity = item.dim ? 0.4 : 1;
    if (item.marker === "line") {
      scope.push(rectPrimitive({ x, y: y + lh / 2 - 2, width: sw, height: 4 }, { fill: item.color, radius: 2, opacity, role: "legend-swatch", semanticId: item.id }, scope.context));
    } else {
      scope.push(rectPrimitive({ x, y: y + (lh - sw) / 2, width: sw, height: sw }, { fill: item.dashed ? "none" : item.color, stroke: item.dashed ? item.color : undefined, strokeWidth: item.dashed ? 2 : undefined, dash: item.dashed ? "dashed" : undefined, radius: style.radius.sm, opacity, role: "legend-swatch", semanticId: item.id }, scope.context));
    }
    scope.push(scope.text({ text: item.label, box: { x: x + sw + 8, y, width: w, height: lh }, typeRole: "label", color: style.color.inkMuted, role: "legend-label", semanticId: item.id, opacity }));
    x += w + gap * 1.25;
  }
  return y + lh - box.y;
}

/** Category color: explicit, else the style's series ramp. */
export function seriesColorAt(style: ResolvedStyle, index: number, explicit?: string): string {
  if (explicit) return explicit;
  const ramp = style.color.series;
  return ramp.length ? ramp[index % ramp.length] : style.color.accent;
}

/** Choose a tick interval (1, 2, 5, 10…) so `count` labels of `labelWidth` fit in `span`. */
export function labelInterval(count: number, span: number, labelW: number): number {
  const per = span / Math.max(1, count);
  for (const k of [1, 2, 5, 10, 20, 25, 50, 100]) if (per * k >= labelW * 1.25) return k;
  return Math.ceil(count / 2);
}

export function finish(scope: ChartScope, options: EconomicChartOptions, base: Omit<EconomicChartResult, "width" | "height" | "background" | "primitives" | "diagnostics">): EconomicChartResult {
  checkTextLayout(scope.primitives, options.width, options.height, (d) => scope.diagnostics.push(d));
  return { width: options.width, height: options.height, background: scope.style.color.canvas, primitives: scope.primitives, diagnostics: scope.diagnostics, ...base };
}
