/**
 * Motion core — deterministic serialization, hashing and tolerant parsing
 * (docs/08 §2, docs/11 §4).
 *
 * A motion timeline / storyboard is plain data (see `./types`), so it round-trips
 * through JSON without carrying executable code. This module makes that
 * round-trip *byte-stable*: object keys are emitted in code-unit order at every
 * depth, keyframes are sorted and de-duplicated, cues are ordered, and non-finite
 * numbers are rejected with a path. Two structurally-equal documents therefore
 * serialize, hash and diff identically across runs and machines.
 *
 * Every function here is pure and deterministic: inputs are never mutated and no
 * wall clock or randomness is consulted. Parsing is tolerant — malformed input
 * yields {@link Diagnostic} data, never a thrown error.
 */

import { MOTION_SCHEMA_VERSION } from "./constants";
import { createDiagnostic, hasBlockingDiagnostics } from "./diagnostics";
import {
  STORYBOARD_SCHEMA_VERSION,
  validateStoryboard,
} from "./storyboard";
import type { Storyboard } from "./storyboard";
import type {
  AnimationTrack,
  Diagnostic,
  EasingSpec,
  Keyframe,
  MotionCue,
  MotionNode,
  MotionOffset,
  MotionTimeline,
} from "./types";
import { validateTimeline } from "./validate";

/* ------------------------------------------------------------------ *
 * Stable JSON
 * ------------------------------------------------------------------ */

function describePath(path: string): string {
  return path === "" ? "<root>" : path;
}

/**
 * JSON with object keys sorted by code-unit order at every depth, arrays kept in
 * order and `undefined` object values omitted, so structurally-equal values
 * produce identical bytes.
 *
 * Non-finite numbers (`NaN`, `±Infinity`) have no JSON representation and are
 * rejected with an {@link Error} naming the offending path rather than silently
 * becoming `null`. Cyclic object graphs are rejected the same way. `space`
 * indents the output exactly like `JSON.stringify`'s third argument (`0` or
 * omitted means compact).
 */
export function stableStringify(value: unknown, space?: number): string {
  const seen = new WeakSet<object>();

  const normalize = (input: unknown, path: string): unknown => {
    if (typeof input === "number") {
      if (!Number.isFinite(input)) {
        throw new Error(`Cannot serialize non-finite number at ${describePath(path)}.`);
      }
      return input;
    }
    if (typeof input === "function" || typeof input === "symbol" || typeof input === "bigint") {
      throw new Error(`Cannot serialize a ${typeof input} value at ${describePath(path)}.`);
    }
    if (Array.isArray(input)) {
      // Array positions are preserved; a sparse/`undefined` slot serializes as
      // `null` (JSON semantics) so indices never shift.
      return input.map((entry, index) => normalize(entry, `${path}[${index}]`));
    }
    if (input !== null && typeof input === "object") {
      const object = input as Record<string, unknown>;
      if (seen.has(object)) {
        throw new Error(`Cannot serialize a cyclic value at ${describePath(path)}.`);
      }
      seen.add(object);
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(object).sort()) {
        const entry = object[key];
        if (entry === undefined) continue;
        sorted[key] = normalize(entry, path === "" ? key : `${path}.${key}`);
      }
      seen.delete(object);
      return sorted;
    }
    return input;
  };

  const output = JSON.stringify(normalize(value, ""), null, space);
  return output === undefined ? "null" : output;
}

/* ------------------------------------------------------------------ *
 * Deep copy helpers (inputs are never mutated)
 * ------------------------------------------------------------------ */

/** Structural copy of plain data; functions are absent by contract. */
function deepClone<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => deepClone(entry)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      const entry = source[key];
      if (entry === undefined) continue;
      copy[key] = deepClone(entry);
    }
    return copy as T;
  }
  return value;
}

function cloneEasing(easing: EasingSpec | undefined): EasingSpec | undefined {
  if (easing === undefined) return undefined;
  if (typeof easing === "string") return easing;
  return deepClone(easing);
}

function cloneOffset(offset: MotionOffset | undefined): MotionOffset | undefined {
  if (offset === undefined) return undefined;
  if (typeof offset === "number") return offset;
  return { cue: offset.cue };
}

function cloneKeyframe(keyframe: Keyframe): Keyframe {
  const copy: Keyframe = { frame: keyframe.frame, value: deepClone(keyframe.value) };
  if (keyframe.easing !== undefined) copy.easing = cloneEasing(keyframe.easing);
  return copy;
}

