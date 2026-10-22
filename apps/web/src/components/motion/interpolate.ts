/**
 * Motion core — typed value interpolation and keyframe sampling (docs/08 §2).
 *
 * Values are typed (`MotionValueType`). Arbitrary JSON and strings are never
 * interpolated — discrete value types cut at the segment boundary. Colour is the
 * only string-bearing value type and is parsed into a `ColorValue` first.
 */

import type {
  AffineMatrix,
  AngleMode,
  AnimationTrack,
  ColorValue,
  Diagnostic,
  Keyframe,
  MotionValue,
  MotionValueType,
  Vec2,
} from "./types";
import { createDiagnostic } from "./diagnostics";
import { evaluateEasing } from "./easing";
import { interpolateMatrix, lerpNumber, shortestAngleDelta } from "./matrix";

function clamp(min: number, max: number, value: number): number {
  return Math.min(Math.max(value, min), max);
}

function isVec2(value: unknown): value is Vec2 {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Vec2).x === "number" &&
    typeof (value as Vec2).y === "number"
  );
}

function isMatrix(value: unknown): value is AffineMatrix {
  if (typeof value !== "object" || value === null) return false;
  const m = value as AffineMatrix;
  return (
    typeof m.a === "number" &&
    typeof m.b === "number" &&
    typeof m.c === "number" &&
    typeof m.d === "number" &&
    typeof m.e === "number" &&
    typeof m.f === "number"
  );
}

function isColorValue(value: unknown): value is ColorValue {
  if (typeof value !== "object" || value === null) return false;
  const c = value as ColorValue;
  return (
    (c.space === "srgb" || c.space === "linear-rgb") &&
    typeof c.r === "number" &&
    typeof c.g === "number" &&
    typeof c.b === "number" &&
    typeof c.alpha === "number"
  );
}

/* ------------------------------------------------------------------ *
 * Discrete value types
 * ------------------------------------------------------------------ */

/** Value types that never blend — they cut at the segment boundary. */
export function isDiscreteValueType(type: MotionValueType): boolean {
  return type === "discrete" || type === "boolean" || type === "path";
}

/* ------------------------------------------------------------------ *
 * Colour
 * ------------------------------------------------------------------ */

const HEX3 = /^#([0-9a-fA-F]{3})$/;
const HEX6 = /^#([0-9a-fA-F]{6})$/;
const HEX8 = /^#([0-9a-fA-F]{8})$/;
const RGB_FN =
  /^rgba?\(\s*([+-]?\d*\.?\d+)\s*,\s*([+-]?\d*\.?\d+)\s*,\s*([+-]?\d*\.?\d+)\s*(?:,\s*([+-]?\d*\.?\d+)\s*)?\)$/;

/**
 * Parse `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()`. Default space is
 * `srgb`. Throws a descriptive `Error` on malformed input (callers guard).
 */
export function parseColor(input: string | ColorValue): ColorValue {
  if (typeof input !== "string") {
    if (isColorValue(input)) return { ...input };
    throw new Error("Invalid color: expected a string or a ColorValue.");
  }

  const value = input.trim();
  const hex3 = HEX3.exec(value);
  if (hex3) {
    const [r, g, b] = hex3[1].split("").map((c) => parseInt(c + c, 16));
    return { space: "srgb", r, g, b, alpha: 1 };
  }
  const hex6 = HEX6.exec(value);
  if (hex6) {
    const int = parseInt(hex6[1], 16);
    return {
      space: "srgb",
      r: (int >> 16) & 0xff,
      g: (int >> 8) & 0xff,
      b: int & 0xff,
      alpha: 1,
    };
  }
  const hex8 = HEX8.exec(value);
  if (hex8) {
    const int = parseInt(hex8[1], 16);
    return {
      space: "srgb",
      r: (int >>> 24) & 0xff,
      g: (int >> 16) & 0xff,
      b: (int >> 8) & 0xff,
      alpha: (int & 0xff) / 255,
    };
  }
  const fn = RGB_FN.exec(value);
  if (fn) {
    return {
      space: "srgb",
      r: clamp(0, 255, Number(fn[1])),
      g: clamp(0, 255, Number(fn[2])),
      b: clamp(0, 255, Number(fn[3])),
      alpha: fn[4] === undefined ? 1 : clamp(0, 1, Number(fn[4])),
    };
  }
  throw new Error(`Invalid color "${input}": expected #rgb, #rrggbb, #rrggbbaa, rgb() or rgba().`);
}

