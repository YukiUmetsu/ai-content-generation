/**
 * SA1: serializable, frame-addressable subject annotations.
 *
 * Geometry lives in normalized subject space, so marks stay attached to the
 * subject through object-fit crops and camera moves. Timing binds to named
 * beats, so retiming a scene's cues retimes every mark with it. No clock,
 * no DOM: this module only resolves data; renderers draw it.
 */
export type AnnotationPoint = { x: number; y: number };
/** A named scene beat, an answer step by id, or an absolute frame. */
export type AnnotationCue = number | "start" | "dock" | "reveal" | "resolve" | { step: string };
export type AnnotationEase = "expo" | "cubic" | "back" | "linear";
export interface AnnotationTiming {
  at: AnnotationCue;
  /** Frames added to `at`; negative values anticipate the beat. */
  offset?: number;
  /** Frames spent drawing on. Default 14. */
  enter?: number;
  /** When the mark is gone; omitted marks hold to the end. */
  until?: AnnotationCue;
  untilOffset?: number;
  /** Frames spent fading out before `until`. Default 6. */
  exit?: number;
  ease?: AnnotationEase;
}
interface AnnotationBase {
  id: string;
  timing: AnnotationTiming;
  /** CSS colour; defaults to the scene accent. */
  color?: string;
  /** "subject" (default) rides the camera and crop; "stage" is fixed to the frame. */
  space?: "subject" | "stage";
  /** Stroke weight multiplier. Default 1. */
  weight?: number;
}
export type SubjectAnnotation = AnnotationBase & (
  /** Straight force or motion vector. `flow` sends a pulse from tail to tip. */
  | { kind: "arrow"; from: AnnotationPoint; to: AnnotationPoint; flow?: boolean }
  /** Drawn-on route through points; optionally smoothed and arrow-tipped.
   * `headingWindow` calms the arrowhead on wiggly routes: its heading is the chord from the
   * point this fraction of the path length behind the tip, a pure function of the frame
   * (0 = the exact local segment). Default 0.05. `maxTurn` caps how many degrees the
   * arrowhead may turn per frame; it is replayed from the mark's first frame every render,
   * so it stays seekable. Default: no cap. */
  | { kind: "path"; points: AnnotationPoint[]; smooth?: boolean; arrowhead?: boolean; flow?: boolean; headingWindow?: number; maxTurn?: number }
  /** Circle on a detail; radius is a fraction of the space's shorter side. */
  | { kind: "ring"; center: AnnotationPoint; radius: number; pulse?: boolean }
  /** Short text pinned to a point by a leader; distance is a fraction of the shorter side. */
  | { kind: "label"; anchor: AnnotationPoint; text: string; side?: "above" | "below" | "left" | "right"; distance?: number }
  /** Dims everything outside a soft circle. */
  | { kind: "spotlight"; center: AnnotationPoint; radius: number; dim?: number }
);
/** Resolved beat frames a scene supplies to place its annotations. */
export interface AnnotationBeats {
  dock: number; reveal: number; resolve: number;
  steps: Readonly<Record<string, number>>;
  durationFrames: number;
}
export interface AnnotationState {
  visible: boolean;
  /** Eased draw-on progress, 0..1. */
  enter: number;
  /** Opacity after the exit fade, 0..1. */
  opacity: number;
  /** Frames since the mark started, for loops such as flow pulses. */
  elapsed: number;
}
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const eases: Record<AnnotationEase, (t: number) => number> = {
  linear: t => t,
  cubic: t => 1 - Math.pow(1 - t, 3),
  expo: t => t >= 1 ? 1 : 1 - Math.pow(2, -10 * t),
  back: t => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2),
};
export function resolveAnnotationCue(cue: AnnotationCue, beats: AnnotationBeats): number {
  if (typeof cue === "number") return cue;
  if (cue === "start") return 0;
  if (typeof cue === "string") return beats[cue];
  const frame = beats.steps[cue.step];
  if (frame === undefined) throw new Error("Subject annotation: unknown step " + cue.step);
  return frame;
}
export function annotationWindow(timing: AnnotationTiming, beats: AnnotationBeats): { start: number; end: number } {
  const start = resolveAnnotationCue(timing.at, beats) + (timing.offset ?? 0);
  const end = timing.until === undefined ? beats.durationFrames
    : resolveAnnotationCue(timing.until, beats) + (timing.untilOffset ?? 0);
  return { start, end };
}
/** Frame-exact state of one mark. Reduced motion shows settled marks inside their window. */
export function annotationState(timing: AnnotationTiming, beats: AnnotationBeats, frame: number, reducedMotion = false): AnnotationState {
  const { start, end } = annotationWindow(timing, beats);
  if (frame < start || frame >= end) return { visible: false, enter: 0, opacity: 0, elapsed: 0 };
  if (reducedMotion) return { visible: true, enter: 1, opacity: 1, elapsed: 0 };
  const enter = eases[timing.ease ?? "expo"](clamp01((frame - start) / Math.max(1, timing.enter ?? 14)));
  const exit = timing.until === undefined ? 1 : clamp01((end - frame) / Math.max(1, timing.exit ?? 6));
  return { visible: true, enter, opacity: exit, elapsed: frame - start };
}
/** Normalized subject point → stage pixels under a centred object-fit: cover crop. */
export function coverPoint(p: AnnotationPoint, subject: { width?: number; height?: number }, w: number, h: number): AnnotationPoint {
  if (!subject.width || !subject.height) return { x: p.x * w, y: p.y * h };
  const s = Math.max(w / subject.width, h / subject.height), dw = subject.width * s, dh = subject.height * s;
  return { x: (w - dw) / 2 + p.x * dw, y: (h - dh) / 2 + p.y * dh };
}
/** Pixel length of one shorter-side unit in the annotation's space. */
export function annotationUnit(space: "subject" | "stage", subject: { width?: number; height?: number }, w: number, h: number): number {
  if (space === "stage" || !subject.width || !subject.height) return Math.min(w, h);
  const s = Math.max(w / subject.width, h / subject.height);
  return Math.min(subject.width, subject.height) * s;
}
const finitePoint = (p: AnnotationPoint | undefined) =>
  !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
