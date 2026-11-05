/** E06 `AnimatedMetric` — numbers that change on screen without lying.
 *
 * Authored keyframes (`frame`, `value`) are the only facts. Between two known
 * keyframes a value may count (`interpolate`, eased with MG1 easing) or jump
 * (`step`). Discrete facts (counts of events, a quoted price) should use
 * `step`. Rules:
 *
 * - **Exact rest values.** At and after a keyframe the display is that value
 *   formatted at the declared precision, never a rounding artifact of the
 *   tween.
 * - **Transitions are labeled.** Every evaluated frame says whether it is
 *   settled or `transitioning`, so a view can dim or mark in-between values.
 * - **Unknown is not zero.** A `null` keyframe displays as unknown; the value
 *   never tweens to or from it.
 * - **Stable width.** `reserve` is the widest string the metric can show, so a
 *   view can hold its layout steady while digits change.
 *
 * Pure per absolute frame; no clocks.
 */
import { evaluateEasing } from "../motion/easing";
import type { EasingSpec } from "../motion/types";

export type MetricFormatSpec =
  | { kind: "currency"; currency: string; precision?: number; compact?: boolean }
  /** Values are fractions (0.124 → 12.4%). */
  | { kind: "percent"; precision?: number }
  | { kind: "number"; unit?: string; precision?: number; compact?: boolean };

export interface MetricKeyframe {
  frame: number;
  /** `null` = unknown at this point (shown as unknown, never tweened). */
  value: number | null;
  /** Short caption for this value, e.g. "after the upgrade". */
  label?: string;
}

export interface AnimatedMetricSpec {
  id: string;
  label: string;
  format: MetricFormatSpec;
  keyframes: MetricKeyframe[];
  /** `interpolate` counts between known values; `step` jumps at each keyframe. @default "interpolate" */
  mode?: "interpolate" | "step";
  /** Frames a count takes, ending at each keyframe's frame. @default the whole gap */
  countFrames?: number;
  /** @default "ease-out-cubic" */
  easing?: EasingSpec;
  /** Show the change since the previous known keyframe. */
  delta?: "absolute" | "percent" | "both" | false;
  /** Quantize in-between displays to this step (in value units) to keep ticks calm. */
  tickStep?: number;
  /** BCP-47 tag. @default "en" */
  language?: string;
  /** Text for unknown values. @default "Unknown" */
  unknownText?: string;
  /** Source note shown with the metric. */
  source?: string;
}

export interface AnimatedMetricPlan {
  spec: AnimatedMetricSpec;
  /** Resolved display format (one precision for every frame). */
  format: MetricFormatSpec;
  keyframes: MetricKeyframe[];
  /** Widest display across rest values, tweens and deltas (for layout reservation). */
  reserve: string;
  reserveDelta: string;
  diagnostics: { code: string; severity: "error" | "warning"; message: string }[];
}

export interface AnimatedMetricFrame {
  value: number | null;
  display: string;
  /** True between two keyframes while the number is counting. */
  transitioning: boolean;
  /** At a keyframe's exact value (or holding it). */
  settled: boolean;
  status: "known" | "unknown" | "pending";
  /** Index of the keyframe reached (−1 before the first). */
  keyIndex: number;
  label?: string;
  delta: { value: number; display: string; direction: "up" | "down" | "flat" } | null;
  /** The value this transition is heading to, formatted (for accessible labels). */
  target: string;
}

/** One precision per metric: whole units for currency unless an authored value has cents. */
function withPrecision(spec: AnimatedMetricSpec): MetricFormatSpec {
  const f = spec.format;
  if (f.kind !== "currency" || f.precision !== undefined || f.compact) return f;
  const fractional = spec.keyframes.some((k) => k.value !== null && Math.abs(k.value - Math.round(k.value)) > 1e-9);
  let minor = 2;
  try { minor = new Intl.NumberFormat("en", { style: "currency", currency: f.currency }).resolvedOptions().maximumFractionDigits ?? 2; } catch { minor = 2; }
  return { ...f, precision: fractional ? minor : 0 };
}

