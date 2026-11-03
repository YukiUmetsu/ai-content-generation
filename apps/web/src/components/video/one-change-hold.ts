/** Absolute-frame, single semantic change followed by an entirely static hold. */
export type OneChangeKind = "connect" | "show" | "move" | "compare" | "ring";
export interface OneChangeWindow {
  /** Inclusive start frame; independent of playback and rendering order. */
  startFrame: number;
  /** Exclusive end frame. */
  endFrame: number;
  /** Exactly one instantaneous reveal inside the window. */
  changeFrame: number;
  change: OneChangeKind;
}
export interface OneChangeSample {
  active: boolean;
  changed: boolean;
  phase: "outside" | "before" | "hold";
  change: OneChangeKind;
  /** The supplied subject remains present; show only adds authored emphasis. */
  emphasizeSubject: boolean;
  /** Relevant only if the caller supplied a verified screenshot region. */
  showHighlight: boolean;
  showConnector: boolean;
  showNextStep: boolean;
  showComparison: boolean;
  showRing: boolean;
  showCaption: boolean;
}
const CHANGES: readonly OneChangeKind[] = ["connect","show","move","compare","ring"];
export function validateOneChangeWindow(window: OneChangeWindow): void {
  const { startFrame, endFrame, changeFrame, change } = window;
  if (![startFrame, endFrame, changeFrame].every(Number.isSafeInteger) ||
      startFrame < 0 || endFrame <= startFrame ||
      changeFrame < startFrame || changeFrame >= endFrame) {
    throw new Error("OneChangeWindow requires safe nonnegative integer frames, start < end, and start <= change < end.");
  }
  if (!CHANGES.includes(change)) throw new Error("Unknown one-change action: " + String(change));
}
/** Pure and seekable: no timers, CSS transitions, easing, accumulating state or drift. */
export function evaluateOneChangeHold(window: OneChangeWindow, frame: number): OneChangeSample {
  validateOneChangeWindow(window);
  if (!Number.isSafeInteger(frame) || frame < 0) throw new Error("frame must be a nonnegative safe integer.");
  const active = frame >= window.startFrame && frame < window.endFrame;
  const changed = active && frame >= window.changeFrame;
  const kind = window.change;
  return {
    active, changed, change: kind,
    phase: !active ? "outside" : changed ? "hold" : "before",
    emphasizeSubject: changed && kind === "show",
    showHighlight: changed && (kind === "show" || kind === "connect"),
    showConnector: changed && kind === "connect",
    showNextStep: changed && kind === "move",
    showComparison: changed && kind === "compare",
    showRing: changed && kind === "ring",
    showCaption: changed,
  };
}
