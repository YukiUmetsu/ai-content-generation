/**
 * `AdvancedShapeMorph` — topology-aware morphing between unrelated shapes (registry item `shape-morph`).
 *
 * `morphShapes` in `morph.ts` refuses a pair whose contour structure differs. This class accepts any two
 * shapes: different vertex counts, several disjoint parts, and different numbers of holes. The constructor
 * plans the whole transition once: it parses, nests rings into parts and holes, matches parts and holes,
 * builds ring correspondence, and checks sampled frames for crossings. `update(t)` then writes each frame
 * into preallocated typed arrays with a fixed amount of arithmetic and no allocation.
 *
 * The class has no renderer. Use `traceMorphFrame` for Canvas 2D or `Path2D`, `morphFrameToSvgPaths` for
 * SVG, or read the `Float32Array` buffers directly for WebGL or Three.js.
 *
 * Fill all opaque parts of a frame in one path with the `nonzero` rule. Outer rings are clockwise on screen
 * and holes are counter-clockwise, so parts that overlap during the transition form a union without seams.
 */

import { createDiagnostic } from "./diagnostics";
import { cubicBezier, evaluateEasing } from "./easing";
import type { ContourShape, PathContour } from "./morph";
import type { Diagnostic, EasingSpec, Vec2 } from "./types";
import {
  arcTable, boundsDiagonal, countCrossings, flattenSvgPath, meanValueCoordinates, nestRings, orientRing,
  parseSvgPath, partitionRings, pointAtParam, pointInPolygon, poleOfInaccessibility, projectOntoRing,
  ringArea, ringBounds, ringCentroid, ringFromPoints, sanitizeRing, solveAssignment, svgSegmentBounds,
  unionBounds,
} from "./advanced-morph-geometry";
import type { Bounds, MorphPoint, NestedPolygon, Ring } from "./advanced-morph-geometry";

export type { MorphPoint } from "./advanced-morph-geometry";

/* ------------------------------------------------------------------ *
 * Public types
 * ------------------------------------------------------------------ */

/**
 * A shape to morph:
 * - SVG path data (every command, several subpaths; nesting and `fillRule` decide holes);
 * - a `ContourShape` from `morph.ts` (holes are explicit);
 * - one ring of points;
 * - several rings of points (nesting and `fillRule` decide holes).
 */
export type MorphShapeInput =
  | string
  | ContourShape
  | readonly MorphPoint[]
  | readonly (readonly MorphPoint[])[];

/**
 * How parts without a partner appear or disappear.
 * - `cross-dissolve`: the extra part fades and shrinks slightly; matched parts morph.
 * - `emerge`: the extra part grows from (or shrinks into) a point inside itself.
 * - `split-merge`: the extra part comes out of (or goes into) a copy of the nearest part on the other side.
 * - `partition`: the nearest part is cut into area-balanced pieces with straight cuts, one per partner, so the
 *   shape physically breaks apart or fuses. A part with holes uses `split-merge` instead.
 *
 * Holes without a partner always grow from or shrink into a point inside the fill, because a hole cannot
 * fade on its own in a single fill.
 */
export type MorphTopologyStrategy = "cross-dissolve" | "emerge" | "split-merge" | "partition";

export interface MorphAnchorPair {
  /** A point on a source contour. */
  from: Vec2;
  /** The target contour point that `from` travels to. */
  to: Vec2;
}

export interface MorphAlignment {
  /**
   * How the two shapes register before parts are matched.
   * - `none`: raw coordinates.
   * - `centroid`: area centroids coincide (translation only).
   * - `bounds`: bounding boxes coincide (translation and uniform scale); each part also scales on a
   *   logarithmic curve instead of a straight one.
   * - `anchors`: the first anchor pair registers the shapes; every pair pins ring correspondence.
   */
  mode: "none" | "centroid" | "bounds" | "anchors";
  /** Point pairs that must correspond. Required for `anchors`; used as correspondence pins in every mode. */
  anchors?: readonly MorphAnchorPair[];
  /**
   * `best-fit` turns each part along its least-squares angle. `auto` turns a part only when the turn
   * removes a crossing that a straight path makes.
   */
  rotation?: "none" | "best-fit" | "auto";
}

/** A sample count for the largest ring (other rings scale with their perimeter), or an absolute spacing. */
export type MorphResampleDensity = number | { spacing: number; min?: number; max?: number };

export interface MorphElasticEasing {
  elastic: { amplitude?: number; period?: number; direction?: "in" | "out" | "in-out" };
}

/** A named easing, `{ cubicBezier }`, `{ steps }`, `{ elastic }`, or any function of `t ∈ [0, 1]`. */
export type MorphEasing = EasingSpec | MorphElasticEasing | ((t: number) => number);

export interface AdvancedShapeMorphConfig {
  resampleDensity: MorphResampleDensity;
  easing: MorphEasing;
  alignment: MorphAlignment;
  topologyStrategy: MorphTopologyStrategy;
  /**
   * How holes move inside their part. `linear` moves each point straight. `cage` binds each hole to its outer
   * ring with mean value coordinates, so the hole follows the outer ring and stays inside it. `auto` uses
   * `cage` only when the straight path makes a crossing.
   */
  holeTransport: "linear" | "cage" | "auto";
  /**
   * How points travel. `linear` moves each sample straight (with the optional best-fit turn). `intrinsic`
   * blends edge lengths and turning angles and then closes the ring with the smallest length correction
   * (Sederberg et al., "2D shape blending: an intrinsic solution", 1993), so bending shapes do not collapse or
   * fold. `auto` uses `intrinsic` only when the straight path makes a crossing.
   */
  interpolation: "linear" | "intrinsic" | "auto";
  /** How rings without explicit holes nest. */
  fillRule: "nonzero" | "evenodd";
  /** Maximum chord error when SVG curves are flattened, in shape units. Default: 1/2000 of the path diagonal. */
  curveTolerance?: number;
  /** Size that a `cross-dissolve` part shrinks to while it fades (0–1). */
  dissolveScale: number;
}

export interface AdvancedShapeMorphOptions extends Partial<Omit<AdvancedShapeMorphConfig, "alignment">> {
  alignment?: Partial<MorphAlignment>;
}

export type MorphTrackKind = "morph" | "split" | "merge" | "partition" | "emerge" | "vanish" | "fade-in" | "fade-out";

export interface MorphComponentFrame {
  readonly kind: MorphTrackKind;
  /** Interleaved x, y. Clockwise on screen. */
  readonly outer: Float32Array;
  /** Interleaved x, y. Counter-clockwise on screen. */
  readonly holes: readonly Float32Array[];
  /** 0–1. Only `fade-in` and `fade-out` parts change it. */
  readonly opacity: number;
}

/** The frame that `update` writes. The class reuses this object and its buffers on every call. */
export interface MorphFrame {
  readonly progress: number;
  readonly eased: number;
  readonly components: readonly MorphComponentFrame[];
}

export interface MorphRingCorrespondence {
  readonly component: number;
  /** -1 for the outer ring, otherwise the hole index. */
  readonly ring: number;
  /** Interleaved source samples. */
  readonly from: Float32Array;
  /** Interleaved target samples; `to[i]` is the partner of `from[i]`. */
  readonly to: Float32Array;
}

export interface MorphPlanSummary {
  readonly source: { readonly components: number; readonly holes: number };
  readonly target: { readonly components: number; readonly holes: number };
  readonly tracks: number;
  readonly rings: number;
  readonly points: number;
  readonly kinds: Readonly<Record<MorphTrackKind, number>>;
  /** Crossings left at the sampled transit frames after every remedy was tried. */
  readonly transitCrossings: number;
  readonly setupMs: number;
}

/** Anything with the three path methods: `CanvasRenderingContext2D`, `Path2D`, a Three.js `ShapePath`, … */
export interface MorphPathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
}

export interface MorphSvgPath {
  d: string;
  opacity: number;
}

export const DEFAULT_ADVANCED_MORPH_CONFIG: Readonly<AdvancedShapeMorphConfig> = Object.freeze({
  resampleDensity: 128,
  easing: "ease-in-out-cubic",
  alignment: Object.freeze({ mode: "centroid", rotation: "auto" }),
  topologyStrategy: "split-merge",
  holeTransport: "auto",
  interpolation: "auto",
  fillRule: "evenodd",
  dissolveScale: 0.85,
}) as Readonly<AdvancedShapeMorphConfig>;

/* ------------------------------------------------------------------ *
 * Easing
 * ------------------------------------------------------------------ */

function elasticEasing(options: MorphElasticEasing["elastic"]): (t: number) => number {
  const amplitude = Math.max(1, Number.isFinite(options.amplitude) ? (options.amplitude as number) : 1);
  const period = options.period !== undefined && options.period > 0 && Number.isFinite(options.period) ? options.period : 0.3;
  const shift = (period / (2 * Math.PI)) * Math.asin(1 / amplitude);
  const out = (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return amplitude * 2 ** (-10 * t) * Math.sin(((t - shift) * 2 * Math.PI) / period) + 1;
  };
  if (options.direction === "in") return (t) => 1 - out(1 - t);
  if (options.direction === "in-out") return (t) => (t < 0.5 ? (1 - out(1 - 2 * t)) / 2 : (1 + out(2 * t - 1)) / 2);
  return out;
}

