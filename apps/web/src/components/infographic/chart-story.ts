/** ChartStory: story beats over the existing chart renderer. No second chart engine: every mark comes
 * from `renderChart`. ChartStory fixes one value-axis domain across all scenarios (axes never rescale),
 * forbids truncated bars/areas, addresses marks by their data `semanticId` (`series:index`), morphs
 * scenarios by interpolating matching primitives (endpoints are the real layouts), never shows invented
 * intermediate numbers, and checks the concluding claim against the data. Pure; frame-addressable.
 */
import { chartDomain, chartSummary, renderChart } from "./chart";
import { formatNumber } from "./measure";
import { createIdFactory } from "./primitives";
import type { ChartSpec, InfographicDiagnostic, InfographicPrimitive, RectInfo, ResolvedStyle } from "./types";
import { evaluateEasing } from "../motion/easing";
import type { RationalFps } from "../motion/types";

export interface ChartScenario { id: string; label: string; spec: ChartSpec; note?: string }
export type ChartClaimSupport =
  | { kind: "value"; seriesId: string; index: number; value: number; tolerance?: number }
  | { kind: "difference"; seriesId: string; from: number; to: number; value: number; tolerance?: number }
  /** Percent change relative to `from` (the base must be non-zero). */
  | { kind: "percent-change"; seriesId: string; from: number; to: number; value: number; tolerance?: number }
  | { kind: "max"; seriesId: string; index: number }
  | { kind: "min"; seriesId: string; index: number };
export interface ChartClaim { text: string; scenarioId?: string; support: ChartClaimSupport }
export type ChartStoryBeat =
  | { id: string; kind: "establish"; durationFrames: number }
  | { id: string; kind: "reveal"; seriesIds: readonly string[]; durationFrames: number }
  | { id: string; kind: "focus"; seriesId: string; index: number; durationFrames: number; note?: string }
  | { id: string; kind: "compare"; seriesId: string; from: number; to: number; measure: "difference" | "percent-change"; durationFrames: number }
  | { id: string; kind: "scenario"; scenarioId: string; durationFrames: number }
  | { id: string; kind: "conclude"; claim: ChartClaim; durationFrames: number };
export interface ChartStorySpec {
  id: string;
  fps: RationalFps;
  title: string;
  scenarios: readonly ChartScenario[];
  initialScenarioId: string;
  beats: readonly ChartStoryBeat[];
  /** Frames for scenario morphs and focus moves. Default 24. */
  moveFrames?: number;
  language?: string;
}
export interface ChartStoryDiagnostic extends InfographicDiagnostic { beatId?: string }
export interface ChartStoryLayout {
  /** Per scenario, the existing renderer's output into the same frame with the same constant domain. */
  scenarios: Record<string, { primitives: InfographicPrimitive[]; anchors: Record<string, RectInfo>; summary: string; spec: ChartSpec }>;
  domain: { min: number; max: number; zero: boolean; kind: "linear" | "log" };
  diagnostics: ChartStoryDiagnostic[];
}

const seriesOf = (semanticId: string | undefined) => semanticId?.split(":")[0];
const valueOf = (spec: ChartSpec, seriesId: string, index: number) => spec.series.find(s => s.id === seriesId)?.values[index] ?? null;
const scenarioById = (spec: ChartStorySpec, id: string) => spec.scenarios.find(s => s.id === id);

/** One value-axis domain for every scenario, so a scenario change never rescales the axis. */
export function chartStoryDomain(spec: ChartStorySpec) {
  const first = spec.scenarios[0].spec;
  const merged: ChartSpec = { ...first, series: spec.scenarios.flatMap(s => s.spec.series.map(series => ({ ...series, id: `${s.id}/${series.id}` }))) };
  return chartDomain(merged);
}

/** Render every scenario with the existing chart renderer into `frame`, with a shared constant domain. */
export function layoutChartStory(spec: ChartStorySpec, frame: RectInfo, style: ResolvedStyle): ChartStoryLayout {
  const diagnostics: ChartStoryDiagnostic[] = [];
  const domain = chartStoryDomain(spec);
  const scenarios: ChartStoryLayout["scenarios"] = {};
  for (const scenario of spec.scenarios) {
    const fixed: ChartSpec = { ...scenario.spec, scale: { kind: domain.kind, zero: domain.zero, domain: [domain.min, domain.max] } };
    const result = renderChart({ style, language: spec.language ?? "en", evidence: new Map(), evidenceLabel: () => undefined,
      id: createIdFactory(spec.id), report: d => diagnostics.push({ ...d, message: `${scenario.label}: ${d.message}` }) },
    frame, fixed, { id: spec.id, showLegend: fixed.series.length > 1 });
    scenarios[scenario.id] = { primitives: result.primitives, anchors: result.anchors ?? {}, summary: chartSummary(fixed, spec.language), spec: fixed };
  }
  return { scenarios, domain, diagnostics };
}

