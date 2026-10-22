/**
 * `path-trim` / vector-draw — a genuine vector stroke reveal over an existing
 * {@link "./paths"!MotionPath} (docs/08 §3 `path-trim`).
 *
 * The reveal is produced by *slicing* the flattened polyline between two
 * normalized arc-length fractions; the source path is never mutated and the
 * emitted geometry is a real polyline (not a dash trick), so the caller can
 * stroke it with any renderer. `offset` rotates the window around the path.
 *
 * Determinism: sampling is fixed-count, ordering is explicit, and there is no
 * wall-clock or random input.
 */

import { evaluateEasing } from "./easing";
import { samplePath } from "./paths";
import type { MotionPath, PathSamples } from "./paths";
import type { EasingSpec, FrameRange, Vec2 } from "./types";

/** Normalized trim window over a path's arc length. */
export interface PathTrimSpec {
  /** Start fraction in `[0, 1]` (clamped). */
  start: number;
  /** End fraction in `[0, 1]` (clamped). */
  end: number;
  /** Rotation added to both ends before wrapping/clamping. Default `0`. */
  offset?: number;
  /** `"reverse"` emits the same window with its point order reversed. Default `"forward"`. */
  direction?: "forward" | "reverse";
}

/** Result of a trim: the sliced polyline plus both the SVG form and window bounds. */
export interface TrimResult {
  pathId: string;
  points: Vec2[];
  svg: string;
  /** Normalized window start actually used (always `<= endT`). */
  startT: number;
  /** Normalized window end actually used. */
  endT: number;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

/** Wrap a value into `[0, 1]`, leaving values already inside untouched. */
function wrapToUnit(v: number): number {
  if (v >= 0 && v <= 1) return v;
  const m = v % 1;
  return m < 0 ? m + 1 : m;
}

function lerpPoint(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function pointAtDistance(points: Vec2[], cum: number[], d: number): Vec2 {
  const last = points.length - 1;
  if (d <= 0) return { x: points[0].x, y: points[0].y };
  if (d >= cum[last]) return { x: points[last].x, y: points[last].y };
  let i = 0;
  while (i < last - 1 && cum[i + 1] < d) i += 1;
  const segLen = cum[i + 1] - cum[i];
  const f = segLen > 0 ? (d - cum[i]) / segLen : 0;
  return lerpPoint(points[i], points[i + 1], f);
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
}

/**
 * Resolve a trim window: `start`/`end` are clamped to `[0, 1]`, `offset` is a
 * rotation (wrapped), and the pair is ordered so `startT <= endT`.
 *
 * A rotation that crosses the seam cannot be represented as one interval, so
 * after wrapping the endpoints the window is normalized (swapped) — callers
 * needing the seam-crossing split should issue two trims.
 */
export function normalizeTrimWindow(spec: PathTrimSpec): { startT: number; endT: number } {
  const offset = spec.offset ?? 0;
  const a = clamp01(spec.start);
  const b = clamp01(spec.end);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  let s = wrapToUnit(lo + offset);
  let e = wrapToUnit(hi + offset);
  if (s > e) {
    const tmp = s;
    s = e;
    e = tmp;
  }
  return { startT: s, endT: e };
}

/** Slice a flattened polyline between two normalized arc-length fractions. */
function sliceByDistance(samples: PathSamples, startT: number, endT: number): Vec2[] {
  const points = samples.points;
  const cum = samples.cumulativeLengths;
  if (points.length === 0) return [];
  if (points.length === 1) return [{ x: points[0].x, y: points[0].y }];

  if (samples.totalLength <= 0) return [{ x: points[0].x, y: points[0].y }];
  if (startT <= 0 && endT >= 1) return points.map((p) => ({ x: p.x, y: p.y }));

  const d0 = startT * samples.totalLength;
  const d1 = endT * samples.totalLength;
  const out: Vec2[] = [pointAtDistance(points, cum, d0)];
  for (let i = 0; i < points.length; i += 1) {
    if (cum[i] > d0 && cum[i] < d1) out.push({ x: points[i].x, y: points[i].y });
  }
  out.push(pointAtDistance(points, cum, d1));
  return out;
}

function pointsToSvg(points: Vec2[]): string {
  if (points.length === 0) return "";
  const parts = [`M ${fmt(points[0].x)} ${fmt(points[0].y)}`];
  for (let i = 1; i < points.length; i += 1) {
    parts.push(`L ${fmt(points[i].x)} ${fmt(points[i].y)}`);
  }
  return parts.join(" ");
}

/**
 * Trim `path` to `spec`. Returns a fresh polyline (and its SVG form); `path`
 * and `spec` are never mutated.
 */
export function trimPath(
  path: MotionPath,
  spec: PathTrimSpec,
  opts: { samplesPerSegment?: number } = {},
): TrimResult {
  const samples = samplePath(path, opts.samplesPerSegment);
  const { startT, endT } = normalizeTrimWindow(spec);
  let points = sliceByDistance(samples, startT, endT);
  if (spec.direction === "reverse") points = points.slice().reverse();
  return { pathId: path.id, points, svg: pointsToSvg(points), startT, endT };
}

/** Total arc length of a path (convenience over {@link samplePath}). */
export function pathLength(path: MotionPath, opts: { samplesPerSegment?: number } = {}): number {
  return samplePath(path, opts.samplesPerSegment).totalLength;
}

/**
 * Deterministic reveal progress for `frame` within an end-exclusive range,
 * shaped by the kernel easing. Returns a clamped `[0, 1]` value; easings with
 * overshoot (e.g. `ease-in-back`) are clipped so callers always receive a valid
 * stroke fraction.
 */
export function trimRevealProgress(frame: number, range: FrameRange, easing?: EasingSpec): number {
  const span = range.endFrame - range.startFrame;
  if (span <= 0) return frame < range.startFrame ? 0 : 1;
  const t = clamp01((frame - range.startFrame) / span);
  return clamp01(evaluateEasing(easing ?? "linear", t));
}
