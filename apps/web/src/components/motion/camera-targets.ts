import { boundsCenter, tuple4 } from "./camera-spatial";
import { Matrix4, Quaternion, Vector3 } from "three";
import { stableStringify } from "./serialize";
import type { CameraBounds3D, CameraQuaternion, CameraTarget, CameraTargetFrame, CameraTargetRegistry, CameraTargetSample, CameraVector3 } from "./cinematic-camera-types";

export function validCameraBounds(bounds: CameraBounds3D): boolean {
  return !!bounds && Array.isArray(bounds.min) && Array.isArray(bounds.max) && bounds.min.length === 3 && bounds.max.length === 3 && [...bounds.min, ...bounds.max].every(Number.isFinite) && bounds.min.every((v, i) => v <= bounds.max[i]) && bounds.min.some((v, i) => v < bounds.max[i]);
}
export function validCameraVector(v: unknown, size = 3): v is number[] { return Array.isArray(v) && v.length === size && v.every(n => typeof n === "number" && Number.isFinite(n)); }
export function validCameraQuaternion(q: unknown): q is CameraQuaternion { return validCameraVector(q, 4) && Math.abs(Math.hypot(...q) - 1) < 1e-5; }
const mix = (a: CameraVector3, b: CameraVector3, t: number): CameraVector3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function frameTransform(sample: CameraTargetFrame) {
  const position = new Vector3(...(sample.focus ?? boundsCenter(sample.bounds))), orientation = new Quaternion(), scale = new Vector3(1, 1, 1);
  if (sample.worldMatrix) new Matrix4().fromArray(sample.worldMatrix).decompose(position, orientation, scale);
  if (sample.orientation) orientation.set(...sample.orientation);
  return { position, orientation, scale };
}

/** World-space samples support moving/deforming targets without engine objects. */
export function createCameraTargetRegistry(input: { revision: string; targets: readonly CameraTarget[] }): CameraTargetRegistry {
  const targets = JSON.parse(stableStringify(input.targets)) as CameraTarget[];
  const byId = new Map<string, CameraTarget>();
  for (const target of targets) {
    if (!target.id?.trim() || byId.has(target.id)) throw new Error(`Camera target "${target.id}" needs a unique semantic ID.`);
    if (!target.frames?.length || target.frames[0].frame !== 0 || target.frames.some((sample, i) => !Number.isSafeInteger(sample.frame) || sample.frame < 0 || (i > 0 && sample.frame <= target.frames[i - 1].frame) || !validCameraBounds(sample.bounds) || (sample.focus && !validCameraVector(sample.focus)) || (sample.orientation && !validCameraQuaternion(sample.orientation)) || (sample.worldMatrix && !validCameraVector(sample.worldMatrix, 16)))) throw new Error(`Camera target "${target.id}" needs ascending world-bound samples beginning at 0, finite focus/matrices and normalized quaternions.`);
    if (target.importance !== undefined && (!Number.isFinite(target.importance) || target.importance <= 0)) throw new Error(`Camera target "${target.id}" importance must be positive.`);
    if (target.preferredDirection && (!validCameraVector(target.preferredDirection) || Math.hypot(...target.preferredDirection) < 1e-8)) throw new Error(`Camera target "${target.id}" preferred direction must be nonzero finite XYZ.`);
    byId.set(target.id, target);
  }
  if (!input.revision?.trim()) throw new Error("Camera target registry needs a revision; change it when geometry or absolute-frame definitions change.");
  return { revision: input.revision, ids: [...byId.keys()], diagnostics: [], sample(id, frame): CameraTargetSample {
    if (!Number.isSafeInteger(frame) || frame < 0) throw new Error("Target sampling needs a non-negative integer frame.");
    const target = byId.get(id);
    if (!target) throw new Error(`Camera target "${id}" is missing. Register that semantic ID or correct the shot target.`);
    const last = target.frames[target.frames.length - 1];
    const index = target.frames.findIndex(sample => sample.frame >= frame);
    const b = index < 0 ? last : target.frames[index], a = index > 0 ? target.frames[index - 1] : b;
    const t = a.frame === b.frame ? 0 : (frame - a.frame) / (b.frame - a.frame);
    const bounds = { min: mix(a.bounds.min, b.bounds.min, t), max: mix(a.bounds.max, b.bounds.max, t) };
    const focus = mix(a.focus ?? boundsCenter(a.bounds), b.focus ?? boundsCenter(b.bounds), t);
    const from = frameTransform(a), to = frameTransform(b);
    const rotation = from.orientation.slerp(to.orientation, t).normalize(), orientation = tuple4(rotation);
    // Exact samples retain authored matrices, including parent shear. Between
    // samples TRS is interpolated; use dense samples for non-rigid deformation.
    const exact = frame === b.frame ? b : a === b ? a : undefined;
    const worldMatrix = Array.from(exact?.worldMatrix ?? new Matrix4().compose(from.position.lerp(to.position, t), rotation, from.scale.lerp(to.scale, t)).toArray());
    if (!validCameraQuaternion(orientation) || !worldMatrix.every(Number.isFinite)) throw new Error(`Target "${id}" has a singular world transform. Supply invertible TRS matrices or dense world-bound samples.`);
    return { id, bounds, focus, orientation, worldMatrix, importance: target.importance ?? 1, preferredDirection: target.preferredDirection };
  } };
}