const near = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance;
/** Recompute a claim's support from the data. */
export function checkChartClaim(spec: ChartStorySpec, claim: ChartClaim): { ok: true; computed: number } | { ok: false; message: string } {
  const scenario = scenarioById(spec, claim.scenarioId ?? spec.initialScenarioId);
  if (!scenario) return { ok: false, message: `Claim refers to unknown scenario "${claim.scenarioId}".` };
  const s = claim.support, data = scenario.spec;
  const series = data.series.find(x => x.id === s.seriesId);
  if (!series) return { ok: false, message: `Claim refers to unknown series "${s.seriesId}".` };
  if (s.kind === "max" || s.kind === "min") {
    const present = series.values.filter((v): v is number => v !== null);
    const target = s.kind === "max" ? Math.max(...present) : Math.min(...present), value = series.values[s.index];
    return value === target ? { ok: true, computed: target }
      : { ok: false, message: `"${series.label}" at ${data.categories[s.index] ?? s.index} is ${value ?? "missing"}, not the ${s.kind} (${target}).` };
  }
  if (s.kind === "value") {
    const v = series.values[s.index];
    if (v === null || v === undefined) return { ok: false, message: `"${series.label}" has no value at ${data.categories[s.index] ?? s.index}.` };
    return near(v, s.value, s.tolerance ?? 0) ? { ok: true, computed: v } : { ok: false, message: `Claim says ${s.value}; the data says ${v}.` };
  }
  const a = series.values[s.from], b = series.values[s.to];
  if (a === null || a === undefined || b === null || b === undefined) return { ok: false, message: `"${series.label}" is missing a compared value.` };
  if (s.kind === "difference") {
    const d = b - a;
    return near(d, s.value, s.tolerance ?? 0) ? { ok: true, computed: d } : { ok: false, message: `Claim says a difference of ${s.value}; the data gives ${d}.` };
  }
  if (a === 0) return { ok: false, message: `A percent change from ${data.categories[s.from]} has a zero base; state the absolute change instead.` };
  const pct = ((b - a) / Math.abs(a)) * 100;
  return near(pct, s.value, s.tolerance ?? 0.5) ? { ok: true, computed: pct }
    : { ok: false, message: `Claim says ${s.value}%; the data gives ${pct.toFixed(1)}% (base ${a} at ${data.categories[s.from]}).` };
}

