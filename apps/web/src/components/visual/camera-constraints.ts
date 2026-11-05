/** Compile-time shot safeguards on top of CC1's existing projector/solver.
 * No screenshot recognition, no GPU allocation, no second animation clock.
 * The author declares critical semantic IDs; their projected bounds are
 * checked at predictable MG1 frames against explicit screen-safe regions.
 */
import { Vector3 } from "three";
import { evaluateCameraPose3D } from "../motion/camera-pose-3d";
import { cameraSafeRegion, frameCameraBounds, rectViolation } from "../motion/camera-framing";
import { projectCameraBounds, unionCameraBounds } from "../motion/camera-spatial";
import type {
  CameraComposition, CameraFraming, CameraTargetRegistry, CameraVector3,
  CinematicCameraPose, CompiledCinematicCamera,
} from "../motion/cinematic-camera-types";
import type { Rect } from "../motion/types";

export interface CriticalCameraRequirement {
  id: string;
  targetIds: readonly string[];
  startFrame: number;
  endFrame: number;
  /** Target bounds must remain inside safe normalized screen space. */
  safeRegion?: Rect;
  /** How often to inspect; start/end and shot boundaries are always sampled. */
  strideFrames?: number;
  tolerance?: number;
}
export interface CameraGuardFailure {
  code: "target-missing" | "target-clipped" | "target-outside-safe-area" | "camera-sampling-failed";
  requirement: string;
  targetId: string;
  frame: number;
  amount: number;
  message: string;
}
export function inspectCriticalCameraFrames(
  plan: CompiledCinematicCamera,
  registry: CameraTargetRegistry,
  requirements: readonly CriticalCameraRequirement[],
): { ok: boolean; failures: CameraGuardFailure[]; sampledFrames: number } {
  const failures: CameraGuardFailure[] = [], aspect = plan.spec.output.width / plan.spec.output.height;
  let sampledFrames = 0;
  for (const rule of requirements) {
    const stride = rule.strideFrames ?? 5, tol = rule.tolerance ?? .002;
    if (!Number.isSafeInteger(stride) || stride < 1 || !Number.isSafeInteger(rule.startFrame) ||
        !Number.isSafeInteger(rule.endFrame) || rule.startFrame < 0 ||
        rule.endFrame > plan.spec.durationFrames || rule.endFrame <= rule.startFrame ||
        !rule.id.trim() || !rule.targetIds.length) throw new Error(`Invalid camera requirement "${rule.id}".`);
    const safe = rule.safeRegion ?? cameraSafeRegion({}, .07);
    if (![safe.x, safe.y, safe.width, safe.height, tol].every(Number.isFinite) || tol < 0 || safe.x < 0 || safe.y < 0 || safe.width <= 0 || safe.height <= 0 || safe.x + safe.width > 1 || safe.y + safe.height > 1)
      throw new Error(`Invalid safe region or tolerance in "${rule.id}". Use normalized output bounds and a nonnegative finite tolerance.`);
    const boundaries = plan.shots
      .flatMap(shot => [shot.startFrame, shot.endFrame - 1])
      .filter(frame => frame >= rule.startFrame && frame < rule.endFrame);
    const frames = new Set([rule.startFrame, rule.endFrame - 1, ...boundaries]);
    for (let frame = rule.startFrame; frame < rule.endFrame; frame += stride) frames.add(frame);
    for (const frame of [...frames].sort((a, b) => a - b)) {
      sampledFrames++;
      try {
        registry.prepareFrame?.(frame);
        const pose = evaluateCameraPose3D(plan.timeline, frame, plan.spec.cameraId ?? "camera3d");
        for (const id of rule.targetIds) {
          if (!registry.ids.includes(id)) {
            failures.push({ code: "target-missing", requirement: rule.id, frame, targetId: id, amount: 1,
              message: `Register semantic camera target "${id}" before framing it.` });
            continue;
          }
          const projected = projectCameraBounds(pose, registry.sample(id, frame).bounds, aspect);
          const violation = rectViolation(projected.rect, safe);
          const clipped = projected.clipped || !Number.isFinite(violation);
          if (clipped || violation > tol)
            failures.push({ code: clipped ? "target-clipped" : "target-outside-safe-area",
              requirement: rule.id, frame, targetId: id, amount: clipped ? 1 : violation,
              message: `"${id}" at frame ${frame} ${clipped ? "crosses camera clip planes" : "leaves its declared safe region"}.` });
        }
      } catch (error) {
        failures.push({ code: "camera-sampling-failed", requirement: rule.id, frame, targetId: rule.targetIds[0],
          amount: 1, message: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return { ok: failures.length === 0, failures, sampledFrames };
}

/** Frame multiple named subjects without authored look-at/XYZ guessing.
 * Delegates fitting to existing CC1 binary search and projection math.
 */
export function focusOnSemanticTargets(options: {
  registry: CameraTargetRegistry;
  targetIds: readonly string[];
  frame: number;
  direction: CameraVector3;
  output: { width: number; height: number };
  framing?: CameraFraming;
  composition?: CameraComposition;
  projection?: "perspective" | "orthographic";
  fov?: number;
}): CinematicCameraPose {
  const { registry, frame, targetIds, direction, output } = options;
  if (!targetIds.length || output.width <= 0 || output.height <= 0) throw new Error("Camera focus needs semantic IDs and a positive output size.");
  registry.prepareFrame?.(frame);
  const subjects = targetIds.map(id => registry.sample(id, frame));
  const bounds = unionCameraBounds(subjects.map(sample => sample.bounds));
  const center = new Vector3();
  const weight = subjects.reduce((n, sample) => n + sample.importance, 0);
  for (const subject of subjects) center.addScaledVector(new Vector3(...subject.focus), subject.importance / weight);
  return frameCameraBounds({
    bounds, focus: [center.x, center.y, center.z], direction,
    aspect: output.width / output.height, framing: options.framing ?? "close",
    composition: options.composition, margin: .07,
    projection: options.projection ?? "perspective", fov: options.fov ?? 44,
  });
}

export interface TrackWindowRequirement {
  movingId: string;
  fromId: string;
  toId: string;
  searchStart: number;
  searchEnd: number;
  /** A moving focus must enter within this world-space distance of each landmark. */
  proximity: number;
  leadFrames?: number;
  tailFrames?: number;
  sampleStride?: number;
}
export type TrackWindowResult =
  | { ok: true; fromArrival: number; toArrival: number; startFrame: number; endFrame: number }
  | { ok: false; reason: string };

/** Derive camera tracking beats from the actual moving subject trajectory.
 * This is an authoring utility, not an optimizer. A camera shot can use its
 * returned start/duration in the existing CC1/MD1 sequence.
 */
export function deriveSemanticTrackingWindow(registry: CameraTargetRegistry, spec: TrackWindowRequirement): TrackWindowResult {
  const { movingId, fromId, toId, searchStart, searchEnd, proximity } = spec;
  const stride = spec.sampleStride ?? 1;
  if (!Number.isSafeInteger(searchStart) || !Number.isSafeInteger(searchEnd) ||
      searchStart < 0 || searchEnd <= searchStart || !Number.isFinite(proximity) || proximity <= 0 ||
      !Number.isSafeInteger(stride) || stride < 1 || ![spec.leadFrames ?? 0, spec.tailFrames ?? 0].every(x => Number.isSafeInteger(x) && x >= 0))
    throw new Error("Tracking window needs a valid frame range, threshold and nonnegative lead/tail.");
  for (const id of [movingId, fromId, toId]) if (!registry.ids.includes(id))
    return { ok: false, reason: `Unknown tracking subject/landmark "${id}".` };
  let fromArrival: number | undefined, toArrival: number | undefined;
  for (let frame = searchStart; frame < searchEnd; frame += stride) {
    registry.prepareFrame?.(frame);
    const center = new Vector3(...registry.sample(movingId, frame).focus);
    const from = new Vector3(...registry.sample(fromId, frame).focus);
    const to = new Vector3(...registry.sample(toId, frame).focus);
    if (fromArrival === undefined && center.distanceTo(from) <= proximity) fromArrival = frame;
    else if (fromArrival !== undefined && frame > fromArrival && center.distanceTo(to) <= proximity) {
      toArrival = frame; break;
    }
  }
  if (fromArrival === undefined || toArrival === undefined)
    return { ok: false, reason: `"${movingId}" did not reach both "${fromId}" then "${toId}" within the requested range/threshold.` };
  return { ok: true, fromArrival, toArrival,
    startFrame: Math.max(searchStart, fromArrival - (spec.leadFrames ?? 0)),
    endFrame: Math.min(searchEnd, toArrival + 1 + (spec.tailFrames ?? 0)) };
}
