/**
 * Motion core — deterministic validation of motion documents (docs/08 §2,
 * docs/11 §4).
 *
 * Validation is a pure, non-throwing authoring gate. It works on untrusted input
 * (parsed JSON) through {@link isMotionTimeline}, reports problems as plain
 * {@link Diagnostic} data and always returns in a deterministic order. It never
 * evaluates a frame, so it can run before a timeline is placed.
 *
 * Errors mean the timeline cannot be played as authored (bad time, broken
 * identity, a track that writes nothing, a cycle, a dangling reference).
 * Warnings are review items that do not block playback.
 */

import { MOTION_SCHEMA_VERSION } from "./constants";
import { createDiagnostic, hasBlockingDiagnostics, sortDiagnostics } from "./diagnostics";
import { validateValue } from "./interpolate";
import { staggerStartFrames } from "./stagger";
import { validateStoryboard } from "./storyboard";
import type { Storyboard } from "./storyboard";
import type {
  AnimationTrack,
  Diagnostic,
  MotionConstraint,
  MotionCue,
  MotionNode,
  MotionOffset,
  MotionTimeline,
  RationalFps,
  TransformNode,
} from "./types";

/* ------------------------------------------------------------------ *
 * Guards
 * ------------------------------------------------------------------ */

/**
 * Structural guard: a value that carries a `nodes` array is treated as a motion
 * timeline. Deliberately permissive — a wrong `schemaVersion` or missing fields
 * are reported by {@link validateTimeline} rather than rejected here, so a
 * caller can see exactly what is wrong.
 */
export function isMotionTimeline(value: unknown): value is MotionTimeline {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Array.isArray((value as { nodes?: unknown }).nodes)
  );
}

/** Structural guard used only to dispatch {@link validateMotionDocument}. */
function looksLikeStoryboard(value: unknown): value is Storyboard {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Array.isArray((value as { shots?: unknown }).shots)
  );
}

/* ------------------------------------------------------------------ *
 * Internal helpers
 * ------------------------------------------------------------------ */

const MAX_DEPTH = 128;

function offsetToFrames(offset: MotionOffset | undefined, cueFrames: Record<string, number>): number {
  if (offset === undefined) return 0;
  if (typeof offset === "number") return Number.isFinite(offset) ? offset : 0;
  const resolved = cueFrames[offset.cue];
  return resolved === undefined ? 0 : resolved;
}

/** First non-finite number inside a value, as a JSON-ish path, or `null`. */
function findNonFinite(value: unknown, path: string): string | null {
  if (typeof value === "number") return Number.isFinite(value) ? null : path;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findNonFinite(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      const found = findNonFinite(entry, `${path}.${key}`);
      if (found) return found;
    }
    return null;
  }
  return null;
}

/** Span of a node in frames, guarded against cycles and pathological depth. */
function nodeSpan(
  node: MotionNode | undefined,
  cueFrames: Record<string, number>,
  seen: WeakSet<object>,
  depth: number,
): number {
  if (!node || depth > MAX_DEPTH || seen.has(node)) return 0;
  seen.add(node);
  let span = 0;
  switch (node.kind) {
    case "track": {
      const keyframes = Array.isArray(node.track?.keyframes) ? node.track.keyframes : [];
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (const keyframe of keyframes) {
        if (Number.isFinite(keyframe?.frame)) {
          min = Math.min(min, keyframe.frame);
          max = Math.max(max, keyframe.frame);
        }
      }
      span = keyframes.length >= 2 && Number.isFinite(min) && Number.isFinite(max) ? max - min : 0;
      break;
    }
    case "sequence": {
      let cursor = 0;
      for (const child of node.children ?? []) {
        cursor += offsetToFrames(child?.offset, cueFrames) + nodeSpan(child, cueFrames, seen, depth + 1);
      }
      span = cursor;
      break;
    }
    case "parallel": {
      let end = 0;
      for (const child of node.children ?? []) {
        end = Math.max(end, offsetToFrames(child?.offset, cueFrames) + nodeSpan(child, cueFrames, seen, depth + 1));
      }
      span = end;
      break;
    }
    case "hold": {
      span = Number.isFinite(node.durationFrames) ? Math.max(0, node.durationFrames) : 0;
      break;
    }
    case "repeat": {
      const count = Number.isInteger(node.count) && node.count >= 1 ? node.count : 1;
      span = count * nodeSpan(node.child, cueFrames, seen, depth + 1);
      break;
    }
    case "stagger": {
      const items = node.items ?? [];
      const starts = staggerStartFrames(items, node.intervalFrames, node.direction, node.groupSpacingFrames);
      let end = 0;
      for (let index = 0; index < items.length; index += 1) {
        end = Math.max(end, (starts[index] ?? 0) + nodeSpan(items[index]?.node, cueFrames, seen, depth + 1));
      }
      span = end;
      break;
    }
  }
  seen.delete(node);
  return span;
}

