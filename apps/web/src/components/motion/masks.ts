/**
 * `mask-reveal` — clip / alpha / luma matte with deterministic reveal sweep,
 * feather, transform and a predictable compositing order (docs/08 §3
 * `mask-reveal`).
 *
 * The reveal is a *geometric* sweep: the mask rect grows from its declared
 * origin along a resolved axis. Every function is pure — `evaluateMask` returns
 * a new sample and never mutates the spec.
 *
 * ## Units and space
 * All coordinates are design pixels with a top-left origin, y-down (docs/11 §2).
 * `MaskSpec.rect` and `MaskSample.rect` are the *pre-transform* swept rect.
 * `MaskSample.polygon` is the swept rect's four corners (top-left, top-right,
 * bottom-right, bottom-left) after `MaskSpec.transform` has been applied; it is
 * the resolved geometry a renderer should draw. Because an affine transform can
 * rotate or skew, the resolved shape is a polygon rather than an axis-aligned
 * rect; `MaskSample.bounds` is its axis-aligned bounding box. A transform with
 * any non-finite coefficient is ignored (treated as identity) instead of
 * poisoning the geometry with `NaN`.
 *
 * ## Ownership of `MaskSpec`
 * The frozen `types.ts` is data-only and does not carry mask shapes, so the
 * mask contract lives here with the geometry lane. `MaskSpecLocal` adds the
 * reveal axis without touching the frozen module (see {@link MaskSpecLocal}).
 */

import type { AffineMatrix, Rect, Vec2 } from "./types";
import { applyMatrixToPoint } from "./matrix";

/** The three matte kinds a mask can resolve to. */
export const MASK_KINDS: Array<"clip" | "alpha" | "luma"> = ["clip", "alpha", "luma"];

/** Direction the reveal sweeps along. `"radial"` grows from the rect centre. */
export type MaskAxis =
  | "left-to-right"
  | "right-to-left"
  | "top-to-bottom"
  | "bottom-to-top"
  | "radial";

/** Matte declaration. Plain data, JSON-safe, renderer-neutral. */
export interface MaskSpec {
  /** Stable id used for diagnostics and ordering by the caller. */
  id?: string;
  kind: "clip" | "alpha" | "luma";
  /** Declaration rect in design px (top-left origin). */
  rect: Rect;
  /** Soft edge width in px. Default `0` (hard edge). */
  feather?: number;
  /** Compositing order; lower draws first. Default `0`. */
  order?: number;
  /** Optional transform applied to the mask geometry. */
  transform?: AffineMatrix;
}

/**
 * Local extension of {@link MaskSpec} adding the reveal axis. Kept out of the
 * frozen contract on purpose: renderers that ignore `axis` still consume a
 * valid `MaskSpec`.
 */
export type MaskSpecLocal = MaskSpec & { axis?: MaskAxis };

/** Resolved mask at one progress value. */
export interface MaskSample {
  id?: string;
  kind: "clip" | "alpha" | "luma";
  /**
   * Swept geometry *before* `transform`, in design px (top-left origin). Kept
   * so callers that only understand axis-aligned rects still work.
   */
  rect: Rect;
  /**
   * Resolved geometry after `transform`: the swept rect's corners as
   * `[top-left, top-right, bottom-right, bottom-left]`, in design px. Always
   * present (identity transform included), always a fresh array.
   */
  polygon: Vec2[];
  /** Axis-aligned bounds of {@link polygon}, in design px. */
  bounds: Rect;
  /** Clamped soft edge width in px; `0` when absent, negative or non-finite. */
  feather: number;
  /**
   * `feather` relative to the resolved mask's shortest side, clamped to
   * `[0, 1]`. Renderers that express softness as a fraction can use this;
   * it is `1` when the mask has collapsed to a point.
   */
  softness: number;
  /** Matte opacity: `progress` for alpha/luma, always `1` for clip. */
  opacity: number;
  /** Resolved compositing order (finite; defaults to `0`). */
  order: number;
  axis: MaskAxis;
  /**
   * The finite transform that was applied to {@link polygon}. A non-finite
   * matrix is omitted because it was ignored.
   */
  transform?: AffineMatrix;
}

const DEFAULT_AXIS: MaskAxis = "left-to-right";

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

/** Non-finite and negative feather widths collapse to a hard edge. */
function resolveFeather(feather: number | undefined): number {
  if (feather === undefined || !Number.isFinite(feather) || feather <= 0) return 0;
  return feather;
}

