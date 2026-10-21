import { forwardRef, useCallback, useMemo } from "react";
import type { CSSProperties, HTMLAttributes } from "react";
import type {
  ArtboardSpec,
  GridSpec,
  Guide,
  Layer,
  Rect,
  SnapHit,
  SnapOptions,
  SnapResult,
  SnapTarget,
} from "./document";
import { applySnap, round, snapTargets } from "./document";
import { designToCss, useMediaCanvasOrDefault } from "./media-context";

/**
 * Export contract, asserted in code so it can never be flipped by accident: the
 * alignment overlay is authoring chrome only. The SVG/PNG exporters build from a
 * {@link MediaDocument} (layers, guides, grid), never from this DOM, and every
 * node here is `aria-hidden` and marked `data-km-guides-exportable="false"`.
 */
export const ALIGNMENT_GUIDES_EXPORTABLE = false;

/** A box the overlay measures, with an optional author-supplied label override. */
export interface MeasurementTarget {
  id: string;
  rect: Rect;
  label?: string;
}

/** Fallbacks keep repeated drag frames allocation-free; identity only changes when inputs do. */
const EMPTY_GUIDES: readonly Guide[] = [];
const EMPTY_MEASUREMENTS: readonly MeasurementTarget[] = [];
const EMPTY_SNAPS: readonly SnapHit[] = [];

/** Rough per-character advance used only to keep a chip from spilling past the artboard edge. */
const CHIP_CHAR_WIDTH = 7;
const CHIP_PADDING_X = 12;
const CHIP_HEIGHT = 20;
const CHIP_GAP = 4;

/** How many CSS px of perpendicular reach an end tick or snap tick should show. */
const TICK_CSS = 6;
const SNAP_TICK_CSS = 8;
const SNAP_LINE_CSS = 2;

/** Merge conditional class lists, dropping empty entries. */
function joinClasses(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

/**
 * Single-layer CSS-linear-gradient grid.
 *
 * A `grid.size` cell on a 4K artboard is tens of thousands of lines; drawing them
 * as DOM nodes (or as SVG) would balloon the authoring tree, hurt layout and leak
 * into any DOM-based capture. Two `repeating-linear-gradient`s per axis encode
 * every line analytically instead: minor lines every `size` design px, stronger
 * major lines every `size * subdivisions`, each exactly one hairline thick.
 */
function buildGridStyle(grid: GridSpec, hairline: number): CSSProperties {
  const minor = grid.size;
  const subdivisions = Math.max(1, Math.floor(grid.subdivisions));
  const major = minor * subdivisions;
  const majorColor = "var(--km-border-strong)";
  const minorColor = "var(--km-border-subtle)";

  return {
    backgroundImage: [
      `repeating-linear-gradient(to right, ${majorColor} 0, ${majorColor} ${hairline}px, transparent ${hairline}px, transparent ${major}px)`,
      `repeating-linear-gradient(to bottom, ${majorColor} 0, ${majorColor} ${hairline}px, transparent ${hairline}px, transparent ${major}px)`,
      `repeating-linear-gradient(to right, ${minorColor} 0, ${minorColor} ${hairline}px, transparent ${hairline}px, transparent ${minor}px)`,
      `repeating-linear-gradient(to bottom, ${minorColor} 0, ${minorColor} ${hairline}px, transparent ${hairline}px, transparent ${minor}px)`,
    ].join(", "),
  };
}

/** Conservative chip width estimate so the clamp keeps the rendered label inside the frame. */
function estimateChipWidth(text: string): number {
  return text.length * CHIP_CHAR_WIDTH + CHIP_PADDING_X;
}

/**
 * Clamp a label origin so the whole chip stays within the artboard; the overlay is
 * client-rendered in design px, so a label pinned to a box at the trim edge would
 * otherwise be clipped by the frame's `overflow: hidden`.
 */
function clampLabelPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  frame: Pick<ArtboardSpec, "width" | "height">
): { x: number; y: number } {
  const maxX = Math.max(0, frame.width - width);
  const maxY = Math.max(0, frame.height - height);
  return { x: Math.min(Math.max(0, x), maxX), y: Math.min(Math.max(0, y), maxY) };
}

