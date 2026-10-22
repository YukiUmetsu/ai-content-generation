/**
 * Kumiki motion primitives — shared type contract (docs/08 §2).
 *
 * This module is the *frozen interface* every other motion module implements
 * against. It is deliberately data + types only: no functions, no imports, no
 * side effects. Scene payloads that consumers serialize must be expressible
 * entirely with these shapes (plus plain numbers/strings) so a motion document
 * round-trips through JSON without ever carrying executable code (docs/08 §1,
 * docs/11 "safe data").
 *
 * Conventions (docs/07 shared contracts, docs/11 §time):
 * - Screen space is 2D design px with a top-left origin (`Vec2`).
 * - Time is an integer frame count at a rational FPS. A range `[startFrame,
 *   endFrame)` is end-exclusive; a still at the last frame is `endFrame - 1`.
 * - Every instance has a stable `id`; identity that must survive a
 *   representation change (a cut, morph or shared-element handoff) is carried
 *   by `semanticId` (docs/08 §1.3).
 * - Values are typed (`MotionValueType`). Arbitrary JSON/strings are never
 *   interpolated — discrete changes (`discrete`, `boolean`) are cuts.
 */

/* ------------------------------------------------------------------ *
 * Time
 * ------------------------------------------------------------------ */

/** Rational frames-per-second. `{ num: 30, den: 1 }` is 30 fps. */
export interface RationalFps {
  num: number;
  den: number;
}

/** End-exclusive frame range: covers `[startFrame, endFrame)`. */
export interface FrameRange {
  startFrame: number;
  endFrame: number;
}

/* ------------------------------------------------------------------ *
 * Geometry (2D design px, top-left origin)
 * ------------------------------------------------------------------ */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 2D affine transform, column-major conventional order (a b c d e f). */
export interface AffineMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/* ------------------------------------------------------------------ *
 * Values
 * ------------------------------------------------------------------ */

export type MotionValueType =
  | "number"
  | "opacity"
  | "length"
  | "angle"
  | "vec2"
  | "transform"
  | "color"
  | "path"
  | "boolean"
  | "discrete";

export type ColorSpace = "srgb" | "linear-rgb";

/** Colour with an explicitly declared space (docs/08 §2). */
export interface ColorValue {
  space: ColorSpace;
  r: number;
  g: number;
  b: number;
  alpha: number;
}

/** The single interpolated value union. Never arbitrary JSON. */
export type MotionValue =
  | number
  | Vec2
  | AffineMatrix
  | ColorValue
  | Vec2[]
  | boolean
  | string;

/* ------------------------------------------------------------------ *
 * Easing
 * ------------------------------------------------------------------ */

export type EasingName =
  | "linear"
  | "ease-in"
  | "ease-out"
  | "ease-in-out"
  | "ease-in-cubic"
  | "ease-out-cubic"
  | "ease-in-out-cubic"
  | "ease-in-quad"
  | "ease-out-quad"
  | "ease-in-out-quad"
  | "ease-in-quart"
  | "ease-out-quart"
  | "ease-in-expo"
  | "ease-out-expo"
  | "ease-in-back"
  | "ease-out-back"
  | "ease-in-out-back"
  | "step-start"
  | "step-end";

/** Cubic bezier control points [x1, y1, x2, y2] in unit space. */
export type CubicBezierTuple = [number, number, number, number];

export interface StepsEasing {
  steps: number;
  mode?: "start" | "end" | "both";
}

export type EasingSpec = EasingName | { cubicBezier: CubicBezierTuple } | StepsEasing;

/** Rotation interpolation. `shortest` (default) takes the shortest arc. */
export type AngleMode = "shortest" | "full-turn";

/* ------------------------------------------------------------------ *
 * Tracks
 * ------------------------------------------------------------------ */

export interface Keyframe {
  frame: number;
  value: MotionValue;
  /** Incoming easing for the segment that *ends* at this keyframe. */
  easing?: EasingSpec;
}

/**
 * Conflict policy when more than one track writes the same
 * `<targetId>.<property>` (docs/08 §2 `property-track`).
 * - `error` (default): a duplicate writer is a diagnostic error.
 * - `additive`: numeric/vec2/transform values combine additively.
 * - `priority`: the writer with the highest `priority` wins.
 */
export type ConflictPolicy = "error" | "additive" | "priority";

