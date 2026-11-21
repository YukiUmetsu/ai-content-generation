/**
 * Geometry kernel for `AdvancedShapeMorph` (registry item `shape-morph`).
 *
 * A ring is an interleaved `Float64Array` `[x0, y0, x1, y1, …]`. It is closed implicitly and has no repeated
 * closing vertex. Screen space has y pointing down, so a positive {@link ringArea} is a clockwise ring on
 * screen. This is the same convention as `contourArea` in `morph.ts`.
 *
 * The morph calls these functions while it builds a plan. The per-frame path does not call them.
 */

import type { Vec2 } from "./types";

export type Ring = Float64Array;

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** A point as an object or as an `[x, y]` tuple. */
export type MorphPoint = Vec2 | readonly [number, number];

function isTuple(point: MorphPoint): point is readonly [number, number] {
  return Array.isArray(point);
}

export function ringFromPoints(points: readonly MorphPoint[]): Ring {
  const ring = new Float64Array(points.length * 2);
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    ring[2 * i] = isTuple(point) ? point[0] : point.x;
    ring[2 * i + 1] = isTuple(point) ? point[1] : point.y;
  }
  return ring;
}

/* ------------------------------------------------------------------ *
 * Measures
 * ------------------------------------------------------------------ */

/** Signed shoelace area. Positive is clockwise on a y-down screen. */
export function ringArea(ring: ArrayLike<number>): number {
  const n = ring.length >> 1;
  if (n < 3) return 0;
  const ox = ring[0];
  const oy = ring[1];
  let sum = 0;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    sum += (ring[2 * j] - ox) * (ring[2 * i + 1] - oy) - (ring[2 * i] - ox) * (ring[2 * j + 1] - oy);
  }
  return sum / 2;
}

export function ringBounds(ring: ArrayLike<number>): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    const x = ring[i];
    const y = ring[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function unionBounds(a: Bounds | null, b: Bounds): Bounds {
  if (!a) return { ...b };
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function boundsDiagonal(bounds: Bounds): number {
  return Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
}

/** Area centroid. A ring with no area uses the mean of its vertices. */
export function ringCentroid(ring: ArrayLike<number>): Vec2 {
  const n = ring.length >> 1;
  if (n === 0) return { x: 0, y: 0 };
  const ox = ring[0];
  const oy = ring[1];
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const x0 = ring[2 * j] - ox;
    const y0 = ring[2 * j + 1] - oy;
    const x1 = ring[2 * i] - ox;
    const y1 = ring[2 * i + 1] - oy;
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(area) > 1e-12) return { x: ox + cx / (3 * area), y: oy + cy / (3 * area) };
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i += 1) {
    sx += ring[2 * i];
    sy += ring[2 * i + 1];
  }
  return { x: sx / n, y: sy / n };
}

export function reverseRing(ring: Ring): Ring {
  const n = ring.length >> 1;
  const out = new Float64Array(ring.length);
  for (let i = 0; i < n; i += 1) {
    out[2 * i] = ring[2 * (n - 1 - i)];
    out[2 * i + 1] = ring[2 * (n - 1 - i) + 1];
  }
  return out;
}

/** Return the ring with the requested sign of area: `1` positive (outer), `-1` negative (hole). */
export function orientRing(ring: Ring, sign: 1 | -1): Ring {
  return Math.sign(ringArea(ring)) === -sign ? reverseRing(ring) : ring;
}

/**
 * Remove nonfinite vertices, consecutive duplicates and a repeated closing vertex. The result is a copy.
 */
export function sanitizeRing(source: ArrayLike<number>, epsilon: number): { ring: Ring; nonFinite: number } {
  const n = source.length >> 1;
  const out = new Float64Array(n * 2);
  let m = 0;
  let nonFinite = 0;
  for (let i = 0; i < n; i += 1) {
    const x = source[2 * i];
    const y = source[2 * i + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      nonFinite += 1;
      continue;
    }
    if (m > 0 && Math.abs(x - out[2 * m - 2]) <= epsilon && Math.abs(y - out[2 * m - 1]) <= epsilon) continue;
    out[2 * m] = x;
    out[2 * m + 1] = y;
    m += 1;
  }
  while (m > 1 && Math.abs(out[0] - out[2 * m - 2]) <= epsilon && Math.abs(out[1] - out[2 * m - 1]) <= epsilon) m -= 1;
  return { ring: out.slice(0, 2 * m), nonFinite };
}

/* ------------------------------------------------------------------ *
 * Containment and distance
 * ------------------------------------------------------------------ */