/**
 * Authoring overlay: grid, static guides, safe region, centre axes, measurement
 * rulers and live snap indicators.
 *
 * It is deliberately non-exporting ({@link ALIGNMENT_GUIDES_EXPORTABLE}) and never
 * focusable or announced: everything is `aria-hidden` and `pointer-events-none`,
 * so it can sit above the artwork without stealing interaction or reading order.
 * Geometry is expressed in design px and scaled by the surrounding canvas; the
 * whole overlay renders `null` when hidden or when `scale` drops below
 * `minimumScale`, because a sub-pixel grid is noise rather than information.
 */
export interface AlignmentGuidesProps extends HTMLAttributes<HTMLDivElement> {
  /** Mount the overlay at all. @default true */
  visible?: boolean;
  /** Draw static guides (canvas guides win; see `guides`). @default true */
  showGuides?: boolean;
  /** Draw the grid when a grid is declared. @default true */
  showGrid?: boolean;
  /** Draw the safe-region outline. @default false */
  showSafeRegion?: boolean;
  /** Draw dashed centre axes labelled "50%". @default false */
  showCenterAxes?: boolean;
  /** Draw measurement rulers when `measurements` is given. @default true */
  showMeasurements?: boolean;
  /** Design-px lines to draw when the surrounding canvas declares none. */
  guides?: readonly Guide[];
  /** Grid definition; falls back to the canvas grid. */
  grid?: GridSpec;
  /** Boxes to measure, each showing its size and x/y offset. @default [] */
  measurements?: readonly MeasurementTarget[];
  /** Snap hits to highlight, normally the last `useAlignmentGuides().snap` result. @default [] */
  activeSnaps?: readonly SnapHit[];
  /** Suppressed below this zoom so the overlay does not turn into noise. @default 0.5 */
  minimumScale?: number;
}

/**
 * Targets plus a snapping function for a drag session.
 *
 * `snapTargets` is expensive to rebuild (it walks every visible layer's bounds),
 * so it is memoised on the canvas artboard/guides identity and the caller's
 * `layers`/`options` identity: repeated pointer-move frames during a drag reuse
 * the same candidate list and only run the cheap {@link applySnap}. Pure and
 * deterministic — no timers, no randomness, no DOM reads.
 */
export function useAlignmentGuides(
  layers: readonly Layer[],
  options?: SnapOptions
): {
  targets: SnapTarget[];
  snap: (rect: Rect) => SnapResult;
} {
  const { artboard, guides } = useMediaCanvasOrDefault();

  const targets = useMemo(
    () => snapTargets(layers, artboard, guides, options),
    [layers, artboard, guides, options]
  );

  const snap = useCallback((rect: Rect) => applySnap(rect, targets, options), [targets, options]);

  return useMemo(() => ({ targets, snap }), [targets, snap]);
}

/**
 * Non-exporting authoring overlay. See {@link AlignmentGuidesProps}.
 */
