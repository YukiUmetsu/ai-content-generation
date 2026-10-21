/**
 * E03 `BreakEvenComparison` — compare precomputed cumulative series and say
 * truthfully where (and whether) they cross.
 *
 * {@link analyzeBreakEven} compares every option with a baseline sample by
 * sample. Crossings are located by linear interpolation, at a declared jump
 * (never interpolated across), inside a near-equal stretch, or only bracketed
 * when samples are missing. Multiple crossings, no crossing, ties and
 * insufficient data are distinct outcomes. A crossing is **never** called
 * payback unless the author supplies a payback definition, and a `sustained`
 * payback requires staying ahead through the end of the horizon with no missing
 * samples.
 *
 * Views: crossing lines with upfront and end labels, a difference plot against
 * the baseline, and optional low/high bands. Kumiki computes no savings,
 * discounting or financing; all series are authored.
 */

import {
  assignGuideLanes,
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
  unitLine,
  valueAxis,
} from "./economic";
import type { DataProvenance, EconomicChartOptions, EconomicChartResult, MoneyUnit, TimeAxisSpec } from "./economic";
import { ellipsePrimitive, linePrimitive, polylinePrimitive, rectPrimitive } from "./primitives";
import type { InfographicDiagnostic, RectInfo } from "./types";

export interface BreakEvenOptionSpec {
  id: string;
  label: string;
  /** Cumulative value at each sample (axis value `start + i`); `null` = missing. */
  values: (number | null)[];
  color?: string;
  /** Optional supplied range, aligned with `values`. */
  low?: (number | null)[];
  high?: (number | null)[];
  /** Samples where the series changes abruptly (replacement, rebate, resale): never interpolated across. */
  jumps?: { at: number; label?: string }[];
}

export interface BreakEvenSpec {
  id: string;
  title: string;
  subtitle?: string;
  unit: MoneyUnit;
  /** Sample axis: `count` samples at `start, start + 1, …` (e.g. year 0 = upfront). */
  axis: TimeAxisSpec;
  /** What the series mean; decides which side is "ahead". */
  semantics: "cumulative-cost" | "cumulative-savings";
  options: BreakEvenOptionSpec[];
  /** Option every other option is compared with. @default the first option */
  baseline?: string;
  /** Between samples: straight lines or steps. @default "linear" */
  interpolation?: "linear" | "step";
  /** Differences within ± tolerance count as near-equal, not as a lead. @default 0 */
  tolerance?: number;
  /** Only with an explicit definition is anything labeled payback. */
  payback?: { label: string; rule: "sustained" | "first" };
  /** @default "both" */
  view?: "lines" | "difference" | "both";
  /** Source assumptions printed under the chart (rates, prices, usage). */
  assumptions?: string[];
  provenance?: DataProvenance;
  reveal?: { start?: number; framesPerPeriod?: number };
}

export type CrossingKind = "interpolated" | "at-jump" | "step" | "through-tie" | "in-gap";

export interface Crossing {
  /** Fractional sample index of the crossing (start of the interval for brackets). */
  at: number;
  /** Interval that brackets the crossing; equal to `[at, at]` when located exactly. */
  range: [number, number];
  located: boolean;
  kind: CrossingKind;
  /** `gains-lead`: the option moves ahead of the baseline; `loses-lead`: falls behind. */
  direction: "gains-lead" | "loses-lead";
  /** Baseline value at the crossing (for placing the marker); null when not located. */
  value: number | null;
}

export type PairStatus = "insufficient-data" | "no-crossover" | "single-crossover" | "multiple-crossovers";

export interface BreakEvenPair {
  optionId: string;
  baselineId: string;
  /** option − baseline per sample. */
  difference: (number | null)[];
  state: ("ahead" | "behind" | "tie" | null)[];
  crossings: Crossing[];
  ties: [number, number][];
  status: PairStatus;
  /** State at the last comparable sample. */
  finalState: "ahead" | "behind" | "tie" | null;
  /** Point from which the option stays ahead through the horizon end, if it does. */
  aheadFrom: number | null;
  /** True when ahead at every comparable sample. */
  aheadThroughout: boolean;
  /** Labeled payback point under the authored definition, if any. */
  payback: { at: number; located: boolean; permanent: boolean } | null;
}

export interface BreakEvenAnalysis {
  baselineId: string;
  pairs: BreakEvenPair[];
  diagnostics: InfographicDiagnostic[];
  options: (Omit<BreakEvenOptionSpec, "values" | "low" | "high"> & { values: (number | null)[]; low: (number | null)[] | null; high: (number | null)[] | null; jumpIndex: Set<number> })[];
}

