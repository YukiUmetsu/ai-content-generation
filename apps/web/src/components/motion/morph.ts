/**
 * `shape-morph` — contour correspondence, topology validation and an explicit,
 * documented fallback when two shapes are incompatible (docs/08 §3
 * `shape-morph`: "Validate compatible topology, winding, holes; explicit
 * fallback").
 *
 * The module never mutates its inputs. Incompatible pairs are never morphed:
 * `morphShapes` returns the source or target contours verbatim (as copies) and
 * reports a warning diagnostic, leaving any cross-fade to the caller (docs/08
 * "honest states" — a bad morph is a visible artifact, a documented dissolve is
 * an intentional one).
 *
 * ## Winding convention
 * Screen space has a top-left origin with **y pointing down**, so the shoelace
 * sum is sign-flipped relative to a y-up maths frame: a positive
 * {@link contourArea} corresponds to a **clockwise** visual winding ("cw"), a
 * negative one to counter-clockwise ("ccw").
 */

import { createDiagnostic } from "./diagnostics";
import { lerpNumber } from "./matrix";
import type { Diagnostic, Vec2 } from "./types";

/** A single contour: an ordered ring of points, optionally with holes. */
export interface PathContour {
  points: Vec2[];
  closed: boolean;
  holes?: PathContour[];
}

/** A shape is one or more contours (outer rings plus their holes). */
export interface ContourShape {
  contours: PathContour[];
}

export type MorphMode = "morph" | "dissolve" | "cut";

export interface MorphResult {
  contours: PathContour[];
  mode: MorphMode;
  diagnostics: Diagnostic[];
}

/** Minimum resample density; below this a morph visibly loses shape. */
const MIN_RESAMPLE_COUNT = 8;
/** Bound per-ring sampling work for authored or explicit sample densities. */
const MAX_RESAMPLE_COUNT = 4096;
/** Area magnitude below which a contour is treated as degenerate (px²). */
const DEGENERATE_AREA_EPSILON = 1e-9;

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function copyPoint(p: Vec2): Vec2 {
  return { x: p.x, y: p.y };
}

function copyContour(c: PathContour): PathContour {
  const out: PathContour = { points: c.points.map(copyPoint), closed: c.closed };
  if (c.holes) out.holes = c.holes.map(copyContour);
  return out;
}

function lerpPoint(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: lerpNumber(a.x, b.x, t), y: lerpNumber(a.y, b.y, t) };
}

/** Signed area (shoelace). Positive is clockwise in a top-left origin frame. */
export function contourArea(points: Vec2[]): number {
  const n = points.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const p = points[i];
    const q = points[(i + 1) % n];
    sum += p.x * q.y - q.x * p.y;
  }
  return sum / 2;
}

/** Visual winding of a contour under the top-left-origin convention above. */
export function contourWinding(points: Vec2[]): "cw" | "ccw" | "degenerate" {
  if (points.length < 3) return "degenerate";
  const area = contourArea(points);
  if (Math.abs(area) <= DEGENERATE_AREA_EPSILON) return "degenerate";
  return area > 0 ? "cw" : "ccw";
}

/**
 * Whether a contour is a closed ring — either flagged `closed`, or its first and
 * last points coincide within a small epsilon.
 */
export function contourIsClosed(contour: PathContour): boolean {
  if (contour.closed) return true;
  const p = contour.points;
  if (p.length <= 2) return false;
  const first = p[0];
  const last = p[p.length - 1];
  return Math.hypot(last.x - first.x, last.y - first.y) <= 1e-6;
}

function pointAtDistance(points: Vec2[], cum: number[], d: number): Vec2 {
  const last = points.length - 1;
  if (d <= 0) return copyPoint(points[0]);
  if (d >= cum[last]) return copyPoint(points[last]);
  let i = 0;
  while (i < last - 1 && cum[i + 1] < d) i += 1;
  const segLen = cum[i + 1] - cum[i];
  const f = segLen > 0 ? (d - cum[i]) / segLen : 0;
  return lerpPoint(points[i], points[i + 1], f);
}

/**
 * Even arc-length resample of an open polyline into exactly `count` points
 * (endpoints included). Deterministic and input-preserving; degenerate inputs
 * (0 points, or zero total length) collapse predictably to repeated copies of
 * the first point rather than returning `NaN`.
 */
export function resampleContour(points: Vec2[], count: number): Vec2[] {
  if (count <= 0) return [];
  if (points.length === 0) return [];
  if (points.length === 1 || count === 1) {
    return Array.from({ length: count }, () => copyPoint(points[0]));
  }

  const cum: number[] = [0];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    cum.push(total);
  }
  if (total <= 0) {
    return Array.from({ length: count }, () => copyPoint(points[0]));
  }

  const out: Vec2[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(pointAtDistance(points, cum, (i / (count - 1)) * total));
  }
  return out;
}

