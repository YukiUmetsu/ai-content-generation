/**
 * Motion core — time constants and rational frame math (docs/08 §2).
 *
 * All time is expressed as an integer frame count at a rational frames-per-second.
 * Frame ranges are end-exclusive: `[startFrame, endFrame)`.
 *
 * Determinism: every function here is a pure function of its arguments. No wall
 * clock, no `Date`, no randomness.
 */

import type { FrameRange, RationalFps } from "./types";

/** Version stamped on serialized motion documents. */
export const MOTION_SCHEMA_VERSION = 1;

/** Fallback frames-per-second used whenever an invalid fps is supplied. */
export const DEFAULT_FPS: RationalFps = { num: 30, den: 1 };

/** Euclidean greatest common divisor over the integer parts, never zero. */
function gcd(a: number, b: number): number {
  let x = Math.abs(Math.trunc(a));
  let y = Math.abs(Math.trunc(b));
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x === 0 ? 1 : x;
}

/** Convert a frame count to seconds. Exact rational division. */
export function framesToSeconds(frames: number, fps: RationalFps): number {
  const { num, den } = normalizeFps(fps);
  return (frames * den) / num;
}

/** Convert seconds to an (unrounded) frame count. Exact rational division. */
export function secondsToFrames(seconds: number, fps: RationalFps): number {
  const { num, den } = normalizeFps(fps);
  return (seconds * num) / den;
}

/** Seconds → frame, rounded to nearest. */
export function roundFrameToNearest(seconds: number, fps: RationalFps): number {
  return Math.round(secondsToFrames(seconds, fps));
}

/** Seconds → frame, rounded down. */
export function floorFrame(seconds: number, fps: RationalFps): number {
  return Math.floor(secondsToFrames(seconds, fps));
}

/** Seconds → frame, rounded up. */
export function ceilFrame(seconds: number, fps: RationalFps): number {
  return Math.ceil(secondsToFrames(seconds, fps));
}

/**
 * Clamp a frame into `[0, durationFrames - 1]`. A duration of `0` clamps to `0`.
 * Used when evaluating a timeline whose requested frame sits outside its range so
 * that the first / last authored value holds.
 */
export function clampFrame(frame: number, durationFrames: number): number {
  const max = Math.max(0, durationFrames - 1);
  return Math.min(Math.max(frame, 0), max);
}

/** Whether a frame lies in an end-exclusive range. */
export function isFrameInRange(frame: number, range: FrameRange): boolean {
  return frame >= range.startFrame && frame < range.endFrame;
}

/**
 * Reduce a rational fps by its gcd. Non-positive or non-finite numerators or
 * denominators are rejected by returning {@link DEFAULT_FPS}.
 */
export function normalizeFps(fps: RationalFps): RationalFps {
  if (
    !fps ||
    !Number.isFinite(fps.num) ||
    !Number.isFinite(fps.den) ||
    fps.num <= 0 ||
    fps.den <= 0
  ) {
    return { ...DEFAULT_FPS };
  }
  const g = gcd(fps.num, fps.den);
  return { num: Math.trunc(fps.num) / g, den: Math.trunc(fps.den) / g };
}

/** Numeric frames-per-second ratio (num / den). */
export function fpsRatio(fps: RationalFps): number {
  const { num, den } = normalizeFps(fps);
  return num / den;
}
