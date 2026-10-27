/**
 * Character performance evaluator — a pure function of `definition + instance + cues + frame`.
 *
 * Deterministic seek: nothing accumulates between calls. Blink schedules, idle phase and
 * takeovers are recomputed from the seed and the cue list, so a random seek, reverse scrub or
 * isolated frame render returns the same state as linear playback (docs/11 §1.2).
 *
 * Channel order (docs/10 §2): base pose → idle → actions → expression → parallax → gaze →
 * mouth/blink variants → limits. Override actions replace the accumulated motion of the parts
 * their channel owns; additive actions and idle sum on top. Each step is explicit, so the
 * result never depends on object key order.
 */

import { applyMatrixToPoint, IDENTITY, lerpNumber, multiplyMatrix, rotationMatrix, scaleMatrix, translationMatrix } from "../motion/matrix";
import { evaluateEasing } from "../motion/easing";
import { isValidCorrectionKeys, samplePoseCorrection } from "./authoring";
import type { AffineMatrix, EasingSpec } from "../motion/types";
import type {
  CharacterAction,
  CharacterAsset,
  CharacterCue,
  CharacterDefinition,
  CharacterDiagnostic,
  CharacterFrameState,
  CharacterInstance,
  CharacterPart,
  CharacterPartState,
  CharacterPoseDelta,
  CharacterPoseMap,
  CharacterVec2,
} from "./definition";

/** Maximum parallax translation at `depth = 1`, `look = ±1`. */
export const CHARACTER_PARALLAX_PX = 8;
const DEFAULT_EASING: EasingSpec = "ease-in-out-cubic";
const DEFAULT_OVERRIDE_BLEND_FRAMES = 6;

/** Internal motion accumulator, relative to a part's rest transform. Scale is multiplicative. */
interface Delta {
  x: number;
  y: number;
  rotation: number;
  sx: number;
  sy: number;
}

const identityDelta = (): Delta => ({ x: 0, y: 0, rotation: 0, sx: 1, sy: 1 });

function toDelta(pose: CharacterPoseDelta | undefined): Delta {
  return { x: pose?.x ?? 0, y: pose?.y ?? 0, rotation: pose?.rotation ?? 0, sx: pose?.scaleX ?? 1, sy: pose?.scaleY ?? 1 };
}

function mixDelta(from: Delta, to: Delta, t: number): Delta {
  return {
    x: lerpNumber(from.x, to.x, t),
    y: lerpNumber(from.y, to.y, t),
    rotation: lerpNumber(from.rotation, to.rotation, t),
    sx: lerpNumber(from.sx, to.sx, t),
    sy: lerpNumber(from.sy, to.sy, t),
  };
}

/** Adds `weight * delta` to an accumulator; scale is applied as a factor so 1 stays neutral. */
function addDelta(base: Delta, delta: Delta, weight: number): Delta {
  return {
    x: base.x + delta.x * weight,
    y: base.y + delta.y * weight,
    rotation: base.rotation + delta.rotation * weight,
    sx: base.sx * (1 + (delta.sx - 1) * weight),
    sy: base.sy * (1 + (delta.sy - 1) * weight),
  };
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Seeded PRNG (mulberry32). Deterministic for a given seed. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}

/** The asset key to draw for a part, with an optional variant. Variants fall back to the default drawing. */
export function partAssetKey(part: CharacterPart, variant?: string): string {
  return (variant !== undefined && part.variants?.[variant]) || part.asset;
}

/**
 * Maps a part's asset coordinates into its parent's asset coordinates: translate to the pivot,
 * scale, rotate, translate by the local offset, translate back. Compose with the parent's world
 * matrix to place children; nested SVG groups do the same thing.
 */
export function partLocalMatrix(part: CharacterPart, state: CharacterPartState): AffineMatrix {
  const { x: px, y: py } = part.pivot;
  let m = translationMatrix(-px, -py);
  m = multiplyMatrix(m, scaleMatrix(state.scaleX, state.scaleY));
  m = multiplyMatrix(m, rotationMatrix((state.rotation * Math.PI) / 180));
  m = multiplyMatrix(m, translationMatrix(state.x, state.y));
  return multiplyMatrix(m, translationMatrix(px, py));
}

