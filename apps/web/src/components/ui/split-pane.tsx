import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type {
  CSSProperties,
  HTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";

function joinClasses(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

/** Unit used by `primarySize`, `defaultPrimarySize` and the size bounds. */
export type SplitPaneUnit = "percent" | "pixels";

/** Axis the two panels are laid out on. `"horizontal"` places them side by side. */
export type SplitPaneOrientation = "horizontal" | "vertical";

export interface SplitPaneProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Controlled size of the primary panel, in `unit`. */
  primarySize?: number;
  /**
   * Initial size of the primary panel when uncontrolled, in `unit`.
   * @default 50 (percent) / 240 (pixels)
   */
  defaultPrimarySize?: number;
  /** Called with the next clamped size whenever the divider moves. */
  onPrimarySizeChange?: (size: number) => void;
  /**
   * Smallest size the primary panel may reach, in `unit`.
   * @default 10 (percent) / 0 (pixels)
   */
  minPrimarySize?: number;
  /**
   * Largest size the primary panel may reach, in `unit`. In pixels mode this is
   * additionally capped to the measured panel space (container minus divider).
   * @default 90 (percent) / measured space (pixels)
   */
  maxPrimarySize?: number;
  /**
   * Measurement unit for all size props.
   * @default "percent"
   */
  unit?: SplitPaneUnit;
  /**
   * Layout axis. `"horizontal"` is side by side with a vertical divider;
   * `"vertical"` stacks the panels with a horizontal divider.
   * @default "horizontal"
   */
  orientation?: SplitPaneOrientation;
  /** Accessible name of the divider. @default "Resize panels" */
  "aria-label"?: string;
  /** Content of the leading (left/top) panel. */
  primary: ReactNode;
  /** Content of the trailing (right/bottom) panel. */
  secondary: ReactNode;
  /** Ignore all pointer and keyboard resizing and remove the divider from tab order. @default false */
  disabled?: boolean;
  /** Extra classes merged onto the root grid. */
  className?: string;
}

/** Thickness of the divider track, mirrored by the `w-2` / `h-2` classes. */
const DIVIDER_PX = 8;
const DEFAULT_PERCENT_SIZE = 50;
const DEFAULT_PERCENT_MIN = 10;
const DEFAULT_PERCENT_MAX = 90;
const DEFAULT_PIXEL_SIZE = 240;
/** Pre-measurement ceiling in pixels; replaced by the measured panel space on mount. */
const FALLBACK_PIXEL_MAX = 600;
const PERCENT_STEP = 1;
const PIXEL_STEP = 10;

const ROOT_CLASSES = "grid w-full min-h-0 min-w-0 overflow-hidden";
const PRIMARY_CLASSES = "min-h-0 min-w-0 overflow-auto bg-surface";
const SECONDARY_CLASSES = "min-h-0 min-w-0 overflow-auto bg-canvas";

const BASE_DIVIDER_CLASSES = [
  "relative select-none touch-none bg-border",
  "transition-colors duration-[var(--km-duration-short)] ease-continuity",
  "hover:bg-ring active:bg-ring data-[dragging]:bg-ring",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
  "data-[disabled]:cursor-not-allowed data-[disabled]:bg-border",
  "data-[disabled]:hover:bg-border data-[disabled]:active:bg-border",
].join(" ");

// A centred 1px grip marks the divider as a drag control without darkening the
// whole 8px band. `--km-border-strong` (exposed as `bg-input`) clears the 3:1
// non-text contrast bar against both panels (≈4.3:1 light, ≈3.1:1 dark), which
// the resting `bg-border` track at ~1.6:1 does not.
const HORIZONTAL_DIVIDER_CLASSES = [
  "w-2 cursor-col-resize",
  "before:absolute before:inset-y-0 before:-inset-x-2 before:content-['']",
  "after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2",
  "after:bg-input after:content-['']",
].join(" ");

const VERTICAL_DIVIDER_CLASSES = [
  "h-2 cursor-row-resize",
  "before:absolute before:inset-x-0 before:-inset-y-2 before:content-['']",
  "after:absolute after:inset-x-0 after:top-1/2 after:h-px after:-translate-y-1/2",
  "after:bg-input after:content-['']",
].join(" ");

const sizeFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
});

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

interface Bounds {
  lower: number;
  upper: number;
}

/**
 * Resolve the declared bounds into a stable, ordered range. Percentage bounds
 * are kept inside 0–100; pixel bounds are capped to the measured panel space
 * when one is available so the primary panel can never overflow the container.
 */