/** Resolve a `MorphEasing` into a function once, so a frame evaluates it without allocation. */
export function resolveMorphEasing(easing: MorphEasing): (t: number) => number {
  if (typeof easing === "function") {
    return (t) => {
      const value = easing(t);
      return Number.isFinite(value) ? value : t;
    };
  }
  if (typeof easing === "object" && easing !== null) {
    if ("elastic" in easing) return elasticEasing(easing.elastic);
    if ("cubicBezier" in easing) {
      const [x1, y1, x2, y2] = easing.cubicBezier;
      return cubicBezier(x1, y1, x2, y2);
    }
  }
  const spec = easing as EasingSpec;
  return (t) => evaluateEasing(spec, t);
}

/* ------------------------------------------------------------------ *
 * Input normalization
 * ------------------------------------------------------------------ */

interface ShapeComponent {
  outer: Ring;
  holes: Ring[];
  /** Net filled area (outer minus holes). */
  area: number;
  centroid: Vec2;
  bounds: Bounds;
  perimeter: number;
  pole?: Vec2;
}

interface NormalizedShape {
  components: ShapeComponent[];
  bounds: Bounds | null;
  centroid: Vec2;
  holes: number;
}

const MAX_RING_POINTS = 4096;
const MIN_RING_POINTS = 12;
const SEARCH_SAMPLES = 96;
const CAGE_POINTS = 96;
const TRANSIT_SAMPLES = Array.from({ length: 31 }, (_, k) => (k + 1) / 32);
const CROSSING_LIMIT = 16;

function warn(code: string, message: string): Diagnostic {
  return createDiagnostic(code, "warning", message);
}

function componentPole(component: ShapeComponent): Vec2 {
  if (!component.pole) component.pole = poleOfInaccessibility(component.outer, component.holes);
  return component.pole;
}

function isContourShape(input: unknown): input is ContourShape {
  return typeof input === "object" && input !== null && !Array.isArray(input) && Array.isArray((input as ContourShape).contours);
}

function isPointList(input: readonly unknown[]): input is readonly MorphPoint[] {
  const first = input[0];
  if (Array.isArray(first)) return typeof first[0] === "number";
  return typeof first === "object" && first !== null && "x" in first;
}

function perimeterOf(ring: Ring): number {
  return arcTable(ring)[ring.length >> 1];
}

function makeComponent(outer: Ring, holes: Ring[]): ShapeComponent {
  let area = ringArea(outer);
  for (const hole of holes) area += ringArea(hole);
  return { outer, holes, area, centroid: ringCentroid(outer), bounds: ringBounds(outer), perimeter: perimeterOf(outer) };
}

class ShapeNormalizer {
  degenerate = 0;
  nonFinite = 0;
  selfIntersecting = 0;

  /** Clean one ring; `null` when nothing with area remains. */
  clean(points: ArrayLike<number>): Ring | null {
    const { ring, nonFinite } = sanitizeRing(points, 1e-12);
    this.nonFinite += nonFinite;
    const bounds = ring.length >= 2 ? ringBounds(ring) : null;
    const diagonal = bounds ? boundsDiagonal(bounds) : 0;
    if (ring.length < 6 || !(Math.abs(ringArea(ring)) > 1e-10 * diagonal * diagonal)) {
      this.degenerate += 1;
      return null;
    }
    if (countCrossings([ring], 1) > 0) this.selfIntersecting += 1;
    return ring;
  }

  polygons(input: MorphShapeInput, fillRule: "nonzero" | "evenodd", tolerance: number | undefined, label: string, diagnostics: Diagnostic[]): NestedPolygon[] {
    if (typeof input === "string") {
      const parsed = parseSvgPath(input);
      if (parsed.error) diagnostics.push(warn("morph-parse-error", `${label} path data: ${parsed.error} The geometry before the error is kept.`));
      const bounds = svgSegmentBounds(parsed.segments);
      const tol = tolerance ?? (bounds ? Math.max(boundsDiagonal(bounds) / 2000, 1e-6) : 0.25);
      const rings = flattenSvgPath(parsed.segments, tol).map((ring) => this.clean(ring)).filter((ring): ring is Ring => ring !== null);
      return nestRings(rings, fillRule);
    }
    if (isContourShape(input)) {
      const polygons: NestedPolygon[] = [];
      const visit = (contour: PathContour): void => {
        const outer = this.clean(ringFromPoints(contour.points));
        const holes: Ring[] = [];
        for (const hole of contour.holes ?? []) {
          const ring = this.clean(ringFromPoints(hole.points));
          if (ring) holes.push(orientRing(ring, -1));
          for (const island of hole.holes ?? []) visit(island);
        }
        if (outer) polygons.push({ outer: orientRing(outer, 1), holes });
      };
      for (const contour of input.contours) visit(contour);
      return polygons;
    }
    if (Array.isArray(input)) {
      if (input.length === 0) return [];
      const list = input as readonly unknown[];
      const raw = isPointList(list) ? [ringFromPoints(list)] : (list as readonly (readonly MorphPoint[])[]).map((ring) => ringFromPoints(ring));
      const rings = raw.map((ring) => this.clean(ring)).filter((ring): ring is Ring => ring !== null);
      return nestRings(rings, fillRule);
    }
    diagnostics.push(warn("morph-invalid-input", `${label} shape is not SVG path data, a ContourShape or point rings. It is treated as empty.`));
    return [];
  }
}

function normalizeShape(
  input: MorphShapeInput, fillRule: "nonzero" | "evenodd", tolerance: number | undefined, label: string, diagnostics: Diagnostic[],
): NormalizedShape {
  const normalizer = new ShapeNormalizer();
  const polygons = normalizer.polygons(input, fillRule, tolerance, label, diagnostics);
  if (normalizer.nonFinite > 0) diagnostics.push(warn("morph-nonfinite-point", `${label} shape: ${normalizer.nonFinite} nonfinite point(s) were removed.`));
  if (normalizer.degenerate > 0) diagnostics.push(warn("morph-degenerate-ring", `${label} shape: ${normalizer.degenerate} ring(s) with no area were removed.`));
  if (normalizer.selfIntersecting > 0) {
    diagnostics.push(warn("morph-input-self-intersection", `${label} shape: ${normalizer.selfIntersecting} ring(s) intersect themselves. The morph keeps them, but their fill depends on the fill rule.`));
  }
  const components = polygons.map((polygon) => makeComponent(polygon.outer, polygon.holes));
  let bounds: Bounds | null = null;
  let weight = 0;
  let cx = 0;
  let cy = 0;
  let holes = 0;
  for (const component of components) {
    bounds = unionBounds(bounds, component.bounds);
    const w = Math.max(component.area, 0);
    weight += w;
    cx += component.centroid.x * w;
    cy += component.centroid.y * w;
    holes += component.holes.length;
  }
  const centroid = weight > 0 ? { x: cx / weight, y: cy / weight } : bounds ? { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 } : { x: 0, y: 0 };
  return { components, bounds, centroid, holes };
}

/**
 * Convert any `MorphShapeInput` (SVG path data, point rings) into the `ContourShape` model that `morphShapes`,
 * VisualTransformation and the motion views use: one closed contour per filled part with its holes nested,
 * outer rings clockwise on screen and holes counter-clockwise. Curves are flattened within `curveTolerance`.
 */
export function toContourShape(
  input: MorphShapeInput, options: { fillRule?: "nonzero" | "evenodd"; curveTolerance?: number } = {},
): { shape: ContourShape; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const normalized = normalizeShape(input, options.fillRule ?? "evenodd", options.curveTolerance, "Input", diagnostics);
  const contour = (ring: Ring): PathContour => {
    const points: Vec2[] = [];
    for (let i = 0; i < ring.length; i += 2) points.push({ x: ring[i], y: ring[i + 1] });
    return { points, closed: true };
  };
  const contours = normalized.components.map((component) => ({ ...contour(component.outer), holes: component.holes.map(contour) }));
  return { shape: { contours }, diagnostics };
}

/* ------------------------------------------------------------------ *
 * Ring correspondence
 * ------------------------------------------------------------------ */

/** A monotone map from source arc-length parameters to target parameters, as unwrapped knots. */
interface CyclicMap {
  ka: Float64Array;
  kb: Float64Array;
}

function evalKnots(from: Float64Array, to: Float64Array, value: number): number {
  const last = from.length - 1;
  const x = from[0] + (value - from[0] - Math.floor(value - from[0]));
  let k = 0;
  while (k < last - 1 && x >= from[k + 1]) k += 1;
  const span = from[k + 1] - from[k];
  const f = span > 0 ? (x - from[k]) / span : 0;
  return to[k] + f * (to[k + 1] - to[k]);
}

function offsetMap(offset: number): CyclicMap {
  return { ka: Float64Array.of(0, 1), kb: Float64Array.of(offset, offset + 1) };
}

/** Build a map through pinned parameter pairs. Pins that break the cyclic order are dropped. */
function pinnedMap(pins: readonly { uA: number; uB: number }[]): { map: CyclicMap; dropped: number } {
  const sorted = [...pins].sort((p, q) => p.uA - q.uA);
  const ka: number[] = [];
  const kb: number[] = [];
  let dropped = 0;
  for (const pin of sorted) {
    if (ka.length === 0) {
      ka.push(pin.uA);
      kb.push(pin.uB);
      continue;
    }
    if (pin.uA - ka[ka.length - 1] < 1e-9) {
      dropped += 1;
      continue;
    }
    let b = pin.uB;
    while (b <= kb[kb.length - 1]) b += 1;
    if (b >= kb[0] + 1) {
      dropped += 1;
      continue;
    }
    ka.push(pin.uA);
    kb.push(b);
  }
  ka.push(ka[0] + 1);
  kb.push(kb[0] + 1);
  return { map: { ka: Float64Array.from(ka), kb: Float64Array.from(kb) }, dropped };
}

