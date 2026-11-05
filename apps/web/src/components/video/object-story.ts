/** OS1: a narrated scene told by persistent objects.
 * Every beat is one spoken phrase and must change something the viewer can see: objects arrive,
 * rearrange, count, connect, hand something over, get measured or get marked. Objects keep their
 * identity across beats, so motion follows the subject instead of replacing a slide.
 *
 * Pure and frame-addressable: `compileObjectStory` validates once, `evaluateObjectStory` is a lookup.
 * The compiler decides where each object sits and where the caption goes, using measured text.
 * It draws nothing and imports no renderer, clock or asset.
 */
import { evaluateEasing } from "../motion/easing";
import type { RationalFps, Rect, Vec2 } from "../motion/types";
import { compileAnimatedMetric, evaluateAnimatedMetric } from "../visual/animated-metric";
import type { AnimatedMetricPlan, MetricFormatSpec } from "../visual/animated-metric";
import { planExplainerLayout } from "../visual/explainer-layout";
import type { MeasureText } from "../media/text-layout";

export const OBJECT_STORY_ARRANGEMENTS = ["solo", "pair", "row", "stack", "ring"] as const;
export type ObjectStoryArrangementKind = (typeof OBJECT_STORY_ARRANGEMENTS)[number];
export const OBJECT_STORY_MARKS = ["check", "cross", "question", "warning"] as const;
export type ObjectStoryMark = (typeof OBJECT_STORY_MARKS)[number];

export interface ObjectStoryValue {
  format: MetricFormatSpec;
  /** Counts start here. @default 0 */
  initial?: number;
  /** Show `initial` from the first frame, for a value carried in from the previous scene.
   * Otherwise the value appears at its first `set-value`. */
  shownFromStart?: boolean;
  language?: string;
}
export interface ObjectStoryObject {
  id: string;
  /** Short name drawn under the object. */
  label?: string;
  /** Opaque art reference for the renderer's `renderObject`. */
  art?: string;
  value?: ObjectStoryValue;
}
export interface ObjectStoryArrangement {
  kind: ObjectStoryArrangementKind;
  /** Everything on stage during this beat, in reading order. An object left out exits. */
  objects: readonly string[];
}
interface OpTiming {
  /** First frame, inside the beat. @default the beat's first frame */
  atFrame?: number;
  /** @default 20 frames at 30 fps, scaled to the frame rate */
  durationFrames?: number;
}
export type ObjectStoryOp = OpTiming & (
  | { kind: "set-value"; object: string; value: number }
  | { kind: "connect"; from: string; to: string; label?: string }
  | { kind: "disconnect"; from: string; to: string }
  | { kind: "transfer"; from: string; to: string; label?: string }
  | { kind: "absorb"; object: string; into: string }
  | { kind: "measure-gap"; a: string; b: string; label: string }
  /** A verdict on an object for the rest of its beat. `persist` keeps it while the object stays on stage. */
  | { kind: "mark"; object: string; mark: ObjectStoryMark; persist?: boolean }
  | { kind: "highlight"; object: string }
);
export interface ObjectStoryCaption {
  text: string;
  /** Words shown in the accent colour. */
  emphasis?: readonly string[];
}
export interface ObjectStoryBeat {
  id: string;
  startFrame: number;
  /** Exclusive. The next beat starts here. */
  endFrame: number;
  arrangement: ObjectStoryArrangement;
  ops?: readonly ObjectStoryOp[];
  /** Omit to keep the previous caption; `null` clears it. */
  caption?: ObjectStoryCaption | null;
  /** Push in on one object and quiet the others. */
  focus?: string;
  /** A deliberate breath, such as after a payoff. It still counts against the stillness budget. */
  hold?: boolean;
}
export interface ObjectStorySpec {
  schemaVersion: 1;
  id: string;
  fps: RationalFps;
  durationFrames: number;
  width: number;
  height: number;
  objects: readonly ObjectStoryObject[];
  beats: readonly ObjectStoryBeat[];
  /** Objects already on stage at frame 0, for continuity from the previous scene. */
  carried?: ObjectStoryArrangement;
  language?: string;
  /** Longest wait between visible changes before `still-stretch` is reported. @default 2.5 s */
  maxStillSeconds?: number;
}
export interface ObjectStoryDiagnostic {
  code: "invalid-spec" | "unknown-object" | "unknown-arrangement" | "beat-order" | "beat-gap" | "op-outside-beat" | "object-not-on-stage" |
    "value-not-declared" | "no-link" | "beat-without-change" | "caption-no-room" | "too-many-objects" | "still-stretch";
  severity: "error" | "warning";
  message: string;
  beatId?: string;
}

