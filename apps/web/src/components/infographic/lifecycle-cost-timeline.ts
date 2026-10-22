/**
 * E02 `LifecycleCostTimeline` — lifetime cost as recurring categories, one-off
 * events and an accumulated total over an authored horizon.
 *
 * Values are **precomputed per period** by the author (no NPV, amortization, tax
 * or inflation math happens here). The plan rejects series whose cadence
 * (`per-year` / `per-month`) or currency basis differs from the chart's, keeps
 * missing values distinct from zero and negative values, and tells event
 * amounts that are already inside a category (`includedIn`) apart from extra
 * one-off amounts, so nothing is double counted.
 *
 * Views: `annual` stacked bars, `cumulative` line, or `both` on a shared time
 * axis; event markers align to the authored axis values; one category can be
 * focused. The reveal is a constant-speed playhead over periods.
 */

import {
  assignGuideLanes,
  checkAlignedSeries,
  createChartScope,
  drawChrome,
  drawLegend,
  finish,
  formatMoney,
  fromMinor,
  labelInterval,
  labelWidth,
  lineBox,
  linearProgress,
  minorDigitsOf,
  periodIndexOf,
  periodLabel,
  provenanceLines,
  scaleLinear,
  seriesColorAt,
  toMinor,
  unitLine,
  valueAxis,
} from "./economic";
import type { Cadence, CurrencyBasis, DataProvenance, EconomicChartOptions, EconomicChartResult, MoneyUnit, TimeAxisSpec } from "./economic";
import { ellipsePrimitive, linePrimitive, polylinePrimitive, rectPrimitive } from "./primitives";
import type { InfographicDiagnostic, RectInfo } from "./types";

export interface LifecycleCategorySpec {
  id: string;
  label: string;
  /** One precomputed value per period; `null` = unknown (never zero). */
  values: (number | null)[];
  /** Must match the axis (`per-year` for a yearly axis). */
  cadence?: Cadence;
  /** Must match the chart's basis when declared. */
  basis?: CurrencyBasis;
  color?: string;
}

export interface LifecycleEventSpec {
  id: string;
  label: string;
  /** Axis value (e.g. `2038`, or `12` on a relative axis). Fractions place the marker within the period. */
  at: number;
  /** One-off amount. Omit for a marker-only event. */
  amount?: number | null;
  /** The amount is already inside this category's values: draw the marker, do not add it again. */
  includedIn?: string;
}

export interface LifecycleCostTimelineSpec {
  id: string;
  title: string;
  subtitle?: string;
  unit: MoneyUnit;
  axis: TimeAxisSpec;
  categories: LifecycleCategorySpec[];
  events?: LifecycleEventSpec[];
  /** @default "both" */
  view?: "annual" | "cumulative" | "both";
  /** Category id to emphasize; its own cumulative line is drawn too. */
  focus?: string;
  provenance?: DataProvenance;
  /** Constant-speed playhead: `framesPerPeriod` frames per period from `start`. */
  reveal?: { start?: number; framesPerPeriod?: number };
  /** Label for the extra one-off layer. @default "One-off events" */
  eventsLabel?: string;
}

export interface LifecyclePeriod {
  index: number;
  label: string;
  /** Known total (categories + extra event amounts). */
  total: number;
  positive: number;
  negative: number;
  /** Category ids with a missing value in this period. */
  missing: string[];
  /** Category value (or `null`) by id, plus `"events"` for extra one-off amounts. */
  parts: Record<string, number | null>;
}

export interface LifecycleEvent extends LifecycleEventSpec {
  index: number;
  /** Amount added on top of the categories (0 when `includedIn` or marker-only). */
  extra: number;
}

export interface LifecycleCostPlan {
  categories: (LifecycleCategorySpec & { values: (number | null)[]; color: string; total: number; missingCount: number })[];
  periods: LifecyclePeriod[];
  /** Running total of known values, per period end. */
  cumulative: number[];
  /** First period with any missing value; from here the cumulative line covers known values only. */
  incompleteFrom: number | null;
  events: LifecycleEvent[];
  eventsTotal: number;
  grandTotal: number;
  diagnostics: InfographicDiagnostic[];
}