interface RingFrameOfReference {
  ring: Ring;
  table: Float64Array;
  cx: number;
  cy: number;
  scale: number;
}

function frameOf(ring: Ring): RingFrameOfReference {
  const table = arcTable(ring);
  const centroid = ringCentroid(ring);
  const area = Math.abs(ringArea(ring));
  const scale = area > 0 ? Math.sqrt(area) : table[ring.length >> 1] || 1;
  return { ring, table, cx: centroid.x, cy: centroid.y, scale };
}

function normalizedSamples(reference: RingFrameOfReference, shift: number, turn: number, out: Float64Array): void {
  const count = out.length >> 1;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  for (let k = 0; k < count; k += 1) {
    pointAtParam(reference.ring, reference.table, k / count + shift, out, 2 * k);
    const x = (out[2 * k] - reference.cx) / reference.scale;
    const y = (out[2 * k + 1] - reference.cy) / reference.scale;
    out[2 * k] = cos * x - sin * y;
    out[2 * k + 1] = sin * x + cos * y;
  }
}

function alignmentCost(a: Float64Array, b: Float64Array, shiftIndex: number, rotate: boolean): number {
  const count = a.length >> 1;
  let sq = 0;
  let dot = 0;
  let cross = 0;
  let aa = 0;
  let bb = 0;
  for (let k = 0; k < count; k += 1) {
    const j = (k + shiftIndex) % count;
    const ax = a[2 * k];
    const ay = a[2 * k + 1];
    const bx = b[2 * j];
    const by = b[2 * j + 1];
    if (rotate) {
      dot += ax * bx + ay * by;
      cross += ax * by - ay * bx;
      aa += ax * ax + ay * ay;
      bb += bx * bx + by * by;
    } else {
      sq += (ax - bx) ** 2 + (ay - by) ** 2;
    }
  }
  return rotate ? aa + bb - 2 * Math.hypot(dot, cross) : sq;
}

/**
 * Candidate start offsets for ring B, best first. Each candidate is a local minimum of the summed squared
 * distance between evenly spaced samples (optionally after a best-fit turn), refined to a fraction of a
 * sample.
 */
function searchOffsets(a: RingFrameOfReference, b: RingFrameOfReference, rotate: boolean, turn: number): number[] {
  const count = SEARCH_SAMPLES;
  const as = new Float64Array(2 * count);
  const bs = new Float64Array(2 * count);
  normalizedSamples(a, 0, turn, as);
  normalizedSamples(b, 0, 0, bs);
  const costs = new Float64Array(count);
  for (let shift = 0; shift < count; shift += 1) costs[shift] = alignmentCost(as, bs, shift, rotate);
  const minima: number[] = [];
  for (let shift = 0; shift < count; shift += 1) {
    const before = costs[(shift + count - 1) % count];
    const after = costs[(shift + 1) % count];
    if (costs[shift] <= before && costs[shift] <= after) minima.push(shift);
  }
  minima.sort((p, q) => costs[p] - costs[q] || p - q);
  const chosen: number[] = [];
  for (const shift of minima) {
    if (chosen.every((other) => Math.min(Math.abs(other - shift), count - Math.abs(other - shift)) >= 3)) chosen.push(shift);
    if (chosen.length === 3) break;
  }
  const refined = new Float64Array(2 * count);
  return chosen.map((shift) => {
    let best = shift / count;
    let bestCost = costs[shift];
    for (let step = -6; step <= 6; step += 1) {
      if (step === 0) continue;
      const offset = (shift + step / 8) / count;
      normalizedSamples(b, offset, 0, refined);
      const cost = alignmentCost(as, refined, 0, rotate);
      if (cost < bestCost) {
        bestCost = cost;
        best = offset;
      }
    }
    return best - Math.floor(best);
  });
}

interface RingSamples {
  a: Float64Array;
  b: Float64Array;
  count: number;
  capped: boolean;
}

function uniqueSortedParams(values: number[]): number[] {
  const wrapped = values.map((value) => value - Math.floor(value)).sort((p, q) => p - q);
  const out: number[] = [];
  for (const value of wrapped) if (out.length === 0 || value - out[out.length - 1] > 1e-9) out.push(value);
  while (out.length > 1 && out[0] + 1 - out[out.length - 1] <= 1e-9) out.pop();
  return out;
}

/**
 * Fill parameter gaps up to `target` samples. Extra samples go to gaps in proportion to their longer
 * arc length on either ring (largest remainder), spread evenly within each gap. The result increases
 * monotonically from `params[0]` and may exceed 1; callers wrap it.
 */
function fillParams(params: readonly number[], target: number, gapLength: (u0: number, u1: number) => number): Float64Array {
  const n = params.length;
  if (n >= target) return Float64Array.from(params);
  const extra = target - n;
  const weights = new Float64Array(n);
  let sum = 0;
  for (let k = 0; k < n; k += 1) {
    const u0 = params[k];
    const u1 = k + 1 < n ? params[k + 1] : params[0] + 1;
    weights[k] = Math.max(gapLength(u0, u1), 0);
    sum += weights[k];
  }
  const counts = new Int32Array(n);
  const remainders: [number, number][] = [];
  let assigned = 0;
  for (let k = 0; k < n; k += 1) {
    const exact = sum > 0 ? (extra * weights[k]) / sum : extra / n;
    counts[k] = Math.floor(exact);
    assigned += counts[k];
    remainders.push([exact - counts[k], k]);
  }
  remainders.sort((p, q) => q[0] - p[0] || p[1] - q[1]);
  for (let r = 0; r < extra - assigned; r += 1) counts[remainders[r % n][1]] += 1;
  const out = new Float64Array(target);
  let index = 0;
  for (let k = 0; k < n; k += 1) {
    const u0 = params[k];
    const u1 = k + 1 < n ? params[k + 1] : params[0] + 1;
    out[index++] = u0;
    for (let m = 1; m <= counts[k]; m += 1) out[index++] = u0 + ((u1 - u0) * m) / (counts[k] + 1);
  }
  return out;
}

function vertexParams(ring: Ring, table: Float64Array): number[] {
  const n = ring.length >> 1;
  const perimeter = table[n];
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) out.push(perimeter > 0 ? table[i] / perimeter : i / n);
  return out;
}

/** Samples for a ring that grows from, or shrinks into, a single point. */
function pointRingSamples(ring: Ring, point: Vec2, density: number, pointIsSource: boolean): RingSamples {
  const table = arcTable(ring);
  const perimeter = table[ring.length >> 1];
  let params = uniqueSortedParams(vertexParams(ring, table));
  let capped = false;
  if (params.length > MAX_RING_POINTS) {
    params = Array.from({ length: MAX_RING_POINTS }, (_, k) => k / MAX_RING_POINTS);
    capped = true;
  }
  const filled = fillParams(params, Math.max(density, params.length), (u0, u1) => (u1 - u0) * perimeter);
  const count = filled.length;
  const ringSamples = new Float64Array(2 * count);
  const pointSamples = new Float64Array(2 * count);
  for (let k = 0; k < count; k += 1) {
    pointAtParam(ring, table, filled[k], ringSamples, 2 * k);
    pointSamples[2 * k] = point.x;
    pointSamples[2 * k + 1] = point.y;
  }
  return pointIsSource
    ? { a: pointSamples, b: ringSamples, count, capped }
    : { a: ringSamples, b: pointSamples, count, capped };
}

/**
 * Dense correspondence between two rings through `map`. The common parameter set holds every vertex of
 * both rings, so corners stay exact at both ends, and then extra samples up to `density`.
 */
function ringSamples(a: RingFrameOfReference, b: RingFrameOfReference, map: CyclicMap, density: number, extraParams: readonly number[]): RingSamples {
  const na = a.ring.length >> 1;
  const nb = b.ring.length >> 1;
  const perA = a.table[na];
  const perB = b.table[nb];
  const raw = vertexParams(a.ring, a.table);
  for (const v of vertexParams(b.ring, b.table)) raw.push(evalKnots(map.kb, map.ka, v));
  raw.push(...extraParams);
  let params = uniqueSortedParams(raw);
  let capped = false;
  if (params.length > MAX_RING_POINTS) {
    params = Array.from({ length: MAX_RING_POINTS }, (_, k) => k / MAX_RING_POINTS);
    capped = true;
  }
  const filled = fillParams(params, Math.max(density, params.length), (u0, u1) => {
    let db = evalKnots(map.ka, map.kb, u1) - evalKnots(map.ka, map.kb, u0);
    db -= Math.floor(db);
    if (params.length === 1) db = 1;
    return Math.max((u1 - u0) * perA, db * perB);
  });
  const count = filled.length;
  const as = new Float64Array(2 * count);
  const bs = new Float64Array(2 * count);
  for (let k = 0; k < count; k += 1) {
    pointAtParam(a.ring, a.table, filled[k], as, 2 * k);
    pointAtParam(b.ring, b.table, evalKnots(map.ka, map.kb, filled[k]), bs, 2 * k);
  }
  return { a: as, b: bs, count, capped };
}

