/** ShotBake v1: every frame of one shot, resolved, for an offline renderer.
 *
 * Joins InteractionPlan, the character evaluator and CC1 into one JSON document.
 * The renderer applies these values and decides no timing, so preview and final
 * output share one clock. Space is Y-up metres, angles on parts are degrees.
 * CC1 uses Three.js math, so run this offline, not in a video export bundle.
 */
import { evaluateCharacter } from "../character/evaluate";
import type { CharacterCue, CharacterDefinition, CharacterInstance, CharacterPartState } from "../character/definition";
import { createCameraProjector, projectCameraBounds } from "./camera-spatial";
import { createCameraTargetRegistry } from "./camera-targets";
import { evaluateCameraPose3D } from "./camera-pose-3d";
import { compileCinematicCamera } from "./cinematic-camera-director";
import type { CameraBounds3D, CameraDiagnostic, CameraSequenceSpec, CameraTarget, CameraVector3 } from "./cinematic-camera-types";
import { evaluateInteraction } from "./interaction-choreography";
import type { InteractionContact, InteractionPlan, Vec3 } from "./interaction-choreography";
import type { RationalFps } from "./types";

export type BakedPartState = CharacterPartState & { yaw?: number; pitch?: number };
export interface ShotBakeV1 {
  schema_version: 1;
  fps: RationalFps;
  duration_frames: number;
  camera: { position: Vec3[]; orientation: (readonly [number, number, number, number])[]; fov: number[]; focus_distance: number[] };
  objects: Record<string, { position: Vec3[]; orientation: (readonly [number, number, number, number])[]; bend: number[] }>;
  actors: Record<string, {
    root: { position: Vec3[]; yaw: number[] };
    parts: Record<string, BakedPartState>[];
    effectors: Record<string, { position: Vec3[]; influence: number[]; holding: boolean[] }>;
  }>;
  lights: Record<string, number[]>;
  contacts: InteractionContact[];
}
/** Leg motion from real ground travel. Pixels and degrees are the rig's own units. */
export interface ShotGait {
  left: string;
  right: string;
  /** Part that bobs with each step. */
  body?: string;
  /** Metres of travel for one full two-leg cycle. Sets foot placement, so feet do not slide. */
  stride: number;
  lift: number;
  swing: number;
  bob: number;
}
export interface ShotBakeActor {
  id: string;
  definition: CharacterDefinition;
  instance: CharacterInstance;
  cues: readonly CharacterCue[];
  /** Part that takes the 3D head turn. */
  headPart?: string;
  /** Effector name to the part it drives. IK owns that part while its influence is up. */
  limbs?: Record<string, string>;
  gait?: ShotGait;
  /** Frames to blend a changed drawing in, for parts the rig does not already crossfade. 0 keeps hard cuts. */
  variantFadeFrames?: number;
  /**
   * Largest angle, degrees, between the camera and the actor's facing while the actor is in frame.
   * Flat art has one view. Past this angle its layers read as detached cards, so the bake fails.
   */
  maxViewAngle?: number;
}
export interface LightKey { frame: number; level: number }
export interface ShotBakeInput {
  id: string;
  width: number;
  height: number;
  interaction: InteractionPlan;
  actors: readonly ShotBakeActor[];
  camera: CameraSequenceSpec;
  /** Extra camera subjects, for example a printed number on a page. */
  targets?: readonly CameraTarget[];
  lights?: Record<string, readonly LightKey[]>;
  /** End-exclusive frame ranges where a camera move may pass an actor at any angle. */
  viewAngleExempt?: readonly { startFrame: number; endFrame: number }[];
}
export type ShotBakeDiagnostic = { severity: "error"; code: string; message: string } | CameraDiagnostic;
export type ShotBakeResult = { ok: true; bake: ShotBakeV1; diagnostics: ShotBakeDiagnostic[] } | { ok: false; diagnostics: ShotBakeDiagnostic[] };