/** Even-odd point-in-ring test. The orientation of the ring does not matter. */
export function pointInRing(x: number, y: number, ring: ArrayLike<number>): boolean {
  const n = ring.length >> 1;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = ring[2 * i];
    const yi = ring[2 * i + 1];
    const xj = ring[2 * j];
    const yj = ring[2 * j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segmentDistanceSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq > 0 ? ((px - ax) * dx + (py - ay) * dy) / lengthSq : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const ex = ax + dx * t - px;
  const ey = ay + dy * t - py;
  return ex * ex + ey * ey;
}

function ringDistanceSq(x: number, y: number, ring: ArrayLike<number>): number {
  const n = ring.length >> 1;
  let best = Infinity;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const d = segmentDistanceSq(x, y, ring[2 * j], ring[2 * j + 1], ring[2 * i], ring[2 * i + 1]);
    if (d < best) best = d;
  }
  return best;
}

/** True when the point is inside the outer ring and outside every hole. */
export function pointInPolygon(x: number, y: number, outer: ArrayLike<number>, holes: readonly ArrayLike<number>[]): boolean {
  if (!pointInRing(x, y, outer)) return false;
  for (const hole of holes) if (pointInRing(x, y, hole)) return false;
  return true;
}

/** Distance to the nearest edge: positive inside the filled region, negative outside it. */
export function polygonSignedDistance(x: number, y: number, outer: ArrayLike<number>, holes: readonly ArrayLike<number>[]): number {
  let best = ringDistanceSq(x, y, outer);
  for (const hole of holes) best = Math.min(best, ringDistanceSq(x, y, hole));
  const distance = Math.sqrt(best);
  return pointInPolygon(x, y, outer, holes) ? distance : -distance;
}

/**
 * The interior point farthest from every edge (pole of inaccessibility), found by a deterministic
 * shrinking grid search. A seed at this point stays inside the fill while a part grows from it.
 */
export function poleOfInaccessibility(outer: ArrayLike<number>, holes: readonly ArrayLike<number>[]): Vec2 {
  const bounds = ringBounds(outer);
  const GRID = 12;
  const centroid = ringCentroid(outer);
  let best = centroid;
  let bestDistance = polygonSignedDistance(centroid.x, centroid.y, outer, holes);
  let cx = (bounds.minX + bounds.maxX) / 2;
  let cy = (bounds.minY + bounds.maxY) / 2;
  let halfW = (bounds.maxX - bounds.minX) / 2;
  let halfH = (bounds.maxY - bounds.minY) / 2;
  for (let round = 0; round < 5; round += 1) {
    for (let gy = 0; gy < GRID; gy += 1) {
      for (let gx = 0; gx < GRID; gx += 1) {
        const x = cx - halfW + (2 * halfW * (gx + 0.5)) / GRID;
        const y = cy - halfH + (2 * halfH * (gy + 0.5)) / GRID;
        const d = polygonSignedDistance(x, y, outer, holes);
        if (d > bestDistance) {
          bestDistance = d;
          best = { x, y };
        }
      }
    }
    cx = best.x;
    cy = best.y;
    halfW = (2 * halfW) / GRID;
    halfH = (2 * halfH) / GRID;
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * Arc length
 * ------------------------------------------------------------------ */

/** Cumulative edge lengths: `table[i]` is the length from vertex 0 to vertex i; `table[n]` is the perimeter. */
export function arcTable(ring: ArrayLike<number>): Float64Array {
  const n = ring.length >> 1;
  const table = new Float64Array(n + 1);
  for (let i = 1; i <= n; i += 1) {
    const a = i - 1;
    const b = i % n;
    table[i] = table[i - 1] + Math.hypot(ring[2 * b] - ring[2 * a], ring[2 * b + 1] - ring[2 * a + 1]);
  }
  return table;
}

/** Write the point at normalized arc-length parameter `u` (wraps around) into `out[offset]`. */
export function pointAtParam(ring: ArrayLike<number>, table: Float64Array, u: number, out: Float64Array, offset: number): void {
  const n = ring.length >> 1;
  const perimeter = table[n];
  if (n === 1 || !(perimeter > 0)) {
    out[offset] = ring[0];
    out[offset + 1] = ring[1];
    return;
  }
  const s = (u - Math.floor(u)) * perimeter;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (table[mid] <= s) lo = mid;
    else hi = mid - 1;
  }
  const length = table[lo + 1] - table[lo];
  const f = length > 0 ? (s - table[lo]) / length : 0;
  const next = (lo + 1) % n;
  out[offset] = ring[2 * lo] + (ring[2 * next] - ring[2 * lo]) * f;
  out[offset + 1] = ring[2 * lo + 1] + (ring[2 * next + 1] - ring[2 * lo + 1]) * f;
}

/** Normalized arc-length parameter of the ring point nearest to (x, y), and its distance. */
export function projectOntoRing(ring: ArrayLike<number>, table: Float64Array, x: number, y: number): { u: number; distance: number } {
  const n = ring.length >> 1;
  let bestDistanceSq = Infinity;
  let bestS = 0;
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const ax = ring[2 * i];
    const ay = ring[2 * i + 1];
    const dx = ring[2 * j] - ax;
    const dy = ring[2 * j + 1] - ay;
    const lengthSq = dx * dx + dy * dy;
    let t = lengthSq > 0 ? ((x - ax) * dx + (y - ay) * dy) / lengthSq : 0;
    t = Math.min(1, Math.max(0, t));
    const ex = ax + dx * t - x;
    const ey = ay + dy * t - y;
    const d = ex * ex + ey * ey;
    if (d < bestDistanceSq) {
      bestDistanceSq = d;
      bestS = table[i] + t * (table[i + 1] - table[i]);
    }
  }
  const perimeter = table[n];
  return { u: perimeter > 0 ? (bestS / perimeter) % 1 : 0, distance: Math.sqrt(bestDistanceSq) };
}