function finiteOrInfinity(value: number): number {
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

/** Ascending by frame (non-finite last, stable), duplicate frames de-duped last-wins. */
function normalizeKeyframes(keyframes: Keyframe[]): Keyframe[] {
  const ordered = keyframes
    .map((keyframe, index) => ({ keyframe, index }))
    .sort((a, b) => finiteOrInfinity(a.keyframe.frame) - finiteOrInfinity(b.keyframe.frame) || a.index - b.index)
    .map((entry) => entry.keyframe);

  const unique: Keyframe[] = [];
  for (const keyframe of ordered) {
    const last = unique[unique.length - 1];
    if (last && last.frame === keyframe.frame) {
      unique[unique.length - 1] = cloneKeyframe(keyframe);
    } else {
      unique.push(cloneKeyframe(keyframe));
    }
  }
  return unique;
}

function cloneTrack(track: AnimationTrack): AnimationTrack {
  const copy: AnimationTrack = {
    id: track.id,
    targetId: track.targetId,
    property: track.property,
    valueType: track.valueType,
    keyframes: normalizeKeyframes(track.keyframes),
  };
  if (track.easing !== undefined) copy.easing = cloneEasing(track.easing);
  if (track.blend !== undefined) copy.blend = track.blend;
  if (track.priority !== undefined) copy.priority = track.priority;
  if (track.conflict !== undefined) copy.conflict = track.conflict;
  if (track.angleMode !== undefined) copy.angleMode = track.angleMode;
  return copy;
}

function cloneNode(node: MotionNode): MotionNode {
  switch (node.kind) {
    case "track": {
      const copy: MotionNode = { kind: "track", id: node.id, track: cloneTrack(node.track) };
      const offset = cloneOffset(node.offset);
      if (offset !== undefined) copy.offset = offset;
      return copy;
    }
    case "sequence":
    case "parallel": {
      const children = node.children.map(cloneNode);
      const offset = cloneOffset(node.offset);
      if (node.kind === "sequence") {
        const copy: MotionNode = { kind: "sequence", id: node.id, children };
        if (offset !== undefined) copy.offset = offset;
        return copy;
      }
      const copy: MotionNode = { kind: "parallel", id: node.id, children };
      if (offset !== undefined) copy.offset = offset;
      return copy;
    }
    case "hold": {
      const copy: MotionNode = { kind: "hold", id: node.id, durationFrames: node.durationFrames };
      if (node.child) copy.child = cloneNode(node.child);
      const offset = cloneOffset(node.offset);
      if (offset !== undefined) copy.offset = offset;
      return copy;
    }
    case "repeat": {
      const copy: MotionNode = {
        kind: "repeat",
        id: node.id,
        count: node.count,
        child: node.child ? cloneNode(node.child) : node.child,
      };
      const offset = cloneOffset(node.offset);
      if (offset !== undefined) copy.offset = offset;
      return copy;
    }
    case "stagger": {
      const copy: MotionNode = {
        kind: "stagger",
        id: node.id,
        intervalFrames: node.intervalFrames,
        direction: node.direction,
        items: node.items.map((item) => {
          const cloned = { id: item.id, node: cloneNode(item.node) } as { id: string; node: MotionNode; group?: number };
          if (item.group !== undefined) cloned.group = item.group;
          return cloned;
        }),
      };
      if (node.groupSpacingFrames !== undefined) copy.groupSpacingFrames = node.groupSpacingFrames;
      const offset = cloneOffset(node.offset);
      if (offset !== undefined) copy.offset = offset;
      return copy;
    }
  }
}

/** Cues ordered by frame then id (stable; non-finite frames last). */
function normalizeCues(cues: MotionCue[]): MotionCue[] {
  return cues
    .map((cue, index) => ({ cue: deepClone(cue), index }))
    .sort((a, b) => {
      const byFrame = finiteOrInfinity(a.cue.frame) - finiteOrInfinity(b.cue.frame);
      if (byFrame !== 0) return byFrame;
      if (a.cue.id !== b.cue.id) return a.cue.id < b.cue.id ? -1 : 1;
      return a.index - b.index;
    })
    .map((entry) => entry.cue);
}

/**
 * Return a NEW timeline in canonical form: keyframes sorted ascending by frame
 * with duplicate frames de-duplicated (last wins), nodes deep-copied in their
 * authored order, cues ordered by frame then id, and transforms/constraints kept
 * in authored order. No authored data is dropped and the input is never mutated.
 */
export function normalizeTimeline(timeline: MotionTimeline): MotionTimeline {
  const copy: MotionTimeline = {
    schemaVersion: timeline.schemaVersion,
    id: timeline.id,
    fps: { num: timeline.fps.num, den: timeline.fps.den },
    durationFrames: timeline.durationFrames,
    nodes: timeline.nodes.map(cloneNode),
  };
  if (timeline.cues !== undefined) copy.cues = normalizeCues(timeline.cues);
  if (timeline.constraints !== undefined) copy.constraints = deepClone(timeline.constraints);
  if (timeline.transforms !== undefined) copy.transforms = deepClone(timeline.transforms);
  return copy;
}

/** Canonical, byte-stable JSON for a timeline. */
export function serializeTimeline(timeline: MotionTimeline, space = 2): string {
  return stableStringify(normalizeTimeline(timeline), space);
}

/* ------------------------------------------------------------------ *
 * Hashing (FNV-1a, 8 lowercase hex — matches registry/media/document.ts)
 * ------------------------------------------------------------------ */

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Dependency-free content fingerprint over the compact canonical timeline. */
export function timelineHash(timeline: MotionTimeline): string {
  return fnv1a(serializeTimeline(timeline, 0));
}

/* ------------------------------------------------------------------ *
 * Tolerant parsing
 * ------------------------------------------------------------------ */

export interface TimelineParseResult {
  timeline: MotionTimeline | null;
  diagnostics: Diagnostic[];
}

function decode(input: string | unknown, code: string): { value: unknown; diagnostics: Diagnostic[] } {
  if (typeof input === "string") {
    try {
      return { value: JSON.parse(input), diagnostics: [] };
    } catch (error) {
      return {
        value: undefined,
        diagnostics: [
          createDiagnostic(
            code,
            "error",
            error instanceof Error ? error.message : "JSON is not parseable.",
          ),
        ],
      };
    }
  }
  return { value: input, diagnostics: [] };
}

/**
 * Parse a timeline from a JSON string or an already-parsed value without
 * throwing. `timeline-parse-failed` reports unparseable JSON and
 * `timeline-shape-invalid` reports a non-object, a wrong `schemaVersion` or a
 * missing `nodes` array. A structurally-valid value is handed to
 * {@link validateTimeline}; the timeline is returned only when there are no
 * errors (warnings are returned alongside it).
 */
export function parseTimeline(input: string | unknown): TimelineParseResult {
  const decoded = decode(input, "timeline-parse-failed");
  if (decoded.diagnostics.length > 0) {
    return { timeline: null, diagnostics: decoded.diagnostics };
  }
  const value = decoded.value;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {
      timeline: null,
      diagnostics: [
        createDiagnostic("timeline-shape-invalid", "error", "A motion timeline must be a JSON object."),
      ],
    };
  }

  const candidate = value as Partial<MotionTimeline>;
  if (candidate.schemaVersion !== MOTION_SCHEMA_VERSION) {
    return {
      timeline: null,
      diagnostics: [
        createDiagnostic(
          "timeline-shape-invalid",
          "error",
          `Timeline schemaVersion must be ${MOTION_SCHEMA_VERSION} (got ${String(candidate.schemaVersion)}).`,
        ),
      ],
    };
  }
  if (!Array.isArray(candidate.nodes)) {
    return {
      timeline: null,
      diagnostics: [
        createDiagnostic("timeline-shape-invalid", "error", "Timeline is missing a nodes array."),
      ],
    };
  }

  const diagnostics = validateTimeline(candidate as MotionTimeline);
  return {
    timeline: hasBlockingDiagnostics(diagnostics) ? null : (candidate as MotionTimeline),
    diagnostics,
  };
}