/** Least-squares turn that carries the centred source samples onto the centred target samples. */
function bestFitTurn(samples: RingSamples, ref: Vec2, targetRef: Vec2): number {
  let dot = 0;
  let cross = 0;
  for (let k = 0; k < samples.count; k += 1) {
    const ax = samples.a[2 * k] - ref.x;
    const ay = samples.a[2 * k + 1] - ref.y;
    const bx = samples.b[2 * k] - targetRef.x;
    const by = samples.b[2 * k + 1] - targetRef.y;
    dot += ax * bx + ay * by;
    cross += ax * by - ay * bx;
  }
  return Math.abs(cross) < 1e-12 && dot >= 0 ? 0 : Math.atan2(cross, dot);
}

/* ------------------------------------------------------------------ *
 * Tracks
 * ------------------------------------------------------------------ */

interface CageBinding {
  indices: Int32Array;
  w0: Float64Array;
  dw: Float64Array;
}

/** Per-ring data for intrinsic blending, plus per-frame scratch. */
interface IntrinsicRing {
  len0: Float64Array;
  dlen: Float64Array;
  turn0: Float64Array;
  dturn: Float64Array;
  angle0: number;
  dangle: number;
  /** Squared tolerance per edge: edges whose length changes most absorb most of the closing error. */
  stiffness: Float64Array;
  cx0: number;
  cy0: number;
  dcx: number;
  dcy: number;
  cos: Float64Array;
  sin: Float64Array;
}

interface RingTrack {
  intrinsic: IntrinsicRing | null;
  count: number;
  base: Float64Array;
  delta: Float64Array;
  out: Float32Array;
  from: Float32Array;
  to: Float32Array;
  cage: CageBinding | null;
}

interface MutableComponentFrame {
  kind: MorphTrackKind;
  outer: Float32Array;
  holes: Float32Array[];
  opacity: number;
}

interface ComponentTrack {
  kind: MorphTrackKind;
  outer: RingTrack;
  holes: RingTrack[];
  rigid: boolean;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  scale0: number;
  scaleRatio: number;
  theta: number;
  opacityFrom: number;
  opacityTo: number;
  frame: MutableComponentFrame;
}

interface RigidParams {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  scale0: number;
  scale1: number;
  theta: number;
}

function ringTrack(samples: RingSamples, rigid: RigidParams | null): RingTrack {
  const n2 = samples.count * 2;
  const base = new Float64Array(n2);
  const delta = new Float64Array(n2);
  if (!rigid) {
    for (let i = 0; i < n2; i += 1) {
      base[i] = samples.a[i];
      delta[i] = samples.b[i] - samples.a[i];
    }
  } else {
    const cos = Math.cos(-rigid.theta);
    const sin = Math.sin(-rigid.theta);
    for (let i = 0; i < n2; i += 2) {
      const ax = (samples.a[i] - rigid.ax) / rigid.scale0;
      const ay = (samples.a[i + 1] - rigid.ay) / rigid.scale0;
      const ux = (samples.b[i] - rigid.bx) / rigid.scale1;
      const uy = (samples.b[i + 1] - rigid.by) / rigid.scale1;
      base[i] = ax;
      base[i + 1] = ay;
      delta[i] = cos * ux - sin * uy - ax;
      delta[i + 1] = sin * ux + cos * uy - ay;
    }
  }
  return {
    count: samples.count, base, delta, out: new Float32Array(n2),
    from: Float32Array.from(samples.a), to: Float32Array.from(samples.b), cage: null, intrinsic: null,
  };
}

/** Bind a hole to its outer ring with mean value coordinates; `null` when a weight is unstable. */
function cageBinding(outer: RingTrack, hole: RingSamples): CageBinding | null {
  const cageCount = Math.min(outer.count, CAGE_POINTS);
  if (cageCount < 3) return null;
  const indices = new Int32Array(cageCount);
  const cageA = new Float64Array(2 * cageCount);
  const cageB = new Float64Array(2 * cageCount);
  for (let j = 0; j < cageCount; j += 1) {
    const index = Math.floor((j * outer.count) / cageCount);
    indices[j] = index;
    cageA[2 * j] = outer.from[2 * index];
    cageA[2 * j + 1] = outer.from[2 * index + 1];
    cageB[2 * j] = outer.to[2 * index];
    cageB[2 * j + 1] = outer.to[2 * index + 1];
  }
  const w0 = new Float64Array(hole.count * cageCount);
  const dw = new Float64Array(hole.count * cageCount);
  const w1 = new Float64Array(cageCount);
  for (let i = 0; i < hole.count; i += 1) {
    if (!meanValueCoordinates(cageA, hole.a[2 * i], hole.a[2 * i + 1], w0, i * cageCount)) return null;
    if (!meanValueCoordinates(cageB, hole.b[2 * i], hole.b[2 * i + 1], w1, 0)) return null;
    for (let j = 0; j < cageCount; j += 1) dw[i * cageCount + j] = w1[j] - w0[i * cageCount + j];
  }
  return { indices, w0, dw };
}

function writeRing(ring: RingTrack, e: number, rigid: boolean, cosS: number, sinS: number, tx: number, ty: number): void {
  const { base, delta, out } = ring;
  const n2 = ring.count * 2;
  if (!rigid) {
    for (let i = 0; i < n2; i += 1) out[i] = base[i] + delta[i] * e;
    return;
  }
  for (let i = 0; i < n2; i += 2) {
    const x = base[i] + delta[i] * e;
    const y = base[i + 1] + delta[i + 1] * e;
    out[i] = tx + cosS * x - sinS * y;
    out[i + 1] = ty + sinS * x + cosS * y;
  }
}

const wrapAngle = (angle: number): number => angle - 2 * Math.PI * Math.round(angle / (2 * Math.PI));

/** Edge directions; a zero-length edge takes the direction of the edge before it. `null` for a point ring. */
function edgeAngles(points: Float64Array, count: number): Float64Array | null {
  const angles = new Float64Array(count);
  const valid = new Uint8Array(count);
  let anchor = -1;
  for (let i = 0; i < count; i += 1) {
    const j = (i + 1) % count;
    const dx = points[2 * j] - points[2 * i];
    const dy = points[2 * j + 1] - points[2 * i + 1];
    if (Math.hypot(dx, dy) > 1e-9) {
      angles[i] = Math.atan2(dy, dx);
      valid[i] = 1;
      anchor = i;
    }
  }
  if (anchor < 0) return null;
  for (let k = 1; k <= count; k += 1) {
    const i = (anchor + k) % count;
    if (!valid[i]) angles[i] = angles[(i + count - 1) % count];
  }
  return angles;
}

/**
 * Intrinsic blending data for a ring pair. `turnHint` picks the branch of the overall turn (the best-fit angle),
 * so the ring turns the short way round.
 */
function intrinsicRing(samples: RingSamples, turnHint: number): IntrinsicRing | null {
  const n = samples.count;
  if (n < 3) return null;
  const angA = edgeAngles(samples.a, n);
  const angB = edgeAngles(samples.b, n);
  if (!angA || !angB) return null;
  const len0 = new Float64Array(n);
  const dlen = new Float64Array(n);
  const turn0 = new Float64Array(n);
  const dturn = new Float64Array(n);
  let mean = 0;
  let cxa = 0;
  let cya = 0;
  let cxb = 0;
  let cyb = 0;
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const la = Math.hypot(samples.a[2 * j] - samples.a[2 * i], samples.a[2 * j + 1] - samples.a[2 * i + 1]);
    const lb = Math.hypot(samples.b[2 * j] - samples.b[2 * i], samples.b[2 * j + 1] - samples.b[2 * i + 1]);
    len0[i] = la;
    dlen[i] = lb - la;
    mean += (la + lb) / (2 * n);
    if (i > 0) {
      turn0[i] = wrapAngle(angA[i] - angA[i - 1]);
      dturn[i] = wrapAngle(angB[i] - angB[i - 1]) - turn0[i];
    }
    cxa += samples.a[2 * i] / n;
    cya += samples.a[2 * i + 1] / n;
    cxb += samples.b[2 * i] / n;
    cyb += samples.b[2 * i + 1] / n;
  }
  const tolerance = Math.max(mean * 0.02, 1e-9);
  const stiffness = new Float64Array(n);
  for (let i = 0; i < n; i += 1) stiffness[i] = Math.max(Math.abs(dlen[i]), tolerance) ** 2;
  return {
    len0, dlen, turn0, dturn, stiffness,
    angle0: angA[0], dangle: turnHint + wrapAngle(angB[0] - angA[0] - turnHint),
    cx0: cxa, cy0: cya, dcx: cxb - cxa, dcy: cyb - cya,
    cos: new Float64Array(n), sin: new Float64Array(n),
  };
}