/* ------------------------------------------------------------------ *
 * SVG path data
 * ------------------------------------------------------------------ */

export type SvgPathSegment =
  | { kind: "M"; x: number; y: number }
  | { kind: "L"; x: number; y: number }
  | { kind: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { kind: "Q"; x1: number; y1: number; x: number; y: number }
  | { kind: "A"; rx: number; ry: number; rotation: number; large: boolean; sweep: boolean; x: number; y: number }
  | { kind: "Z" };

const MAX_PATH_CHARACTERS = 2_000_000;
const MAX_PATH_SEGMENTS = 200_000;
const MAX_FLATTEN_STEPS = 512;
const PATH_COMMANDS = "MmLlHhVvCcSsQqTtAaZz";
const PATH_NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

/**
 * Parse SVG path data into absolute segments. It supports every path command, relative and absolute forms,
 * implicit repeats and compact arc flags. On malformed data it returns the segments before the error and
 * the error text; it does not throw.
 */
export function parseSvgPath(d: string): { segments: SvgPathSegment[]; error?: string } {
  const segments: SvgPathSegment[] = [];
  if (d.length > MAX_PATH_CHARACTERS) return { segments, error: `Path data is longer than ${MAX_PATH_CHARACTERS} characters.` };
  let i = 0;
  let command = "";
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let controlX = 0;
  let controlY = 0;
  let previous = "";
  let open = false;

  const skip = (): void => {
    while (i < d.length) {
      const c = d.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 44) i += 1;
      else break;
    }
  };
  const startsNumber = (): boolean => {
    skip();
    const c = d[i];
    return c !== undefined && ((c >= "0" && c <= "9") || c === "-" || c === "+" || c === ".");
  };
  const num = (): number => {
    skip();
    PATH_NUMBER.lastIndex = i;
    const match = PATH_NUMBER.exec(d);
    if (!match) throw new SyntaxError(`Expected a number at character ${i}.`);
    i = PATH_NUMBER.lastIndex;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) throw new SyntaxError(`Number out of range at character ${i}.`);
    return value;
  };
  const flag = (): boolean => {
    skip();
    const c = d[i];
    if (c === "0" || c === "1") {
      i += 1;
      return c === "1";
    }
    throw new SyntaxError(`Expected an arc flag (0 or 1) at character ${i}.`);
  };

  try {
    for (;;) {
      skip();
      if (i >= d.length) break;
      const c = d[i];
      if (PATH_COMMANDS.includes(c)) {
        command = c;
        i += 1;
      } else if (!command) {
        throw new SyntaxError(`Path data must start with a command; found '${c}'.`);
      } else if (!startsNumber()) {
        throw new SyntaxError(`Unexpected character '${c}' at character ${i}.`);
      }
      const relative = command >= "a";
      const upper = command.toUpperCase();
      if (upper === "Z") {
        if (open) segments.push({ kind: "Z" });
        open = false;
        x = startX;
        y = startY;
        previous = "Z";
        command = "";
        continue;
      }
      if (!open && upper !== "M") {
        if (segments.length === 0) throw new SyntaxError("Path data must start with a move command (M or m).");
        segments.push({ kind: "M", x, y });
        startX = x;
        startY = y;
        open = true;
      }
      const ox = relative ? x : 0;
      const oy = relative ? y : 0;
      switch (upper) {
        case "M":
          x = num() + ox;
          y = num() + oy;
          segments.push({ kind: "M", x, y });
          startX = x;
          startY = y;
          open = true;
          command = relative ? "l" : "L";
          break;
        case "L":
          x = num() + ox;
          y = num() + oy;
          segments.push({ kind: "L", x, y });
          break;
        case "H":
          x = num() + ox;
          segments.push({ kind: "L", x, y });
          break;
        case "V":
          y = num() + oy;
          segments.push({ kind: "L", x, y });
          break;
        case "C":
        case "S": {
          let x1 = x;
          let y1 = y;
          if (upper === "C") {
            x1 = num() + ox;
            y1 = num() + oy;
          } else if (previous === "C" || previous === "S") {
            x1 = 2 * x - controlX;
            y1 = 2 * y - controlY;
          }
          const x2 = num() + ox;
          const y2 = num() + oy;
          const ex = num() + ox;
          const ey = num() + oy;
          segments.push({ kind: "C", x1, y1, x2, y2, x: ex, y: ey });
          controlX = x2;
          controlY = y2;
          x = ex;
          y = ey;
          break;
        }
        case "Q":
        case "T": {
          let x1 = x;
          let y1 = y;
          if (upper === "Q") {
            x1 = num() + ox;
            y1 = num() + oy;
          } else if (previous === "Q" || previous === "T") {
            x1 = 2 * x - controlX;
            y1 = 2 * y - controlY;
          }
          const ex = num() + ox;
          const ey = num() + oy;
          segments.push({ kind: "Q", x1, y1, x: ex, y: ey });
          controlX = x1;
          controlY = y1;
          x = ex;
          y = ey;
          break;
        }
        case "A": {
          const rx = num();
          const ry = num();
          const rotation = num();
          const large = flag();
          const sweep = flag();
          x = num() + ox;
          y = num() + oy;
          segments.push({ kind: "A", rx, ry, rotation, large, sweep, x, y });
          break;
        }
        default:
          throw new SyntaxError(`Unsupported command '${command}'.`);
      }
      previous = upper === "M" ? "M" : upper;
      if (segments.length > MAX_PATH_SEGMENTS) throw new RangeError(`Path data has more than ${MAX_PATH_SEGMENTS} segments.`);
    }
  } catch (error) {
    return { segments, error: error instanceof Error ? error.message : String(error) };
  }
  return { segments };
}