/* ------------------------------------------------------------------ *
 * Storyboards
 * ------------------------------------------------------------------ */

/** Byte-stable JSON for a storyboard (keys sorted at every depth). */
export function serializeStoryboard(board: Storyboard, space = 2): string {
  return stableStringify(board, space);
}

export interface StoryboardParseResult {
  board: Storyboard | null;
  diagnostics: Diagnostic[];
}

/**
 * Parse a storyboard from a JSON string or an already-parsed value without
 * throwing. `storyboard-parse-failed` reports unparseable JSON and
 * `storyboard-shape-invalid` reports a non-object, a wrong `schemaVersion` or a
 * missing `shots` array; a structurally-valid value is handed to
 * {@link validateStoryboard} and returned only when there are no errors.
 */
export function parseStoryboard(input: string | unknown): StoryboardParseResult {
  const decoded = decode(input, "storyboard-parse-failed");
  if (decoded.diagnostics.length > 0) {
    return { board: null, diagnostics: decoded.diagnostics };
  }
  const value = decoded.value;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {
      board: null,
      diagnostics: [
        createDiagnostic("storyboard-shape-invalid", "error", "A storyboard must be a JSON object."),
      ],
    };
  }

  const candidate = value as Partial<Storyboard>;
  if (candidate.schemaVersion !== STORYBOARD_SCHEMA_VERSION) {
    return {
      board: null,
      diagnostics: [
        createDiagnostic(
          "storyboard-shape-invalid",
          "error",
          `Storyboard schemaVersion must be ${STORYBOARD_SCHEMA_VERSION} (got ${String(candidate.schemaVersion)}).`,
        ),
      ],
    };
  }
  if (!Array.isArray(candidate.shots)) {
    return {
      board: null,
      diagnostics: [
        createDiagnostic("storyboard-shape-invalid", "error", "Storyboard is missing a shots array."),
      ],
    };
  }

  const diagnostics = validateStoryboard(candidate as Storyboard);
  return {
    board: hasBlockingDiagnostics(diagnostics) ? null : (candidate as Storyboard),
    diagnostics,
  };
}

/** Dependency-free content fingerprint over the compact canonical storyboard. */
export function storyboardHash(board: Storyboard): string {
  return fnv1a(serializeStoryboard(board, 0));
}