/** Resample a closed ring around the loop so the seam stays even. */
function resampleLoop(points: Vec2[], count: number): Vec2[] {
  if (points.length === 0) return [];
  if (points.length === 1) return Array.from({ length: count }, () => copyPoint(points[0]));
  const loop = points.map(copyPoint);
  loop.push(copyPoint(points[0]));
  const resampled = resampleContour(loop, count + 1);
  resampled.pop();
  return resampled;
}

function resampleContourLike(contour: PathContour, count: number): Vec2[] {
  return contourIsClosed(contour)
    ? resampleLoop(contour.points, count)
    : resampleContour(contour.points, count);
}

function pointCountOf(contour: PathContour): number {
  let n = contour.points.length;
  for (const hole of contour.holes ?? []) n = Math.max(n, hole.points.length);
  return n;
}

function shapePointCount(shape: ContourShape): number {
  let n = 0;
  for (const c of shape.contours) n = Math.max(n, pointCountOf(c));
  return n;
}

/**
 * Tests authored polyline segments in O(n²). Adjacent edges may share their
 * endpoint; repeated closing/consecutive vertices do not create extra edges.
 * This is a floating-point segment check, not an exact geometric predicate.
 */
function contourSelfIntersects(contour: PathContour): boolean {
  const samePoint = (a: Vec2, b: Vec2) => a.x === b.x && a.y === b.y;
  const points = contour.points.filter((point, index, all) =>
    index === 0 || !samePoint(point, all[index - 1]),
  );
  const closed = contourIsClosed(contour);
  if (closed && points.length > 1 && samePoint(points[0], points[points.length - 1])) points.pop();
  const edgeCount = closed ? points.length : points.length - 1;
  const cross = (a: Vec2, b: Vec2, c: Vec2) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const onSegment = (a: Vec2, b: Vec2, p: Vec2) =>
    p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) &&
    p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y);

  for (let i = 0; i < edgeCount; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    for (let j = i + 1; j < edgeCount; j += 1) {
      const c = points[j];
      const d = points[(j + 1) % points.length];
      const abc = cross(a, b, c);
      const abd = cross(a, b, d);
      const cda = cross(c, d, a);
      const cdb = cross(c, d, b);
      const adjacent = j === i + 1 || (closed && i === 0 && j === edgeCount - 1);
      if (adjacent) {
        // A shared vertex is valid, but doubling back over the same segment is not.
        if (abc === 0 && abd === 0) {
          const axis = a.x !== b.x ? "x" : "y";
          const overlap = Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis])) -
            Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]));
          if (overlap > 0) return true;
        }
        continue;
      }
      if ((Math.sign(abc) !== Math.sign(abd) && Math.sign(cda) !== Math.sign(cdb)) ||
          (abc === 0 && onSegment(a, b, c)) || (abd === 0 && onSegment(a, b, d)) ||
          (cda === 0 && onSegment(c, d, a)) || (cdb === 0 && onSegment(c, d, b))) return true;
    }
  }
  return false;
}

/**
 * Validate every contour and matched child pair. Array order and the authored
 * first vertex define correspondence; validation never rotates a seam or changes
 * winding. Segment checks cover each input contour, not containment between rings
 * or self-intersections that an authored correspondence could create in transit.
 */
export function validateMorph(from: ContourShape, to: ContourShape): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const report = (code: string, message: string) => {
    diagnostics.push(createDiagnostic(code, "error", message));
  };

  if (from.contours.length !== to.contours.length) {
    report("morph-contour-count-mismatch",
      `Cannot morph ${from.contours.length} contour(s) into ${to.contours.length}: contour counts differ.`);
  }

  const validateContour = (contour: PathContour, location: string): void => {
    const finite = contour.points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y));
    if (!finite || !Number.isFinite(contourArea(contour.points))) {
      report("morph-nonfinite-contour", `${location} has nonfinite coordinates or area. Use finite coordinates within the numeric range.`);
    } else {
      if (contourWinding(contour.points) === "degenerate") {
        report("morph-degenerate-contour", `${location} is degenerate (fewer than 3 points or zero area). Supply a nonzero-area contour.`);
      }
      if (contourSelfIntersects(contour)) {
        report("morph-self-intersection", `${location} intersects itself. Supply a simple contour or use an explicit fallback.`);
      }
    }
    (contour.holes ?? []).forEach((hole, index) => validateContour(hole, `${location} hole ${index}`));
  };
  from.contours.forEach((contour, index) => validateContour(contour, `from contour ${index}`));
  to.contours.forEach((contour, index) => validateContour(contour, `to contour ${index}`));

  const validatePair = (a: PathContour, b: PathContour, location: string): void => {
    const aHoles = a.holes ?? [];
    const bHoles = b.holes ?? [];
    if (aHoles.length !== bHoles.length) {
      report("morph-holes-mismatch", `${location} hole counts differ (${aHoles.length} vs ${bHoles.length}). Match the nested topology or use a fallback.`);
    }
    if (contourIsClosed(a) !== contourIsClosed(b)) {
      report("morph-closed-mismatch", `${location} closedness differs (open vs closed). Match closedness or use a fallback.`);
    }
    const wa = contourWinding(a.points);
    const wb = contourWinding(b.points);
    if (wa !== wb && wa !== "degenerate" && wb !== "degenerate") {
      report("morph-winding-mismatch", `${location} winding differs (${wa} vs ${wb}). Match the authored winding or use a fallback.`);
    }
    for (let index = 0; index < Math.min(aHoles.length, bHoles.length); index += 1) {
      validatePair(aHoles[index], bHoles[index], `${location} hole ${index}`);
    }
  };
  for (let index = 0; index < Math.min(from.contours.length, to.contours.length); index += 1) {
    validatePair(from.contours[index], to.contours[index], `Contour ${index}`);
  }
  return diagnostics;
}

