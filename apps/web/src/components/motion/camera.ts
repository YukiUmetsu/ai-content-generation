import type { AffineMatrix, EasingSpec, EvaluationResult, Keyframe, MotionTimeline, RationalFps, Rect, Vec2 } from "./types";
import { evaluateTimeline, outputKey } from "./timeline";

export interface CameraPose {
  /** World-space point placed at the center of the output. */
  center: Vec2;
  /** Output pixels per world unit. Must be positive. */
  zoom: number;
  /** Clockwise camera rotation in degrees; the world rotates in reverse. */
  roll?: number;
}

export interface CameraKeyframe extends CameraPose {
  frame: number;
  easing?: EasingSpec;
  /** Hold the preceding pose, then cut exactly at this frame. */
  cut?: boolean;
}

export interface CameraTimelineOptions {
  id: string;
  cameraId?: string;
  fps: RationalFps;
  durationFrames: number;
  keyframes: readonly CameraKeyframe[];
}

/** Author camera movement as ordinary MG1 tracks, ready to combine with object tracks. */
export function createCameraTimeline({ id, cameraId = "camera", fps, durationFrames, keyframes }: CameraTimelineOptions): MotionTimeline {
  if (!Number.isInteger(durationFrames) || durationFrames < 1) {
    throw new Error(`Camera "${cameraId}" needs a positive integer durationFrames.`);
  }
  if (!Number.isInteger(fps.num) || !Number.isInteger(fps.den) || fps.num <= 0 || fps.den <= 0) {
    throw new Error(`Camera "${cameraId}" needs positive integer fps.num and fps.den.`);
  }
  if (keyframes.length === 0 || keyframes[0].frame !== 0) {
    throw new Error(`Camera "${cameraId}" needs an initial keyframe at frame 0.`);
  }
  for (let index = 0; index < keyframes.length; index++) {
    const keyframe = keyframes[index];
    if (!Number.isInteger(keyframe.frame) || keyframe.frame < 0 || keyframe.frame >= durationFrames ||
        (index > 0 && keyframe.frame <= keyframes[index - 1].frame)) {
      throw new Error(`Camera "${cameraId}" keyframe ${index} has an invalid frame. Use unique ascending integers inside [0, ${durationFrames}).`);
    }
    if (![keyframe.center.x, keyframe.center.y, keyframe.zoom, keyframe.roll ?? 0].every(Number.isFinite) || keyframe.zoom <= 0) {
      throw new Error(`Camera "${cameraId}" keyframe ${index} needs a finite center, roll, and zoom greater than zero.`);
    }
  }
  const frames = (property: "center" | "zoom" | "roll"): Keyframe[] => keyframes.map((keyframe) => ({
    frame: keyframe.frame,
    value: property === "center" ? { ...keyframe.center } : property === "roll" ? (keyframe.roll ?? 0) * Math.PI / 180 : keyframe.zoom,
    easing: keyframe.cut ? "step-end" : keyframe.easing ?? "ease-in-out-cubic",
  }));
  return {
    schemaVersion: 1, id, fps: { ...fps }, durationFrames,
    nodes: (["center", "zoom", "roll"] as const).map((property) => ({
      kind: "track", id: `${cameraId}-${property}`,
      track: {
        id: `${cameraId}-${property}`, targetId: cameraId, property,
        valueType: property === "center" ? "vec2" : property === "roll" ? "angle" : "number",
        keyframes: frames(property),
      },
    })),
  };
}

/** Fit the entire subject into the output, including camera roll and a safe inset. */
export function frameCameraSubject(subject: Rect, viewport: { width: number; height: number }, options: { padding?: number; roll?: number } = {}): CameraPose {
  const { padding = 0.08, roll = 0 } = options;
  if (![subject.x, subject.y, subject.width, subject.height, viewport.width, viewport.height, padding, roll].every(Number.isFinite) ||
      subject.width <= 0 || subject.height <= 0 || viewport.width <= 0 || viewport.height <= 0 || padding < 0 || padding >= 0.5) {
    throw new Error("Cannot frame camera subject. Supply finite positive subject/output dimensions and padding from 0 up to (but excluding) 0.5.");
  }
  const angle = roll * Math.PI / 180;
  const rotatedWidth = Math.abs(Math.cos(angle)) * subject.width + Math.abs(Math.sin(angle)) * subject.height;
  const rotatedHeight = Math.abs(Math.sin(angle)) * subject.width + Math.abs(Math.cos(angle)) * subject.height;
  return {
    center: { x: subject.x + subject.width / 2, y: subject.y + subject.height / 2 },
    zoom: Math.min(viewport.width * (1 - padding * 2) / rotatedWidth, viewport.height * (1 - padding * 2) / rotatedHeight),
    roll,
  };
}

/** Pure random-access camera evaluation. `matrix` also projects world anchors for overlays. */
export function evaluateCamera(timeline: MotionTimeline, frame: number, viewport: { width: number; height: number }, cameraId = "camera", evaluation?: EvaluationResult): { pose: CameraPose; matrix: AffineMatrix } {
  if (!Number.isFinite(frame) || !Number.isInteger(frame)) {
    throw new Error(`Camera "${cameraId}" needs a finite integer frame; received ${frame}.`);
  }
  if (![viewport.width, viewport.height].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error(`Camera "${cameraId}" needs positive finite output width and height.`);
  }
  const result = evaluation ?? evaluateTimeline(timeline, Math.max(0, Math.min(timeline.durationFrames - 1, frame)));
  if (result.frame !== Math.max(0, Math.min(timeline.durationFrames - 1, frame))) throw new Error("Camera evaluation frame does not match the requested frame. Share the same MotionDirector sample and frame.");
  const center = result.samples[outputKey(cameraId, "center")]?.value;
  const zoom = result.samples[outputKey(cameraId, "zoom")]?.value;
  const roll = result.samples[outputKey(cameraId, "roll")]?.value ?? 0;
  if (typeof center !== "object" || center === null || !("x" in center) || !("y" in center) ||
      !Number.isFinite(center.x) || !Number.isFinite(center.y) || typeof zoom !== "number" || !Number.isFinite(zoom) || zoom <= 0 ||
      typeof roll !== "number" || !Number.isFinite(roll)) {
    throw new Error(`Camera "${cameraId}" cannot resolve its pose at frame ${frame}. Provide center (vec2), zoom (positive number), and optional roll (angle) tracks; use createCameraTimeline to author them.`);
  }
  // MG1 angle tracks use radians; the authoring pose uses degrees.
  const angle = -roll;
  const a = zoom * Math.cos(angle);
  const b = zoom * Math.sin(angle);
  const c = -b;
  const d = a;
  return {
    pose: { center: { x: center.x, y: center.y }, zoom, roll: roll * 180 / Math.PI },
    matrix: { a, b, c, d, e: viewport.width / 2 - a * center.x - c * center.y, f: viewport.height / 2 - b * center.x - d * center.y },
  };
}
