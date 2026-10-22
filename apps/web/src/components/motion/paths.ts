/**
 * `motion-path` — 2D curve, parameterization, orient-to-tangent, arc-length and
 * local/world conversion (docs/08 §3 `motion-path`).
 *
 * Pure geometry over the frozen {@link "./types"} contract: no wall-clock, no
 * randomness, no mutation of caller inputs. Screen space is 2D design px with a
 * top-left origin (docs/07 shared contracts).
 *
 * ## Ownership of geometry types
 * `MotionPath` / `PathAnchor` are *geometry* shapes used only by the motion
 * geometry lane, so they live here rather than in the frozen `types.ts`
 * (which is data-only and frozen). They are plain data and therefore still
 * JSON-serializable, preserving the "safe data" requirement (docs/11).
 *
 * ## Control points
 * `PathAnchor.in` (incoming) and `PathAnchor.out` (outgoing) are **absolute**
 * design-px control points, not offsets relative to the anchor. A cubic segment
 * between anchor `i` and anchor `i+1` uses `anchors[i].out` as its first control
 * point and `anchors[i + 1].in` as its second. When either handle is missing the
 * segment degrades to a straight line, which keeps partially-authored paths
 * renderable instead of silently breaking.
 */

import { applyMatrixToPoint } from "./matrix";
import type { AffineMatrix, Rect, Vec2 } from "./types";

/** A single on-curve anchor, with optional absolute cubic control handles. */
export interface PathAnchor {
  x: number;
  y: number;
  /** Incoming cubic control point (absolute px). */
  in?: Vec2;
  /** Outgoing cubic control point (absolute px). */
  out?: Vec2;
}

/** Interpolation family for the whole path. */
export type PathKind = "linear" | "cubic";

/** A renderer-neutral motion path (plain data, JSON-safe). */
export interface MotionPath {
  id: string;
  anchors: PathAnchor[];
  closed: boolean;
  kind: PathKind;
}

/** Flattened polyline approximation of a {@link MotionPath}. */
export interface PathSamples {
  pathId: string;
  /** Flattened polyline vertices; for closed paths the last repeats the first. */
  points: Vec2[];
  /** Arc length from the first point up to `points[i]` (`cumulativeLengths[0] === 0`). */
  cumulativeLengths: number[];
  totalLength: number;
}

/** Default number of subdivisions per cubic segment during flattening. */
const DEFAULT_SAMPLES_PER_SEGMENT = 16;
/** Finite-difference step used by {@link tangentOnPath}. */
const TANGENT_EPSILON = 1e-4;

