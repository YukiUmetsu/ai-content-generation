import type { EasingSpec, EvaluationResult, MotionTimeline, RationalFps } from "./types";
import { evaluateTimeline, outputKey } from "./timeline";

export type CameraPoint3D = readonly [number, number, number];

/** Right-handed Y-up world; distances use the scene's declared author units. */
export interface CameraOrbit3D {
  target: CameraPoint3D;
  distance: number;
  /** Degrees around Y, zero on +Z. Values may exceed 360 for continuous orbits. */
  azimuth: number;
  /** Degrees above the ground plane; keep strictly between -89.5 and 89.5. */
  elevation: number;
  /** Vertical field of view in degrees for the reference landscape output. */
  fov?: number;
  roll?: number;
}

export interface CameraOrbitKeyframe3D extends CameraOrbit3D {
  frame: number;
  cut?: boolean;
  easing?: EasingSpec;
}

export interface CameraRig3DOptions {
  id: string;
  cameraId?: string;
  fps: RationalFps;
  durationFrames: number;
  keyframes: readonly CameraOrbitKeyframe3D[];
}

const CHANNELS = ["targetX", "targetY", "targetZ", "distance", "azimuth", "elevation", "fov", "roll"] as const;

/** Orbit, dolly, crane and truck movements compile to existing numeric MG1 tracks. */
export function createCameraRig3D({ id, cameraId = "camera3d", fps, durationFrames, keyframes }: CameraRig3DOptions): MotionTimeline {
  if (!id.trim() || !cameraId.trim() || !Number.isInteger(durationFrames) || durationFrames < 1 ||
      !Number.isInteger(fps.num) || !Number.isInteger(fps.den) || fps.num <= 0 || fps.den <= 0) {
    throw new Error("Cannot create 3D camera rig. Supply non-empty IDs, a positive integer duration and positive integer rational FPS.");
  }
  if (!keyframes.length || keyframes[0].frame !== 0) {
    throw new Error(`3D camera "${cameraId}" needs an initial pose at frame 0.`);
  }
  for (let index = 0; index < keyframes.length; index++) {
    const pose = keyframes[index];
    if (!Number.isInteger(pose.frame) || pose.frame < 0 || pose.frame >= durationFrames ||
        (index > 0 && pose.frame <= keyframes[index - 1].frame) ||
        pose.target.length !== 3 || ![...pose.target, pose.distance, pose.azimuth, pose.elevation, pose.fov ?? 40, pose.roll ?? 0].every(Number.isFinite) ||
        pose.distance <= 0 || Math.abs(pose.elevation) >= 89.5 || (pose.fov ?? 40) < 5 || (pose.fov ?? 40) > 120) {
      throw new Error(`Invalid pose ${index} in 3D camera "${cameraId}". Use ascending in-range integer frames, a finite target, positive distance, elevation inside ±89.5°, and FOV from 5° to 120°.`);
    }
  }
  return {
    schemaVersion: 1, id, fps: { ...fps }, durationFrames,
    nodes: CHANNELS.map((channel) => ({
      kind: "track", id: `${cameraId}-${channel}`,
      track: {
        id: `${cameraId}-${channel}`, targetId: cameraId, property: channel, valueType: "number",
        keyframes: keyframes.map((pose) => ({
          frame: pose.frame,
          value: channel === "targetX" ? pose.target[0] : channel === "targetY" ? pose.target[1] : channel === "targetZ" ? pose.target[2] : channel === "fov" ? pose.fov ?? 40 : channel === "roll" ? pose.roll ?? 0 : pose[channel],
          easing: pose.cut ? "step-end" : pose.easing ?? "ease-in-out-cubic",
        })),
      },
    })),
  };
}

export interface CameraRigSample3D {
  position: CameraPoint3D;
  target: CameraPoint3D;
  fov: number;
  roll: number;
}

/** No Three.js dependency here: spherical evaluation is independent of the renderer. */
export function evaluateCameraRig3D(timeline: MotionTimeline, frame: number, cameraId = "camera3d", evaluation?: EvaluationResult): CameraRigSample3D {
  if (!Number.isInteger(frame)) throw new Error(`3D camera "${cameraId}" requires a finite integer frame.`);
  const result = evaluation ?? evaluateTimeline(timeline, Math.max(0, Math.min(timeline.durationFrames - 1, frame)));
  if (result.frame !== Math.max(0, Math.min(timeline.durationFrames - 1, frame))) throw new Error("3D camera sample frame differs from the requested frame. Pass the director's resolved frame.");
  const { samples } = result;
  const values = CHANNELS.map((channel) => samples[outputKey(cameraId, channel)]?.value);
  if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new Error(`3D camera "${cameraId}" has missing or invalid channels at frame ${frame}. Author it with createCameraRig3D.`);
  }
  const [x, y, z, distance, azimuth, elevation, fov, roll] = values as number[];
  if (distance <= 0 || Math.abs(elevation) >= 89.5 || fov < 5 || fov > 120) {
    throw new Error(`3D camera "${cameraId}" leaves its valid lens/orbit range at frame ${frame}. Reduce easing overshoot or adjust its poses.`);
  }
  const yaw = azimuth * Math.PI / 180;
  const pitch = elevation * Math.PI / 180;
  return {
    target: [x, y, z],
    position: [x + distance * Math.cos(pitch) * Math.sin(yaw), y + distance * Math.sin(pitch), z + distance * Math.cos(pitch) * Math.cos(yaw)],
    fov, roll,
  };
}
