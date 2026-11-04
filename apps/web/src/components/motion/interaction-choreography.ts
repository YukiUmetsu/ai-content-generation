/** Pure physical choreography: actors, hands and shared objects, by absolute frame.
 *
 * Space is right-handed, Y-up metres. An object is at rest or attached to one
 * effector. Attachment changes only on a declared contact frame, and the grip
 * position stays on the effector for every held frame, so contact cannot slip.
 * Renderer-neutral: no Three.js, no DOM, no clocks. Compilation walks frames once
 * forward and stores them, so any seek order returns identical state.
 */
import type { Diagnostic, RationalFps } from "./types";

export type Vec3 = readonly [number, number, number];
export type InteractionTiming = "restrained" | "natural" | "expressive";

export interface InteractionTimingProfile {
  /** Pull back before a move, as a fraction of its distance. */
  anticipation: number;
  /** Pass the target before settling, as a fraction of its distance. */
  overshoot: number;
  /** Lift through a move, as a fraction of its distance. */
  arc: number;
  /** Frames gaze starts before the hand. */
  gazeLeadFrames: number;
  /** Head spring stiffness per frame. Higher turns faster. */
  headResponse: number;
}

/** Named pacing. Same outcome and contacts, different performance. */
export const INTERACTION_TIMING: Record<InteractionTiming, InteractionTimingProfile> = {
  restrained: { anticipation: .02, overshoot: .005, arc: .12, gazeLeadFrames: 10, headResponse: .14 },
  natural: { anticipation: .06, overshoot: .03, arc: .22, gazeLeadFrames: 8, headResponse: .2 },
  expressive: { anticipation: .12, overshoot: .07, arc: .34, gazeLeadFrames: 6, headResponse: .28 },
};

export interface InteractionEffector {
  /** Hand position at rest, relative to the actor root, unrotated. */
  rest: Vec3;
  shoulder: Vec3;
  /** Longest straight reach from the shoulder. */
  reach: number;
}
export interface InteractionActor {
  id: string;
  position: Vec3;
  /** Radians about +Y. 0 faces +Z. */
  yaw: number;
  height: number;
  effectors: Record<string, InteractionEffector>;
}
export interface InteractionObject {
  id: string;
  position: Vec3;
  /** Radians about +Y. */
  yaw?: number;
  /** Radians about +X. */
  pitch?: number;
  /** Grip points in object space. */
  grips?: Record<string, Vec3>;
  bendable?: boolean;
}
export type InteractionLookTarget = { object: string } | { actor: string } | { point: Vec3 };
export type InteractionOp =
  | { kind: "move"; actor: string; to: Vec3; toYaw?: number; startFrame: number; endFrame: number }
  | { kind: "look"; actor: string; at: InteractionLookTarget; startFrame: number; endFrame?: number }
  | { kind: "grasp"; actor: string; effector: string; object: string; grip: string; startFrame: number; contactFrame: number }
  | { kind: "carry"; actor: string; effector: string; object: string; to: Vec3; toYaw?: number; toPitch?: number; startFrame: number; endFrame: number }
  | {
    kind: "place"; actor: string; effector: string; object: string; to: Vec3; toYaw?: number; toPitch?: number;
    startFrame: number; contactFrame: number;
    /** Let go this far above `to`, for actors who cannot reach the surface. The object falls the rest. */
    releaseHeight?: number;
    /** Frames the fall takes. Default 7, a light sheet in air. */
    fallFrames?: number;
  }
  | { kind: "release"; actor: string; effector: string; startFrame: number; endFrame: number };

