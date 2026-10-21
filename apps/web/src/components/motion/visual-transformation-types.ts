/** VT1 is an authoring fragment compiled to MG1, not a second scene clock. */
import type { AffineMatrix, AnimationTrack, ColorValue, Diagnostic, EasingSpec, FrameRange, MotionTimeline, RationalFps, Rect } from "./types";
import type { ContourShape } from "./morph";
import type { MaskSample, MaskSpecLocal } from "./masks";
import type { SharedElementSpec } from "./shared-element";

export type VisualContent =
  | { kind: "shape"; bounds: Rect; shape: ContourShape }
  | { kind: "text"; bounds: Rect; text: string; fontFamily?: string; fontSize?: number; lineHeight?: number; direction?: "ltr" | "rtl" }
  | { kind: "svg-path"; bounds: Rect; d: string }
  | { kind: "group"; bounds: Rect };

export interface VisualElement {
  id: string;
  semanticId: string;
  /** Ancestors must be groups. World-space elements still inherit clipping. */
  parentId?: string;
  coordinateSpace?: "local" | "world";
  transform?: AffineMatrix;
  /** Maps content.bounds into this rectangle before applying transform. */
  layout?: Rect;
  content: VisualContent;
  fill?: ColorValue;
  stroke?: ColorValue;
  strokeWidth?: number;
  opacity?: number;
  clips?: Array<{ space: "local" | "world"; mask: MaskSpecLocal }>;
  /** Exact world mattes used by immutable interruption snapshots. */
  resolvedClips?: MaskSample[];
  lineage?: string[];
}
export interface VisualScene { id: string; elements: VisualElement[] }
export type TransformationStrategy = "auto" | "geometric-morph" | "shared-element" | "mask-reveal" | "particle-handoff" | "crossfade";
export interface TransformationOptions {
  strategy?: TransformationStrategy;
  fallback?: "crossfade" | "mask-reveal";
  easing?: EasingSpec;
  particles?: { count?: number; seed?: number; radius?: number; arc?: number };
}
type MappingBase = TransformationOptions & { id: string; semanticId: string };
export type VisualMapping = MappingBase & (
  | { kind: "one-to-one"; from: string; to: string }
  | { kind: "many-to-one"; from: [string, ...string[]]; to: string }
  | { kind: "one-to-many"; from: string; to: [string, ...string[]] }
  | { kind: "group"; pairs: Array<{ from: string; to: string; semanticId: string }> }
);
export interface VisualTransformationSpec extends TransformationOptions {
  schemaVersion: 1;
  id: string;
  fps: RationalFps;
  durationFrames: number;
  range: FrameRange;
  from: VisualScene;
  to: VisualScene;
  /** Omit to match unique semanticIds; unclaimed elements enter/exit. */
  mappings?: VisualMapping[];
}
export interface VisualLayer {
  id: string;
  semanticId: string;
  lineage: string[];
  content: Exclude<VisualContent, { kind: "group" }>;
  transform: AffineMatrix;
  fill: ColorValue;
  stroke: ColorValue;
  strokeWidth: number;
  opacity: number;
  clips: MaskSample[];
}
export interface VisualTransformationSample {
  frame: number;
  progress: number;
  layers: VisualLayer[];
  diagnostics: Diagnostic[];
}
/** Public inspection record: the selected strategy and its explicit fallback reason. */
export interface TransformationDecision { mappingId: string; requested: TransformationStrategy; selected: Exclude<TransformationStrategy, "auto">; reason: string }
export interface PreparedVisualElement extends VisualElement {
  local: AffineMatrix;
  world: AffineMatrix;
  opacity: number;
  localOpacity: number;
  fill: ColorValue;
  stroke: ColorValue;
  strokeWidth: number;
  clipChain: Array<{ ownerId: string; space: "local" | "world"; mask: MaskSpecLocal }>;
}
export interface TransformationLane {
  id: string;
  semanticId: string;
  from?: PreparedVisualElement;
  to?: PreparedVisualElement;
  strategy: Exclude<TransformationStrategy, "auto">;
  parentLaneId?: string;
  fixedPose: boolean;
  sourceWeight: number;
  targetWeight: number;
  shared?: SharedElementSpec;
  particles: Required<NonNullable<TransformationOptions["particles"]>>;
}
export interface CompiledVisualTransformation {
  spec: VisualTransformationSpec;
  timeline: MotionTimeline;
  lanes: TransformationLane[];
  decisions: TransformationDecision[];
  diagnostics: Diagnostic[];
}
/** Segments own [startFrame, next startFrame); earlier history is never rewritten. */
export interface VisualTransformationProgram {
  schemaVersion: 1;
  fps: RationalFps;
  durationFrames: number;
  segments: Array<{ startFrame: number; transformation: CompiledVisualTransformation }>;
}
export type VisualTransformationTrack = AnimationTrack;