/** Palette and asset drawings for one skin. Unknown skins fall back to the defaults. */
export function resolveCharacterAppearance(
  definition: CharacterDefinition,
  skin?: string,
): { palette: Record<string, string>; assets: Record<string, CharacterAsset> } {
  const applied = skin !== undefined ? definition.skins?.[skin] : undefined;
  const palette = { ...definition.palette, ...applied?.palette };
  const assets: Record<string, CharacterAsset> = {};
  for (const key of Object.keys(definition.assets)) {
    const source = applied?.assets?.[key] ?? key;
    assets[key] = definition.assets[source] ?? definition.assets[key];
  }
  return { palette, assets };
}

/** Rest-pose world matrices, cached per definition object; gaze origins are measured here. */
const restWorldCache = new WeakMap<CharacterDefinition, Map<string, AffineMatrix>>();

interface Context {
  definition: CharacterDefinition;
  partById: Map<string, CharacterPart>;
  diagnostics: CharacterDiagnostic[];
  reported: Set<string>;
  report(code: string, severity: CharacterDiagnostic["severity"], message: string, extra?: Partial<CharacterDiagnostic>): void;
}

function createContext(definition: CharacterDefinition): Context {
  const context: Context = {
    definition,
    partById: new Map(definition.parts.map((part) => [part.id, part])),
    diagnostics: [],
    reported: new Set(),
    report(code, severity, message, extra) {
      const key = `${code}|${extra?.cueId ?? ""}|${extra?.partId ?? ""}`;
      if (context.reported.has(key)) return;
      context.reported.add(key);
      context.diagnostics.push({ code, severity, message, ...extra });
    },
  };
  return context;
}

/** Local state of a part from its rest transform plus accumulated deltas (limits applied later). */
function localState(rest: Delta, delta: Delta): CharacterPartState {
  return {
    x: rest.x + delta.x,
    y: rest.y + delta.y,
    rotation: rest.rotation + delta.rotation,
    scaleX: rest.sx * delta.sx,
    scaleY: rest.sy * delta.sy,
  };
}

/** World matrices for every part, parents resolved before children. */
function worldMatrices(context: Context, states: Map<string, CharacterPartState>): Map<string, AffineMatrix> {
  const world = new Map<string, AffineMatrix>();
  const visit = (part: CharacterPart, depth: number): AffineMatrix => {
    const known = world.get(part.id);
    if (known) return known;
    const state = states.get(part.id);
    if (!state || depth > context.definition.parts.length) return IDENTITY;
    const local = partLocalMatrix(part, state);
    const parent = part.parent !== undefined ? context.partById.get(part.parent) : undefined;
    const matrix = parent ? multiplyMatrix(local, visit(parent, depth + 1)) : local;
    world.set(part.id, matrix);
    return matrix;
  };
  for (const part of context.definition.parts) visit(part, 0);
  return world;
}

function anchorPositions(context: Context, world: Map<string, AffineMatrix>): Record<string, CharacterVec2> {
  const out: Record<string, CharacterVec2> = {};
  for (const [id, anchor] of Object.entries(context.definition.anchors ?? {})) {
    if (anchor.part === undefined) {
      out[id] = { x: anchor.at.x, y: anchor.at.y };
      continue;
    }
    const matrix = world.get(anchor.part);
    if (!matrix) {
      context.report("unknown-anchor-part", "error", `Anchor "${id}" follows unknown part "${anchor.part}".`);
      continue;
    }
    out[id] = applyMatrixToPoint(matrix, anchor.at);
  }
  return out;
}

