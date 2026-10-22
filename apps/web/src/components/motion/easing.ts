/**
 * Motion core — easing (docs/08 §2).
 *
 * Supports the named easings from the frozen contract, CSS-shaped `steps()`, and
 * arbitrary cubic beziers. `t` is always clamped to `[0, 1]`. Everything is pure
 * and deterministic.
 */

import type { EasingName, EasingSpec } from "./types";

/** Every easing name the evaluator understands. */
export const EASING_NAMES: EasingName[] = [
  "linear",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "ease-in-cubic",
  "ease-out-cubic",
  "ease-in-out-cubic",
  "ease-in-quad",
  "ease-out-quad",
  "ease-in-out-quad",
  "ease-in-quart",
  "ease-out-quart",
  "ease-in-expo",
  "ease-out-expo",
  "ease-in-back",
  "ease-out-back",
  "ease-in-out-back",
  "step-start",
  "step-end",
];

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function isEasingName(value: unknown): value is EasingName {
  return typeof value === "string" && (EASING_NAMES as string[]).includes(value);
}

/** Structural check for the `EasingSpec` union. */
export function isEasingSpec(value: unknown): value is EasingSpec {
  if (isEasingName(value)) return true;
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if ("cubicBezier" in record) {
    const points = record.cubicBezier;
    return (
      Array.isArray(points) &&
      points.length === 4 &&
      points.every((n) => typeof n === "number" && Number.isFinite(n))
    );
  }
  if ("steps" in record) {
    const steps = record.steps;
    if (typeof steps !== "number" || !Number.isFinite(steps) || steps < 1) return false;
    const mode = record.mode;
    if (mode === undefined) return true;
    return mode === "start" || mode === "end" || mode === "both";
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * Cubic bezier
 * ------------------------------------------------------------------ */

function curveX(x1: number, x2: number, s: number): number {
  const mt = 1 - s;
  return 3 * mt * mt * s * x1 + 3 * mt * s * s * x2 + s * s * s;
}

function curveDX(x1: number, x2: number, s: number): number {
  const mt = 1 - s;
  return 3 * (mt * mt * x1 + 2 * s * mt * (x2 - x1) + s * s * (1 - x2));
}

function curveY(y1: number, y2: number, s: number): number {
  const mt = 1 - s;
  return 3 * mt * mt * s * y1 + 3 * mt * s * s * y2 + s * s * s;
}

/** Solve `curveX(s) = x` for `s` with Newton, falling back to bisection. */
function solveCurveX(x1: number, x2: number, x: number): number {
  let s = x;
  for (let i = 0; i < 8; i += 1) {
    const err = curveX(x1, x2, s) - x;
    if (Math.abs(err) < 1e-7) return s;
    const d = curveDX(x1, x2, s);
    if (Math.abs(d) < 1e-7) break;
    s -= err / d;
  }
  let lo = 0;
  let hi = 1;
  let mid = x;
  for (let i = 0; i < 60; i += 1) {
    const value = curveX(x1, x2, mid);
    if (Math.abs(value - x) < 1e-9) return mid;
    if (value > x) hi = mid;
    else lo = mid;
    mid = (lo + hi) / 2;
  }
  return mid;
}

/**
 * A cubic bezier easing over unit space. `x` control points are clamped to
 * `[0, 1]` so the curve stays a function; `t = 0 → 0` and `t = 1 → 1` exactly.
 */
export function cubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): (t: number) => number {
  const cx1 = clamp01(x1);
  const cx2 = clamp01(x2);
  return (t: number): number => {
    const x = clamp01(t);
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return curveY(y1, y2, solveCurveX(cx1, cx2, x));
  };
}

/* ------------------------------------------------------------------ *
 * Named curves
 * ------------------------------------------------------------------ */

const EASE_IN = cubicBezier(0.42, 0, 1, 1);
const EASE_OUT = cubicBezier(0, 0, 0.58, 1);
const EASE_IN_OUT = cubicBezier(0.42, 0, 0.58, 1);

const BACK_C1 = 1.70158;
const BACK_C3 = BACK_C1 + 1;
const BACK_C2 = BACK_C1 * 1.525;

function stepsEasing(n: number, mode: "start" | "end" | "both", t: number): number {
  if (!Number.isFinite(n) || n <= 0) return t;
  if (mode === "start") return Math.min(1, Math.ceil(t * n) / n);
  if (mode === "both") return Math.min(1, (Math.floor(t * n) + 1) / (n + 1));
  return Math.floor(t * n) / n;
}

function evaluateNamed(name: EasingName, t: number): number {
  switch (name) {
    case "linear":
      return t;
    case "ease-in":
      return EASE_IN(t);
    case "ease-out":
      return EASE_OUT(t);
    case "ease-in-out":
      return EASE_IN_OUT(t);
    case "ease-in-quad":
      return t * t;
    case "ease-out-quad":
      return 1 - (1 - t) * (1 - t);
    case "ease-in-out-quad":
      return t < 0.5 ? 2 * t * t : 1 - (2 - 2 * t) * (2 - 2 * t) / 2;
    case "ease-in-cubic":
      return t * t * t;
    case "ease-out-cubic":
      return 1 - (1 - t) ** 3;
    case "ease-in-out-cubic":
      return t < 0.5 ? 4 * t * t * t : 1 - (2 - 2 * t) ** 3 / 2;
    case "ease-in-quart":
      return t ** 4;
    case "ease-out-quart":
      return 1 - (1 - t) ** 4;
    case "ease-in-expo":
      return t === 0 ? 0 : 2 ** (10 * t - 10);
    case "ease-out-expo":
      return t === 1 ? 1 : 1 - 2 ** (-10 * t);
    case "ease-in-back":
      return BACK_C3 * t * t * t - BACK_C1 * t * t;
    case "ease-out-back": {
      const p = t - 1;
      return 1 + BACK_C3 * p * p * p + BACK_C1 * p * p;
    }
    case "ease-in-out-back": {
      if (t < 0.5) {
        const p = 2 * t;
        return (p * p * ((BACK_C2 + 1) * p - BACK_C2)) / 2;
      }
      const p = 2 * t - 2;
      return (p * p * ((BACK_C2 + 1) * p + BACK_C2) + 2) / 2;
    }
    case "step-start":
      return stepsEasing(1, "start", t);
    case "step-end":
      return stepsEasing(1, "end", t);
    default:
      return t;
  }
}

/**
 * Evaluate an easing at normalized progress `t`. `t` is clamped to `[0, 1]`;
 * `undefined` yields linear.
 */
export function evaluateEasing(spec: EasingSpec | undefined, t: number): number {
  const progress = clamp01(t);
  if (spec === undefined) return progress;
  if (typeof spec === "string") return evaluateNamed(spec, progress);
  if ("cubicBezier" in spec) {
    const [x1, y1, x2, y2] = spec.cubicBezier;
    return cubicBezier(x1, y1, x2, y2)(progress);
  }
  if ("steps" in spec) {
    return stepsEasing(spec.steps, spec.mode ?? "end", progress);
  }
  return progress;
}
