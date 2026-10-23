/**
 * `chart-stage` — a chart is *decoded*, not decorated.
 *
 * The renderer takes a typed {@link ChartSpec} (categories, series, scale,
 * missing-value policy, unit, source note) and produces plot primitives plus the
 * disclosures that make the encoding honest. Three rules drive the design:
 *
 * 1. **One plot grammar, six recipes.** Bar, line, area, donut, scatter and
 *    heatmap share the same chrome (title → plot → legend → captions), the same
 *    axis construction and the same missing-value resolution, so a chart gains a
 *    recipe without gaining a new set of edge cases.
 * 2. **Disclosure is not optional.** A truncated value axis, an inferred point or
 *    a suppressed series always ships with a legible caption and a diagnostic
 *    (docs/12 §8). Nothing about the encoding is implied.
 * 3. **`null` is missing, never zero.** {@link resolveSeriesValues} is the only
 *    place a missing value becomes a number, and it reports what it did.
 *
 * Static export parity holds by construction: every mark is a rect, ellipse,
 * polyline or path, and every label goes through `layoutText`, so the SVG
 * exporter and the DOM preview draw the identical geometry.
 */

import { mixHex, readableOn } from "./color";
import { formatNumber, formatPercent, measureText } from "./measure";
import { sectionChrome } from "./blocks";
import {
  clamp,
  ellipsePrimitive,
  layoutText,
  layoutTextForRole,
  linePrimitive,
  niceStep,
  overlapArea,
  pathPrimitive,
  polylinePrimitive,
  rectPrimitive,
  round,
  typeStyle,
} from "./primitives";
import type {
  ChartRecipe,
  ChartSection,
  ChartSeries,
  ChartSpec,
  InfographicPrimitive,
  MissingPolicy,
  RectInfo,
  RenderResult,
  SectionRenderContext,
  SectionRenderer,
  TextPrimitive,
} from "./types";

// ---------------------------------------------------------------------------
// Pure value helpers
// ---------------------------------------------------------------------------

export interface ChartValueExtent {
  /** Smallest finite value (0 when there is none). */
  min: number;
  /** Largest finite value (1 when there is none). */
  max: number;
  /** Smallest strictly-positive finite value, if any. */
  minPositive: number | null;
  /** How many finite values were seen. */
  count: number;
  /** How many entries were `null`/non-finite. */
  missing: number;
}

/**
 * Extent of a series list. Nulls and non-finite numbers are counted as missing
 * and excluded from the extent — this is the function that keeps "missing" from
 * silently reading as "zero".
 */
export function chartValueExtent(series: readonly ChartSeries[]): ChartValueExtent {
  let min = Infinity;
  let max = -Infinity;
  let minPositive = Infinity;
  let count = 0;
  let missing = 0;

  for (const entry of series) {
    for (const value of entry.values) {
      if (value === null || value === undefined || !Number.isFinite(value)) {
        missing += 1;
        continue;
      }
      count += 1;
      if (value < min) min = value;
      if (value > max) max = value;
      if (value > 0 && value < minPositive) minPositive = value;
    }
  }

  return {
    min: count === 0 ? 0 : min,
    max: count === 0 ? 1 : max,
    minPositive: Number.isFinite(minPositive) ? minPositive : null,
    count,
    missing,
  };
}

export interface ChartDomain {
  min: number;
  max: number;
  /** True when the domain includes its zero point. */
  zero: boolean;
  kind: "linear" | "log";
}

/**
 * Resolve the value-axis domain. Bars and areas default to a zero baseline
 * because their length is the encoding; lines, dots and heatmaps do not, because
 * their *position* is. An authored `scale.domain` always wins.
 */
export function chartDomain(spec: ChartSpec): ChartDomain {
  const kind = spec.scale?.kind ?? "linear";
  const zeroByRecipe = spec.recipe === "bar" || spec.recipe === "area";
  const zero = spec.scale?.zero ?? zeroByRecipe;
  const extent = chartValueExtent(spec.series);

  let min = spec.scale?.domain?.[0] ?? extent.min;
  let max = spec.scale?.domain?.[1] ?? extent.max;

  if (kind === "log") {
    const floor = extent.minPositive ?? 1;
    if (!Number.isFinite(min) || min <= 0) min = floor;
    min = Math.max(min, floor);
    if (!Number.isFinite(max) || max <= min) max = min * 10;
  } else {
    if (!Number.isFinite(min)) min = 0;
    if (!Number.isFinite(max)) max = 1;
    if (zero) min = Math.min(0, min);
    if (max - min < Number.EPSILON * Math.max(1, Math.abs(max))) {
      const pad = Math.abs(max) > 0 ? Math.abs(max) * 0.1 : 1;
      max = max + pad;
      if (zero) min = Math.min(0, min);
    }
  }

  return { min: round(min, 6), max: round(max, 6), zero, kind };
}

/** True when the axis is usable for plotting. */
export function isUsableDomain(domain: ChartDomain): boolean {
  return (
    Number.isFinite(domain.min) &&
    Number.isFinite(domain.max) &&
    domain.max > domain.min &&
    (domain.kind === "linear" || domain.min > 0)
  );
}

/** Value → scaled space (log10 for logarithmic axes, identity otherwise). */
export function domainTransform(domain: ChartDomain): (value: number) => number {
  return domain.kind === "log" ? (value) => Math.log10(value) : (value) => value;
}

/**
 * Round, human-readable axis ticks inside `domain`. Log axes tick at powers of
 * ten in log space, which is the only reading of a logarithmic axis people
 * actually parse.
 */
export function chartTicks(domain: ChartDomain, targetCount = 5): number[] {
  if (!isUsableDomain(domain)) return [];
  const toT = domainTransform(domain);
  const tMin = toT(domain.min);
  const tMax = toT(domain.max);
  const step = niceStep((tMax - tMin) / Math.max(1, targetCount - 1));
  const fromT = domain.kind === "log" ? (t: number) => 10 ** t : (t: number) => t;

  const ticks: number[] = [];
  const start = Math.ceil(tMin / step) * step;
  for (let t = start; t <= tMax + step * 1e-6 && ticks.length < 64; t += step) {
    ticks.push(round(fromT(t), 6));
  }
  return ticks;
}

export const CHART_RECIPES: readonly ChartRecipe[] = [
  "bar",
  "line",
  "area",
  "donut",
  "scatter",
  "heatmap",
];

const RECIPE_LABELS: Record<ChartRecipe, string> = {
  bar: "Bar chart",
  line: "Line chart",
  area: "Area chart",
  donut: "Donut chart",
  scatter: "Scatter plot",
  heatmap: "Heatmap",
};

const MISSING_POLICY_CAPTIONS: Record<MissingPolicy, string> = {
  gap: "Missing values are shown as gaps — no mark is drawn for them.",
  zero: "Missing values are plotted as zero.",
  interpolate: "Missing values are interpolated between the nearest reported values.",
  suppress: "Series with missing values are omitted from the plot.",
};