/** Rebuild a ring from blended edge lengths and turning angles, close it, and place it on the centroid path. */
function writeIntrinsic(ring: RingTrack, data: IntrinsicRing, e: number): void {
  const n = ring.count;
  const out = ring.out;
  let theta = data.angle0 + data.dangle * e;
  let ex = 0;
  let ey = 0;
  let scc = 0;
  let scs = 0;
  let sss = 0;
  for (let i = 0; i < n; i += 1) {
    if (i > 0) theta += data.turn0[i] + data.dturn[i] * e;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    data.cos[i] = c;
    data.sin[i] = s;
    const length = Math.max(0, data.len0[i] + data.dlen[i] * e);
    ex += length * c;
    ey += length * s;
    const k = data.stiffness[i];
    scc += k * c * c;
    scs += k * c * s;
    sss += k * s * s;
  }
  // Smallest weighted length correction that closes the ring (two Lagrange multipliers).
  const det = scc * sss - scs * scs;
  const l1 = Math.abs(det) > 1e-18 ? (-ex * sss + ey * scs) / det : 0;
  const l2 = Math.abs(det) > 1e-18 ? (-ey * scc + ex * scs) / det : 0;
  let x = 0;
  let y = 0;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i += 1) {
    out[2 * i] = x;
    out[2 * i + 1] = y;
    mx += x;
    my += y;
    const c = data.cos[i];
    const s = data.sin[i];
    const length = Math.max(0, data.len0[i] + data.dlen[i] * e) + data.stiffness[i] * (l1 * c + l2 * s);
    x += length * c;
    y += length * s;
  }
  const tx = data.cx0 + data.dcx * e - mx / n;
  const ty = data.cy0 + data.dcy * e - my / n;
  for (let i = 0; i < n; i += 1) {
    out[2 * i] += tx;
    out[2 * i + 1] += ty;
  }
}

function writeCaged(ring: RingTrack, cage: CageBinding, e: number, outer: Float32Array): void {
  const cageCount = cage.indices.length;
  const { out } = ring;
  for (let i = 0; i < ring.count; i += 1) {
    let x = 0;
    let y = 0;
    const row = i * cageCount;
    for (let j = 0; j < cageCount; j += 1) {
      const w = cage.w0[row + j] + cage.dw[row + j] * e;
      const index = cage.indices[j] * 2;
      x += w * outer[index];
      y += w * outer[index + 1];
    }
    out[2 * i] = x;
    out[2 * i + 1] = y;
  }
}

function evaluateTrack(track: ComponentTrack, e: number): void {
  let cosS = 1;
  let sinS = 0;
  let tx = 0;
  let ty = 0;
  if (track.rigid) {
    const scale = track.scale0 * Math.pow(track.scaleRatio, e);
    const angle = track.theta * e;
    cosS = Math.cos(angle) * scale;
    sinS = Math.sin(angle) * scale;
    tx = track.ax + (track.bx - track.ax) * e;
    ty = track.ay + (track.by - track.ay) * e;
  }
  if (track.outer.intrinsic) writeIntrinsic(track.outer, track.outer.intrinsic, e);
  else writeRing(track.outer, e, track.rigid, cosS, sinS, tx, ty);
  for (const hole of track.holes) {
    if (hole.cage) writeCaged(hole, hole.cage, e, track.outer.out);
    else if (hole.intrinsic) writeIntrinsic(hole, hole.intrinsic, e);
    else writeRing(hole, e, track.rigid, cosS, sinS, tx, ty);
  }
}

/** Crossings over the sampled transit frames; stops early once `budget` is reached. */
function transitCrossings(track: ComponentTrack, budget: number): number {
  let total = 0;
  const rings: Float32Array[] = [track.outer.out, ...track.holes.map((hole) => hole.out)];
  for (const e of TRANSIT_SAMPLES) {
    evaluateTrack(track, e);
    total += countCrossings(rings, CROSSING_LIMIT);
    if (total >= budget) return total;
  }
  return total;
}

