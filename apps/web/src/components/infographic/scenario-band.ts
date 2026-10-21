/**
 * E05 `ScenarioBand` — supplied low / base / high scenarios and bounded ranges.
 *
 * The band's meaning is declared and printed: a `range` between authored
 * scenarios is **not** a probability statement; an `interval` must state its
 * level and method. Observed (`actual`) values are drawn differently from
 * modeled projections, with a labeled divider where projection begins. Missing
 * projections are gaps, never zeros. Scenario order (low ≤ base ≤ high) is
 * checked, not repaired.
 *
 * Use it standalone, or overlay the band on another plot with
 * {@link scenarioBandLayer}. Values are authored; Kumiki forecasts nothing.
 */

import {
  checkAlignedSeries,
  createChartScope,
  drawChrome,
  drawLegend,
  finish,
  formatMoney,
  labelWidth,
  lineBox,
  linearProgress,
  periodIndexOf,
  periodLabel,
  provenanceLines,
  scaleLinear,
  seriesColorAt,
  spreadLabels,
  tickFormatter,
  unitLine,
  valueAxis,
} from "./economic";
import type { ChartScope, DataProvenance, EconomicChartOptions, EconomicChartResult, MoneyUnit, TimeAxisSpec } from "./economic";
import { ellipsePrimitive, linePrimitive, polylinePrimitive } from "./primitives";
import type { InfographicDiagnostic, InfographicPrimitive, RectInfo } from "./types";

export type ScenarioRole = "low" | "base" | "high" | "alternative";

export interface ScenarioSeriesSpec {
  id: string;
  label: string;
  role: ScenarioRole;
  /** One value per sample; `null` = no projection for that sample. */
  values: (number | null)[];
  /** Printed under the chart next to the scenario name. */
  assumption?: string;
  color?: string;
}

/** What the shaded area means. A `range` is explicitly not a probability statement. */
export type BandMeaning =
  | { meaning: "range" }
  | { meaning: "interval"; /** e.g. 0.9 for a 90% interval. */ level: number; /** How it was produced, e.g. "Monte Carlo over price history". */ method: string };

export interface ScenarioBandSpec {
  id: string;
  title: string;
  subtitle?: string;
  unit: MoneyUnit;
  axis: TimeAxisSpec;
  scenarios: ScenarioSeriesSpec[];
  /** Observed values (drawn solid with dots); usually `null` after the projection start. */
  actual?: { label?: string; values: (number | null)[] };
  band: BandMeaning;
  /** Axis value where modeled values begin; defaults to the first sample with any scenario value. */
  projectionStart?: number;
  /** Value axis caption, e.g. "Annual premium" or "Price per kWh". */
  valueLabel?: string;
  /** Keep zero on the value axis. @default true */
  zero?: boolean;
  provenance?: DataProvenance;
  reveal?: { start?: number; framesPerPeriod?: number };
}

export interface ScenarioBandPlan {
  low: ScenarioSeriesSpec | null;
  base: ScenarioSeriesSpec | null;
  high: ScenarioSeriesSpec | null;
  alternatives: ScenarioSeriesSpec[];
  actual: (number | null)[] | null;
  /** Sample index where projection starts. */
  projectionStart: number;
  /** Samples where low/high are both known (band drawn). */
  bandRuns: [number, number][];
  diagnostics: InfographicDiagnostic[];
  bandCaption: string;
}

const ROLE_LABEL: Record<ScenarioRole, string> = { low: "Low", base: "Base", high: "High", alternative: "Alternative" };