export interface InteractionSpec {
  schemaVersion: 1;
  durationFrames: number;
  fps: RationalFps;
  timing?: InteractionTiming | InteractionTimingProfile;
  actors: readonly InteractionActor[];
  objects: readonly InteractionObject[];
  ops: readonly InteractionOp[];
  /** Largest head turn away from the body, degrees. Art limits this. */
  maxHeadTurn?: number;
}
export interface InteractionContact { frame: number; kind: "grasp" | "place"; actor: string; effector: string; object: string }
export interface InteractionObjectState { position: Vec3; yaw: number; pitch: number; bend: number }
export interface InteractionFrame {
  actors: Record<string, { position: Vec3; yaw: number; turn: { yaw: number; pitch: number } }>;
  objects: Record<string, InteractionObjectState>;
  effectors: Record<string, { position: Vec3; influence: number; holding: boolean }>;
  /** Current world position of each held object's grip. */
  grips: Record<string, Vec3>;
}
export interface InteractionPlan {
  spec: InteractionSpec;
  frames: readonly InteractionFrame[];
  contacts: readonly InteractionContact[];
}
export type InteractionDiagnostic = Diagnostic & { opIndex?: number };
export type InteractionCompilation =
  | { ok: true; plan: InteractionPlan; diagnostics: InteractionDiagnostic[] }
  | { ok: false; diagnostics: InteractionDiagnostic[] };

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const smoothstep = (value: number) => { const t = clamp01(value); return t * t * (3 - 2 * t); };
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const mix = (a: Vec3, b: Vec3, t: number): Vec3 => add(a, scale(subtract(b, a), t));
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const rotateY = (a: Vec3, yaw: number): Vec3 => {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [a[0] * c + a[2] * s, a[1], -a[0] * s + a[2] * c];
};
/** Object space to world: pitch about X, then yaw about Y. */
const orient = (a: Vec3, yaw: number, pitch: number): Vec3 => {
  const c = Math.cos(pitch), s = Math.sin(pitch);
  return rotateY([a[0], a[1] * c - a[2] * s, a[1] * s + a[2] * c], yaw);
};

/** Horizontal travel. Only this lifts a move: a hand going straight down does not arc up first. */
const sideways = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]);

const LIMIT_FRACTION = 1.02;
const DEFAULT_FALL_FRAMES = 7;
/** Radians. A sheet flexes, it does not fold. */
const MAX_BEND = .22;
const opEnd = (op: InteractionOp) => "contactFrame" in op ? op.contactFrame : op.endFrame ?? op.startFrame;
const fallFrames = (op: { releaseHeight?: number; fallFrames?: number }) => op.releaseHeight ? op.fallFrames ?? DEFAULT_FALL_FRAMES : 0;

/** Gesture curve: settle back, travel, pass the target, settle. Ends exactly on 1. */
function gesture(t: number, profile: InteractionTimingProfile): number {
  const eased = smoothstep(t);
  const back = t < .3 ? -profile.anticipation * Math.sin(Math.PI * t / .3) : 0;
  const past = t > .7 ? profile.overshoot * Math.sin(Math.PI * (t - .7) / .3) : 0;
  return eased + back + past;
}

function validate(spec: InteractionSpec): InteractionDiagnostic[] {
  const out: InteractionDiagnostic[] = [];
  const fail = (code: string, message: string, opIndex: number) => out.push({ severity: "error", code, message, opIndex } as InteractionDiagnostic);
  const actors = new Map(spec.actors.map(actor => [actor.id, actor]));
  const objects = new Map(spec.objects.map(object => [object.id, object]));
  const held = new Map<string, string>();
  const busyUntil = new Map<string, number>();
  const ordered = spec.ops.map((op, index) => ({ op, index })).sort((a, b) => a.op.startFrame - b.op.startFrame || a.index - b.index);
  for (const { op, index } of ordered) {
    const end = opEnd(op);
    const settled = end + (op.kind === "place" ? fallFrames(op) : 0);
    if (!Number.isSafeInteger(op.startFrame) || !Number.isSafeInteger(end) || op.startFrame < 0 ||
      settled >= spec.durationFrames || end < op.startFrame) {
      fail("frame-range", `Operation ${index} (${op.kind}) falls outside frames 0 to ${spec.durationFrames - 1}.`, index);
      continue;
    }
    const actor = actors.get(op.actor);
    if (!actor) { fail("unknown-actor", `Unknown actor ${op.actor}.`, index); continue; }
    if (op.kind === "move") continue;
    if (op.kind === "look") {
      const at = op.at;
      if ("object" in at && !objects.has(at.object)) fail("unknown-object", `Unknown object ${at.object}.`, index);
      if ("actor" in at && !actors.has(at.actor)) fail("unknown-actor", `Unknown actor ${at.actor}.`, index);
      continue;
    }
    const effector = actor.effectors[op.effector];
    if (!effector) { fail("unknown-effector", `Actor ${op.actor} has no effector ${op.effector}.`, index); continue; }
    const key = `${op.actor}.${op.effector}`;
    if ((busyUntil.get(key) ?? -1) >= op.startFrame)
      fail("effector-busy", `${key} is already working at frame ${op.startFrame}.`, index);
    busyUntil.set(key, end);
    if (op.kind === "release") continue;
    const object = objects.get(op.object);
    if (!object) { fail("unknown-object", `Unknown object ${op.object}.`, index); continue; }
    if (op.kind === "grasp") {
      const grip = object.grips?.[op.grip];
      if (!grip) { fail("unknown-grip", `Object ${op.object} has no grip ${op.grip}.`, index); continue; }
      if (held.has(op.object)) { fail("object-already-held", `${op.object} is already held by ${held.get(op.object)}.`, index); continue; }
      held.set(op.object, key);
    } else {
      if (held.get(op.object) !== key) { fail("object-not-held", `${key} is not holding ${op.object}.`, index); continue; }
      if (op.kind === "place") {
        held.delete(op.object);
      }
    }
  }
  return out;
}

