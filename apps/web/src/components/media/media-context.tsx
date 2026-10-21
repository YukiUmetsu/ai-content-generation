/**
 * Shared React context for the M0 media canvas.
 *
 * Every media component is usable on its own: `useMediaCanvas` returns a
 * sensible standalone default (a 1280×720 artboard at 1× zoom) when no
 * `<Artboard>` is above it. Wrapping components in an `Artboard` upgrades them
 * to a shared design space — one zoom/pan, one selection model, one set of
 * guides — without any component reaching into another's internals.
 */

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { ArtboardSpec, Diagnostic, GridSpec, Guide, Layer } from "./document";
import { createArtboard } from "./document";

export interface MediaCanvasPoint {
  x: number;
  y: number;
}

export interface MediaCanvasContextValue {
  /** Design-space definition: dimensions, background, safe region, bleed, crop. */
  artboard: ArtboardSpec;
  /** Authoring zoom. Never affects exported geometry. */
  zoom: number;
  /** Authoring pan in CSS px. Never affects exported geometry. */
  pan: MediaCanvasPoint;
  /** Effective design-px → CSS-px factor (`zoom` clamped to a safe range). */
  scale: number;
  /** CSS-px translation applied after scaling. */
  offset: MediaCanvasPoint;
  /** True while a text layer is being edited; layers stop intercepting events. */
  editing: boolean;
  /** Stable selection, used by `LayerStack` and `AlignmentGuides`. */
  selectedIds: readonly string[];
  onSelect?: (id: string | null) => void;
  /** Guides and grid declared on the canvas; excluded from every export. */
  guides: readonly Guide[];
  grid?: GridSpec;
  /** Validation diagnostics for the whole document, surfaced by `ExportPreview`. */
  diagnostics: readonly Diagnostic[];
  /** Lets an `Artboard` delegate layer painting to a custom renderer (e.g. LayerStack). */
  renderLayer?: (layer: Layer) => ReactNode;
}

/** Fallback canvas so a media component renders correctly with no `Artboard` ancestor. */
export const DEFAULT_MEDIA_CANVAS: MediaCanvasContextValue = {
  artboard: createArtboard({ id: "standalone", preset: "16:9", background: "#ffffff" }),
  zoom: 1,
  pan: { x: 0, y: 0 },
  scale: 1,
  offset: { x: 0, y: 0 },
  editing: false,
  selectedIds: [],
  guides: [],
  diagnostics: [],
};

export const MediaCanvasContext = createContext<MediaCanvasContextValue | null>(null);

/** Reads the surrounding canvas, or `null` when the component is standalone. */
export function useMediaCanvas(): MediaCanvasContextValue | null {
  return useContext(MediaCanvasContext);
}

/** Reads the surrounding canvas, falling back to {@link DEFAULT_MEDIA_CANVAS}. Never throws. */
export function useMediaCanvasOrDefault(): MediaCanvasContextValue {
  return useContext(MediaCanvasContext) ?? DEFAULT_MEDIA_CANVAS;
}

/** Clamps authoring zoom to a range that cannot overflow layout math. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(64, Math.max(0.02, zoom));
}

/**
 * Design px → CSS px for the current zoom/pan. Used by overlays (guides,
 * selection handles, measurements) so they stay pixel-aligned with layers.
 */
export function designToCss(
  point: MediaCanvasPoint,
  canvas: Pick<MediaCanvasContextValue, "scale" | "offset">
): MediaCanvasPoint {
  return { x: point.x * canvas.scale + canvas.offset.x, y: point.y * canvas.scale + canvas.offset.y };
}

/** CSS px → design px, the inverse of {@link designToCss}. */
export function cssToDesign(
  point: MediaCanvasPoint,
  canvas: Pick<MediaCanvasContextValue, "scale" | "offset">
): MediaCanvasPoint {
  const scale = canvas.scale === 0 ? 1 : canvas.scale;
  return { x: (point.x - canvas.offset.x) / scale, y: (point.y - canvas.offset.y) / scale };
}

export { MediaCanvasContext as default };
