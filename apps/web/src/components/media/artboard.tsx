import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CSSProperties,
  HTMLAttributes,
  KeyboardEvent,
  MutableRefObject,
  ReactNode,
} from "react";
import type {
  ArtboardSpec,
  Diagnostic,
  GridSpec,
  Guide,
  Insets,
  Layer,
} from "./document";
import type { MediaCanvasContextValue, MediaCanvasPoint } from "./media-context";
import {
  MediaCanvasContext,
  clampZoom,
  useMediaCanvasOrDefault,
} from "./media-context";

/**
 * How the authoring frame is scaled inside its viewport. Each value is a
 * distinct, deliberately different display mode; all three are authoring-only
 * and never affect the exported geometry.
 *
 * - `"none"` — the author's `zoom` is the scale. Nothing is measured and the
 *   container size is ignored, so the frame can overflow the viewport.
 * - `"actual"` — authoring at true 1:1: exactly one design pixel per CSS
 *   pixel, ignoring both `zoom` and the container size. This is the "actual
 *   size" affordance used to judge real pixel density; the surrounding
 *   container scrolls when the artboard does not fit. The zoom controls are
 *   intentionally inert in this mode (see {@link ArtboardProps.onZoomChange}).
 * - `"contain"` — scale down to fit the container, never upscaling the fit
 *   factor (`min(1, containerW/width, containerH/height)`), then multiplied by
 *   `zoom`. The frame always fits unless `zoom` pushes it past `1`.
 */
export type ArtboardFit = "none" | "contain" | "actual";

export interface ArtboardProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> {
  /** Design-space definition: dimensions, background, safe region, bleed and crop. */
  artboard: ArtboardSpec;
  /** Authoring zoom. @default 1 */
  zoom?: number;
  /** Authoring pan in CSS px. @default { x: 0, y: 0 } */
  pan?: MediaCanvasPoint;
  /**
   * Authoring display mode. `"none"` uses the raw `zoom`; `"actual"` renders at
   * exactly 1:1 (one design px per CSS px), ignoring both `zoom` and the
   * container size; `"contain"` scales the artboard down to fit the container
   * (never upscaling the fit factor) and multiplies by `zoom`. Defaults to
   * `"none"` so existing consumers are unaffected. @default "none"
   */
  fit?: ArtboardFit;
  /** Draw the safe-region outline. @default false */
  showSafeRegion?: boolean;
  /** Draw the bleed outline (expanded outward). @default false */
  showBleed?: boolean;
  /** Draw the crop/trim outline (inset from the edges). @default false */
  showCrop?: boolean;
  /** Currently selected layer ids, shared through the canvas context. @default [] */
  selectedIds?: readonly string[];
  /** Selection callback shared through the canvas context. */
  onSelect?: (id: string | null) => void;
  /**
   * Called when a keyboard zoom shortcut changes the authoring zoom. Always
   * wired, but while `fit="actual"` the reported zoom does not change the
   * rendered scale (the frame stays at 1:1); this inertness is intentional.
   */
  onZoomChange?: (zoom: number) => void;
  /** Called when a keyboard pan shortcut changes the authoring pan (CSS px). */
  onPanChange?: (pan: MediaCanvasPoint) => void;
  /** True while a text layer is being edited. @default false */
  editing?: boolean;
  /** Static guides shared through the canvas context. @default [] */
  guides?: readonly Guide[];
  /** Grid definition shared through the canvas context. */
  grid?: GridSpec;
  /** Validation diagnostics shared through the canvas context. @default [] */
  diagnostics?: readonly Diagnostic[];
  /** Layer painter delegated to a consumer (e.g. `LayerStack`) through the context. */
  renderLayer?: (layer: Layer) => ReactNode;
  /** Content rendered inside the design frame. */
  children?: ReactNode;
}

/** Authoring zoom steps reachable with `+`/`-`. Fixed so zoom never drifts. */
const ZOOM_LADDER = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4] as const;

const ORIGIN: MediaCanvasPoint = { x: 0, y: 0 };
const NO_SELECTION: readonly string[] = [];
const NO_GUIDES: readonly Guide[] = [];
const NO_DIAGNOSTICS: readonly Diagnostic[] = [];