/** One-line, screen-reader-friendly description of a chart. */
export function chartSummary(spec: ChartSpec, language?: string): string {
  const parts: string[] = [];
  const recipe = RECIPE_LABELS[spec.recipe] ?? "Chart";
  const categories = spec.categories ?? [];
  parts.push(`${recipe}: ${categories.length} categories, ${spec.series.length} series.`);

  for (const series of spec.series) {
    const shown = series.values.slice(0, 12).map((value) =>
      value === null || value === undefined ? "missing" : formatNumber(value, { language })
    );
    const suffix = series.values.length > 12 ? ", …" : "";
    const unit = spec.unit ? ` ${spec.unit}` : "";
    parts.push(`${series.label}: ${shown.join(", ")}${suffix}${unit}.`);
  }

  const policy = spec.missingPolicy ?? "gap";
  const missing = chartValueExtent(spec.series).missing;
  if (missing > 0) parts.push(`${missing} missing value(s); ${MISSING_POLICY_CAPTIONS[policy]}`);
  if (spec.categories.length > 0) parts.push(`Categories: ${spec.categories.join(", ")}.`);
  if (spec.sourceNote) parts.push(`Source: ${spec.sourceNote}`);
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Missing-value resolution
// ---------------------------------------------------------------------------

export interface ResolvedSeries {
  series: ChartSeries;
  /** Values aligned to categories; `null` still means "no mark". */
  values: (number | null)[];
  /** True where a value was produced rather than reported. */
  imputed: boolean[];
  /** True when the whole series was dropped by the `suppress` policy. */
  suppressed: boolean;
}

/**
 * Apply the missing-value policy. This is the single place where a `null`
 * becomes plottable, and every branch that invents a value marks it as imputed
 * so the mark can be drawn differently and disclosed.
 */
export function resolveSeriesValues(
  series: ChartSeries,
  categories: readonly string[],
  policy: MissingPolicy
): ResolvedSeries {
  const length = Math.min(series.values.length, categories.length);
  const values: (number | null)[] = [];
  const imputed: boolean[] = [];

  const read = (index: number): number | null => {
    const raw = series.values[index];
    return raw === null || raw === undefined || !Number.isFinite(raw) ? null : raw;
  };

  let hasMissing = false;
  for (let i = 0; i < length; i += 1) {
    if (read(i) === null) hasMissing = true;
  }

  if (policy === "suppress" && hasMissing) {
    return {
      series,
      values: new Array(length).fill(null),
      imputed: new Array(length).fill(false),
      suppressed: true,
    };
  }

  for (let i = 0; i < length; i += 1) {
    const value = read(i);
    if (value !== null) {
      values.push(value);
      imputed.push(false);
      continue;
    }
    if (policy === "zero") {
      values.push(0);
      imputed.push(true);
      continue;
    }
    if (policy === "interpolate") {
      let before = -1;
      for (let j = i - 1; j >= 0; j -= 1) {
        if (read(j) !== null) {
          before = j;
          break;
        }
      }
      let after = -1;
      for (let j = i + 1; j < length; j += 1) {
        if (read(j) !== null) {
          after = j;
          break;
        }
      }
      if (before >= 0 && after >= 0) {
        const a = read(before) as number;
        const b = read(after) as number;
        const t = (i - before) / (after - before);
        values.push(round(a + (b - a) * t, 6));
        imputed.push(true);
        continue;
      }
    }
    values.push(null);
    imputed.push(false);
  }

  return { series, values, imputed, suppressed: false };
}

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

export { mixHex } from "./color";

function seriesColor(spec: ChartSpec, context: SectionRenderContext, index: number): string {
  const explicit = spec.series[index]?.color;
  if (explicit) return explicit;
  const ramps = context.style.color.series;
  if (ramps.length === 0) return context.style.color.accent;
  return ramps[index % ramps.length];
}

// ---------------------------------------------------------------------------
// Chrome: title, legend, captions
// ---------------------------------------------------------------------------

export interface ChartRenderOptions {
  /** Primitive-id hint prefix and semantic id for the plot. */
  id?: string;
  /** @default true when more than one series is present */
  showLegend?: boolean;
  /** @default true */
  showSourceNote?: boolean;
  /** Rendering title. Sections usually own their heading, so this is optional. */
  title?: string;
  /** Overrides the axis-tick target count. @default 5 */
  tickCount?: number;
}

export interface ChartRenderResult extends RenderResult {
  /** Accessible description of what was drawn. */
  summary: string;
  /** The plot rect marks were laid into (useful for annotation targets). */
  plot: RectInfo;
}

interface CaptionLine {
  text: string;
}

function buildCaptions(
  spec: ChartSpec,
  domain: ChartDomain,
  options: ChartRenderOptions,
  missingCount: number,
  suppressed: readonly string[]
): CaptionLine[] {
  const lines: CaptionLine[] = [];
  const policy = spec.missingPolicy ?? "gap";

  if (options.showSourceNote !== false && spec.sourceNote) {
    lines.push({ text: `Source: ${spec.sourceNote}` });
  }
  if (missingCount > 0) {
    lines.push({ text: MISSING_POLICY_CAPTIONS[policy] });
  }
  if (suppressed.length > 0) {
    lines.push({ text: `Omitted for missing data: ${suppressed.join(", ")}.` });
  }
  // A heatmap's colour ramp states its own range; there is no axis to truncate.
  if (spec.recipe !== "heatmap" && domain.kind === "linear" && domain.min > 0) {
    const barLike = spec.recipe === "bar" || spec.recipe === "area";
    const lead = barLike ? "Baseline" : "Value axis starts";
    lines.push({
      text: barLike
        ? `${lead} is ${formatNumber(domain.min)}, not zero — bar lengths are not proportional.`
        : `${lead} at ${formatNumber(domain.min)}, not zero.`,
    });
  }
  if (domain.kind === "log") {
    lines.push({ text: "Value axis is logarithmic; equal distances are equal ratios." });
  }
  return lines;
}

interface LegendItem {
  label: string;
  color: string;
  suppressed: boolean;
  semanticId: string;
  x: number;
  y: number;
  /**
   * Measured single-line width of the label. The drawn text box is clamped to
   * this (plus a hair of slack) so it never reaches into the next entry — a
   * frame-wide box would overlap its neighbour and trip the containment guard.
   */
  labelWidth: number;
}

interface LegendLayout {
  primitives: InfographicPrimitive[];
  height: number;
}

interface LegendRows {
  items: LegendItem[];
  rowHeight: number;
  rowCount: number;
  height: number;
}

function legendSwatch(style: SectionRenderContext["style"]): number {
  return round(style.type.caption * 0.75);
}

/**
 * Wrap legend entries into rows that fit `width`. Shared by the reservation
 * pass and the render pass so the reserved band and the drawn band always agree.
 */
function legendRows(
  spec: ChartSpec,
  playable: readonly ResolvedSeries[],
  originX: number,
  width: number,
  context: SectionRenderContext
): LegendRows {
  const style = context.style;
  const swatch = legendSwatch(style);
  const gap = style.spacing[2];
  const rowGap = style.spacing[1];
  const labelStyle = typeStyle(style, "caption");
  const rowHeight = round(Math.max(swatch, labelStyle.fontSize * 1.4));
  const items: LegendItem[] = [];
  let x = originX;
  let row = 0;
  let placed = 0;

  for (let index = 0; index < playable.length; index += 1) {
    const entry = playable[index];
    const suppressed = entry.suppressed;
    const label = suppressed ? `${entry.series.label} (omitted)` : entry.series.label;
    const labelWidth = measureText(label, labelStyle);
    const itemWidth = swatch + gap * 0.5 + labelWidth;
    if (placed > 0 && x + itemWidth > originX + width) {
      x = originX;
      row += 1;
    }
    items.push({
      label,
      color: suppressed ? style.color.inkSubtle : seriesColor(spec, context, index),
      suppressed,
      semanticId: entry.series.id,
      x,
      y: round(row * (rowHeight + rowGap)),
      labelWidth,
    });
    placed += 1;
    x += itemWidth + gap;
  }

  const rowCount = items.length === 0 ? 0 : row + 1;
  return {
    items,
    rowHeight,
    rowCount,
    height: rowCount === 0 ? 0 : round(rowCount * rowHeight + (rowCount - 1) * rowGap),
  };
}

/**
 * Swatch + label legend laid out at `origin.y` in the band the caller reserved.
 * Always sits below the plot so narrow portrait artboards keep the encoding key.
 */
function legendLayout(
  rows: LegendRows,
  origin: RectInfo,
  width: number,
  context: SectionRenderContext
): LegendLayout {
  const style = context.style;
  const primitives: InfographicPrimitive[] = [];
  const swatch = legendSwatch(style);
  const gap = style.spacing[2];

  for (const item of rows.items) {
    const y = round(origin.y + item.y);
    primitives.push(
      rectPrimitive(
        { x: item.x, y: round(y + (rows.rowHeight - swatch) / 2), width: swatch, height: swatch },
        {
          fill: item.color,
          radius: style.radius.sm,
          opacity: item.suppressed ? 0.5 : 1,
          role: "chart-legend-swatch",
          semanticId: item.semanticId,
        },
        context
      )
    );
    primitives.push(
      layoutText(
        {
          text: item.label,
          box: {
            x: round(item.x + swatch + gap * 0.5),
            y,
            width: round(
            Math.min(
              Math.max(0, width - (item.x - origin.x + swatch + gap * 0.5)),
              item.labelWidth + 1
            )
          ),
            height: rows.rowHeight,
          },
          style: typeStyle(style, "caption"),
          color: item.suppressed ? style.color.inkSubtle : style.color.inkMuted,
          role: "chart-legend-label",
          semanticId: item.semanticId,
          valign: "middle",
          maxLines: 1,
        },
        context
      ).primitive
    );
  }

  return { primitives, height: rows.height };
}

// ---------------------------------------------------------------------------
// Plot construction
// ---------------------------------------------------------------------------

interface PlotScales {
  /** Inner rect after axis label space. */
  area: RectInfo;
  /** Width of one category band. */
  band: number;
  /** Centre of a category band, in design px. */
  center: (index: number) => number;
  toT: (value: number) => number;
  yFor: (value: number) => number;
  ticks: number[];
}

function makeScales(
  area: RectInfo,
  count: number,
  domain: ChartDomain,
  tickCount: number
): PlotScales {
  const toT = domainTransform(domain);
  const tMin = toT(domain.min);
  const tMax = toT(domain.max);
  const band = count > 0 ? area.width / count : area.width;

  return {
    area,
    band,
    center: (index: number) => round(area.x + band * (index + 0.5)),
    toT,
    yFor: (value: number) => {
      const t = toT(value);
      const ratio = tMax === tMin ? 0 : (t - tMin) / (tMax - tMin);
      return round(area.y + area.height * (1 - clamp(ratio, 0, 1)));
    },
    ticks: chartTicks(domain, tickCount),
  };
}

interface AxisFrame {
  primitives: InfographicPrimitive[];
  area: RectInfo;
  /** Scales resolved on `area`, shared by the grid and every recipe's marks. */
  scales: PlotScales;
  categoryLabelHeight: number;
}

/**
 * Reserve the category-label strip (and optional x-axis title) at the bottom of
 * `region`, then draw the value axis — grid, tick labels and zero baseline — on
 * the *remaining* plot rect. Marks must use the returned `scales`, so the grid,
 * baseline and bars can never disagree about where a value sits.
 */
function drawValueAxis(
  region: RectInfo,
  bandCount: number,
  domain: ChartDomain,
  tickCount: number,
  style: SectionRenderContext["style"],
  context: SectionRenderContext,
  options: { tickLabelWidth: number; xAxisLabel?: string; headroom?: number; rowLabels?: readonly string[] }
): AxisFrame {
  const primitives: InfographicPrimitive[] = [];
  const tickStyle = chartTickStyle(style);
  const labelGap = style.spacing[1];

  const categoryLabelHeight = round(typeStyle(style, "caption").fontSize * 1.6);
  let bottom = round(region.y + region.height);
  if (options.xAxisLabel) {
    const axisTitle = layoutTextForRole(
      {
        text: options.xAxisLabel,
        box: { x: region.x, y: 0, width: region.width, height: 0 },
        typeRole: "annotation",
        color: style.color.inkSubtle,
        role: "chart-axis-title",
        align: "center",
        maxLines: 1,
      },
      context
    );
    axisTitle.primitive.y = round(bottom - axisTitle.primitive.height);
    primitives.push(axisTitle.primitive);
    bottom -= axisTitle.primitive.height + style.spacing[0];
  }

  // Half a tick label of headroom keeps the top tick label inside the frame;
  // charts with value labels reserve a full label row above the tallest mark.
  const headroom = round(Math.max(tickStyle.fontSize * 0.7, options.headroom ?? 0));
  const area: RectInfo = {
    x: region.x,
    y: round(region.y + headroom),
    width: region.width,
    height: round(Math.max(0, bottom - categoryLabelHeight - style.spacing[1] - region.y - headroom)),
  };
  const fullScales = makeScales(area, bandCount, domain, tickCount);
  // Thin the ticks to what the plot height can hold: labels need about 1.4
  // lines of clearance, so a squat plot keeps every k-th tick (always the ends).
  const minSpacing = tickStyle.fontSize * 1.4;
  const allTicks = fullScales.ticks;
  // Measured in pixels on the real scale (ticks rarely span the whole plot).
  const spacingOf = (stride: number) => {
    let smallest = Infinity;
    for (let index = 0; index + stride < allTicks.length; index += stride) {
      smallest = Math.min(smallest, Math.abs(fullScales.yFor(allTicks[index + stride]) - fullScales.yFor(allTicks[index])));
    }
    return smallest;
  };
  let stride = 1;
  while (stride < allTicks.length - 1 && spacingOf(stride) < minSpacing) stride += 1;
  // Too short for even two labelled ticks: keep the baseline tick only.
  const ticks = spacingOf(stride) < minSpacing ? allTicks.slice(0, 1) : allTicks.filter((_, index) => index % stride === 0);
  const scales: PlotScales = { ...fullScales, ticks };
  const baselineValue = domain.zero ? 0 : domain.min;
  const baselineY = scales.yFor(baselineValue);

  if (options.rowLabels) {
    // Categorical rows (heatmap): one label per row band, no value grid.
    const rows = options.rowLabels;
    const rowHeight = rows.length > 0 ? area.height / rows.length : area.height;
    rows.forEach((label, index) => {
      primitives.push(
        layoutText(
          {
            text: label,
            box: {
              x: round(region.x - labelGap - options.tickLabelWidth),
              y: round(area.y + rowHeight * index),
              width: options.tickLabelWidth,
              height: round(rowHeight),
            },
            style: rowLabelStyle(style),
            lineHeight: style.lineHeight.annotation,
            color: style.color.inkMuted,
            role: "chart-row-label",
            align: "end",
            valign: "middle",
            maxLines: 2,
          },
          context
        ).primitive
      );
    });
    return { primitives, area, scales: { ...scales, ticks: [] }, categoryLabelHeight };
  }

  for (const tick of scales.ticks) {
    const y = scales.yFor(tick);
    if (Math.abs(y - baselineY) > 0.5) {
      primitives.push(
        linePrimitive(
          { x: region.x, y },
          { x: round(region.x + region.width), y },
          {
            stroke: style.color.grid,
            strokeWidth: style.stroke.hairline,
            dash: style.dash.guide,
            role: "chart-grid",
            semanticId: "grid",
          },
          context
        )
      );
    }
    primitives.push(
      layoutText(
        {
          text: formatNumber(tick, { precision: tickPrecision(scales.ticks) }),
          box: {
            x: round(region.x - labelGap - options.tickLabelWidth),
            y: round(y - tickStyle.fontSize * 0.7),
            width: options.tickLabelWidth,
            height: round(tickStyle.fontSize * 1.4),
          },
          style: tickStyle,
          color: style.color.inkSubtle,
          role: "chart-tick-label",
          align: "end",
          valign: "middle",
          maxLines: 1,
        },
        context
      ).primitive
    );
  }

  // Zero baseline, or the domain edge when the axis is truncated.
  primitives.push(
    linePrimitive(
      { x: region.x, y: baselineY },
      { x: round(region.x + region.width), y: baselineY },
      {
        stroke: style.color.rule,
        strokeWidth: style.stroke.rule,
        dash: "solid",
        role: "chart-baseline",
        semanticId: domain.zero ? "zero" : "domain-min",
      },
      context
    )
  );

  return { primitives, area, scales, categoryLabelHeight };
}

function rowLabelStyle(style: SectionRenderContext["style"]) {
  return typeStyle(style, "caption", { family: style.font.body, weight: style.weight.label });
}

function rampLegendHeight(style: SectionRenderContext["style"]): number {
  return round(typeStyle(style, "caption").fontSize * 1.6 + style.spacing[2]);
}

/** Low → high colour key for value-as-colour encodings, with both end values. */
function rampLegend(box: RectInfo, domain: ChartDomain, context: SectionRenderContext): LegendLayout {
  const style = context.style;
  const textStyle = typeStyle(style, "caption", { family: style.font.body, weight: style.weight.body });
  const rowHeight = round(textStyle.fontSize * 1.6);
  const low = formatNumber(domain.min, { language: context.language });
  const high = formatNumber(domain.max, { language: context.language });
  const lowWidth = round(measureText(low, textStyle) + 2);
  const highWidth = round(measureText(high, textStyle) + 2);
  const barWidth = round(Math.min(box.width * 0.4, style.spacing[8] * 1.5));
  const barHeight = round(textStyle.fontSize * 0.6);
  const y = round(box.y + style.spacing[2]);
  const barX = round(box.x + lowWidth + style.spacing[1]);
  const text = (value: string, x: number, width: number, align: "start" | "end") =>
    layoutText(
      {
        text: value,
        box: { x, y, width, height: rowHeight },
        style: textStyle,
        lineHeight: 1.2,
        color: style.color.inkMuted,
        role: "chart-ramp-label",
        align,
        valign: "middle",
        maxLines: 1,
        tabular: true,
      },
      context
    ).primitive;
  return {
    primitives: [
      text(low, box.x, lowWidth, "start"),
      rectPrimitive(
        { x: barX, y: round(y + (rowHeight - barHeight) / 2), width: barWidth, height: barHeight },
        {
          fill: mixHex(style.color.surfaceAlt, style.color.accent, 0.1),
          gradient: { to: style.color.accent, direction: "right" },
          stroke: style.color.grid,
          strokeWidth: style.stroke.hairline,
          radius: style.radius.pill,
          role: "chart-ramp",
        },
        context
      ),
      text(high, round(barX + barWidth + style.spacing[1]), highWidth, "start"),
    ],
    height: box.height,
  };
}

/** Tick labels use the body face at annotation size: quieter than mono, still tabular. */
function chartTickStyle(style: SectionRenderContext["style"]) {
  return typeStyle(style, "annotation", { weight: style.weight.body });
}

function tickPrecision(ticks: readonly number[]): number {
  if (ticks.length < 2) return 0;
  const step = Math.abs(ticks[1] - ticks[0]);
  if (step >= 1) return 0;
  return Math.min(4, Math.ceil(-Math.log10(step)) + 1);
}

interface CategoryLabelsResult {
  primitives: InfographicPrimitive[];
  truncated: number;
}

/** Category labels under the bands. Over-long labels truncate and are reported. */
function categoryLabels(
  area: RectInfo,
  categories: readonly string[],
  band: number,
  y: number,
  style: SectionRenderContext["style"],
  context: SectionRenderContext
): CategoryLabelsResult {
  const primitives: InfographicPrimitive[] = [];
  const textStyle = typeStyle(style, "caption");
  let truncated = 0;

  for (let index = 0; index < categories.length; index += 1) {
    const label = categories[index];
    const available = round(Math.max(0, band - style.spacing[1]));
    const measurement = measureText(label, textStyle);
    if (measurement > available) truncated += 1;
    primitives.push(
      layoutText(
        {
          text: label,
          box: { x: round(area.x + band * index), y, width: band, height: 0 },
          style: textStyle,
          color: style.color.inkMuted,
          role: "chart-category-label",
          align: "center",
          maxLines: 1,
        },
        context
      ).primitive
    );
  }

  return { primitives, truncated };
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

interface RecipeInput {
  spec: ChartSpec;
  playable: readonly ResolvedSeries[];
  domain: ChartDomain;
  scales: PlotScales;
  context: SectionRenderContext;
  colorOf: (index: number) => string;
  /** Draw direct value labels on marks (few marks only). */
  valueLabels: boolean;
}

interface RecipeOutput {
  primitives: InfographicPrimitive[];
  anchors: Record<string, RectInfo>;
}

/** Bars get value labels when there are few enough marks to read them all. */
const VALUE_LABEL_MARK_LIMIT = 16;

function showValueLabels(spec: ChartSpec, seriesCount: number): boolean {
  return (spec.recipe === "bar" || spec.recipe === "line" || spec.recipe === "area") &&
    spec.categories.length * Math.max(1, seriesCount) <= VALUE_LABEL_MARK_LIMIT;
}

function dataLabelStyle(style: SectionRenderContext["style"]) {
  return typeStyle(style, "caption", { family: style.font.body, weight: style.weight.label });
}

/**
 * A short value label centred on `cx`, sitting `gap` above (or below) `edgeY`.
 * Returns `null` when the label is wider than `maxWidth`, so dense charts drop
 * labels rather than letting them collide.
 */
function dataLabel(
  text: string,
  cx: number,
  edgeY: number,
  placement: "above" | "below",
  maxWidth: number,
  color: string,
  semanticId: string,
  context: SectionRenderContext,
  bounds?: RectInfo
): TextPrimitive | null {
  const style = context.style;
  const textStyle = dataLabelStyle(style);
  const width = measureText(text, textStyle);
  if (width > maxWidth) return null;
  const height = round(textStyle.fontSize * 1.25);
  const gap = round(style.spacing[0] * 0.75);
  const boxWidth = round(width + style.spacing[0]);
  // Edge marks keep their label inside the plot instead of overhanging it.
  const x = bounds ? clamp(cx - boxWidth / 2, bounds.x, bounds.x + bounds.width - boxWidth) : cx - boxWidth / 2;
  const label = layoutText(
    {
      text,
      box: {
        x: round(x),
        y: placement === "above" ? round(edgeY - gap - height) : round(edgeY + gap),
        width: boxWidth,
        height,
      },
      style: textStyle,
      lineHeight: 1.25,
      color,
      role: "chart-value-label",
      semanticId,
      align: "center",
      maxLines: 1,
      tabular: true,
    },
    context
  ).primitive;
  return label;
}

/**
 * Keeps data labels from colliding: a label is accepted only when it clears
 * every label already accepted and every `reserved` box, such as other series'
 * markers (dense or crossing series simply drop the labels that would
 * overprint — the axis still carries every value).
 */
function labelCollector(reserved: readonly RectInfo[] = []) {
  const placed: RectInfo[] = [...reserved];
  return (label: TextPrimitive | null): TextPrimitive | null => {
    if (!label) return null;
    const box = { x: label.x, y: label.y, width: label.width, height: label.height };
    if (placed.some((other) => overlapArea(other, box) > 0)) return null;
    placed.push(box);
    return label;
  };
}

/** Height a row of data labels needs above the tallest mark. */
function dataLabelHeadroom(style: SectionRenderContext["style"]): number {
  return round(dataLabelStyle(style).fontSize * 1.25 + style.spacing[0] * 0.75);
}

/**
 * Bar outline with only the data end rounded (the end away from the baseline),
 * as an absolute M/L/Q path so bounds and gradients resolve exactly.
 */
export function barPath(box: RectInfo, radius: number, roundedEnd: "top" | "bottom"): string {
  const r = round(Math.max(0, Math.min(radius, box.width / 2, box.height)));
  const x0 = round(box.x);
  const x1 = round(box.x + box.width);
  const y0 = round(box.y);
  const y1 = round(box.y + box.height);
  if (r === 0) return `M ${x0} ${y0} L ${x1} ${y0} L ${x1} ${y1} L ${x0} ${y1} Z`;
  if (roundedEnd === "top") {
    return `M ${x0} ${y1} L ${x0} ${round(y0 + r)} Q ${x0} ${y0} ${round(x0 + r)} ${y0} L ${round(x1 - r)} ${y0} Q ${x1} ${y0} ${x1} ${round(y0 + r)} L ${x1} ${y1} Z`;
  }
  return `M ${x0} ${y0} L ${x1} ${y0} L ${x1} ${round(y1 - r)} Q ${x1} ${y1} ${round(x1 - r)} ${y1} L ${round(x0 + r)} ${y1} Q ${x0} ${y1} ${x0} ${round(y1 - r)} Z`;
}

/** A gentle sheen toward the canvas, so flat fills read as lit material. */
function markSheen(color: string, style: SectionRenderContext["style"], direction: "down" | "up" = "down") {
  return { to: mixHex(color, style.color.canvas, 0.16), direction } as const;
}

function barMarks(input: RecipeInput): RecipeOutput {
  const { spec, playable, domain, scales, context, colorOf } = input;
  const style = context.style;
  const primitives: InfographicPrimitive[] = [];
  const labels: InfographicPrimitive[] = [];
  const anchors: Record<string, RectInfo> = {};
  const baseline = scales.yFor(domain.zero ? 0 : domain.min);
  const groupCount = Math.max(1, playable.length);
  const groupWidth = scales.band * (groupCount === 1 ? 0.58 : 0.74);
  const innerGap = groupCount > 1 ? Math.max(2, round(style.spacing[0] * 0.5)) : 0;
  const barWidth = round((groupWidth - innerGap * (groupCount - 1)) / groupCount);
  const count = spec.categories.length;
  const labelled = input.valueLabels;
  const accept = labelCollector();

  for (let i = 0; i < count; i += 1) {
    anchors[`category:${i}`] = {
      x: round(scales.area.x + scales.band * i),
      y: scales.area.y,
      width: round(scales.band),
      height: scales.area.height,
    };
  }

  playable.forEach((entry, seriesIndex) => {
    const color = colorOf(seriesIndex);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < count; i += 1) {
      const value = entry.values[i];
      if (value === null) continue;
      const x = round(scales.area.x + scales.band * i + (scales.band - groupWidth) / 2 + (barWidth + innerGap) * seriesIndex);
      const y = scales.yFor(value);
      const top = Math.min(y, baseline);
      const height = Math.max(style.stroke.hairline * 2, round(Math.abs(y - baseline)));
      const box: RectInfo = { x, y: top, width: barWidth, height };
      const upward = y <= baseline;
      const imputed = entry.imputed[i];
      primitives.push(
        pathPrimitive(
          barPath(box, Math.max(style.radius.sm, 2), upward ? "top" : "bottom"),
          {
            fill: imputed ? mixHex(color, style.color.canvas, 0.55) : color,
            gradient: imputed ? undefined : markSheen(color, style, upward ? "up" : "down"),
            role: imputed ? "chart-mark-imputed" : "chart-mark",
            semanticId: `${entry.series.id}:${i}`,
          },
          context
        )
      );
      if (labelled) {
        const label = dataLabel(
          formatNumber(value, { language: context.language }),
          round(x + barWidth / 2),
          upward ? top : top + height,
          upward ? "above" : "below",
          Math.max(barWidth + innerGap, scales.band / groupCount),
          style.color.inkMuted,
          `${entry.series.id}:${i}:value`,
          context,
          scales.area
        );
        if (accept(label)) labels.push(label as TextPrimitive);
      }
      minX = Math.min(minX, box.x);
      maxX = Math.max(maxX, box.x + box.width);
      minY = Math.min(minY, box.y);
      maxY = Math.max(maxY, box.y + box.height);
    }

    if (Number.isFinite(minX)) {
      anchors[`series:${entry.series.id}`] = {
        x: round(minX),
        y: round(minY),
        width: round(maxX - minX),
        height: round(maxY - minY),
      };
    }
  });

  return { primitives: [...primitives, ...labels], anchors };
}

/** Split a value run into contiguous non-null segments (gap policy). */
function segments(values: readonly (number | null)[]): { index: number; value: number }[][] {
  const runs: { index: number; value: number }[][] = [];
  let current: { index: number; value: number }[] = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (current.length > 0) runs.push(current);
      current = [];
      return;
    }
    current.push({ index, value });
  });
  if (current.length > 0) runs.push(current);
  return runs;
}