/** Format a colour as `rgba(r, g, b, a)` with 0-255 integer channels. */
export function formatColor(color: ColorValue): string {
  const r = Math.round(clamp(0, 255, color.r));
  const g = Math.round(clamp(0, 255, color.g));
  const b = Math.round(clamp(0, 255, color.b));
  const a = clamp(0, 1, color.alpha);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Component-wise colour interpolation. Spaces must match (caller's contract). */
export function interpolateColor(a: ColorValue, b: ColorValue, t: number): ColorValue {
  return {
    space: a.space,
    r: lerpNumber(a.r, b.r, t),
    g: lerpNumber(a.g, b.g, t),
    b: lerpNumber(a.b, b.b, t),
    alpha: lerpNumber(a.alpha, b.alpha, t),
  };
}

/* ------------------------------------------------------------------ *
 * Value interpolation
 * ------------------------------------------------------------------ */

/** Step interpolation shared by discrete value types. */
function stepValue(a: MotionValue, b: MotionValue, t: number): MotionValue {
  return t >= 1 ? b : a;
}

/** Interpolate a single typed value at (already eased) progress `t`. */
export function interpolateValue(
  type: MotionValueType,
  a: MotionValue,
  b: MotionValue,
  t: number,
  opts?: { angleMode?: AngleMode },
): MotionValue {
  switch (type) {
    case "number":
    case "opacity":
    case "length":
      return lerpNumber(a as number, b as number, t);
    case "angle": {
      const from = a as number;
      const to = b as number;
      if ((opts?.angleMode ?? "shortest") === "full-turn") {
        return lerpNumber(from, to, t);
      }
      return from + shortestAngleDelta(from, to) * t;
    }
    case "vec2": {
      const av = a as Vec2;
      const bv = b as Vec2;
      return { x: lerpNumber(av.x, bv.x, t), y: lerpNumber(av.y, bv.y, t) };
    }
    case "transform":
      return interpolateMatrix(a as AffineMatrix, b as AffineMatrix, t);
    case "color":
      return interpolateColor(a as ColorValue, b as ColorValue, t);
    case "boolean":
    case "discrete":
    case "path":
      return stepValue(a, b, t);
    default:
      return stepValue(a, b, t);
  }
}

/**
 * Structural validation of a typed value. Returns `null` when the value matches
 * the declared type, otherwise a `motion-value-type-mismatch` error.
 */
export function validateValue(type: MotionValueType, value: MotionValue): Diagnostic | null {
  const fail = (expected: string): Diagnostic =>
    createDiagnostic(
      "motion-value-type-mismatch",
      "error",
      `Expected a ${type} value (${expected}).`,
    );

  switch (type) {
    case "number":
    case "opacity":
    case "length":
      return typeof value === "number" && Number.isFinite(value) ? null : fail("finite number");
    case "angle":
      return typeof value === "number" && Number.isFinite(value)
        ? null
        : fail("finite number of radians");
    case "vec2":
      return isVec2(value) && Number.isFinite(value.x) && Number.isFinite(value.y)
        ? null
        : fail("{ x, y }");
    case "transform":
      return isMatrix(value) ? null : fail("AffineMatrix");
    case "color":
      return isColorValue(value) ? null : fail("ColorValue");
    case "boolean":
      return typeof value === "boolean" ? null : fail("boolean");
    case "path":
      return typeof value === "string" || Array.isArray(value) ? null : fail("string or Vec2[]");
    case "discrete":
      return value === undefined ? fail("defined value") : null;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ *
 * Track sampling
 * ------------------------------------------------------------------ */

/**
 * Sample an animation track at an integer `frame`.
 *
 * Keyframes are sorted ascending (stable). An unsorted input emits
 * `motion-keyframe-unordered`; duplicate frames emit
 * `motion-keyframe-duplicate-frame` and the last value wins (giving a discrete
 * cut at that frame). Empty tracks emit `motion-keyframe-empty`.
 *
 * Before the first keyframe the first value holds; after the last, the last
 * value holds.
 */
export function sampleTrack(
  track: AnimationTrack,
  frame: number,
): { value: MotionValue | null; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const keyframes = track.keyframes;

  if (keyframes.length === 0) {
    diagnostics.push(
      createDiagnostic("motion-keyframe-empty", "error", `Track "${track.id}" has no keyframes.`),
    );
    return { value: null, diagnostics };
  }

  let unsorted = false;
  for (let i = 1; i < keyframes.length; i += 1) {
    if (keyframes[i].frame < keyframes[i - 1].frame) {
      unsorted = true;
      break;
    }
  }
  if (unsorted) {
    diagnostics.push(
      createDiagnostic(
        "motion-keyframe-unordered",
        "error",
        `Track "${track.id}" keyframes were not sorted by frame; a stable sort was applied.`,
      ),
    );
  }

  const sorted = keyframes
    .map((kf, index) => ({ kf, index }))
    .sort((x, y) => x.kf.frame - y.kf.frame || x.index - y.index)
    .map((entry) => entry.kf);

  const unique: Keyframe[] = [];
  let duplicate = false;
  for (const kf of sorted) {
    const last = unique[unique.length - 1];
    if (last && last.frame === kf.frame) {
      unique[unique.length - 1] = kf;
      duplicate = true;
    } else {
      unique.push(kf);
    }
  }
  if (duplicate) {
    diagnostics.push(
      createDiagnostic(
        "motion-keyframe-duplicate-frame",
        "warning",
        `Track "${track.id}" has duplicate keyframe frames; the last value wins.`,
      ),
    );
  }

  const first = unique[0];
  const last = unique[unique.length - 1];
  if (frame <= first.frame) return { value: first.value, diagnostics };
  if (frame >= last.frame) return { value: last.value, diagnostics };

  for (let i = 1; i < unique.length; i += 1) {
    const k0 = unique[i - 1];
    const k1 = unique[i];
    if (frame >= k0.frame && frame < k1.frame) {
      const span = k1.frame - k0.frame;
      const t = span <= 0 ? 1 : (frame - k0.frame) / span;
      const easing = k1.easing ?? track.easing ?? "linear";
      const eased = evaluateEasing(easing, t);
      return {
        value: interpolateValue(track.valueType, k0.value, k1.value, eased, {
          angleMode: track.angleMode,
        }),
        diagnostics,
      };
    }
  }

  return { value: last.value, diagnostics };
}
