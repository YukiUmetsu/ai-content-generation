/**
 * Shared paint resolution for the infographic renderers.
 *
 * Gradients and elevation shadows need SVG `<defs>`, and their ids must be
 * unique per document so several infographics can share one page. Both the DOM
 * preview (`react.tsx`) and the static exporter (`svg.ts`) call
 * {@link resolvePaint}, so they emit identical definitions and references —
 * the same backend-parity rule the dash and text helpers follow.
 *
 * Shadows use a per-primitive filter in user space, sized from the primitive's
 * bounds plus the blur reach. A bounding-box-relative filter region would clip
 * the blur on long, thin shapes such as timeline bars.
 */

import { primitiveBounds, round } from "./primitives";
import type { ElevationPaint, GradientPaint, InfographicPrimitive, RectPrimitive, TextPrimitive } from "./types";

export interface GradientDef {
  kind: "gradient";
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  from: string;
  to: string;
  toOpacity: number;
}

export interface ShadowLayer {
  dy: number;
  blur: number;
  opacity: number;
}

export interface ShadowDef {
  kind: "shadow";
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  layers: readonly ShadowLayer[];
}

export type PaintDef = GradientDef | ShadowDef;

export interface ResolvedPaint {
  defs: PaintDef[];
  /** `fill` attribute value for a primitive (gradient url or plain color). */
  fillFor: (primitive: InfographicPrimitive) => string | undefined;
  /** `filter` attribute value, when the primitive is elevated. */
  filterFor: (primitive: InfographicPrimitive) => string | undefined;
}

/**
 * Ambient (wide, faint) + key (tight, darker) layers per elevation level. Two
 * layers read as soft, physical light; one heavy blur reads as a smudge.
 */
export const ELEVATION_LAYERS: Readonly<Record<ElevationPaint["level"], readonly ShadowLayer[]>> = {
  1: [
    { dy: 1, blur: 1.5, opacity: 0.08 },
    { dy: 6, blur: 12, opacity: 0.07 },
  ],
  2: [
    { dy: 2, blur: 3, opacity: 0.1 },
    { dy: 14, blur: 24, opacity: 0.1 },
  ],
  3: [
    { dy: 3, blur: 5, opacity: 0.12 },
    { dy: 24, blur: 40, opacity: 0.14 },
  ],
};

const DIRECTION_VECTORS: Record<NonNullable<GradientPaint["direction"]>, [number, number, number, number]> = {
  down: [0, 0, 0, 1],
  up: [0, 1, 0, 0],
  right: [0, 0, 1, 0],
  left: [1, 0, 0, 0],
};

function paintOf(primitive: InfographicPrimitive): { fill?: string; gradient?: GradientPaint; elevation?: ElevationPaint } {
  if (primitive.kind === "rect" || primitive.kind === "ellipse" || primitive.kind === "path") return primitive;
  return {};
}

/** Make an arbitrary string safe for use inside an XML id. */
export function safeDomId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_");
}

/**
 * Resolve every gradient and shadow definition a page needs, keyed under
 * `scope` (a per-document unique prefix).
 */
export function resolvePaint(primitives: readonly InfographicPrimitive[], scope: string): ResolvedPaint {
  const prefix = safeDomId(scope);
  const defs: PaintDef[] = [];
  const fills = new Map<string, string>();
  const filters = new Map<string, string>();

  for (const primitive of primitives) {
    const paint = paintOf(primitive);
    if (!paint.gradient && !paint.elevation) continue;
    const bounds = primitiveBounds(primitive);
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) continue;
    const base = `${prefix}-${safeDomId(primitive.id)}`;

    if (paint.gradient && paint.fill) {
      const [x1, y1, x2, y2] = DIRECTION_VECTORS[paint.gradient.direction ?? "down"];
      const id = `${base}-g`;
      // User-space coordinates: the gradient spans the primitive's own bounds,
      // which also works for paths whose bounding box differs from their fill.
      defs.push({
        kind: "gradient",
        id,
        x1: round(bounds.x + bounds.width * x1),
        y1: round(bounds.y + bounds.height * y1),
        x2: round(bounds.x + bounds.width * x2),
        y2: round(bounds.y + bounds.height * y2),
        from: paint.fill,
        to: paint.gradient.to,
        toOpacity: paint.gradient.toOpacity ?? 1,
      });
      fills.set(primitive.id, `url(#${id})`);
    }

    if (paint.elevation) {
      const layers = ELEVATION_LAYERS[paint.elevation.level];
      const reach = Math.max(...layers.map((layer) => layer.blur * 3 + layer.dy));
      const id = `${base}-s`;
      defs.push({
        kind: "shadow",
        id,
        x: round(bounds.x - reach),
        y: round(bounds.y - reach),
        width: round(bounds.width + reach * 2),
        height: round(bounds.height + reach * 2),
        color: paint.elevation.color,
        layers,
      });
      filters.set(primitive.id, `url(#${id})`);
    }
  }

  return {
    defs,
    fillFor: (primitive) => fills.get(primitive.id) ?? paintOf(primitive).fill,
    filterFor: (primitive) => filters.get(primitive.id),
  };
}

/** Anchor x for a text primitive under SVG `text-anchor`, shared by both renderers. */
export function textAnchorX(primitive: TextPrimitive): number {
  if (primitive.align === "center") return round(primitive.x + primitive.width / 2);
  if (primitive.align === "end") return round(primitive.x + primitive.width);
  return primitive.x;
}

/**
 * Effective corner radius: SVG clamps `rx` and `ry` independently, so a pill
 * radius (999) on a wide, short rect would otherwise draw an ellipse. Clamping
 * both to half the shorter side yields a true stadium shape in every renderer.
 */
export function cornerRadius(primitive: RectPrimitive): number | undefined {
  if (!primitive.radius) return undefined;
  return round(Math.max(0, Math.min(primitive.radius, primitive.width / 2, primitive.height / 2)));
}