/** Returns the first contract problem, or undefined when every annotation is placeable. */
export function checkSubjectAnnotations(list: SubjectAnnotation[], beats: AnnotationBeats): string | undefined {
  if (!Array.isArray(list)) return "annotations must be a list.";
  if (new Set(list.map(a => a?.id)).size !== list.length || !list.every(a => typeof a?.id === "string" && a.id.trim())) return "annotations need unique stable IDs.";
  for (const a of list) {
    const cue = (c: AnnotationCue | undefined) => c === undefined || typeof c === "number" ? Number.isSafeInteger(c ?? 0)
      : typeof c === "string" ? ["start", "dock", "reveal", "resolve"].includes(c) : c.step in beats.steps;
    if (!a.timing || !cue(a.timing.at) || !cue(a.timing.until)) return `annotation ${a.id} has an unknown or invalid cue.`;
    const { start, end } = annotationWindow(a.timing, beats);
    if (start < 0 || start >= beats.durationFrames || end <= start) return `annotation ${a.id} must start inside the composition and end after it starts.`;
    if (a.color !== undefined && (typeof a.color !== "string" || !a.color.trim())) return `annotation ${a.id} color must be a CSS colour.`;
    if (a.weight !== undefined && !(a.weight > 0)) return `annotation ${a.id} weight must be positive.`;
    const ok = a.kind === "arrow" ? finitePoint(a.from) && finitePoint(a.to) && (a.from.x !== a.to.x || a.from.y !== a.to.y)
      : a.kind === "path" ? Array.isArray(a.points) && a.points.length >= 2 && a.points.every(finitePoint)
        && (a.headingWindow === undefined || (a.headingWindow >= 0 && a.headingWindow <= .5))
        && (a.maxTurn === undefined || (Number.isFinite(a.maxTurn) && a.maxTurn > 0))
      : a.kind === "ring" ? finitePoint(a.center) && a.radius > 0
      : a.kind === "label" ? finitePoint(a.anchor) && typeof a.text === "string" && !!a.text.trim()
      : a.kind === "spotlight" ? finitePoint(a.center) && a.radius > 0 && (a.dim === undefined || (a.dim >= 0 && a.dim <= 1))
      : false;
    if (!ok) return `annotation ${a.id} has invalid ${(a as { kind?: string }).kind ?? "kind"} geometry.`;
  }
  return undefined;
}
type LabelSide = "above" | "below" | "left" | "right";
/** Labels flip away from a near frame edge so the chip opens into the picture. */
export function resolveLabelSide(side: LabelSide, anchor: AnnotationPoint, w: number, h: number): LabelSide {
  if (side === "right" && anchor.x > w * .62) return "left";
  if (side === "left" && anchor.x < w * .38) return "right";
  if (side === "above" && anchor.y < h * .22) return "below";
  if (side === "below" && anchor.y > h * .78) return "above";
  return side;
}
/**
 * CPU-only framing preflight for one output size: lists marks whose geometry
 * falls outside the stage after the cover crop. Run it per aspect before
 * rendering; spotlights are exempt because they are meant to bleed.
 */
export function annotationFraming(annotations: readonly SubjectAnnotation[], subject: { width?: number; height?: number },
  w: number, h: number): { id: string; problem: string }[] {
  const out: { id: string; problem: string }[] = [];
  for (const a of annotations) {
    const space = a.space ?? "subject";
    const at = (p: AnnotationPoint) => space === "stage" ? { x: p.x * w, y: p.y * h } : coverPoint(p, subject, w, h);
    const unit = annotationUnit(space, subject, w, h);
    const pts = a.kind === "arrow" ? [a.from, a.to].map(at)
      : a.kind === "path" ? a.points.map(at)
      : a.kind === "ring" ? (() => { const c = at(a.center), r = a.radius * unit;
        return [{ x: c.x - r, y: c.y - r }, { x: c.x + r, y: c.y + r }]; })()
      : a.kind === "label" ? [at(a.anchor)]
      : [];
    if (pts.some(p => p.x < 0 || p.x > w || p.y < 0 || p.y > h)) out.push({ id: a.id, problem: `${a.kind} leaves the ${w}×${h} frame` });
  }
  return out;
}