function lineMarks(input: RecipeInput, withArea: boolean): RecipeOutput {
  const { spec, playable, scales, context, colorOf, domain } = input;
  const style = context.style;
  const primitives: InfographicPrimitive[] = [];
  const markers: InfographicPrimitive[] = [];
  const labels: InfographicPrimitive[] = [];
  const anchors: Record<string, RectInfo> = {};
  const count = spec.categories.length;
  const base = scales.yFor(domain.zero ? 0 : domain.min);
  // A wash under a plain line implies magnitude, which is only honest from zero.
  const wash = withArea || (domain.zero && domain.kind === "linear" && playable.length === 1);
  const markerSize = round(style.stroke.strong * 3.2);
  const markerRing = Math.max(1.5, round(style.stroke.strong * 0.8));
  const markerBox = (index: number, value: number): RectInfo => ({
    x: round(scales.center(index) - markerSize / 2), y: round(scales.yFor(value) - markerSize / 2), width: markerSize, height: markerSize,
  });
  // Labels never overprint a marker, and the lowest of several series labels its points underneath.
  const accept = labelCollector(playable.flatMap((entry) =>
    entry.values.flatMap((value, index) => (value === null ? [] : [markerBox(index, value)]))));
  const labelBelow = (seriesIndex: number, index: number, value: number) => {
    const others = playable.filter((_, i) => i !== seriesIndex).map((entry) => entry.values[index]).filter((v): v is number => v !== null);
    const room = scales.area.y + scales.area.height - (scales.yFor(value) + markerSize / 2);
    return others.some((v) => v > value) && others.every((v) => v >= value) && room >= dataLabelHeadroom(style);
  };

  for (let i = 0; i < count; i += 1) {
    anchors[`category:${i}`] = {
      x: round(scales.area.x + scales.band * i),
      y: scales.area.y,
      width: round(scales.band),
      height: scales.area.height,
    };
  }

  playable.forEach((entry, seriesIndex) => {
    const color = colorOf(seriesIndex);
    const runs = segments(entry.values);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const run of runs) {
      const points: [number, number][] = run.map((point) => {
        const x = scales.center(point.index);
        const y = scales.yFor(point.value);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        return [x, y];
      });

      if (wash && points.length > 1) {
        const outline = [...points, [points[points.length - 1][0], base], [points[0][0], base]] as [number, number][];
        const d = `${outline.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${round(x)} ${round(y)}`).join(" ")} Z`;
        primitives.push(
          pathPrimitive(
            d,
            {
              fill: color,
              gradient: { to: color, toOpacity: 0.02, direction: "down" },
              opacity: withArea ? 0.42 : 0.16,
              role: "chart-mark-area",
              semanticId: entry.series.id,
            },
            context
          )
        );
      }

      if (points.length > 1) {
        primitives.push(
          polylinePrimitive(
            points,
            {
              stroke: color,
              strokeWidth: style.stroke.strong,
              role: "chart-mark-line",
              semanticId: entry.series.id,
            },
            context
          )
        );
      }

      run.forEach((point) => {
        const imputed = entry.imputed[point.index];
        markers.push(
          ellipsePrimitive(
            {
              x: round(scales.center(point.index) - markerSize / 2),
              y: round(scales.yFor(point.value) - markerSize / 2),
              width: markerSize,
              height: markerSize,
            },
            {
              fill: style.color.canvas,
              stroke: imputed ? style.color.inkSubtle : color,
              strokeWidth: markerRing,
              role: imputed ? "chart-mark-imputed" : "chart-mark",
              semanticId: `${entry.series.id}:${point.index}`,
            },
            context
          )
        );
        if (input.valueLabels) {
          const below = labelBelow(seriesIndex, point.index, point.value);
          const label = dataLabel(
            formatNumber(point.value, { language: context.language }),
            scales.center(point.index),
            round(scales.yFor(point.value) + (below ? markerSize / 2 : -markerSize / 2)),
            below ? "below" : "above",
            scales.band,
            style.color.inkMuted,
            `${entry.series.id}:${point.index}:value`,
            context,
            scales.area
          );
          if (accept(label)) labels.push(label as TextPrimitive);
        }
      });
    }

    if (Number.isFinite(minX)) {
      anchors[`series:${entry.series.id}`] = {
        x: round(minX),
        y: round(minY),
        width: round(Math.max(1, maxX - minX)),
        height: round(Math.max(1, maxY - minY)),
      };
    }
  });

  return { primitives: [...primitives, ...markers, ...labels], anchors };
}

function scatterMarks(input: RecipeInput): RecipeOutput {
  const { spec, playable, scales, context, colorOf } = input;
  const style = context.style;
  const primitives: InfographicPrimitive[] = [];
  const anchors: Record<string, RectInfo> = {};
  const count = spec.categories.length;

  for (let i = 0; i < count; i += 1) {
    anchors[`category:${i}`] = {
      x: round(scales.area.x + scales.band * i),
      y: scales.area.y,
      width: round(scales.band),
      height: scales.area.height,
    };
  }

  playable.forEach((entry, seriesIndex) => {
    const color = colorOf(seriesIndex);
    const size = round(Math.max(12, style.type.caption * 0.9));
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    entry.values.forEach((value, index) => {
      if (value === null) return;
      const x = scales.center(index);
      const y = scales.yFor(value);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      const imputed = entry.imputed[index];
      // A canvas-coloured halo keeps overlapping dots individually countable.
      primitives.push(
        ellipsePrimitive(
          { x: round(x - size / 2), y: round(y - size / 2), width: size, height: size },
          {
            fill: imputed ? style.color.canvas : color,
            stroke: imputed ? color : style.color.canvas,
            strokeWidth: Math.max(1.5, style.stroke.rule),
            opacity: imputed ? 1 : 0.88,
            role: imputed ? "chart-mark-imputed" : "chart-mark",
            semanticId: `${entry.series.id}:${index}`,
          },
          context
        )
      );
    });

    if (Number.isFinite(minX)) {
      anchors[`series:${entry.series.id}`] = {
        x: round(minX - size / 2),
        y: round(minY - size / 2),
        width: round(maxX - minX + size),
        height: round(maxY - minY + size),
      };
    }
  });

  return { primitives, anchors };
}

function heatmapMarks(input: RecipeInput): RecipeOutput {
  const { spec, playable, domain, scales, context } = input;
  const style = context.style;
  const primitives: InfographicPrimitive[] = [];
  const anchors: Record<string, RectInfo> = {};
  const count = spec.categories.length;
  const rowHeight = playable.length > 0 ? scales.area.height / playable.length : scales.area.height;
  const cellGap = Math.max(2, style.spacing[0] * 0.5);
  const toT = domainTransform(domain);
  const tMin = toT(domain.min);
  const tMax = toT(domain.max);
  const valueStyle = dataLabelStyle(style);

  for (let i = 0; i < count; i += 1) {
    anchors[`category:${i}`] = {
      x: round(scales.area.x + scales.band * i),
      y: scales.area.y,
      width: round(scales.band),
      height: scales.area.height,
    };
  }

  playable.forEach((entry, rowIndex) => {
    const rowY = round(scales.area.y + rowHeight * rowIndex);
    anchors[`series:${entry.series.id}`] = {
      x: scales.area.x,
      y: rowY,
      width: scales.area.width,
      height: round(rowHeight),
    };

    entry.values.forEach((value, columnIndex) => {
      if (value === null) return;
      const t = tMax === tMin ? 0 : clamp((toT(value) - tMin) / (tMax - tMin), 0, 1);
      const box: RectInfo = {
        x: round(scales.area.x + scales.band * columnIndex + cellGap / 2),
        y: round(rowY + cellGap / 2),
        width: round(Math.max(1, scales.band - cellGap)),
        height: round(Math.max(1, rowHeight - cellGap)),
      };
      const fill = mixHex(style.color.surfaceAlt, style.color.accent, 0.1 + 0.9 * t);
      primitives.push(
        rectPrimitive(
          box,
          {
            fill,
            radius: Math.max(style.radius.sm, 2),
            role: entry.imputed[columnIndex] ? "chart-mark-imputed" : "chart-mark",
            semanticId: `${entry.series.id}:${columnIndex}`,
          },
          context
        )
      );
      const text = formatNumber(value, { language: context.language });
      if (measureText(text, valueStyle) + style.spacing[0] <= box.width && valueStyle.fontSize * 1.4 <= box.height) {
        primitives.push(
          layoutText(
            {
              text,
              box,
              style: valueStyle,
              lineHeight: 1.2,
              color: readableOn(fill, style),
              role: "chart-value-label",
              semanticId: `${entry.series.id}:${columnIndex}:value`,
              align: "center",
              valign: "middle",
              maxLines: 1,
              tabular: true,
            },
            context
          ).primitive
        );
      }
    });
  });

  return { primitives, anchors };
}

interface DonutSlice {
  index: number;
  label: string;
  value: number;
  share: number;
  start: number;
  end: number;
}

function donutSlicePath(
  cx: number,
  cy: number,
  inner: number,
  outer: number,
  start: number,
  end: number
): string {
  const sweep = end - start;
  if (sweep >= Math.PI * 2 - 1e-6) {
    // A full ring is two arcs; a single 360° arc collapses to nothing.
    const half = start + Math.PI;
    return `${ringArc(cx, cy, inner, outer, start, half)} ${ringArc(cx, cy, inner, outer, half, start + Math.PI * 2)}`;
  }
  return ringArc(cx, cy, inner, outer, start, end);
}

function ringArc(
  cx: number,
  cy: number,
  inner: number,
  outer: number,
  start: number,
  end: number
): string {
  const large = end - start > Math.PI ? 1 : 0;
  const point = (radius: number, angle: number) => ({
    x: round(cx + Math.cos(angle) * radius),
    y: round(cy + Math.sin(angle) * radius),
  });
  const a = point(outer, start);
  const b = point(outer, end);
  const c = point(inner, end);
  const d = point(inner, start);
  return [
    `M ${a.x} ${a.y}`,
    `A ${round(outer)} ${round(outer)} 0 ${large} 1 ${b.x} ${b.y}`,
    `L ${c.x} ${c.y}`,
    `A ${round(inner)} ${round(inner)} 0 ${large} 0 ${d.x} ${d.y}`,
    "Z",
  ].join(" ");
}

function donutSlices(spec: ChartSpec, playable: readonly ResolvedSeries[]): DonutSlice[] {
  const entry = playable[0];
  if (!entry) return [];
  const total = entry.values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  if (!(total > 0)) return [];
  const slices: DonutSlice[] = [];
  let cursor = -Math.PI / 2;
  for (let index = 0; index < spec.categories.length; index += 1) {
    const value = entry.values[index] ?? 0;
    const share = value / total;
    const end = cursor + share * Math.PI * 2;
    slices.push({ index, label: spec.categories[index], value, share, start: cursor, end });
    cursor = end;
  }
  return slices;
}

function donutMarks(input: RecipeInput): RecipeOutput {
  const { spec, playable, context, colorOf } = input;
  const style = context.style;
  const primitives: InfographicPrimitive[] = [];
  const anchors: Record<string, RectInfo> = {};
  const slots = donutSlices(spec, playable);
  const plot = input.scales.area;

  // Key rows: swatch · label · share. Side-by-side when the plot is wide,
  // stacked under the ring otherwise; a donut without a key cannot be read.
  const keyStyle = typeStyle(style, "caption", { family: style.font.body, weight: style.weight.body });
  const shareStyle = typeStyle(style, "caption", { family: style.font.body, weight: style.weight.strong });
  const rowHeight = round(keyStyle.fontSize * 2);
  const keyHeight = rowHeight * slots.length;
  const wide = plot.width >= plot.height * 1.35;
  const diameter = wide
    ? Math.min(plot.height, plot.width * 0.5)
    : Math.max(0, Math.min(plot.width, plot.height - keyHeight - style.spacing[2]));
  const outer = round(diameter / 2);
  const inner = round(outer * 0.62);
  const cx = round(wide ? plot.x + outer + style.spacing[1] : plot.x + plot.width / 2);
  const cy = round(wide ? plot.y + plot.height / 2 : plot.y + outer);
  const padAngle = slots.filter((slice) => slice.share > 0).length > 1 ? 3 / Math.max(1, (inner + outer) / 2) : 0;

  anchors["series:plot"] = {
    x: round(cx - outer),
    y: round(cy - outer),
    width: round(outer * 2),
    height: round(outer * 2),
  };

  for (const slice of slots) {
    if (slice.share <= 0) continue;
    const half = Math.min(padAngle / 2, (slice.end - slice.start) / 4);
    primitives.push(
      pathPrimitive(
        donutSlicePath(cx, cy, inner, outer, slice.start + half, slice.end - half),
        {
          fill: colorOf(slice.index),
          role: "chart-mark",
          semanticId: `${playable[0].series.id}:${slice.index}`,
        },
        context
      )
    );
    const mid = (slice.start + slice.end) / 2;
    const radius = (inner + outer) / 2;
    const size = round(style.stroke.strong * 2);
    anchors[`category:${slice.index}`] = {
      x: round(cx + Math.cos(mid) * radius - size),
      y: round(cy + Math.sin(mid) * radius - size),
      width: round(size * 2),
      height: round(size * 2),
    };
  }

  // Centre: the leading share, so the eye lands on the biggest part first.
  const lead = slots.reduce<DonutSlice | null>((best, slice) => (!best || slice.share > best.share ? slice : best), null);
  if (lead && inner > style.type.h3) {
    const leadValue = layoutTextForRole(
      {
        text: formatPercent(lead.share, 0, context.language),
        box: { x: round(cx - inner * 0.8), y: 0, width: round(inner * 1.6), height: 0 },
        typeRole: "h2",
        overrides: { family: style.font.display },
        color: style.color.ink,
        role: "chart-donut-lead",
        align: "center",
        maxLines: 1,
        tabular: true,
      },
      context
    );
    const leadLabel = layoutText(
      {
        text: lead.label,
        box: { x: round(cx - inner * 0.75), y: 0, width: round(inner * 1.5), height: 0 },
        style: keyStyle,
        lineHeight: style.lineHeight.annotation,
        color: style.color.inkMuted,
        role: "chart-donut-lead-label",
        align: "center",
        maxLines: 2,
      },
      context
    );
    const block = leadValue.height + leadLabel.height;
    leadValue.primitive.y = round(cy - block / 2);
    leadLabel.primitive.y = round(leadValue.primitive.y + leadValue.height);
    primitives.push(leadValue.primitive, leadLabel.primitive);
  }

  const keyX = wide ? round(cx + outer + style.spacing[4]) : plot.x;
  const keyWidth = wide ? round(plot.x + plot.width - keyX) : plot.width;
  const keyTop = wide ? round(cy - keyHeight / 2) : round(cy + outer + style.spacing[2]);
  const swatch = legendSwatch(style);
  const shareWidth = round(measureText("100%", shareStyle) + style.spacing[0]);
  slots.forEach((slice, row) => {
    const y = round(keyTop + row * rowHeight);
    primitives.push(
      rectPrimitive(
        { x: keyX, y: round(y + (rowHeight - swatch) / 2), width: swatch, height: swatch },
        { fill: colorOf(slice.index), radius: Math.max(2, style.radius.sm), role: "chart-legend-swatch", semanticId: `${playable[0].series.id}:${slice.index}` },
        context
      ),
      layoutText(
        {
          text: slice.label,
          box: { x: round(keyX + swatch + style.spacing[1]), y, width: round(Math.max(0, keyWidth - swatch - style.spacing[1] - shareWidth)), height: rowHeight },
          style: keyStyle,
          lineHeight: style.lineHeight.annotation,
          color: style.color.inkMuted,
          role: "chart-legend-label",
          valign: "middle",
          maxLines: 1,
        },
        context
      ).primitive,
      layoutText(
        {
          text: formatPercent(slice.share, 0, context.language),
          box: { x: round(keyX + keyWidth - shareWidth), y, width: shareWidth, height: rowHeight },
          style: shareStyle,
          lineHeight: style.lineHeight.annotation,
          color: style.color.ink,
          role: "chart-legend-share",
          align: "end",
          valign: "middle",
          maxLines: 1,
          tabular: true,
        },
        context
      ).primitive
    );
    if (row < slots.length - 1) {
      primitives.push(
        linePrimitive(
          { x: keyX, y: round(y + rowHeight) },
          { x: round(keyX + keyWidth), y: round(y + rowHeight) },
          { stroke: style.color.grid, strokeWidth: style.stroke.hairline, role: "chart-legend-rule" },
          context
        )
      );
    }
  });

  return { primitives, anchors };
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * Render a chart into `frame`. The caller owns the frame; the chart owns
 * everything inside it: chrome, axes, marks, legend, captions and diagnostics.
 */
export function renderChart(
  context: SectionRenderContext,
  frame: RectInfo,
  spec: ChartSpec,
  options: ChartRenderOptions = {}
): ChartRenderResult {
  const style = context.style;
  const primitives: InfographicPrimitive[] = [];
  const anchors: Record<string, RectInfo> = {};
  const language = context.language;
  const summary = chartSummary(spec, language);

  const categories = spec.categories ?? [];
  const policy = spec.missingPolicy ?? "gap";

  if (spec.series.length === 0 || categories.length === 0) {
    context.report({
      code: "chart-empty",
      severity: "error",
      message: "Chart has no categories or no series to draw.",
      targetId: options.id,
      path: "/sections",
    });
    const empty = layoutTextForRole(
      {
        text: "No data to display.",
        box: frame,
        typeRole: "body",
        color: style.color.inkMuted,
        role: "chart-empty",
        maxLines: 2,
      },
      context
    );
    return { primitives: [empty.primitive], summary, plot: frame, anchors };
  }

  for (const series of spec.series) {
    if (series.values.length !== categories.length) {
      context.report({
        code: "chart-series-length-mismatch",
        severity: "error",
        message: `Series "${series.label}" has ${series.values.length} values for ${categories.length} categories.`,
        targetId: options.id,
        path: `/series/${series.id}`,
      });
    }
  }

  const resolved = spec.series.map((series) => resolveSeriesValues(series, categories, policy));

  if (spec.recipe === "donut") {
    const negative = resolved[0]?.values.some((value) => value !== null && value < 0);
    if (negative) {
      context.report({
        code: "chart-invalid-scale",
        severity: "error",
        message: "A donut chart cannot encode negative values.",
        targetId: options.id,
      });
    }
  }

  const cropped: ResolvedSeries[] = resolved.map((entry) => ({
    ...entry,
    values: entry.values.slice(0, categories.length),
  }));

  const domain = chartDomain(spec);
  if (!isUsableDomain(domain)) {
    context.report({
      code: "chart-invalid-scale",
      severity: "error",
      message: `Value axis domain is not usable (min ${domain.min}, max ${domain.max}, kind ${domain.kind}).`,
      targetId: options.id,
    });
  }

  const missingCount = cropped.reduce(
    (sum, entry) => sum + entry.values.filter((value) => value === null).length,
    0
  );
  const suppressed = cropped.filter((entry) => entry.suppressed).map((entry) => entry.series.label);
  if (missingCount > 0 || suppressed.length > 0) {
    context.report({
      code: "chart-missing-data",
      severity: "warning",
      message: `${suppressed.length > 0 ? `${suppressed.length} series suppressed; ` : ""}${missingCount} missing value(s) handled by the "${policy}" policy.`,
      targetId: options.id,
    });
  }
  if ((spec.recipe === "bar" || spec.recipe === "area") && domain.kind === "linear" && domain.min > 0) {
    context.report({
      code: "chart-nonzero-baseline",
      severity: "warning",
      message: `Value axis starts at ${formatNumber(domain.min)}, not zero, so ${spec.recipe} lengths are not proportional.`,
      targetId: options.id,
    });
  }

  // ---- chrome -----------------------------------------------------------
  let cursor = frame.y;
  if (options.title) {
    const title = layoutTextForRole(
      {
        text: options.title,
        box: { x: frame.x, y: cursor, width: frame.width, height: 0 },
        typeRole: "h3",
        color: style.color.ink,
        role: "chart-title",
        semanticId: options.id,
        maxLines: 2,
      },
      context
    );
    primitives.push(title.primitive);
    cursor += title.height + style.spacing[2];
  }

  const captions = buildCaptions(spec, domain, options, missingCount, suppressed);
  const captionStyle = typeStyle(style, "caption", { weight: style.weight.body });
  const captionGap = round(style.spacing[0] * 0.5);
  const captionPrimitives: InfographicPrimitive[] = [];
  let captionHeight = 0;
  if (captions.length > 0) {
    const lines: TextPrimitive[] = captions.map((caption) =>
      layoutText(
        {
          text: caption.text,
          box: { x: frame.x, y: 0, width: frame.width, height: 0 },
          style: captionStyle,
          color: style.color.inkSubtle,
          role: "chart-caption",
          maxLines: 2,
        },
        context
      ).primitive
    );
    // Place the caption block bottom-anchored but in reading order: the source
    // note first, then each disclosure beneath it.
    const blockHeight = round(
      lines.reduce((sum, line) => sum + line.height, 0) + captionGap * (lines.length - 1)
    );
    let y = round(frame.y + frame.height - blockHeight);
    for (const line of lines) {
      line.y = y;
      y = round(y + line.height + captionGap);
      captionPrimitives.push(line);
    }
    captionHeight = round(blockHeight + style.spacing[2]);
  }

  // A heatmap encodes value as colour, so its key is a colour ramp; its rows
  // are labelled on the axis instead of through a series legend.
  const heatmap = spec.recipe === "heatmap";
  const legendWanted = !heatmap && (options.showLegend ?? spec.series.length > 1);
  const legendRowsData = legendWanted
    ? legendRows(spec, cropped, frame.x, frame.width, context)
    : { items: [], rowHeight: 0, rowCount: 0, height: 0 };
  const rampHeight = heatmap ? rampLegendHeight(style) : 0;
  const legendTop = round(frame.y + frame.height - captionHeight - legendRowsData.height - rampHeight);
  const legend = legendWanted
    ? legendLayout(legendRowsData, { x: frame.x, y: legendTop, width: frame.width, height: 0 }, frame.width, context)
    : heatmap
      ? rampLegend({ x: frame.x, y: legendTop, width: frame.width, height: rampHeight }, domain, context)
      : { primitives: [], height: 0 };

  const bottom = round(legendTop - style.spacing[2]);

  const plotRegion: RectInfo = {
    x: frame.x,
    y: round(cursor),
    width: frame.width,
    height: round(Math.max(0, bottom - cursor)),
  };

  primitives.push(...legend.primitives);
  primitives.push(...captionPrimitives);

  // ---- plot -------------------------------------------------------------
  const bandCount = categories.length;

  if (spec.recipe === "donut") {
    const scales = makeScales(plotRegion, bandCount, domain, options.tickCount ?? 5);
    const output = donutMarks({
      spec,
      playable: cropped,
      domain,
      scales,
      context,
      colorOf: (index) => seriesColor(spec, context, index),
      valueLabels: false,
    });
    primitives.push(...output.primitives);
    Object.assign(anchors, output.anchors);
    return { primitives, summary, plot: plotRegion, anchors };
  }

  const tickStyle = chartTickStyle(style);
  const ticks = chartTicks(domain, options.tickCount ?? 5);
  const rowLabels = heatmap ? cropped.map((entry) => entry.series.label) : undefined;
  const tickLabelWidth = round(
    rowLabels
      ? Math.min(plotRegion.width * 0.28, Math.max(...rowLabels.map((label) => measureText(label, rowLabelStyle(style))))) + style.spacing[0]
      : Math.max(
          tickStyle.fontSize,
          ...ticks.map((tick) => measureText(formatNumber(tick, { precision: tickPrecision(ticks) }), tickStyle))
        ) + style.spacing[1]
  );

  // The y-axis title reads horizontally on its own line above the plot, left
  // aligned with the tick labels — a sliver column beside the ticks forced
  // mid-word breaks ("Add / ed / lat…") at any realistic width.
  const yAxisTitleWidth = 0;
  const axisGap = 0;
  if (spec.axisLabels?.y) {
    const title = layoutTextForRole(
      {
        text: spec.axisLabels.y,
        box: { x: plotRegion.x, y: plotRegion.y, width: plotRegion.width, height: 0 },
        typeRole: "annotation",
        overrides: { weight: style.weight.label },
        color: style.color.inkMuted,
        role: "chart-axis-title",
        maxLines: 2,
      },
      context
    );
    primitives.push(title.primitive);
    const used = round(title.height + style.spacing[1]);
    plotRegion.y = round(plotRegion.y + used);
    plotRegion.height = round(Math.max(0, plotRegion.height - used));
  }

  // The tick-label gutter must include the gap the labels keep from the plot:
  // `drawValueAxis` places each label box a `labelGap` to the left of `region.x`,
  // so the gutter it is carved from has to be `tickLabelWidth + labelGap` wide or
  // the labels render outside the section frame and the containment guard omits
  // the whole chart (docs/12 §5).
  const tickLabelGutter = round(tickLabelWidth + style.spacing[1]);
  const innerRegion: RectInfo = {
    x: round(plotRegion.x + tickLabelGutter + yAxisTitleWidth + axisGap),
    y: plotRegion.y,
    width: round(Math.max(0, plotRegion.width - tickLabelGutter - yAxisTitleWidth - axisGap)),
    height: plotRegion.height,
  };

  const valueLabels = showValueLabels(spec, cropped.length);
  const axis = drawValueAxis(innerRegion, bandCount, domain, options.tickCount ?? 5, style, context, {
    headroom: valueLabels ? dataLabelHeadroom(style) : undefined,
    rowLabels,
    tickLabelWidth,
    xAxisLabel: spec.axisLabels?.x,
  });
  primitives.push(...axis.primitives);

  const scales = axis.scales;
  const labels = categoryLabels(
    axis.area,
    categories,
    scales.band,
    round(axis.area.y + axis.area.height + style.spacing[1] * 0.5),
    style,
    context
  );
  primitives.push(...labels.primitives);
  if (labels.truncated > 0) {
    context.report({
      code: "chart-label-overflow",
      severity: "warning",
      message: `${labels.truncated} category label(s) were truncated to fit their band; shorten the labels or widen the frame.`,
      targetId: options.id,
    });
  }

  const recipeInput: RecipeInput = {
    spec,
    playable: cropped,
    domain,
    scales,
    context,
    colorOf: (index) => seriesColor(spec, context, index),
    valueLabels,
  };

  const output =
    spec.recipe === "bar"
      ? barMarks(recipeInput)
      : spec.recipe === "line"
        ? lineMarks(recipeInput, false)
        : spec.recipe === "area"
          ? lineMarks(recipeInput, true)
          : spec.recipe === "scatter"
            ? scatterMarks(recipeInput)
            : heatmapMarks(recipeInput);

  primitives.push(...output.primitives);
  Object.assign(anchors, output.anchors);
  anchors["plot"] = axis.area;

  return { primitives, summary, plot: axis.area, anchors };
}

/** Section renderer for `chart` sections: heading + evidence + the plot. */
export function renderChartSection(
  section: ChartSection,
  frame: RectInfo,
  context: SectionRenderContext
): RenderResult {
  const { primitives, content } = sectionChrome(section, frame, context, { accent: true });
  const result = renderChart(context, content, section.chart, { id: section.id });
  return { primitives: [...primitives, ...result.primitives], anchors: result.anchors };
}

/** Section renderers owned by this module. */
export const CHART_RENDERER: SectionRenderer<ChartSection> = renderChartSection as SectionRenderer<ChartSection>;