/** Gaze origin: the rest-pose centre of the gaze parts' pivots. */
function gazeOrigin(context: Context, parts: readonly string[]): CharacterVec2 | undefined {
  let cache = restWorldCache.get(context.definition);
  if (!cache) {
    const restStates = new Map<string, CharacterPartState>();
    for (const part of context.definition.parts) {
      restStates.set(part.id, localState(toDelta(part.rest), identityDelta()));
    }
    cache = worldMatrices(context, restStates);
    restWorldCache.set(context.definition, cache);
  }
  const points = parts.flatMap((id) => {
    const part = context.partById.get(id);
    const matrix = cache.get(id);
    return part && matrix ? [applyMatrixToPoint(matrix, part.pivot)] : [];
  });
  if (!points.length) return undefined;
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  };
}

/** Variants declared by the phase that contains local time `t`, if any. */
function phaseVariantsAt(action: CharacterAction, t: number): Record<string, string> | undefined {
  let phaseStart = 0;
  for (const phase of action.phases) {
    const frames = Math.max(1, phase.frames);
    if (t < phaseStart + frames) return phase.variants;
    phaseStart += frames;
  }
  return undefined;
}

/** Targets of an action at local time `t`, interpolated phase by phase. */
function sampleAction(action: CharacterAction, t: number): Map<string, Delta> {
  const result = new Map<string, Delta>();
  let phaseStart = 0;
  let previous = new Map<string, Delta>();
  for (const phase of action.phases) {
    const frames = Math.max(1, phase.frames);
    const targets = new Map<string, Delta>();
    for (const [id, pose] of Object.entries(phase.pose)) targets.set(id, toDelta(pose));
    if (t < phaseStart + frames) {
      const progress = evaluateEasing(phase.easing ?? DEFAULT_EASING, (t - phaseStart) / frames);
      const ids = new Set([...previous.keys(), ...targets.keys()]);
      for (const id of ids) {
        result.set(id, mixDelta(previous.get(id) ?? identityDelta(), targets.get(id) ?? identityDelta(), progress));
      }
      return result;
    }
    previous = new Map(
      [...new Set([...previous.keys(), ...targets.keys()])].map((id) => [id, targets.get(id) ?? identityDelta()]),
    );
    phaseStart += frames;
  }
  // Past the last phase the action has ended; its parts are back at rest.
  for (const id of previous.keys()) result.set(id, identityDelta());
  return result;
}

function actionDuration(action: CharacterAction): number {
  return action.phases.reduce((sum, phase) => sum + Math.max(1, phase.frames), 0);
}

interface Takeover {
  cue: Extract<CharacterCue, { kind: "action" }>;
  action: CharacterAction;
  priority: number;
  start: number;
  total: number;
  /** Fade-in length when this action takes over a blending-out predecessor. */
  rampIn: number;
  /** The action that interrupted this one, and how. */
  interruptor?: Takeover;
}

/** Override takeovers on one evaluation: queued, cut or blended in declared order. */
function planOverrideTakeovers(context: Context, cues: Extract<CharacterCue, { kind: "action" }>[]): Takeover[] {
  const entries: Takeover[] = [];
  const sorted = [...cues].sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id));
  for (const cue of sorted) {
    const action = context.definition.actions[cue.name];
    if (!action) {
      context.report("unknown-action", "error", `Action "${cue.name}" is not defined; the cue is ignored.`, { cueId: cue.id });
      continue;
    }
    if (action.blend !== "override") continue;
    const priority = cue.priority ?? action.priority;
    const entry: Takeover = {
      cue,
      action,
      priority,
      start: cue.startFrame,
      total: actionDuration(action),
      rampIn: 0,
    };
    const running = entries[entries.length - 1];
    if (running && running.interruptor === undefined && running.start + running.total > entry.start) {
      if (priority < running.priority) {
        context.report(
          "takeover-ignored",
          "warning",
          `"${cue.name}" has lower priority than the running "${running.cue.name}" on the same channel and was ignored.`,
          { cueId: cue.id },
        );
        continue;
      }
      if (action.takeover === "finish") {
        entry.start = running.start + running.total;
      } else {
        running.interruptor = entry;
        if (action.takeover === "blend-out") entry.rampIn = Math.max(1, action.blendOutFrames ?? DEFAULT_OVERRIDE_BLEND_FRAMES);
      }
    }
    entries.push(entry);
  }
  return entries;
}

