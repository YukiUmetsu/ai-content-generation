/** CC1 is a portable camera-authoring fragment; MG1 remains the frame domain. */
import type { Diagnostic, EasingSpec, MotionTimeline, RationalFps, Rect } from "./types";
import type { DirectorTime } from "./director-types";
import type { Storyboard } from "./storyboard";

export type CameraVector3 = readonly [number, number, number];
/** Normalized XYZW quaternion, local -Z forward, +Y up, right-handed world. */
export type CameraQuaternion = readonly [number, number, number, number];
export interface CameraBounds3D { min: CameraVector3; max: CameraVector3 }
export interface CinematicCameraPose {
  position: CameraVector3;
  orientation: CameraQuaternion;
  /** Semantic focal point; composition may place it away from the optical axis. */
  focus: CameraVector3;
  projection: { kind: "perspective"; fov: number } | { kind: "orthographic"; scale: number };
  near: number;
  far: number;
  focusDistance: number;
}
export interface CameraTargetFrame {
  frame: number;
  bounds: CameraBounds3D;
  focus?: CameraVector3;
  orientation?: CameraQuaternion;
  worldMatrix?: readonly number[];
}
export interface CameraTarget {
  id: string;
  frames: CameraTargetFrame[];
  importance?: number;
  preferredDirection?: CameraVector3;
}
export interface CameraTargetSample {
  id: string;
  bounds: CameraBounds3D;
  focus: CameraVector3;
  orientation: CameraQuaternion;
  worldMatrix: readonly number[];
  importance: number;
  preferredDirection?: CameraVector3;
}
export interface CameraObstacle { id: string; bounds: CameraBounds3D }
export interface CameraTargetRegistry {
  readonly revision: string;
  readonly ids: readonly string[];
  readonly diagnostics: readonly CameraDiagnostic[];
  sample(id: string, frame: number): CameraTargetSample;
  /** Re-establish absolute geometry before collision/visibility queries. */
  prepareFrame?(frame: number): void;
  obstacles?(frame: number): readonly CameraObstacle[];
  /** Fraction of sampled subject anchors visible; finite [0,1], bounded rays. */
  visibility?(pose: CinematicCameraPose, target: CameraTargetSample, frame: number): number;
}
export type CameraPathSpec = {
  kind: "linear" | "bezier" | "catmull-rom";
  points: CameraVector3[];
  arcLength?: boolean;
  /** World coordinates by default; target-relative offsets when true. */
  relativeToTarget?: boolean;
};
export type CameraFraming = "wide" | "medium" | "close" | "extreme-close";
export interface CameraComposition {
  subjectPosition?: readonly [number, number];
  safeMargin?: number;
  safeRegion?: Rect;
  reserveRight?: number;
  headroom?: number;
  /** Normalized screen rectangles that essential subject bounds may not enter. */
  exclusions?: Rect[];
}
interface ConstraintBase { id: string; strength: "hard" | "soft"; priority: number; tolerance?: number }
export type FramingConstraint = ConstraintBase & (
  | { kind: "framing"; region?: Rect }
  | { kind: "collision"; clearance: number }
  | { kind: "occlusion"; minimumVisible: number }
  | { kind: "distance"; min: number; max: number }
  | { kind: "placement"; position: readonly [number, number] }
);
export type CameraShotKind = "establish" | "dolly" | "orbit" | "follow" | "crane" | "fly-through" | "turntable" | "exploded" | "detail-to-overview" | "multi-object" | "inspect";
export interface CameraOverrides {
  position?: CameraVector3;
  endPosition?: CameraVector3;
  orientation?: CameraQuaternion;
  endOrientation?: CameraQuaternion;
  focus?: CameraVector3;
  endFocus?: CameraVector3;
  viewingDirection?: CameraVector3;
  distance?: number;
  /** Scale the solver's fitted camera distance while preserving screen placement.
   * Use >1 for context around tiny moving targets without losing subject tracking. */
  distanceScale?: number;
  fov?: number;
  endFov?: number;
  orthographicScale?: number;
  near?: number;
  far?: number;
  roll?: number;
  focusDistance?: number;
  endFocusDistance?: number;
  /** Manual paths/poses are locked unless corrections are explicitly allowed. */
  allowCorrections?: boolean;
}
export interface CameraShotSpec {
  id: string;
  title?: string;
  type: CameraShotKind;
  target: string | string[];
  /** Optional destination subject for detail-to-overview. */
  endTarget?: string;
  durationFrames: number;
  at?: DirectorTime;
  after?: string[];
  framing?: CameraFraming;
  projection?: "perspective" | "orthographic";
  composition?: CameraComposition;
  constraints?: FramingConstraint[];
  transition?: { kind: "cut" } | { kind: "continuous"; durationFrames?: number; continuity?: "C0" | "C1"; allowPartialFraming?: boolean };
  movement?: "hold" | "slow-dolly" | "dolly-in" | "dolly-out";
  orbitDegrees?: number;
  azimuth?: number;
  elevation?: number;
  endElevation?: number;
  leadFrames?: number;
  followSide?: "leading" | "trailing";
  smoothingFrames?: number;
  holdFrames?: number;
  path?: CameraPathSpec;
  orientationPath?: { from: CameraQuaternion; to: CameraQuaternion };
  focusPath?: CameraPathSpec;
  orientAlongPath?: boolean;
  easing?: EasingSpec;
  overrides?: CameraOverrides;
  /** A named aspect variant or exact width:height string. */
  aspects?: Record<string, Partial<Pick<CameraShotSpec, "framing" | "composition" | "overrides">>>;
  objective?: string;
}
export interface CameraMotionProfile {
  easing: EasingSpec;
  intensity: number;
  margin: number;
  holdFraction: number;
  orbitDegrees: number;
  smoothingFrames: number;
  transitionFrames: number;
  /** Optional finite frame-domain bounds; violations fail instead of clipping. */
  maxTravelPerFrame?: number;
  maxAccelerationPerFrame?: number;
}
export interface CameraSequenceSpec {
  schemaVersion: 1;
  id: string;
  title: string;
  fps: RationalFps;
  durationFrames: number;
  cameraId?: string;
  output: { width: number; height: number; variant?: string };
  profile?: "editorial" | "technical" | "cinematic" | "expressive" | Partial<CameraMotionProfile>;
  shots: CameraShotSpec[];
  anchors?: Array<{ id: string; at: DirectorTime }>;
  /** Finite compilation budgets, never unbounded retries. */
  maxCandidates?: number;
}
export interface CameraDiagnostic extends Diagnostic {
  shotId?: string;
  targetIds?: string[];
  endFrame?: number;
  constraintId?: string;
  attemptedCorrection?: string;
  remainingLimitation?: string;
}
export interface PlannedCameraShot { id: string; startFrame: number; endFrame: number; spec: CameraShotSpec }
export interface CompiledCinematicCamera {
  spec: CameraSequenceSpec;
  timeline: MotionTimeline;
  shots: PlannedCameraShot[];
  storyboard: Storyboard;
  diagnostics: CameraDiagnostic[];
  targetRevision: string;
  stats: { frames: number; candidateEvaluations: number; correctedFrames: number; targetSamples: number };
}
export type CinematicCameraCompilation = { ok: true; plan: CompiledCinematicCamera; diagnostics: CameraDiagnostic[] } | { ok: false; diagnostics: CameraDiagnostic[] };