/** Ids participating in a transform parent cycle (sorted for determinism). */
function transformCycleIds(transforms: TransformNode[]): string[] {
  const parentOf = new Map<string, string | undefined>();
  for (const node of transforms) {
    if (!node || typeof node !== "object") continue;
    if (typeof node.id === "string" && !parentOf.has(node.id)) parentOf.set(node.id, node.parentId);
  }

  const cyclic = new Set<string>();
  for (const start of parentOf.keys()) {
    const seen = new Set<string>();
    let current: string | undefined = start;
    while (current !== undefined) {
      if (seen.has(current)) {
        let cursor: string | undefined = current;
        do {
          cyclic.add(cursor);
          cursor = parentOf.get(cursor);
        } while (cursor !== undefined && cursor !== current);
        break;
      }
      seen.add(current);
      current = parentOf.get(current);
    }
  }
  return [...cyclic].sort();
}

interface WalkState {
  diagnostics: Diagnostic[];
  nodeIds: Set<string>;
  tracks: Array<{ track: AnimationTrack; path: string }>;
  referencedCues: Set<string>;
  targetIds: Set<string>;
  cueFrames: Record<string, number>;
  durationFrames: number;
}

function checkOffset(state: WalkState, offset: MotionOffset | undefined, path: string): void {
  if (offset === undefined || typeof offset === "number") return;
  state.referencedCues.add(offset.cue);
  if (!Object.prototype.hasOwnProperty.call(state.cueFrames, offset.cue)) {
    state.diagnostics.push(
      createDiagnostic(
        "motion-offset-cue-missing",
        "error",
        `Offset references unknown cue "${offset.cue}".`,
        { path },
      ),
    );
  }
}

