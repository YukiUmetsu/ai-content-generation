import { forwardRef, useLayoutEffect, useRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { Slider as SliderPrimitive } from "@base-ui/react/slider";

function joinClasses(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

/** A single value, or one value per thumb for a range slider. */
export type SliderValue = number | number[];

export interface SliderProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "defaultValue" | "children"> {
  /** Controlled value. Pass an array to render a range with one thumb per entry. */
  value?: SliderValue;
  /** Initial value when uncontrolled. Defaults to `min`. */
  defaultValue?: SliderValue;
  /** Called with the next value: a number for a single thumb, an array for a range. */
  onValueChange?: (value: SliderValue) => void;
  /** Lowest selectable value. @default 0 */
  min?: number;
  /** Highest selectable value. @default 100 */
  max?: number;
  /** Granularity between selectable values. @default 1 */
  step?: number;
  /** Ignore all pointer and keyboard interaction. @default false */
  disabled?: boolean;
  /** Orientation of the track and the arrow-key mapping. @default "horizontal" */
  orientation?: "horizontal" | "vertical";
  /** Visible label; also becomes the accessible name of the thumb(s). */
  label?: ReactNode;
  /**
   * Formats a value for `aria-valuetext` and the visible readout. The default
   * uses the runtime locale's number formatting.
   */
  formatValue?: (value: number) => string;
  /** Show the formatted value beside the label. @default false */
  showValue?: boolean;
  /**
   * Accessible name used when no visible `label` is rendered. A visible label
   * always wins.
   */
  "aria-label"?: string;
  /** Extra classes for the root element. */
  className?: string;
}

/** Locale-aware default formatter; keeps fractional steps readable. */
const numberFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 20,
});

function defaultFormatValue(value: number): string {
  return numberFormatter.format(value);
}

/**
 * A thumb label must stay distinguishable in a range while the visible label
 * remains the single source of truth. Only string labels can be extended; a
 * rich label falls back to the primitive's `aria-labelledby` association.
 */
function thumbLabel(
  index: number,
  count: number,
  label: ReactNode,
  ariaLabel: string | undefined
): string | undefined {
  const base =
    typeof label === "string" && label !== "" ? label : ariaLabel;
  if (base == null || base === "") return undefined;
  if (count === 1) return base;
  if (index === 0) return `${base} minimum`;
  if (index === count - 1) return `${base} maximum`;
  return `${base} value ${index + 1}`;
}

const CONTROL_CLASSES = joinClasses(
  "relative flex touch-none select-none items-center",
  "data-[disabled]:cursor-not-allowed"
);

const TRACK_CLASSES = "relative rounded-full bg-track";

const INDICATOR_CLASSES =
  "rounded-full bg-checked data-[disabled]:bg-disabled";

const THUMB_CLASSES = joinClasses(
  "size-5 cursor-grab rounded-full border-2 border-border bg-surface shadow",
  "outline-none active:cursor-grabbing",
  // Focus lives on the visually hidden native range input, so paint the ring on
  // the visible thumb whenever that input owns focus.
  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
  "has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-surface",
  "data-[disabled]:cursor-not-allowed data-[disabled]:border-border-subtle data-[disabled]:bg-surface-subtle"
);

/**
 * Single-value or range slider with a real value contract.
 *
 * Built on Base UI's Slider, so each thumb is a native `<input type="range">`
 * exposed as `role="slider"` with `aria-valuemin`/`aria-valuemax`/`aria-valuenow`
 * and a formatted `aria-valuetext`. Arrow keys move by `step`, Home/End jump to
 * the ends, and Page Up/Page Down move by roughly a tenth of the range (snapped
 * to `step`, never less than two steps). In a range, Home/End stop at the
 * neighbouring thumb so the two values cannot cross.
 *
 * Pass a number for a single thumb or an array for a range; the number of thumbs
 * follows the array length. The value readout is an `<output>` linked to the
 * thumbs, and the visible label is the accessible name. All colour, radius,
 * spacing and focus styling comes from semantic tokens.
 */