interface CaptionPlan { lines: string[]; rect: Rect; align: "start" | "center"; fontSizePx: number; lineHeightPx: number; emphasis: readonly string[]; startFrame: number; revealFrames: number }
interface ResolvedOp { op: ObjectStoryOp; startFrame: number; endFrame: number }
interface ResolvedBeat {
  beat: ObjectStoryBeat;
  rects: ReadonlyMap<string, Rect>;
  from: ReadonlyMap<string, Rect>;
  ops: readonly ResolvedOp[];
  caption: CaptionPlan | null;
  camera: { scale: number; origin: Vec2 };
}
export interface ObjectStoryPacing {
  /** Half-open frame ranges in which something on stage visibly changes. */
  changes: readonly (readonly [number, number])[];
  longestStillFrames: number;
  longestStillSeconds: number;
  changesPerMinute: number;
}
export interface ObjectStoryPlan {
  spec: ObjectStorySpec;
  beats: readonly ResolvedBeat[];
  objects: ReadonlyMap<string, ObjectStoryObject>;
  metrics: ReadonlyMap<string, { plan: AnimatedMetricPlan; shownFrom: number }>;
  pacing: ObjectStoryPacing;
  transitionFrames: number;
}
export type ObjectStoryCompilation =
  | { ok: true; plan: ObjectStoryPlan; diagnostics: readonly ObjectStoryDiagnostic[] }
  | { ok: false; diagnostics: readonly ObjectStoryDiagnostic[] };

export interface ObjectStoryOptions {
  /** Loaded-font text width. Must match what the renderer draws. */
  measure: MeasureText;
  /** CSS font shorthand without the size, such as `700 {size}px Geist`. `{size}` is replaced. */
  captionFont?: string;
  /** Largest caption size as a fraction of the output's short side. @default 0.066 */
  captionScale?: number;
}

const DEFAULT_FONT = "700 {size}px system-ui, sans-serif";
const MAX_OBJECTS = 6;
const seconds = (fps: RationalFps) => fps.den / fps.num;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const centre = (r: Rect): Vec2 => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const lerpRect = (a: Rect, b: Rect, t: number): Rect => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), width: lerp(a.width, b.width, t), height: lerp(a.height, b.height, t) });
const scaleRect = (r: Rect, factor: number): Rect => {
  const c = centre(r), width = r.width * factor, height = r.height * factor;
  return { x: c.x - width / 2, y: c.y - height / 2, width, height };
};

/** Normalized areas. Wide outputs put a lone subject beside its caption, and groups above it. */
function stageFor(kind: ObjectStoryArrangementKind, landscape: boolean): { area: Rect; placement: readonly ("right" | "left" | "below" | "above")[] } {
  if (!landscape) return { area: { x: .07, y: .12, width: .86, height: .5 }, placement: ["below", "above"] };
  if (kind === "solo" || kind === "stack") return { area: { x: .5, y: .1, width: .44, height: .8 }, placement: ["left", "below"] };
  return { area: { x: .06, y: .13, width: .88, height: .58 }, placement: ["below", "above"] };
}