function walkTrack(state: WalkState, track: AnimationTrack, path: string): void {
  if (!track || typeof track !== "object") return;
  const keyframes = Array.isArray(track.keyframes) ? track.keyframes : [];
  if (keyframes.length === 0) {
    state.diagnostics.push(
      createDiagnostic("motion-keyframe-empty", "error", `Track "${track.id}" has no keyframes.`, {
        path: `${path}.keyframes`,
      }),
    );
  } else {
    const seenFrames = new Set<number>();
    let previous = Number.NEGATIVE_INFINITY;
    let ordered = true;
    for (let index = 0; index < keyframes.length; index += 1) {
      const keyframe = keyframes[index];
      const keyframePath = `${path}.keyframes[${index}]`;
      const frame = keyframe?.frame;

      if (!Number.isInteger(frame) || (frame as number) < 0) {
        state.diagnostics.push(
          createDiagnostic(
            "motion-keyframe-frame-invalid",
            "error",
            `Keyframe ${index} of track "${track.id}" must have a non-negative integer frame.`,
            { frame: Number.isFinite(frame) ? (frame as number) : undefined, path: `${keyframePath}.frame` },
          ),
        );
      } else {
        if (seenFrames.has(frame as number)) {
          state.diagnostics.push(
            createDiagnostic(
              "motion-keyframe-duplicate-frame",
              "error",
              `Track "${track.id}" declares frame ${frame} more than once.`,
              { frame: frame as number, path: `${keyframePath}.frame` },
            ),
          );
        }
        seenFrames.add(frame as number);
      }

      if (typeof frame === "number" && Number.isFinite(frame)) {
        if (frame < 0 || frame >= state.durationFrames) {
          state.diagnostics.push(
            createDiagnostic(
              "motion-frame-out-of-range",
              "warning",
              `Keyframe frame ${frame} is outside [0, ${state.durationFrames}).`,
              { frame, path: `${keyframePath}.frame` },
            ),
          );
        }
        if (frame < previous) ordered = false;
        previous = frame;
      }

      const mismatch = validateValue(track.valueType, keyframe.value);
      if (mismatch) state.diagnostics.push({ ...mismatch, path: `${keyframePath}.value` });

      const nonFinite = findNonFinite(keyframe.value, `${keyframePath}.value`);
      if (nonFinite) {
        state.diagnostics.push(
          createDiagnostic("motion-value-not-finite", "error", "A keyframe value contains a non-finite number.", {
            path: nonFinite,
          }),
        );
      }
    }

    if (!ordered) {
      state.diagnostics.push(
        createDiagnostic("motion-keyframe-unordered", "warning", `Track "${track.id}" keyframes are not in ascending frame order.`, {
          path: `${path}.keyframes`,
        }),
      );
    }
  }

  state.tracks.push({ track, path });
  if (typeof track.targetId === "string") state.targetIds.add(track.targetId);
}

function walkNode(state: WalkState, node: MotionNode, path: string, startFrame: number, depth: number): void {
  if (depth > MAX_DEPTH || !node || typeof node !== "object") return;

  const id = (node as { id?: unknown }).id;
  if (typeof id !== "string" || id.trim() === "") {
    state.diagnostics.push(
      createDiagnostic("motion-node-id-missing", "error", "Motion node is missing a stable id.", {
        path: `${path}.id`,
      }),
    );
  } else if (state.nodeIds.has(id)) {
    state.diagnostics.push(
      createDiagnostic("motion-node-id-duplicate", "error", `Duplicate motion node id "${id}".`, {
        path: `${path}.id`,
      }),
    );
  } else {
    state.nodeIds.add(id);
  }

  checkOffset(state, node.offset, `${path}.offset`);

  switch (node.kind) {
    case "track": {
      walkTrack(state, node.track, `${path}.track`);
      if (state.durationFrames > 0 && startFrame >= state.durationFrames) {
        state.diagnostics.push(
          createDiagnostic(
            "motion-node-unreachable",
            "warning",
            `Track "${node.id}" starts at frame ${startFrame}, outside [0, ${state.durationFrames}).`,
            { frame: startFrame, path },
          ),
        );
      }
      break;
    }

    case "sequence": {
      const children = Array.isArray(node.children) ? node.children : [];
      if (children.length === 0) {
        state.diagnostics.push(
          createDiagnostic("motion-node-empty", "error", `Sequence node "${node.id}" has no children.`, { path }),
        );
      }
      let cursor = 0;
      for (let index = 0; index < children.length; index += 1) {
        const child = children[index];
        const childOffset = offsetToFrames(child?.offset, state.cueFrames);
        walkNode(state, child, `${path}.children[${index}]`, startFrame + cursor + childOffset, depth + 1);
        cursor += childOffset + nodeSpan(child, state.cueFrames, new WeakSet<object>(), 0);
      }
      break;
    }

    case "parallel": {
      const children = Array.isArray(node.children) ? node.children : [];
      if (children.length === 0) {
        state.diagnostics.push(
          createDiagnostic("motion-node-empty", "error", `Parallel node "${node.id}" has no children.`, { path }),
        );
      }
      for (let index = 0; index < children.length; index += 1) {
        const child = children[index];
        walkNode(state, child, `${path}.children[${index}]`, startFrame + offsetToFrames(child?.offset, state.cueFrames), depth + 1);
      }
      break;
    }

    case "hold": {
      if (node.child && Number.isFinite(node.durationFrames)) {
        const childSpan = nodeSpan(node.child, state.cueFrames, new WeakSet<object>(), 0);
        if (childSpan > node.durationFrames) {
          state.diagnostics.push(
            createDiagnostic(
              "motion-hold-child-overflow",
              "warning",
              `Hold node "${node.id}" has a child (${childSpan} frames) longer than its duration (${node.durationFrames} frames).`,
              { path },
            ),
          );
        }
      }
      if (node.child) walkNode(state, node.child, `${path}.child`, startFrame, depth + 1);
      break;
    }

    case "repeat": {
      if (!Number.isInteger(node.count) || node.count < 1) {
        state.diagnostics.push(
          createDiagnostic(
            "motion-repeat-count-invalid",
            "error",
            `Repeat node "${node.id}" has an invalid count ${String(node.count)}.`,
            { path: `${path}.count` },
          ),
        );
      }
      if (node.child) walkNode(state, node.child, `${path}.child`, startFrame, depth + 1);
      break;
    }

    case "stagger": {
      const items = Array.isArray(node.items) ? node.items : [];
      if (items.length === 0) {
        state.diagnostics.push(
          createDiagnostic("motion-node-empty", "error", `Stagger node "${node.id}" has no items.`, { path }),
        );
      }
      const starts = staggerStartFrames(items, node.intervalFrames, node.direction, node.groupSpacingFrames);
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        if (item && item.node) {
          walkNode(state, item.node, `${path}.items[${index}].node`, startFrame + (starts[index] ?? 0), depth + 1);
        }
      }
      break;
    }

    default:
      break;
  }
}