/** Pure analysis: aligned series, per-sample lead state, crossings, ties and payback under the authored rule. */
export function analyzeBreakEven(spec: BreakEvenSpec): BreakEvenAnalysis {
  const diagnostics: InfographicDiagnostic[] = [];
  const report = (d: InfographicDiagnostic) => diagnostics.push(d);
  const n = Math.max(0, Math.floor(spec.axis.count));
  const tol = Math.max(0, spec.tolerance ?? 0);
  if (!spec.unit.basis) report({ code: "basis-undeclared", severity: "error", message: "Declare unit.basis (nominal, real or present-value) so cumulative series are comparable.", path: "/unit/basis" });
  const ids = new Set<string>();
  const options: BreakEvenAnalysis["options"] = [];
  spec.options.forEach((o, i) => {
    if (ids.has(o.id)) report({ code: "duplicate-id", severity: "error", message: `Option id "${o.id}" is used twice.`, targetId: o.id });
    ids.add(o.id);
    const values = checkAlignedSeries(o.label, `/options/${i}`, o.values, {}, spec.axis, spec.unit, report);
    if (!values) return;
    const align = (v?: (number | null)[]) => (v ? checkAlignedSeries(`${o.label} range`, `/options/${i}/range`, v, {}, spec.axis, spec.unit, report) : null);
    const jumpIndex = new Set<number>();
    for (const j of o.jumps ?? []) {
      const k = periodIndexOf(spec.axis, j.at);
      if (k === null || !Number.isInteger(Math.round(k * 1e6) / 1e6)) report({ code: "jump-out-of-range", severity: "error", message: `Jump at ${j.at} for "${o.label}" is not a sample on the axis.`, targetId: o.id });
      else jumpIndex.add(Math.round(k));
    }
    if (spec.semantics === "cumulative-cost") {
      for (let k = 1; k < n; k++) {
        const a = values[k - 1], b = values[k];
        if (a !== null && b !== null && b < a - 1e-9 && !jumpIndex.has(k)) {
          report({ code: "non-cumulative", severity: "warning", targetId: o.id, message: `"${o.label}" decreases at ${periodLabel(spec.axis, k)}. Cumulative costs only fall at a declared jump (rebate, resale); declare it in jumps or check the data.` });
          break;
        }
      }
    }
    options.push({ ...o, values, low: align(o.low), high: align(o.high), jumpIndex });
  });
  if (options.length < 2) report({ code: "break-even-needs-two", severity: "error", message: "A break-even comparison needs at least two usable options.", path: "/options" });
  const base = options.find((o) => o.id === spec.baseline) ?? options[0];
  if (spec.baseline && base?.id !== spec.baseline) report({ code: "baseline-unknown", severity: "error", message: `Baseline "${spec.baseline}" is not an option; using "${base?.label}".` });
  const pairs: BreakEvenPair[] = [];
  if (!base) return { baselineId: "", pairs, diagnostics, options };
  const aheadSign = spec.semantics === "cumulative-cost" ? -1 : 1;

  for (const o of options) {
    if (o === base) continue;
    const difference = o.values.map((v, i) => (v === null || base.values[i] === null ? null : v - (base.values[i] as number)));
    const state = difference.map((d) => (d === null ? null : Math.abs(d) <= tol ? "tie" : Math.sign(d) === aheadSign ? "ahead" : "behind"));
    const crossings: Crossing[] = [];
    const ties: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      if (state[i] !== "tie") continue;
      const s = i; while (i + 1 < n && state[i + 1] === "tie") i++;
      ties.push([s, i]);
    }
    const valueAt = (t: number) => {
      const i = Math.floor(t), f = t - i, a = base.values[i], b = base.values[Math.min(n - 1, i + 1)];
      if (a === null) return null;
      if (f < 1e-9 || b === null) return a;
      return spec.interpolation === "step" || base.jumpIndex.has(i + 1) ? a : a + (b - a) * f;
    };
    let lastIdx = -1;
    for (let i = 0; i < n; i++) {
      const s = state[i];
      if (s !== "ahead" && s !== "behind") continue;
      if (lastIdx >= 0 && state[lastIdx] !== s) {
        const direction = s === "ahead" ? "gains-lead" : "loses-lead";
        const between = state.slice(lastIdx + 1, i);
        if (between.some((x) => x === null)) {
          crossings.push({ at: lastIdx, range: [lastIdx, i], located: false, kind: "in-gap", direction, value: null });
        } else if (between.length) {
          const t0 = lastIdx + 1, t1 = i - 1;
          crossings.push(t0 === t1
            ? { at: t0, range: [t0, t0], located: true, kind: "through-tie", direction, value: base.values[t0] }
            : { at: (t0 + t1) / 2, range: [t0, t1], located: false, kind: "through-tie", direction, value: null });
        } else if (o.jumpIndex.has(i) || base.jumpIndex.has(i)) {
          crossings.push({ at: i, range: [i, i], located: true, kind: "at-jump", direction, value: base.values[i] });
        } else if (spec.interpolation === "step") {
          crossings.push({ at: i, range: [i, i], located: true, kind: "step", direction, value: base.values[i] });
        } else {
          const da = difference[lastIdx] as number, db = difference[i] as number;
          const t = lastIdx + da / (da - db);
          crossings.push({ at: t, range: [t, t], located: true, kind: "interpolated", direction, value: valueAt(t) });
        }
      }
      lastIdx = i;
    }
    const comparable = state.filter((x) => x !== null).length;
    const lastComparable = [...state].reverse().find((x) => x !== null) ?? null;
    const firstDefinite = state.find((x) => x === "ahead" || x === "behind") ?? null;
    const aheadThroughout = comparable > 0 && state.every((x) => x === null || x === "ahead") && !state.includes(null);
    // Sustained lead: ahead at the last sample, every sample from the last gain onward known and ahead (or tied).
    let aheadFrom: number | null = null;
    if (lastComparable === "ahead" && state[n - 1] !== null) {
      const lastCross = crossings[crossings.length - 1];
      const from = lastCross ? lastCross.range[1] : 0;
      const tail = state.slice(Math.ceil(from));
      if (!tail.includes(null) && !tail.includes("behind")) aheadFrom = lastCross ? lastCross.at : firstDefinite === "ahead" ? 0 : null;
    }
    let payback: BreakEvenPair["payback"] = null;
    if (spec.payback) {
      const gains = crossings.filter((c) => c.direction === "gains-lead");
      if (spec.payback.rule === "sustained") {
        const last = crossings[crossings.length - 1];
        if (aheadFrom !== null && last && last.direction === "gains-lead") payback = { at: last.at, located: last.located, permanent: true };
      } else if (gains[0]) {
        const lostAfter = crossings.some((c) => c.direction === "loses-lead" && c.at > gains[0].at);
        payback = { at: gains[0].at, located: gains[0].located, permanent: !lostAfter && aheadFrom !== null };
        if (lostAfter) report({ code: "payback-not-permanent", severity: "warning", targetId: o.id, message: `"${o.label}" gains the lead at ${periodLabel(spec.axis, gains[0].at)} but falls behind again later; the first crossover is labeled with that caveat.` });
      }
    }
    const status: PairStatus = comparable < 2 ? "insufficient-data" : crossings.length === 0 ? "no-crossover" : crossings.length === 1 ? "single-crossover" : "multiple-crossovers";
    if (status === "insufficient-data") report({ code: "insufficient-data", severity: "error", targetId: o.id, message: `"${o.label}" and "${base.label}" share fewer than two comparable samples.` });
    if (crossings.some((c) => !c.located && c.kind === "in-gap")) report({ code: "crossing-in-gap", severity: "warning", targetId: o.id, message: `"${o.label}" crosses "${base.label}" inside missing samples; the chart brackets the interval instead of placing a point.` });
    pairs.push({ optionId: o.id, baselineId: base.id, difference, state, crossings, ties, status, finalState: lastComparable, aheadFrom, aheadThroughout, payback });
  }
  return { baselineId: base.id, pairs, diagnostics, options };
}

