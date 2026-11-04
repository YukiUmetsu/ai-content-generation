/** Engine-free MG1 generalized pose boundary. Quaternion motion is baked once. */
import { evaluateTimeline, outputKey } from "./timeline";
import type { EvaluationResult, MotionTimeline, RationalFps } from "./types";
import type { CinematicCameraPose } from "./cinematic-camera-types";

const NUMERIC_CHANNELS = ["positionX", "positionY", "positionZ", "orientationX", "orientationY", "orientationZ", "orientationW", "focusX", "focusY", "focusZ", "lens", "near", "far", "focusDistance"] as const;
function poseValues(pose: CinematicCameraPose): number[] {
  return [...pose.position, ...pose.orientation, ...pose.focus, pose.projection.kind === "perspective" ? pose.projection.fov : pose.projection.scale, pose.near, pose.far, pose.focusDistance];
}
export function compileCameraPoses(options: { id: string; cameraId?: string; fps: RationalFps; poses: readonly CinematicCameraPose[] }): MotionTimeline {
  const { id, cameraId = "camera3d", fps, poses } = options;
  if (!id.trim() || !cameraId.trim() || !poses.length || !Number.isSafeInteger(fps.num) || !Number.isSafeInteger(fps.den) || fps.num <= 0 || fps.den <= 0) throw new Error("Camera poses require IDs, positive rational FPS and at least one frame.");
  const values = poses.map((pose, frame) => { validateCameraPose(pose, frame); return poseValues(pose); });
  return { schemaVersion: 1, id, fps, durationFrames: poses.length, nodes: [
    ...NUMERIC_CHANNELS.map((property, index) => ({ kind: "track" as const, id: `${cameraId}-pose-${property}`, track: { id: `${cameraId}-pose-${property}`, targetId: cameraId, property, valueType: "number" as const, easing: "linear" as const,
      keyframes: values.map((row, frame) => ({ frame, value: row[index] })) } })),
    { kind: "track", id: `${cameraId}-projection`, track: { id: `${cameraId}-projection`, targetId: cameraId, property: "projection", valueType: "discrete", keyframes: poses.map((pose, frame) => ({ frame, value: pose.projection.kind, easing: "step-end" })) } },
  ] };
}
export function validateCameraPose(pose: CinematicCameraPose, frame = 0): void {
  const values = poseValues(pose);
  if (!values.every(Number.isFinite) || pose.position.length !== 3 || pose.focus.length !== 3 || pose.orientation.length !== 4 || Math.abs(Math.hypot(...pose.orientation) - 1) > 1e-5 || pose.near <= 0 || pose.far <= pose.near || pose.focusDistance < 0 ||
      (pose.projection.kind === "perspective" ? pose.projection.fov < 5 || pose.projection.fov > 120 : pose.projection.scale <= 0)) throw new Error(`Invalid camera pose at frame ${frame}. Use finite vectors, a normalized XYZW quaternion, a valid lens and 0 < near < far.`);
}
export function evaluateCameraPose3D(timeline: MotionTimeline, frame: number, cameraId = "camera3d", evaluation?: EvaluationResult): CinematicCameraPose {
  if (!Number.isSafeInteger(frame)) throw new Error("Camera pose needs an integer frame; quantize the shared MG1 clock.");
  const sampledFrame = Math.max(0, Math.min(timeline.durationFrames - 1, frame));
  const result = evaluation ?? evaluateTimeline(timeline, sampledFrame);
  if (result.frame !== sampledFrame) throw new Error("Camera pose and shared evaluation frame differ. Pass the same resolved MotionDirector frame.");
  const values = NUMERIC_CHANNELS.map(property => result.samples[outputKey(cameraId, property)]?.value);
  if (!values.every(value => typeof value === "number" && Number.isFinite(value))) throw new Error(`Camera "${cameraId}" has missing pose channels at frame ${frame}. Use compileCinematicCamera or compileCameraPoses.`);
  const v = values as number[];
  const projection = result.samples[outputKey(cameraId, "projection")]?.value;
  if (projection !== "perspective" && projection !== "orthographic") throw new Error(`Camera "${cameraId}" has an unknown projection; recompile its camera sequence.`);
  const pose: CinematicCameraPose = { position: [v[0], v[1], v[2]], orientation: [v[3], v[4], v[5], v[6]], focus: [v[7], v[8], v[9]], projection: projection === "perspective" ? { kind: projection, fov: v[10] } : { kind: projection, scale: v[10] }, near: v[11], far: v[12], focusDistance: v[13] };
  validateCameraPose(pose, frame);
  return pose;
}