export function validateChartStory(spec: ChartStorySpec, layout?: ChartStoryLayout, options: { minTextPx?: number } = {}): ChartStoryDiagnostic[] {
  const out: ChartStoryDiagnostic[] = [...(layout?.diagnostics ?? [])];
  const report = (severity: "error" | "warning", code: string, message: string, beatId?: string) => out.push({ code, severity, message, beatId });
  const base = scenarioById(spec, spec.initialScenarioId);
  if (!base) { report("error", "chart-story-scenario-unknown", `Initial scenario "${spec.initialScenarioId}" does not exist.`); return out; }
  const b = base.spec;
  for (const s of spec.scenarios) {
    const x = s.spec, ids = (spec: ChartSpec) => spec.series.map(series => series.id).join("|");
    if (x.recipe !== b.recipe || x.categories.join("|") !== b.categories.join("|") || ids(x) !== ids(b))
      report("error", "chart-story-scenario-mismatch", `Scenario "${s.id}" must keep the recipe, categories and series IDs of "${base.id}" so marks keep their identity.`);
    if ((x.unit ?? "") !== (b.unit ?? "")) report("error", "chart-story-unit-mismatch", `Scenario "${s.id}" uses unit "${x.unit ?? ""}", not "${b.unit ?? ""}".`);
    if (x.scale?.kind === "log" && (x.recipe === "bar" || x.recipe === "area")) report("error", "chart-story-log-bars", `Scenario "${s.id}" draws bar lengths on a log axis.`);
  }
  const domain = layout?.domain ?? chartStoryDomain(spec);
  if ((b.recipe === "bar" || b.recipe === "area") && !(domain.zero && domain.min <= 0 && domain.max >= 0))
    report("error", "chart-story-truncated-bars", "Bar and area lengths must start at zero; a truncated axis exaggerates differences.");
  if (b.recipe !== "bar" && b.recipe !== "area" && domain.kind === "linear" && !domain.zero)
    report("warning", "chart-story-non-zero-axis", "The value axis does not start at zero; the chart's caption discloses it, but say it in narration too.");
  const series = new Set(b.series.map(s => s.id));
  let current = base;
  for (const beat of spec.beats) {
    if (!Number.isSafeInteger(beat.durationFrames) || beat.durationFrames < 1) report("error", "chart-story-beat-invalid", `Beat "${beat.id}" needs a positive integer duration.`, beat.id);
    if (beat.kind === "reveal") for (const id of beat.seriesIds) if (!series.has(id)) report("error", "chart-story-series-unknown", `Beat "${beat.id}" reveals unknown series "${id}".`, beat.id);
    if (beat.kind === "focus" || beat.kind === "compare") {
      if (!series.has(beat.seriesId)) report("error", "chart-story-series-unknown", `Beat "${beat.id}" uses unknown series "${beat.seriesId}".`, beat.id);
      const indexes = beat.kind === "focus" ? [beat.index] : [beat.from, beat.to];
      for (const i of indexes) {
        if (!Number.isSafeInteger(i) || i < 0 || i >= b.categories.length) report("error", "chart-story-index-invalid", `Beat "${beat.id}" points at category ${i}, outside the chart.`, beat.id);
        else if (valueOf(current.spec, beat.seriesId, i) === null) report("error", "chart-story-focus-missing", `Beat "${beat.id}" highlights a missing value; missing data cannot be presented as a point.`, beat.id);
      }
      if (beat.kind === "compare" && beat.measure === "percent-change" && valueOf(current.spec, beat.seriesId, beat.from) === 0)
        report("error", "chart-story-zero-base", `Beat "${beat.id}" computes a percent change from zero.`, beat.id);
      if (beat.durationFrames <= (spec.moveFrames ?? 24)) report("warning", "chart-story-beat-short", `Beat "${beat.id}" ends before its highlight settles.`, beat.id);
    }
    if (beat.kind === "scenario") {
      const next = scenarioById(spec, beat.scenarioId);
      if (!next) report("error", "chart-story-scenario-unknown", `Beat "${beat.id}" switches to unknown scenario "${beat.scenarioId}".`, beat.id);
      else current = next;
    }
    if (beat.kind === "conclude") {
      const check = checkChartClaim(spec, beat.claim);
      if (!check.ok) report("error", "chart-story-claim-unsupported", `Conclusion "${beat.claim.text}": ${check.message}`, beat.id);
      if ((beat.claim.scenarioId ?? spec.initialScenarioId) !== current.id)
        report("warning", "chart-story-claim-off-screen", `Conclusion "${beat.id}" cites scenario "${beat.claim.scenarioId ?? spec.initialScenarioId}" while "${current.id}" is on screen; switch back first.`, beat.id);
    }
  }
  if (!spec.beats.some(beat => beat.kind === "conclude")) report("warning", "chart-story-no-conclusion", "The story never states its supported claim.");
  if (layout) {
    const minText = options.minTextPx ?? 22;
    const small = Object.values(layout.scenarios).flatMap(s => s.primitives).filter(p => p.kind === "text" && p.fontSize < minText);
    if (small.length) report("warning", "chart-story-text-small", `${small.length} chart labels are under ${minText}px at this output size; enlarge the type or use a larger frame.`);
  }
  return out;
}

