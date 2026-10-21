/**
 * E01 `CostWaterfall` — why a total costs what it does.
 *
 * Signed contributions (charges, credits, rebates, reductions) build optional
 * subtotals and a final total. {@link planCostWaterfall} is the pure value plan:
 * running sums in integer minor units, so totals reconcile exactly, plus
 * diagnostics for unknown items and stated totals that disagree with the
 * contributions. {@link renderCostWaterfall} lays the plan out as infographic
 * primitives in columns (landscape) or rows (portrait / long labels), with a
 * frame-addressed step-by-step reveal.
 *
 * Kumiki contains no pricing formulas: every amount is authored data.
 */

import {
  createChartScope,
  drawChrome,
  drawLegend,
  finish,
  formatMoney,
  fromMinor,
  labelWidth,
  lineBox,
  minorDigitsOf,
  provenanceLines,
  revealProgress,
  scaleLinear,
  toMinor,
  unitLine,
  valueAxis,
} from "./economic";
import type { DataProvenance, EconomicChartOptions, EconomicChartResult, MoneyUnit } from "./economic";
import { linePrimitive, rectPrimitive } from "./primitives";
import type { InfographicDiagnostic, RectInfo } from "./types";

export interface WaterfallStepSpec {
  id: string;
  label: string;
  /** `delta` (default) adds `amount`; `subtotal` / `total` show the running sum. */
  kind?: "delta" | "subtotal" | "total";
  /** Signed contribution for a `delta`. `null` means unknown — never treated as zero. */
  amount?: number | null;
  /** Authored figure for a subtotal/total (e.g. from a quote); reconciled against the derived sum. */
  stated?: number;
  /** Short footnote shown under the chart. */
  note?: string;
}

export interface CostWaterfallSpec {
  id: string;
  title: string;
  subtitle?: string;
  unit: MoneyUnit;
  /** Opening amount (e.g. last year's premium). Omit to start from zero. */
  start?: { id?: string; label: string; amount: number };
  steps: WaterfallStepSpec[];
  /** Append a final total bar unless the last step already is one. @default true */
  total?: boolean | { label?: string; stated?: number };
  /** Label rounding in currency units (1, 10, 100…). Totals always use exact sums; rounding is disclosed. */
  displayStep?: number;
  /** `zero` (default) keeps the value axis at zero; `fit` zooms in and discloses the truncated axis. */
  baseline?: "zero" | "fit";
  /** `auto` picks rows for portrait canvases or labels that do not fit under columns. @default "auto" */
  layout?: "auto" | "columns" | "rows";
  provenance?: DataProvenance;
  /** Step ids to emphasize; others are dimmed. */
  highlight?: string[];
  /** Frame-addressed reveal: one bar after another. */
  reveal?: { start?: number; stepFrames?: number; gapFrames?: number };
  /** Override bar colors (semantic tokens by default). */
  palette?: Partial<Record<WaterfallBarKind, string>>;
}

export type WaterfallBarKind = "start" | "increase" | "decrease" | "zero" | "unknown" | "subtotal" | "total";

export interface WaterfallBar {
  id: string;
  label: string;
  kind: WaterfallBarKind;
  /** Signed contribution for deltas; the level for start/subtotal/total; `null` when unknown. */
  amount: number | null;
  /** Bar extent in value space (deltas float, totals stand on the baseline). */
  from: number;
  to: number;
  /** True when an unknown contribution precedes this level, so it covers known items only. */
  partial: boolean;
  stated?: number;
  note?: string;
  noteMark?: string;
  revealStart: number;
  revealEnd: number;
}

export interface CostWaterfallPlan {
  id: string;
  bars: WaterfallBar[];
  /** Exact final level from known items (minor-unit sum). */
  total: number;
  totalMinor: number;
  minorDigits: number;
  unknownCount: number;
  increases: number;
  decreases: number;
  diagnostics: InfographicDiagnostic[];
  revealEnd: number;
}