function pushArc(
  points: number[], x0: number, y0: number, rxIn: number, ryIn: number, rotationDeg: number,
  large: boolean, sweep: boolean, x1: number, y1: number, tolerance: number,
): void {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0 || (x0 === x1 && y0 === y1)) {
    points.push(x1, y1);
    return;
  }
  const phi = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x0 - x1) / 2;
  const dy = (y0 - y1) / 2;
  const xp = cos * dx + sin * dy;
  const yp = -sin * dx + cos * dy;
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const numerator = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const denominator = rx * rx * yp * yp + ry * ry * xp * xp;
  const coefficient = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, numerator / denominator));
  const cxp = (coefficient * rx * yp) / ry;
  const cyp = (-coefficient * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x0 + x1) / 2;
  const cy = sin * cxp + cos * cyp + (y0 + y1) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta = angle(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let delta = angle((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const radius = Math.max(rx, ry);
  const step = tolerance < radius ? 2 * Math.acos(1 - tolerance / radius) : Math.PI / 2;
  const steps = Math.min(MAX_FLATTEN_STEPS, Math.max(1, Math.ceil(Math.abs(delta) / Math.max(step, 1e-3))));
  for (let k = 1; k <= steps; k += 1) {
    if (k === steps) {
      points.push(x1, y1);
      break;
    }
    const a = theta + (delta * k) / steps;
    const ex = rx * Math.cos(a);
    const ey = ry * Math.sin(a);
    points.push(cx + cos * ex - sin * ey, cy + sin * ex + cos * ey);
  }
}

/**
 * Flatten parsed segments into rings. Curve step counts come from Wang's formula, so the chord error stays
 * below `tolerance`. Every subpath becomes a ring because a fill closes open subpaths.
 */
export function flattenSvgPath(segments: readonly SvgPathSegment[], tolerance: number): Ring[] {
  const rings: Ring[] = [];
  let points: number[] = [];
  let x = 0;
  let y = 0;
  const flush = (): void => {
    if (points.length >= 6) rings.push(Float64Array.from(points));
    points = [];
  };
  const tol = Math.max(tolerance, 1e-9);
  for (const segment of segments) {
    switch (segment.kind) {
      case "M":
        flush();
        points.push(segment.x, segment.y);
        x = segment.x;
        y = segment.y;
        break;
      case "L":
        points.push(segment.x, segment.y);
        x = segment.x;
        y = segment.y;
        break;
      case "C": {
        const m1 = Math.hypot(x - 2 * segment.x1 + segment.x2, y - 2 * segment.y1 + segment.y2);
        const m2 = Math.hypot(segment.x1 - 2 * segment.x2 + segment.x, segment.y1 - 2 * segment.y2 + segment.y);
        const steps = Math.min(MAX_FLATTEN_STEPS, Math.max(1, Math.ceil(Math.sqrt((0.75 * Math.max(m1, m2)) / tol))));
        for (let k = 1; k <= steps; k += 1) {
          const t = k / steps;
          const m = 1 - t;
          const a = m * m * m;
          const b = 3 * m * m * t;
          const c = 3 * m * t * t;
          const e = t * t * t;
          points.push(
            a * x + b * segment.x1 + c * segment.x2 + e * segment.x,
            a * y + b * segment.y1 + c * segment.y2 + e * segment.y,
          );
        }
        x = segment.x;
        y = segment.y;
        break;
      }
      case "Q": {
        const m = Math.hypot(x - 2 * segment.x1 + segment.x, y - 2 * segment.y1 + segment.y);
        const steps = Math.min(MAX_FLATTEN_STEPS, Math.max(1, Math.ceil(Math.sqrt((0.25 * m) / tol))));
        for (let k = 1; k <= steps; k += 1) {
          const t = k / steps;
          const u = 1 - t;
          points.push(u * u * x + 2 * u * t * segment.x1 + t * t * segment.x, u * u * y + 2 * u * t * segment.y1 + t * t * segment.y);
        }
        x = segment.x;
        y = segment.y;
        break;
      }
      case "A":
        pushArc(points, x, y, segment.rx, segment.ry, segment.rotation, segment.large, segment.sweep, segment.x, segment.y, tol);
        x = segment.x;
        y = segment.y;
        break;
      case "Z":
        flush();
        break;
    }
  }
  flush();
  return rings;
}

/** Bounds of every endpoint and control point. The flattener uses it to scale its default tolerance. */
export function svgSegmentBounds(segments: readonly SvgPathSegment[]): Bounds | null {
  let bounds: Bounds | null = null;
  const add = (x: number, y: number): void => {
    bounds = unionBounds(bounds, { minX: x, minY: y, maxX: x, maxY: y });
  };
  for (const segment of segments) {
    if (segment.kind === "Z") continue;
    add(segment.x, segment.y);
    if (segment.kind === "C") {
      add(segment.x1, segment.y1);
      add(segment.x2, segment.y2);
    } else if (segment.kind === "Q") {
      add(segment.x1, segment.y1);
    }
  }
  return bounds;
}

/* ------------------------------------------------------------------ *
 * Nesting
 * ------------------------------------------------------------------ */

export interface NestedPolygon {
  /** Positive area (clockwise on screen). */
  outer: Ring;
  /** Negative area (counter-clockwise on screen). */
  holes: Ring[];
}

function ringContains(container: Ring, containerBounds: Bounds, inner: Ring, innerBounds: Bounds): boolean {
  if (
    innerBounds.minX < containerBounds.minX || innerBounds.maxX > containerBounds.maxX ||
    innerBounds.minY < containerBounds.minY || innerBounds.maxY > containerBounds.maxY
  ) return false;
  const n = inner.length >> 1;
  const samples = Math.min(n, 9);
  let inside = 0;
  for (let k = 0; k < samples; k += 1) {
    const i = Math.floor((k * n) / samples);
    if (pointInRing(inner[2 * i], inner[2 * i + 1], container)) inside += 1;
  }
  return inside * 2 > samples;
}

/**
 * Sort rings into filled polygons with holes. `evenodd` uses containment depth. `nonzero` also uses winding,
 * so a nested ring with the same direction as its container stays filled. Rings that do not change the fill
 * are dropped. A ring inside a hole starts a new polygon (an island).
 */
export function nestRings(rings: readonly Ring[], fillRule: "nonzero" | "evenodd"): NestedPolygon[] {
  const items = rings
    .map((ring, index) => ({ ring, index, area: ringArea(ring), bounds: ringBounds(ring) }))
    .sort((a, b) => Math.abs(b.area) - Math.abs(a.area) || a.index - b.index);
  const parent = new Int32Array(items.length).fill(-1);
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i - 1; j >= 0; j -= 1) {
      if (ringContains(items[j].ring, items[j].bounds, items[i].ring, items[i].bounds)) {
        parent[i] = j;
        break;
      }
    }
  }
  const winding = new Int32Array(items.length);
  const filled = new Uint8Array(items.length);
  const polygonOf = new Int32Array(items.length).fill(-1);
  const polygons: NestedPolygon[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const p = parent[i];
    if (fillRule === "evenodd") {
      winding[i] = p < 0 ? 0 : winding[p] + 1;
      filled[i] = winding[i] % 2 === 0 ? 1 : 0;
    } else {
      winding[i] = (p < 0 ? 0 : winding[p]) + Math.sign(items[i].area);
      filled[i] = winding[i] !== 0 ? 1 : 0;
    }
    const parentFilled = p >= 0 && filled[p] === 1;
    if (filled[i] && !parentFilled) {
      polygonOf[i] = polygons.length;
      polygons.push({ outer: orientRing(items[i].ring, 1), holes: [] });
    } else if (!filled[i] && parentFilled) {
      let ancestor = p;
      while (ancestor >= 0 && polygonOf[ancestor] < 0) ancestor = parent[ancestor];
      if (ancestor >= 0) polygons[polygonOf[ancestor]].holes.push(orientRing(items[i].ring, -1));
    }
  }
  return polygons;
}

