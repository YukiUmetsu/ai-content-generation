/**
 * `scene-storyboard` — the storyboarding layer (docs/07 M2, docs/09
 * §"Storyboard-to-scene handoff").
 *
 * A storyboard records production decisions as **declarative data**: an ordered
 * set of shots that each teach one change, with the claim, visual objective,
 * focus target, narration anchor, on-screen labels and the identity that is
 * handed to the next scene. It is safe JSON — no functions, no DOM nodes, no
 * timers — so the same record can be validated, serialized, reviewed and later
 * compiled into scenes, clips or a motion timeline.
 *
 * Time is 2D integer frames at a rational FPS. Ranges are **end-exclusive**:
 * `[startFrame, startFrame + durationFrames)`, so the still at the last frame of
 * a shot is `startFrame + durationFrames - 1` (docs/11 §2). A storyboard that
 * tiles `[0, durationFrames)` with no gap and no overlap is directly placeable.
 *
 * Every function here is pure and deterministic: inputs are never mutated, no
 * wall clock or randomness is consulted, and identical inputs always produce
 * identical output. `validateStoryboard` returns plain {@link Diagnostic} data
 * (docs/11 §4); it never throws.
 */

import { DEFAULT_FPS, framesToSeconds, isFrameInRange, normalizeFps } from "./constants";
import type { Diagnostic, FrameRange, MotionCue, MotionNode, RationalFps } from "./types";

/** Version stamped on serialized storyboard documents. */
export const STORYBOARD_SCHEMA_VERSION = 1;

/**
 * Identity carried out of a shot into a later scene. `semanticId` is the durable
 * educational object (docs/08 §1.3); `targetSceneRef` is the `sceneRef` of the
 * shot that accepts it.
 */
export interface StoryboardExitHandoff {
  semanticId: string;
  targetSceneRef: string;
}

/** One planned shot. `startFrame`/`durationFrames` are integer frames. */
export interface StoryboardShot {
  id: string;
  sceneRef: string;
  startFrame: number;
  durationFrames: number;
  /** One coherent proposition (docs/09 §"Storyboard-to-scene handoff"). */
  claim: string;
  /** The observable change the shot must make clearer. */
  visualObjective: string;
  /** Semantic id the shot focuses (resolves to a stable id in the scene). */
  focusTarget: string;
  /** Cue id resolved to a concrete frame by the audio/timeline lane. */
  narrationCue?: string;
  /** Concise on-screen labels; never a transcript of the narration. */
  onScreenLabels: string[];
  /** Identity that survives the cut into `targetSceneRef`. */
  exitHandoff?: StoryboardExitHandoff;
  transitionIn?: { kind: string; durationFrames?: number };
  /** Useful still / reduced-motion substitute for this shot (docs/09 §7). */
  staticFallback?: string;
  assets?: string[];
}

/** The serialized storyboard document. Plain data, JSON-round-trippable. */
export interface Storyboard {
  schemaVersion: 1;
  id: string;
  title: string;
  fps: RationalFps;
  durationFrames: number;
  shots: StoryboardShot[];
  cues?: MotionCue[];
  identities?: string[];
}

/** Optional cross-document knowledge used by {@link validateStoryboard}. */
export interface StoryboardValidationOptions {
  /** Cue ids known to resolve to a frame (e.g. from the audio lane). */
  knownCues?: string[];
  /** Semantic ids the target composition declares; a handed-off id must be one. */
  knownIdentities?: string[];
  /** Returns `false` when a label cannot be laid out inside the shot's frame. */
  labelFits?: (label: string, shot: StoryboardShot) => boolean;
}

/** A shot placed on the composition timeline (docs/11 §3 `Clip`). */
export interface StoryboardClip {
  id: string;
  sceneRef: string;
  startFrame: number;
  durationFrames: number;
  sourceStartFrame: number;
}

/* ------------------------------------------------------------------ *
 * Internal helpers
 * ------------------------------------------------------------------ */

