import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type {
  ComponentPropsWithoutRef,
  CSSProperties,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
} from "react";
import { motion, useReducedMotion } from "motion/react";

function joinClasses(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

// Layout effects measure and announce before paint; plain effects avoid the
// React warning when a Stepper is rendered on the server.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Visual weight of a state. Each tone maps to semantic colour roles, never to a
 * palette value, so every theme and appearance keeps its own colours.
 */
export type StepperTone = "neutral" | "info" | "accent" | "success" | "warning" | "danger";

/** Built-in state keys. Any other string is a custom state and needs a definition in `states`. */
export type DefaultStepperStatus = "not-started" | "started" | "active" | "complete";

/** A state key. Built-in names autocomplete; any other string names a custom state. */
export type StepperStatus = DefaultStepperStatus | (string & {});

/** Everything that decides how a state looks and what happens when a step enters it. */
export interface StepperStateDefinition {
  /** Status text shown under the step label. It is also announced with the label. */
  label: ReactNode;
  /** Colour role for the indicator, mark and status text. @default "neutral" */
  tone?: StepperTone;
  /**
   * Mark shown beside the step label. `false` hides it. The built-in `complete`
   * state shows a check mark that draws itself on each transition. A custom mark
   * can read `useStepperItem()` to animate on the same transitions.
   */
  mark?: ReactNode | false;
  /** Replaces the content of the circular indicator. Takes precedence over `step.icon` and the step number. */
  indicator?: ReactNode;
  /**
   * Marks the state as the current step when `currentStepId` is not set. The
   * current step is highlighted and carries `aria-current="step"`.
   * @default false
   */
  current?: boolean;
  /**
   * Counts the step as done for the progress summary and the finished state.
   * The built-in `complete` state sets it. @default false
   */
  complete?: boolean;
  /** Called once each time a step enters this state. Never called on first render. */
  onEnter?: (event: StepperStatusEvent) => void;
}

/** One step of the workflow. */
export interface StepperStep {
  /** Stable identifier. Used for `currentStepId`, React keys and transition events. */
  id: string;
  /** Step title. Any inline content, including CJK text. */
  label: ReactNode;
  /** State key of this step. @default "not-started" */
  status?: StepperStatus;
  /** Replaces the step number in the indicator, unless the state sets `indicator`. */
  icon?: ReactNode;
  /**
   * Short guidance shown inside the current step, such as "About 20 minutes".
   * Text only: the step is a button, so interactive content belongs outside the
   * bar, for example in a panel that follows `currentStepId`.
   */
  hint?: ReactNode;
  /** Makes the step a link. Requires no extra handler; `onStepSelect` still fires. */
  href?: string;
  /** Renders the step as non-interactive, even when other steps are clickable. */
  disabled?: boolean;
}

/** Payload for `onStatusChange` and `onEnter`. */
export interface StepperStatusEvent {
  step: StepperStep;
  /** Zero-based position of the step in `steps`. */
  index: number;
  status: StepperStatus;
  /** Status before the change. `undefined` when the step is new. */
  previousStatus: StepperStatus | undefined;
}

/** Overrides for state definitions, keyed by state key. Merged over the defaults. */
export type StepperStates = Partial<Record<StepperStatus, Partial<StepperStateDefinition>>>;

/** Built-in definitions. Override any field through the `states` prop. */
export const DEFAULT_STEPPER_STATES: Record<DefaultStepperStatus, StepperStateDefinition> = {
  "not-started": { label: "Not started", tone: "neutral" },
  started: { label: "Started", tone: "info" },
  active: { label: "Active", tone: "accent", current: true },
  complete: { label: "Complete", tone: "success", complete: true, mark: <StepperCheckMark /> },
};

export interface StepperItemState {
  step: StepperStep;
  index: number;
  count: number;
  status: StepperStatus;
  state: StepperStateDefinition;
  isCurrent: boolean;
  /** Status changes since mount. `0` means no transition yet; key animations on it to replay them. */
  transitions: number;
  /** False when `animate` is off or the user prefers reduced motion. */
  motion: boolean;
}

const StepperItemContext = createContext<StepperItemState | null>(null);

/**
 * Reads the step that a custom `mark`, `indicator` or `label` is rendered for.
 * Throws when called outside a step.
 */
export function useStepperItem(): StepperItemState {
  const value = useContext(StepperItemContext);
  if (!value) throw new Error("useStepperItem must be used inside a Stepper step.");
  return value;
}

/**
 * Built-in check mark for the `complete` state. It draws itself each time a
 * step enters `complete`, and stays fully drawn on first render or under
 * reduced motion.
 */
export function StepperCheckMark({ className }: { className?: string }) {
  const item = useContext(StepperItemContext);
  const replay = Boolean(item?.motion) && (item?.transitions ?? 0) > 0;
  return (
    <motion.svg
      key={item?.transitions ?? 0}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
      className={joinClasses("shrink-0", className)}
    >
      <motion.path
        d="M3.5 8.5 6.5 11.5 12.5 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={replay ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      />
    </motion.svg>
  );
}

export interface CompletionChimeOptions {
  /** Pitch in hertz. @default 660 */
  frequency?: number;
  /** Peak gain from 0 to 1. Keep it low. @default 0.06 */
  volume?: number;
  /** Length in seconds. @default 0.32 */
  duration?: number;
}

/**
 * Opt-in completion sound for `states.complete.onEnter`. It plays one soft sine
 * tone through the Web Audio API. Browsers only allow audio after a user gesture,
 * so this works when a click completes the step. Where audio is unavailable it
 * stays silent, and it never plays by default.
 *
 * @example
 * states={{ complete: { onEnter: createCompletionChime() } }}
 */
export function createCompletionChime({
  frequency = 660,
  volume = 0.06,
  duration = 0.32,
}: CompletionChimeOptions = {}): () => void {
  let context: AudioContext | null = null;
  return () => {
    try {
      const AudioCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return;
      if (!context) context = new AudioCtor();
      const now = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(volume, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.02);
      if (context.state === "suspended") void context.resume();
    } catch {
      // Audio is unavailable or blocked: stay silent.
    }
  };
}

export type StepperOrientation = "horizontal" | "vertical";
export type StepperSize = "sm" | "md";

export interface StepperProps extends Omit<ComponentPropsWithoutRef<"nav">, "children"> {
  /** Ordered workflow steps. Each `id` must be unique. */
  steps: StepperStep[];
  /**
   * State overrides. Keys match `status` values. Built-in keys merge over
   * `DEFAULT_STEPPER_STATES`; custom keys define new states. Labels are
   * presentation text, so translate them here.
   */
  states?: StepperStates;
  /** Layout direction. Vertical steps scroll inside the height the container gives them. @default "horizontal" */
  orientation?: StepperOrientation;
  /** Indicator and text scale. @default "md" */
  size?: StepperSize;
  /**
   * Id of the step to highlight as the current one. When omitted, the first step
   * whose state sets `current` is used.
   */
  currentStepId?: string;
  /**
   * Draws a line between steps. @default true for vertical, false for horizontal
   */
  connectors?: boolean;
  /**
   * Shows each state's label under the step title. Hidden by default, so the
   * indicator, check mark and status colour carry the state. The label is still
   * read by assistive technology. @default false
   */
  showStateText?: boolean;
  /**
   * Plays the transition animations (indicator pop and mark draw). Reduced-motion
   * users get the final state without animation regardless. @default true
   */
  animate?: boolean;
  /**
   * Slides the current highlight from the previous step to the new one, instead of
   * swapping it. Ignored under reduced motion. @default true
   */
  glideCurrent?: boolean;
  /**
   * Fills each connector from left to right, or top to bottom, when the step
   * before it completes. Ignored under reduced motion. @default false
   */
  fillConnectors?: boolean;
  /**
   * Arrow keys move focus between enabled steps (Left and Right, or Up and Down
   * when vertical), and Home and End go to the first and last. Tab still works.
   * Right-to-left layouts reverse the horizontal arrows. @default false
   */
  arrowKeys?: boolean;
  /**
   * Shows a progress readout with a track: "3 of 8 complete". Steps count when
   * their state sets `complete`. @default false
   */
  showSummary?: boolean;
  /**
   * Where the readout sits. `top` and `bottom` place it above or below the step
   * row. `start` and `end` place it beside the row, at the inline start or end, so
   * it follows the text direction. @default "bottom"
   */
  summaryPosition?: "top" | "bottom" | "start" | "end";
  /**
   * Horizontal alignment of the readout when it sits above or below the row.
   * Ignored when the readout is beside the row. @default "center"
   */
  summaryAlign?: "start" | "center" | "end";
  /** Builds the readout text. Translate it here. @default "3 of 8 complete" */
  summaryLabel?: (completed: number, total: number) => ReactNode;
  /** Readout text once every step is complete. @default "All steps complete" */
  finishedLabel?: ReactNode;
  /**
   * When every step is complete, clears the current highlight, fills every
   * connector, and marks the bar `data-finished`, so the finish reads as one
   * settled state. @default false
   */
  calmFinish?: boolean;
  /**
   * Called when a step is activated. Making any step clickable turns every
   * enabled step into a button, or a link when it has `href`.
   */
  onStepSelect?: (step: StepperStep, index: number, event: MouseEvent<HTMLElement>) => void;
  /**
   * Called after a step changes state, with the previous state. It runs after the
   * state's own `onEnter`. Use it for analytics, sounds or saving progress.
   * Never called on first render.
   */
  onStatusChange?: (event: StepperStatusEvent) => void;
  /** Accessible name for the navigation landmark. @default "Progress" */
  "aria-label"?: string;
  /** Extra classes for the root `<nav>`. Constrain its height or width here to make the bar scroll. */
  className?: string;
}

interface ScrollEdges {
  /** Content is hidden before the visible area: left, or top when vertical. */
  before: boolean;
  /** Content is hidden after the visible area: right, or bottom when vertical. */
  after: boolean;
  scrollable: boolean;
}

const NO_EDGES: ScrollEdges = { before: false, after: false, scrollable: false };

function measureEdges(scroller: HTMLElement, vertical: boolean): ScrollEdges {
  const rtl = !vertical && getComputedStyle(scroller).direction === "rtl";
  const max = vertical
    ? scroller.scrollHeight - scroller.clientHeight
    : scroller.scrollWidth - scroller.clientWidth;
  const position = vertical ? scroller.scrollTop : Math.abs(scroller.scrollLeft);
  const before = rtl ? max - position : position;
  return { before: before > 1, after: max - before > 1, scrollable: max > 1 };
}

function sameEdges(a: ScrollEdges, b: ScrollEdges): boolean {
  return a.before === b.before && a.after === b.after && a.scrollable === b.scrollable;
}

/** Fades only the edges that hide content, so the bar signals more steps without a scrollbar. */
function edgeFade(vertical: boolean, edges: ScrollEdges): string {
  const direction = vertical ? "to bottom" : "to right";
  // A mask reads only alpha, so the opaque stop uses the token-backed text colour.
  const head = edges.before ? "transparent, currentcolor 2rem" : "currentcolor 0";
  const tail = edges.after ? "currentcolor calc(100% - 2rem), transparent" : "currentcolor 100%";
  return `linear-gradient(${direction}, ${head}, ${tail})`;
}

/** Plain text for live announcements. Non-string labels fall back to the key. */
function textOf(node: ReactNode, fallback: string): string {
  return typeof node === "string" || typeof node === "number" ? String(node) : fallback;
}

function resolveState(status: StepperStatus, overrides: StepperStates | undefined): StepperStateDefinition {
  const base: StepperStateDefinition =
    (DEFAULT_STEPPER_STATES as Record<string, StepperStateDefinition | undefined>)[status] ?? {
      label: status,
      tone: "neutral",
    };
  const override = overrides?.[status];
  return override ? { ...base, ...override } : base;
}

const defaultSummaryLabel = (completed: number, total: number) => `${completed} of ${total} complete`;

const TONE_INDICATOR: Record<StepperTone, string> = {
  neutral: "border-border text-muted-foreground",
  info: "border-status-info text-status-info",
  accent: "border-status-success text-status-success",
  success: "border-status-success text-status-success",
  warning: "border-status-warning text-status-warning",
  danger: "border-status-danger text-status-danger",
};

const TONE_MARK: Record<StepperTone, string> = {
  neutral: "text-muted-foreground",
  info: "text-status-info",
  accent: "text-status-success",
  success: "text-status-success",
  warning: "text-status-warning",
  danger: "text-status-danger",
};

// Status text stays neutral for routine states so the mark and indicator carry the
// colour. Warnings and errors colour the text too, because they need attention.
const TONE_STATUS: Partial<Record<StepperTone, string>> = {
  warning: "text-status-warning",
  danger: "text-status-danger",
};

/**
 * Fill of the current step's indicator. Green by default. Override the two
 * variables on the Stepper (through `style` or a parent) to recolour it:
 * `--km-stepper-current` for the fill and border, and
 * `--km-stepper-current-foreground` for the number.
 */
const CURRENT_INDICATOR_STYLE: CSSProperties = {
  backgroundColor: "var(--km-stepper-current, var(--km-status-success))",
  borderColor: "var(--km-stepper-current, var(--km-status-success))",
  color: "var(--km-stepper-current-foreground, var(--km-surface-canvas))",
};

const STEP_BASE =
  "relative z-10 flex min-w-0 items-start gap-3 rounded-xl border px-3 py-2 text-start no-underline " +
  "transition-colors duration-[var(--km-duration-medium)] ease-continuity motion-reduce:transition-none " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

const EASE_ENTER: [number, number, number, number] = [0.16, 1, 0.3, 1];

interface StepperItemProps {
  step: StepperStep;
  index: number;
  count: number;
  status: StepperStatus;
  state: StepperStateDefinition;
  isCurrent: boolean;
  transitions: number;
  motion: boolean;
  vertical: boolean;
  size: StepperSize;
  showStateText: boolean;
  connector: boolean;
  connectorFilled: boolean;
  fillConnectors: boolean;
  /** Shared-layout id for the gliding highlight. Undefined when the highlight is static. */
  glideId: string | undefined;
  interactive: boolean;
  onStepSelect: ((step: StepperStep, index: number, event: MouseEvent<HTMLElement>) => void) | undefined;
}

function StepperItem({
  step,
  index,
  count,
  status,
  state,
  isCurrent,
  transitions,
  motion: motionEnabled,
  vertical,
  size,
  showStateText,
  connector,
  connectorFilled,
  fillConnectors,
  glideId,
  interactive,
  onStepSelect,
}: StepperItemProps) {
  const tone = state.tone ?? "neutral";
  const itemState: StepperItemState = {
    step,
    index,
    count,
    status,
    state,
    isCurrent,
    transitions,
    motion: motionEnabled,
  };
  const indicatorContent = state.indicator ?? step.icon ?? index + 1;
  const indicatorTone = isCurrent ? "" : TONE_INDICATOR[tone];
  const pop = motionEnabled && transitions > 0;
  // The gliding highlight is a sibling layer, so its position can animate between steps.
  const glideHighlight = isCurrent && glideId !== undefined;

  const content = (
    <>
      {glideHighlight ? (
        <motion.span
          layoutId={glideId}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 rounded-xl border border-checked/35 bg-surface-elevated"
          transition={{ duration: 0.28, ease: EASE_ENTER }}
        />
      ) : null}
      <motion.span
        key={transitions}
        data-part="indicator"
        aria-hidden="true"
        className={joinClasses(
          "relative grid shrink-0 place-items-center rounded-full border text-body-sm font-medium tabular-nums",
          "transition-colors duration-[var(--km-duration-medium)] ease-continuity motion-reduce:transition-none",
          indicatorTone
        )}
        style={{
          width: "var(--km-stepper-indicator)",
          height: "var(--km-stepper-indicator)",
          ...(isCurrent ? CURRENT_INDICATOR_STYLE : undefined),
        }}
        initial={pop ? { scale: 0.8 } : false}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 480, damping: 26 }}
      >
        {indicatorContent}
      </motion.span>
      <span data-part="text" className="flex min-w-0 flex-1 flex-col gap-0.5 text-start">
        {/* The row is at least as tall as the indicator, so the title centres on it. */}
        <span
          className="flex min-w-0 items-center gap-2"
          style={{ minHeight: "var(--km-stepper-indicator)" }}
        >
          <span
            data-part="label"
            className={joinClasses(
              "min-w-0 break-words",
              size === "sm" ? "text-body-sm" : "text-body",
              isCurrent ? "font-medium text-foreground" : "text-muted-foreground"
            )}
          >
            <span className="sr-only">{`Step ${index + 1} of ${count}: `}</span>
            {step.label}
          </span>
          {state.mark ? (
            <span
              key={transitions}
              data-part="mark"
              aria-hidden="true"
              className={joinClasses("inline-flex shrink-0 items-center", TONE_MARK[tone])}
            >
              {state.mark}
            </span>
          ) : null}
        </span>
        {showStateText ? (
          <span data-part="status" className={joinClasses("text-caption", TONE_STATUS[tone] ?? "text-muted-foreground")}>
            {state.label}
          </span>
        ) : (
          <span className="sr-only">{state.label}</span>
        )}
        {isCurrent && step.hint !== undefined ? (
          <span data-part="hint" className="text-body-sm text-muted-foreground">
            {step.hint}
          </span>
        ) : null}
      </span>
    </>
  );

  const surface = joinClasses(
    STEP_BASE,
    vertical ? "w-full" : "max-w-64 shrink-0",
    isCurrent && !glideHighlight ? "border-checked/35 bg-surface-elevated" : "border-transparent",
    interactive && !step.disabled && !isCurrent && "hover:bg-surface-subtle",
    interactive && !step.disabled ? "cursor-pointer" : "cursor-default",
    step.disabled && "cursor-not-allowed opacity-50"
  );
  const handleClick = (event: MouseEvent<HTMLElement>) => onStepSelect?.(step, index, event);
  const current = isCurrent ? ("step" as const) : undefined;

  let element: ReactNode;
  if (!interactive) {
    element = (
      <div data-part="step" data-status={status} aria-current={current} className={surface}>
        {content}
      </div>
    );
  } else if (step.href !== undefined && !step.disabled) {
    element = (
      <a
        data-part="step"
        data-status={status}
        aria-current={current}
        href={step.href}
        onClick={handleClick}
        className={surface}
      >
        {content}
      </a>
    );
  } else {
    element = (
      <button
        type="button"
        data-part="step"
        data-status={status}
        aria-current={current}
        disabled={step.disabled}
        onClick={handleClick}
        className={surface}
      >
        {content}
      </button>
    );
  }

  const connectorTone = fillConnectors
    ? "bg-border"
    : connectorFilled
      ? "bg-status-success"
      : "bg-border";

  return (
    <StepperItemContext.Provider value={itemState}>
      <li
        data-part="item"
        data-step-index={index}
        data-current={isCurrent ? "" : undefined}
        className={joinClasses(
          "relative flex",
          vertical ? "flex-col" : "min-w-max shrink-0 items-start",
          !vertical && connector && "flex-1"
        )}
      >
        {element}
        {connector ? (
          <span
            aria-hidden="true"
            data-part="connector"
            className={joinClasses(
              "transition-colors duration-[var(--km-duration-medium)] ease-continuity motion-reduce:transition-none",
              connectorTone,
              vertical ? "absolute w-px" : "relative mx-2 h-px min-w-4 flex-1 self-start"
            )}
            style={
              vertical
                ? {
                    top: "calc(var(--km-stepper-indicator) + 9px)",
                    bottom: "-9px",
                    insetInlineStart: "calc(13px + var(--km-stepper-indicator) / 2 - 0.5px)",
                  }
                : { marginTop: "calc(9px + var(--km-stepper-indicator) / 2 - 0.5px)" }
            }
          >
            {fillConnectors ? (
              <motion.span
                data-part="connector-fill"
                className="absolute inset-0 bg-status-success"
                style={{ transformOrigin: vertical ? "50% 0%" : "0% 50%" }}
                initial={false}
                animate={vertical ? { scaleY: connectorFilled ? 1 : 0 } : { scaleX: connectorFilled ? 1 : 0 }}
                transition={{ duration: motionEnabled ? 0.35 : 0, ease: EASE_ENTER }}
              />
            ) : null}
          </span>
        ) : null}
      </li>
    </StepperItemContext.Provider>
  );
}