function clamp01(value: number): number {
  if (!(value > 0)) return 0;
  return value >= 1 ? 1 : value;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/* ------------------------------------------------------------------ *
 * Planner
 * ------------------------------------------------------------------ */

interface Registration {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  k: number;
}

interface AnchorPin {
  ringA: Ring;
  uA: number;
  ringB: Ring;
  uB: number;
  used: boolean;
}

const toTarget = (r: Registration, p: Vec2): Vec2 => ({ x: r.bx + r.k * (p.x - r.ax), y: r.by + r.k * (p.y - r.ay) });
const toSource = (r: Registration, p: Vec2): Vec2 => ({ x: r.ax + (p.x - r.bx) / r.k, y: r.ay + (p.y - r.by) / r.k });

function sanitizeConfig(config: AdvancedShapeMorphConfig, diagnostics: Diagnostic[]): AdvancedShapeMorphConfig {
  const out: AdvancedShapeMorphConfig = { ...config, alignment: { ...config.alignment } };
  const density = out.resampleDensity;
  if (typeof density === "number") {
    if (!Number.isFinite(density) || density < 3) {
      diagnostics.push(warn("morph-config-density", `resampleDensity ${density} is not a usable sample count; ${DEFAULT_ADVANCED_MORPH_CONFIG.resampleDensity} is used.`));
      out.resampleDensity = DEFAULT_ADVANCED_MORPH_CONFIG.resampleDensity;
    } else if (density > MAX_RING_POINTS) {
      diagnostics.push(warn("morph-config-density", `resampleDensity ${density} is above ${MAX_RING_POINTS}; ${MAX_RING_POINTS} is used.`));
      out.resampleDensity = MAX_RING_POINTS;
    }
  } else if (!(density.spacing > 0) || !Number.isFinite(density.spacing)) {
    diagnostics.push(warn("morph-config-density", `resampleDensity spacing ${density.spacing} must be a positive number; ${DEFAULT_ADVANCED_MORPH_CONFIG.resampleDensity} samples are used.`));
    out.resampleDensity = DEFAULT_ADVANCED_MORPH_CONFIG.resampleDensity;
  }
  if (!Number.isFinite(out.dissolveScale)) out.dissolveScale = DEFAULT_ADVANCED_MORPH_CONFIG.dissolveScale;
  out.dissolveScale = clamp01(out.dissolveScale);
  if (out.curveTolerance !== undefined && !(out.curveTolerance > 0 && Number.isFinite(out.curveTolerance))) {
    diagnostics.push(warn("morph-config-tolerance", `curveTolerance ${out.curveTolerance} must be a positive number; the automatic tolerance is used.`));
    out.curveTolerance = undefined;
  }
  const strategies: MorphTopologyStrategy[] = ["cross-dissolve", "emerge", "split-merge", "partition"];
  if (!strategies.includes(out.topologyStrategy)) {
    throw new RangeError(`Unknown topologyStrategy '${String(out.topologyStrategy)}'. Use one of: ${strategies.join(", ")}.`);
  }
  if (!["none", "centroid", "bounds", "anchors"].includes(out.alignment.mode)) {
    throw new RangeError(`Unknown alignment mode '${String(out.alignment.mode)}'. Use none, centroid, bounds or anchors.`);
  }
  if (!["linear", "intrinsic", "auto"].includes(out.interpolation)) {
    throw new RangeError(`Unknown interpolation '${String(out.interpolation)}'. Use linear, intrinsic or auto.`);
  }
  if (!["linear", "cage", "auto"].includes(out.holeTransport)) {
    throw new RangeError(`Unknown holeTransport '${String(out.holeTransport)}'. Use linear, cage or auto.`);
  }
  return out;
}

function mergeOptions(base: AdvancedShapeMorphConfig, options: AdvancedShapeMorphOptions): AdvancedShapeMorphConfig {
  const merged: AdvancedShapeMorphConfig = { ...base, alignment: { ...base.alignment } };
  for (const key of Object.keys(options) as (keyof AdvancedShapeMorphOptions)[]) {
    if (key === "alignment" || options[key] === undefined) continue;
    (merged as unknown as Record<string, unknown>)[key] = options[key];
  }
  if (options.alignment) merged.alignment = { ...merged.alignment, ...options.alignment };
  return merged;
}

/* ------------------------------------------------------------------ *
 * AdvancedShapeMorph
 * ------------------------------------------------------------------ */

/**
 * Plans a morph between two arbitrary shapes once, then evaluates frames cheaply.
 *
 * ```ts
 * const morph = new AdvancedShapeMorph(circlePath, threeDotsPath, { topologyStrategy: "partition" });
 * const frame = morph.update(0.5);      // reuses one frame object and its Float32Array buffers
 * traceMorphFrame(ctx, frame);          // ctx.beginPath() first, then ctx.fill("nonzero")
 * morph.dispose();
 * ```
 */
export class AdvancedShapeMorph {
  private fromInput: MorphShapeInput;
  private toInput: MorphShapeInput;
  private settings: AdvancedShapeMorphConfig;
  private ease: (t: number) => number;
  private source: NormalizedShape = { components: [], bounds: null, centroid: { x: 0, y: 0 }, holes: 0 };
  private target: NormalizedShape = { components: [], bounds: null, centroid: { x: 0, y: 0 }, holes: 0 };
  private shapeDiagnostics: Diagnostic[] = [];
  private planDiagnostics: Diagnostic[] = [];
  private tracks: ComponentTrack[] = [];
  private state: { progress: number; eased: number; components: MutableComponentFrame[] } = { progress: 0, eased: 0, components: [] };
  private summary: MorphPlanSummary;
  private referencePerimeter = 1;
  private registration: Registration = { ax: 0, ay: 0, bx: 0, by: 0, k: 1 };
  private anchorPins: AnchorPin[] = [];
  private disposed = false;

  constructor(from: MorphShapeInput, to: MorphShapeInput, options: AdvancedShapeMorphOptions = {}) {
    this.fromInput = from;
    this.toInput = to;
    const configDiagnostics: Diagnostic[] = [];
    this.settings = sanitizeConfig(mergeOptions(DEFAULT_ADVANCED_MORPH_CONFIG, options), configDiagnostics);
    this.ease = resolveMorphEasing(this.settings.easing);
    this.summary = this.emptySummary(0);
    this.normalize();
    this.buildPlan(configDiagnostics);
    this.update(0);
  }

  /** The resolved configuration. */
  get config(): Readonly<AdvancedShapeMorphConfig> {
    return this.settings;
  }

  /** Warnings from input cleaning, configuration and planning. The morph still runs when there are any. */
  get diagnostics(): readonly Diagnostic[] {
    return [...this.shapeDiagnostics, ...this.planDiagnostics];
  }

  /** Counts and timings of the current plan. */
  get plan(): MorphPlanSummary {
    return this.summary;
  }

  /** The last frame that `update` wrote. */
  get frame(): MorphFrame {
    return this.state;
  }

  /**
   * Write the frame at progress `t` (clamped to [0, 1]; NaN reads as 0) and return it. This allocates
   * nothing. The returned object and its buffers are reused; copy them to keep a frame.
   */
  update(t: number): MorphFrame {
    if (this.disposed) throw new Error("AdvancedShapeMorph.update was called after dispose(). Create a new morph.");
    const progress = clamp01(t);
    let eased = this.ease(progress);
    if (!Number.isFinite(eased)) eased = progress;
    const fade = clamp01(eased);
    for (let i = 0; i < this.tracks.length; i += 1) {
      const track = this.tracks[i];
      evaluateTrack(track, eased);
      track.frame.opacity = track.opacityFrom + (track.opacityTo - track.opacityFrom) * fade;
    }
    this.state.progress = progress;
    this.state.eased = eased;
    return this.state;
  }

  /**
   * Change the configuration at run time. Only `easing` changes skip the plan; every other key builds a
   * new plan. The current progress is evaluated again.
   */
  configure(options: AdvancedShapeMorphOptions): this {
    this.assertLive();
    const configDiagnostics: Diagnostic[] = [];
    const next = sanitizeConfig(mergeOptions(this.settings, options), configDiagnostics);
    const previous = this.settings;
    this.settings = next;
    this.ease = resolveMorphEasing(next.easing);
    const keys = Object.keys(options).filter((key) => (options as Record<string, unknown>)[key] !== undefined);
    if (keys.some((key) => key !== "easing")) {
      if (next.fillRule !== previous.fillRule || next.curveTolerance !== previous.curveTolerance) this.normalize();
      this.buildPlan(configDiagnostics);
    }
    this.update(this.state.progress);
    return this;
  }

  /** Replace both shapes and build a new plan. */
  setShapes(from: MorphShapeInput, to: MorphShapeInput): this {
    this.assertLive();
    this.fromInput = from;
    this.toInput = to;
    this.normalize();
    this.buildPlan([]);
    this.update(this.state.progress);
    return this;
  }

  /** The planned sample pairs of every ring, for overlays and debugging. */
  correspondence(): readonly MorphRingCorrespondence[] {
    const out: MorphRingCorrespondence[] = [];
    this.tracks.forEach((track, component) => {
      out.push({ component, ring: -1, from: track.outer.from, to: track.outer.to });
      track.holes.forEach((hole, ring) => out.push({ component, ring, from: hole.from, to: hole.to }));
    });
    return out;
  }

  /** Release every buffer. Later calls to `update`, `configure` or `setShapes` throw. */
  dispose(): void {
    this.tracks = [];
    this.state = { progress: 0, eased: 0, components: [] };
    this.source = { components: [], bounds: null, centroid: { x: 0, y: 0 }, holes: 0 };
    this.target = this.source;
    this.anchorPins = [];
    this.disposed = true;
  }

  private assertLive(): void {
    if (this.disposed) throw new Error("AdvancedShapeMorph was disposed. Create a new morph.");
  }

  private normalize(): void {
    const diagnostics: Diagnostic[] = [];
    this.source = normalizeShape(this.fromInput, this.settings.fillRule, this.settings.curveTolerance, "Source", diagnostics);
    this.target = normalizeShape(this.toInput, this.settings.fillRule, this.settings.curveTolerance, "Target", diagnostics);
    this.shapeDiagnostics = diagnostics;
  }

  private emptySummary(setupMs: number): MorphPlanSummary {
    return {
      source: { components: this.source.components.length, holes: this.source.holes },
      target: { components: this.target.components.length, holes: this.target.holes },
      tracks: 0, rings: 0, points: 0, transitCrossings: 0, setupMs,
      kinds: { morph: 0, split: 0, merge: 0, partition: 0, emerge: 0, vanish: 0, "fade-in": 0, "fade-out": 0 },
    };
  }

  private densityFor(perimeter: number): number {
    const density = this.settings.resampleDensity;
    if (typeof density === "number") return clampInt((density * perimeter) / this.referencePerimeter, MIN_RING_POINTS, MAX_RING_POINTS);
    return clampInt(perimeter / density.spacing, density.min ?? MIN_RING_POINTS, density.max ?? MAX_RING_POINTS);
  }

  private registrationFor(diagnostics: Diagnostic[]): Registration {
    const a = this.source;
    const b = this.target;
    const identity: Registration = { ax: 0, ay: 0, bx: 0, by: 0, k: 1 };
    if (!a.bounds || !b.bounds) return identity;
    const alignment = this.settings.alignment;
    switch (alignment.mode) {
      case "none":
        return identity;
      case "bounds": {
        const da = boundsDiagonal(a.bounds);
        const db = boundsDiagonal(b.bounds);
        return {
          ax: (a.bounds.minX + a.bounds.maxX) / 2, ay: (a.bounds.minY + a.bounds.maxY) / 2,
          bx: (b.bounds.minX + b.bounds.maxX) / 2, by: (b.bounds.minY + b.bounds.maxY) / 2,
          k: da > 0 && db > 0 ? db / da : 1,
        };
      }
      case "anchors": {
        const first = alignment.anchors?.[0];
        if (first) return { ax: first.from.x, ay: first.from.y, bx: first.to.x, by: first.to.y, k: 1 };
        diagnostics.push(warn("morph-anchor-missing", "Alignment mode 'anchors' needs at least one anchor pair; centroid registration is used."));
        return { ax: a.centroid.x, ay: a.centroid.y, bx: b.centroid.x, by: b.centroid.y, k: 1 };
      }
      default:
        return { ax: a.centroid.x, ay: a.centroid.y, bx: b.centroid.x, by: b.centroid.y, k: 1 };
    }
  }

  private resolveAnchors(): AnchorPin[] {
    const anchors = this.settings.alignment.anchors ?? [];
    if (anchors.length === 0) return [];
    const ringsOf = (shape: NormalizedShape) => shape.components.flatMap((component) => [component.outer, ...component.holes]);
    const nearest = (rings: Ring[], p: Vec2): { ring: Ring; u: number } | null => {
      let best: { ring: Ring; u: number; distance: number } | null = null;
      for (const ring of rings) {
        const hit = projectOntoRing(ring, arcTable(ring), p.x, p.y);
        if (!best || hit.distance < best.distance) best = { ring, u: hit.u, distance: hit.distance };
      }
      return best;
    };
    const sourceRings = ringsOf(this.source);
    const targetRings = ringsOf(this.target);
    const pins: AnchorPin[] = [];
    for (const anchor of anchors) {
      const a = nearest(sourceRings, anchor.from);
      const b = nearest(targetRings, anchor.to);
      if (a && b) pins.push({ ringA: a.ring, uA: a.u, ringB: b.ring, uB: b.u, used: false });
    }
    return pins;
  }

  private buildPlan(configDiagnostics: Diagnostic[]): void {
    const started = typeof performance !== "undefined" ? performance.now() : Date.now();
    const diagnostics: Diagnostic[] = [...configDiagnostics];
    const a = this.source.components;
    const b = this.target.components;
    this.referencePerimeter = Math.max(1e-9, ...a.map((c) => c.perimeter), ...b.map((c) => c.perimeter));
    this.registration = this.registrationFor(diagnostics);
    this.anchorPins = this.resolveAnchors();
    const tracks: ComponentTrack[] = [];
    let crossings = 0;
    const add = (track: ComponentTrack | null, remaining = 0): void => {
      if (!track) return;
      tracks.push(track);
      crossings += remaining;
    };

    if (a.length === 0 && b.length === 0) {
      diagnostics.push(warn("morph-empty-shapes", "Both shapes are empty after cleaning. The morph draws nothing."));
    } else if (a.length === 0 || b.length === 0) {
      if (a.length === 0) for (const component of b) add(this.pointTrack("emerge", component, componentPole(component)));
      else for (const component of a) add(this.pointTrack("vanish", component, componentPole(component)));
    } else {
      this.planComponents(a, b, add, diagnostics);
    }

    const unusedAnchors = this.anchorPins.filter((pin) => !pin.used).length;
    if (unusedAnchors > 0) {
      diagnostics.push(warn("morph-anchor-unused", `${unusedAnchors} anchor pair(s) did not land on a matched ring pair, or broke the order of other anchors, and were ignored.`));
    }
    if (tracks.some((track) => track.outer.count === MAX_RING_POINTS)) {
      diagnostics.push(warn("morph-resample-capped", `A ring needed more than ${MAX_RING_POINTS} samples; it was resampled evenly and may lose sharp corners.`));
    }
    if (crossings > 0) {
      diagnostics.push(warn("morph-transit-crossing", `${crossings} edge crossing(s) remain at sampled transit frames after rotation, offset and hole-cage remedies. Try another alignment or anchors.`));
    }

    this.tracks = tracks;
    this.state = { progress: this.state.progress, eased: this.state.eased, components: tracks.map((track) => track.frame) };
    this.planDiagnostics = diagnostics;
    const kinds = { ...this.emptySummary(0).kinds };
    let rings = 0;
    let points = 0;
    for (const track of tracks) {
      kinds[track.kind] += 1;
      rings += 1 + track.holes.length;
      points += track.outer.count + track.holes.reduce((sum, hole) => sum + hole.count, 0);
    }
    const ended = typeof performance !== "undefined" ? performance.now() : Date.now();
    this.summary = { ...this.emptySummary(ended - started), tracks: tracks.length, rings, points, kinds, transitCrossings: crossings };
  }

  private planComponents(
    a: ShapeComponent[], b: ShapeComponent[], add: (track: ComponentTrack | null, remaining?: number) => void, diagnostics: Diagnostic[],
  ): void {
    const reg = this.registration;
    const diagonal = this.target.bounds ? Math.max(boundsDiagonal(this.target.bounds), 1e-9) : 1;
    const cost = a.map((ca) => {
      const mapped = toTarget(reg, ca.centroid);
      return b.map((cb) => {
        const distance = ((mapped.x - cb.centroid.x) ** 2 + (mapped.y - cb.centroid.y) ** 2) / (diagonal * diagonal);
        const ratio = Math.log((Math.max(ca.area, 1e-12) * reg.k * reg.k) / Math.max(cb.area, 1e-12));
        return distance + 0.1 * ratio * ratio;
      });
    });
    const assignment = solveAssignment(cost);
    const matchedB = new Int32Array(b.length).fill(-1);
    assignment.forEach((j, i) => {
      if (j >= 0) matchedB[j] = i;
    });
    const nearestA = (j: number): number => {
      let best = 0;
      for (let i = 1; i < a.length; i += 1) if (cost[i][j] < cost[best][j]) best = i;
      return best;
    };
    const nearestB = (i: number): number => {
      let best = 0;
      for (let j = 1; j < b.length; j += 1) if (cost[i][j] < cost[i][best]) best = j;
      return best;
    };
    const unmatchedA = a.map((_, i) => i).filter((i) => assignment[i] < 0);
    const unmatchedB = b.map((_, j) => j).filter((j) => matchedB[j] < 0);
    const strategy = this.settings.topologyStrategy;

    const morph = (kind: MorphTrackKind, src: ShapeComponent, dst: ShapeComponent): void => {
      const { track, remaining } = this.bestMorphTrack(kind, src, dst);
      add(track, remaining);
    };

    if (strategy === "emerge" || strategy === "cross-dissolve") {
      assignment.forEach((j, i) => {
        if (j >= 0) morph("morph", a[i], b[j]);
      });
      for (const i of unmatchedA) add(strategy === "emerge" ? this.pointTrack("vanish", a[i], toTarget(reg, componentPole(a[i]))) : this.fadeTrack("fade-out", a[i]));
      for (const j of unmatchedB) add(strategy === "emerge" ? this.pointTrack("emerge", b[j], toSource(reg, componentPole(b[j]))) : this.fadeTrack("fade-in", b[j]));
      return;
    }

    // split-merge and partition: every extra part joins the nearest part on the other side.
    const splits = new Map<number, number[]>();
    const merges = new Map<number, number[]>();
    for (const j of unmatchedB) {
      const i = nearestA(j);
      splits.set(i, [...(splits.get(i) ?? []), j]);
    }
    for (const i of unmatchedA) {
      const j = nearestB(i);
      merges.set(j, [...(merges.get(j) ?? []), i]);
    }
    let partitionFallbacks = 0;
    const partitioned = (whole: ShapeComponent, partners: ShapeComponent[], wholeIsSource: boolean): boolean => {
      if (strategy !== "partition" || whole.holes.length > 0) return false;
      const targets = partners.map((partner, id) => {
        const at = wholeIsSource ? toSource(reg, partner.centroid) : toTarget(reg, partner.centroid);
        return { id, weight: Math.max(partner.area, 0), x: at.x, y: at.y };
      });
      // A hairline overlap (0.1% of the part's diagonal) hides antialiasing seams while pieces touch.
      const pieces = partitionRings([whole.outer], targets, boundsDiagonal(whole.bounds) * 1e-3);
      if (!pieces) return false;
      for (const [id, rings] of pieces) {
        for (const ring of rings) {
          const piece = makeComponent(ring, []);
          if (wholeIsSource) morph("partition", piece, partners[id]);
          else morph("partition", partners[id], piece);
        }
      }
      return true;
    };

    assignment.forEach((j, i) => {
      if (j < 0) return;
      const extraTargets = splits.get(i);
      const extraSources = merges.get(j);
      if (extraTargets) {
        const partners = [b[j], ...extraTargets.map((k) => b[k])];
        if (!partitioned(a[i], partners, true)) {
          if (strategy === "partition") partitionFallbacks += 1;
          morph("morph", a[i], b[j]);
          for (const k of extraTargets) morph("split", a[i], b[k]);
        }
      } else if (extraSources) {
        const partners = [a[i], ...extraSources.map((k) => a[k])];
        if (!partitioned(b[j], partners, false)) {
          if (strategy === "partition") partitionFallbacks += 1;
          morph("morph", a[i], b[j]);
          for (const k of extraSources) morph("merge", a[k], b[j]);
        }
      } else {
        morph("morph", a[i], b[j]);
      }
    });
    if (partitionFallbacks > 0) {
      diagnostics.push(warn("morph-partition-fallback", `${partitionFallbacks} part(s) have holes or could not be cut cleanly, so they split or merge as copies instead of pieces.`));
    }
  }

  /** Try correspondence candidates and remedies; keep the first track without transit crossings, or the best. */
  private bestMorphTrack(kind: MorphTrackKind, src: ShapeComponent, dst: ShapeComponent): { track: ComponentTrack | null; remaining: number } {
    const rotation = this.settings.alignment.rotation ?? "auto";
    const turns = rotation === "best-fit" ? [true] : rotation === "auto" ? [false, true] : [false];
    const hasHoles = src.holes.length > 0 || dst.holes.length > 0;
    const transport = this.settings.holeTransport;
    const cages = transport === "auto" ? (hasHoles ? [false, true] : [false]) : [transport === "cage"];
    const interpolation = this.settings.interpolation;
    const modes = interpolation === "auto" ? [false, true] : [interpolation === "intrinsic"];
    let best: ComponentTrack | null = null;
    let bestCrossings = Infinity;
    for (let rank = 0; rank < 3; rank += 1) {
      for (const intrinsic of modes) {
        // Intrinsic blending turns by itself, so it needs no separate turn candidate.
        for (const rotate of intrinsic ? [false] : turns) {
          for (const cage of cages) {
            const track = this.morphTrack(kind, src, dst, rank, rotate, cage, intrinsic);
            if (!track) continue;
            const found = transitCrossings(track, bestCrossings);
            if (found < bestCrossings) {
              best = track;
              bestCrossings = found;
            }
            if (bestCrossings === 0) return { track: best, remaining: 0 };
          }
        }
      }
    }
    return { track: best, remaining: Number.isFinite(bestCrossings) ? bestCrossings : 0 };
  }

  private pinsFor(ringA: Ring, ringB: Ring): AnchorPin[] {
    return this.anchorPins.filter((pin) => pin.ringA === ringA && pin.ringB === ringB);
  }

  private correspond(
    ringA: Ring, ringB: Ring, density: number, rank: number, rotate: boolean, turn: number,
  ): { samples: RingSamples; pins: AnchorPin[] } | null {
    const a = frameOf(ringA);
    const b = frameOf(ringB);
    const pins = this.pinsFor(ringA, ringB);
    let map: CyclicMap;
    let usedPins: AnchorPin[] = [];
    if (pins.length > 0) {
      if (rank > 0) return null;
      const pinned = pinnedMap(pins);
      map = pinned.map;
      usedPins = pins.filter((pin) => Array.from(pinned.map.ka).some((knot) => Math.abs(knot - pin.uA) < 1e-12));
    } else {
      const offsets = searchOffsets(a, b, rotate, turn);
      if (rank >= offsets.length) return null;
      map = offsetMap(offsets[rank]);
    }
    return { samples: ringSamples(a, b, map, density, usedPins.map((pin) => pin.uA)), pins: usedPins };
  }

  private morphTrack(
    kind: MorphTrackKind, src: ShapeComponent, dst: ShapeComponent, rank: number, rotate: boolean, cage: boolean, intrinsic: boolean,
  ): ComponentTrack | null {
    const outerDensity = this.densityFor(Math.max(src.perimeter, dst.perimeter));
    const outer = this.correspond(src.outer, dst.outer, outerDensity, rank, rotate, 0);
    if (!outer) return null;
    const bounds = this.settings.alignment.mode === "bounds";
    const scale0 = bounds ? Math.max(boundsDiagonal(src.bounds), 1e-9) : 1;
    const scale1 = bounds ? Math.max(boundsDiagonal(dst.bounds), 1e-9) : 1;
    const fit = bestFitTurn(outer.samples, src.centroid, dst.centroid);
    const theta = rotate ? fit : 0;
    const rigid = !intrinsic && (theta !== 0 || Math.abs(scale1 / scale0 - 1) > 1e-9);
    const params: RigidParams = { ax: src.centroid.x, ay: src.centroid.y, bx: dst.centroid.x, by: dst.centroid.y, scale0, scale1, theta };

    // Map source points into the target frame of this pair, and back, to match and seed holes.
    // Intrinsic blending turns the ring by about the best-fit angle, so holes follow that turn too.
    const turn = intrinsic ? fit : theta;
    const ratio = Math.max(boundsDiagonal(dst.bounds), 1e-9) / Math.max(boundsDiagonal(src.bounds), 1e-9);
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const forward = (p: Vec2): Vec2 => {
      const x = (p.x - src.centroid.x) * ratio;
      const y = (p.y - src.centroid.y) * ratio;
      return { x: dst.centroid.x + cos * x - sin * y, y: dst.centroid.y + sin * x + cos * y };
    };
    const backward = (p: Vec2): Vec2 => {
      const x = p.x - dst.centroid.x;
      const y = p.y - dst.centroid.y;
      return { x: src.centroid.x + (cos * x + sin * y) / ratio, y: src.centroid.y + (-sin * x + cos * y) / ratio };
    };

    const holeSamples: RingSamples[] = [];
    const holeCentroidsA = src.holes.map((hole) => ringCentroid(hole));
    const holeCentroidsB = dst.holes.map((hole) => ringCentroid(hole));
    const diagonal = Math.max(boundsDiagonal(dst.bounds), 1e-9);
    const holeCost = holeCentroidsA.map((ca, i) => {
      const mapped = forward(ca);
      return holeCentroidsB.map((cb, j) => {
        const distance = ((mapped.x - cb.x) ** 2 + (mapped.y - cb.y) ** 2) / (diagonal * diagonal);
        const areaRatio = Math.log((Math.abs(ringArea(src.holes[i])) * ratio * ratio + 1e-12) / (Math.abs(ringArea(dst.holes[j])) + 1e-12));
        return distance + 0.1 * areaRatio * areaRatio;
      });
    });
    const holeAssignment = solveAssignment(holeCost);
    const matchedHoleB = new Int32Array(dst.holes.length).fill(-1);
    holeAssignment.forEach((j, i) => {
      if (j >= 0) matchedHoleB[j] = i;
    });
    const usedPins = [...outer.pins];
    for (let i = 0; i < src.holes.length; i += 1) {
      const j = holeAssignment[i];
      const holeA = src.holes[i];
      if (j >= 0) {
        const holeB = dst.holes[j];
        const density = this.densityFor(Math.max(perimeterOf(holeA), perimeterOf(holeB)));
        const matched = this.correspond(holeA, holeB, density, 0, false, turn);
        if (!matched) return null;
        usedPins.push(...matched.pins);
        holeSamples.push(matched.samples);
      } else {
        const seed = this.seedInside(dst, forward(poleOfInaccessibility(holeA, [])));
        holeSamples.push(pointRingSamples(holeA, seed, this.densityFor(perimeterOf(holeA)), false));
      }
    }
    for (let j = 0; j < dst.holes.length; j += 1) {
      if (matchedHoleB[j] >= 0) continue;
      const holeB = dst.holes[j];
      const seed = this.seedInside(src, backward(poleOfInaccessibility(holeB, [])));
      holeSamples.push(pointRingSamples(holeB, seed, this.densityFor(perimeterOf(holeB)), true));
    }
    for (const pin of usedPins) pin.used = true;

    const outerTrack = ringTrack(outer.samples, rigid ? params : null);
    if (intrinsic) {
      outerTrack.intrinsic = intrinsicRing(outer.samples, fit);
      if (!outerTrack.intrinsic) return null;
    }
    const holes = holeSamples.map((samples) => {
      const track = ringTrack(samples, rigid ? params : null);
      if (cage) track.cage = cageBinding(outerTrack, samples);
      else if (intrinsic) track.intrinsic = intrinsicRing(samples, fit);
      return track;
    });
    return this.assemble(kind, outerTrack, holes, rigid ? params : null, 1, 1);
  }

  /** `point` when it lies inside the component's fill, otherwise the component's pole. */
  private seedInside(component: ShapeComponent, point: Vec2): Vec2 {
    return pointInPolygon(point.x, point.y, component.outer, component.holes) ? point : componentPole(component);
  }

  /** A part that grows from (`emerge`) or shrinks into (`vanish`) one point. */
  private pointTrack(kind: "emerge" | "vanish", component: ShapeComponent, seed: Vec2): ComponentTrack {
    const fromPoint = kind === "emerge";
    const rings = [component.outer, ...component.holes];
    const tracks = rings.map((ring) => ringTrack(pointRingSamples(ring, seed, this.densityFor(perimeterOf(ring)), fromPoint), null));
    return this.assemble(kind, tracks[0], tracks.slice(1), null, 1, 1);
  }

  /** A part that fades while it moves with the registration and shrinks to `dissolveScale`. */
  private fadeTrack(kind: "fade-in" | "fade-out", component: ShapeComponent): ComponentTrack {
    const reg = this.registration;
    const pole = componentPole(component);
    const shrink = this.settings.dissolveScale;
    const incoming = kind === "fade-in";
    const anchor = incoming ? toSource(reg, pole) : toTarget(reg, pole);
    const factor = incoming ? shrink / reg.k : shrink * reg.k;
    const rings = [component.outer, ...component.holes];
    const tracks = rings.map((ring) => {
      const count = ring.length >> 1;
      const moved = new Float64Array(ring.length);
      for (let i = 0; i < count; i += 1) {
        moved[2 * i] = anchor.x + factor * (ring[2 * i] - pole.x);
        moved[2 * i + 1] = anchor.y + factor * (ring[2 * i + 1] - pole.y);
      }
      return ringTrack(incoming ? { a: moved, b: ring, count, capped: false } : { a: ring, b: moved, count, capped: false }, null);
    });
    return this.assemble(kind, tracks[0], tracks.slice(1), null, incoming ? 0 : 1, incoming ? 1 : 0);
  }

  private assemble(kind: MorphTrackKind, outer: RingTrack, holes: RingTrack[], rigid: RigidParams | null, opacityFrom: number, opacityTo: number): ComponentTrack {
    return {
      kind, outer, holes, rigid: rigid !== null,
      ax: rigid?.ax ?? 0, ay: rigid?.ay ?? 0, bx: rigid?.bx ?? 0, by: rigid?.by ?? 0,
      scale0: rigid?.scale0 ?? 1, scaleRatio: rigid ? rigid.scale1 / rigid.scale0 : 1, theta: rigid?.theta ?? 0,
      opacityFrom, opacityTo,
      frame: { kind, outer: outer.out, holes: holes.map((hole) => hole.out), opacity: opacityFrom },
    };
  }
}

/* ------------------------------------------------------------------ *
 * Output adapters
 * ------------------------------------------------------------------ */

/** Trace one ring (interleaved x, y) into a path sink. */
export function traceMorphRing(sink: MorphPathSink, ring: ArrayLike<number>): void {
  if (ring.length < 6) return;
  sink.moveTo(ring[0], ring[1]);
  for (let i = 2; i < ring.length; i += 2) sink.lineTo(ring[i], ring[i + 1]);
  sink.closePath();
}

/**
 * Trace the components of a frame into a path sink, for example a `CanvasRenderingContext2D` after
 * `beginPath()`. Fill with `nonzero`. `include` selects components, for example by opacity.
 */
export function traceMorphFrame(sink: MorphPathSink, frame: MorphFrame, include?: (component: MorphComponentFrame) => boolean): void {
  for (const component of frame.components) {
    if (include && !include(component)) continue;
    traceMorphRing(sink, component.outer);
    for (const hole of component.holes) traceMorphRing(sink, hole);
  }
}

/**
 * SVG path data for a frame. Opaque components share one path, so their union has no seams; each fading
 * component gets its own path with its opacity. Use `fill-rule="nonzero"`. This allocates strings, so prefer
 * `traceMorphFrame` in a hot loop.
 */
export function morphFrameToSvgPaths(frame: MorphFrame, precision = 2): MorphSvgPath[] {
  const scale = 10 ** Math.max(0, Math.min(6, Math.round(precision)));
  const round = (value: number): number => Math.round(value * scale) / scale;
  const ringData = (ring: ArrayLike<number>): string => {
    if (ring.length < 6) return "";
    let d = `M${round(ring[0])} ${round(ring[1])}`;
    for (let i = 2; i < ring.length; i += 2) d += `L${round(ring[i])} ${round(ring[i + 1])}`;
    return `${d}Z`;
  };
  const componentData = (component: MorphComponentFrame): string => [component.outer, ...component.holes].map(ringData).join("");
  const paths: MorphSvgPath[] = [];
  let opaque = "";
  for (const component of frame.components) {
    if (component.opacity >= 0.999) opaque += componentData(component);
    else if (component.opacity > 0.001) paths.push({ d: componentData(component), opacity: component.opacity });
  }
  if (opaque) paths.unshift({ d: opaque, opacity: 1 });
  return paths;
}