/** Pixel rects for the objects of an arrangement, largest that fit, centred in their area. */
function layOut(arrangement: ObjectStoryArrangement, width: number, height: number): Map<string, Rect> {
  const { area } = stageFor(arrangement.kind, width >= height);
  const box = { x: area.x * width, y: area.y * height, width: area.width * width, height: area.height * height };
  const n = arrangement.objects.length, gap = Math.min(box.width, box.height) * .08;
  const out = new Map<string, Rect>();
  const place = (id: string, cx: number, cy: number, w: number, h: number) => out.set(id, { x: cx - w / 2, y: cy - h / 2, width: w, height: h });
  if (arrangement.kind === "ring" && n > 2) {
    const size = Math.min(box.width, box.height) * .42, rx = (box.width - size) / 2, ry = (box.height - size) / 2;
    arrangement.objects.forEach((id, i) => {
      const angle = -Math.PI / 2 + (i * Math.PI * 2) / n;
      place(id, box.x + box.width / 2 + Math.cos(angle) * rx, box.y + box.height / 2 + Math.sin(angle) * ry, size, size);
    });
    return out;
  }
  if (arrangement.kind === "stack") {
    const size = Math.min((box.height - gap * (n - 1)) / n, box.width);
    const top = box.y + (box.height - (size * n + gap * (n - 1))) / 2;
    arrangement.objects.forEach((id, i) => place(id, box.x + box.width / 2, top + size / 2 + i * (size + gap), size, size));
    return out;
  }
  // Two objects stand apart, so what sits between them (a gap, a link) has room to be seen.
  const spacing = n === 2 ? Math.max(gap, box.width * .2) : gap;
  const size = Math.min((box.width - spacing * (n - 1)) / n, box.height);
  const left = box.x + (box.width - (size * n + spacing * (n - 1))) / 2;
  arrangement.objects.forEach((id, i) => place(id, left + size / 2 + i * (size + spacing), box.y + box.height / 2, size, size));
  return out;
}

const wordsOf = (text: string): string[] => text.trim().split(/\s+/u).filter(Boolean);
/** A word per reveal step. Unspaced text such as Japanese reveals by character. */
const stepsOf = (line: string): string[] => (line.includes(" ") || !/[\u3000-\u9fff\uff00-\uffef]/u.test(line) ? wordsOf(line) : [...line]);

function placeCaption(spec: ObjectStorySpec, beat: ObjectStoryBeat, caption: ObjectStoryCaption, rects: ReadonlyMap<string, Rect>, startFrame: number, options: ObjectStoryOptions): CaptionPlan | null {
  const { width, height } = spec;
  const short = Math.min(width, height), largest = Math.round(short * (options.captionScale ?? .066));
  const subjects = [...rects].map(([id, r]) => ({ id, region: { x: r.x / width, y: r.y / height, width: r.width / width, height: r.height / height } }));
  const { placement } = stageFor(beat.arrangement.kind, width >= height);
  for (const fontSizePx of [largest, Math.round(largest * .85), Math.round(largest * .72)]) {
    const result = planExplainerLayout({ text: caption.text, font: (options.captionFont ?? DEFAULT_FONT).replace("{size}", String(fontSizePx)), fontSizePx,
      lineHeightPx: Math.round(fontSizePx * 1.2), viewport: { width, height }, subjects, protect: subjects.map(item => item.id), maxLines: 4, placement,
      safeMargin: .06, gapPx: short * .03, language: spec.language }, options.measure);
    if (result.ok) {
      const steps = result.text.lines.flatMap(stepsOf).length;
      const frameRate = spec.fps.num / spec.fps.den;
      const rect = { x: result.text.rect.x * width, y: result.text.rect.y * height, width: result.text.rect.width * width, height: result.text.rect.height * height };
      // Beside a subject the caption reads from its edge; under a group it sits centred on the group.
      const centred = result.text.placement === "below" || result.text.placement === "above";
      return { lines: result.text.lines, rect: centred ? { ...rect, x: (width - rect.width) / 2 } : rect, align: centred ? "center" : "start",
        fontSizePx, lineHeightPx: result.text.lineHeightPx, emphasis: caption.emphasis ?? [], startFrame,
        revealFrames: Math.min(Math.max(1, beat.endFrame - startFrame), Math.round(steps * frameRate * .28)) };
    }
  }
  return null;
}

