import { createContext, forwardRef, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { motion, useReducedMotion } from "motion/react";

function joinClasses(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

/** Axis the tab list is laid out on and navigated with. */
export type TabsOrientation = "horizontal" | "vertical";

interface TabsConfig {
  label?: string;
  orientation: TabsOrientation;
  activeValue?: number | null;
}

const TabsConfigContext = createContext<TabsConfig>({ orientation: "horizontal" });

export interface TabsProps {
  /** Controlled active tab index. `null` means no tab is active. */
  activeIndex?: number | null;
  /** Initial active index when uncontrolled. @default 0 */
  defaultActiveIndex?: number | null;
  /** Called with the next active index (`null` when cleared with Escape). */
  onChange?: (index: number | null) => void;
  /**
   * Layout and navigation axis. `"vertical"` stacks the tabs and wires the
   * Up/Down arrows; `"horizontal"` rows them and wires Left/Right.
   * @default "horizontal"
   */
  orientation?: TabsOrientation;
  /**
   * Move focus with the perpendicular arrow pair instead of the one implied by
   * `orientation`. `orientation` still drives layout and `aria-orientation`, so
   * the accessible axis never disagrees with what is shown.
   * @default false
   */
  orientationSwap?: boolean;
  /**
   * Pressing Escape while focus is inside the tabs clears the selection and
   * calls `onChange(null)`. Off by default because Escape is often owned by an
   * enclosing overlay.
   * @default false
   */
  closeOnEscape?: boolean;
  /** Accessible name for the tab list (`aria-label`). */
  label?: string;
  /** Extra classes for the root wrapper. */
  className?: string;
  /** `Tabs.List`, `Tabs.Tab` and `Tabs.Panel` parts. */
  children?: ReactNode;
  /** Extra key handler, called after the built-in Escape handling. */
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
}

/**
 * Index-based tab set with roving focus, honest selected state and overflow.
 *
 * Layout, selection, arrow-key focus and the `role="tablist"` / `role="tab"` /
 * `role="tabpanel"` wiring come from Base UI's Tabs primitive. This wrapper
 * renames the root contract to an index model (`activeIndex` /
 * `defaultActiveIndex` / `onChange`), adds an opt-in Escape-to-clear behavior
 * and keeps the list scrollable when it no longer fits its container.
 *
 * The active tab is signalled by a sliding raised thumb inside a flat inset
 * track, not by colour alone. The thumb shares a single `layoutId` so it glides
 * between tabs with a spring, and the motion is suppressed when the user
 * prefers reduced motion.
 */
const TabsRoot = forwardRef<HTMLDivElement, TabsProps>(function Tabs(
  {
    activeIndex,
    defaultActiveIndex = 0,
    onChange,
    orientation = "horizontal",
    orientationSwap = false,
    closeOnEscape = false,
    label,
    className,
    children,
    onKeyDown,
    ...props
  },
  ref
) {
  const [uncontrolledIndex, setUncontrolledIndex] = useState<number | null>(defaultActiveIndex);
  const isControlled = activeIndex !== undefined;
  const value = isControlled ? activeIndex : uncontrolledIndex;

  // Base UI reads `orientation` to pick the arrow-key pair. Swapping only that
  // value (never the visual/labelled orientation) keeps keyboard and ARIA in
  // sync with the layout a consumer actually renders.
  const navigationOrientation: TabsOrientation = orientationSwap
    ? orientation === "horizontal"
      ? "vertical"
      : "horizontal"
    : orientation;

  function handleValueChange(next: number | null) {
    if (!isControlled) setUncontrolledIndex(next);
    onChange?.(next);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (closeOnEscape && event.key === "Escape" && value !== null) {
      event.preventDefault();
      handleValueChange(null);
    }
    onKeyDown?.(event);
  }

  const config = useMemo<TabsConfig>(() => ({ label, orientation, activeValue: value }), [label, orientation, value]);

  return (
    <TabsConfigContext.Provider value={config}>
      <TabsPrimitive.Root
        ref={ref}
        value={value}
        orientation={navigationOrientation}
        onValueChange={(next) => handleValueChange(next as number | null)}
        data-km-tabs="root"
        {...props}
        onKeyDown={handleKeyDown}
        className={joinClasses(className)}
      >
        {children}
      </TabsPrimitive.Root>
    </TabsConfigContext.Provider>
  );
});

TabsRoot.displayName = "Tabs";

function useHorizontalOverflow(ref: React.RefObject<HTMLDivElement | null>) {
  const [isOverflowing, setIsOverflowing] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    function update() {
      if (!element) return;
      setIsOverflowing(element.scrollWidth > element.clientWidth);
    }
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return isOverflowing;
}

export interface TabsListProps {
  /** Activate the focused tab as the arrow keys move. @default false */
  activateOnFocus?: boolean;
  /** Wrap focus from the last tab back to the first and vice versa. @default true */
  loopFocus?: boolean;
  /** Accessible name; overrides the `label` given to `Tabs`. */
  "aria-label"?: string;
  /** Extra classes for the tab list. */
  className?: string;
  /** `Tabs.Tab` children. */
  children?: ReactNode;
}

/**
 * `role="tablist"` for the tabs. Horizontally it scrolls instead of clipping
 * (`overflow-x-auto`); vertically it grows into a scroll container
 * (`overflow-y-auto`), so long or CJK labels never break the layout.
 */
const TabsList = forwardRef<HTMLDivElement, TabsListProps>(function TabsList(
  { activateOnFocus, loopFocus, "aria-label": ariaLabel, className, children, ...props },
  ref
) {
  const { label, orientation } = useContext(TabsConfigContext);
  const isHorizontal = orientation === "horizontal";
  const localRef = useRef<HTMLDivElement | null>(null);
  const setRef = useCallback(
    (value: HTMLDivElement | null) => {
      localRef.current = value;
      if (typeof ref === "function") {
        ref(value);
      } else if (ref) {
        (ref as React.MutableRefObject<HTMLDivElement | null>).current = value;
      }
    },
    [ref]
  );
  const isOverflowing = useHorizontalOverflow(localRef);
  return (
    <TabsPrimitive.List
      ref={setRef}
      aria-label={ariaLabel ?? label}
      aria-orientation={orientation}
      activateOnFocus={activateOnFocus}
      loopFocus={loopFocus}
      data-km-tabs="list"
      className={joinClasses(
        "inline-flex max-w-full items-center gap-1 rounded-control bg-track py-1",
        isHorizontal ? "flex-row overflow-x-auto px-3" : "flex-col overflow-y-auto px-1",
        className
      )}
      style={
        isHorizontal && isOverflowing
          ? {
              maskImage:
                "linear-gradient(to right, transparent, currentColor 0.75rem, currentColor calc(100% - 0.75rem), transparent)",
              WebkitMaskImage:
                "linear-gradient(to right, transparent, currentColor 0.75rem, currentColor calc(100% - 0.75rem), transparent)",
            }
          : undefined
      }
      {...props}
    >
      {children}
    </TabsPrimitive.List>
  );
});

TabsList.displayName = "Tabs.List";

export interface TabsTabProps {
  /** Index of the tab; match it with the `Tabs.Panel` and `activeIndex`. */
  value: number;
  /** Ignore user interaction and skip the tab while navigating. @default false */
  disabled?: boolean;
  /** Extra classes for the tab button. */
  className?: string;
  /** Visible label; also the accessible name. */
  children?: ReactNode;
}

/** Individual `role="tab"` button. Selection is conveyed by a raised thumb, not colour alone. */
const TabsTab = forwardRef<HTMLElement, TabsTabProps>(function TabsTab(
  { value, className, children, ...props },
  ref
) {
  const { activeValue } = useContext(TabsConfigContext);
  const reducedMotion = useReducedMotion();
  const isActive = activeValue === value;

  return (
    <TabsPrimitive.Tab
      ref={ref}
      value={value}
      data-km-tabs="tab"
      className={joinClasses(
        "relative inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-sm px-3",
        "text-sm text-muted-foreground",
        "transition-colors duration-[var(--km-duration-short)] ease-continuity",
        "hover:bg-surface/50 hover:text-foreground",
        "active:bg-surface/40 active:text-foreground",
        "data-[active]:text-foreground data-[active]:active:opacity-90",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-inset",
        "data-[disabled]:cursor-not-allowed data-[disabled]:text-muted-foreground data-[disabled]:hover:bg-transparent data-[disabled]:hover:text-muted-foreground",
        className
      )}
      {...props}
    >
      {isActive && (
        <motion.div
          layoutId={reducedMotion ? undefined : "km-active-tab"}
          transition={
            reducedMotion
              ? { duration: 0 }
              : { type: "spring", stiffness: 400, damping: 30 }
          }
          className="pointer-events-none absolute inset-0 rounded-sm border border-border/70 bg-surface shadow"
        />
      )}
      <span className="relative z-10">{children}</span>
    </TabsPrimitive.Tab>
  );
});

TabsTab.displayName = "Tabs.Tab";

export interface TabsPanelProps {
  /** Index of the matching `Tabs.Tab`. */
  value: number;
  /** Keep the panel in the DOM while it is hidden. @default false */
  keepMounted?: boolean;
  /** Extra classes for the panel. */
  className?: string;
  children?: ReactNode;
}

/** `role="tabpanel"` for the active tab, labelled by its tab. */
const TabsPanel = forwardRef<HTMLDivElement, TabsPanelProps>(function TabsPanel(
  { className, children, ...props },
  ref
) {
  return (
    <TabsPrimitive.Panel
      ref={ref}
      data-km-tabs="panel"
      className={joinClasses(
        "mt-3 text-base text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        className
      )}
      {...props}
    >
      {children}
    </TabsPrimitive.Panel>
  );
});

TabsPanel.displayName = "Tabs.Panel";

/**
 * `Tabs` with its `List`, `Tab` and `Panel` parts attached, mirroring Base UI's
 * compound shape. The parts are also available as named exports.
 */
const Tabs = Object.assign(TabsRoot, {
  List: TabsList,
  Tab: TabsTab,
  Panel: TabsPanel,
});

export { Tabs, TabsList, TabsTab, TabsPanel };
export default Tabs;