/**
 * Step-by-step workflow navigation that can run horizontally or vertically.
 *
 * Renders a `<nav>` landmark holding an ordered list, so assistive technology
 * hears "Step 4 of 8: Script, Stale" and knows which step is current through
 * `aria-current="step"`. Each step's state decides its indicator, status text,
 * optional mark and tone. Built-in states are `not-started`, `started`,
 * `active` and `complete`; any other string is a custom state defined in `states`.
 *
 * Long workflows scroll inside the space the container gives the bar. The
 * horizontal bar fades any edge that hides content, and it scrolls the current
 * step into view when that step changes. A vertical bar scrolls only when the
 * consumer constrains its height. The scroll region becomes a tab stop only
 * when it has no focusable steps, so keyboard users can still reach it.
 *
 * Hooks fire on state change, never on first render: a state's `onEnter`, then
 * `onStatusChange`. Transitions also play the indicator pop and the check-mark
 * draw, both suppressed under `prefers-reduced-motion`. Sounds stay with the
 * consumer, because browsers require a user gesture before audio plays.
 *
 * Optional, all off by default: `glideCurrent` (sliding highlight),
 * `fillConnectors` (connector fill on completion), `arrowKeys` (arrow-key
 * navigation), `showSummary` (progress readout), `calmFinish` (settled finished
 * state), `step.hint` (guidance on the current step) and `createCompletionChime`
 * (a soft opt-in sound for completion).
 *
 * Colours come from semantic tokens, so the bar follows light, dark and custom
 * themes. Status changes are announced through a polite live region.
 */