function shotsOf(board: Storyboard): StoryboardShot[] {
  return Array.isArray(board.shots) ? board.shots : [];
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 1;
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** Sort key: a non-finite start frame sorts last instead of poisoning the sort. */
function startKey(shot: StoryboardShot): number {
  return Number.isFinite(shot.startFrame) ? shot.startFrame : Number.POSITIVE_INFINITY;
}

/** Stable copy ordered by `startFrame` (ties keep the authored order). */
function sortedShots(shots: StoryboardShot[]): StoryboardShot[] {
  return shots
    .map((shot, index) => ({ shot, index }))
    .sort((a, b) => startKey(a.shot) - startKey(b.shot) || a.index - b.index)
    .map((entry) => entry.shot);
}

/** End of the last shot: `max(startFrame + durationFrames)`, `0` when none. */
function derivedEnd(shots: StoryboardShot[]): number {
  let end = 0;
  for (const shot of shots) {
    if (!Number.isInteger(shot.startFrame) || !Number.isInteger(shot.durationFrames)) continue;
    end = Math.max(end, shot.startFrame + shot.durationFrames);
  }
  return end;
}

/** Copy a shot so the returned board never shares mutable state with the input. */
function cloneShot(shot: StoryboardShot): StoryboardShot {
  const copy: StoryboardShot = {
    id: shot.id,
    sceneRef: shot.sceneRef,
    startFrame: shot.startFrame,
    durationFrames: shot.durationFrames,
    claim: shot.claim,
    visualObjective: shot.visualObjective,
    focusTarget: shot.focusTarget,
    onScreenLabels: Array.isArray(shot.onScreenLabels) ? [...shot.onScreenLabels] : [],
  };
  if (shot.narrationCue !== undefined) copy.narrationCue = shot.narrationCue;
  if (shot.exitHandoff) copy.exitHandoff = { ...shot.exitHandoff };
  if (shot.transitionIn) copy.transitionIn = { ...shot.transitionIn };
  if (shot.staticFallback !== undefined) copy.staticFallback = shot.staticFallback;
  if (Array.isArray(shot.assets)) copy.assets = [...shot.assets];
  return copy;
}

interface ResolvedHandoff {
  semanticId: string;
  fromShotId: string;
  toShotId: string;
  toSceneRef: string;
  fromStartFrame: number;
}

/**
 * Resolve every `exitHandoff` to the **next** shot (in start order) whose
 * `sceneRef` matches `targetSceneRef`. Unresolved entries keep `toShotId: ""`
 * and are reported by validation as `storyboard-handoff-target-unknown`.
 */
function resolveHandoffs(board: Storyboard): ResolvedHandoff[] {
  const ordered = sortedShots(shotsOf(board));
  const resolved: ResolvedHandoff[] = [];
  for (let i = 0; i < ordered.length; i += 1) {
    const shot = ordered[i];
    const exit = shot.exitHandoff;
    if (!exit) continue;
    const toSceneRef = typeof exit.targetSceneRef === "string" ? exit.targetSceneRef : "";
    let toShotId = "";
    if (toSceneRef !== "") {
      for (let j = i + 1; j < ordered.length; j += 1) {
        if (ordered[j].sceneRef === toSceneRef) {
          toShotId = ordered[j].id;
          break;
        }
      }
    }
    resolved.push({
      semanticId: typeof exit.semanticId === "string" ? exit.semanticId : "",
      fromShotId: shot.id,
      toShotId,
      toSceneRef,
      fromStartFrame: shot.startFrame,
    });
  }
  return resolved;
}

function compareCues(a: MotionCue, b: MotionCue): number {
  const af = Number.isFinite(a.frame) ? a.frame : Number.POSITIVE_INFINITY;
  const bf = Number.isFinite(b.frame) ? b.frame : Number.POSITIVE_INFINITY;
  if (af !== bf) return af - bf;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/* ------------------------------------------------------------------ *
 * Construction
 * ------------------------------------------------------------------ */

/**
 * Build a storyboard document. Shots are copied, so later mutation of the
 * returned board never reaches the caller's data.
 *
 * `durationFrames` defaults to the end of the last shot (the max
 * `startFrame + durationFrames`, `0` when there are no shots) — which for a
 * gap-free, overlap-free board is exactly the storyboard length.
 */
export function createStoryboard(props: {
  id: string;
  title: string;
  fps?: RationalFps;
  shots: StoryboardShot[];
  cues?: MotionCue[];
  identities?: string[];
  durationFrames?: number;
}): Storyboard {
  const shots = Array.isArray(props.shots) ? props.shots.map(cloneShot) : [];
  const board: Storyboard = {
    schemaVersion: STORYBOARD_SCHEMA_VERSION,
    id: props.id,
    title: props.title,
    fps: normalizeFps(props.fps ?? DEFAULT_FPS),
    durationFrames: props.durationFrames ?? derivedEnd(shots),
    shots,
  };
  if (props.cues) board.cues = props.cues.map((cue) => ({ ...cue }));
  if (props.identities) board.identities = [...props.identities];
  return board;
}

/* ------------------------------------------------------------------ *
 * Queries
 * ------------------------------------------------------------------ */

/** End-exclusive span of one shot: `[startFrame, startFrame + durationFrames)`. */
export function shotRange(shot: StoryboardShot): FrameRange {
  return { startFrame: shot.startFrame, endFrame: shot.startFrame + shot.durationFrames };
}

/**
 * The shot covering `frame`, or `null` outside every shot. End-exclusive, so
 * `shotAt(board, shotRange(shot).endFrame)` is the *next* shot (or `null`).
 * When shots overlap the earliest one in start order wins.
 */
export function shotAt(board: Storyboard, frame: number): StoryboardShot | null {
  if (!Number.isFinite(frame)) return null;
  for (const shot of sortedShots(shotsOf(board))) {
    if (isFrameInRange(frame, shotRange(shot))) return shot;
  }
  return null;
}

/** The storyboard's authored length in frames. */
export function storyboardDuration(board: Storyboard): number {
  return board.durationFrames;
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

/**
 * Validate a storyboard (docs/09 §"Storyboard-to-scene handoff", docs/11 §4).
 *
 * Errors mean the board cannot be placed or handed off as authored: missing
 * editorial fields, an id collision, bad time, a hole or overlap in
 * `[0, durationFrames)`, a declared duration that disagrees with the shots, a
 * narration cue that does not resolve, an unresolvable handoff target, an
 * identity outside the declared vocabulary or a broken transition.
 *
 * Warnings are review items that do not block placement: a transition longer
 * than its shot, a label that fails the supplied fit check, a declared identity
 * never handed off and a shot with no static fallback.
 *
 * Diagnostics are returned in a deterministic order (board-level, then shots in
 * authored order, then handoffs, coverage and identities) and the board is never
 * mutated.
 */
export function validateStoryboard(
  board: Storyboard,
  opts: StoryboardValidationOptions = {},
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const sceneId = hasText(board.id) ? board.id : undefined;
  type PushDiagnostic = Omit<Diagnostic, "sceneId"> & { sceneId?: string };
  const push = (diagnostic: PushDiagnostic): void => {
    diagnostics.push({ ...diagnostic, sceneId: diagnostic.sceneId ?? sceneId });
  };

  const shots = shotsOf(board);

  if (shots.length === 0) {
    push({
      code: "storyboard-empty",
      severity: "error",
      message: "A storyboard must contain at least one shot.",
      path: "shots",
    });
  }

  const derived = derivedEnd(shots);
  if (!isNonNegativeInteger(board.durationFrames) || board.durationFrames !== derived) {
    push({
      code: "storyboard-duration-mismatch",
      severity: "error",
      message: `durationFrames (${String(board.durationFrames)}) must equal the end of the last shot (${derived}); fix the duration or extend the shots.`,
      path: "durationFrames",
    });
  }

  const knownCues = opts.knownCues ? new Set(opts.knownCues) : null;
  const knownIdentities = opts.knownIdentities ? new Set(opts.knownIdentities) : null;
  const seenShotIds = new Set<string>();

  for (const [index, shot] of shots.entries()) {
    const path = `shots[${index}]`;
    const shotFrame = Number.isFinite(shot.startFrame) ? shot.startFrame : undefined;

    if (seenShotIds.has(shot.id)) {
      push({
        code: "storyboard-shot-id-duplicate",
        severity: "error",
        message: `Duplicate shot id "${shot.id}"; ids must be unique within a storyboard.`,
        layerId: shot.id,
        frame: shotFrame,
        path: `${path}.id`,
      });
    } else {
      seenShotIds.add(shot.id);
    }

    if (!isNonNegativeInteger(shot.startFrame)) {
      push({
        code: "storyboard-shot-invalid-start",
        severity: "error",
        message: `Shot "${shot.id}" startFrame must be a non-negative integer (got ${String(shot.startFrame)}).`,
        layerId: shot.id,
        path: `${path}.startFrame`,
      });
    }

    if (!isPositiveInteger(shot.durationFrames)) {
      push({
        code: "storyboard-shot-invalid-duration",
        severity: "error",
        message: `Shot "${shot.id}" durationFrames must be an integer of at least 1 (got ${String(shot.durationFrames)}).`,
        layerId: shot.id,
        frame: shotFrame,
        path: `${path}.durationFrames`,
      });
    }

    if (!hasText(shot.claim)) {
      push({
        code: "storyboard-claim-missing",
        severity: "error",
        message: `Shot "${shot.id}" needs a one-sentence claim; the scene has nothing to teach without it.`,
        layerId: shot.id,
        frame: shotFrame,
        path: `${path}.claim`,
      });
    }

    if (!hasText(shot.visualObjective)) {
      push({
        code: "storyboard-objective-missing",
        severity: "error",
        message: `Shot "${shot.id}" needs a visualObjective describing the observable change.`,
        layerId: shot.id,
        frame: shotFrame,
        path: `${path}.visualObjective`,
      });
    }

    if (!hasText(shot.focusTarget)) {
      push({
        code: "storyboard-focus-missing",
        severity: "error",
        message: `Shot "${shot.id}" needs a focusTarget that resolves to a stable semantic id.`,
        layerId: shot.id,
        frame: shotFrame,
        path: `${path}.focusTarget`,
      });
    }

    if (!Array.isArray(shot.onScreenLabels) || shot.onScreenLabels.length === 0) {
      push({
        code: "storyboard-labels-empty",
        severity: "error",
        message: `Shot "${shot.id}" must declare at least one concise on-screen label.`,
        layerId: shot.id,
        frame: shotFrame,
        path: `${path}.onScreenLabels`,
      });
    } else if (opts.labelFits) {
      const { labelFits } = opts;
      for (const [labelIndex, label] of shot.onScreenLabels.entries()) {
        if (!labelFits(label, shot)) {
          push({
            code: "storyboard-label-overflow",
            severity: "warning",
            message: `Label "${label}" does not fit shot "${shot.id}" at delivery size; shorten it or widen the label box.`,
            layerId: shot.id,
            frame: shotFrame,
            path: `${path}.onScreenLabels[${labelIndex}]`,
          });
        }
      }
    }

    if (knownCues && hasText(shot.narrationCue) && !knownCues.has(shot.narrationCue)) {
      push({
        code: "storyboard-narration-cue-missing",
        severity: "error",
        message: `Shot "${shot.id}" references narration cue "${shot.narrationCue}", which resolves to no frame.`,
        layerId: shot.id,
        frame: shotFrame,
        path: `${path}.narrationCue`,
      });
    }

    if (!hasText(shot.staticFallback)) {
      push({
        code: "storyboard-shot-no-fallback",
        severity: "warning",
        message: `Shot "${shot.id}" has no staticFallback; a still or reduced-motion substitute is required per shot (docs/09 §7).`,
        layerId: shot.id,
        frame: shotFrame,
        path: `${path}.staticFallback`,
      });
    }

    const transition = shot.transitionIn;
    if (transition) {
      if (!hasText(transition.kind)) {
        push({
          code: "storyboard-transition-invalid",
          severity: "error",
          message: `Shot "${shot.id}" transitionIn.kind must be a non-empty transition kind.`,
          layerId: shot.id,
          frame: shotFrame,
          path: `${path}.transitionIn.kind`,
        });
      }
      if (transition.durationFrames !== undefined) {
        if (!isPositiveInteger(transition.durationFrames)) {
          push({
            code: "storyboard-transition-invalid",
            severity: "error",
            message: `Shot "${shot.id}" transitionIn.durationFrames must be an integer of at least 1 when present (got ${String(transition.durationFrames)}).`,
            layerId: shot.id,
            frame: shotFrame,
            path: `${path}.transitionIn.durationFrames`,
          });
        } else if (transition.durationFrames > shot.durationFrames) {
          push({
            code: "storyboard-transition-overlap",
            severity: "warning",
            message: `Shot "${shot.id}" transitionIn lasts ${transition.durationFrames} frames but the shot is only ${shot.durationFrames} frames long.`,
            layerId: shot.id,
            frame: shotFrame,
            path: `${path}.transitionIn.durationFrames`,
          });
        }
      }
    }
  }

  const handoffs = resolveHandoffs(board);
  const declaredIdentities = Array.isArray(board.identities)
    ? board.identities.filter((identity): identity is string => typeof identity === "string")
    : [];
  const usedIdentities = new Set<string>();

  for (const handoff of handoffs) {
    if (handoff.semanticId !== "") usedIdentities.add(handoff.semanticId);
    if (handoff.toShotId === "") {
      push({
        code: "storyboard-handoff-target-unknown",
        severity: "error",
        message: `Shot "${handoff.fromShotId}" hands off to scene "${handoff.toSceneRef}", which no later shot provides.`,
        layerId: handoff.fromShotId,
        frame: handoff.fromStartFrame,
        path: "shots.exitHandoff.targetSceneRef",
      });
      continue;
    }
    const unknownToBoard =
      declaredIdentities.length > 0 && !declaredIdentities.includes(handoff.semanticId);
    const unknownToComposition = knownIdentities !== null && !knownIdentities.has(handoff.semanticId);
    if (unknownToBoard || unknownToComposition) {
      push({
        code: "storyboard-handoff-identity-mismatch",
        severity: "error",
        message: `Shot "${handoff.fromShotId}" hands off identity "${handoff.semanticId}", which is not declared where the handoff resolves; the target scene cannot accept it.`,
        layerId: handoff.fromShotId,
        frame: handoff.fromStartFrame,
        path: "shots.exitHandoff.semanticId",
      });
    }
  }

  let expected = 0;
  for (const shot of sortedShots(shots)) {
    if (!isNonNegativeInteger(shot.startFrame) || !isPositiveInteger(shot.durationFrames)) continue;
    if (shot.startFrame > expected) {
      push({
        code: "storyboard-coverage-gap",
        severity: "error",
        message: `Shots leave frames [${expected}, ${shot.startFrame}) uncovered; extend the previous shot or start this one earlier.`,
        layerId: shot.id,
        frame: expected,
        path: "shots",
      });
    } else if (shot.startFrame < expected) {
      push({
        code: "storyboard-coverage-overlap",
        severity: "error",
        message: `Shot "${shot.id}" starts at frame ${shot.startFrame}, inside the previous shot's range that ends at ${expected}.`,
        layerId: shot.id,
        frame: shot.startFrame,
        path: "shots",
      });
    }
    expected = Math.max(expected, shot.startFrame + shot.durationFrames);
  }
  if (isNonNegativeInteger(board.durationFrames) && board.durationFrames > expected) {
    push({
      code: "storyboard-coverage-gap",
      severity: "error",
      message: `Shots leave frames [${expected}, ${board.durationFrames}) uncovered at the end of the storyboard.`,
      frame: expected,
      path: "durationFrames",
    });
  }

  for (const identity of declaredIdentities) {
    if (identity.trim() === "" || usedIdentities.has(identity)) continue;
    push({
      code: "storyboard-identity-unused",
      severity: "warning",
      message: `Identity "${identity}" is declared but never handed off; drop it or carry it across a cut.`,
      path: "identities",
    });
  }

  return diagnostics;
}

/* ------------------------------------------------------------------ *
 * Handoff and projection
 * ------------------------------------------------------------------ */

/**
 * Resolve the handoff chain: one entry per `exitHandoff`, in shot order, with
 * `toShotId` pointing at the next shot that provides `targetSceneRef` (empty
 * when unresolved — validation reports it).
 */
export function handoffChain(
  board: Storyboard,
): Array<{ semanticId: string; fromShotId: string; toShotId: string; toSceneRef: string }> {
  return resolveHandoffs(board).map((handoff) => ({
    semanticId: handoff.semanticId,
    fromShotId: handoff.fromShotId,
    toShotId: handoff.toShotId,
    toSceneRef: handoff.toSceneRef,
  }));
}

/** Place every shot on the composition timeline, ordered by `startFrame`. */
export function toStoryboardClips(board: Storyboard): StoryboardClip[] {
  return sortedShots(shotsOf(board)).map((shot) => ({
    id: shot.id,
    sceneRef: shot.sceneRef,
    startFrame: shot.startFrame,
    durationFrames: shot.durationFrames,
    sourceStartFrame: 0,
  }));
}

/**
 * Resolve the storyboard's cues to concrete frames exactly once (docs/08 §2):
 * declared `board.cues` first, then a `shot-<id>` start cue per shot, then one
 * cue per `narrationCue` anchored at its shot's start frame. Ids are unique
 * (the first declaration wins) and the result is sorted by frame then id.
 */
export function toStoryboardCues(board: Storyboard): MotionCue[] {
  const cues: MotionCue[] = [];
  const seen = new Set<string>();
  const add = (cue: MotionCue): void => {
    if (!hasText(cue.id) || seen.has(cue.id)) return;
    seen.add(cue.id);
    cues.push(cue);
  };

  for (const cue of board.cues ?? []) add({ ...cue });

  for (const shot of sortedShots(shotsOf(board))) {
    add({ id: `shot-${shot.id}`, frame: shot.startFrame, kind: "shot-start", targetId: shot.sceneRef });
    if (hasText(shot.narrationCue)) {
      add({
        id: shot.narrationCue,
        frame: shot.startFrame,
        kind: "narration",
        targetId: shot.focusTarget,
      });
    }
  }

  return cues
    .map((cue, index) => ({ cue, index }))
    .sort((a, b) => compareCues(a.cue, b.cue) || a.index - b.index)
    .map((entry) => entry.cue);
}

/** Compact, serializable overview of a storyboard. */
export function storyboardSummary(board: Storyboard): {
  shots: number;
  durationFrames: number;
  totalSeconds: number;
  identities: string[];
  handoffs: number;
} {
  const shots = shotsOf(board);
  const durationFrames = storyboardDuration(board);
  return {
    shots: shots.length,
    durationFrames,
    totalSeconds: framesToSeconds(durationFrames, board.fps),
    identities: Array.isArray(board.identities) ? [...board.identities] : [],
    handoffs: resolveHandoffs(board).filter((handoff) => handoff.toShotId !== "").length,
  };
}

/**
 * Project the storyboard onto motion nodes: one `hold` per shot (id
 * `shot-<id>`, duration = the shot's duration) offset by its `startFrame`, in
 * start order. Holds only — the storyboard says *where* a shot lives, never
 * which tracks a scene animates.
 */
export function storyboardToTimelineNodes(board: Storyboard): MotionNode[] {
  return sortedShots(shotsOf(board)).map(
    (shot): MotionNode => ({
      kind: "hold",
      id: `shot-${shot.id}`,
      durationFrames: shot.durationFrames,
      offset: shot.startFrame,
    }),
  );
}