function resolveBounds(
  unit: SplitPaneUnit,
  minPrimarySize: number | undefined,
  maxPrimarySize: number | undefined,
  availablePixels: number
): Bounds {
  if (unit === "percent") {
    const lower = clamp(
      minPrimarySize ?? DEFAULT_PERCENT_MIN,
      0,
      100
    );
    const declaredMax = clamp(
      maxPrimarySize ?? DEFAULT_PERCENT_MAX,
      0,
      100
    );
    return { lower, upper: Math.max(lower, declaredMax) };
  }

  const lower = Math.max(0, minPrimarySize ?? 0);
  const measured = availablePixels > 0 ? availablePixels : undefined;
  const declared = Math.max(lower, maxPrimarySize ?? measured ?? FALLBACK_PIXEL_MAX);
  return {
    lower,
    upper: measured === undefined ? declared : Math.max(lower, Math.min(declared, measured)),
  };
}

/** Clamp, make finite and round to the precision the unit can honestly express. */
function normalizeSize(
  raw: number,
  bounds: Bounds,
  unit: SplitPaneUnit
): number {
  const finite = Number.isFinite(raw) ? raw : bounds.lower;
  const rounded =
    unit === "percent" ? Math.round(finite * 10) / 10 : Math.round(finite);
  return clamp(rounded, bounds.lower, bounds.upper);
}

function formatSize(value: number, unit: SplitPaneUnit): string {
  if (unit === "percent") {
    return `${sizeFormatter.format(value)}%`;
  }
  return `${sizeFormatter.format(value)} ${value === 1 ? "pixel" : "pixels"}`;
}

interface DragState {
  pointerId: number;
  startPosition: number;
  startSize: number;
  available: number;
}

/**
 * Two-panel layout with a divider that is equally usable by pointer, touch and
 * keyboard.
 *
 * The divider is a focusable `role="separator"` exposing its current and
 * permitted sizes. Arrow keys move it by one step along the layout axis,
 * Home/End jump to the bounds, and a pointer drag is captured on the divider so
 * it keeps tracking outside the container. Sizes are always clamped to a valid,
 * ordered range — percentages stay within 0–100 and pixel sizes are capped to
 * the measured panel space — so no gesture can produce a negative or
 * out-of-range value.
 *
 * The primary panel takes the declared size and the secondary panel receives
 * the remainder, both shrinking to zero before the container overflows. All
 * colour, focus, radius and motion styling comes from semantic tokens.
 */