/** Pure plan: aligned scenarios, order checks, band runs and the band's printed meaning. */
export function planScenarioBand(spec: ScenarioBandSpec): ScenarioBandPlan {
  const diagnostics: InfographicDiagnostic[] = [];
  const report = (d: InfographicDiagnostic) => diagnostics.push(d);
  const n = Math.max(0, Math.floor(spec.axis.count));
  const aligned: ScenarioSeriesSpec[] = [];
  const ids = new Set<string>();
  spec.scenarios.forEach((s, i) => {
    if (ids.has(s.id)) report({ code: "duplicate-id", severity: "error", message: `Scenario id "${s.id}" is used twice.`, targetId: s.id });
    ids.add(s.id);
    const values = checkAlignedSeries(s.label, `/scenarios/${i}`, s.values, {}, spec.axis, spec.unit, report);
    if (values) aligned.push({ ...s, values });
  });
  const one = (role: ScenarioRole) => {
    const found = aligned.filter((s) => s.role === role);
    if (found.length > 1) report({ code: "scenario-role-duplicate", severity: "error", message: `More than one "${role}" scenario; using "${found[0].label}". Use role "alternative" for the others.` });
    return found[0] ?? null;
  };
  const low = one("low"), base = one("base"), high = one("high");
  const alternatives = aligned.filter((s) => s.role === "alternative");
  if (!base) report({ code: "scenario-base-missing", severity: "warning", message: "No base scenario; only the range is drawn." });
  if (!!low !== !!high) report({ code: "band-incomplete", severity: "error", message: "A band needs both a low and a high scenario; none is drawn." });
  if (spec.band.meaning === "interval" && (!(spec.band.level > 0 && spec.band.level < 1) || !spec.band.method?.trim())) {
    report({ code: "interval-undeclared", severity: "error", message: "An interval band needs a level between 0 and 1 and a method; it is captioned as a range instead." });
  }
  if (!spec.unit.basis && spec.unit.currency) report({ code: "basis-undeclared", severity: "warning", message: "Declare unit.basis (nominal, real or present-value) for money scenarios." });
  // Order checks, never repaired.
  const bad: number[] = [];
  for (let i = 0; i < n; i++) {
    const l = low?.values[i] ?? null, b = base?.values[i] ?? null, h = high?.values[i] ?? null;
    if ((l !== null && h !== null && l > h) || (l !== null && b !== null && b < l) || (h !== null && b !== null && b > h)) bad.push(i);
  }
  if (bad.length) report({ code: "scenario-order", severity: "error", message: `Low ≤ base ≤ high is violated at ${bad.slice(0, 4).map((i) => periodLabel(spec.axis, i)).join(", ")}${bad.length > 4 ? "…" : ""}; check the scenario data (drawn as supplied).` });
  const bandRuns: [number, number][] = [];
  if (low && high) {
    let s = -1;
    for (let i = 0; i <= n; i++) {
      const ok = i < n && low.values[i] !== null && high.values[i] !== null;
      if (ok && s < 0) s = i;
      if (!ok && s >= 0) { bandRuns.push([s, i - 1]); s = -1; }
    }
    const gaps = Array.from({ length: n }, (_, i) => i).filter((i) => (low.values[i] === null) !== (high.values[i] === null));
    if (gaps.length) report({ code: "band-partial", severity: "warning", message: `Low and high disagree on which samples exist (${gaps.length}); the band is drawn only where both exist.` });
  }
  const actual = spec.actual ? checkAlignedSeries(spec.actual.label ?? "Actual", "/actual", spec.actual.values, {}, spec.axis, spec.unit, report) : null;
  const firstModeled = Array.from({ length: n }, (_, i) => i).find((i) => aligned.some((s) => s.values[i] !== null)) ?? 0;
  const declared = spec.projectionStart !== undefined ? periodIndexOf(spec.axis, spec.projectionStart) : null;
  if (spec.projectionStart !== undefined && declared === null) report({ code: "projection-start-out-of-range", severity: "error", message: `projectionStart ${spec.projectionStart} is not on the axis.` });
  const projectionStart = declared ?? firstModeled;
  if (actual) {
    const overlap = actual.map((v, i) => (v !== null && i > projectionStart ? i : -1)).filter((i) => i >= 0);
    if (overlap.length) report({ code: "actual-after-projection", severity: "warning", message: `Actual values continue past the projection start (${overlap.length} samples); they are still drawn as actual.` });
  }
  const valid = spec.band.meaning === "interval" && spec.band.level > 0 && spec.band.level < 1 && !!spec.band.method?.trim();
  const bandCaption = valid && spec.band.meaning === "interval"
    ? `Shaded: ${Math.round(spec.band.level * 100)}% interval (${spec.band.method}).`
    : "Shaded: range between the low and high scenarios. It is not a probability or confidence interval.";
  return { low, base, high, alternatives, actual, projectionStart, bandRuns, diagnostics, bandCaption };
}

/**
 * Band, scenario lines and actual values as primitives inside `plot`, for
 * overlaying on another chart that shares the same x/y mapping.
 */