function expressionAt(context: Context, cues: Extract<CharacterCue, { kind: "expression" }>[], frame: number) {
  let active: Extract<CharacterCue, { kind: "expression" }> | undefined;
  for (const cue of cues) if (cue.startFrame <= frame) active = cue;
  const fallback = context.definition.expressions.default;
  if (!active) return { name: fallback, magnitude: 1 };
  if (active.endFrame !== undefined && frame >= active.endFrame) return { name: fallback, magnitude: 1 };
  if (!context.definition.expressions.sets[active.name]) {
    context.report("unknown-expression", "error", `Expression "${active.name}" is not defined; "${fallback}" is shown.`, { cueId: active.id });
    return { name: fallback, magnitude: 1 };
  }
  return { name: active.name, magnitude: clamp01(active.magnitude ?? 1) };
}

/** Speech mouth state at `frame`: the variant and the frame its segment began. */
function mouthAt(
  context: Context,
  speech: NonNullable<CharacterDefinition["speech"]>,
  cues: readonly Extract<CharacterCue, { kind: "viseme" | "speech" }>[],
  frame: number,
  /** Off for the cross-fade's previous-segment lookup, so it cannot report cues that are not active now. */
  report = true,
): { variant: string; begin: number } {
  let active: Extract<CharacterCue, { kind: "viseme" | "speech" }> | undefined;
  let lastEnd = 0;
  for (const cue of cues) {
    if (cue.endFrame <= frame) lastEnd = Math.max(lastEnd, cue.endFrame);
    if (cue.startFrame <= frame && frame < cue.endFrame) active = cue;
  }
  if (!active) return { variant: speech.rest, begin: lastEnd };
  if (active.kind === "viseme") {
    const variant = speech.visemes[active.viseme];
    if (variant === undefined) {
      if (report) context.report("unknown-viseme", "warning", `Viseme "${active.viseme}" has no mouth shape; the mouth rests.`, { cueId: active.id, frame });
      return { variant: speech.rest, begin: active.startFrame };
    }
    return { variant, begin: active.startFrame };
  }
  // Word-level or approximate speech cycles mouth shapes; it never claims phoneme accuracy.
  const step = Math.max(1, speech.approximateStepFrames);
  const index = Math.floor((frame - active.startFrame) / step);
  const cycle = speech.approximateCycle;
  return {
    variant: cycle.length ? cycle[index % cycle.length] : speech.rest,
    begin: active.startFrame + index * step,
  };
}

/** Whether a blink is open at `frame`. Schedule is rebuilt from the seed each call (seek-stable). */
function isBlinking(spec: NonNullable<CharacterDefinition["blink"]>, seed: number, frame: number): boolean {
  const random = seededRandom(seed);
  const span = Math.max(1, spec.intervalFrames.max - spec.intervalFrames.min + 1);
  const nextInterval = () => spec.intervalFrames.min + Math.floor(random() * span);
  const duration = Math.max(1, spec.durationFrames);
  let start = nextInterval();
  while (start <= frame) {
    if (frame < start + duration) return true;
    start += duration + nextInterval();
  }
  return false;
}

/**
 * Evaluates one instance at one absolute frame. Cues for other instances are ignored; invalid
 * cues produce diagnostics and are skipped, never silently dropped into a different pose.
 */
