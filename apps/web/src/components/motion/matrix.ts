/**
 * Motion core — 2D affine matrix math (docs/08 §2, screen space, top-left origin).
 *
 * A matrix is stored as `{ a, b, c, d, e, f }` and applied to a point as:
 *
 *     | a  c  e |
 *     | b  d  f |
 *     | 0  0  1 |
 *
 *     x' = a·x + c·y + e
 *     y' = b·x + d·y + f
 *
 * Composition order is explicit: `multiplyMatrix(a, b)` means *apply `a`, then
 * `b`*. Every helper is pure and deterministic.
 */

import type { AffineMatrix, Diagnostic, TransformNode, Vec2 } from "./types";
import { createDiagnostic } from "./diagnostics";

/** The identity transform. */
export const IDENTITY: AffineMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** Translation by `(x, y)`. */
export function translationMatrix(x: number, y: number): AffineMatrix {
  return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
}

/** Rotation by `radians` (clockwise in a top-left origin, y-down space). */
export function rotationMatrix(radians: number): AffineMatrix {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

/** Independent axis scale. */
export function scaleMatrix(sx: number, sy: number): AffineMatrix {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

/** Linear-algebra product `x · y` (applies `y` first, then `x`). */
function laMul(x: AffineMatrix, y: AffineMatrix): AffineMatrix {
  return {
    a: x.a * y.a + x.c * y.b,
    b: x.b * y.a + x.d * y.b,
    c: x.a * y.c + x.c * y.d,
    d: x.b * y.c + x.d * y.d,
    e: x.a * y.e + x.c * y.f + x.e,
    f: x.b * y.e + x.d * y.f + x.f,
  };
}

/** Matrix for "apply `a`, then `b`" — i.e. `b · a` in linear-algebra terms. */
export function multiplyMatrix(a: AffineMatrix, b: AffineMatrix): AffineMatrix {
  return laMul(b, a);
}

/** Inverse, or `null` when the matrix is singular. */
export function invertMatrix(m: AffineMatrix): AffineMatrix | null {
  const det = m.a * m.d - m.b * m.c;
  if (det === 0 || !Number.isFinite(det)) return null;
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

/** Transform a position (translation included). */
export function applyMatrixToPoint(m: AffineMatrix, p: Vec2): Vec2 {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

/** Transform a direction (translation ignored). */
export function applyMatrixToVector(m: AffineMatrix, v: Vec2): Vec2 {
  return { x: m.a * v.x + m.c * v.y, y: m.b * v.x + m.d * v.y };
}

/** Skew matrix from `{ x: skewXRadians, y: skewYRadians }`. */
function skewMatrix(skew: Vec2): AffineMatrix {
  return { a: 1, b: Math.tan(skew.y), c: Math.tan(skew.x), d: 1, e: 0, f: 0 };
}

/**
 * Compose `T(origin) · R · Sk · S · T(-origin)` — i.e. shrink to the pivot,
 * scale, skew, rotate, then translate back. `origin` defaults to `(0, 0)`.
 */
export function composeMatrix(parts: {
  translate?: Vec2;
  rotate?: number;
  scale?: Vec2;
  skew?: Vec2;
  origin?: Vec2;
}): AffineMatrix {
  const translate = parts.translate ?? { x: 0, y: 0 };
  const scale = parts.scale ?? { x: 1, y: 1 };
  const skew = parts.skew ?? { x: 0, y: 0 };
  const origin = parts.origin ?? { x: 0, y: 0 };
  const rotate = parts.rotate ?? 0;

  let m: AffineMatrix = translationMatrix(-origin.x, -origin.y);
  m = multiplyMatrix(m, scaleMatrix(scale.x, scale.y));
  m = multiplyMatrix(m, skewMatrix(skew));
  m = multiplyMatrix(m, rotationMatrix(rotate));
  m = multiplyMatrix(m, translationMatrix(origin.x + translate.x, origin.y + translate.y));
  return m;
}

/**
 * Decompose a matrix into translate / rotate / scale / skew (skewX radians).
 * The inverse of {@link composeMatrix} with a zero origin: recomposing the
 * returned parts reproduces the input for any invertible matrix.
 */
export function decomposeMatrix(m: AffineMatrix): {
  translate: Vec2;
  rotate: number;
  scale: Vec2;
  skew: number;
} {
  const { a, b, c, d, e, f } = m;
  const sx = Math.hypot(a, b);
  if (sx > 0) {
    const ca = a / sx;
    const sa = b / sx;
    const rotate = Math.atan2(sa, ca);
    // R(-rotate) · L  ==  Skew · Scale
    const nc = ca * c + sa * d;
    const nd = -sa * c + ca * d;
    return {
      translate: { x: e, y: f },
      rotate,
      scale: { x: sx, y: nd },
      skew: Math.atan2(nc, nd),
    };
  }
  // Degenerate X basis (column 1 collapses): fall back to a pure Y scale.
  return {
    translate: { x: e, y: f },
    rotate: 0,
    scale: { x: 0, y: Math.hypot(c, d) },
    skew: 0,
  };
}

/** Interpolate an angle with a sign-preserving, magnitude-monotonic path. */
function lerpScaleAxis(a: number, b: number, t: number): number {
  if (a > 0 !== b > 0 && a !== 0 && b !== 0) {
    const magnitude = Math.abs(a) + (Math.abs(b) - Math.abs(a)) * t;
    return t >= 0.5 ? Math.sign(b) * magnitude : Math.sign(a) * magnitude;
  }
  return a + (b - a) * t;
}

/**
 * Matrix interpolation: decompose both endpoints, lerp translate / scale,
 * interpolate rotation (and skew) along the shortest arc, then recompose.
 * `t = 0` yields `a` and `t = 1` yields `b` (up to floating point).
 */
export function interpolateMatrix(a: AffineMatrix, b: AffineMatrix, t: number): AffineMatrix {
  const da = decomposeMatrix(a);
  const db = decomposeMatrix(b);
  return composeMatrix({
    translate: {
      x: lerpNumber(da.translate.x, db.translate.x, t),
      y: lerpNumber(da.translate.y, db.translate.y, t),
    },
    rotate: da.rotate + shortestAngleDelta(da.rotate, db.rotate) * t,
    scale: {
      x: lerpScaleAxis(da.scale.x, db.scale.x, t),
      y: lerpScaleAxis(da.scale.y, db.scale.y, t),
    },
    skew: { x: lerpNumber(da.skew, db.skew, t), y: 0 },
  });
}

/**
 * Resolve world transforms parent-before-child.
 *
 * - A missing parent emits `transform-parent-missing` (error); the parent is
 *   treated as identity.
 * - A parent cycle emits `transform-parent-cycle` (error) per participating
 *   node; the parent link is treated as identity.
 * - A duplicate node id emits `transform-duplicate-id` (warning); the first
 *   definition wins.
 */
export function resolveWorldTransforms(nodes: TransformNode[]): {
  transforms: Record<string, AffineMatrix>;
  diagnostics: Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [];
  const byId = new Map<string, TransformNode>();

  for (const node of nodes) {
    if (byId.has(node.id)) {
      diagnostics.push(
        createDiagnostic(
          "transform-duplicate-id",
          "warning",
          `Duplicate transform node id "${node.id}"; the first definition wins.`,
        ),
      );
      continue;
    }
    byId.set(node.id, node);
  }

  // Detect every node that participates in a parent cycle.
  const cyclic = new Set<string>();
  for (const node of byId.values()) {
    const seen = new Set<string>();
    let cur: string | undefined = node.id;
    while (cur !== undefined) {
      if (seen.has(cur)) {
        let c: string | undefined = cur;
        do {
          cyclic.add(c);
          c = byId.get(c)?.parentId;
        } while (c !== undefined && c !== cur);
        break;
      }
      seen.add(cur);
      cur = byId.get(cur)?.parentId;
    }
  }

  for (const node of byId.values()) {
    if (cyclic.has(node.id)) {
      diagnostics.push(
        createDiagnostic(
          "transform-parent-cycle",
          "error",
          `Transform node "${node.id}" participates in a parent cycle; its parent is treated as identity.`,
        ),
      );
    }
  }

  const world = new Map<string, AffineMatrix>();
  const missingReported = new Set<string>();

  const pivotLocal = (node: TransformNode): AffineMatrix => {
    if (!node.pivot) return node.local;
    const toPivot = translationMatrix(-node.pivot.x, -node.pivot.y);
    const fromPivot = translationMatrix(node.pivot.x, node.pivot.y);
    return multiplyMatrix(multiplyMatrix(toPivot, node.local), fromPivot);
  };

  const resolve = (id: string): AffineMatrix => {
    const cached = world.get(id);
    if (cached) return cached;
    const node = byId.get(id);
    if (!node) return IDENTITY;

    let parentWorld = IDENTITY;
    const parentId = node.parentId;
    if (parentId !== undefined && !cyclic.has(id)) {
      const parent = byId.get(parentId);
      if (!parent) {
        if (!missingReported.has(id)) {
          missingReported.add(id);
          diagnostics.push(
            createDiagnostic(
              "transform-parent-missing",
              "error",
              `Transform node "${id}" references missing parent "${parentId}"; the parent is treated as identity.`,
            ),
          );
        }
      } else if (!cyclic.has(parentId)) {
        parentWorld = resolve(parentId);
      }
    }

    // Apply the node's local transform first, then the parent's world transform.
    const result = multiplyMatrix(pivotLocal(node), parentWorld);
    world.set(id, result);
    return result;
  };

  const transforms: Record<string, AffineMatrix> = {};
  for (const id of byId.keys()) {
    transforms[id] = resolve(id);
  }

  return { transforms, diagnostics };
}

/** Normalize an angle to `(-π, π]`. */
export function normalizeAngle(radians: number): number {
  const twoPi = Math.PI * 2;
  let r = radians % twoPi;
  if (r > Math.PI) r -= twoPi;
  if (r <= -Math.PI) r += twoPi;
  return r;
}

/** Shortest signed delta from `from` to `to`, in `(-π, π]`. */
export function shortestAngleDelta(from: number, to: number): number {
  return normalizeAngle(to - from);
}

/** Linear interpolation between two numbers. */
export function lerpNumber(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