/** Pure plan: validated series, exact per-period sums, cumulative totals and diagnostics. */
export function planLifecycleCost(spec: LifecycleCostTimelineSpec, colors: (i: number, explicit?: string) => string = (i, e) => e ?? `series-${i}`): LifecycleCostPlan {
  const diagnostics: InfographicDiagnostic[] = [];
  const report = (d: InfographicDiagnostic) => diagnostics.push(d);
  const digits = minorDigitsOf(spec.unit);
  const n = Math.max(0, Math.floor(spec.axis.count));
  if (!spec.unit.basis) report({ code: "basis-undeclared", severity: "error", message: "Declare unit.basis (nominal, real or present-value); lifecycle totals are meaningless without it.", path: "/unit/basis" });
  if (n < 1) report({ code: "axis-empty", severity: "error", message: "The time axis needs at least one period.", path: "/axis/count" });
  const ids = new Set<string>();
  const categories: LifecycleCostPlan["categories"] = [];
  spec.categories.forEach((c, i) => {
    if (ids.has(c.id)) report({ code: "duplicate-id", severity: "error", message: `Category id "${c.id}" is used twice.`, targetId: c.id });
    ids.add(c.id);
    const values = checkAlignedSeries(c.label, `/categories/${i}`, c.values, { cadence: c.cadence, basis: c.basis }, spec.axis, spec.unit, report, { requireCadence: true });
    if (!values) return;
    const total = fromMinor(values.reduce<number>((s, v) => s + (v === null ? 0 : toMinor(v, digits)), 0), digits);
    categories.push({ ...c, values, color: colors(i, c.color), total, missingCount: values.filter((v) => v === null).length });
  });
  const events: LifecycleEvent[] = [];
  for (const [k, e] of (spec.events ?? []).entries()) {
    const index = periodIndexOf(spec.axis, e.at);
    if (index === null) { report({ code: "event-out-of-range", severity: "error", message: `Event "${e.label}" at ${e.at} is outside the horizon (${spec.axis.start}–${spec.axis.start + n - 1}); not drawn.`, targetId: e.id, path: `/events/${k}` }); continue; }
    if (e.includedIn && !categories.some((c) => c.id === e.includedIn)) report({ code: "event-unknown-category", severity: "error", message: `Event "${e.label}" says it is included in "${e.includedIn}", which is not a charted category; its amount is not added.`, targetId: e.id });
    if (e.amount === null) report({ code: "event-amount-unknown", severity: "warning", message: `Event "${e.label}" has an unknown amount; drawn as a marker only.`, targetId: e.id });
    const extra = e.includedIn || e.amount === null || e.amount === undefined || !Number.isFinite(e.amount) ? 0 : e.amount;
    events.push({ ...e, index, extra });
  }
  const periods: LifecyclePeriod[] = [];
  const cumulative: number[] = [];
  let run = 0, incompleteFrom: number | null = null, eventsMinor = 0;
  for (let i = 0; i < n; i++) {
    const parts: Record<string, number | null> = {};
    let pos = 0, neg = 0;
    const missing: string[] = [];
    for (const c of categories) {
      const v = c.values[i];
      parts[c.id] = v;
      if (v === null) { missing.push(c.id); continue; }
      const m = toMinor(v, digits);
      if (m > 0) pos += m; else neg += m;
    }
    const extra = events.filter((e) => Math.floor(e.index + 1e-9) === i).reduce((s, e) => s + toMinor(e.extra, digits), 0);
    if (extra) { parts.events = fromMinor(extra, digits); if (extra > 0) pos += extra; else neg += extra; eventsMinor += extra; }
    if (missing.length && incompleteFrom === null) incompleteFrom = i;
    run += pos + neg;
    periods.push({ index: i, label: periodLabel(spec.axis, i), total: fromMinor(pos + neg, digits), positive: fromMinor(pos, digits), negative: fromMinor(neg, digits), missing, parts });
    cumulative.push(fromMinor(run, digits));
  }
  const missingCats = categories.filter((c) => c.missingCount);
  if (missingCats.length) report({ code: "values-missing", severity: "warning", message: `Missing values in ${missingCats.map((c) => `${c.label} (${c.missingCount})`).join(", ")}; drawn as missing and excluded from totals.` });
  return { categories, periods, cumulative, incompleteFrom, events, eventsTotal: fromMinor(eventsMinor, digits), grandTotal: fromMinor(run, digits), diagnostics };
}