function formatter(format: MetricFormatSpec, language: string) {
  const precision = format.precision;
  if (format.kind === "currency") {
    let nf: Intl.NumberFormat;
    try {
      nf = new Intl.NumberFormat(language, { style: "currency", currency: format.currency, notation: format.compact ? "compact" : "standard", minimumFractionDigits: precision, maximumFractionDigits: precision ?? (format.compact ? 1 : undefined) });
    } catch {
      nf = new Intl.NumberFormat(language, { maximumFractionDigits: precision ?? 2 });
    }
    return (v: number) => nf.format(v);
  }
  if (format.kind === "percent") {
    const nf = new Intl.NumberFormat(language, { style: "percent", minimumFractionDigits: precision ?? 0, maximumFractionDigits: precision ?? 0 });
    return (v: number) => nf.format(v);
  }
  const nf = new Intl.NumberFormat(language, { notation: format.compact ? "compact" : "standard", minimumFractionDigits: precision, maximumFractionDigits: precision ?? (format.compact ? 1 : 0) });
  return (v: number) => `${nf.format(v)}${format.unit ? ` ${format.unit}` : ""}`;
}

/** Display precision as a value step (e.g. 0.01 for cents, 0.001 for 0.1% when percent). */
function precisionStep(format: MetricFormatSpec) {
  if (format.kind === "percent") return 10 ** -((format.precision ?? 0) + 2);
  if (format.kind === "currency") return 10 ** -(format.precision ?? 0);
  return 10 ** -(format.precision ?? 0);
}

/** Validate keyframes and precompute the layout reserve. Throws on empty or out-of-order keyframes. */
export function compileAnimatedMetric(spec: AnimatedMetricSpec): AnimatedMetricPlan {
  const diagnostics: AnimatedMetricPlan["diagnostics"] = [];
  if (!spec.keyframes.length) throw new Error(`AnimatedMetric "${spec.id}" needs at least one keyframe.`);
  for (let i = 1; i < spec.keyframes.length; i++) {
    if (!(spec.keyframes[i].frame > spec.keyframes[i - 1].frame)) throw new Error(`AnimatedMetric "${spec.id}": keyframe frames must increase (index ${i}).`);
  }
  for (const k of spec.keyframes) if (k.value !== null && !Number.isFinite(k.value)) throw new Error(`AnimatedMetric "${spec.id}": keyframe at ${k.frame} has a non-finite value; use null for unknown.`);
  if (spec.format.kind === "currency") {
    try { new Intl.NumberFormat("en", { style: "currency", currency: spec.format.currency }); } catch { diagnostics.push({ code: "currency-invalid", severity: "error", message: `"${spec.format.currency}" is not an ISO currency code; values are shown as plain numbers.` }); }
  }
  if (spec.keyframes.some((k) => k.value === null)) diagnostics.push({ code: "value-unknown", severity: "warning", message: "Some keyframes are unknown; they display as unknown and are never counted to or from." });
  const format = withPrecision(spec);
  const fmt = formatter(format, spec.language ?? "en");
  const known = spec.keyframes.map((k) => k.value).filter((v): v is number => v !== null);
  const candidates = [...known, ...(known.length ? [Math.max(...known), Math.min(...known)] : [])];
  // Intermediate values can carry more integer digits than either end (e.g. 999 → 1,000); probe the range.
  if (known.length > 1) { const lo = Math.min(...known), hi = Math.max(...known); for (let i = 1; i < 16; i++) candidates.push(lo + ((hi - lo) * i) / 16); }
  const texts = [...candidates.map(fmt), ...(spec.keyframes.some((k) => k.value === null) ? [spec.unknownText ?? "Unknown"] : [])];
  const reserve = texts.reduce((a, b) => (b.length > a.length ? b : a), "");
  let reserveDelta = "";
  if (spec.delta) {
    const deltas: string[] = [];
    for (let i = 1; i < known.length; i++) deltas.push(deltaText(known[i] - known[i - 1], known[i - 1], spec, fmt).display);
    reserveDelta = deltas.reduce((a, b) => (b.length > a.length ? b : a), "");
  }
  return { spec, format, keyframes: spec.keyframes, reserve, reserveDelta, diagnostics };
}