/**
 * The viewport is the authoring surface *and* a scroll container. `min-w-0`
 * gives it a shrink floor and `max-w-full` caps it, so an artboard wider than
 * its available column scrolls *inside* the viewport instead of stretching the
 * surrounding layout; `overflow-auto` is what reveals that (possibly oversized)
 * frame. It stays focusable (`tabIndex` plus the ring below) so it is a
 * keyboard-reachable scroll region rather than a hidden one, and `bg-canvas`
 * gives the surrounding authoring area its surface.
 *
 * It stays a `flex` container, but it deliberately does *not* align its child
 * (`items-center`/`justify-center` are gone): centring is delegated to the
 * child's auto margins (see {@link SCALE_WRAPPER_CLASSES}). Flex is still
 * required so those auto margins can centre on *both* axes, but — unlike flex
 * alignment, which pins an oversized child at a negative offset and strands its
 * leading overflow — auto margins centre only when there is free space and
 * collapse to zero under negative free space, so an oversized frame lands at the
 * scroll origin (top-left) and stays reachable.
 */
const VIEWPORT_CLASSES = [
  "relative flex min-w-0 max-w-full overflow-auto bg-canvas",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
].join(" ");

/**
 * Non-clipping scale wrapper. It carries the authoring `transform: scale(...)`
 * and the design-px box so absolutely-positioned overlays can draw outside the
 * trim (notably bleed) while the frame itself keeps clipping the artwork.
 *
 * `m-auto` is the centring contract. With free space the auto margins split it
 * evenly on both axes, centring the frame exactly as the viewport's old
 * `items-center justify-center` did; with negative free space (an oversized
 * frame) they resolve to zero and the wrapper is placed at the scroll origin, so
 * the whole scrollable extent — the top-left origin the artboard model documents
 * included — is reachable. `shrink-0` keeps the design-px box at its authored
 * size so the frame overflows and scrolls instead of being squeezed.
 */
const SCALE_WRAPPER_CLASSES = "relative m-auto shrink-0";

/** The trim box: exact design-px size, background and clipping of the artwork. */
const FRAME_CLASSES = "relative overflow-hidden";

/**
 * Overlays are authoring chrome and must always sit above the artwork, so they
 * get an explicit stacking order instead of relying on DOM order: layers are
 * free to set their own `z-index`, which would otherwise paint over the guides.
 */
const OVERLAY_Z_INDEX = 9999;

const OVERLAY_CLASSES = "pointer-events-none absolute";
const SAFE_REGION_CLASSES = joinClasses(OVERLAY_CLASSES, "border border-dashed border-border");
const BLEED_CLASSES = joinClasses(OVERLAY_CLASSES, "border border-dashed border-input");
const CROP_CLASSES = joinClasses(OVERLAY_CLASSES, "border border-input");

/** Design px moved per arrow-key press, before zoom scaling. */
const PAN_STEP = 8;
const PAN_STEP_FAST = 40;