const Slider = forwardRef<HTMLDivElement, SliderProps>(function Slider(
  {
    value,
    defaultValue,
    onValueChange,
    min = 0,
    max = 100,
    step = 1,
    disabled = false,
    orientation = "horizontal",
    label,
    formatValue = defaultFormatValue,
    showValue = false,
    "aria-label": ariaLabel,
    className,
    ...props
  },
  ref
) {
  const isVertical = orientation === "vertical";
  const hasLabel = label != null && label !== "";

  const currentShape = value ?? defaultValue;
  const thumbCount = Math.max(1, Array.isArray(currentShape) ? currentShape.length : 1);

  // Page Up/Page Down should always exceed a single step, even for coarse steps.
  const rangeSteps = Math.max(1, Math.round((max - min) / 10 / step));
  const pageStep = Math.max(step * 2, rangeSteps * step);

  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  // Base UI forwards `aria-valuenow`/`aria-valuetext` to the nested range input
  // but leaves its minimum and maximum as HTML attributes. Make the ARIA contract
  // explicit so every thumb reports the same bounds it enforces.
  useLayoutEffect(() => {
    for (const input of inputRefs.current) {
      if (!input) continue;
      input.setAttribute("role", "slider");
      input.setAttribute("aria-valuemin", String(min));
      input.setAttribute("aria-valuemax", String(max));
    }
  }, [min, max, thumbCount]);

  function handleValueChange(next: SliderValue) {
    onValueChange?.(next);
  }

  return (
    <SliderPrimitive.Root<number | number[]>
      ref={ref}
      data-km-slider=""
      value={value}
      defaultValue={defaultValue}
      onValueChange={handleValueChange}
      min={min}
      max={max}
      step={step}
      largeStep={pageStep}
      disabled={disabled}
      orientation={orientation}
      className={joinClasses(
        "flex w-full flex-col gap-2",
        isVertical && "items-start",
        className
      )}
      {...props}
    >
      {hasLabel || showValue ? (
        <div className="flex w-full items-baseline justify-between gap-3">
          {hasLabel ? (
            <SliderPrimitive.Label
              data-part="label"
              className="min-w-0 break-words text-sm font-medium text-foreground"
            >
              {label}
            </SliderPrimitive.Label>
          ) : null}
          {showValue ? (
            <SliderPrimitive.Value
              data-km-slider-value=""
              data-part="value"
              className="ms-auto min-w-0 break-words text-end text-sm tabular-nums text-muted-foreground"
            >
              {(_formatted, values) =>
                values.map((current) => formatValue(current)).join(" – ")
              }
            </SliderPrimitive.Value>
          ) : null}
        </div>
      ) : null}
      <SliderPrimitive.Control
        data-part="control"
        className={joinClasses(
          CONTROL_CLASSES,
          // Dim the track and thumbs only. Dimming the whole root would drop the
          // label and the value readout to ~3:1, below the 4.5:1 text minimum.
          disabled && "opacity-60",
          isVertical ? "h-40 w-6 justify-center py-2.5" : "h-6 w-full px-2.5"
        )}
      >
        <SliderPrimitive.Track
          data-part="track"
          className={joinClasses(
            TRACK_CLASSES,
            isVertical ? "h-full w-1.5" : "h-1.5 w-full"
          )}
        >
          <SliderPrimitive.Indicator
            data-part="indicator"
            className={INDICATOR_CLASSES}
          />
          {Array.from({ length: thumbCount }, (_, index) => {
            const thumbName = thumbLabel(index, thumbCount, label, ariaLabel);
            return (
              <SliderPrimitive.Thumb
                key={index}
                index={index}
                data-part="thumb"
                inputRef={(node) => {
                  inputRefs.current[index] = node;
                }}
                getAriaLabel={
                  thumbName == null ? undefined : () => thumbName
                }
                getAriaValueText={(_formatted, current) => formatValue(current)}
                className={THUMB_CLASSES}
              />
            );
          })}
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
});

Slider.displayName = "Slider";

export { Slider };
export default Slider;