export function scenarioBandLayer(
  scope: ChartScope,
  plan: ScenarioBandPlan,
  map: { x: (i: number) => number; y: (v: number) => number; head: number; n: number; plot: RectInfo; colors: { band: string; base: string; low: string; high: string; actual: string; alt: (i: number) => string } }
): InfographicPrimitive[] {
  const { context, style } = scope;
  const out: InfographicPrimitive[] = [];
  const { x, y, head, n } = map;
  const clip = (i: number) => i <= head + 1e-9;
  for (const [a, b] of plan.bandRuns) {
    if (!plan.low || !plan.high || !clip(a)) continue;
    const end = Math.min(b, Math.floor(head));
    const top: [number, number][] = [], bottom: [number, number][] = [];
    for (let i = a; i <= end; i++) { top.push([x(i), y(plan.high.values[i] as number)]); bottom.unshift([x(i), y(plan.low.values[i] as number)]); }
    if (head < b && head > end && end + 1 < n) {
      const f = head - end, i = end + 1;
      const hi = plan.high.values[end] as number, lo = plan.low.values[end] as number;
      top.push([x(end + f), y(hi + ((plan.high.values[i] as number) - hi) * f)]); bottom.unshift([x(end + f), y(lo + ((plan.low.values[i] as number) - lo) * f)]);
    }
    if (top.length > 1) out.push(polylinePrimitive([...top, ...bottom], { closed: true, fill: map.colors.band, opacity: 0.18, role: "scenario-band" }, context));
  }
  const line = (vals: (number | null)[], color: string, width: number, dash: "solid" | "dashed" | "dotted", role: string) => {
    let run: [number, number][] = [];
    const flush = () => { if (run.length > 1) out.push(polylinePrimitive(run, { stroke: color, strokeWidth: width, dash: dash === "solid" ? undefined : dash, role }, context)); run = []; };
    for (let i = 0; i < n; i++) {
      const v = vals[i];
      if (v === null) { flush(); continue; }
      if (!clip(i)) {
        const p = vals[i - 1];
        if (i > 0 && p !== null && head > i - 1) { const f = head - (i - 1); run.push([x(i - 1 + f), y(p + (v - p) * f)]); }
        break;
      }
      run.push([x(i), y(v)]);
    }
    flush();
  };
  if (plan.low) line(plan.low.values, map.colors.low, style.stroke.rule, "dashed", "scenario-low");
  if (plan.high) line(plan.high.values, map.colors.high, style.stroke.rule, "dashed", "scenario-high");
  plan.alternatives.forEach((s, k) => line(s.values, map.colors.alt(k), style.stroke.strong, "dotted", "scenario-alternative"));
  if (plan.base) line(plan.base.values, map.colors.base, style.stroke.strong, "solid", "scenario-base");
  if (plan.actual) {
    line(plan.actual, map.colors.actual, style.stroke.strong + 0.5, "solid", "scenario-actual");
    plan.actual.forEach((v, i) => { if (v !== null && clip(i)) out.push(ellipsePrimitive({ x: x(i) - 4, y: y(v) - 4, width: 8, height: 8 }, { fill: map.colors.actual, role: "scenario-actual-dot" }, context)); });
  }
  return out;
}

export interface ScenarioBandResult extends EconomicChartResult {
  plan: ScenarioBandPlan;
}