const opTargets = (op: ObjectStoryOp): string[] => {
  if (op.kind === "connect" || op.kind === "disconnect" || op.kind === "transfer") return [op.from, op.to];
  if (op.kind === "absorb") return [op.object, op.into];
  if (op.kind === "measure-gap") return [op.a, op.b];
  return [op.object];
};
const linkKey = (from: string, to: string) => `${from}→${to}`;

/** Validate a story and resolve every frame-dependent decision once. */
export function compileObjectStory(spec: ObjectStorySpec, options: ObjectStoryOptions): ObjectStoryCompilation {
  const diagnostics: ObjectStoryDiagnostic[] = [];
  const error = (code: ObjectStoryDiagnostic["code"], message: string, beatId?: string) => { diagnostics.push({ code, severity: "error", message, ...(beatId ? { beatId } : {}) }); };
  if (spec?.schemaVersion !== 1 || !spec.id?.trim() || !Number.isSafeInteger(spec.durationFrames) || spec.durationFrames < 1 ||
    !(spec.fps?.num > 0) || !(spec.fps?.den > 0) || !(spec.width > 0) || !(spec.height > 0) || !Array.isArray(spec.objects) || !Array.isArray(spec.beats) || !spec.beats.length)
    return { ok: false, diagnostics: [{ code: "invalid-spec", severity: "error", message: "A story needs schemaVersion 1, an ID, rational fps, an output size, objects and at least one beat." }] };
  const objects = new Map(spec.objects.map(item => [item.id, item]));
  if (objects.size !== spec.objects.length) error("invalid-spec", "Object IDs must be unique.");
  const frameRate = spec.fps.num / spec.fps.den;
  const standardFrames = Math.max(1, Math.round(frameRate * .67));
  const transitionFrames = Math.max(1, Math.round(frameRate * .5));

  const known = (id: string, beatId: string) => { if (!objects.has(id)) { error("unknown-object", `Beat "${beatId}" names object "${id}", which the story does not declare.`, beatId); return false; } return true; };
  const checkArrangement = (arrangement: ObjectStoryArrangement, beatId: string) => {
    if (!OBJECT_STORY_ARRANGEMENTS.includes(arrangement?.kind)) { error("unknown-arrangement", `Beat "${beatId}" uses an unknown arrangement.`, beatId); return false; }
    if (arrangement.objects.length > MAX_OBJECTS) error("too-many-objects", `Beat "${beatId}" puts ${arrangement.objects.length} objects on stage. Keep it to ${MAX_OBJECTS} or split the beat.`, beatId);
    return arrangement.objects.every(id => known(id, beatId));
  };

  let cursor = 0;
  for (const beat of spec.beats) {
    if (!Number.isSafeInteger(beat.startFrame) || !Number.isSafeInteger(beat.endFrame) || beat.endFrame <= beat.startFrame || beat.startFrame < cursor)
      error("beat-order", `Beat "${beat.id}" must have whole frames, end after it starts and follow the previous beat.`, beat.id);
    else if (beat.startFrame > cursor) error("beat-gap", `Nothing is planned between frames ${cursor} and ${beat.startFrame}, before beat "${beat.id}".`, beat.id);
    cursor = beat.endFrame;
  }
  if (cursor !== spec.durationFrames && !diagnostics.length) error("beat-gap", `The last beat ends at ${cursor}, but the story runs to ${spec.durationFrames}.`);
  if (spec.carried) checkArrangement(spec.carried, "carried");
  if (diagnostics.some(item => item.severity === "error")) return { ok: false, diagnostics };

  const resolved: ResolvedBeat[] = [];
  const links = new Set<string>();
  const valueOps = new Map<string, { value: number; startFrame: number; endFrame: number }[]>();
  const changes: [number, number][] = [];
  let previous: ReadonlyMap<string, Rect> = spec.carried ? layOut(spec.carried, spec.width, spec.height) : new Map();
  let caption: CaptionPlan | null = null, captionText: string | null = null;
  for (const beat of spec.beats) {
    if (!checkArrangement(beat.arrangement, beat.id)) continue;
    const rects = layOut(beat.arrangement, spec.width, spec.height);
    const moved = [...rects].some(([id, rect]) => { const before = previous.get(id); return !before || Math.abs(before.x - rect.x) + Math.abs(before.y - rect.y) + Math.abs(before.width - rect.width) > 1; }) ||
      [...previous.keys()].some(id => !rects.has(id));
    const span = beat.endFrame - beat.startFrame;
    if (moved) changes.push([beat.startFrame, Math.min(beat.endFrame, beat.startFrame + transitionFrames)]);
    const ops: ResolvedOp[] = [];
    for (const op of beat.ops ?? []) {
      const startFrame = op.atFrame ?? beat.startFrame;
      const endFrame = startFrame + (op.durationFrames ?? Math.min(standardFrames, span));
      if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame) || endFrame <= startFrame || startFrame < beat.startFrame || endFrame > beat.endFrame) {
        error("op-outside-beat", `A ${op.kind} in beat "${beat.id}" must start and finish inside the beat.`, beat.id);
        continue;
      }
      const targets = opTargets(op);
      if (!targets.every(id => known(id, beat.id))) continue;
      if (targets.some(id => !rects.has(id))) { error("object-not-on-stage", `A ${op.kind} in beat "${beat.id}" names an object that is not in its arrangement.`, beat.id); continue; }
      if (op.kind === "set-value") {
        if (!objects.get(op.object)?.value) { error("value-not-declared", `Object "${op.object}" has no value format, so beat "${beat.id}" cannot set one.`, beat.id); continue; }
        valueOps.set(op.object, [...(valueOps.get(op.object) ?? []), { value: op.value, startFrame, endFrame }]);
      }
      if (op.kind === "connect") links.add(linkKey(op.from, op.to));
      if (op.kind === "disconnect" && !links.delete(linkKey(op.from, op.to))) { error("no-link", `Beat "${beat.id}" disconnects a link that does not exist.`, beat.id); continue; }
      ops.push({ op, startFrame, endFrame });
      changes.push([startFrame, endFrame]);
    }
    if (!moved && !ops.length && !beat.hold)
      diagnostics.push({ code: "beat-without-change", severity: "error", beatId: beat.id, message: `Beat "${beat.id}" changes nothing on screen. Give it an operation, rearrange the stage, or merge it with the previous beat.` });
    if (beat.focus !== undefined && !rects.has(beat.focus))
      error("object-not-on-stage", `Beat "${beat.id}" focuses on "${beat.focus}", which is not on stage.`, beat.id);

    if (beat.caption === null) { caption = null; captionText = null; }
    else if ((beat.caption && beat.caption.text !== captionText) || (caption && moved)) {
      // A kept caption is placed again when the stage moves, without replaying its reveal.
      const text: ObjectStoryCaption = beat.caption ?? { text: captionText ?? "", emphasis: caption?.emphasis };
      const kept: CaptionPlan | null = text.text === captionText ? caption : null;
      caption = placeCaption(spec, beat, text, rects, kept?.startFrame ?? beat.startFrame, options);
      captionText = text.text;
      if (!caption) error("caption-no-room", `The caption of beat "${beat.id}" does not fit beside its objects. Shorten it or use fewer objects.`, beat.id);
    }
    const focus = beat.focus ? rects.get(beat.focus) : undefined;
    resolved.push({ beat, rects, from: previous, ops, caption, camera: { scale: focus ? 1.14 : 1, origin: focus ? centre(focus) : { x: spec.width / 2, y: spec.height / 2 } } });
    previous = rects;
  }

  const metrics = new Map<string, { plan: AnimatedMetricPlan; shownFrom: number }>();
  for (const object of spec.objects) if (object.value?.shownFromStart && !valueOps.has(object.id)) valueOps.set(object.id, []);
  for (const [id, sets] of valueOps) {
    const declared = objects.get(id)!.value!;
    const keyframes = [{ frame: -1, value: declared.initial ?? 0 }];
    for (const item of sets) keyframes.push({ frame: item.startFrame, value: keyframes[keyframes.length - 1].value }, { frame: item.endFrame, value: item.value });
    const distinct = keyframes.filter((item, index) => index === 0 || item.frame > keyframes[index - 1].frame);
    metrics.set(id, { shownFrom: declared.shownFromStart ? 0 : sets[0].startFrame, plan: compileAnimatedMetric({ id, label: objects.get(id)?.label ?? id, format: declared.format, keyframes: distinct, language: declared.language ?? spec.language }) });
  }

  const merged: [number, number][] = [];
  for (const range of [...changes].sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  let longest = 0, at = 0, stretchStart = 0;
  for (const [start, end] of [...merged, [spec.durationFrames, spec.durationFrames] as [number, number]]) {
    if (start - at > longest) { longest = start - at; stretchStart = at; }
    at = Math.max(at, end);
  }
  const pacing: ObjectStoryPacing = { changes: merged, longestStillFrames: longest, longestStillSeconds: longest * seconds(spec.fps),
    changesPerMinute: merged.length / Math.max(spec.durationFrames * seconds(spec.fps) / 60, 1 / 60) };
  if (pacing.longestStillSeconds > (spec.maxStillSeconds ?? 2.5))
    diagnostics.push({ code: "still-stretch", severity: "warning", message: `Nothing changes for ${pacing.longestStillSeconds.toFixed(1)} s from frame ${stretchStart}. Add an operation tied to what is being said there.` });
  if (diagnostics.some(item => item.severity === "error")) return { ok: false, diagnostics };
  return { ok: true, diagnostics, plan: { spec, beats: resolved, objects, metrics, pacing, transitionFrames } };
}