interface Hold { key: string; offset: Vec3; yaw: number; pitch: number; gripObject: Vec3 }

/** Compile once forward. Evaluate is a lookup, so seeks cannot diverge. */
export function compileInteraction(spec: InteractionSpec): InteractionCompilation {
  const diagnostics = validate(spec);
  if (!Number.isSafeInteger(spec.durationFrames) || spec.durationFrames < 1)
    diagnostics.push({ severity: "error", code: "frame-range", message: "durationFrames must be a positive integer." } as InteractionDiagnostic);
  if (diagnostics.length) return { ok: false, diagnostics };
  const timing = spec.timing ?? "natural";
  const profile = typeof timing === "string" ? INTERACTION_TIMING[timing] : timing;
  const maxTurn = spec.maxHeadTurn ?? 25;
  const contacts: InteractionContact[] = [];
  const frames: InteractionFrame[] = [];

  const rootAt = (actor: InteractionActor, frame: number) => {
    let position = actor.position, yaw = actor.yaw;
    for (const op of spec.ops) {
      if (op.kind !== "move" || op.actor !== actor.id || op.startFrame > frame) continue;
      const t = smoothstep((frame - op.startFrame) / Math.max(1, op.endFrame - op.startFrame));
      position = mix(position, op.to, t);
      if (op.toYaw !== undefined) yaw += (op.toYaw - yaw) * t;
    }
    return { position, yaw };
  };

  const objectState = new Map(spec.objects.map(object => [object.id, {
    position: object.position, yaw: object.yaw ?? 0, pitch: object.pitch ?? 0,
  }]));
  const holds = new Map<string, Hold>();
  const falls = new Map<string, { from: Vec3; to: Vec3; yaw: number; pitch: number; start: number; end: number; contact: InteractionContact }>();
  const hand = new Map<string, Vec3>();
  const influence = new Map<string, number>();
  const bend = new Map(spec.objects.map(object => [object.id, { value: 0, speed: 0 }]));
  const lastPosition = new Map(spec.objects.map(object => [object.id, object.position]));
  const lastVelocity = new Map<string, Vec3>(spec.objects.map(object => [object.id, [0, 0, 0] as Vec3]));
  const head = new Map(spec.actors.map(actor => [actor.id, { yaw: 0, pitch: 0, yawSpeed: 0, pitchSpeed: 0 }]));

  // Gaze follows the explicit looks, then each reach or placement, ahead of the hand.
  const looks = [...spec.ops.flatMap(op => {
    if (op.kind === "look") return [{ actor: op.actor, at: op.at, start: op.startFrame, end: op.endFrame ?? spec.durationFrames - 1 }];
    if (op.kind === "grasp" || op.kind === "place")
      return [{ actor: op.actor, at: { object: op.object } as InteractionLookTarget,
        start: Math.max(0, op.startFrame - profile.gazeLeadFrames), end: op.contactFrame + 6 }];
    return [];
  })].sort((a, b) => a.start - b.start);

  const missed = new Set<string>();
  for (let frame = 0; frame < spec.durationFrames; frame++) {
    const roots = new Map(spec.actors.map(actor => [actor.id, rootAt(actor, frame)]));
    const previousRoots = new Map(spec.actors.map(actor => [actor.id, rootAt(actor, Math.max(0, frame - 1))]));
    const restOf = (actor: InteractionActor, effector: InteractionEffector) => {
      const root = roots.get(actor.id)!;
      return add(root.position, rotateY(effector.rest, root.yaw));
    };
    for (const actor of spec.actors) {
      for (const [name, effector] of Object.entries(actor.effectors)) {
        const key = `${actor.id}.${name}`;
        const root = roots.get(actor.id)!, before = previousRoots.get(actor.id)!;
        // Between gestures a raised hand rides on the walking actor.
        let target = hand.get(key) ?? restOf(actor, effector);
        target = add(target, subtract(root.position, before.position));
        let weight = influence.get(key) ?? 0;
        const op = spec.ops.find(item => "effector" in item && item.actor === actor.id && item.effector === name &&
          frame >= item.startFrame && frame <= opEnd(item));
        if (op && "effector" in op) {
          const span = Math.max(1, opEnd(op) - op.startFrame);
          const t = (frame - op.startFrame) / span;
          const curve = gesture(t, profile);
          if (op.kind === "grasp") {
            const object = spec.objects.find(item => item.id === op.object)!;
            const state = objectState.get(op.object)!;
            const grip = add(state.position, orient(object.grips![op.grip], state.yaw, state.pitch));
            const from = restOf(actor, effector);
            target = add(mix(from, grip, curve), [0, Math.sin(Math.PI * t) * sideways(from, grip) * profile.arc, 0]);
            weight = smoothstep(t / .35);
            if (frame === op.contactFrame) {
              target = grip;
              holds.set(op.object, { key, offset: subtract(state.position, grip), yaw: state.yaw, pitch: state.pitch,
                gripObject: object.grips![op.grip] });
              contacts.push({ frame, kind: "grasp", actor: actor.id, effector: name, object: op.object });
            }
          } else if (op.kind === "carry" || op.kind === "place") {
            const object = spec.objects.find(item => item.id === op.object)!;
            const hold = holds.get(op.object)!;
            const startGrip = hand.get(`${key}#from`) ?? target;
            if (frame === op.startFrame) { hand.set(`${key}#from`, target); hand.set(`${key}#yaw`, [hold.yaw, hold.pitch, 0]); }
            const [fromYaw, fromPitch] = hand.get(`${key}#yaw`) ?? [hold.yaw, hold.pitch, 0];
            const endYaw = op.toYaw ?? fromYaw, endPitch = op.toPitch ?? (op.kind === "place" ? object.pitch ?? 0 : fromPitch);
            const eased = smoothstep(t);
            hold.yaw = fromYaw + (endYaw - fromYaw) * eased;
            hold.pitch = fromPitch + (endPitch - fromPitch) * eased;
            const lift = op.kind === "place" ? op.releaseHeight ?? 0 : 0;
            const end = add(add(op.to, [0, lift, 0]), orient(hold.gripObject, endYaw, endPitch));
            const start = frame === op.startFrame ? target : startGrip;
            target = add(mix(start, end, curve), [0, Math.sin(Math.PI * t) * sideways(start, end) * profile.arc, 0]);
            weight = 1;
            if (frame === opEnd(op)) {
              target = end;
              hand.delete(`${key}#from`);
              hand.delete(`${key}#yaw`);
              if (op.kind === "place") {
                holds.delete(op.object);
                const contact: InteractionContact = { frame: frame + fallFrames(op), kind: "place", actor: actor.id, effector: name, object: op.object };
                const released = add(op.to, [0, lift, 0]);
                objectState.set(op.object, { position: released, yaw: endYaw, pitch: endPitch });
                if (lift > 0) falls.set(op.object, { from: released, to: op.to, yaw: endYaw, pitch: endPitch, start: frame, end: contact.frame, contact });
                else contacts.push(contact);
              }
            }
          } else {
            const from = hand.get(`${key}#from`) ?? target;
            if (frame === op.startFrame) hand.set(`${key}#from`, target);
            target = mix(frame === op.startFrame ? target : from, restOf(actor, effector), smoothstep(t));
            weight = 1 - smoothstep((t - .55) / .45);
            if (frame === opEnd(op)) hand.delete(`${key}#from`);
          }
        }
        hand.set(key, target);
        influence.set(key, weight);
      }
    }
    for (const [objectId, fall] of falls) {
      if (frame <= fall.start) continue;
      const t = (frame - fall.start) / (fall.end - fall.start);
      objectState.set(objectId, { position: mix(fall.from, fall.to, t * t), yaw: fall.yaw, pitch: fall.pitch });
      if (frame === fall.end) {
        contacts.push(fall.contact);
        falls.delete(objectId);
      }
    }
    for (const [objectId, hold] of holds) {
      const grip = hand.get(hold.key)!;
      objectState.set(objectId, { position: subtract(grip, orient(hold.gripObject, hold.yaw, hold.pitch)), yaw: hold.yaw, pitch: hold.pitch });
    }
    const objects: InteractionFrame["objects"] = {};
    const grips: InteractionFrame["grips"] = {};
    for (const object of spec.objects) {
      const state = objectState.get(object.id)!;
      const previous = lastPosition.get(object.id)!;
      const velocity = subtract(state.position, previous);
      const acceleration = subtract(velocity, lastVelocity.get(object.id)!);
      const flex = bend.get(object.id)!;
      if (object.bendable) {
        // A damped spring driven by vertical acceleration: paper lags, then settles.
        flex.speed += (-flex.value * .16 - flex.speed * .24 - acceleration[1] * 30);
        flex.value = Math.max(-MAX_BEND, Math.min(MAX_BEND, flex.value + flex.speed));
      }
      lastPosition.set(object.id, state.position);
      lastVelocity.set(object.id, velocity);
      objects[object.id] = { position: state.position, yaw: state.yaw, pitch: state.pitch, bend: object.bendable ? flex.value : 0 };
      const hold = holds.get(object.id);
      if (hold) grips[object.id] = add(state.position, orient(hold.gripObject, hold.yaw, hold.pitch));
    }
    const actors: InteractionFrame["actors"] = {};
    for (const actor of spec.actors) {
      const root = roots.get(actor.id)!;
      const active = looks.filter(look => look.actor === actor.id && frame >= look.start && frame <= look.end).slice(-1)[0];
      let wantYaw = 0, wantPitch = 0;
      if (active) {
        const at = active.at;
        const point = "object" in at ? objectState.get(at.object)!.position
          : "actor" in at ? add(roots.get(at.actor)!.position, [0, spec.actors.find(item => item.id === at.actor)!.height * .8, 0]) : at.point;
        const eye = add(root.position, [0, actor.height * .8, 0]);
        const toward = rotateY(subtract(point, eye), -root.yaw);
        wantYaw = Math.atan2(toward[0], toward[2]) * 180 / Math.PI;
        wantPitch = Math.atan2(toward[1], Math.hypot(toward[0], toward[2])) * 180 / Math.PI;
      }
      wantYaw = Math.max(-maxTurn, Math.min(maxTurn, wantYaw));
      wantPitch = Math.max(-maxTurn, Math.min(maxTurn, wantPitch));
      const state = head.get(actor.id)!;
      state.yawSpeed += (wantYaw - state.yaw) * profile.headResponse ** 2 - state.yawSpeed * profile.headResponse * 1.7;
      state.pitchSpeed += (wantPitch - state.pitch) * profile.headResponse ** 2 - state.pitchSpeed * profile.headResponse * 1.7;
      state.yaw += state.yawSpeed;
      state.pitch += state.pitchSpeed;
      state.yaw = Math.max(-maxTurn, Math.min(maxTurn, state.yaw));
      state.pitch = Math.max(-maxTurn, Math.min(maxTurn, state.pitch));
      actors[actor.id] = { position: root.position, yaw: root.yaw, turn: { yaw: state.yaw, pitch: state.pitch } };
    }
    const effectors: InteractionFrame["effectors"] = {};
    for (const actor of spec.actors) for (const name of Object.keys(actor.effectors)) {
      const key = `${actor.id}.${name}`;
      effectors[key] = { position: hand.get(key)!, influence: influence.get(key) ?? 0,
        holding: [...holds.values()].some(hold => hold.key === key) };
    }
    frames.push({ actors, objects, effectors, grips });
    // Checked on the solved path, so walking, carrying and held poses all count.
    for (const actor of spec.actors) for (const [name, effector] of Object.entries(actor.effectors)) {
      const key = `${actor.id}.${name}`;
      if (effectors[key].influence < .99 || missed.has(key)) continue;
      const root = roots.get(actor.id)!;
      const shoulder = add(root.position, rotateY(effector.shoulder, root.yaw));
      const distance = length(subtract(effectors[key].position, shoulder));
      if (distance > effector.reach * LIMIT_FRACTION) {
        missed.add(key);
        diagnostics.push({ severity: "error", code: "out-of-reach",
          message: `${key} needs ${distance.toFixed(3)} m at frame ${frame}, but reaches ${effector.reach.toFixed(3)} m.` } as InteractionDiagnostic);
      }
    }
  }
  if (diagnostics.length) return { ok: false, diagnostics };
  return { ok: true, plan: { spec, frames, contacts }, diagnostics };
}

export function evaluateInteraction(plan: InteractionPlan, frame: number): InteractionFrame {
  if (!Number.isSafeInteger(frame) || frame < 0 || frame >= plan.frames.length)
    throw new Error(`Interaction frame ${frame} is outside the plan.`);
  return plan.frames[frame];
}