function deltaText(change: number, base: number, spec: AnimatedMetricSpec, fmt: (v: number) => string) {
  const sign = change > 0 ? "+" : change < 0 ? "−" : "±";
  const abs = `${sign}${fmt(Math.abs(change)).replace(/^-/, "")}`;
  const pctNf = new Intl.NumberFormat(spec.language ?? "en", { style: "percent", maximumFractionDigits: 1 });
  const pct = base !== 0 ? `${sign}${pctNf.format(Math.abs(change / base))}` : "n/a";
  const mode = spec.delta;
  return { value: change, display: mode === "percent" ? pct : mode === "both" ? `${abs} (${pct})` : abs, direction: (change > 0 ? "up" : change < 0 ? "down" : "flat") as "up" | "down" | "flat" };
}

/** The metric at an absolute frame. Pure. */
export function evaluateAnimatedMetric(plan: AnimatedMetricPlan, frame: number): AnimatedMetricFrame {
  const { spec, keyframes } = plan;
  const fmt = formatter(plan.format, spec.language ?? "en");
  const unknown = spec.unknownText ?? "Unknown";
  let k = -1;
  for (let i = 0; i < keyframes.length; i++) if (keyframes[i].frame <= frame) k = i;
  const next = keyframes[k + 1];
  const prevKnown = (i: number) => { for (let j = i - 1; j >= 0; j--) if (keyframes[j].value !== null) return keyframes[j].value as number; return null; };
  const deltaAt = (i: number) => {
    if (!spec.delta || i < 0) return null;
    const v = keyframes[i].value, p = prevKnown(i);
    return v === null || p === null ? null : deltaText(v - p, p, spec, fmt);
  };
  const shown = (v: number | null) => (v === null ? unknown : fmt(v));
  // Counting toward the next keyframe (only between two known values, inside the count window).
  if (next && (spec.mode ?? "interpolate") === "interpolate" && next.value !== null) {
    const from = k >= 0 ? keyframes[k].value : null;
    const startFrame = Math.max(k >= 0 ? keyframes[k].frame : next.frame, next.frame - (spec.countFrames ?? Infinity));
    if (from !== null && frame >= startFrame) {
      const t = (frame - startFrame) / Math.max(1e-9, next.frame - startFrame);
      const e = evaluateEasing(spec.easing ?? "ease-out-cubic", Math.max(0, Math.min(1, t)));
      let v = from + (next.value - from) * e;
      const q = Math.max(spec.tickStep ?? 0, precisionStep(plan.format));
      v = Math.round(v / q) * q;
      // Never display the target before it is reached, nor overshoot it.
      if (next.value > from) v = Math.min(v, next.value - (frame < next.frame ? q : 0)); else if (next.value < from) v = Math.max(v, next.value + (frame < next.frame ? q : 0));
      if (Math.abs(v - from) > 1e-12) return { value: v, display: fmt(v), transitioning: true, settled: false, status: "known", keyIndex: k, label: keyframes[k].label, delta: null, target: fmt(next.value) };
    }
  }
  if (k < 0) {
    const first = keyframes[0];
    return { value: null, display: first.value === null ? unknown : "—", transitioning: false, settled: false, status: "pending", keyIndex: -1, delta: null, target: shown(first.value) };
  }
  const cur = keyframes[k];
  return { value: cur.value, display: shown(cur.value), transitioning: false, settled: true, status: cur.value === null ? "unknown" : "known", keyIndex: k, label: cur.label, delta: deltaAt(k), target: shown(next?.value ?? cur.value) };
}