const SplitPane = forwardRef<HTMLDivElement, SplitPaneProps>(function SplitPane(
  {
    primarySize,
    defaultPrimarySize,
    onPrimarySizeChange,
    minPrimarySize,
    maxPrimarySize,
    unit = "percent",
    orientation = "horizontal",
    "aria-label": ariaLabel = "Resize panels",
    primary,
    secondary,
    disabled = false,
    className,
    style,
    ...props
  },
  ref
) {
  const isHorizontal = orientation === "horizontal";
  const isControlled = primarySize !== undefined;
  const [uncontrolledSize, setUncontrolledSize] = useState<number>(
    defaultPrimarySize ?? (unit === "percent" ? DEFAULT_PERCENT_SIZE : DEFAULT_PIXEL_SIZE)
  );
  const [availablePixels, setAvailablePixels] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const dividerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const setContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      containerRef.current = node;
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        (ref as MutableRefObject<HTMLDivElement | null>).current = node;
      }
    },
    [ref]
  );

  // Pixel mode needs the real panel length both for ARIA bounds and for the
  // drag math. Percentage mode can derive everything from the measured length
  // at pointerdown, so this state only matters for pixels.
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    function measure() {
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const dividerRect = dividerRef.current?.getBoundingClientRect();
      const total = isHorizontal ? rect.width : rect.height;
      const thickness = dividerRect
        ? isHorizontal
          ? dividerRect.width
          : dividerRect.height
        : DIVIDER_PX;
      const next = Math.round(total - (thickness || DIVIDER_PX));
      setAvailablePixels(next > 0 ? next : 0);
    }

    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [isHorizontal]);

  useEffect(() => {
    if (!disabled) return;
    dragRef.current = null;
    setIsDragging(false);
  }, [disabled]);

  const bounds = resolveBounds(unit, minPrimarySize, maxPrimarySize, availablePixels);
  const rawSize = isControlled ? primarySize : uncontrolledSize;
  const size = normalizeSize(rawSize, bounds, unit);
  const dividerOrientation = isHorizontal ? "vertical" : "horizontal";
  const baseId = useId();
  const primaryId = `${baseId}-primary`;
  const secondaryId = `${baseId}-secondary`;

  function commitSize(raw: number) {
    const next = normalizeSize(raw, bounds, unit);
    if (next === size) return;
    if (!isControlled) setUncontrolledSize(next);
    onPrimarySizeChange?.(next);
  }

  function measureAvailable(): number {
    const element = containerRef.current;
    if (!element) return 0;
    const rect = element.getBoundingClientRect();
    const dividerRect = dividerRef.current?.getBoundingClientRect();
    const total = isHorizontal ? rect.width : rect.height;
    const thickness = dividerRect
      ? isHorizontal
        ? dividerRect.width
        : dividerRect.height
      : DIVIDER_PX;
    const available = total - (thickness || DIVIDER_PX);
    return available > 0 ? available : 0;
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (disabled) return;

    const increaseKey = isHorizontal ? "ArrowRight" : "ArrowDown";
    const decreaseKey = isHorizontal ? "ArrowLeft" : "ArrowUp";
    const step = unit === "percent" ? PERCENT_STEP : PIXEL_STEP;

    if (event.key === increaseKey) {
      event.preventDefault();
      commitSize(size + step);
      return;
    }
    if (event.key === decreaseKey) {
      event.preventDefault();
      commitSize(size - step);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      commitSize(bounds.lower);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      commitSize(bounds.upper);
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (disabled) return;
    if (event.button > 0) return;

    // Stop the browser from starting a text selection under the drag.
    event.preventDefault();
    const element = event.currentTarget;
    element.setPointerCapture?.(event.pointerId);

    const measured = measureAvailable();
    dragRef.current = {
      pointerId: event.pointerId,
      startPosition: isHorizontal ? event.clientX : event.clientY,
      startSize: size,
      // A zero-length container cannot be dragged meaningfully; a 100-unit
      // fallback keeps the math finite without inventing negative sizes.
      available: measured > 0 ? measured : 100,
    };
    setIsDragging(true);
    element.focus();
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || disabled) return;

    event.preventDefault();
    const position = isHorizontal ? event.clientX : event.clientY;
    const delta = position - drag.startPosition;
    const raw =
      unit === "percent"
        ? drag.startSize + (delta / drag.available) * 100
        : drag.startSize + delta;
    commitSize(raw);
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // The pointer was not captured (for example in a test environment).
    }
    dragRef.current = null;
    setIsDragging(false);
  }

  function handleLostPointerCapture() {
    dragRef.current = null;
    setIsDragging(false);
  }

  const gridStyle: CSSProperties = isHorizontal
    ? {
        gridTemplateColumns:
          unit === "percent"
            ? `minmax(0, ${size}fr) ${DIVIDER_PX}px minmax(0, ${100 - size}fr)`
            : `minmax(0, ${size}px) ${DIVIDER_PX}px minmax(0, 1fr)`,
      }
    : {
        gridTemplateRows:
          unit === "percent"
            ? `minmax(0, ${size}fr) ${DIVIDER_PX}px minmax(0, ${100 - size}fr)`
            : `minmax(0, ${size}px) ${DIVIDER_PX}px minmax(0, 1fr)`,
      };

  return (
    <div
      ref={setContainerRef}
      data-km-split-pane="root"
      data-orientation={orientation}
      data-unit={unit}
      data-disabled={disabled ? "true" : undefined}
      data-dragging={isDragging ? "true" : undefined}
      className={joinClasses(
        ROOT_CLASSES,
        isDragging && "select-none",
        disabled && "opacity-70",
        className
      )}
      style={{ ...gridStyle, ...(style ?? {}) }}
      {...props}
    >
      <div
        id={primaryId}
        data-km-split-pane="primary"
        data-part="primary"
        className={PRIMARY_CLASSES}
      >
        {primary}
      </div>
      <div
        ref={dividerRef}
        role="separator"
        aria-label={ariaLabel}
        aria-orientation={dividerOrientation}
        aria-valuenow={size}
        aria-valuemin={bounds.lower}
        aria-valuemax={bounds.upper}
        aria-valuetext={formatSize(size, unit)}
        aria-controls={primaryId}
        aria-disabled={disabled ? "true" : undefined}
        tabIndex={disabled ? -1 : 0}
        data-km-split-pane="divider"
        data-part="divider"
        data-disabled={disabled ? "true" : undefined}
        data-dragging={isDragging ? "true" : undefined}
        className={joinClasses(
          BASE_DIVIDER_CLASSES,
          isHorizontal ? HORIZONTAL_DIVIDER_CLASSES : VERTICAL_DIVIDER_CLASSES
        )}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={handleLostPointerCapture}
      />
      <div
        id={secondaryId}
        data-km-split-pane="secondary"
        data-part="secondary"
        className={SECONDARY_CLASSES}
      >
        {secondary}
      </div>
    </div>
  );
});

SplitPane.displayName = "SplitPane";

export { SplitPane };
export default SplitPane;