export interface AnimationTrack {
  id: string;
  targetId: string;
  property: string;
  valueType: MotionValueType;
  keyframes: Keyframe[];
  /** Default easing applied when a keyframe does not declare one. */
  easing?: EasingSpec;
  blend?: "override" | "additive";
  priority?: number;
  conflict?: ConflictPolicy;
  /** Rotation handling for `valueType: "angle"`. Defaults to `shortest`. */
  angleMode?: AngleMode;
}

/* ------------------------------------------------------------------ *
 * Cues and timeline scopes
 * ------------------------------------------------------------------ */

/** Named anchor resolved to a concrete frame exactly once (docs/08 §2). */
export interface MotionCue {
  id: string;
  frame: number;
  kind?: string;
  targetId?: string;
}

/** A node offset is either absolute frames or a resolved named cue. */
export type MotionOffset = number | { cue: string };

export type StaggerDirection = "forward" | "reverse" | "from-center" | "from-edges";

export interface StaggerItem {
  id: string;
  node: MotionNode;
  /** Later groups start after earlier groups; within a group order is preserved. */
  group?: number;
}

export interface TrackNode {
  kind: "track";
  id: string;
  track: AnimationTrack;
  offset?: MotionOffset;
}

export interface SequenceNode {
  kind: "sequence";
  id: string;
  children: MotionNode[];
  offset?: MotionOffset;
}

export interface ParallelNode {
  kind: "parallel";
  id: string;
  children: MotionNode[];
  offset?: MotionOffset;
}

export interface HoldNode {
  kind: "hold";
  id: string;
  durationFrames: number;
  child?: MotionNode;
  offset?: MotionOffset;
}

export interface RepeatNode {
  kind: "repeat";
  id: string;
  count: number;
  child: MotionNode;
  offset?: MotionOffset;
}

export interface StaggerNode {
  kind: "stagger";
  id: string;
  intervalFrames: number;
  direction: StaggerDirection;
  items: StaggerItem[];
  /** Extra spacing (frames) added between consecutive groups. */
  groupSpacingFrames?: number;
  offset?: MotionOffset;
}

export type MotionNode =
  | TrackNode
  | SequenceNode
  | ParallelNode
  | HoldNode
  | RepeatNode
  | StaggerNode;

/* ------------------------------------------------------------------ *
 * Deterministic post-authored resolution
 * ------------------------------------------------------------------ */

export type MotionConstraint =
  | {
      kind: "look-at";
      id: string;
      targetId: string;
      property?: string;
      towards: Vec2;
    }
  | {
      kind: "follow";
      id: string;
      targetId: string;
      sourceId: string;
      property?: string;
      offset?: Vec2;
    }
  | {
      kind: "distance-anchor";
      id: string;
      targetId: string;
      property?: string;
      anchor: Vec2;
      distance: number;
      angle: number;
    }
  | {
      kind: "bounds";
      id: string;
      targetId: string;
      property?: string;
      bounds: Rect;
      mode?: "clamp" | "reject";
    };

/**
 * A transform hierarchy node. World transforms resolve parent-before-child
 * (docs/08 §2 `transform-group`).
 */
export interface TransformNode {
  id: string;
  parentId?: string;
  local: AffineMatrix;
  /** Pivot in the parent's coordinate space, applied before `local`. */
  pivot?: Vec2;
}

export interface MotionTimeline {
  schemaVersion: 1;
  id: string;
  fps: RationalFps;
  durationFrames: number;
  cues?: MotionCue[];
  nodes: MotionNode[];
  constraints?: MotionConstraint[];
  transforms?: TransformNode[];
}

/* ------------------------------------------------------------------ *
 * Diagnostics (mirrors registry/media/document.ts, docs/11 §4)
 * ------------------------------------------------------------------ */

export interface Diagnostic {
  code: string;
  severity: "error" | "warning";
  message: string;
  sceneId?: string;
  layerId?: string;
  frame?: number;
  capability?: string;
  fallback?: string;
  path?: string;
}

export interface MotionSample {
  targetId: string;
  property: string;
  valueType: MotionValueType;
  value: MotionValue;
  /** Node id that produced the value (post conflict resolution). */
  sourceId: string;
}

/** Pure result of evaluating a timeline at one frame. Never has side effects. */
export interface EvaluationResult {
  frame: number;
  /** Keyed by `${targetId}.${property}`. */
  samples: Record<string, MotionSample>;
  /** Resolved world transforms keyed by transform node id. */
  transforms: Record<string, AffineMatrix>;
  diagnostics: Diagnostic[];
}

export interface PinnedValues {
  [key: string]: MotionValue;
}