export function evaluateCharacter(
  definition: CharacterDefinition,
  instance: CharacterInstance,
  cues: readonly CharacterCue[],
  frame: number,
): CharacterFrameState {
  const context = createContext(definition);
  const finiteFrame = Number.isFinite(frame);
  if (!finiteFrame) context.report("invalid-frame", "error", `Frame ${frame} is not finite; frame 0 is shown.`);
  const f = finiteFrame ? Math.max(0, Math.floor(frame)) : 0;

  if (instance.characterId !== definition.characterId) {
    context.report("character-mismatch", "error", `Instance "${instance.instanceId}" points at "${instance.characterId}", not "${definition.characterId}".`);
  }
  if (instance.revision !== definition.revision) {
    context.report("revision-mismatch", "error", `Instance pins revision "${instance.revision}" but the definition is "${definition.revision}".`);
  }
  if (instance.skin !== undefined && !definition.skins?.[instance.skin]) {
    context.report("unknown-skin", "warning", `Skin "${instance.skin}" is not defined; the default appearance is used.`);
  }
  const reduced = instance.reducedMotion === true;

  // Cues for this instance, with frame validity checked once.
  const own = cues.filter((cue) => cue.instanceId === instance.instanceId);
  for (const cue of own) {
    const badFrame = !Number.isInteger(cue.startFrame) || cue.startFrame < 0 ||
      ("endFrame" in cue && cue.endFrame !== undefined && (!Number.isInteger(cue.endFrame) || cue.endFrame <= cue.startFrame));
    if (badFrame) context.report("invalid-cue", "error", `Cue "${cue.id}" has invalid frames; it is ignored.`, { cueId: cue.id });
  }
  const valid = own.filter((cue) => {
    if (!Number.isInteger(cue.startFrame) || cue.startFrame < 0) return false;
    return !("endFrame" in cue) || cue.endFrame === undefined || (Number.isInteger(cue.endFrame) && cue.endFrame > cue.startFrame);
  });

  // Rest transforms with bounded parameters applied.
  const paramValues: Record<string, number> = {};
  for (const [name, spec] of Object.entries(definition.params ?? {})) {
    const supplied = instance.params?.[name] ?? spec.default;
    paramValues[name] = Math.min(spec.max, Math.max(spec.min, supplied));
  }
  for (const name of Object.keys(instance.params ?? {})) {
    if (!definition.params?.[name]) context.report("unknown-param", "warning", `Parameter "${name}" is not declared; it is ignored.`);
  }
  const rest = new Map<string, Delta>();
  for (const part of definition.parts) rest.set(part.id, toDelta(part.rest));
  for (const [name, spec] of Object.entries(definition.params ?? {})) {
    const offset = paramValues[name] - spec.default;
    for (const target of spec.targets) {
      const base = rest.get(target.part);
      if (!base) continue;
      const amount = offset * target.weight;
      if (target.property === "x") base.x += amount;
      else if (target.property === "y") base.y += amount;
      else if (target.property === "rotation") base.rotation += amount;
      else {
        base.sx *= 1 + amount;
        base.sy *= 1 + amount;
      }
    }
  }

  const delta = new Map<string, Delta>(definition.parts.map((part) => [part.id, identityDelta()]));
  const variants = new Map<string, string>();
  const applyPose = (pose: CharacterPoseMap, weight: number, base: "override" | "additive", channel?: string) => {
    for (const [id, value] of Object.entries(pose)) {
      const part = context.partById.get(id);
      if (!part) {
        context.report("unknown-part", "error", `Pose references unknown part "${id}".`, { partId: id });
        continue;
      }
      if (channel !== undefined && part.channel !== channel) {
        context.report("channel-mismatch", "error", `Part "${id}" belongs to channel "${part.channel}", not "${channel}"; its motion is skipped.`, { partId: id });
        continue;
      }
      const current = delta.get(id)!;
      const target = toDelta(value);
      delta.set(id, base === "override" ? mixDelta(current, target, weight) : addDelta(current, target, weight));
    }
  };

  // 1. Base pose.
  const base = definition.poses[definition.basePose];
  if (!base) context.report("unknown-pose", "error", `Base pose "${definition.basePose}" is not defined.`);
  else applyPose(base, 1, "override");

  // 2. Idle: low-amplitude, seeded, suspended by reduced motion.
  if (definition.idle && !reduced) {
    const strength = Math.min(1, Math.max(0, instance.idleStrength ?? 1));
    for (const [id, spec] of Object.entries(definition.idle.parts)) {
      const period = Math.max(1, spec.periodFrames);
      const offset = (hashString(id) ^ instance.seed) % period;
      const value = spec.amplitude * strength * Math.sin((2 * Math.PI * (f + offset)) / period);
      const current = delta.get(id);
      if (!current) continue;
      if (spec.property === "y") current.y += value;
      else if (spec.property === "rotation") current.rotation += value;
      else {
        current.sy *= 1 + value;
      }
    }
  }

  // 3. Actions: override takeovers on their channel, then additive layers.
  const actionCues = valid.filter((cue): cue is Extract<CharacterCue, { kind: "action" }> => cue.kind === "action");
  const takeovers = planOverrideTakeovers(context, actionCues);
  for (const entry of takeovers) {
    const t = f - entry.start;
    if (t < 0 || t >= entry.total) continue;
    let weight = 1;
    if (entry.rampIn > 0) weight *= clamp01(t / entry.rampIn);
    const interruptor = entry.interruptor;
    if (interruptor && f >= interruptor.start) {
      if (interruptor.action.takeover === "cut") weight = 0;
      else if (interruptor.action.takeover === "blend-out") {
        const fade = Math.max(1, interruptor.action.blendOutFrames ?? DEFAULT_OVERRIDE_BLEND_FRAMES);
        weight *= 1 - clamp01((f - interruptor.start) / fade);
      }
    }
    if (weight <= 0) continue;
    const sample = sampleAction(entry.action, t);
    const phaseVariants = phaseVariantsAt(entry.action, t);
    if (weight > 0.5 && phaseVariants) {
      for (const [id, variant] of Object.entries(phaseVariants)) {
        const part = context.partById.get(id);
        if (!part || part.channel !== entry.action.channel) continue;
        if (!part.variants?.[variant]) {
          context.report("unknown-variant", "error", `Action "${entry.cue.name}" shows variant "${variant}" that part "${id}" does not define.`, { cueId: entry.cue.id, partId: id });
          continue;
        }
        variants.set(id, variant);
      }
    }
    for (const [id, value] of sample) {
      const part = context.partById.get(id);
      if (!part) continue;
      if (part.channel !== entry.action.channel) {
        context.report("channel-mismatch", "error", `Action "${entry.cue.name}" writes "${id}" from channel "${part.channel}", not "${entry.action.channel}".`, { cueId: entry.cue.id, partId: id });
        continue;
      }
      delta.set(id, mixDelta(delta.get(id)!, value, weight));
    }
  }
  for (const cue of actionCues) {
    const action = context.definition.actions[cue.name];
    if (!action || action.blend !== "additive") continue;
    const t = f - cue.startFrame;
    if (t < 0 || t >= actionDuration(action)) continue;
    for (const [id, value] of sampleAction(action, t)) {
      const current = delta.get(id);
      if (current) delta.set(id, addDelta(current, value, 1));
      else context.report("unknown-part", "error", `Action "${cue.name}" references unknown part "${id}".`, { cueId: cue.id, partId: id });
    }
    // Additive layers have no takeover, so their phase variants show for the whole phase.
    for (const [id, variant] of Object.entries(phaseVariantsAt(action, t) ?? {})) {
      if (!context.partById.get(id)?.variants?.[variant]) {
        context.report("unknown-variant", "error", `Action "${cue.name}" shows variant "${variant}" that part "${id}" does not define.`, { cueId: cue.id, partId: id });
        continue;
      }
      variants.set(id, variant);
    }
  }

  // 4. Facial expression: discrete variants plus scaled pose on the face.
  const expressionCues = valid.filter((cue): cue is Extract<CharacterCue, { kind: "expression" }> => cue.kind === "expression")
    .sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id));
  const expression = expressionAt(context, expressionCues, f);
  const set = definition.expressions.sets[expression.name];
  if (set) {
    for (const [id, variant] of Object.entries(set.variants ?? {})) {
      if (!context.partById.get(id)?.variants?.[variant]) {
        context.report("unknown-variant", "error", `Expression "${expression.name}" uses variant "${variant}" that part "${id}" does not define.`, { partId: id });
        continue;
      }
      variants.set(id, variant);
    }
    if (set.pose) applyPose(set.pose, expression.magnitude, "additive");
  }

  // 5. Parallax for depth parts (2.5D): a bounded translation toward the viewer's offset.
  const look = instance.look ?? { x: 0, y: 0 };
  if (Math.abs(look.x) > 1 || Math.abs(look.y) > 1) {
    context.report("look-clamped", "warning", "Instance look is outside -1..1 and was clamped.");
  }
  const lookX = Math.min(1, Math.max(-1, look.x));
  const lookY = Math.min(1, Math.max(-1, look.y));
  for (const part of definition.parts) {
    if (!part.depth) continue;
    const current = delta.get(part.id)!;
    current.x += lookX * part.depth * CHARACTER_PARALLAX_PX;
    current.y += lookY * part.depth * CHARACTER_PARALLAX_PX;
  }

  // Anchors use the pose before gaze, so a gaze target never moves itself.
  const states = new Map<string, CharacterPartState>();
  for (const part of definition.parts) states.set(part.id, localState(rest.get(part.id)!, delta.get(part.id)!));
  const preGazeAnchors = anchorPositions(context, worldMatrices(context, states));

  // 6. Gaze: pupils translate toward a declared or runtime target, eased in and out.
  const gazeCues = valid.filter((cue): cue is Extract<CharacterCue, { kind: "gaze" }> => cue.kind === "gaze")
    .sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id));
  const activeGaze = [...gazeCues].reverse().find((cue) => cue.startFrame <= f);
  if (definition.gaze && activeGaze) {
    const ease = Math.max(1, definition.gaze.easeFrames);
    const weight = f < activeGaze.endFrame
      ? clamp01((f - activeGaze.startFrame + 1) / ease)
      : clamp01(1 - (f - activeGaze.endFrame + 1) / ease);
    const target = preGazeAnchors[activeGaze.target] ?? instance.targets?.[activeGaze.target];
    const origin = gazeOrigin(context, definition.gaze.parts);
    if (!target) {
      context.report("missing-gaze-target", "warning", `Gaze target "${activeGaze.target}" is not an anchor or runtime target; the eyes rest.`, { cueId: activeGaze.id });
    } else if (origin && weight > 0) {
      const dx = target.x - origin.x, dy = target.y - origin.y;
      const length = Math.hypot(dx, dy);
      const reach = length > 0 ? Math.min(length, definition.gaze.maxOffset) / length : 0;
      for (const id of definition.gaze.parts) {
        const current = delta.get(id);
        if (!current) continue;
        current.x += dx * reach * weight;
        current.y += dy * reach * weight;
      }
    }
  }

  // 7. Speech mouth (visemes and approximate speech) and blink, both through variants.
  let mouth: { variant: string; from?: string; mix?: number } | undefined;
  const speechCues = valid.filter((cue): cue is Extract<CharacterCue, { kind: "viseme" | "speech" }> => cue.kind === "viseme" || cue.kind === "speech");
  const speaking = speechCues.some(cue => cue.startFrame <= f && f < cue.endFrame);
  // With no speech playing, an expression's own mouth variant stays visible (a "delighted" wide mouth).
  const expressionMouth = definition.speech !== undefined && !speaking && variants.has(definition.speech.mouthPart);
  if (definition.speech && !expressionMouth) {
    const now = mouthAt(context, definition.speech, speechCues, f);
    const transition = Math.max(0, definition.speech.transitionFrames);
    const previous = now.begin > 0 ? mouthAt(context, definition.speech, speechCues, now.begin - 1, false).variant : definition.speech.rest;
    const since = f - now.begin;
    mouth = { variant: now.variant };
    if (transition > 0 && since < transition && previous !== now.variant) {
      mouth.from = previous;
      mouth.mix = clamp01((since + 1) / (transition + 1));
    }
    if (!context.partById.get(definition.speech.mouthPart)?.variants?.[now.variant] && now.variant !== definition.speech.rest) {
      context.report("unknown-variant", "error", `Mouth variant "${now.variant}" is not defined on "${definition.speech.mouthPart}".`);
    }
  }
  if (definition.blink && !reduced && isBlinking(definition.blink, instance.seed, f)) {
    for (const id of definition.blink.parts) {
      if (context.partById.get(id)?.variants?.[definition.blink.variant]) variants.set(id, definition.blink.variant);
    }
  }
  // A speaking mouth may require a coordinated clean head/background plate.
  // Apply after full-head blinks/expressions so an old painted mouth never
  // reappears behind the independently animated mouth during speech.
  if (definition.speech && speaking) {
    for (const [id, variant] of Object.entries(definition.speech.activeVariants ?? {})) {
      if (id !== definition.speech.mouthPart && context.partById.get(id)?.variants?.[variant]) variants.set(id, variant);
    }
  }

  // 8. Per-instance editor corrections are applied on top of authored motion,
  // before local safety limits. Seeking does not accumulate any corrections.
  const correctionTracks = instance.corrections;
  const validCorrectionParts = new Set<string>();
  if (correctionTracks !== undefined) {
    if (!correctionTracks || typeof correctionTracks !== "object" || Array.isArray(correctionTracks) || Object.keys(correctionTracks).length > 128) {
      context.report("invalid-correction-track", "error", "Corrections must be a bounded map of part IDs to ordered keys.");
    } else {
      for (const [id, keys] of Object.entries(correctionTracks)) {
        if (!context.partById.has(id)) {
          context.report("unknown-correction-part", "warning", `Correction targets an unknown part "${id}".`, { partId: id });
        } else if (!isValidCorrectionKeys(keys)) {
          context.report("invalid-correction-track", "error", `Correction keys for "${id}" must be ordered, finite and bounded.`, { partId: id });
        } else {
          validCorrectionParts.add(id);
        }
      }
    }
  }

  // 9. Limits on final local transforms, then the output.
  const finalStates = new Map<string, CharacterPartState>();
  for (const part of definition.parts) {
    const state = localState(rest.get(part.id)!, delta.get(part.id)!);
    if (correctionTracks && validCorrectionParts.has(part.id)) {
      const correction = samplePoseCorrection(correctionTracks, part.id, f);
      state.x += correction.x ?? 0;
      state.y += correction.y ?? 0;
      state.rotation += correction.rotation ?? 0;
      state.scaleX *= correction.scaleX ?? 1;
      state.scaleY *= correction.scaleY ?? 1;
    }
    const limits = part.limits;
    if (limits?.translate) {
      state.x = Math.min(limits.translate.max.x, Math.max(limits.translate.min.x, state.x));
      state.y = Math.min(limits.translate.max.y, Math.max(limits.translate.min.y, state.y));
    }
    if (limits?.rotation) state.rotation = Math.min(limits.rotation.max, Math.max(limits.rotation.min, state.rotation));
    if (limits?.scale) {
      state.scaleX = Math.min(limits.scale.max, Math.max(limits.scale.min, state.scaleX));
      state.scaleY = Math.min(limits.scale.max, Math.max(limits.scale.min, state.scaleY));
    }
    finalStates.set(part.id, state);
  }

  const parts: Record<string, CharacterPartState> = {};
  for (const part of definition.parts) {
    const state = finalStates.get(part.id)!;
    const variant = variants.get(part.id);
    const isMouth = definition.speech?.mouthPart === part.id && mouth;
    if (isMouth) {
      if (part.variants?.[mouth!.variant] || mouth!.variant === definition.speech!.rest) state.variant = mouth!.variant;
      if (mouth!.from !== undefined && part.variants?.[mouth!.from]) {
        state.variantFrom = mouth!.from;
        state.variantMix = mouth!.mix;
      }
    } else if (variant !== undefined) {
      state.variant = variant;
    }
    parts[part.id] = state;
  }

  return {
    frame: f,
    parts,
    anchors: anchorPositions(context, worldMatrices(context, finalStates)),
    blinking: !reduced && definition.blink !== undefined && isBlinking(definition.blink, instance.seed, f),
    diagnostics: context.diagnostics,
  };
}