const Stepper = forwardRef<HTMLElement, StepperProps>(function Stepper(
  {
    steps,
    states,
    orientation = "horizontal",
    size = "md",
    currentStepId,
    connectors,
    animate = true,
    showStateText = false,
    glideCurrent = true,
    fillConnectors = false,
    arrowKeys = false,
    showSummary = false,
    summaryPosition = "bottom",
    summaryAlign = "center",
    summaryLabel = defaultSummaryLabel,
    finishedLabel = "All steps complete",
    calmFinish = false,
    onStepSelect,
    onStatusChange,
    "aria-label": ariaLabel = "Progress",
    className,
    style,
    ...props
  },
  ref
) {
  const reducedMotion = useReducedMotion();
  const motionEnabled = animate && !reducedMotion;
  const vertical = orientation === "vertical";
  const showConnectors = connectors ?? vertical;
  const interactive = onStepSelect !== undefined || steps.some(step => step.href !== undefined);
  const glideBaseId = useId();

  const rows = steps.map((step, index) => {
    const status = step.status ?? "not-started";
    return { step, index, status, state: resolveState(status, states) };
  });
  const completed = rows.filter(row => row.state.complete === true).length;
  const finished = steps.length > 0 && completed === steps.length;
  const settled = calmFinish && finished;
  const selectedIndex =
    currentStepId !== undefined
      ? steps.findIndex(step => step.id === currentStepId)
      : rows.findIndex(row => row.state.current === true);
  // A finished bar has no step left to highlight.
  const currentIndex = settled ? -1 : selectedIndex;

  // Transition bookkeeping. Counts key the per-step animations; the message feeds
  // the live region. Both change only when a status really changes.
  const [transition, setTransition] = useState<{ counts: Record<string, number>; message: string }>({
    counts: {},
    message: "",
  });
  const previousStatuses = useRef<Map<string, StepperStatus> | null>(null);
  const latest = useRef({ states, onStatusChange });

  useIsomorphicLayoutEffect(() => {
    latest.current = { states, onStatusChange };
  });

  useIsomorphicLayoutEffect(() => {
    const next = new Map<string, StepperStatus>(
      steps.map(step => [step.id, step.status ?? "not-started"])
    );
    const previous = previousStatuses.current;
    previousStatuses.current = next;
    // The first render records the baseline. Only later changes emit events.
    if (!previous) return;

    const changes = steps.flatMap((step, index) => {
      const status = next.get(step.id) ?? "not-started";
      const previousStatus = previous.get(step.id);
      return previousStatus === status ? [] : [{ step, index, status, previousStatus }];
    });
    if (changes.length === 0) return;

    const { states: currentStates, onStatusChange: notify } = latest.current;
    setTransition(current => {
      const counts = { ...current.counts };
      for (const change of changes) counts[change.step.id] = (counts[change.step.id] ?? 0) + 1;
      const message = changes
        .map(change => {
          const stateLabel = resolveState(change.status, currentStates).label;
          return `${textOf(change.step.label, change.step.id)}: ${textOf(stateLabel, change.status)}`;
        })
        .join(". ");
      return { counts, message };
    });
    for (const change of changes) {
      resolveState(change.status, currentStates).onEnter?.(change);
      notify?.(change);
    }
  }, [steps]);

  // Scroll region: track hidden content so the edges can fade.
  const scrollerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const [edges, setEdges] = useState<ScrollEdges>(NO_EDGES);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const measure = () => {
      const next = measureEdges(scroller, vertical);
      setEdges(current => (sameEdges(current, next) ? current : next));
    };
    measure();
    scroller.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(scroller);
    if (scroller.firstElementChild) observer?.observe(scroller.firstElementChild);
    return () => {
      scroller.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [vertical]);

  // Bring the current step into view. The first placement is instant; later
  // moves glide unless motion is off.
  const previousCurrent = useRef<number | undefined>(undefined);
  useEffect(() => {
    const scroller = scrollerRef.current;
    const target =
      currentIndex >= 0
        ? scroller?.querySelector<HTMLElement>(`[data-step-index="${currentIndex}"]`)
        : null;
    const first = previousCurrent.current === undefined;
    previousCurrent.current = currentIndex;
    if (!scroller || !target) return;
    const frame = scroller.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    const behavior = first || !motionEnabled ? "auto" : "smooth";
    if (vertical) {
      scroller.scrollBy?.({ top: box.top + box.height / 2 - (frame.top + frame.height / 2), behavior });
    } else {
      scroller.scrollBy?.({ left: box.left + box.width / 2 - (frame.left + frame.width / 2), behavior });
    }
  }, [currentIndex, vertical, motionEnabled]);

  // Arrow keys move between enabled steps. Focus moves, and the scroll region follows it.
  const handleArrowKeys = (event: KeyboardEvent<HTMLOListElement>) => {
    const list = listRef.current;
    if (!list) return;
    const forward = vertical ? "ArrowDown" : "ArrowRight";
    const backward = vertical ? "ArrowUp" : "ArrowLeft";
    const rtl = !vertical && getComputedStyle(list).direction === "rtl";
    let delta = 0;
    if (event.key === forward) delta = rtl ? -1 : 1;
    else if (event.key === backward) delta = rtl ? 1 : -1;
    const focusable = [...list.querySelectorAll<HTMLElement>("[data-part=step]:not(:disabled)")];
    const origin = (event.target as HTMLElement).closest<HTMLElement>("[data-part=step]");
    const from = origin ? focusable.indexOf(origin) : -1;
    if (from < 0) return;
    let to: number;
    if (event.key === "Home") to = 0;
    else if (event.key === "End") to = focusable.length - 1;
    else if (delta !== 0) to = Math.min(focusable.length - 1, Math.max(0, from + delta));
    else return;
    event.preventDefault();
    focusable[to]?.focus();
  };

  const indicatorPx = size === "sm" ? 24 : 28;
  const percent = steps.length === 0 ? 0 : Math.round((completed / steps.length) * 100);
  const summaryBeside = summaryPosition === "start" || summaryPosition === "end";
  const summaryFirst = summaryPosition === "top" || summaryPosition === "start";
  const navLayout = vertical
    ? summaryBeside && showSummary
      ? "flex h-full min-h-0 flex-row"
      : "flex h-full min-h-0 flex-col"
    : showSummary && !summaryBeside
      ? "flex flex-col"
      : showSummary
        ? "flex items-center"
        : "flex";
  const summaryNode = showSummary ? (
    <div
      data-part="summary"
      className={joinClasses(
        "flex shrink-0 items-center gap-3",
        summaryBeside
          ? summaryPosition === "start"
            ? "me-4"
            : "ms-4"
          : joinClasses(
              "w-full px-2",
              summaryAlign === "center" && "justify-center",
              summaryAlign === "end" && "justify-end"
            ),
        summaryPosition === "top" && "pb-2",
        summaryPosition === "bottom" && "pt-2"
      )}
    >
      <span
        data-part="summary-text"
        className={joinClasses(
          "text-body-sm tabular-nums",
          settled ? "font-medium text-status-success" : "text-muted-foreground"
        )}
      >
        {settled ? finishedLabel : summaryLabel(completed, steps.length)}
      </span>
      <span aria-hidden="true" className="relative h-1.5 w-24 overflow-hidden rounded-full bg-track">
        <motion.span
          data-part="summary-fill"
          className="absolute inset-y-0 start-0 rounded-full bg-status-success"
          initial={false}
          animate={{ width: `${percent}%` }}
          transition={{ duration: motionEnabled ? 0.35 : 0, ease: EASE_ENTER }}
        />
      </span>
    </div>
  ) : null;
  const scrollerStyle: CSSProperties | undefined = edges.scrollable
    ? {
        maskImage: edgeFade(vertical, edges),
        WebkitMaskImage: edgeFade(vertical, edges),
      }
    : undefined;
  const tabbable = !interactive && edges.scrollable;

  return (
    <nav
      ref={ref}
      aria-label={ariaLabel}
      data-km-stepper=""
      data-orientation={orientation}
      data-size={size}
      data-finished={settled ? "" : undefined}
      className={joinClasses("min-w-0 max-w-full", navLayout, className)}
      style={{ "--km-stepper-indicator": `${indicatorPx}px`, ...style } as CSSProperties}
      {...props}
    >
      {summaryFirst ? summaryNode : null}
      <div
        ref={scrollerRef}
        data-part="scroller"
        data-overflow-before={edges.before ? "" : undefined}
        data-overflow-after={edges.after ? "" : undefined}
        tabIndex={tabbable ? 0 : undefined}
        style={scrollerStyle}
        className={joinClasses(
          "min-h-0 min-w-0 flex-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          vertical
            ? "overflow-x-hidden overflow-y-auto overscroll-y-contain px-1 py-1"
            : "overflow-x-auto overflow-y-hidden overscroll-x-contain px-2 py-2"
        )}
      >
        <ol
          ref={listRef}
          data-part="list"
          onKeyDown={arrowKeys && interactive ? handleArrowKeys : undefined}
          className={joinClasses(
            "m-0 list-none p-0",
            vertical ? "flex flex-col" : "flex min-w-full items-start justify-between gap-x-4"
          )}
        >
          {rows.map(row => {
            const isCurrent = row.index === currentIndex;
            return (
              <StepperItem
                key={row.step.id}
                step={row.step}
                index={row.index}
                count={steps.length}
                status={row.status}
                state={row.state}
                isCurrent={isCurrent}
                transitions={transition.counts[row.step.id] ?? 0}
                motion={motionEnabled}
                vertical={vertical}
                size={size}
                showStateText={showStateText}
                connector={showConnectors && row.index < steps.length - 1}
                connectorFilled={settled || row.state.tone === "success"}
                fillConnectors={fillConnectors && motionEnabled}
                glideId={glideCurrent && motionEnabled ? `${glideBaseId}-current` : undefined}
                interactive={interactive}
                onStepSelect={onStepSelect}
              />
            );
          })}
        </ol>
      </div>
      {summaryFirst ? null : summaryNode}
      <span role="status" className="sr-only">
        {transition.message}
      </span>
    </nav>
  );
});

Stepper.displayName = "Stepper";

export { Stepper };
export default Stepper;