const box = (center: Vec3, half: Vec3): CameraBounds3D => ({
  min: [center[0] - half[0], center[1] - half[1], center[2] - half[2]],
  max: [center[0] + half[0], center[1] + half[1], center[2] + half[2]],
});

/** Moving camera subjects for each actor, object and held object, one sample per frame. */
export function interactionCameraTargets(plan: InteractionPlan, objectRadius = .05): CameraTarget[] {
  const frames = plan.frames;
  const targets: CameraTarget[] = plan.spec.objects.map(object => ({
    id: object.id,
    frames: frames.map((state, frame) => ({ frame, bounds: box(state.objects[object.id].position, [objectRadius, objectRadius, objectRadius]) })),
  }));
  for (const actor of plan.spec.actors) {
    const half = actor.height / 2;
    targets.push({
      id: actor.id,
      frames: frames.map((state, frame) => {
        const [x, y, z] = state.actors[actor.id].position;
        const center: CameraVector3 = [x, y + half, z];
        return { frame, bounds: box(center, [half * .6, half, half * .4]) };
      }),
    });
  }
  return targets;
}

function quaternion(yaw: number, pitch: number): readonly [number, number, number, number] {
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
  return [cy * sp, sy * cp, -sy * sp, cy * cp];
}

/** Share of the frame an actor must cover before its view angle matters. */
const VISIBLE_AREA = .004;

/** Fade legs in and out with speed, so a stopping actor stands, it does not freeze mid-step. */
const GAIT_FULL_SPEED = .002;

/** Apply one frame of gait to already evaluated parts. Pure: distance and speed decide the pose. */
export function applyGait(parts: Record<string, BakedPartState>, gait: ShotGait, distance: number, speed: number): void {
  const weight = Math.min(1, speed / GAIT_FULL_SPEED);
  if (weight <= 0) return;
  const phase = distance / gait.stride * Math.PI * 2;
  const leg = (id: string, at: number) => {
    const part = parts[id];
    if (!part) return;
    parts[id] = { ...part, y: part.y - gait.lift * Math.max(0, Math.sin(at)) * weight, rotation: part.rotation + gait.swing * Math.cos(at) * weight };
  };
  leg(gait.left, phase);
  leg(gait.right, phase + Math.PI);
  if (gait.body && parts[gait.body])
    parts[gait.body] = { ...parts[gait.body], y: parts[gait.body].y - gait.bob * Math.abs(Math.sin(phase)) * weight };
}

/** Blend a part's new drawing in over a few frames. Parts the rig already crossfades are left alone. */
export function fadeDrawings(parts: Record<string, BakedPartState>, history: readonly Record<string, BakedPartState>[], frames: number,
  active: Map<string, { from: string; start: number }>): void {
  const previous = history[history.length - 1];
  const now = history.length;
  for (const [partId, part] of Object.entries(parts)) {
    if (part.variantFrom !== undefined) { active.delete(partId); continue; }
    const before = previous?.[partId];
    const was = before?.variant ?? "";
    const is = part.variant ?? "";
    if (before && was !== is) active.set(partId, { from: was, start: now });
    const fade = active.get(partId);
    if (!fade) continue;
    const mix = Math.min(1, (now - fade.start + 1) / frames);
    if (mix >= 1) { active.delete(partId); continue; }
    parts[partId] = { ...part, variantFrom: fade.from, variantMix: mix };
  }
}

function lightLevel(keys: readonly LightKey[], frame: number): number {
  const sorted = [...keys].sort((a, b) => a.frame - b.frame);
  if (frame <= sorted[0].frame) return sorted[0].level;
  const next = sorted.findIndex(key => key.frame >= frame);
  if (next < 0) return sorted[sorted.length - 1].level;
  const from = sorted[next - 1], to = sorted[next];
  const t = (frame - from.frame) / (to.frame - from.frame);
  return from.level + (to.level - from.level) * t;
}