export interface ObjectStoryObjectFrame {
  id: string;
  rect: Rect;
  opacity: number;
  /** Quiet because another object has the focus. */
  dimmed: boolean;
  /** 0 to 1 attention pulse from a highlight or an arriving object. */
  pulse: number;
  label?: string;
  art?: string;
  value?: { text: string; progress: number };
  mark?: { kind: ObjectStoryMark; progress: number };
}
/** `bow` lifts the line over objects standing between its ends, in pixels. */
export interface ObjectStoryLinkFrame { id: string; from: Vec2; to: Vec2; bow: number; progress: number; opacity: number; label?: string }
export interface ObjectStoryTokenFrame { id: string; at: Vec2; opacity: number; label?: string }
export interface ObjectStoryGapFrame { id: string; from: Vec2; to: Vec2; progress: number; label: string }
export interface ObjectStoryCaptionWord { text: string; progress: number; emphasis: boolean }
export interface ObjectStoryCaptionFrame { rect: Rect; align: "start" | "center"; fontSizePx: number; lineHeightPx: number; lines: readonly (readonly ObjectStoryCaptionWord[])[] }
export interface ObjectStoryFrame {
  frame: number;
  beatId: string;
  beatIndex: number;
  camera: { scale: number; origin: Vec2 };
  objects: readonly ObjectStoryObjectFrame[];
  links: readonly ObjectStoryLinkFrame[];
  tokens: readonly ObjectStoryTokenFrame[];
  gaps: readonly ObjectStoryGapFrame[];
  caption: ObjectStoryCaptionFrame | null;
}