/** Normalize a px feather against the resolved mask's shortest side. */
function resolveSoftness(feather: number, rect: Rect): number {
  if (feather <= 0) return 0;
  const shortest = Math.min(Math.abs(rect.width), Math.abs(rect.height));
  if (!Number.isFinite(shortest) || shortest <= 0) return 1;
  return clamp01(feather / shortest);
}

/** `NaN`/infinite orders would make the stable sort comparator unreliable. */
function resolveOrder(order: number | undefined): number {
  if (order === undefined || !Number.isFinite(order)) return 0;
  return order;
}

/** The four corners of an axis-aligned rect, clockwise from top-left. */
function rectCorners(rect: Rect): Vec2[] {
  const { x, y, width, height } = rect;
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
}

function pointBounds(points: Vec2[]): Rect {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function isFiniteMatrix(m: AffineMatrix): boolean {
  return [m.a, m.b, m.c, m.d, m.e, m.f].every((value) => Number.isFinite(value));
}

/** Grow the declaration rect from its origin along the resolved axis. */
function sweepRect(rect: Rect, axis: MaskAxis, progress: number): Rect {
  switch (axis) {
    case "right-to-left":
      return {
        x: rect.x + rect.width * (1 - progress),
        y: rect.y,
        width: rect.width * progress,
        height: rect.height,
      };
    case "top-to-bottom":
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height * progress };
    case "bottom-to-top":
      return {
        x: rect.x,
        y: rect.y + rect.height * (1 - progress),
        width: rect.width,
        height: rect.height * progress,
      };
    case "radial":
      return {
        x: rect.x + (rect.width * (1 - progress)) / 2,
        y: rect.y + (rect.height * (1 - progress)) / 2,
        width: rect.width * progress,
        height: rect.height * progress,
      };
    case "left-to-right":
    default:
      return { x: rect.x, y: rect.y, width: rect.width * progress, height: rect.height };
  }
}

/**
 * Resolve a mask at `progress` (clamped to `[0, 1]`). `opacity` is `progress`
 * for alpha/luma mattes and `1` for clip. Returns a fresh sample whose
 * `polygon`/`bounds` include `spec.transform`, whose `feather` is clamped and
 * whose `softness` is normalized for direct renderer use.
 */
export function evaluateMask(spec: MaskSpec, progress: number): MaskSample {
  const p = clamp01(progress);
  const axis = (spec as MaskSpecLocal).axis ?? DEFAULT_AXIS;
  const rect = sweepRect(spec.rect, axis, p);
  const feather = resolveFeather(spec.feather);

  const transform =
    spec.transform !== undefined && isFiniteMatrix(spec.transform)
      ? spec.transform
      : undefined;
  const corners = rectCorners(rect);
  const polygon = transform
    ? corners.map((corner) => applyMatrixToPoint(transform, corner))
    : corners;

  const sample: MaskSample = {
    kind: spec.kind,
    rect,
    polygon,
    bounds: pointBounds(polygon),
    feather,
    softness: resolveSoftness(feather, rect),
    opacity: spec.kind === "clip" ? 1 : p,
    order: resolveOrder(spec.order),
    axis,
  };
  if (spec.id !== undefined) sample.id = spec.id;
  if (transform !== undefined) sample.transform = { ...transform };
  return sample;
}

/**
 * Stable compositing order: sort by `order`, then by original array position so
 * equal orders keep their declaration order (no `Array#sort` instability).
 */
export function resolveMaskOrder(masks: MaskSample[]): MaskSample[] {
  return masks
    .map((mask, index) => ({ mask, index }))
    .sort((a, b) => (a.mask.order - b.mask.order) || (a.index - b.index))
    .map((entry) => entry.mask);
}

/**
 * Capability + fallback declaration for a matte kind, so a renderer that cannot
 * honour `luma` degrades to `alpha`, and one without alpha degrades to `clip`.
 */
export function maskCapability(spec: MaskSpec): { capability: string; fallback: string } {
  switch (spec.kind) {
    case "luma":
      return { capability: "mask-luma", fallback: "alpha" };
    case "alpha":
      return { capability: "mask-alpha", fallback: "clip" };
    case "clip":
    default:
      return { capability: "mask-clip", fallback: "none" };
  }
}