const AlignmentGuides = forwardRef<HTMLDivElement, AlignmentGuidesProps>(
  function AlignmentGuides(
    {
      visible = true,
      showGuides = true,
      showGrid = true,
      showSafeRegion = false,
      showCenterAxes = false,
      showMeasurements = true,
      guides: guidesProp,
      grid: gridProp,
      measurements = EMPTY_MEASUREMENTS,
      activeSnaps = EMPTY_SNAPS,
      minimumScale = 0.5,
      className,
      ...props
    },
    ref
  ) {
    const canvas = useMediaCanvasOrDefault();
    const { artboard } = canvas;
    const scale = canvas.scale;

    if (!visible || !Number.isFinite(scale) || scale < minimumScale) return null;

    // The canvas is the single source of the design-px → CSS-px mapping. Derive the
    // factor from `designToCss` rather than re-deriving it, so the overlay can size
    // its hairlines/tick marks to a constant CSS thickness at any zoom.
    const cssOrigin = designToCss({ x: 0, y: 0 }, canvas);
    const cssUnit = designToCss({ x: 1, y: 1 }, canvas);
    const cssPerDesign = cssUnit.x - cssOrigin.x;
    const safeScale = cssPerDesign > 0 ? cssPerDesign : 1;
    const hairline = 1 / safeScale;
    const tick = TICK_CSS / safeScale;
    const snapTick = SNAP_TICK_CSS / safeScale;
    const snapLine = SNAP_LINE_CSS / safeScale;

    const gridSpec = showGrid ? gridProp ?? canvas.grid ?? null : null;
    const gridStyle =
      gridSpec && gridSpec.visible && gridSpec.size > 0 ? buildGridStyle(gridSpec, hairline) : null;

    const resolvedGuides = canvas.guides.length > 0 ? canvas.guides : guidesProp ?? EMPTY_GUIDES;

    const centerX = round(artboard.width / 2);
    const centerY = round(artboard.height / 2);

    const centerXLabel = clampLabelPosition(
      centerX + CHIP_GAP,
      CHIP_GAP,
      estimateChipWidth("50%"),
      CHIP_HEIGHT,
      artboard
    );
    const centerYLabel = clampLabelPosition(
      CHIP_GAP,
      centerY + CHIP_GAP,
      estimateChipWidth("50%"),
      CHIP_HEIGHT,
      artboard
    );

    return (
      <div
        ref={ref}
        {...props}
        data-km-guides="root"
        data-km-guides-exportable={String(ALIGNMENT_GUIDES_EXPORTABLE)}
        aria-hidden="true"
        className={joinClasses("pointer-events-none absolute inset-0", className)}
      >
        {gridStyle ? (
          <div data-km-guides="grid" className="pointer-events-none absolute inset-0" style={gridStyle} />
        ) : null}

        {showSafeRegion ? (
          <div
            data-km-guides="safe-region"
            className="pointer-events-none absolute border border-dashed border-border"
            style={{
              top: artboard.safeRegion.top,
              right: artboard.safeRegion.right,
              bottom: artboard.safeRegion.bottom,
              left: artboard.safeRegion.left,
            }}
          />
        ) : null}

        {showGuides
          ? resolvedGuides.map((guide) => (
              <div
                key={guide.id}
                data-km-guides="guide"
                data-km-guide-id={guide.id}
                data-km-guide-axis={guide.axis}
                className="pointer-events-none absolute bg-border"
                style={
                  guide.axis === "x"
                    ? { left: guide.position, top: 0, width: hairline, height: artboard.height }
                    : { left: 0, top: guide.position, width: artboard.width, height: hairline }
                }
              />
            ))
          : null}

        {showCenterAxes ? (
          <>
            <div
              data-km-guides="center-axis"
              data-km-guide-axis="x"
              className="pointer-events-none absolute border-dashed border-input"
              style={{
                left: centerX,
                top: 0,
                width: 0,
                height: artboard.height,
                borderLeftWidth: hairline,
                boxSizing: "content-box",
              }}
            />
            <div
              data-km-guides="center-axis"
              data-km-guide-axis="y"
              className="pointer-events-none absolute border-dashed border-input"
              style={{
                left: 0,
                top: centerY,
                width: artboard.width,
                height: 0,
                borderTopWidth: hairline,
                boxSizing: "content-box",
              }}
            />
            <div
              data-km-guides="center-axis-label"
              className="pointer-events-none absolute rounded-sm border border-border bg-surface-floating px-1.5 py-0.5 text-caption text-foreground"
              style={{ left: centerXLabel.x, top: centerXLabel.y }}
            >
              50%
            </div>
            <div
              data-km-guides="center-axis-label"
              className="pointer-events-none absolute rounded-sm border border-border bg-surface-floating px-1.5 py-0.5 text-caption text-foreground"
              style={{ left: centerYLabel.x, top: centerYLabel.y }}
            >
              50%
            </div>
          </>
        ) : null}

        {showMeasurements
          ? measurements.map((target) => {
              const { rect } = target;
              const text =
                target.label ??
                `${round(rect.width)} × ${round(rect.height)} · x ${round(rect.x)} · y ${round(rect.y)}`;
              const chipWidth = estimateChipWidth(text);
              const chip = clampLabelPosition(
                rect.x,
                rect.y - CHIP_HEIGHT - CHIP_GAP,
                chipWidth,
                CHIP_HEIGHT,
                artboard
              );

              return (
                <div key={target.id}>
                  <div
                    data-km-guides="measurement"
                    data-km-measurement-id={target.id}
                    className="pointer-events-none absolute border border-border"
                    style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
                  />
                  <div
                    data-km-guides="measurement-ruler"
                    data-km-measurement-id={target.id}
                    data-km-ruler-axis="x"
                    className="pointer-events-none absolute bg-border"
                    style={{ left: rect.x, top: rect.y, width: rect.width, height: hairline }}
                  />
                  <div
                    data-km-guides="measurement-ruler"
                    data-km-measurement-id={target.id}
                    data-km-ruler-axis="y"
                    className="pointer-events-none absolute bg-border"
                    style={{ left: rect.x, top: rect.y, width: hairline, height: rect.height }}
                  />
                  <div
                    className="pointer-events-none absolute bg-border"
                    style={{ left: rect.x, top: rect.y, width: hairline, height: tick }}
                  />
                  <div
                    className="pointer-events-none absolute bg-border"
                    style={{ left: rect.x + rect.width - hairline, top: rect.y, width: hairline, height: tick }}
                  />
                  <div
                    className="pointer-events-none absolute bg-border"
                    style={{ left: rect.x, top: rect.y, width: tick, height: hairline }}
                  />
                  <div
                    className="pointer-events-none absolute bg-border"
                    style={{ left: rect.x, top: rect.y + rect.height - hairline, width: tick, height: hairline }}
                  />
                  <div
                    data-km-guides="measurement-label"
                    data-km-measurement-id={target.id}
                    className="pointer-events-none absolute rounded-sm border border-border bg-surface-floating px-1.5 py-0.5 text-caption text-foreground"
                    style={{ left: chip.x, top: chip.y }}
                  >
                    {text}
                  </div>
                </div>
              );
            })
          : null}

        {activeSnaps.map((hit, index) => (
          <div
            key={`${hit.axis}-${hit.target.kind}-${index}`}
            data-km-guides="snap"
            data-km-snap-axis={hit.axis}
            data-km-snap-kind={hit.target.kind}
            className="pointer-events-none absolute inset-0"
          >
            <div
              className="pointer-events-none absolute border-dashed border-status-info"
              style={
                hit.axis === "x"
                  ? {
                      left: hit.position,
                      top: 0,
                      width: 0,
                      height: artboard.height,
                      borderLeftWidth: snapLine,
                      boxSizing: "content-box",
                    }
                  : {
                      left: 0,
                      top: hit.position,
                      width: artboard.width,
                      height: 0,
                      borderTopWidth: snapLine,
                      boxSizing: "content-box",
                    }
              }
            />
            <div
              className="pointer-events-none absolute bg-status-info"
              style={
                hit.axis === "x"
                  ? {
                      left: hit.position - snapTick / 2,
                      top: artboard.height / 2,
                      width: snapTick,
                      height: snapLine,
                    }
                  : {
                      left: artboard.width / 2,
                      top: hit.position - snapTick / 2,
                      width: snapLine,
                      height: snapTick,
                    }
              }
            />
          </div>
        ))}
      </div>
    );
  }
);

AlignmentGuides.displayName = "AlignmentGuides";

export { AlignmentGuides };
export default AlignmentGuides;