export interface ChartStoryFrame {
  beatIndex: number;
  beat: ChartStoryBeat;
  local: number;
  /** Scenario shown, and the one being morphed from (with progress) during a scenario beat. */
  scenarioId: string;
  fromScenarioId?: string;
  morph: number;
  /** 0..1 visibility per series. Series not yet revealed are hidden. */
  seriesOpacity: Record<string, number>;
  focus?: { seriesId: string; index: number; amount: number };
  compare?: { seriesId: string; from: number; to: number; measure: "difference" | "percent-change"; amount: number };
  claim?: { claim: ChartClaim; amount: number };
}
/** Story state at a frame. Pure. */
export function evaluateChartStory(spec: ChartStorySpec, frame: number): ChartStoryFrame {
  const move = spec.moveFrames ?? 24, base = scenarioById(spec, spec.initialScenarioId)!;
  const total = spec.beats.reduce((n, beat) => n + beat.durationFrames, 0), f = Math.max(0, Math.min(total - 1, frame));
  const opacity: Record<string, number> = Object.fromEntries(base.spec.series.map(s => [s.id, 0]));
  let scenarioId = spec.initialScenarioId, cursor = 0;
  for (const [index, beat] of spec.beats.entries()) {
    const end = cursor + beat.durationFrames, active = f < end, local = f - cursor;
    const ramp = active ? evaluateEasing("ease-in-out-cubic", Math.min(1, (local + 1) / move)) : 1;
    if (beat.kind === "reveal") beat.seriesIds.forEach((id, i) => {
      // Staggered within the beat: each series fades in over `move` frames.
      const start = Math.round((i * beat.durationFrames) / Math.max(1, beat.seriesIds.length + 1));
      opacity[id] = active ? Math.max(opacity[id] ?? 0, evaluateEasing("ease-out-cubic", Math.max(0, Math.min(1, (local - start + 1) / move)))) : 1;
    });
    let from: string | undefined, morph = 1;
    if (beat.kind === "scenario") { from = scenarioId; scenarioId = beat.scenarioId; morph = ramp; }
    if (active) {
      const state: ChartStoryFrame = { beatIndex: index, beat, local, scenarioId, fromScenarioId: from && morph < 1 ? from : undefined, morph, seriesOpacity: opacity };
      if (beat.kind === "focus") state.focus = { seriesId: beat.seriesId, index: beat.index, amount: ramp };
      if (beat.kind === "compare") state.compare = { seriesId: beat.seriesId, from: beat.from, to: beat.to, measure: beat.measure, amount: ramp };
      if (beat.kind === "conclude") state.claim = { claim: beat.claim, amount: ramp };
      return state;
    }
    cursor = end;
  }
  throw new Error("Chart story has no beats.");
}