function beatAt(plan: ObjectStoryPlan, frame: number): number {
  let low = 0, high = plan.beats.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (plan.beats[middle].beat.startFrame <= frame) low = middle; else high = middle - 1;
  }
  return low;
}
const facing = (from: Rect, to: Rect): [Vec2, Vec2] => {
  const a = centre(from), b = centre(to);
  const edge = (r: Rect, c: Vec2, other: Vec2): Vec2 => {
    const dx = other.x - c.x, dy = other.y - c.y;
    if (!dx && !dy) return c;
    const t = Math.min(dx ? (r.width / 2) / Math.abs(dx) : Infinity, dy ? (r.height / 2) / Math.abs(dy) : Infinity);
    return { x: c.x + dx * t, y: c.y + dy * t };
  };
  return [edge(from, a, b), edge(to, b, a)];
};

/** The whole stage at an absolute frame. `settled` shows each beat's finished state for reduced motion. */
export function evaluateObjectStory(plan: ObjectStoryPlan, frame: number, { settled = false }: { settled?: boolean } = {}): ObjectStoryFrame {
  if (!Number.isSafeInteger(frame) || frame < 0) throw new Error("Object story frame must be a nonnegative integer.");
  const at = Math.min(frame, plan.spec.durationFrames - 1);
  const index = beatAt(plan, at), current = plan.beats[index];
  const eased = (start: number, end: number, name: "ease-in-out-cubic" | "ease-out-back" | "ease-out-cubic" = "ease-in-out-cubic") =>
    settled ? (at >= start ? 1 : 0) : evaluateEasing(name, clamp01((at - start) / Math.max(1, end - start)));
  const { beat } = current;
  // The first frame already shows the subject: the opening entrance starts before the film does.
  const lead = index === 0 ? Math.round(plan.transitionFrames * .4) : 0;
  const arrival = eased(beat.startFrame - lead, beat.startFrame + plan.transitionFrames, "ease-in-out-cubic");
  const entering = eased(beat.startFrame - lead, beat.startFrame + plan.transitionFrames, "ease-out-back");

  const rectNow = (id: string): Rect | undefined => {
    const to = current.rects.get(id), from = current.from.get(id);
    if (to && from) return lerpRect(from, to, arrival);
    return to ?? from;
  };
  const visible = new Set([...current.rects.keys(), ...current.from.keys()]);
  const absorbed = new Map<string, { into: string; t: number }>();
  const pulses = new Map<string, number>();
  const marks = new Map<string, { kind: ObjectStoryMark; progress: number }>();
  const links = new Map<string, ObjectStoryLinkFrame>();
  const gaps: ObjectStoryGapFrame[] = [];
  const tokens: ObjectStoryTokenFrame[] = [];
  const pulse = (id: string, value: number) => pulses.set(id, Math.max(pulses.get(id) ?? 0, value));
  const neighbours = (a: string, b: string) => Math.abs(beat.arrangement.objects.indexOf(a) - beat.arrangement.objects.indexOf(b)) === 1;

  // Links and marks persist across beats, so replay the operations up to this frame.
  for (let i = 0; i <= index; i++) for (const item of plan.beats[i].ops) {
    if (item.startFrame > at) continue;
    const { op } = item;
    const t = eased(item.startFrame, item.endFrame);
    if (op.kind === "mark" && visible.has(op.object) && (i === index || op.persist)) marks.set(op.object, { kind: op.mark, progress: eased(item.startFrame, item.endFrame, "ease-out-back") });
    // A link lasts while both of its objects stay on stage.
    if (op.kind === "connect" && current.rects.has(op.from) && current.rects.has(op.to)) {
      const a = rectNow(op.from)!, b = rectNow(op.to)!;
      const bow = neighbours(op.from, op.to) ? 0 : Math.max(a.height, b.height) * .34;
      const [from, to] = bow ? [{ x: a.x + a.width / 2, y: a.y }, { x: b.x + b.width / 2, y: b.y }] : facing(a, b);
      links.set(linkKey(op.from, op.to), { id: linkKey(op.from, op.to), from, to, bow, progress: t, opacity: 1, ...(op.label ? { label: op.label } : {}) });
    }
    if (op.kind === "disconnect") {
      const link = links.get(linkKey(op.from, op.to));
      if (link && t >= 1) links.delete(link.id); else if (link) link.opacity = 1 - t;
    }
    if (op.kind === "absorb" && i === index) {
      absorbed.set(op.object, { into: op.into, t });
      pulse(op.into, t >= .7 ? Math.sin(Math.PI * clamp01((t - .7) / .3)) : 0);
    }
    if (i !== index) continue;
    if (op.kind === "highlight") pulse(op.object, Math.sin(Math.PI * t));
    if (op.kind === "transfer" && t < 1) {
      const [from, to] = facing(rectNow(op.from)!, rectNow(op.to)!);
      tokens.push({ id: `${op.from}→${op.to}@${item.startFrame}`, at: { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) - Math.sin(Math.PI * t) * plan.spec.height * .04 },
        opacity: Math.min(1, Math.min(t, 1 - t) * 6), ...(op.label ? { label: op.label } : {}) });
      pulse(op.to, t >= .8 ? Math.sin(Math.PI * clamp01((t - .8) / .2)) : 0);
    }
    if (op.kind === "measure-gap") {
      const [from, to] = facing(rectNow(op.a)!, rectNow(op.b)!);
      gaps.push({ id: `${op.a}↔${op.b}`, from, to, progress: t, label: op.label });
    }
  }
  // A measured gap stays while its two sides stay next to each other.
  for (let i = 0; i < index; i++) for (const { op } of plan.beats[i].ops) if (op.kind === "measure-gap" && current.rects.has(op.a) && current.rects.has(op.b) && neighbours(op.a, op.b)) {
    const [from, to] = facing(rectNow(op.a)!, rectNow(op.b)!);
    if (!gaps.some(item => item.id === `${op.a}↔${op.b}`)) gaps.push({ id: `${op.a}↔${op.b}`, from, to, progress: 1, label: op.label });
  }

  const objects: ObjectStoryObjectFrame[] = [];
  for (const id of visible) {
    const object = plan.objects.get(id)!;
    let rect = rectNow(id)!;
    let opacity = 1;
    const inNow = current.rects.has(id), inBefore = current.from.has(id);
    if (inNow && !inBefore) { rect = scaleRect(rect, Math.max(.01, entering)); opacity = clamp01(arrival * 2.5); }
    if (!inNow && inBefore) { rect = scaleRect(rect, 1 - arrival * .2); opacity = 1 - arrival; }
    const taken = absorbed.get(id);
    if (taken) {
      const target = rectNow(taken.into)!;
      rect = lerpRect(rect, scaleRect(target, .25), taken.t);
      opacity = taken.t >= 1 ? 0 : Math.min(opacity, 1 - clamp01((taken.t - .75) / .25));
    }
    if (opacity <= 0) continue;
    const metric = plan.metrics.get(id);
    objects.push({ id, rect, opacity, dimmed: Boolean(beat.focus && beat.focus !== id), pulse: pulses.get(id) ?? 0,
      ...(object.label ? { label: object.label } : {}), ...(object.art ? { art: object.art } : {}),
      ...(metric && at >= metric.shownFrom ? { value: { text: evaluateAnimatedMetric(metric.plan, at).display, progress: eased(metric.shownFrom, metric.shownFrom + plan.transitionFrames, "ease-out-back") } } : {}),
      ...(marks.has(id) ? { mark: marks.get(id)! } : {}) });
  }

  let caption: ObjectStoryCaptionFrame | null = null;
  if (current.caption) {
    const { lines, rect, align, fontSizePx, lineHeightPx, emphasis, startFrame, revealFrames } = current.caption;
    const fold = (word: string) => word.toLocaleLowerCase().replace(/[^\p{L}\p{N}$€£¥%]/gu, "");
    const marked = new Set(emphasis.flatMap(item => wordsOf(item)).map(fold));
    const total = lines.flatMap(stepsOf).length, step = revealFrames / Math.max(1, total);
    let count = 0;
    caption = { rect, align, fontSizePx, lineHeightPx, lines: lines.map(line => stepsOf(line).map(text => {
      const start = startFrame + count++ * step;
      return { text, progress: settled ? 1 : clamp01((at - start) / Math.max(1, step * 1.6)), emphasis: marked.has(fold(text)) };
    })) };
  }
  const push = settled ? 0 : clamp01((at - beat.startFrame) / Math.max(1, beat.endFrame - beat.startFrame)) * .02;
  const previousCamera = index > 0 ? plan.beats[index - 1].camera : current.camera;
  return { frame: at, beatId: beat.id, beatIndex: index, objects, links: [...links.values()], tokens, gaps, caption,
    camera: { scale: lerp(previousCamera.scale, current.camera.scale, arrival) + (current.camera.scale > 1 ? push : 0),
      origin: { x: lerp(previousCamera.origin.x, current.camera.origin.x, arrival), y: lerp(previousCamera.origin.y, current.camera.origin.y, arrival) } } };
}
