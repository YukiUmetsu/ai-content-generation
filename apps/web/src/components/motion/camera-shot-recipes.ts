import type { CameraMotionProfile, CameraPathSpec, CameraSequenceSpec, CameraShotKind, CameraShotSpec, FramingConstraint } from "./cinematic-camera-types";

/** Labels resolve to inspectable numeric controls. Overrides merge with technical. */
export const CAMERA_MOTION_PROFILES: Record<"editorial" | "technical" | "cinematic" | "expressive", CameraMotionProfile> = {
  editorial: { easing: "ease-in-out-cubic", intensity: 0.65, margin: 0.1, holdFraction: 0.22, orbitDegrees: 45, smoothingFrames: 6, transitionFrames: 36 },
  technical: { easing: "ease-in-out-cubic", intensity: 0.75, margin: 0.08, holdFraction: 0.16, orbitDegrees: 60, smoothingFrames: 4, transitionFrames: 30 },
  cinematic: { easing: "ease-in-out-cubic", intensity: 1, margin: 0.08, holdFraction: 0.18, orbitDegrees: 85, smoothingFrames: 8, transitionFrames: 45 },
  expressive: { easing: "ease-in-out-cubic", intensity: 1.25, margin: 0.1, holdFraction: 0.1, orbitDegrees: 110, smoothingFrames: 3, transitionFrames: 24 },
};
const DEFAULT_SHOTS: Record<CameraShotKind, Partial<CameraShotSpec>> = {
  establish: { framing: "wide", movement: "slow-dolly", elevation: 35 },
  dolly: { framing: "medium", movement: "dolly-in", elevation: 20 },
  orbit: { framing: "medium", elevation: 25 },
  inspect: { framing: "close", orbitDegrees: 35, elevation: 25 },
  follow: { framing: "close", movement: "hold", elevation: 25, leadFrames: 6 },
  crane: { framing: "wide", elevation: 10, endElevation: 55 },
  "fly-through": { framing: "wide", movement: "hold", orientAlongPath: true },
  turntable: { framing: "medium", orbitDegrees: 360, elevation: 20 },
  exploded: { framing: "medium", orbitDegrees: 35, elevation: 20, endElevation: 35 },
  "detail-to-overview": { framing: "wide", movement: "dolly-out", elevation: 30 },
  "multi-object": { framing: "wide", movement: "slow-dolly", elevation: 30 },
};
export const CAMERA_SHOT_RECIPES = Object.keys(DEFAULT_SHOTS) as CameraShotKind[];
export function CameraShotRecipe(type: CameraShotKind, parameters: Omit<CameraShotSpec, "type">): CameraShotSpec {
  if (!DEFAULT_SHOTS[type]) throw new Error(`Unknown camera shot recipe "${type}". Choose ${CAMERA_SHOT_RECIPES.join(", ")}.`);
  return { ...DEFAULT_SHOTS[type], ...parameters, type };
}
export function CameraSequence(spec: Omit<CameraSequenceSpec, "schemaVersion">): CameraSequenceSpec { return { schemaVersion: 1, ...spec }; }
export function CameraPath(spec: CameraPathSpec): CameraPathSpec { return structuredClone(spec); }
export function createFramingConstraint(spec: FramingConstraint): FramingConstraint { return structuredClone(spec); }
export function resolveCameraProfile(profile: CameraSequenceSpec["profile"]): CameraMotionProfile {
  return typeof profile === "string" ? { ...CAMERA_MOTION_PROFILES[profile] } : { ...CAMERA_MOTION_PROFILES.technical, ...profile };
}