/* ------------------------------------------------------------------ *
 * Straight cuts (partition)
 * ------------------------------------------------------------------ */

/** Area of the part of a simple ring where `nx·x + ny·y < c` (Sutherland–Hodgman, accumulated). */
export function areaBelowLine(ring: ArrayLike<number>, nx: number, ny: number, c: number): number {
  const n = ring.length >> 1;
  let firstX = 0;
  let firstY = 0;
  let lastX = 0;
  let lastY = 0;
  let started = false;
  let sum = 0;
  const emit = (x: number, y: number): void => {
    if (!started) {
      firstX = x;
      firstY = y;
      started = true;
    } else {
      sum += lastX * y - x * lastY;
    }
    lastX = x;
    lastY = y;
  };
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const ax = ring[2 * i];
    const ay = ring[2 * i + 1];
    const bx = ring[2 * j];
    const by = ring[2 * j + 1];
    const da = nx * ax + ny * ay - c;
    const db = nx * bx + ny * by - c;
    if (da < 0 !== db < 0) {
      const t = da / (da - db);
      emit(ax + (bx - ax) * t, ay + (by - ay) * t);
    }
    if (db < 0) emit(bx, by);
  }
  if (!started) return 0;
  sum += lastX * firstY - firstX * lastY;
  return Math.abs(sum / 2);
}