const MARKS = ["¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];

/** Pure value plan: exact running sums, reveal windows and diagnostics. */
export function planCostWaterfall(spec: CostWaterfallSpec): CostWaterfallPlan {
  const diagnostics: InfographicDiagnostic[] = [];
  const digits = minorDigitsOf(spec.unit);
  const bars: WaterfallBar[] = [];
  const ids = new Set<string>();
  const r = { start: spec.reveal?.start ?? 0, step: spec.reveal?.stepFrames ?? 18, gap: spec.reveal?.gapFrames ?? 6 };
  let running = 0, unknownCount = 0, inc = 0, dec = 0, notes = 0;
  const half = 0.5 / 10 ** digits;

  if (!spec.unit.currency && !spec.unit.unit) {
    diagnostics.push({ code: "unit-undeclared", severity: "warning", message: "The chart declares neither a currency nor a unit; amounts are unlabeled numbers.", path: "/unit" });
  }
  if (!spec.steps.length) {
    diagnostics.push({ code: "waterfall-empty", severity: "error", message: "A waterfall needs at least one contribution.", path: "/steps" });
  }
  const add = (b: Omit<WaterfallBar, "revealStart" | "revealEnd" | "noteMark">) => {
    if (ids.has(b.id)) diagnostics.push({ code: "duplicate-id", severity: "error", message: `Step id "${b.id}" is used twice; ids must be unique.`, targetId: b.id });
    ids.add(b.id);
    const i = bars.length, s = r.start + i * (r.step + r.gap);
    bars.push({ ...b, noteMark: b.note ? MARKS[notes++ % MARKS.length] : undefined, revealStart: s, revealEnd: s + r.step });
  };
  const check = (id: string, label: string, stated: number | undefined, level: number) => {
    if (stated === undefined) return;
    if (Math.abs(stated - fromMinor(level, digits)) > half) {
      diagnostics.push({ code: "waterfall-total-mismatch", severity: "error", targetId: id,
        message: `"${label}" is stated as ${formatMoney(stated, spec.unit, { precision: digits })} but its contributions sum to ${formatMoney(fromMinor(level, digits), spec.unit, { precision: digits })} (difference ${formatMoney(stated - fromMinor(level, digits), spec.unit, { signed: true, precision: digits })}). The chart draws the derived sum.` });
    }
  };

  if (spec.start) {
    if (!Number.isFinite(spec.start.amount)) diagnostics.push({ code: "waterfall-nonfinite", severity: "error", message: "The start amount is not a finite number; treated as 0.", path: "/start" });
    running = Number.isFinite(spec.start.amount) ? toMinor(spec.start.amount, digits) : 0;
    add({ id: spec.start.id ?? "start", label: spec.start.label, kind: "start", amount: fromMinor(running, digits), from: 0, to: fromMinor(running, digits), partial: false });
  }
  spec.steps.forEach((step, index) => {
    const kind = step.kind ?? "delta";
    if (kind === "delta") {
      const raw = step.amount;
      if (raw !== undefined && raw !== null && !Number.isFinite(raw)) {
        diagnostics.push({ code: "waterfall-nonfinite", severity: "error", message: `"${step.label}" has a non-finite amount; shown as unknown.`, targetId: step.id, path: `/steps/${index}` });
      }
      const known = raw !== undefined && raw !== null && Number.isFinite(raw);
      const level = fromMinor(running, digits);
      if (!known) {
        unknownCount++;
        diagnostics.push({ code: "waterfall-unknown-contribution", severity: "warning", targetId: step.id, path: `/steps/${index}`,
          message: `"${step.label}" has no amount. It is shown as unknown and excluded from later totals, which then cover known items only.` });
        add({ id: step.id, label: step.label, kind: "unknown", amount: null, from: level, to: level, partial: unknownCount > 0, note: step.note });
        return;
      }
      const delta = toMinor(raw as number, digits);
      running += delta;
      if (delta > 0) inc += delta; else dec += delta;
      add({ id: step.id, label: step.label, kind: delta > 0 ? "increase" : delta < 0 ? "decrease" : "zero", amount: fromMinor(delta, digits), from: level, to: fromMinor(running, digits), partial: unknownCount > 0, note: step.note });
    } else {
      check(step.id, step.label, step.stated, running);
      add({ id: step.id, label: step.label, kind, amount: fromMinor(running, digits), from: 0, to: fromMinor(running, digits), partial: unknownCount > 0, stated: step.stated, note: step.note });
    }
  });
  const last = spec.steps[spec.steps.length - 1];
  if (spec.total !== false && (!last || last.kind !== "total")) {
    const t = typeof spec.total === "object" ? spec.total : {};
    check("total", t.label ?? "Total", t.stated, running);
    add({ id: "total", label: t.label ?? "Total", kind: "total", amount: fromMinor(running, digits), from: 0, to: fromMinor(running, digits), partial: unknownCount > 0, stated: t.stated });
  }
  const revealEnd = bars.length ? bars[bars.length - 1].revealEnd : r.start;
  return { id: spec.id, bars, total: fromMinor(running, digits), totalMinor: running, minorDigits: digits, unknownCount, increases: fromMinor(inc, digits), decreases: fromMinor(dec, digits), diagnostics, revealEnd };
}

function roundTo(v: number, step: number | undefined) {
  return step && step > 0 ? Math.round(v / step) * step : v;
}

export interface CostWaterfallResult extends EconomicChartResult {
  plan: CostWaterfallPlan;
  layout: "columns" | "rows";
}

/** Lay a waterfall out as infographic primitives at an absolute `frame`. */
export function renderCostWaterfall(spec: CostWaterfallSpec, options: EconomicChartOptions): CostWaterfallResult {
  const plan = planCostWaterfall(spec);
  const scope = createChartScope(spec.id, options);
  const { style, context } = scope;
  scope.diagnostics.push(...plan.diagnostics);
  const unit = spec.unit;
  // One precision per chart: whole units unless some amount carries minor units (and no coarser display step).
  const fractional = plan.bars.some((b) => b.amount !== null && Math.abs(b.amount - Math.round(b.amount)) > 1e-9);
  const wholeUnits = (spec.displayStep !== undefined && spec.displayStep >= 1) || !fractional ? 0 : plan.minorDigits;
  const money = (v: number, signed = false) => formatMoney(roundTo(v, spec.displayStep), unit, { language: scope.language, signed, precision: wholeUnits });
  const palette: Record<WaterfallBarKind, string> = {
    start: style.color.inkMuted, increase: style.color.accent, decrease: style.color.positive, zero: style.color.inkSubtle,
    unknown: style.color.inkSubtle, subtotal: style.color.inkMuted, total: style.color.ink, ...spec.palette,
  };

  // Footer: provenance, rounding policy, unknowns, axis, notes.
  const footer = provenanceLines(spec.provenance);
  if (spec.displayStep && spec.displayStep > 10 ** -plan.minorDigits) {
    const rounded = plan.bars.filter((b) => b.kind !== "subtotal" && b.kind !== "total" && b.amount !== null).reduce((s, b) => s + roundTo(b.amount as number, spec.displayStep), 0);
    const drift = Math.abs(rounded - roundTo(plan.total, spec.displayStep));
    footer.push(`Labels rounded to the nearest ${formatMoney(spec.displayStep, unit, { language: scope.language, precision: wholeUnits })}; totals are exact sums${drift > 1e-9 ? `, so rounded labels differ from the total by ${formatMoney(drift, unit, { language: scope.language, precision: wholeUnits })}` : ""}.`);
  }
  if (plan.unknownCount) {
    const names = plan.bars.filter((b) => b.kind === "unknown").map((b) => b.label).join(", ");
    footer.push(`Unknown: ${names}. Not counted as zero; totals marked “known items” exclude ${plan.unknownCount === 1 ? "it" : "them"}.`);
  }
  for (const d of plan.diagnostics) if (d.code === "waterfall-total-mismatch") footer.push(`Check: ${d.message.replace(" The chart draws the derived sum.", "")}; the bar shows the sum.`);
  const fit = spec.baseline === "fit";
  const values = plan.bars.flatMap((b) => (fit && (b.kind === "start" || b.kind === "subtotal" || b.kind === "total") ? [b.to] : [b.from, b.to]));
  const lo = Math.min(...values), hi = Math.max(...values);
  const axis = valueAxis(fit ? lo - (hi - lo) * 0.25 : Math.min(lo, 0), hi, { zero: !fit });
  if (fit) {
    if (axis.min > 0) {
      footer.push(`Value axis starts at ${formatMoney(axis.min, unit, { language: scope.language })}, not zero; bar lengths are not proportional to totals.`);
      scope.diagnostics.push({ code: "axis-truncated", severity: "warning", message: `The value axis starts at ${axis.min}; captioned on the chart.` });
    }
  }
  for (const b of plan.bars) if (b.note) footer.push(`${b.noteMark} ${b.label}: ${b.note}`);

  const { body } = drawChrome(scope, options,
    { title: spec.title, subtitle: spec.subtitle, unit: unitLine(unit, plan.unknownCount ? `${plan.unknownCount} unknown item${plan.unknownCount > 1 ? "s" : ""}` : undefined) },
    footer);

  // Legend: direction is encoded by sign text as well as color.
  const kinds = new Set(plan.bars.map((b) => b.kind));
  const legend = [
    kinds.has("increase") ? { id: "increase", label: "Adds (+)", color: palette.increase } : null,
    kinds.has("decrease") ? { id: "decrease", label: "Reduces (−)", color: palette.decrease } : null,
    kinds.has("subtotal") || kinds.has("start") ? { id: "subtotal", label: "Level", color: palette.subtotal } : null,
    { id: "total", label: "Total", color: palette.total },
    kinds.has("unknown") ? { id: "unknown", label: "Unknown", color: palette.unknown, dashed: true } : null,
  ].filter((x): x is NonNullable<typeof x> => !!x);
  const legendH = drawLegend(scope, body, legend);
  const plotBox: RectInfo = { x: body.x, y: body.y + legendH + (style.spacing[2] ?? 24), width: body.width, height: Math.max(40, body.height - legendH - (style.spacing[2] ?? 24)) };

  const n = plan.bars.length;
  const tickLabels = axis.ticks.map((t) => formatMoney(t, unit, { language: scope.language, compact: true }));
  const labelLH = lineBox(style, "label");
  const dimmed = (id: string) => (spec.highlight?.length ? !spec.highlight.includes(id) : false);
  const labelText = (b: WaterfallBar) => `${b.label}${b.noteMark ?? ""}`;
  const valueText = (b: WaterfallBar) => {
    if (b.kind === "unknown") return "Unknown";
    const v = b.amount as number;
    const s = b.kind === "start" || b.kind === "subtotal" || b.kind === "total" ? money(v) : b.kind === "zero" ? money(0) : money(v, true);
    return b.partial && (b.kind === "subtotal" || b.kind === "total") ? `${s}\nknown items` : s;
  };

  // Layout choice: columns unless portrait or labels would need > 3 lines.
  const gutter = Math.max(...tickLabels.map((t) => labelWidth(scope, t, "caption"))) + 14;
  const colW = (plotBox.width - gutter) / Math.max(1, n);
  const columnsFit = plan.bars.every((b) => {
    const p = scope.text({ text: labelText(b), box: { x: 0, y: 0, width: colW - 10, height: 1e3 }, typeRole: "label" });
    const words = labelText(b).split(/\s+/);
    return p.lines.length <= 3 && words.every((w) => labelWidth(scope, w, "label") <= colW - 10);
  }) && plan.bars.every((b) => valueText(b).split("\n").every((line) => labelWidth(scope, line, "label", style.weight.strong) <= colW - 4));
  const mode: "columns" | "rows" = spec.layout === "columns" || spec.layout === "rows" ? spec.layout : options.height > options.width * 1.05 || !columnsFit ? "rows" : "columns";

  const anchors: Record<string, RectInfo> = { plot: plotBox };
  const stroke = style.stroke.hairline;

  if (mode === "columns") {
    const labelLines = Math.max(1, ...plan.bars.map((b) => scope.text({ text: labelText(b), box: { x: 0, y: 0, width: colW - 10, height: 1e3 }, typeRole: "label" }).lines.length));
    const catH = labelLines * labelLH + 12;
    const valueLines = Math.max(1, ...plan.bars.map((b) => valueText(b).split("\n").length));
    const top = plotBox.y + labelLH * valueLines + 10;
    const plot: RectInfo = { x: plotBox.x + gutter, y: top, width: plotBox.width - gutter, height: Math.max(20, plotBox.y + plotBox.height - catH - top) };
    anchors.plot = plot;
    const y = scaleLinear(axis.min, axis.max, plot.y + plot.height, plot.y);
    for (let k = 0; k < axis.ticks.length; k++) {
      const t = axis.ticks[k], ty = y(t);
      scope.push(linePrimitive({ x: plot.x, y: ty }, { x: plot.x + plot.width, y: ty }, { stroke: t === 0 ? style.color.rule : style.color.grid, strokeWidth: t === 0 ? style.stroke.rule : stroke, role: t === 0 ? "baseline" : "gridline" }, context));
      scope.push(scope.text({ text: tickLabels[k], box: { x: plotBox.x, y: ty - lineBox(style, "caption") / 2, width: gutter - 12, height: lineBox(style, "caption") }, typeRole: "caption", color: style.color.inkSubtle, align: "end", role: "axis-tick", tabular: true }));
    }
    const barW = Math.min(colW * 0.64, 180);
    plan.bars.forEach((b, i) => {
      const cx = plot.x + colW * (i + 0.5), x0 = cx - barW / 2;
      const p = revealProgress(options.frame, b.revealStart, b.revealEnd - b.revealStart);
      const dim = dimmed(b.id) ? 0.32 : 1;
      const isLevel = b.kind === "start" || b.kind === "subtotal" || b.kind === "total";
      const base = isLevel ? Math.max(axis.min, 0) : b.from;
      const end = base + (b.to - base) * p;
      const yA = y(base), yB = y(end);
      const rect = { x: x0, y: Math.min(yA, yB), width: barW, height: Math.max(Math.abs(yB - yA), 0) };
      anchors[b.id] = { x: x0, y: Math.min(y(base), y(b.to)), width: barW, height: Math.abs(y(b.to) - y(base)) };
      if (b.kind === "unknown") {
        const h = Math.max(labelLH * 1.6, 28);
        if (p > 0) scope.push(rectPrimitive({ x: x0, y: y(b.from) - h / 2, width: barW, height: h }, { fill: "none", stroke: palette.unknown, strokeWidth: 2, dash: "dashed", radius: style.radius.sm, opacity: p * dim, role: "waterfall-unknown", semanticId: `${spec.id}.${b.id}` }, context));
        anchors[b.id] = { x: x0, y: y(b.from) - h / 2, width: barW, height: h };
      } else if (b.kind === "zero") {
        if (p > 0) scope.push(linePrimitive({ x: x0, y: y(b.from) }, { x: x0 + barW, y: y(b.from) }, { stroke: palette.zero, strokeWidth: 4, opacity: p * dim, role: "waterfall-zero", semanticId: `${spec.id}.${b.id}` }, context));
      } else if (p > 0) {
        if (b.partial && isLevel) scope.push(rectPrimitive({ ...rect, height: Math.max(rect.height, 1.5) }, { fill: palette[b.kind], radius: style.radius.sm, opacity: 0.14 * dim, role: "waterfall-partial-fill" }, context));
        scope.push(rectPrimitive({ ...rect, height: Math.max(rect.height, 1.5) }, {
          fill: b.partial && isLevel ? "none" : palette[b.kind], stroke: b.partial && isLevel ? palette[b.kind] : undefined, strokeWidth: b.partial && isLevel ? 3 : undefined, dash: b.partial && isLevel ? "dashed" : undefined,
          radius: style.radius.sm, opacity: dim, role: `waterfall-${b.kind}`, semanticId: `${spec.id}.${b.id}`,
        }, context));
      }
      // Connector from this bar's end level to the next bar.
      if (i < n - 1 && p >= 1) {
        const nx = plot.x + colW * (i + 1.5) - barW / 2;
        scope.push(linePrimitive({ x: x0 + barW, y: y(b.to) }, { x: nx, y: y(b.to) }, { stroke: style.color.connectorMuted, strokeWidth: stroke, dash: "dashed", role: "waterfall-connector", opacity: dim }, context));
      }
      // Value label above the bar's top end.
      const vOpacity = Math.max(0, Math.min(1, (p - 0.55) / 0.45)) * dim;
      const topY = b.kind === "unknown" ? y(b.from) - Math.max(labelLH * 1.6, 28) / 2 : Math.min(y(b.from), y(b.to), y(isLevel ? Math.max(axis.min, 0) : b.from));
      const vLines = valueText(b).split("\n").length;
      scope.push(scope.text({ text: valueText(b), box: { x: cx - colW / 2 + 2, y: topY - labelLH * vLines - 6, width: colW - 4, height: labelLH * vLines }, typeRole: "label", weight: isLevel ? style.weight.strong : undefined,
        color: b.kind === "decrease" ? palette.decrease : b.kind === "unknown" ? style.color.inkMuted : style.color.ink, align: "center", role: "waterfall-value", tabular: true, opacity: vOpacity, semanticId: `${spec.id}.${b.id}` }));
      // Category label below the plot.
      const pending = p > 0 ? 1 : 0.4;
      scope.push(scope.text({ text: labelText(b), box: { x: cx - colW / 2 + 5, y: plot.y + plot.height + 10, width: colW - 10, height: catH }, typeRole: "label", weight: isLevel ? style.weight.strong : undefined,
        color: isLevel ? style.color.ink : style.color.inkMuted, align: "center", role: "waterfall-label", opacity: pending * dim, semanticId: `${spec.id}.${b.id}` }));
    });
  } else {
    // Rows: labels in a measured left column, bars run left → right.
    const labelCol = Math.min(plotBox.width * 0.4, Math.max(...plan.bars.map((b) => labelWidth(scope, labelText(b), "label", style.weight.strong))) + 16);
    const valueCol = Math.max(...plan.bars.flatMap((b) => valueText(b).split("\n").map((line) => labelWidth(scope, line, "label", style.weight.strong)))) + 16;
    const tickH = lineBox(style, "caption") + 10;
    const plot: RectInfo = { x: plotBox.x + labelCol, y: plotBox.y, width: Math.max(40, plotBox.width - labelCol - valueCol), height: Math.max(20, plotBox.height - tickH) };
    anchors.plot = plot;
    const rowH = plot.height / Math.max(1, n);
    const barH = Math.min(rowH * 0.6, 64);
    const x = scaleLinear(axis.min, axis.max, plot.x, plot.x + plot.width);
    const tickEvery = Math.max(1, Math.ceil((Math.max(...tickLabels.map((t) => labelWidth(scope, t, "caption"))) + 18) / (plot.width / Math.max(1, axis.ticks.length - 1))));
    axis.ticks.forEach((t, k) => {
      const tx = x(t);
      scope.push(linePrimitive({ x: tx, y: plot.y }, { x: tx, y: plot.y + plot.height }, { stroke: t === 0 ? style.color.rule : style.color.grid, strokeWidth: t === 0 ? style.stroke.rule : stroke, role: t === 0 ? "baseline" : "gridline" }, context));
      if (k % tickEvery === 0) scope.push(scope.text({ text: tickLabels[k], box: { x: tx - 60, y: plot.y + plot.height + 8, width: 120, height: lineBox(style, "caption") }, typeRole: "caption", color: style.color.inkSubtle, align: "center", role: "axis-tick", tabular: true }));
    });
    plan.bars.forEach((b, i) => {
      const cy = plot.y + rowH * (i + 0.5), y0 = cy - barH / 2;
      const p = revealProgress(options.frame, b.revealStart, b.revealEnd - b.revealStart);
      const dim = dimmed(b.id) ? 0.32 : 1;
      const isLevel = b.kind === "start" || b.kind === "subtotal" || b.kind === "total";
      const base = isLevel ? Math.max(axis.min, 0) : b.from;
      const end = base + (b.to - base) * p;
      const xa = x(base), xb = x(end);
      anchors[b.id] = { x: Math.min(x(base), x(b.to)), y: y0, width: Math.abs(x(b.to) - x(base)), height: barH };
      if (b.kind === "unknown") {
        const w = Math.max(barH * 1.4, 36);
        if (p > 0) scope.push(rectPrimitive({ x: x(b.from) - w / 2, y: y0, width: w, height: barH }, { fill: "none", stroke: palette.unknown, strokeWidth: 2, dash: "dashed", radius: style.radius.sm, opacity: p * dim, role: "waterfall-unknown", semanticId: `${spec.id}.${b.id}` }, context));
        anchors[b.id] = { x: x(b.from) - w / 2, y: y0, width: w, height: barH };
      } else if (b.kind === "zero") {
        if (p > 0) scope.push(linePrimitive({ x: x(b.from), y: y0 }, { x: x(b.from), y: y0 + barH }, { stroke: palette.zero, strokeWidth: 4, opacity: p * dim, role: "waterfall-zero", semanticId: `${spec.id}.${b.id}` }, context));
      } else if (p > 0) {
        if (b.partial && isLevel) scope.push(rectPrimitive({ x: Math.min(xa, xb), y: y0, width: Math.max(Math.abs(xb - xa), 1.5), height: barH }, { fill: palette[b.kind], radius: style.radius.sm, opacity: 0.14 * dim, role: "waterfall-partial-fill" }, context));
        scope.push(rectPrimitive({ x: Math.min(xa, xb), y: y0, width: Math.max(Math.abs(xb - xa), 1.5), height: barH }, {
          fill: b.partial && isLevel ? "none" : palette[b.kind], stroke: b.partial && isLevel ? palette[b.kind] : undefined, strokeWidth: b.partial && isLevel ? 3 : undefined, dash: b.partial && isLevel ? "dashed" : undefined,
          radius: style.radius.sm, opacity: dim, role: `waterfall-${b.kind}`, semanticId: `${spec.id}.${b.id}`,
        }, context));
      }
      if (i < n - 1 && p >= 1) {
        scope.push(linePrimitive({ x: x(b.to), y: y0 + barH }, { x: x(b.to), y: cy + rowH - barH / 2 }, { stroke: style.color.connectorMuted, strokeWidth: stroke, dash: "dashed", role: "waterfall-connector", opacity: dim }, context));
      }
      const right = b.kind === "unknown" ? x(b.from) + Math.max(barH * 1.4, 36) / 2 : Math.max(x(b.from), x(b.to), x(base));
      const vOpacity = Math.max(0, Math.min(1, (p - 0.55) / 0.45)) * dim;
      const vLines = valueText(b).split("\n").length;
      scope.push(scope.text({ text: valueText(b), box: { x: right + 8, y: cy - (labelLH * vLines) / 2, width: plotBox.x + plotBox.width - right - 8, height: labelLH * vLines }, typeRole: "label", weight: isLevel ? style.weight.strong : undefined,
        color: b.kind === "decrease" ? palette.decrease : b.kind === "unknown" ? style.color.inkMuted : style.color.ink, role: "waterfall-value", tabular: true, opacity: vOpacity, semanticId: `${spec.id}.${b.id}` }));
      const lab = scope.text({ text: labelText(b), box: { x: plotBox.x, y: cy - rowH / 2, width: labelCol - 16, height: rowH }, typeRole: "label", weight: isLevel ? style.weight.strong : undefined,
        color: isLevel ? style.color.ink : style.color.inkMuted, align: "end", valign: "middle", role: "waterfall-label", opacity: (p > 0 ? 1 : 0.4) * dim, semanticId: `${spec.id}.${b.id}`, maxLines: 2 });
      scope.push(lab);
    });
  }

  const head = plan.bars[0];
  const summary = [
    `${spec.title}.`,
    head?.kind === "start" ? `Starts at ${money(head.amount as number)} (${head.label}).` : "",
    `${plan.bars.filter((b) => b.kind === "increase").length} additions totaling ${money(plan.increases)} and ${plan.bars.filter((b) => b.kind === "decrease").length} reductions totaling ${money(-plan.decreases)}`,
    `bring the total to ${money(plan.total)}${plan.unknownCount ? ` for known items; ${plan.unknownCount} item${plan.unknownCount > 1 ? "s are" : " is"} unknown` : ""}.`,
    `Unit: ${unitLine(unit) || "unlabeled"}.`,
  ].filter(Boolean).join(" ");
  return { ...finish(scope, options, { summary, title: spec.title, anchors, revealEnd: plan.revealEnd }), plan, layout: mode };
}