export interface LifecycleCostTimelineResult extends EconomicChartResult {
  plan: LifecycleCostPlan;
}

/** Lay the timeline out as infographic primitives at an absolute `frame`. */
export function renderLifecycleCostTimeline(spec: LifecycleCostTimelineSpec, options: EconomicChartOptions): LifecycleCostTimelineResult {
  const scope = createChartScope(spec.id, options);
  const { style, context } = scope;
  const plan = planLifecycleCost(spec, (i, e) => seriesColorAt(style, i, e));
  scope.diagnostics.push(...plan.diagnostics);
  const unit = spec.unit, axisSpec = spec.axis, n = plan.periods.length, lang = scope.language;
  const view = spec.view ?? "both";
  const money = (v: number, compact = true) => formatMoney(v, unit, { language: lang, compact });
  const eventColor = style.color.ink;
  const eventsLabel = spec.eventsLabel ?? "One-off events";
  const reveal = { start: spec.reveal?.start ?? 0, fpp: spec.reveal?.framesPerPeriod ?? 6 };
  const revealEnd = reveal.start + reveal.fpp * n;
  const head = linearProgress(options.frame, reveal.start, reveal.fpp * n) * n; // periods revealed (fractional)
  const grow = (i: number) => { const t = Math.max(0, Math.min(1, head - i)); return 1 - (1 - t) ** 3; };
  const focus = spec.focus && plan.categories.some((c) => c.id === spec.focus) ? spec.focus : undefined;
  if (spec.focus && !focus) scope.diagnostics.push({ code: "focus-unknown", severity: "warning", message: `Focus "${spec.focus}" is not a charted category.` });

  // Footer.
  const footer = provenanceLines(spec.provenance);
  const missingCats = plan.categories.filter((c) => c.missingCount);
  if (missingCats.length) {
    footer.push(`Missing (not zero): ${missingCats.map((c) => `${c.label} in ${c.values.map((v, i) => (v === null ? periodLabel(axisSpec, i, lang) : null)).filter(Boolean).slice(0, 4).join(", ")}${c.missingCount > 4 ? "…" : ""}`).join("; ")}.${plan.incompleteFrom !== null ? ` The cumulative line is dashed from ${periodLabel(axisSpec, plan.incompleteFrom, lang)}: it covers known values only.` : ""}`);
  }
  if (plan.periods.some((p) => p.negative < 0)) footer.push("Bars below zero are negative values (credits, income or resale) as supplied.");
  const included = plan.events.filter((e) => e.includedIn);
  if (included.length) footer.push(`Events marked ◆ are already inside their category (${included.map((e) => e.label).join(", ")}); they are not added twice.`);
  footer.push(`Values are precomputed ${axisSpec.unit === "year" ? "yearly" : "monthly"} amounts in ${unitLine(unit) || "undeclared units"}; Kumiki does not discount, inflate or amortize.`);

  const horizon = `${n} ${axisSpec.unit === "year" ? "years" : "months"} · ${periodLabel(axisSpec, 0, lang)}–${periodLabel(axisSpec, n - 1, lang)}`;
  const { body } = drawChrome(scope, options, { title: spec.title, subtitle: spec.subtitle, unit: unitLine(unit, unit.basis ? horizon : `basis not declared · ${horizon}`) }, footer);

  // Legend with horizon totals.
  const legendItems: Parameters<typeof drawLegend>[2][number][] = plan.categories.map((c) => ({ id: c.id, label: `${c.label} · ${money(c.total)}${c.missingCount ? ` + ${c.missingCount} missing` : ""}`, color: c.color, dim: !!focus && focus !== c.id }));
  if (plan.events.some((e) => e.extra)) legendItems.push({ id: "events", label: `${eventsLabel} · ${money(plan.eventsTotal)}`, color: eventColor, dim: !!focus });
  if (missingCats.length) legendItems.push({ id: "missing", label: "Missing value", color: style.color.inkSubtle, dashed: true });
  const legendH = drawLegend(scope, body, legendItems);
  let y = body.y + legendH + (style.spacing[1] ?? 16);

  // Event label lanes (measured, collision-free).
  const tickW = Math.max(...plan.periods.map((p) => labelWidth(scope, p.label, "caption")), 10);
  const gutterProbe = [0, plan.grandTotal, ...plan.periods.map((p) => p.positive), ...plan.periods.map((p) => p.negative)].map((v) => labelWidth(scope, money(v), "caption"));
  const gutter = Math.max(...gutterProbe) + 14;
  const plotX = body.x + gutter, plotW = Math.max(40, body.width - gutter - 8);
  const pw = plotW / Math.max(1, n);
  const cx = (i: number) => plotX + (i + 0.5) * pw;
  const evLH = lineBox(style, "caption");
  const evTexts = plan.events.map((e) => `${e.includedIn ? "◆ " : ""}${e.label}${e.amount !== undefined ? ` · ${e.amount === null ? "amount unknown" : money(e.amount)}` : ""}`);
  const evW = evTexts.map((t) => Math.min(plotW, labelWidth(scope, t, "caption") + 8));
  const evSpans = plan.events.map((e, k) => {
    // Flag labels start at their own guide (or end at it near the right edge), so guides rarely sit inside
    // another label and lane assignment can keep every guide clear of every label.
    const x = cx(e.index); const a = x - 2 + evW[k] <= plotX + plotW ? x - 2 : Math.max(plotX, x + 2 - evW[k]); return [a, a + evW[k]] as [number, number];
  });
  const lanes = assignGuideLanes(plan.events.map((e, j) => ({ x: cx(e.index), span: evSpans[j] })), 12);
  const laneCount = lanes.length ? Math.max(...lanes) + 1 : 0;
  const laneTop = y;
  y += laneCount * (evLH + 6) + (laneCount ? 8 : 0);
  y += evLH + 6; // panel label row

  const xLabelH = (evLH + 10) * (axisSpec.title ? 2 : 1);
  const remaining = body.y + body.height - y - xLabelH;
  const gap = style.spacing[2] ?? 24;
  const panels: { kind: "annual" | "cumulative"; box: RectInfo }[] = [];
  if (view === "both") {
    const hA = (remaining - gap) * 0.56;
    panels.push({ kind: "annual", box: { x: plotX, y, width: plotW, height: hA } });
    panels.push({ kind: "cumulative", box: { x: plotX, y: y + hA + gap, width: plotW, height: remaining - gap - hA } });
  } else panels.push({ kind: view, box: { x: plotX, y, width: plotW, height: remaining } });
  const anchors: Record<string, RectInfo> = {};
  const plotTop = panels[0].box.y, plotBottom = panels[panels.length - 1].box.y + panels[panels.length - 1].box.height;

  // Shared time axis labels and event guides.
  const k = labelInterval(n, plotW, tickW);
  for (let i = 0; i < n; i += k) {
    scope.push(scope.text({ text: plan.periods[i].label, box: { x: cx(i) - pw * k / 2, y: plotBottom + 8, width: pw * k, height: evLH }, typeRole: "caption", color: style.color.inkSubtle, align: "center", role: "axis-tick", tabular: true }));
  }
  if (axisSpec.title) {
    scope.push(scope.text({ text: axisSpec.title, box: { x: plotX, y: plotBottom + evLH + 16, width: plotW, height: evLH }, typeRole: "caption", color: style.color.inkMuted, align: "center", role: "axis-title" }));
  }
  plan.events.forEach((e, j) => {
    const shown = head >= e.index + 0.5 || options.frame === undefined;
    const x = cx(e.index), o = shown ? 1 : 0;
    const ly = laneTop + (laneCount - 1 - lanes[j]) * (evLH + 6);
    // The guide skips the panel-label row so it never runs through header text.
    const guide = { stroke: style.color.connectorMuted, strokeWidth: style.stroke.hairline, dash: "dashed" as const, role: "event-guide", opacity: o * 0.9, semanticId: `${spec.id}.event.${e.id}` };
    if (plotTop - evLH - 6 > ly + evLH + 2) scope.push(linePrimitive({ x, y: ly + evLH + 2 }, { x, y: plotTop - evLH - 6 }, guide, context));
    for (const pn of panels) scope.push(linePrimitive({ x, y: pn.box.y }, { x, y: pn.box.y + pn.box.height }, guide, context));
    scope.push(scope.text({ text: evTexts[j], box: { x: evSpans[j][0], y: ly, width: evW[j], height: evLH }, typeRole: "caption", color: style.color.ink, align: evSpans[j][0] < x - 4 ? "end" : "start", role: "event-label", opacity: o, semanticId: `${spec.id}.event.${e.id}` }));
    anchors[`event.${e.id}`] = { x: x - 1, y: ly, width: 2, height: plotBottom - ly };
  });

  for (const panel of panels) {
    const box = panel.box;
    anchors[panel.kind] = box;
    if (panel.kind === "annual") {
      const lo = Math.min(0, ...plan.periods.map((p) => p.negative)), hi = Math.max(0, ...plan.periods.map((p) => p.positive));
      const ax = valueAxis(lo, hi, { target: Math.max(3, Math.min(6, Math.round(box.height / 70))), tight: true });
      const yv = scaleLinear(ax.min, ax.max, box.y + box.height, box.y);
      ax.ticks.forEach((t) => {
        scope.push(linePrimitive({ x: box.x, y: yv(t) }, { x: box.x + box.width, y: yv(t) }, { stroke: t === 0 ? style.color.rule : style.color.grid, strokeWidth: t === 0 ? style.stroke.rule : style.stroke.hairline, role: t === 0 ? "baseline" : "gridline" }, context));
        scope.push(scope.text({ text: money(t), box: { x: body.x, y: yv(t) - evLH / 2, width: gutter - 12, height: evLH }, typeRole: "caption", color: style.color.inkSubtle, align: "end", role: "axis-tick", tabular: true }));
      });
      scope.push(scope.text({ text: axisSpec.unit === "year" ? "Per year" : "Per month", box: { x: box.x + 6, y: box.y - evLH - 2, width: 300, height: evLH }, typeRole: "caption", color: style.color.inkMuted, role: "panel-label" }));
      const bw = Math.max(1, Math.min(pw * 0.74, 64));
      for (const p of plan.periods) {
        const g = grow(p.index);
        if (g <= 0) continue;
        const x0 = cx(p.index) - bw / 2;
        let up = 0, down = 0;
        const layers = [...plan.categories.map((c) => ({ id: c.id, color: c.color, v: p.parts[c.id] })), { id: "events", color: eventColor, v: p.parts.events ?? 0 }];
        for (const l of layers) {
          if (l.v === null || l.v === undefined || l.v === 0) continue;
          const v = l.v * g;
          const a = l.v > 0 ? up : down, b = a + v;
          if (l.v > 0) up = b; else down = b;
          const dim = focus && focus !== l.id ? 0.22 : 1;
          scope.push(rectPrimitive({ x: x0, y: Math.min(yv(a), yv(b)), width: bw, height: Math.max(0.75, Math.abs(yv(b) - yv(a))) }, { fill: l.color, opacity: dim, role: l.id === "events" ? "lifecycle-event-bar" : "lifecycle-bar", semanticId: `${spec.id}.${l.id}.${p.index}` }, context));
        }
        if (p.missing.length) {
          const h = Math.max(10, Math.min(22, box.height * 0.06));
          scope.push(rectPrimitive({ x: x0, y: yv(up) - h - 2, width: bw, height: h }, { fill: "none", stroke: style.color.inkSubtle, strokeWidth: 1.5, dash: "dashed", opacity: g, role: "lifecycle-missing", semanticId: `${spec.id}.missing.${p.index}` }, context));
        } else if (p.positive === 0 && p.negative === 0) {
          scope.push(linePrimitive({ x: x0, y: yv(0) - 1.5 }, { x: x0 + bw, y: yv(0) - 1.5 }, { stroke: style.color.inkSubtle, strokeWidth: 3, opacity: g, role: "lifecycle-zero" }, context));
        }
      }
    } else {
      const series = [plan.cumulative];
      const focusCat = plan.categories.find((c) => c.id === focus);
      const focusCum = focusCat ? focusCat.values.reduce<number[]>((acc, v) => { acc.push((acc[acc.length - 1] ?? 0) + (v ?? 0)); return acc; }, []) : null;
      if (focusCum) series.push(focusCum);
      const all = series.flat();
      const ax = valueAxis(Math.min(0, ...all), Math.max(0, ...all), { target: Math.max(3, Math.min(6, Math.round(box.height / 70))), tight: true });
      const yv = scaleLinear(ax.min, ax.max, box.y + box.height, box.y);
      ax.ticks.forEach((t) => {
        scope.push(linePrimitive({ x: box.x, y: yv(t) }, { x: box.x + box.width, y: yv(t) }, { stroke: t === 0 ? style.color.rule : style.color.grid, strokeWidth: t === 0 ? style.stroke.rule : style.stroke.hairline, role: t === 0 ? "baseline" : "gridline" }, context));
        scope.push(scope.text({ text: money(t), box: { x: body.x, y: yv(t) - evLH / 2, width: gutter - 12, height: evLH }, typeRole: "caption", color: style.color.inkSubtle, align: "end", role: "axis-tick", tabular: true }));
      });
      scope.push(scope.text({ text: "Cumulative", box: { x: box.x + 6, y: box.y - evLH - 2, width: 300, height: evLH }, typeRole: "caption", color: style.color.inkMuted, role: "panel-label" }));
      // Points at period ends: x = right edge of period i; starts at 0 at the left edge.
      const px = (i: number) => box.x + (i + 1) * pw;
      const drawLine = (vals: number[], color: string, width: number, role: string, incompleteFrom: number | null) => {
        const pts: [number, number][] = [[box.x, yv(0)]];
        const visible = Math.min(n, head);
        for (let i = 0; i < n; i++) {
          if (i + 1 <= visible) pts.push([px(i), yv(vals[i])]);
          else if (i < visible) { const t = visible - i, prev = i ? vals[i - 1] : 0; pts.push([box.x + (i + t) * pw, yv(prev + (vals[i] - prev) * t)]); break; } else break;
        }
        const cut = incompleteFrom === null ? pts.length : Math.min(pts.length, incompleteFrom + 1);
        if (cut > 1) scope.push(polylinePrimitive(pts.slice(0, cut), { stroke: color, strokeWidth: width, role }, context));
        if (cut < pts.length) scope.push(polylinePrimitive(pts.slice(cut - 1), { stroke: color, strokeWidth: width, dash: "dashed", role: `${role}-incomplete` }, context));
        return pts;
      };
      const pts = drawLine(plan.cumulative, style.color.ink, style.stroke.strong, "lifecycle-cumulative", plan.incompleteFrom);
      if (focusCum && focusCat) drawLine(focusCum, focusCat.color, style.stroke.strong, "lifecycle-cumulative-focus", focusCat.missingCount ? focusCat.values.findIndex((v) => v === null) : null);
      for (const e of plan.events) {
        const i = Math.floor(e.index + 1e-9);
        if (head < e.index + 0.5 && options.frame !== undefined) continue;
        // On the line at the event's own date: the period's cost accrues linearly across it.
        const t = e.index - i + 0.5 > 1 ? 1 : e.index - i + 0.5, prev = i ? plan.cumulative[i - 1] : 0;
        const ex = box.x + (i + t) * pw, ev = prev + (plan.cumulative[i] - prev) * t;
        scope.push(ellipsePrimitive({ x: ex - 5, y: yv(ev) - 5, width: 10, height: 10 }, { fill: style.color.canvas, stroke: style.color.ink, strokeWidth: 2, role: "event-dot", semanticId: `${spec.id}.event.${e.id}` }, context));
      }
      // End label (current value while revealing).
      const last = pts[pts.length - 1];
      if (pts.length > 1) {
        const shownIdx = Math.min(n - 1, Math.max(0, Math.ceil(head) - 1));
        const value = head >= n ? plan.grandTotal : plan.cumulative[shownIdx];
        const text = `${head >= n ? "Total" : periodLabel(axisSpec, shownIdx, lang)}: ${money(value, false)}${plan.incompleteFrom !== null && shownIdx >= plan.incompleteFrom ? " known" : ""}`;
        const w = labelWidth(scope, text, "label", style.weight.strong) + 8;
        const lx = Math.max(box.x, Math.min(box.x + box.width - w, last[0] - w));
        const ly = Math.max(box.y, last[1] - lineBox(style, "label") - 10);
        scope.push(scope.text({ text, box: { x: lx, y: ly, width: w, height: lineBox(style, "label") }, typeRole: "label", weight: style.weight.strong, align: "end", role: "lifecycle-total", tabular: true }));
        if (focusCum && focusCat && head >= n) {
          const ft = `${focusCat.label}: ${money(focusCum[n - 1], false)} (${Math.round((focusCum[n - 1] / (plan.grandTotal || 1)) * 100)}%)`;
          const fw = labelWidth(scope, ft, "label") + 8, fy = yv(focusCum[n - 1]);
          scope.push(scope.text({ text: ft, box: { x: box.x + box.width - fw, y: Math.min(box.y + box.height - lineBox(style, "label"), fy + 8), width: fw, height: lineBox(style, "label") }, typeRole: "label", color: focusCat.color, align: "end", role: "lifecycle-focus-total", tabular: true }));
        }
      }
    }
  }
  if (options.frame !== undefined && head > 0 && head < n) {
    const x = plotX + head * pw;
    scope.push(linePrimitive({ x, y: plotTop }, { x, y: plotBottom }, { stroke: style.color.accent, strokeWidth: style.stroke.rule, role: "playhead", opacity: 0.7 }, context));
  }

  const shares = plan.categories.map((c) => `${c.label} ${money(c.total, false)}${plan.grandTotal ? ` (${Math.round((c.total / plan.grandTotal) * 100)}%)` : ""}`).join("; ");
  const summary = `${spec.title}. ${horizon}, ${unitLine(unit) || "undeclared units"}. Known total ${money(plan.grandTotal, false)}: ${shares}${plan.eventsTotal ? `; ${eventsLabel.toLowerCase()} ${money(plan.eventsTotal, false)}` : ""}.${plan.events.length ? ` Events: ${plan.events.map((e) => `${e.label} (${periodLabel(axisSpec, e.index, lang)})`).join(", ")}.` : ""}${missingCats.length ? " Some values are missing and excluded." : ""}`;
  return { ...finish(scope, options, { summary, title: spec.title, anchors, revealEnd }), plan };
}