/**
 * Split a simple ring along the line `nx·x + ny·y = c` into separate rings on each side. Crossings are
 * paired in order along the line, so a concave ring gives several clean pieces with no bridge edges.
 * `overlap` moves each piece's cut vertices across the line by that distance, so neighbouring pieces
 * overlap by a hairline and a renderer shows no seam where they touch. Returns `null` when the crossings
 * cannot be paired.
 */
export function splitRingByLine(ring: Ring, nx: number, ny: number, c: number, overlap = 0): { below: Ring[]; above: Ring[] } | null {
  const n = ring.length >> 1;
  const scale = boundsDiagonal(ringBounds(ring)) || 1;
  const epsilon = scale * 1e-12;
  const side = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const d = nx * ring[2 * i] + ny * ring[2 * i + 1] - c;
    side[i] = Math.abs(d) < epsilon ? epsilon : d;
  }
  const xs: number[] = [];
  const ys: number[] = [];
  const isCrossing: boolean[] = [];
  const below: boolean[] = [];
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    xs.push(ring[2 * i]);
    ys.push(ring[2 * i + 1]);
    isCrossing.push(false);
    below.push(side[i] < 0);
    if (side[i] < 0 !== side[j] < 0) {
      const t = side[i] / (side[i] - side[j]);
      xs.push(ring[2 * i] + (ring[2 * j] - ring[2 * i]) * t);
      ys.push(ring[2 * i + 1] + (ring[2 * j + 1] - ring[2 * i + 1]) * t);
      isCrossing.push(true);
      below.push(false);
    }
  }
  const crossings: number[] = [];
  for (let k = 0; k < xs.length; k += 1) if (isCrossing[k]) crossings.push(k);
  if (crossings.length === 0) return side[0] < 0 ? { below: [ring], above: [] } : { below: [], above: [ring] };
  if (crossings.length % 2 !== 0) return null;
  const tx = -ny;
  const ty = nx;
  crossings.sort((a, b) => tx * xs[a] + ty * ys[a] - (tx * xs[b] + ty * ys[b]));
  const partner = new Int32Array(xs.length).fill(-1);
  for (let k = 0; k < crossings.length; k += 2) {
    partner[crossings[k]] = crossings[k + 1];
    partner[crossings[k + 1]] = crossings[k];
  }
  const count = xs.length;
  const visited = new Uint8Array(count);
  const result = { below: [] as Ring[], above: [] as Ring[] };
  for (let start = 0; start < count; start += 1) {
    if (isCrossing[start] || visited[start]) continue;
    const piece: number[] = [];
    const push = below[start] ? overlap : -overlap;
    let k = start;
    let guard = 0;
    do {
      visited[k] = 1;
      if (isCrossing[k]) {
        const jump = partner[k];
        piece.push(xs[k] + nx * push, ys[k] + ny * push, xs[jump] + nx * push, ys[jump] + ny * push);
        k = (jump + 1) % count;
      } else {
        piece.push(xs[k], ys[k]);
        k = (k + 1) % count;
      }
      guard += 1;
      if (guard > count * 2 + 4) return null;
    } while (k !== start);
    const pieceRing = sanitizeRing(piece, epsilon).ring;
    if (pieceRing.length >= 6 && Math.abs(ringArea(pieceRing)) > epsilon * scale) {
      (below[start] ? result.below : result.above).push(pieceRing);
    }
  }
  return result;
}

