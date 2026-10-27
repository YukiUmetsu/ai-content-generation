/**
 * Portable 2D / 2.5D character definition — data only.
 *
 * Source contract: docs/superpowers/specs/2026-10-26-2d-character-performance-design.md
 * ("Portable character contract") on top of docs/10 §1–2 (channels, visemes, gestures) and
 * docs/11 §1 (one serialized document, no executable content). Nothing here is a function,
 * a remote URL or shader code: a definition round-trips through JSON.
 *
 * Coordinates: design pixels, top-left origin, y down. Rotation is degrees, clockwise.
 * Time is an integer frame; ranges are `[startFrame, endFrame)`.
 */

import type { EasingSpec } from "../motion/types";

export const CHARACTER_SCHEMA_VERSION = 1 as const;

export type CharacterMode = "sprite-2d" | "puppet-2.5d";

export interface CharacterVec2 {
  x: number;
  y: number;
}

/** A transform delta or a rest transform. Missing fields are identity: x/y/rotation 0, scale 1. */
export interface CharacterPose2D {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

export type CharacterPoseDelta = Partial<CharacterPose2D>;

/** Part id → transform delta. Parts absent from a pose keep their current value. */
export type CharacterPoseMap = Record<string, CharacterPoseDelta>;

/** Absolute-frame, additive pose corrections authored by a consumer editor. */
export interface CharacterPoseCorrectionKey {
  frame: number;
  pose: CharacterPoseDelta;
}

/** Part ID → ordered correction keys. Missing properties have their identity values. */
export type CharacterPoseCorrectionTracks = Record<string, CharacterPoseCorrectionKey[]>;

export interface CharacterProvenance {
  /** SPDX-style identifier or a plain statement such as "original, CC0 dedication". */
  license: string;
  /** Who made the artwork; `original` for generic test characters. */
  source: string;
  attribution?: string;
}

export interface CharacterPathShape {
  type: "path";
  /** SVG path data. Validated against a strict command alphabet; never parsed as markup. */
  d: string;
  /** A palette key (`$body`) or a `#rgb`/`#rrggbb`/`#rrggbbaa` color. */
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
}

export interface CharacterEllipseShape {
  type: "ellipse";
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
}

export interface CharacterRectShape {
  type: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  rx?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
}

export type CharacterShape = CharacterPathShape | CharacterEllipseShape | CharacterRectShape;

/** Original vector artwork drawn in part-local design pixels. */
export interface CharacterShapeAsset {
  kind: "shapes";
  width: number;
  height: number;
  shapes: CharacterShape[];
  provenance: CharacterProvenance;
}

/** Raster artwork. `uri` is a logical reference the host resolves; it is never a remote URL. */
export interface CharacterImageAsset {
  kind: "image";
  uri: string;
  mediaType: "image/png" | "image/webp";
  width: number;
  height: number;
  /** Content hash the host verifies before drawing. */
  sha256?: string;
  provenance: CharacterProvenance;
}

export type CharacterAsset = CharacterShapeAsset | CharacterImageAsset;

export interface CharacterPart {
  id: string;
  /** Nested pivot hierarchy (2.5D). Omit for flat sprite characters. */
  parent?: string;
  /** Region that owns this part's override-blended motion. Must be a declared channel. */
  channel: string;
  /** Asset key drawn by default. */
  asset: string;
  /** Named alternative drawings (eye states, mouth shapes, pose sprites). Keys are variant names. */
  variants?: Record<string, string>;
  /** Pivot in part-local design pixels. Rotation and scale happen around it. */
  pivot: CharacterVec2;
  /** Local rest transform, relative to the parent's pivot space. */
  rest?: CharacterPoseDelta;
  z: number;
  /** 2.5D parallax factor. `look` on the instance moves the part by `look * depth * parallaxPx`. */
  depth?: number;
  /** Per-part bounded motion. Clamps the final local transform, not the authored pose. */
  limits?: {
    translate?: { min: CharacterVec2; max: CharacterVec2 };
    rotation?: { min: number; max: number };
    scale?: { min: number; max: number };
  };
}

export type CharacterAnchorPoint =
  /** Design-space point. */
  | { at: CharacterVec2; part?: undefined }
  /** Point in a part's local pixels; follows the part's animated transform. */
  | { part: string; at: CharacterVec2 };

export interface CharacterPhase {
  name: "prepare" | "act" | "hold" | "recover";
  frames: number;
  /**
   * Complete targets for this phase. Parts the action drives but leaves out of this phase
   * return to rest, so a `recover` phase lists nothing. Parts listed in no phase are untouched.
   */
  pose: CharacterPoseMap;
  easing?: EasingSpec;
  /**
   * Part id → variant shown while this phase is active. Applies only to parts in the action's
   * channel, and only while the action's weight is above 0.5 (so a takeover or blend-out does not
   * swap drawings halfway). Undefined variants are an error.
   */
  variants?: Record<string, string>;
}

export type CharacterTakeover = "finish" | "blend-out" | "cut";

export interface CharacterAction {
  /** Declared channel; the action may only write parts assigned to this channel (or additive writes). */
  channel: string;
  blend: "override" | "additive";
  /** Higher wins a same-channel takeover. Equal priority takes over by the declared policy. */
  priority: number;
  /**
   * What happens to the running action when this one starts:
   * `finish` queues this action after the running one, `blend-out` fades the running action over
   * `blendOutFrames`, `cut` drops it at the start frame.
   */
  takeover: CharacterTakeover;
  blendOutFrames?: number;
  phases: CharacterPhase[];
}

export interface CharacterExpression {
  /** Part id → variant name for the duration of the expression. */
  variants?: Record<string, string>;
  /** Extra deltas scaled by the cue's magnitude (0–1). */
  pose?: CharacterPoseMap;
}

export interface CharacterSpeechSpec {
  /** Part whose variant is the mouth shape. */
  mouthPart: string;
  /** Variant used at rest and during silence. Closing the mouth on pauses is required. */
  rest: string;
  /** Viseme id → mouth variant. Unknown visemes map to `rest` with a warning. */
  visemes: Record<string, string>;
  /** Variants cycled for approximate, word-level speech. */
  approximateCycle: string[];
  /** Cross-fade length between mouth variants, in frames. */
  transitionFrames: number;
  /** Frames per approximate mouth shape. */
  approximateStepFrames: number;
}

export interface CharacterGazeSpec {
  /** Parts translated toward the gaze target (pupils). */
  parts: string[];
  /** Maximum translation in design px. */
  maxOffset: number;
  /** Ease in/out length for gaze changes. */
  easeFrames: number;
}

export interface CharacterBlinkSpec {
  /** Parts switched to `variant` during a blink. */
  parts: string[];
  variant: string;
  /** Frames between blink starts, inclusive range. Seeded per instance; seek-stable. */
  intervalFrames: { min: number; max: number };
  durationFrames: number;
}

export interface CharacterIdleSpec {
  /** Low-amplitude, seeded background motion. Suspended by reduced motion. */
  parts: Record<string, { property: "y" | "rotation" | "scaleY"; amplitude: number; periodFrames: number }>;
}

export interface CharacterParamSpec {
  min: number;
  max: number;
  default: number;
  /** Each target adds `(value - default) * weight` to the part's property. */
  targets: { part: string; property: "x" | "y" | "rotation" | "scale"; weight: number }[];
}

export interface CharacterSkin {
  /** Palette overrides (keys must exist in the definition palette). */
  palette?: Record<string, string>;
  /** Asset swaps: asset key → replacement asset key (e.g. an outfit). */
  assets?: Record<string, string>;
}

export interface CharacterDefinition {
  schemaVersion: typeof CHARACTER_SCHEMA_VERSION;
  characterId: string;
  /** Immutable once approved. Instances pin a revision; a new revision is a new value. */
  revision: string;
  mode: CharacterMode;
  design: { width: number; height: number };
  /** Declared region names. Parts and actions must reference one of these. */
  channels: string[];
  /** Named colors. Shape fills reference them as `$name`. */
  palette: Record<string, string>;
  assets: Record<string, CharacterAsset>;
  parts: CharacterPart[];
  anchors?: Record<string, CharacterAnchorPoint>;
  poses: Record<string, CharacterPoseMap>;
  /** Pose used when no action is active. Must exist in `poses`. */
  basePose: string;
  actions: Record<string, CharacterAction>;
  expressions: { default: string; sets: Record<string, CharacterExpression> };
  speech?: CharacterSpeechSpec;
  gaze?: CharacterGazeSpec;
  blink?: CharacterBlinkSpec;
  idle?: CharacterIdleSpec;
  params?: Record<string, CharacterParamSpec>;
  skins?: Record<string, CharacterSkin>;
  /** Declared capabilities. Consumers may require a subset and get a precise error when missing. */
  capabilities: string[];
}

/** One performer of a definition. Instances pin the revision and never share playback state. */
export interface CharacterInstance {
  instanceId: string;
  characterId: string;
  /** Must equal the definition's `revision` or validation fails. */
  revision: string;
  skin?: string;
  /** Seeds blink timing and idle phase. Same seed + frame = same pose. */
  seed: number;
  params?: Record<string, number>;
  /** Normalized -1..1 viewer offset for depth parallax. */
  look?: CharacterVec2;
  reducedMotion?: boolean;
  /** 0..1 multiplier for idle motion. Default 1. */
  idleStrength?: number;
  /** Runtime gaze targets in design space, used when a gaze cue names a target not in `anchors`. */
  targets?: Record<string, CharacterVec2>;
  /** Optional editor-owned, per-instance correction tracks; sampled at the absolute frame. */
  corrections?: CharacterPoseCorrectionTracks;
}

export type CharacterCue =
  | {
      id: string;
      instanceId: string;
      kind: "action";
      /** Duration comes from the action's phases; the cue only sets when it starts. */
      startFrame: number;
      name: string;
      priority?: number;
    }
  | {
      id: string;
      instanceId: string;
      kind: "expression";
      startFrame: number;
      /** Omitted: holds until the next expression cue on this instance. */
      endFrame?: number;
      name: string;
      magnitude?: number;
    }
  | {
      id: string;
      instanceId: string;
      kind: "gaze";
      startFrame: number;
      endFrame: number;
      target: string;
    }
  | {
      id: string;
      instanceId: string;
      kind: "viseme";
      startFrame: number;
      endFrame: number;
      viseme: string;
      /** `exact` and `phoneme` cues come from supplied alignment; the evaluator never infers them. */
      precision: "exact" | "phoneme";
    }
  | {
      id: string;
      instanceId: string;
      kind: "speech";
      startFrame: number;
      endFrame: number;
      /** Word-level or coarser timing: the mouth cycles, never pretends to be phoneme-accurate. */
      precision: "word" | "approximate";
    };

export type CharacterDiagnosticSeverity = "error" | "warning";

export interface CharacterDiagnostic {
  code: string;
  severity: CharacterDiagnosticSeverity;
  message: string;
  cueId?: string;
  partId?: string;
  frame?: number;
}

export interface CharacterPartState {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  /** Variant to draw. Parts without variants draw `asset`. */
  variant?: string;
  /** Mouth cross-fade: draw `variantFrom` at `1 - variantMix` and `variant` at `variantMix`. */
  variantFrom?: string;
  variantMix?: number;
}

export interface CharacterFrameState {
  frame: number;
  parts: Record<string, CharacterPartState>;
  /** Anchor positions in design space, after part transforms. */
  anchors: Record<string, CharacterVec2>;
  blinking: boolean;
  diagnostics: CharacterDiagnostic[];
}