export interface BreakEvenResult extends EconomicChartResult {
  analysis: BreakEvenAnalysis;
}

/** Lay the comparison out as infographic primitives at an absolute `frame`. */
export function renderBreakEvenComparison(spec: BreakEvenSpec, options: EconomicChartOptions): BreakEvenResult {
  const scope = createChartScope(spec.id, options);
  const { style, context } = scope;
  const analysis = analyzeBreakEven(spec);
  scope.diagnostics.push(...analysis.diagnostics);
  const n = Math.max(1, Math.floor(spec.axis.count)), lang = scope.language, unit = spec.unit, axisSpec = spec.axis;
  const view = spec.view ?? "both";
  const money = (v: number, compact = true) => formatMoney(v, unit, { language: lang, compact });
  const at = (t: number) => periodLabel(axisSpec, t, lang, true);
  const opts = analysis.options.map((o, i) => ({ ...o, color: seriesColorAt(style, i, o.color) }));
  const base = opts.find((o) => o.id === analysis.baselineId);
  const reveal = { start: spec.reveal?.start ?? 0, fpp: spec.reveal?.framesPerPeriod ?? 8 };
  const span = Math.max(1, n - 1);
  const revealEnd = reveal.start + reveal.fpp * span;
  const head = linearProgress(options.frame, reveal.start, reveal.fpp * span) * span;
  const ahead = spec.semantics === "cumulative-cost" ? "costs less" : "saves more";
  const behind = spec.semantics === "cumulative-cost" ? "costs more" : "saves less";

  // Footer: provenance, assumptions, definitions and honesty notes.
  const footer = provenanceLines(spec.provenance);
  for (const a of spec.assumptions ?? []) footer.push(`Assumption: ${a}`);
  if (spec.payback) footer.push(`“${spec.payback.label}” here means ${spec.payback.rule === "sustained" ? "the point after which the option stays ahead of the baseline through the end of the horizon" : "the first point where the option moves ahead of the baseline"}${spec.tolerance ? ` (differences within ±${money(spec.tolerance, false)} count as equal)` : ""}.`);
  else footer.push(`Crossovers mark where lines cross; no payback definition was supplied, so none is labeled${spec.tolerance ? `; differences within ±${money(spec.tolerance, false)} count as equal` : ""}.`);
  for (const p of analysis.pairs) {
    const o = opts.find((x) => x.id === p.optionId)!;
    if (spec.payback && !p.payback) footer.push(`${o.label}: no “${spec.payback.label}” within the horizon under this definition.`);
    if (p.payback && !p.payback.permanent) footer.push(`${o.label}: falls behind again after the first crossover, so that crossover is not permanent.`);
  }
  if (opts.some((o) => o.values.some((v) => v === null))) footer.push("Gaps are missing samples; lines are not drawn through them and crossings inside them are bracketed.");
  if (opts.some((o) => o.low && o.high)) footer.push("Shaded bands are the supplied low–high ranges.");
  if (opts.some((o) => o.jumpIndex.size)) footer.push(`Dotted segments are declared jumps (${opts.flatMap((o) => (o.jumps ?? []).map((j) => j.label ? `${o.label}: ${j.label}` : null)).filter(Boolean).join(", ") || "replacements, rebates"}); the path within that period is not interpolated.`);

  const { body } = drawChrome(scope, options, { title: spec.title, subtitle: spec.subtitle, unit: unitLine(unit, `${spec.semantics === "cumulative-cost" ? "cumulative cost" : "cumulative savings"} · ${periodLabel(axisSpec, 0, lang)}–${periodLabel(axisSpec, n - 1, lang)}`) }, footer);
  const legendH = drawLegend(scope, body, opts.map((o) => ({ id: o.id, label: o.id === analysis.baselineId && opts.length > 2 ? `${o.label} (baseline)` : o.label, color: o.color, marker: "line" as const })));
  let y = body.y + legendH + (style.spacing[1] ?? 16);
  const upfrontRow = view === "difference" ? null : y;
  if (upfrontRow !== null) y += lineBox(style, "caption") + 10;

  const capLH = lineBox(style, "caption"), labLH = lineBox(style, "label");
  // Gutters: value ticks on the left, end labels on the right.
  const allVals = opts.flatMap((o) => [...o.values, ...(o.low ?? []), ...(o.high ?? [])]).filter((v): v is number => v !== null);
  const lineAxis = valueAxis(Math.min(0, ...allVals), Math.max(0, ...allVals), { target: 5, tight: true });
  const endText = (o: (typeof opts)[number]) => { const last = [...o.values].reverse().find((v) => v !== null); return `${o.label} · ${last === undefined || last === null ? "n/a" : money(last)}`; };
  const diffVals = analysis.pairs.flatMap((p) => p.difference).filter((v): v is number => v !== null);
  const diffAxis = valueAxis(Math.min(0, ...diffVals), Math.max(0, ...diffVals), { target: 4, tight: true });
  const leftG = Math.max(...lineAxis.ticks.map((t) => labelWidth(scope, money(t), "caption")), ...(view === "lines" ? [] : diffAxis.ticks.map((t) => labelWidth(scope, formatMoney(t, unit, { language: lang, compact: true, signed: true }), "caption")))) + 16;
  const single = analysis.pairs.length === 1 ? opts.find((o) => o.id === analysis.pairs[0].optionId) ?? null : null;
  const sideTexts = single ? [`${single.label} ${spec.semantics === "cumulative-savings" ? ahead : behind} ↑`, `${single.label} ${spec.semantics === "cumulative-savings" ? behind : ahead} ↓`] : [];
  const sideW = view === "lines" ? 0 : Math.max(0, ...sideTexts.map((t) => labelWidth(scope, t, "caption"))) + 22;
  const endW = view === "difference" ? 0 : Math.max(...opts.map((o) => labelWidth(scope, endText(o), "label", style.weight.strong))) + 22;
  const rightG = Math.max(16, Math.min(body.width * 0.3, Math.max(endW, sideW)));
  const plotX = body.x + leftG, plotW = Math.max(60, body.width - leftG - rightG);
  const xs = (t: number) => plotX + (t / span) * plotW;

  // Annotation lanes for crossing labels.
  const annos: { x: number; text: string; pair: BreakEvenPair; c?: Crossing; payback?: boolean }[] = [];
  for (const p of analysis.pairs) {
    const o = opts.find((x) => x.id === p.optionId)!;
    const who = opts.length > 2 ? `${o.label}: ` : "";
    p.crossings.forEach((c, k) => {
      const isPayback = !!p.payback && Math.abs(p.payback.at - c.at) < 1e-9;
      const when = c.located ? at(Math.round(c.at * 10) / 10) : `${at(c.range[0])}–${at(c.range[1])}`;
      const name = isPayback ? `${spec.payback!.label}${p.payback!.permanent ? "" : " (not permanent)"}` : k === 0 ? "Crossover" : "Crosses back";
      const where = c.kind === "in-gap" ? " (in missing data)" : !c.located && c.kind === "through-tie" ? " (while ≈ equal)" : "";
      const what = c.direction === "gains-lead" ? `${o.label} ${ahead}` : `${o.label} ${behind}`;
      annos.push({ x: c.located ? xs(c.at) : xs((c.range[0] + c.range[1]) / 2), text: `${who}${name} · ${when}${where} — ${what} after`, pair: p, c, payback: isPayback });
    });
    // Near-equal stretches not already explained by a crossing through them.
    for (const [a, b] of p.ties) if (b > a && !p.crossings.some((c) => c.kind === "through-tie" && c.range[0] === a && c.range[1] === b)) annos.push({ x: xs((a + b) / 2), text: `${who}≈ equal · ${at(a)}–${at(b)}`, pair: p });
  }
  const annoW = annos.map((a) => Math.min(plotW, labelWidth(scope, a.text, "caption") + 8));
  const annoSpan = annos.map((a, k) => { const s = a.x - 2 + annoW[k] <= plotX + plotW + rightG - 8 ? a.x - 2 : Math.max(body.x, a.x + 2 - annoW[k]); return [s, s + annoW[k]] as [number, number]; });
  const lanes = assignGuideLanes(annos.map((a, k) => ({ x: a.x, span: annoSpan[k] })), 12);
  const laneCount = lanes.length ? Math.max(...lanes) + 1 : 0;
  const laneTop = y;
  y += laneCount * (capLH + 6) + (laneCount ? 8 : 0) + capLH + 6;

  const xLabelH = capLH + 10 + (axisSpec.title ? capLH + 8 : 0);
  const gap = (style.spacing[2] ?? 24) + capLH;
  const remaining = body.y + body.height - y - xLabelH;
  const panels: { kind: "lines" | "difference"; box: RectInfo }[] = [];
  if (view === "both") {
    const h = (remaining - gap) * 0.64;
    panels.push({ kind: "lines", box: { x: plotX, y, width: plotW, height: h } }, { kind: "difference", box: { x: plotX, y: y + h + gap, width: plotW, height: remaining - gap - h } });
  } else panels.push({ kind: view, box: { x: plotX, y, width: plotW, height: remaining } });
  const plotTop = panels[0].box.y, plotBottom = panels[panels.length - 1].box.y + panels[panels.length - 1].box.height;
  const anchors: Record<string, RectInfo> = {};

  // Time axis.
  const tickW = Math.max(...Array.from({ length: n }, (_, i) => labelWidth(scope, periodLabel(axisSpec, i, lang), "caption")));
  const every = [1, 2, 5, 10, 20, 25, 50].find((k) => (plotW / span) * k >= tickW * 1.3) ?? Math.ceil(n / 2);
  for (let i = 0; i < n; i += every) scope.push(scope.text({ text: periodLabel(axisSpec, i, lang), box: { x: xs(i) - 60, y: plotBottom + 8, width: 120, height: capLH }, typeRole: "caption", color: style.color.inkSubtle, align: "center", role: "axis-tick", tabular: true }));
  if (axisSpec.title) scope.push(scope.text({ text: axisSpec.title, box: { x: plotX, y: plotBottom + capLH + 16, width: plotW, height: capLH }, typeRole: "caption", color: style.color.inkMuted, align: "center", role: "axis-title" }));

  // Path through samples with gaps, steps and declared jumps, clipped to the reveal head. A declared jump is
  // its own dotted segment: the series' path inside that period is unknown, so it is neither smoothed nor stepped.
  type Run = { pts: [number, number][]; dotted: boolean };
  const pathOf = (vals: (number | null)[], jumps: Set<number>, yv: (v: number) => number): Run[] => {
    const runs: Run[] = [];
    let cur: [number, number][] = [];
    const flush = () => { if (cur.length > 1) runs.push({ pts: cur, dotted: false }); cur = []; };
    for (let i = 0; i < n; i++) {
      const v = vals[i];
      if (v === null) { flush(); continue; }
      const a = i ? vals[i - 1] : null;
      if (i > head + 1e-9) {
        if (a !== null && head > i - 1) {
          const f = head - (i - 1);
          if (jumps.has(i)) { flush(); runs.push({ pts: [[xs(i - 1), yv(a)], [xs(i - 1 + f), yv(a + (v - a) * f)]], dotted: true }); }
          else cur.push([xs(i - 1 + f), yv(spec.interpolation === "step" ? a : a + (v - a) * f)]);
        }
        break;
      }
      if (a !== null && jumps.has(i)) {
        flush();
        runs.push({ pts: [[xs(i - 1), yv(a)], [xs(i), yv(v)]], dotted: true });
        cur = [[xs(i), yv(v)]];
        continue;
      }
      if (cur.length && spec.interpolation === "step") cur.push([xs(i), cur[cur.length - 1][1]]);
      cur.push([xs(i), yv(v)]);
    }
    if (cur.length === 1 && !runs.length) runs.push({ pts: [cur[0], [cur[0][0] + 0.01, cur[0][1]]], dotted: false });
    else flush();
    return runs;
  };

  for (const panel of panels) {
    const box = panel.box;
    anchors[panel.kind] = box;
    if (panel.kind === "lines") {
      const yv = scaleLinear(lineAxis.min, lineAxis.max, box.y + box.height, box.y);
      for (const t of lineAxis.ticks) {
        scope.push(linePrimitive({ x: box.x, y: yv(t) }, { x: box.x + box.width, y: yv(t) }, { stroke: t === 0 ? style.color.rule : style.color.grid, strokeWidth: t === 0 ? style.stroke.rule : style.stroke.hairline, role: t === 0 ? "baseline" : "gridline" }, context));
        scope.push(scope.text({ text: money(t), box: { x: body.x, y: yv(t) - capLH / 2, width: leftG - 12, height: capLH }, typeRole: "caption", color: style.color.inkSubtle, align: "end", role: "axis-tick", tabular: true }));
      }
      scope.push(scope.text({ text: spec.semantics === "cumulative-cost" ? "Cumulative cost" : "Cumulative savings", box: { x: box.x + 6, y: box.y - capLH - 4, width: 400, height: capLH }, typeRole: "caption", color: style.color.inkMuted, role: "panel-label" }));
      // Bands, then lines.
      for (const o of opts) {
        if (!o.low || !o.high) continue;
        const top: [number, number][] = [], bottom: [number, number][] = [];
        for (let i = 0; i < n && i <= head + 1e-9; i++) {
          const lo = o.low[i], hi = o.high[i];
          if (lo === null || hi === null) continue;
          top.push([xs(i), yv(hi)]); bottom.unshift([xs(i), yv(lo)]);
        }
        if (top.length > 1) scope.push(polylinePrimitive([...top, ...bottom], { closed: true, fill: o.color, opacity: 0.14, role: "break-even-band", semanticId: `${spec.id}.${o.id}.band` }, context));
      }
      for (const o of opts) {
        for (const run of pathOf(o.values, o.jumpIndex, yv)) scope.push(polylinePrimitive(run.pts, { stroke: o.color, strokeWidth: style.stroke.strong + (o.id === analysis.baselineId ? 0 : 0.5), dash: run.dotted ? "dotted" : undefined, role: run.dotted ? "break-even-jump" : "break-even-line", semanticId: `${spec.id}.${o.id}` }, context));
      }
      {
        // Upfront values sit in the panel's header row (a protected region), color-keyed to start dots.
        let ux = body.x;
        const row = upfrontRow ?? box.y - capLH - 4;
        const starts = opts.filter((o) => o.values[0] !== null);
        if (starts.length) {
          const head0 = "Upfront:";
          const hw = labelWidth(scope, head0, "caption") + 8;
          scope.push(scope.text({ text: head0, box: { x: ux, y: row, width: hw, height: capLH }, typeRole: "caption", color: style.color.inkMuted, role: "break-even-upfront" }));
          ux += hw;
        }
        for (const o of starts) {
          const v = o.values[0] as number, text = `${o.label} ${money(v)}`, w = labelWidth(scope, text, "caption") + 8;
          scope.push(ellipsePrimitive({ x: xs(0) - 4.5, y: yv(v) - 4.5, width: 9, height: 9 }, { fill: o.color, role: "break-even-upfront-dot" }, context));
          if (ux + 12 + w > body.x + body.width) {
            scope.diagnostics.push({ code: "upfront-row-overflow", severity: "warning", message: `Upfront values from "${o.label}" on do not fit the header row; shorten option labels or widen the canvas.` });
            break;
          }
          scope.push(rectPrimitive({ x: ux, y: row + capLH / 2 - 4, width: 8, height: 8 }, { fill: o.color, radius: 4, role: "break-even-upfront-key" }, context));
          scope.push(scope.text({ text, box: { x: ux + 12, y: row, width: w, height: capLH }, typeRole: "caption", color: style.color.ink, role: "break-even-upfront", tabular: true }));
          ux += w + 22;
        }
      }
      // End labels in the right gutter.
      if (head >= span - 1e-9) {
        const lastY = opts.map((o) => { const idx = o.values.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0).pop(); return idx === undefined ? box.y : yv(o.values[idx] as number); });
        const ys = spreadLabels(lastY, labLH + 4, box.y, box.y + box.height);
        opts.forEach((o, k) => scope.push(scope.text({ text: endText(o), box: { x: box.x + box.width + 12, y: ys[k] - labLH / 2, width: rightG - 14, height: labLH }, typeRole: "label", weight: style.weight.strong, color: o.color, role: "break-even-end", tabular: true, semanticId: `${spec.id}.${o.id}` })));
      }
      // Crossing markers and brackets.
      for (const a of annos) {
        if (!a.c) continue;
        if (a.c.range[0] > head + 1e-9) continue;
        if (a.c.located && a.c.value !== null) {
          const r = a.payback ? 9 : 7;
          scope.push(ellipsePrimitive({ x: xs(a.c.at) - r, y: yv(a.c.value) - r, width: r * 2, height: r * 2 }, { fill: a.payback ? style.color.positive : style.color.canvas, stroke: a.payback ? style.color.positive : style.color.ink, strokeWidth: 2.5, role: a.payback ? "break-even-payback" : "break-even-crossing" }, context));
        } else if (a.c.kind === "in-gap") {
          scope.push(rectPrimitive({ x: xs(a.c.range[0]), y: box.y, width: Math.max(2, xs(a.c.range[1]) - xs(a.c.range[0])), height: box.height }, { fill: style.color.inkSubtle, opacity: 0.08, stroke: style.color.inkSubtle, strokeWidth: 1, dash: "dashed", role: "break-even-gap-bracket" }, context));
        }
      }
      for (const p of analysis.pairs) for (const [a, b] of p.ties) {
        if (a > head) continue;
        scope.push(rectPrimitive({ x: xs(a) - (b > a ? 0 : 3), y: box.y, width: Math.max(6, xs(b) - xs(a)), height: box.height }, { fill: style.color.inkSubtle, opacity: 0.07, role: "break-even-tie" }, context));
      }
    } else {
      // Difference panel: option − baseline, shaded by who is ahead.
      const ax = diffAxis;
      const yv = scaleLinear(ax.min, ax.max, box.y + box.height, box.y);
      for (const t of ax.ticks) {
        scope.push(linePrimitive({ x: box.x, y: yv(t) }, { x: box.x + box.width, y: yv(t) }, { stroke: t === 0 ? style.color.rule : style.color.grid, strokeWidth: t === 0 ? style.stroke.rule : style.stroke.hairline, role: t === 0 ? "baseline" : "gridline" }, context));
        scope.push(scope.text({ text: formatMoney(t, unit, { language: lang, compact: true, signed: true }), box: { x: body.x, y: yv(t) - capLH / 2, width: leftG - 12, height: capLH }, typeRole: "caption", color: style.color.inkSubtle, align: "end", role: "axis-tick", tabular: true }));
      }
      scope.push(scope.text({ text: `Difference vs ${base?.label ?? "baseline"}${single ? ` (${single.label} − ${base?.label})` : ""}`, box: { x: box.x + 6, y: box.y - capLH - 4, width: box.width, height: capLH }, typeRole: "caption", color: style.color.inkMuted, role: "panel-label" }));
      const aheadUp = spec.semantics === "cumulative-savings";
      if (single) {
        // Which side means what, in the right gutter (outside the data) next to each half of the plot.
        const [up, down] = sideTexts, gx = box.x + box.width + 12, gw = rightG - 14;
        if (ax.max > 0) scope.push(scope.text({ text: up, box: { x: gx, y: box.y, width: gw, height: capLH * 2 }, typeRole: "caption", color: aheadUp ? style.color.positive : style.color.negative, role: "difference-side", maxLines: 2 }));
        if (ax.min < 0) scope.push(scope.text({ text: down, box: { x: gx, y: box.y + box.height - capLH * 2, width: gw, height: capLH * 2 }, typeRole: "caption", color: aheadUp ? style.color.negative : style.color.positive, valign: "bottom", role: "difference-side", maxLines: 2 }));
      }
      for (const p of analysis.pairs) {
        const o = opts.find((x) => x.id === p.optionId)!;
        const jumps = new Set([...o.jumpIndex, ...(base?.jumpIndex ?? [])]);
        for (const { pts: run, dotted } of pathOf(p.difference, jumps, yv)) {
          // Split the area at zero so each side gets its own fill.
          const z = yv(0);
          let seg: [number, number][] = [];
          let sign = 0;
          const flush = () => { if (seg.length > 1) scope.push(polylinePrimitive([[seg[0][0], z], ...seg, [seg[seg.length - 1][0], z]], { closed: true, fill: (sign > 0) === aheadUp ? style.color.positive : style.color.negative, opacity: analysis.pairs.length > 1 ? 0.08 : 0.16, role: "difference-area" }, context)); };
          for (let k = 0; k < run.length; k++) {
            const [px, py] = run[k], s = Math.sign(z - py);
            if (k && s !== sign && sign !== 0 && s !== 0) {
              const [qx, qy] = run[k - 1], f = (z - qy) / (py - qy), cxp = qx + (px - qx) * f;
              seg.push([cxp, z]); flush(); seg = [[cxp, z]];
            }
            if (s !== 0) sign = s;
            seg.push([px, py]);
          }
          flush();
          scope.push(polylinePrimitive(run, { stroke: o.color, strokeWidth: style.stroke.strong, dash: dotted ? "dotted" : undefined, role: "difference-line", semanticId: `${spec.id}.${o.id}.difference` }, context));
        }
        for (const c of p.crossings) if (c.located && c.range[0] <= head) scope.push(ellipsePrimitive({ x: xs(c.at) - 5, y: yv(0) - 5, width: 10, height: 10 }, { fill: style.color.canvas, stroke: style.color.ink, strokeWidth: 2, role: "difference-crossing" }, context));
      }
    }
  }

  // Annotation labels and guides (to the lines panel marker, or through both panels for brackets).
  annos.forEach((a, k) => {
    const shown = !a.c ? a.x <= xs(head) + 1e-6 : a.c.range[0] <= head + 1e-9;
    if (!shown) return;
    const ly = laneTop + (laneCount - 1 - lanes[k]) * (capLH + 6);
    // The guide skips the panel-label row so it never runs through header text.
    const guide = { stroke: a.payback ? style.color.positive : style.color.connectorMuted, strokeWidth: a.payback ? style.stroke.rule : style.stroke.hairline, dash: a.payback ? "solid" as const : "dashed" as const, role: "crossing-guide", opacity: 0.8 };
    if (plotTop - capLH - 8 > ly + capLH + 2) scope.push(linePrimitive({ x: a.x, y: ly + capLH + 2 }, { x: a.x, y: plotTop - capLH - 8 }, guide, context));
    for (const pn of panels) scope.push(linePrimitive({ x: a.x, y: pn.box.y }, { x: a.x, y: pn.box.y + pn.box.height }, guide, context));
    scope.push(scope.text({ text: a.text, box: { x: annoSpan[k][0], y: ly, width: annoW[k], height: capLH }, typeRole: "caption", weight: a.payback ? style.weight.strong : undefined, color: a.payback ? style.color.positive : style.color.ink, align: annoSpan[k][0] < a.x - 4 ? "end" : "start", role: a.payback ? "payback-label" : "crossing-label" }));
  });
  if (options.frame !== undefined && head > 0 && head < span) {
    scope.push(linePrimitive({ x: xs(head), y: plotTop }, { x: xs(head), y: plotBottom }, { stroke: style.color.accent, strokeWidth: style.stroke.rule, opacity: 0.6, role: "playhead" }, context));
  }

  const sentences = analysis.pairs.map((p) => {
    const o = opts.find((x) => x.id === p.optionId)!, b = base?.label ?? "the baseline";
    if (p.status === "insufficient-data") return `${o.label} vs ${b}: not enough comparable data.`;
    if (p.status === "no-crossover") return `${o.label} vs ${b}: no crossover within the horizon; ${o.label} ${p.finalState === "ahead" ? ahead : p.finalState === "behind" ? behind : "is about equal"} throughout.`;
    const list = p.crossings.map((c) => `${c.direction === "gains-lead" ? "moves ahead" : "falls behind"} ${c.located ? `at ${at(Math.round(c.at * 10) / 10)}` : `between ${at(c.range[0])} and ${at(c.range[1])}`}`).join(", then ");
    return `${o.label} vs ${b}: ${list}.${p.payback ? ` ${spec.payback!.label}: ${at(Math.round(p.payback.at * 10) / 10)}${p.payback.permanent ? "" : " (not permanent)"}.` : ""}`;
  });
  const summary = `${spec.title}. ${unitLine(unit) || "undeclared units"}, ${spec.semantics.replace("-", " ")}. ${sentences.join(" ")}`;
  return { ...finish(scope, options, { summary, title: spec.title, anchors, revealEnd }), analysis };
}