function morphContour(from: PathContour, to: PathContour, t: number, count: number): PathContour {
  const a = resampleContourLike(from, count);
  const b = resampleContourLike(to, count);
  const n = Math.min(a.length, b.length);
  const points: Vec2[] = [];
  for (let i = 0; i < n; i += 1) points.push(lerpPoint(a[i], b[i], t));

  const result: PathContour = { points, closed: contourIsClosed(from) };
  const fromHoles = from.holes ?? [];
  const toHoles = to.holes ?? [];
  if (fromHoles.length > 0 || toHoles.length > 0) {
    const holes: PathContour[] = [];
    for (let i = 0; i < fromHoles.length; i += 1) {
      const holeCount = Math.max(
        MIN_RESAMPLE_COUNT,
        Math.min(MAX_RESAMPLE_COUNT, fromHoles[i].points.length),
        Math.min(MAX_RESAMPLE_COUNT, toHoles[i]?.points.length ?? 0),
      );
      holes.push(morphContour(fromHoles[i], toHoles[i] ?? fromHoles[i], t, holeCount));
    }
    result.holes = holes;
  }
  return result;
}

/**
 * Morph `from` into `to` at normalized `t` (clamped to `[0, 1]`).
 *
 * When {@link validateMorph} reports any error the shapes are *not* morphed.
 * Instead the documented fallback runs:
 * - `"dissolve"` (default) — source contours for `t < 1`, target contours at
 *   `t >= 1`; the caller owns the cross-fade opacity.
 * - `"cut"` — identical contour hand-off, reported as a hard cut.
 *
 * Both emit a warning so the fallback is visible in diagnostics, never silent.
 * Compatible endpoints return exact authored copies; interior frames are sampled.
 * `resampleCount` must be finite and no greater than 4096, otherwise a RangeError
 * explains how to correct the budget. Positive counts retain the existing floor
 * and minimum of two; nonpositive counts use the default density. Automatic
 * density is capped at 4096 samples per ring.
 */
export function morphShapes(
  from: ContourShape,
  to: ContourShape,
  t: number,
  opts: { fallback?: "dissolve" | "cut"; resampleCount?: number } = {},
): MorphResult {
  const requested = opts.resampleCount;
  if (requested !== undefined && (!Number.isFinite(requested) || requested > MAX_RESAMPLE_COUNT)) {
    throw new RangeError("morphShapes resampleCount must be finite and at most 4096. Omit it for automatic density or provide a smaller finite sample count.");
  }
  const tt = clamp01(t);
  const diagnostics = validateMorph(from, to);
  const errors = diagnostics.filter((d) => d.severity === "error");

  if (errors.length > 0) {
    const mode: MorphMode = opts.fallback ?? "dissolve";
    const code = mode === "cut" ? "morph-fallback-cut" : "morph-fallback-dissolve";
    const used = tt >= 1 ? to : from;
    diagnostics.push(
      createDiagnostic(
        code,
        "warning",
        `Shapes are not morph-compatible; falling back to ${mode} (${used === to ? "target" : "source"} contours).`,
      ),
    );
    return { contours: used.contours.map(copyContour), mode, diagnostics };
  }

  // Endpoint handoffs preserve authored vertices, flags, and nested contours.
  if (tt === 0 || tt === 1) {
    return { contours: (tt === 0 ? from : to).contours.map(copyContour), mode: "morph", diagnostics };
  }

  const count =
    requested !== undefined && requested > 0
      ? Math.max(2, Math.floor(requested))
      : Math.min(MAX_RESAMPLE_COUNT, Math.max(MIN_RESAMPLE_COUNT, shapePointCount(from), shapePointCount(to)));

  const contours = from.contours.map((contour, i) => morphContour(contour, to.contours[i], tt, count));
  return { contours, mode: "morph", diagnostics };
}