/** Standalone scenario chart at an absolute `frame`. */
export function renderScenarioBand(spec: ScenarioBandSpec, options: EconomicChartOptions): ScenarioBandResult {
  const scope = createChartScope(spec.id, options);
  const { style, context } = scope;
  const plan = planScenarioBand(spec);
  scope.diagnostics.push(...plan.diagnostics);
  const n = Math.max(1, Math.floor(spec.axis.count)), lang = scope.language, unit = spec.unit, span = Math.max(1, n - 1);
  const money = (v: number, compact = true) => formatMoney(v, unit, { language: lang, compact });
  const reveal = { start: spec.reveal?.start ?? 0, fpp: spec.reveal?.framesPerPeriod ?? 8 };
  const revealEnd = reveal.start + reveal.fpp * span;
  const head = linearProgress(options.frame, reveal.start, reveal.fpp * span) * span;
  const colors = {
    band: style.color.accent, base: style.color.accent, low: style.color.inkMuted, high: style.color.inkMuted, actual: style.color.ink,
    alt: (k: number) => seriesColorAt(style, k + 2),
  };

  const all = [plan.low, plan.base, plan.high, ...plan.alternatives].flatMap((s) => s?.values ?? []).concat(plan.actual ?? []).filter((v): v is number => v !== null);
  const ax = valueAxis(Math.min(...all, spec.zero === false ? Infinity : 0), Math.max(...all), { zero: spec.zero !== false, target: 5, tight: true });
  const tick = tickFormatter(ax.step, unit, lang);
  const footer = provenanceLines(spec.provenance);
  footer.unshift(plan.bandCaption);
  if (spec.zero === false && ax.min > 0) {
    footer.push(`The value axis starts at ${tick(ax.min)}, not zero.`);
    scope.diagnostics.push({ code: "axis-truncated", severity: "warning", message: "The value axis does not start at zero; captioned." });
  }
  for (const d of plan.diagnostics) if (["scenario-order", "interval-undeclared", "band-incomplete", "band-partial"].includes(d.code)) footer.push(`Check: ${d.message}`);
  for (const s of [plan.low, plan.base, plan.high, ...plan.alternatives]) if (s?.assumption) footer.push(`${ROLE_LABEL[s.role]} · ${s.label}: ${s.assumption}`);
  if (plan.actual) footer.push(`Solid line with dots: actual values. From ${periodLabel(spec.axis, plan.projectionStart, lang)}, lines are modeled scenarios supplied by the source.`);
  if ([plan.low, plan.base, plan.high, ...plan.alternatives].some((s) => s && s.values.some((v, i) => v === null && i >= plan.projectionStart))) footer.push("Gaps are samples without a projection; they are not zero.");

  const { body } = drawChrome(scope, options, { title: spec.title, subtitle: spec.subtitle, unit: unitLine(unit, `${periodLabel(spec.axis, 0, lang)}–${periodLabel(spec.axis, n - 1, lang)}`) }, footer);
  const legend: Parameters<typeof drawLegend>[2][number][] = [];
  if (plan.actual) legend.push({ id: "actual", label: spec.actual?.label ?? "Actual", color: colors.actual, marker: "line" });
  if (plan.base) legend.push({ id: plan.base.id, label: plan.base.label, color: colors.base, marker: "line" });
  if (plan.low && plan.high) legend.push({ id: "band", label: spec.band.meaning === "interval" && plan.bandCaption.includes("interval (") ? `${Math.round(spec.band.level * 100)}% interval` : "Scenario range (not a probability)", color: colors.band });
  plan.alternatives.forEach((s, k) => legend.push({ id: s.id, label: s.label, color: colors.alt(k), marker: "line" }));
  const legendH = drawLegend(scope, body, legend);
  const capLH = lineBox(style, "caption"), labLH = lineBox(style, "label");
  let y0 = body.y + legendH + (style.spacing[1] ?? 16) + capLH + 6;

  const endItems = [plan.high, plan.base, plan.low, ...plan.alternatives].filter((s): s is ScenarioSeriesSpec => !!s);
  const lastOf = (vals: (number | null)[]) => { for (let i = vals.length - 1; i >= 0; i--) if (vals[i] !== null) return { i, v: vals[i] as number }; return null; };
  const endText = (s: ScenarioSeriesSpec) => { const l = lastOf(s.values); return `${s.role === "alternative" ? s.label : `${ROLE_LABEL[s.role]}`} · ${l ? money(l.v) : "n/a"}`; };
  const leftG = Math.max(...ax.ticks.map((t) => labelWidth(scope, tick(t), "caption"))) + 16;
  const rightG = Math.min(body.width * 0.3, Math.max(0, ...endItems.map((s) => labelWidth(scope, endText(s), "label", style.weight.strong))) + 22);
  const xLabelH = capLH + 10 + (spec.axis.title ? capLH + 8 : 0);
  const plot: RectInfo = { x: body.x + leftG, y: y0, width: Math.max(60, body.width - leftG - rightG), height: Math.max(40, body.y + body.height - y0 - xLabelH) };
  const xs = (i: number) => plot.x + (i / span) * plot.width;
  const yv = scaleLinear(ax.min, ax.max, plot.y + plot.height, plot.y);
  y0 = plot.y;

  for (const t of ax.ticks) {
    scope.push(linePrimitive({ x: plot.x, y: yv(t) }, { x: plot.x + plot.width, y: yv(t) }, { stroke: t === 0 ? style.color.rule : style.color.grid, strokeWidth: t === 0 ? style.stroke.rule : style.stroke.hairline, role: t === 0 ? "baseline" : "gridline" }, context));
    scope.push(scope.text({ text: tick(t), box: { x: body.x, y: yv(t) - capLH / 2, width: leftG - 12, height: capLH }, typeRole: "caption", color: style.color.inkSubtle, align: "end", role: "axis-tick", tabular: true }));
  }
  if (spec.valueLabel) scope.push(scope.text({ text: spec.valueLabel, box: { x: plot.x + 6, y: plot.y - capLH - 4, width: plot.width / 2, height: capLH }, typeRole: "caption", color: style.color.inkMuted, role: "panel-label" }));
  const tickW = Math.max(...Array.from({ length: n }, (_, i) => labelWidth(scope, periodLabel(spec.axis, i, lang), "caption")));
  const every = [1, 2, 5, 10, 20, 25, 50].find((k) => (plot.width / span) * k >= tickW * 1.3) ?? Math.ceil(n / 2);
  for (let i = 0; i < n; i += every) scope.push(scope.text({ text: periodLabel(spec.axis, i, lang), box: { x: xs(i) - 60, y: plot.y + plot.height + 8, width: 120, height: capLH }, typeRole: "caption", color: style.color.inkSubtle, align: "center", role: "axis-tick", tabular: true }));
  if (spec.axis.title) scope.push(scope.text({ text: spec.axis.title, box: { x: plot.x, y: plot.y + plot.height + capLH + 16, width: plot.width, height: capLH }, typeRole: "caption", color: style.color.inkMuted, align: "center", role: "axis-title" }));

  // Actual | projected divider with labels on either side (inside the plot's top edge).
  if (plan.actual && plan.projectionStart > 0) {
    const dx = xs(plan.projectionStart);
    scope.push(linePrimitive({ x: dx, y: plot.y }, { x: dx, y: plot.y + plot.height }, { stroke: style.color.connectorMuted, strokeWidth: style.stroke.hairline, dash: "dashed", role: "projection-divider" }, context));
    const la = "← Actual", lb = "Projected →", wa = labelWidth(scope, la, "caption") + 6, wb = labelWidth(scope, lb, "caption") + 6;
    if (dx - wa - 8 > plot.x) scope.push(scope.text({ text: la, box: { x: dx - wa - 8, y: plot.y + 4, width: wa, height: capLH }, typeRole: "caption", color: style.color.inkMuted, align: "end", role: "projection-label" }));
    if (dx + 8 + wb < plot.x + plot.width) scope.push(scope.text({ text: lb, box: { x: dx + 8, y: plot.y + 4, width: wb, height: capLH }, typeRole: "caption", color: style.color.inkMuted, role: "projection-label" }));
  }
  scope.push(...scenarioBandLayer(scope, plan, { x: xs, y: yv, head, n, plot, colors }));

  // End labels in the right gutter, spread so they never stack.
  if (head >= span - 1e-9) {
    const ends = endItems.map((s) => lastOf(s.values)).map((l) => (l ? yv(l.v) : plot.y));
    const ys = spreadLabels(ends, labLH + 4, plot.y, plot.y + plot.height);
    endItems.forEach((s, k) => {
      const color = s.role === "base" ? colors.base : s.role === "alternative" ? colors.alt(plan.alternatives.indexOf(s)) : style.color.inkMuted;
      scope.push(scope.text({ text: endText(s), box: { x: plot.x + plot.width + 12, y: ys[k] - labLH / 2, width: rightG - 14, height: labLH }, typeRole: "label", weight: s.role === "base" ? style.weight.strong : undefined, color, role: "scenario-end", tabular: true, semanticId: `${spec.id}.${s.id}` }));
    });
  }
  if (options.frame !== undefined && head > 0 && head < span) scope.push(linePrimitive({ x: xs(head), y: plot.y }, { x: xs(head), y: plot.y + plot.height }, { stroke: style.color.accent, strokeWidth: style.stroke.rule, opacity: 0.6, role: "playhead" }, context));

  const endSummary = endItems.map((s) => endText(s).replace(" · ", " ")).join(", ");
  const summary = `${spec.title}. ${unitLine(unit) || "undeclared units"}. ${plan.bandCaption} At ${periodLabel(spec.axis, n - 1, lang, true)}: ${endSummary}.${plan.actual ? ` Actual values until ${periodLabel(spec.axis, plan.projectionStart, lang, true)}.` : ""}`;
  return { ...finish(scope, options, { summary, title: spec.title, anchors: { plot }, revealEnd }), plan };
}