/** Matching key across scenario layouts: role + semantic id + occurrence. */
function keyed(primitives: readonly InfographicPrimitive[]) {
  const counts = new Map<string, number>(), out = new Map<string, InfographicPrimitive>();
  for (const p of primitives) {
    const base = `${p.role ?? p.kind}|${p.semanticId ?? ""}`, n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n); out.set(`${base}|${n}`, p);
  }
  return out;
}
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
function interpolate(a: InfographicPrimitive, b: InfographicPrimitive, t: number): InfographicPrimitive | undefined {
  if (a.kind !== b.kind) return undefined;
  if ((a.kind === "rect" || a.kind === "ellipse") && (b.kind === "rect" || b.kind === "ellipse"))
    return { ...b, x: mix(a.x, b.x, t), y: mix(a.y, b.y, t), width: mix(a.width, b.width, t), height: mix(a.height, b.height, t) } as InfographicPrimitive;
  if (a.kind === "line" && b.kind === "line") return { ...b, x1: mix(a.x1, b.x1, t), y1: mix(a.y1, b.y1, t), x2: mix(a.x2, b.x2, t), y2: mix(a.y2, b.y2, t) };
  if (a.kind === "polyline" && b.kind === "polyline" && a.points.length === b.points.length)
    return { ...b, points: b.points.map(([x, y], i) => [mix(a.points[i][0], x, t), mix(a.points[i][1], y, t)] as [number, number]) };
  if (a.kind === "path" && b.kind === "path") {
    // Paths with the same command structure (e.g. bars with rounded ends) morph number by number.
    const from = a.d.split(PATH_NUMBER), to = b.d.split(PATH_NUMBER);
    if (from.length !== to.length || to.some((part, i) => i % 2 === 0 && part !== from[i])) return undefined;
    return { ...b, d: to.map((part, i) => i % 2 ? String(Math.round(mix(Number(from[i]), Number(part), t) * 100) / 100) : part).join("") };
  }
  return undefined;
}
const PATH_NUMBER = /(-?\d*\.?\d+(?:e[-+]?\d+)?)/i;
/** Bounds of an absolute M/L/Q/C/Z path (control points included, so the box is conservative). */
function pathBounds(d: string): RectInfo | undefined {
  if (!/^[MLQCZ\s\d.,eE+-]*$/.test(d)) return undefined;
  const n = (d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
  if (n.length < 2 || n.length % 2) return undefined;
  const xs = n.filter((_, i) => i % 2 === 0), ys = n.filter((_, i) => i % 2 === 1);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
/** Primitives for one frame: the scenario layout (morphed geometry, crossfaded labels) with story opacity applied. */
export function chartStoryPrimitives(layout: ChartStoryLayout, state: ChartStoryFrame): InfographicPrimitive[] {
  const to = layout.scenarios[state.scenarioId].primitives;
  let prims: InfographicPrimitive[] = to;
  if (state.fromScenarioId && state.morph < 1) {
    const fromMap = keyed(layout.scenarios[state.fromScenarioId].primitives), toMap = keyed(to), t = state.morph;
    prims = [];
    for (const [key, b] of toMap) {
      const a = fromMap.get(key), moved = a && b.kind !== "text" ? interpolate(a, b, t) : undefined;
      if (moved) prims.push(moved);
      else if (a && b.kind === "text" && a.kind === "text" && a.lines.join("\n") === b.lines.join("\n")) prims.push(b);
      else {
        // Labels whose text changes crossfade: no invented in-between numbers are ever shown.
        if (a) prims.push({ ...a, id: `${a.id}~from`, opacity: (a.opacity ?? 1) * (1 - t) });
        prims.push({ ...b, opacity: (b.opacity ?? 1) * t });
      }
    }
    for (const [key, a] of fromMap) if (!toMap.has(key)) prims.push({ ...a, id: `${a.id}~from`, opacity: (a.opacity ?? 1) * (1 - t) });
  }
  const focusId = state.focus ? `${state.focus.seriesId}:${state.focus.index}` : undefined;
  const compareIds = state.compare ? new Set([`${state.compare.seriesId}:${state.compare.from}`, `${state.compare.seriesId}:${state.compare.to}`]) : undefined;
  const emphasis = state.focus?.amount ?? state.compare?.amount ?? 0;
  return prims.map(p => {
    const series = seriesOf(p.semanticId);
    if (!series || !(series in state.seriesOpacity)) return p;
    let opacity = (p.opacity ?? 1) * state.seriesOpacity[series];
    const isMark = p.role === "chart-mark" || p.role === "chart-mark-line" || p.role === "chart-mark-area" || p.role === "chart-value-label";
    const point = p.role === "chart-value-label" ? (p.semanticId ?? "").replace(/:value$/, "") : p.semanticId ?? "";
    const highlighted = point === focusId || !!compareIds?.has(point);
    const ownSeries = series === (state.focus?.seriesId ?? state.compare?.seriesId);
    // The emphasized point's own label gives way to the ring and pill, which state the same value.
    if (highlighted && p.role === "chart-value-label") opacity *= 1 - emphasis;
    else if (emphasis > 0 && isMark && !highlighted) opacity *= 1 - emphasis * (ownSeries && (p.role === "chart-mark-line" || p.role === "chart-mark-area") ? 0.35 : 0.7);
    return opacity === (p.opacity ?? 1) ? p : { ...p, opacity };
  });
}

/** Exact value text for a data point: what the data says, formatted, with its unit. */
export function chartValueLabel(spec: ChartSpec, seriesId: string, index: number, language?: string): string {
  const v = valueOf(spec, seriesId, index);
  return v === null ? "missing" : `${formatNumber(v, { language })}${spec.unit ? ` ${spec.unit}` : ""}`;
}
/** Exact comparison text (difference with sign, or percent change from the first point). */
export function chartCompareLabel(spec: ChartSpec, seriesId: string, from: number, to: number, measure: "difference" | "percent-change", language?: string): string {
  const a = valueOf(spec, seriesId, from), b = valueOf(spec, seriesId, to);
  if (a === null || b === null) return "missing";
  if (measure === "difference") { const d = b - a; return `${d >= 0 ? "+" : "−"}${formatNumber(Math.abs(d), { language })}${spec.unit ? ` ${spec.unit}` : ""}`; }
  const pct = ((b - a) / Math.abs(a)) * 100;
  return `${pct >= 0 ? "+" : "−"}${formatNumber(Math.abs(pct), { language, precision: 1 })}% vs ${spec.categories[from]}`;
}
/** Screen box of a data mark (bbox of its primitives) in the scenario layout. */
export function chartMarkBox(layout: ChartStoryLayout, scenarioId: string, seriesId: string, index: number): RectInfo | undefined {
  const id = `${seriesId}:${index}`;
  const boxes = layout.scenarios[scenarioId].primitives.filter(p => p.semanticId === id && p.role !== "chart-value-label").flatMap(p =>
    p.kind === "rect" || p.kind === "ellipse" || p.kind === "text" ? [{ x: p.x, y: p.y, width: p.width, height: p.height }]
      : p.kind === "path" ? [pathBounds(p.d)].filter((r): r is RectInfo => !!r) : []);
  if (!boxes.length) return undefined;
  const x = Math.min(...boxes.map(r => r.x)), y = Math.min(...boxes.map(r => r.y));
  return { x, y, width: Math.max(...boxes.map(r => r.x + r.width)) - x, height: Math.max(...boxes.map(r => r.y + r.height)) - y };
}
