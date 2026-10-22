/** MD1 authoring fragment. Expanded recipes are JSON; MG1 remains the runtime. */
import type { AnimationTrack, Diagnostic, EasingSpec, EvaluationResult, MotionTimeline, MotionValue, RationalFps, StaggerDirection } from "./types";
import type { Storyboard, StoryboardShot } from "./storyboard";
import type { CompiledVisualTransformation, TransformationOptions, VisualMapping, VisualScene } from "./visual-transformation-types";

export type DirectorTime = number | { ref: string; edge?: "start" | "end"; offsetFrames?: number };
export type MotionPersonality = "precise" | "gentle" | "expressive";
export interface DirectorProfile {
  /** Amplitude multiplier, 0..1. Only explicitly marked decorative channels change. */
  intensity?: number;
  /** Duration multiplier, 0.25..4. Entire authored frame domain scales once. */
  pacing?: number;
  personality?: MotionPersonality;
}
export interface RecipeProvenance { id: string; version: number; parameters: Record<string, number | string | boolean> }
export interface DirectorNodeBase {
  id: string;
  /** Numeric time is relative to the parent; references use the global ID vocabulary. */
  at?: DirectorTime;
  /** Start after these nodes end. An explicit at is a deadline and must satisfy them. */
  after?: string[];
  recipe?: RecipeProvenance;
}
export interface DirectorAnimation extends DirectorNodeBase {
  kind: "animation";
  track: AnimationTrack;
  /** Explicitly permit a step into this clip's first value; otherwise C0 is required. */
  entry?: "continuous" | "cut";
  /** Optional rest value: amplitude is measured from this value, not from zero. */
  intensityOrigin?: MotionValue;
}
export interface DirectorGroup extends DirectorNodeBase {
  kind: "group";
  mode: "sequence" | "parallel" | "stagger";
  children: DirectorNode[];
  durationFrames?: number;
  /** Sequence: next starts this many frames before the previous end. */
  overlapFrames?: number;
  intervalFrames?: number;
  direction?: StaggerDirection;
  /** Set by the MG1 import boundary; prevents accidental cross-FPS playback. */
  importedFps?: RationalFps;
}
export interface DirectorHold extends DirectorNodeBase { kind: "hold"; durationFrames: number }
export type DirectorCuePayload =
  | { kind: "event"; name: string }
  | { kind: "narration"; text: string; language: string; assetRef?: string }
  | { kind: "speech-marker"; narrationId: string; marker: string }
  | { kind: "sound-effect"; assetRef: string; gainDb?: number }
  | { kind: "music-beat"; beat: number; bar?: number; assetRef?: string };
export interface DirectorCue extends DirectorNodeBase {
  kind: "cue";
  durationFrames?: number;
  targetId?: string;
  payload: DirectorCuePayload;
}
export interface DirectorShot extends DirectorNodeBase {
  kind: "shot";
  durationFrames: number;
  sceneRef: string;
  focusTarget: string;
  cameraRef?: string;
  claim: string;
  visualObjective: string;
  onScreenLabels: string[];
  narrationCue?: string;
  staticFallback: string;
  children: DirectorNode[];
}
export interface DirectorTransformation extends DirectorNodeBase, TransformationOptions {
  kind: "transformation";
  durationFrames: number;
  fromScene: string;
  toScene: string;
  mappings?: VisualMapping[];
}
export type DirectorNode = DirectorAnimation | DirectorGroup | DirectorHold | DirectorCue | DirectorShot | DirectorTransformation;
export interface MotionDirection {
  schemaVersion: 1;
  id: string;
  title: string;
  fps: RationalFps;
  durationFrames: number;
  /** Stable external objects, cameras and effect targets. Scene elements are also targets. */
  targets: string[];
  scenes?: VisualScene[];
  profile?: DirectorProfile;
  children: DirectorNode[];
}
export interface DirectorScheduleEntry {
  id: string;
  kind: DirectorNode["kind"];
  startFrame: number;
  endFrame: number;
  path: string;
  parentId?: string;
  recipe?: RecipeProvenance;
}
export interface ResolvedDirectorCue extends Omit<DirectorCue, "at" | "after"> { frame: number; durationFrames: number }
export interface DirectorSource {
  nodeId: string;
  targetId: string;
  property: string;
  startFrame: number;
  endFrame: number;
  path: string;
  recipe?: RecipeProvenance;
}
export interface CompiledMotionDirector {
  source: MotionDirection;
  timeline: MotionTimeline;
  scenes: VisualScene[];
  storyboard: Storyboard;
  shots: Array<StoryboardShot & { cameraRef?: string }>;
  schedule: DirectorScheduleEntry[];
  cues: ResolvedDirectorCue[];
  transformations: Array<{ id: string; startFrame: number; endFrame: number; compiled: CompiledVisualTransformation }>;
  /** MG1 node ID -> authored writers, including all joined successive clips. */
  sourceMap: Record<string, DirectorSource[]>;
  diagnostics: Diagnostic[];
}
export type DirectorCompilation =
  | { ok: true; director: CompiledMotionDirector; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] };
export interface DirectorFrame {
  director: CompiledMotionDirector;
  evaluation: EvaluationResult;
  shot: CompiledMotionDirector["shots"][number] | undefined;
}
export const DIRECTOR_PERSONALITIES: Record<MotionPersonality, EasingSpec> = {
  precise: "ease-in-out-cubic", gentle: "ease-in-out", expressive: "ease-out-back",
};