export function bakeShot(input: ShotBakeInput): ShotBakeResult {
  const { interaction } = input;
  const frames = interaction.spec.durationFrames;
  const fail = (code: string, message: string): ShotBakeResult => ({ ok: false, diagnostics: [{ severity: "error", code, message }] });
  if (input.camera.durationFrames !== frames)
    return fail("duration-mismatch", `Camera has ${input.camera.durationFrames} frames, shot has ${frames}.`);
  const known = new Set(interaction.spec.actors.map(actor => actor.id));
  for (const actor of input.actors) if (!known.has(actor.id)) return fail("unknown-actor", `Actor ${actor.id} is not in the interaction.`);
  const registry = createCameraTargetRegistry({
    revision: input.id, targets: [...interactionCameraTargets(interaction), ...(input.targets ?? [])],
  });
  const compiled = compileCinematicCamera(input.camera, registry);
  if (!compiled.ok) return { ok: false, diagnostics: compiled.diagnostics };
  const cameraId = input.camera.cameraId ?? "camera3d";
  const bake: ShotBakeV1 = {
    schema_version: 1, fps: interaction.spec.fps, duration_frames: frames,
    camera: { position: [], orientation: [], fov: [], focus_distance: [] },
    objects: Object.fromEntries(interaction.spec.objects.map(object => [object.id, { position: [], orientation: [], bend: [] }])),
    actors: Object.fromEntries(input.actors.map(actor => [actor.id, {
      root: { position: [], yaw: [] }, parts: [],
      effectors: Object.fromEntries(Object.keys(interaction.spec.actors.find(item => item.id === actor.id)!.effectors)
        .map(name => [name, { position: [], influence: [], holding: [] }])),
    }])),
    lights: Object.fromEntries(Object.entries(input.lights ?? {}).map(([name, keys]) =>
      [name, Array.from({ length: frames }, (_, frame) => lightLevel(keys, frame))])),
    contacts: [...interaction.contacts],
  };
  const projector = createCameraProjector();
  const aspect = input.width / input.height;
  const exempt = (frame: number) => (input.viewAngleExempt ?? []).some(range => frame >= range.startFrame && frame < range.endFrame);
  const steepest = new Map<string, { frame: number; angle: number }>();
  const travelled = new Map(input.actors.map(actor => [actor.id, 0]));
  const fades = new Map(input.actors.map(actor => [actor.id, new Map<string, { from: string; start: number }>()]));
  for (let frame = 0; frame < frames; frame++) {
    const state = evaluateInteraction(interaction, frame);
    const previous = evaluateInteraction(interaction, Math.max(0, frame - 1));
    const pose = evaluateCameraPose3D(compiled.plan.timeline, frame, cameraId);
    if (pose.projection.kind !== "perspective") return fail("projection", "ShotBake v1 needs a perspective camera.");
    bake.camera.position.push(pose.position);
    bake.camera.orientation.push(pose.orientation);
    bake.camera.fov.push(pose.projection.fov);
    bake.camera.focus_distance.push(pose.focusDistance);
    for (const [id, object] of Object.entries(state.objects)) {
      const channel = bake.objects[id];
      channel.position.push(object.position);
      channel.orientation.push(quaternion(object.yaw, object.pitch));
      channel.bend.push(object.bend);
    }
    for (const actor of input.actors) {
      const channel = bake.actors[actor.id];
      const placed = state.actors[actor.id];
      channel.root.position.push(placed.position);
      channel.root.yaw.push(placed.yaw);
      if (actor.maxViewAngle !== undefined && !exempt(frame)) {
        const half = interaction.spec.actors.find(item => item.id === actor.id)!.height / 2;
        const center: Vec3 = [placed.position[0], placed.position[1] + half, placed.position[2]];
        const seen = projectCameraBounds(pose, box(center, [half * .6, half, half * .4]), aspect, projector);
        const inFrame = Math.max(0, Math.min(seen.rect.x + seen.rect.width, 1) - Math.max(seen.rect.x, 0)) *
          Math.max(0, Math.min(seen.rect.y + seen.rect.height, 1) - Math.max(seen.rect.y, 0));
        if (inFrame > VISIBLE_AREA && seen.depth[1] > pose.near) {
          const toCamera: Vec3 = [pose.position[0] - center[0], pose.position[1] - center[1], pose.position[2] - center[2]];
          const distance = Math.hypot(...toCamera) || 1;
          // An actor at yaw 0 faces +Z.
          const cosine = (toCamera[0] * Math.sin(placed.yaw) + toCamera[2] * Math.cos(placed.yaw)) / distance;
          const angle = Math.acos(Math.min(1, Math.max(-1, cosine))) * 180 / Math.PI;
          if (angle > actor.maxViewAngle && angle > (steepest.get(actor.id)?.angle ?? 0)) steepest.set(actor.id, { frame, angle });
        }
      }
      const evaluated = evaluateCharacter(actor.definition, actor.instance, actor.cues, frame);
      const parts: Record<string, BakedPartState> = {};
      for (const [partId, part] of Object.entries(evaluated.parts)) {
        const { x, y, rotation, scaleX, scaleY, variant, variantFrom, variantMix } = part;
        parts[partId] = { x, y, rotation, scaleX, scaleY, ...(variant ? { variant } : {}),
          ...(variantFrom !== undefined ? { variantFrom } : {}), ...(variantMix !== undefined ? { variantMix } : {}) };
      }
      if (actor.variantFadeFrames) fadeDrawings(parts, channel.parts, actor.variantFadeFrames, fades.get(actor.id)!);
      for (const [effector, partId] of Object.entries(actor.limbs ?? {})) {
        const weight = state.effectors[`${actor.id}.${effector}`]?.influence ?? 0;
        const rest = evaluateCharacter(actor.definition, actor.instance, [], 0).parts[partId];
        const part = parts[partId];
        if (!rest || !part || weight <= 0) continue;
        // A held limb stops following walk cycles and gestures. Two systems must not fight over it.
        const blend = (from: number, to: number) => from + (to - from) * weight;
        parts[partId] = { ...part, x: blend(part.x, rest.x), y: blend(part.y, rest.y), rotation: blend(part.rotation, rest.rotation),
          scaleX: blend(part.scaleX, rest.scaleX), scaleY: blend(part.scaleY, rest.scaleY) };
      }
      if (actor.gait) {
        const before = previous.actors[actor.id].position;
        const speed = Math.hypot(placed.position[0] - before[0], placed.position[2] - before[2]);
        travelled.set(actor.id, travelled.get(actor.id)! + speed);
        applyGait(parts, actor.gait, travelled.get(actor.id)!, speed);
      }
      if (actor.headPart && parts[actor.headPart])
        parts[actor.headPart] = { ...parts[actor.headPart], yaw: placed.turn.yaw, pitch: placed.turn.pitch };
      channel.parts.push(parts);
      for (const [name, track] of Object.entries(channel.effectors)) {
        const effector = state.effectors[`${actor.id}.${name}`];
        track.position.push(effector.position);
        track.influence.push(effector.influence);
        track.holding.push(effector.holding);
      }
    }
  }
  if (steepest.size) return { ok: false, diagnostics: [...steepest].map(([id, worst]) => ({ severity: "error" as const, code: "actor-view-angle",
    message: `Actor ${id} is in frame at ${worst.angle.toFixed(0)} degrees from its facing at frame ${worst.frame}. ` +
      `Its art allows ${input.actors.find(actor => actor.id === id)!.maxViewAngle}. Move the actor out of frame or change the shot.` })) };
  return { ok: true, bake, diagnostics: compiled.diagnostics };
}

export function serializeShotBake(bake: ShotBakeV1): string {
  return JSON.stringify(bake);
}

export function parseShotBake(json: string): ShotBakeV1 {
  const parsed = JSON.parse(json) as ShotBakeV1;
  if (parsed.schema_version !== 1) throw new Error("Only ShotBake schema_version 1 is supported.");
  return parsed;
}