/* ------------------------------------------------------------------ *
 * Timeline validation
 * ------------------------------------------------------------------ */

/**
 * Validate a motion timeline. Never throws; returns diagnostics in a
 * deterministic order (see {@link sortDiagnostics}). The input is never mutated
 * and is read defensively, so untrusted parsed JSON is safe to pass.
 */
export function validateTimeline(timeline: MotionTimeline): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const raw = timeline as unknown as Record<string, unknown>;

  if (raw.schemaVersion !== MOTION_SCHEMA_VERSION) {
    diagnostics.push(
      createDiagnostic(
        "motion-schema-version-unsupported",
        "error",
        `Unsupported schemaVersion ${String(raw.schemaVersion)}; this build reads ${MOTION_SCHEMA_VERSION}.`,
        { path: "schemaVersion" },
      ),
    );
  }

  if (typeof raw.id !== "string" || raw.id.trim() === "") {
    diagnostics.push(
      createDiagnostic("motion-id-invalid", "error", "Motion timeline id must be a non-empty string.", { path: "id" }),
    );
  }

  const fps = raw.fps as Partial<RationalFps> | undefined;
  if (
    !fps ||
    typeof fps !== "object" ||
    !Number.isInteger(fps.num) ||
    !Number.isInteger(fps.den) ||
    (fps.num as number) <= 0 ||
    (fps.den as number) <= 0
  ) {
    diagnostics.push(
      createDiagnostic("motion-fps-invalid", "error", "Timeline fps must be a positive rational with integer num/den.", {
        path: "fps",
      }),
    );
  }

  const durationValue = raw.durationFrames;
  const durationValid =
    typeof durationValue === "number" && Number.isInteger(durationValue) && durationValue >= 0;
  if (!durationValid) {
    diagnostics.push(
      createDiagnostic("motion-duration-invalid", "error", "Timeline durationFrames must be a non-negative integer.", {
        path: "durationFrames",
      }),
    );
  }
  const durationFrames = durationValid ? (durationValue as number) : 0;
  if (durationValid && durationFrames === 0) {
    diagnostics.push(
      createDiagnostic("motion-no-duration", "warning", "Timeline has zero duration; no authored frame is reachable.", {
        path: "durationFrames",
      }),
    );
  }

  const cues = Array.isArray(raw.cues) ? (raw.cues as MotionCue[]) : [];
  const cueFrames: Record<string, number> = {};
  const cueIds = new Set<string>();
  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index];
    const cuePath = `cues[${index}]`;
    const validId = !!cue && typeof cue.id === "string" && cue.id.trim() !== "";
    if (!validId) {
      diagnostics.push(
        createDiagnostic("motion-cue-invalid", "error", `Cue ${index} must have a non-empty id.`, { path: `${cuePath}.id` }),
      );
    }
    if (!cue || !Number.isInteger(cue.frame) || cue.frame < 0) {
      diagnostics.push(
        createDiagnostic(
          "motion-cue-invalid",
          "error",
          `Cue "${String(cue?.id)}" must have a non-negative integer frame.`,
          { path: `${cuePath}.frame` },
        ),
      );
    }
    if (validId) {
      if (cueIds.has(cue.id)) {
        diagnostics.push(
          createDiagnostic("motion-cue-duplicate", "error", `Cue "${cue.id}" is declared more than once.`, {
            path: `${cuePath}.id`,
          }),
        );
      } else {
        cueIds.add(cue.id);
        if (Number.isInteger(cue.frame) && cue.frame >= 0 && !Object.prototype.hasOwnProperty.call(cueFrames, cue.id)) {
          cueFrames[cue.id] = cue.frame;
        }
      }
    }
  }

  const nodes = Array.isArray(raw.nodes) ? (raw.nodes as MotionNode[]) : [];
  if (nodes.length === 0) {
    diagnostics.push(
      createDiagnostic("motion-node-missing", "error", "A motion timeline must contain at least one node.", {
        path: "nodes",
      }),
    );
  }

  const state: WalkState = {
    diagnostics,
    nodeIds: new Set(),
    tracks: [],
    referencedCues: new Set(),
    targetIds: new Set(),
    cueFrames,
    durationFrames,
  };
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    walkNode(state, node, `nodes[${index}]`, offsetToFrames(node?.offset, cueFrames), 0);
  }

  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index];
    if (cue && typeof cue.id === "string" && cue.id.trim() !== "" && !state.referencedCues.has(cue.id)) {
      diagnostics.push(
        createDiagnostic("motion-cue-unused", "warning", `Cue "${cue.id}" is declared but never referenced by a node offset.`, {
          frame: Number.isFinite(cue.frame) ? cue.frame : undefined,
          path: `cues[${index}]`,
        }),
      );
    }
  }

  const byKey = new Map<string, Array<{ track: AnimationTrack; path: string }>>();
  for (const entry of state.tracks) {
    const key = `${entry.track.targetId}.${entry.track.property}`;
    const group = byKey.get(key);
    if (group) group.push(entry);
    else byKey.set(key, [entry]);
  }
  for (const [key, group] of byKey) {
    if (group.length < 2) continue;
    const additive = group.some((entry) => entry.track.conflict === "additive");
    const priority = group.some((entry) => entry.track.conflict === "priority");
    if (!additive && !priority) {
      diagnostics.push(
        createDiagnostic(
          "motion-duplicate-writer",
          "error",
          `Multiple tracks write ${key} with no additive or priority conflict policy: ${group
            .map((entry) => entry.track.id)
            .join(", ")}.`,
          { path: `${group[0].path}.track` },
        ),
      );
    } else if (!additive && priority) {
      let max = Number.NEGATIVE_INFINITY;
      for (const entry of group) max = Math.max(max, entry.track.priority ?? 0);
      const top = group.filter((entry) => (entry.track.priority ?? 0) === max);
      if (top.length > 1) {
        diagnostics.push(
          createDiagnostic("motion-priority-tie", "warning", `Equal-priority writers for ${key}; the first wins.`, {
            path: `${group[0].path}.track`,
          }),
        );
      }
    }
  }

  const constraints = Array.isArray(raw.constraints) ? (raw.constraints as MotionConstraint[]) : [];
  for (let index = 0; index < constraints.length; index += 1) {
    const constraint = constraints[index];
    if (!constraint || typeof constraint !== "object") continue;
    const constraintPath = `constraints[${index}]`;
    if (typeof constraint.targetId !== "string" || !state.targetIds.has(constraint.targetId)) {
      diagnostics.push(
        createDiagnostic(
          "motion-constraint-target-missing",
          "error",
          `Constraint "${String((constraint as { id?: unknown }).id)}" targets "${String(constraint.targetId)}", which no track writes.`,
          { path: `${constraintPath}.targetId` },
        ),
      );
    }
    if (constraint.kind === "follow" && (typeof constraint.sourceId !== "string" || !state.targetIds.has(constraint.sourceId))) {
      diagnostics.push(
        createDiagnostic(
          "motion-constraint-target-missing",
          "error",
          `Follow constraint "${constraint.id}" sources "${String(constraint.sourceId)}", which no track writes.`,
          { path: `${constraintPath}.sourceId` },
        ),
      );
    }
    if (constraint.kind === "bounds") {
      const bounds = constraint.bounds;
      if (
        !bounds ||
        !Number.isFinite(bounds.width) ||
        !Number.isFinite(bounds.height) ||
        bounds.width <= 0 ||
        bounds.height <= 0
      ) {
        diagnostics.push(
          createDiagnostic(
            "motion-constraint-clamped",
            "warning",
            `Bounds constraint "${constraint.id}" has a degenerate rectangle; values will be clamped to a line or point.`,
            { path: `${constraintPath}.bounds` },
          ),
        );
      }
    }
  }

  const transforms = Array.isArray(raw.transforms) ? (raw.transforms as TransformNode[]) : [];
  const transformIds = new Set<string>();
  for (let index = 0; index < transforms.length; index += 1) {
    const node = transforms[index];
    if (!node || typeof node !== "object" || typeof node.id !== "string") continue;
    if (transformIds.has(node.id)) {
      diagnostics.push(
        createDiagnostic("motion-transform-duplicate-id", "error", `Duplicate transform node id "${node.id}".`, {
          path: `transforms[${index}].id`,
        }),
      );
    } else {
      transformIds.add(node.id);
    }
  }
  for (let index = 0; index < transforms.length; index += 1) {
    const node = transforms[index];
    if (!node || typeof node !== "object") continue;
    if (typeof node.parentId === "string" && !transformIds.has(node.parentId)) {
      diagnostics.push(
        createDiagnostic(
          "motion-transform-parent-missing",
          "error",
          `Transform node "${node.id}" references missing parent "${node.parentId}".`,
          { path: `transforms[${index}].parentId` },
        ),
      );
    }
  }
  for (const id of transformCycleIds(transforms)) {
    diagnostics.push(
      createDiagnostic("motion-transform-parent-cycle", "error", `Transform node "${id}" participates in a parent cycle.`, {
        path: "transforms",
      }),
    );
  }

  return sortDiagnostics(diagnostics);
}

/* ------------------------------------------------------------------ *
 * Document dispatch
 * ------------------------------------------------------------------ */

/**
 * Validate any motion document by shape: a timeline (has `nodes`) is validated
 * by {@link validateTimeline}, a storyboard (has `shots`) by
 * {@link validateStoryboard}, and anything else yields `motion-document-unknown`.
 * `ok` is true when there are no errors.
 */
export function validateMotionDocument(input: unknown): { diagnostics: Diagnostic[]; ok: boolean } {
  if (isMotionTimeline(input)) {
    const diagnostics = validateTimeline(input);
    return { diagnostics, ok: !hasBlockingDiagnostics(diagnostics) };
  }
  if (looksLikeStoryboard(input)) {
    const diagnostics = validateStoryboard(input);
    return { diagnostics, ok: !hasBlockingDiagnostics(diagnostics) };
  }
  return {
    diagnostics: [
      createDiagnostic(
        "motion-document-unknown",
        "error",
        "Value is neither a motion timeline (nodes) nor a storyboard (shots).",
      ),
    ],
    ok: false,
  };
}