function joinClasses(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

/** Parse a computed CSS length, treating anything unparseable as `0`. */
function toPixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Position a box inset from each edge of its parent. */
function insetStyle(insets: Insets): CSSProperties {
  return {
    top: insets.top,
    right: insets.right,
    bottom: insets.bottom,
    left: insets.left,
  };
}

/** Position a box expanded outward from each edge of its parent. */
function outsetStyle(insets: Insets): CSSProperties {
  return {
    top: -insets.top,
    right: -insets.right,
    bottom: -insets.bottom,
    left: -insets.left,
  };
}

/** Nearest zoom-ladder value strictly above (`1`) or below (`-1`) the current zoom. */
function stepZoom(current: number, direction: 1 | -1): number {
  if (direction === 1) {
    for (const value of ZOOM_LADDER) {
      if (value > current + 1e-9) return value;
    }
    return ZOOM_LADDER[ZOOM_LADDER.length - 1];
  }
  for (let index = ZOOM_LADDER.length - 1; index >= 0; index -= 1) {
    if (ZOOM_LADDER[index] < current - 1e-9) return ZOOM_LADDER[index];
  }
  return ZOOM_LADDER[0];
}

/**
 * M0 design-space frame.
 *
 * `Artboard` owns the explicit dimensions, background, safe region, bleed and
 * crop of a fixed-size artwork and publishes a {@link MediaCanvasContextValue}
 * so `LayerStack`, `EditableText`, `MediaFrame` and `AlignmentGuides` share one
 * origin, one selection model and one set of guides.
 *
 * Authoring affordances — zoom, pan, the `fit` mode, keyboard shortcuts and the
 * safe-region/bleed/crop overlays — are never part of the exported geometry:
 * they change only how the frame is displayed inside its viewport. Keyboard
 * panning (arrows, 8 design px; Shift, 40) and zoom stepping (`+`/`=`, `-`/`_`,
 * `0` to reset) call `onPanChange`/`onZoomChange` and are inert when those
 * handlers are absent, so a static artboard leaves the arrow keys to the page.
 *
 * The viewport *contains* an oversized artboard: it carries a shrink floor
 * (`min-w-0`) and a width cap (`max-w-full`) and scrolls its own content
 * (`overflow-auto`), so a frame larger than the available space scrolls inside
 * the viewport instead of widening the surrounding layout. Centring is achieved
 * with auto margins on the scale wrapper rather than the viewport's flex
 * alignment: the frame is centred while it fits, and when it overflows the auto
 * margins collapse to zero so the frame sits at the scroll origin and its
 * top-left origin — the origin the artboard model documents — is reachable by
 * scrolling. The frame is the clipping box (`relative overflow-hidden`), while
 * the scale wrapper stays non-clipping so the bleed outline can draw outside the
 * trim. Because the viewport clips at its scroll edges, the bleed outline is
 * reachable on every edge only where the frame leaves slack at that edge: a
 * scroll container's origin is coordinate zero and nothing can be scrolled to a
 * negative offset, so when the frame fills or overflows the viewport the leading
 * (left/top) bleed pixels fall at negative coordinates and are clipped. The
 * artboard *origin* is now reachable in every case; the outermost leading
 * *bleed* pixels are not, and are never hidden or removed, only clipped at the
 * scroll origin.
 */
const Artboard = forwardRef<HTMLDivElement, ArtboardProps>(function Artboard(
  {
    artboard,
    zoom = 1,
    pan = ORIGIN,
    fit = "none",
    showSafeRegion = false,
    showBleed = false,
    showCrop = false,
    selectedIds = NO_SELECTION,
    onSelect,
    onZoomChange,
    onPanChange,
    editing = false,
    guides = NO_GUIDES,
    grid,
    diagnostics = NO_DIAGNOSTICS,
    renderLayer,
    className,
    children,
    onKeyDown,
    ...props
  },
  ref
) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(
    null
  );

  const setViewportRef = useCallback(
    (node: HTMLDivElement | null) => {
      viewportRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as MutableRefObject<HTMLDivElement | null>).current = node;
    },
    [ref]
  );

  // `fit="contain"` needs the viewport's *content* box; measure it and track
  // resizes so the frame keeps fitting when the surrounding layout changes.
  //
  // The content box is the border box minus the viewport's own border and
  // padding, so a consumer that adds `p-*`/`border-*` through `className` never
  // makes the fit factor too large (a too-large factor would overflow again).
  // The measurement runs in a layout effect — after the viewport has been laid
  // out — and reads the border box, which is pinned to the parent by the
  // `min-w-0`/`max-w-full` floor and therefore cannot be moved by the scale it
  // feeds: no resolution loop. The scrollbar gutter is intentionally *not*
  // subtracted, because folding it in would make the measured box depend on the
  // overflow that the scale determines.
  useLayoutEffect(() => {
    if (fit !== "contain") return;
    const element = viewportRef.current;
    if (!element) return;

    const measure = () => {
      const rect = element.getBoundingClientRect();
      const styles = window.getComputedStyle(element);
      const horizontal =
        toPixels(styles.paddingLeft) +
        toPixels(styles.paddingRight) +
        toPixels(styles.borderLeftWidth) +
        toPixels(styles.borderRightWidth);
      const vertical =
        toPixels(styles.paddingTop) +
        toPixels(styles.paddingBottom) +
        toPixels(styles.borderTopWidth) +
        toPixels(styles.borderBottomWidth);
      setContainerSize({
        width: Math.max(0, rect.width - horizontal),
        height: Math.max(0, rect.height - vertical),
      });
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [fit]);

  // `fit="actual"` is exactly one design px per CSS px: it ignores both `zoom`
  // and the container. `fit="contain"` fits the measured container (never
  // upscaling the fit factor) and still applies `zoom`; `fit="none"` is raw zoom.
  const effectiveScale = useMemo(() => {
    if (fit === "actual") return clampZoom(1);
    const scale =
      fit === "contain" && containerSize && artboard.width > 0 && artboard.height > 0
        ? Math.min(
            1,
            containerSize.width / artboard.width,
            containerSize.height / artboard.height
          ) * zoom
        : zoom;
    return clampZoom(scale);
  }, [fit, containerSize, artboard.width, artboard.height, zoom]);

  const contextValue = useMemo<MediaCanvasContextValue>(
    () => ({
      artboard,
      zoom,
      pan,
      scale: effectiveScale,
      offset: pan,
      editing,
      selectedIds,
      onSelect,
      guides,
      grid,
      diagnostics,
      renderLayer,
    }),
    [
      artboard,
      zoom,
      pan,
      effectiveScale,
      editing,
      selectedIds,
      onSelect,
      guides,
      grid,
      diagnostics,
      renderLayer,
    ]
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;

    const { key } = event;

    if (key === "+" || key === "=") {
      if (!onZoomChange) return;
      event.preventDefault();
      onZoomChange(stepZoom(zoom, 1));
      return;
    }

    if (key === "-" || key === "_") {
      if (!onZoomChange) return;
      event.preventDefault();
      onZoomChange(stepZoom(zoom, -1));
      return;
    }

    if (key === "0") {
      if (!onZoomChange && !onPanChange) return;
      event.preventDefault();
      onZoomChange?.(1);
      onPanChange?.({ x: 0, y: 0 });
      return;
    }

    let dx = 0;
    let dy = 0;
    if (key === "ArrowLeft") dx = -1;
    else if (key === "ArrowRight") dx = 1;
    else if (key === "ArrowUp") dy = -1;
    else if (key === "ArrowDown") dy = 1;
    if (dx === 0 && dy === 0) return;

    if (!onPanChange) return;
    event.preventDefault();
    const step = (event.shiftKey ? PAN_STEP_FAST : PAN_STEP) * effectiveScale;
    onPanChange({ x: pan.x + dx * step, y: pan.y + dy * step });
  };

  const boxSize: CSSProperties = {
    width: `${artboard.width}px`,
    height: `${artboard.height}px`,
  };

  // Scale lives on the wrapper, not the frame, so the frame keeps clipping the
  // artwork while the bleed outline can draw outside the trim. `top left` keeps
  // frame and overlays aligned under scaling.
  const scaleWrapperStyle: CSSProperties = {
    ...boxSize,
    transform: `scale(${effectiveScale})`,
    transformOrigin: "top left",
  };

  const frameStyle: CSSProperties = {
    ...boxSize,
    background: artboard.background,
  };

  return (
    <div
      ref={setViewportRef}
      data-km-artboard="viewport"
      tabIndex={0}
      className={joinClasses(VIEWPORT_CLASSES, className)}
      onKeyDown={handleKeyDown}
      {...props}
    >
      {/* Presentational scale wrapper: no DOM-props surface, no clipping. */}
      <div className={SCALE_WRAPPER_CLASSES} style={scaleWrapperStyle}>
        <div
          data-km-artboard="root"
          data-km-artboard-fit={fit}
          data-km-artboard-dimensions={`${artboard.width}x${artboard.height}`}
          className={FRAME_CLASSES}
          style={frameStyle}
        >
          <MediaCanvasContext.Provider value={contextValue}>
            {children}
          </MediaCanvasContext.Provider>
        </div>
        {showBleed ? (
          <div
            data-km-artboard="bleed"
            aria-hidden="true"
            className={BLEED_CLASSES}
            style={{ ...outsetStyle(artboard.bleed), zIndex: OVERLAY_Z_INDEX }}
          />
        ) : null}
        {showCrop ? (
          <div
            data-km-artboard="crop"
            aria-hidden="true"
            className={CROP_CLASSES}
            style={{ ...insetStyle(artboard.crop), zIndex: OVERLAY_Z_INDEX }}
          />
        ) : null}
        {showSafeRegion ? (
          <div
            data-km-artboard="safe-region"
            aria-hidden="true"
            className={SAFE_REGION_CLASSES}
            style={{ ...insetStyle(artboard.safeRegion), zIndex: OVERLAY_Z_INDEX }}
          />
        ) : null}
      </div>
    </div>
  );
});

Artboard.displayName = "Artboard";

/** Reads the surrounding artboard context, or the standalone default when none is present. */
export function useArtboardContext(): MediaCanvasContextValue {
  return useMediaCanvasOrDefault();
}

export { Artboard };
export default Artboard;