/** Unit direction of the largest spread of a point set, or `null` when the points coincide. */
export function principalAxis(points: readonly Vec2[]): Vec2 | null {
  if (points.length < 2) return null;
  let mx = 0;
  let my = 0;
  for (const p of points) {
    mx += p.x;
    my += p.y;
  }
  mx /= points.length;
  my /= points.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  if (sxx + syy < 1e-18) return null;
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

export interface PartitionTarget {
  id: number;
  /** Share of the area that this target receives. */
  weight: number;
  /** Where the target sits, in the frame of the rings that are cut. */
  x: number;
  y: number;
}

function ringVertices(rings: readonly Ring[]): Vec2[] {
  const out: Vec2[] = [];
  for (const ring of rings) for (let i = 0; i < ring.length; i += 2) out.push({ x: ring[i], y: ring[i + 1] });
  return out;
}

/**
 * Cut hole-free rings into one group per target with recursive, area-balanced straight cuts. Each cut is
 * perpendicular to the direction in which the targets spread, so every piece travels a short way. `overlap`
 * is passed to {@link splitRingByLine}. Returns `null` when a cut fails; the caller then uses another strategy.
 */
export function partitionRings(rings: readonly Ring[], targets: readonly PartitionTarget[], overlap = 0): Map<number, Ring[]> | null {
  if (targets.length === 0 || rings.length === 0) return null;
  if (targets.length === 1) return new Map([[targets[0].id, [...rings]]]);
  const axis = principalAxis(targets) ?? principalAxis(ringVertices(rings));
  if (!axis) return null;
  const sorted = [...targets].sort((a, b) => axis.x * a.x + axis.y * a.y - (axis.x * b.x + axis.y * b.y) || a.id - b.id);
  const split = Math.floor(sorted.length / 2);
  const left = sorted.slice(0, split);
  const right = sorted.slice(split);
  const totalWeight = sorted.reduce((sum, target) => sum + Math.max(target.weight, 0), 0);
  const fraction = totalWeight > 0 ? left.reduce((sum, target) => sum + Math.max(target.weight, 0), 0) / totalWeight : split / sorted.length;
  const totalArea = rings.reduce((sum, ring) => sum + Math.abs(ringArea(ring)), 0);
  let lo = Infinity;
  let hi = -Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 2) {
      const projection = axis.x * ring[i] + axis.y * ring[i + 1];
      if (projection < lo) lo = projection;
      if (projection > hi) hi = projection;
    }
  }
  const goal = fraction * totalArea;
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const mid = (lo + hi) / 2;
    let area = 0;
    for (const ring of rings) area += areaBelowLine(ring, axis.x, axis.y, mid);
    if (area < goal) lo = mid;
    else hi = mid;
  }
  const cut = (lo + hi) / 2;
  const below: Ring[] = [];
  const above: Ring[] = [];
  for (const ring of rings) {
    const parts = splitRingByLine(ring, axis.x, axis.y, cut, overlap);
    if (!parts) return null;
    below.push(...parts.below);
    above.push(...parts.above);
  }
  if (below.length === 0 || above.length === 0) return null;
  const leftMap = partitionRings(below, left, overlap);
  const rightMap = partitionRings(above, right, overlap);
  if (!leftMap || !rightMap) return null;
  for (const [id, pieces] of rightMap) leftMap.set(id, pieces);
  return leftMap;
}

/* ------------------------------------------------------------------ *
 * Crossing detection
 * ------------------------------------------------------------------ */

/**
 * Count proper edge crossings among the given rings, including crossings between different rings.
 * Adjacent edges of one ring and touching endpoints do not count. A sweep over x keeps the work near
 * O(n log n) for ordinary contours. The count stops at `limit`.
 */