function clamp01(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function copyAnchor(a: PathAnchor): PathAnchor {
  const out: PathAnchor = { x: a.x, y: a.y };
  if (a.in) out.in = { x: a.in.x, y: a.in.y };
  if (a.out) out.out = { x: a.out.x, y: a.out.y };
  return out;
}

function lerpPoint(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function cubicPoint(a: PathAnchor, b: PathAnchor, t: number): Vec2 {
  const c1 = a.out as Vec2;
  const c2 = b.in as Vec2;
  const mt = 1 - t;
  const w0 = mt * mt * mt;
  const w1 = 3 * mt * mt * t;
  const w2 = 3 * mt * t * t;
  const w3 = t * t * t;
  return {
    x: w0 * a.x + w1 * c1.x + w2 * c2.x + w3 * b.x,
    y: w0 * a.y + w1 * c1.y + w2 * c2.y + w3 * b.y,
  };
}

/** A segment is cubic only when both handles exist. */
function segmentIsCubic(path: MotionPath, a: PathAnchor, b: PathAnchor): boolean {
  return path.kind === "cubic" && a.out !== undefined && b.in !== undefined;
}

/**
 * Build a new motion path from anchors. Anchors may be partial: missing handles
 * simply mean the adjacent segment is linear. The input objects are copied, so
 * later mutations by the caller cannot leak into the path.
 */
export function createMotionPath(props: {
  id: string;
  anchors: Array<Partial<PathAnchor> & { x: number; y: number }>;
  closed?: boolean;
  kind?: "linear" | "cubic";
}): MotionPath {
  return {
    id: props.id,
    anchors: props.anchors.map((a) => copyAnchor(a as PathAnchor)),
    closed: props.closed ?? false,
    kind: props.kind ?? "linear",
  };
}

/** Number of drawable segments (closed paths connect the last anchor to the first). */
function segmentCount(path: MotionPath): number {
  if (path.anchors.length === 0) return 0;
  return path.closed ? path.anchors.length : path.anchors.length - 1;
}

/**
 * Flatten a path to a polyline and compute cumulative arc lengths.
 *
 * Deterministic: the subdivision count is a fixed argument (never time-based).
 * Note: for a closed path the final vertex repeats the first anchor so that the
 * polyline is geometrically closed and `pointOnPath(1)` returns the start.
 */
export function samplePath(path: MotionPath, samplesPerSegment = DEFAULT_SAMPLES_PER_SEGMENT): PathSamples {
  const anchors = path.anchors;
  const points: Vec2[] = [];
  const cum: number[] = [];

  if (anchors.length === 0) {
    return { pathId: path.id, points, cumulativeLengths: [0], totalLength: 0 };
  }

  const steps = Number.isFinite(samplesPerSegment) && samplesPerSegment >= 1 ? Math.floor(samplesPerSegment) : DEFAULT_SAMPLES_PER_SEGMENT;
  const segs = segmentCount(path);

  for (let i = 0; i < segs; i += 1) {
    const a = anchors[i];
    const b = anchors[(i + 1) % anchors.length];
    const cubic = segmentIsCubic(path, a, b);
    const sub = cubic ? steps : 1;
    // Skip the duplicated joint vertex for every segment after the first.
    for (let s = i === 0 ? 0 : 1; s <= sub; s += 1) {
      const t = s / sub;
      points.push(cubic ? cubicPoint(a, b, t) : lerpPoint(a, b, t));
    }
  }

  cum.push(0);
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const p = points[i - 1];
    const q = points[i];
    total += Math.hypot(q.x - p.x, q.y - p.y);
    cum.push(total);
  }

  return { pathId: path.id, points, cumulativeLengths: cum, totalLength: total };
}

/** Interpolate the vertex at arc distance `d` along an already-computed polyline. */
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

/**
 * Point at normalized parameter `t` (clamped to `[0, 1]`).
 *
 * `arcLength` defaults to `true`, which spaces samples evenly by distance
 * travelled. With `arcLength: false` `t` indexes the flattened polyline
 * uniformly instead, so spacing follows segment count (docs/08 §3).
 */
export function pointOnPath(
  path: MotionPath,
  t: number,
  opts: { arcLength?: boolean; samples?: PathSamples } = {},
): Vec2 {
  const arcLength = opts.arcLength ?? true;
  const samples = opts.samples ?? samplePath(path);
  const points = samples.points;
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return { x: points[0].x, y: points[0].y };

  const tt = clamp01(t);
  if (arcLength && samples.totalLength > 0) {
    return pointAtDistance(points, samples.cumulativeLengths, tt * samples.totalLength);
  }

  const last = points.length - 1;
  const pos = tt * last;
  const i = Math.min(last - 1, Math.floor(pos));
  return lerpPoint(points[i], points[i + 1], pos - i);
}

/**
 * Unit tangent at `t`, via finite differences over {@link pointOnPath}.
 * Returns `{ x: 1, y: 0 }` for a degenerate (zero-length) local segment so
 * orient-to-tangent never produces `NaN`.
 */
export function tangentOnPath(
  path: MotionPath,
  t: number,
  opts: { arcLength?: boolean } = {},
): Vec2 {
  const tt = clamp01(t);
  const a = pointOnPath(path, tt <= 0 ? 0 : tt - TANGENT_EPSILON, opts);
  const b = pointOnPath(path, tt >= 1 ? 1 : tt + TANGENT_EPSILON, opts);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len <= 1e-12) return { x: 1, y: 0 };
  return { x: dx / len, y: dy / len };
}

/** Tangent angle in radians (`atan2`), suitable for orient-to-tangent. */
export function angleOnPath(path: MotionPath, t: number, opts: { arcLength?: boolean } = {}): number {
  const tan = tangentOnPath(path, t, opts);
  return Math.atan2(tan.y, tan.x);
}

/** Trim float noise so generated SVG strings are stable and diff-friendly. */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
}

/** Serialize a path to an SVG `d` string using `M` / `C` / `L` / `Z`. */
export function pathToSvgD(path: MotionPath): string {
  if (path.anchors.length === 0) return "";
  const parts: string[] = [];
  const segs = segmentCount(path);
  const first = path.anchors[0];
  parts.push(`M ${fmt(first.x)} ${fmt(first.y)}`);

  for (let i = 0; i < segs; i += 1) {
    const a = path.anchors[i];
    const b = path.anchors[(i + 1) % path.anchors.length];
    if (segmentIsCubic(path, a, b)) {
      const c1 = a.out as Vec2;
      const c2 = b.in as Vec2;
      parts.push(`C ${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(b.x)} ${fmt(b.y)}`);
    } else {
      parts.push(`L ${fmt(b.x)} ${fmt(b.y)}`);
    }
  }

  if (path.closed) parts.push("Z");
  return parts.join(" ");
}

/** Axis-aligned bounds over the flattened polyline. */
export function pathBounds(path: MotionPath): Rect {
  const { points } = samplePath(path);
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Point at `t`, converted from local path space to world via `matrix`. */
export function pathTransformPoint(
  path: MotionPath,
  t: number,
  matrix: AffineMatrix,
  opts: { arcLength?: boolean; samples?: PathSamples } = {},
): Vec2 {
  return applyMatrixToPoint(matrix, pointOnPath(path, t, opts));
}