export function countCrossings(rings: readonly ArrayLike<number>[], limit: number): number {
  let total = 0;
  for (const ring of rings) if (ring.length >= 6) total += ring.length >> 1;
  if (total === 0) return 0;
  const ringOf = new Int32Array(total);
  const indexOf = new Int32Array(total);
  const sizeOf = new Int32Array(total);
  const ax = new Float64Array(total);
  const ay = new Float64Array(total);
  const bx = new Float64Array(total);
  const by = new Float64Array(total);
  let e = 0;
  rings.forEach((ring, r) => {
    const n = ring.length >> 1;
    if (n < 3) return;
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      ringOf[e] = r;
      indexOf[e] = i;
      sizeOf[e] = n;
      ax[e] = ring[2 * i];
      ay[e] = ring[2 * i + 1];
      bx[e] = ring[2 * j];
      by[e] = ring[2 * j + 1];
      e += 1;
    }
  });
  const order = Array.from({ length: total }, (_, k) => k).sort((p, q) => Math.min(ax[p], bx[p]) - Math.min(ax[q], bx[q]));
  const orient = (px: number, py: number, qx: number, qy: number, rx: number, ry: number): number =>
    (qx - px) * (ry - py) - (qy - py) * (rx - px);
  let active: number[] = [];
  let count = 0;
  for (const edge of order) {
    const minX = Math.min(ax[edge], bx[edge]);
    active = active.filter((other) => Math.max(ax[other], bx[other]) >= minX);
    const minY = Math.min(ay[edge], by[edge]);
    const maxY = Math.max(ay[edge], by[edge]);
    for (const other of active) {
      if (ringOf[other] === ringOf[edge]) {
        const gap = Math.abs(indexOf[other] - indexOf[edge]);
        if (gap === 1 || gap === sizeOf[edge] - 1) continue;
      }
      if (Math.max(ay[other], by[other]) < minY || Math.min(ay[other], by[other]) > maxY) continue;
      const o1 = orient(ax[edge], ay[edge], bx[edge], by[edge], ax[other], ay[other]);
      const o2 = orient(ax[edge], ay[edge], bx[edge], by[edge], bx[other], by[other]);
      if (!(o1 * o2 < 0)) continue;
      const o3 = orient(ax[other], ay[other], bx[other], by[other], ax[edge], ay[edge]);
      const o4 = orient(ax[other], ay[other], bx[other], by[other], bx[edge], by[edge]);
      if (o3 * o4 < 0) {
        count += 1;
        if (count >= limit) return count;
      }
    }
    active.push(edge);
  }
  return count;
}

/* ------------------------------------------------------------------ *
 * Assignment
 * ------------------------------------------------------------------ */

/**
 * Minimum-cost assignment (Hungarian method with potentials, O(n²m)). `cost[row][column]`. Returns the
 * column of each row, or -1 for a row without a column when there are more rows than columns.
 */
export function solveAssignment(cost: readonly (readonly number[])[]): Int32Array {
  const rows = cost.length;
  const columns = rows > 0 ? cost[0].length : 0;
  const result = new Int32Array(rows).fill(-1);
  if (rows === 0 || columns === 0) return result;
  const transpose = rows > columns;
  const n = transpose ? columns : rows;
  const m = transpose ? rows : columns;
  const at = (i: number, j: number): number => (transpose ? cost[j][i] : cost[i][j]);
  const u = new Float64Array(n + 1);
  const v = new Float64Array(m + 1);
  const p = new Int32Array(m + 1);
  const way = new Int32Array(m + 1);
  for (let i = 1; i <= n; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minimum = new Float64Array(m + 1).fill(Infinity);
    const used = new Uint8Array(m + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j += 1) {
        if (used[j]) continue;
        const current = at(i0 - 1, j - 1) - u[i0] - v[j];
        if (current < minimum[j]) {
          minimum[j] = current;
          way[j] = j0;
        }
        if (minimum[j] < delta) {
          delta = minimum[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j += 1) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minimum[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }
  for (let j = 1; j <= m; j += 1) {
    if (p[j] === 0) continue;
    if (transpose) result[j - 1] = p[j] - 1;
    else result[p[j] - 1] = j - 1;
  }
  return result;
}

/* ------------------------------------------------------------------ *
 * Mean value coordinates
 * ------------------------------------------------------------------ */

/**
 * Mean value coordinates (Floater 2003) of (x, y) relative to a closed cage. The weights sum to one and
 * reproduce the point exactly. They are written to `out[offset … offset + n)`. Returns `false` when the
 * weights are not stable.
 */
export function meanValueCoordinates(cage: ArrayLike<number>, x: number, y: number, out: Float32Array | Float64Array, offset: number): boolean {
  const n = cage.length >> 1;
  if (n < 3) return false;
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  const r = new Float64Array(n);
  for (let j = 0; j < n; j += 1) {
    dx[j] = cage[2 * j] - x;
    dy[j] = cage[2 * j + 1] - y;
    r[j] = Math.hypot(dx[j], dy[j]);
    if (r[j] < 1e-9) {
      for (let k = 0; k < n; k += 1) out[offset + k] = k === j ? 1 : 0;
      return true;
    }
  }
  const tanHalf = new Float64Array(n);
  for (let j = 0; j < n; j += 1) {
    const k = (j + 1) % n;
    const cross = dx[j] * dy[k] - dy[j] * dx[k];
    const dot = dx[j] * dx[k] + dy[j] * dy[k];
    if (Math.abs(cross) <= 1e-12 * r[j] * r[k]) {
      if (dot < 0) return false;
      tanHalf[j] = 0;
    } else {
      tanHalf[j] = (r[j] * r[k] - dot) / cross;
    }
  }
  let sum = 0;
  for (let j = 0; j < n; j += 1) {
    const w = (tanHalf[(j + n - 1) % n] + tanHalf[j]) / r[j];
    out[offset + j] = w;
    sum += w;
  }
  if (!Number.isFinite(sum) || Math.abs(sum) < 1e-12) return false;
  for (let j = 0; j < n; j += 1) out[offset + j] /= sum;
  return true;
}
