/**
 * `shared-element` — semantic identity carried across a representation change
 * (docs/08 §3 `shared-element`: "Semantic identity, source/target transform,
 * handoff"; explicit two-shot visibility, continuity, collision policy).
 *
 * `semanticId` is the durable identity (docs/08 §1.3): the *instance* may be
 * re-authored across a cut, but the semantic id is what makes the change read
 * as one continuous element.
 *
 * Phases are deterministic and frame-based:
 * - `before` — the `from` transform owns the element.
 * - `handoff` — the transform interpolates `from → to` with an eased progress.
 * - `after` — the `to` transform owns the element.
 *
 * Continuity is exact at the boundaries: at the first handoff frame the eased
 * progress is `0` (equal to `from`) and the first post-handoff frame is exactly
 * `to`.
 */

import { isFrameInRange } from "./constants";
import { createDiagnostic } from "./diagnostics";
import { evaluateEasing } from "./easing";
import { interpolateMatrix, lerpNumber } from "./matrix";
import type { AffineMatrix, Diagnostic, EasingSpec, FrameRange } from "./types";

/** One side of a handoff: a transform, an optional opacity and its own range. */
export interface SharedElementEndpoint {
  transform: AffineMatrix;
  opacity?: number;
  range: FrameRange;
}

/** Collision policy when `from` and `to` are both on screen during handoff. */
export type SharedElementCollision = "cross-fade" | "cut" | "hold-old";

/** Durable identity plus the two authoritative representations. */
export interface SharedElementSpec {
  semanticId: string;
  from: SharedElementEndpoint;
  to: SharedElementEndpoint;
  handoff: FrameRange;
  /** Default `"cross-fade"`. */
  collision?: SharedElementCollision;
}

export type SharedElementPhase = "before" | "handoff" | "after";

/** Resolved shared-element state at one frame. */
export interface SharedElementSample {
  semanticId: string;
  phase: SharedElementPhase;
  transform: AffineMatrix;
  opacity: number;
  /** Which representation is authoritative for this sample's value. */
  owner: "from" | "to" | "handoff";
  frame: number;
}

/** Handoff shaping. `ease-in-out` keeps the swap from reading as a linear slide. */
const HANDOFF_EASING: EasingSpec = "ease-in-out";

function copyMatrix(m: AffineMatrix): AffineMatrix {
  return { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f };
}

function rangeLength(range: FrameRange): number {
  return range.endFrame - range.startFrame;
}

/** `true` when two ranges share at least one frame. */
function rangesOverlap(a: FrameRange, b: FrameRange): boolean {
  return a.startFrame < b.endFrame && b.startFrame < a.endFrame;
}

/** `true` when `inner` lies entirely within `outer`. */
function rangeContains(outer: FrameRange, inner: FrameRange): boolean {
  return inner.startFrame >= outer.startFrame && inner.endFrame <= outer.endFrame;
}

/**
 * Create a shared-element spec, copying both endpoints so later caller mutation
 * cannot change an in-flight handoff.
 */
export function createSharedElement(props: {
  semanticId: string;
  from: SharedElementEndpoint;
  to: SharedElementEndpoint;
  handoff: FrameRange;
  collision?: SharedElementCollision;
}): SharedElementSpec {
  const spec: SharedElementSpec = {
    semanticId: props.semanticId,
    from: {
      transform: copyMatrix(props.from.transform),
      range: { ...props.from.range },
    },
    to: {
      transform: copyMatrix(props.to.transform),
      range: { ...props.to.range },
    },
    handoff: { ...props.handoff },
  };
  if (props.from.opacity !== undefined) spec.from.opacity = props.from.opacity;
  if (props.to.opacity !== undefined) spec.to.opacity = props.to.opacity;
  if (props.collision !== undefined) spec.collision = props.collision;
  return spec;
}

/**
 * Validate a shared-element spec.
 *
 * Errors: `shared-element-id-missing`, `shared-element-range-invalid`.
 * Warnings: `shared-element-range-overlap` (from/to overlap outside the
 * handoff), `shared-element-handoff-empty`.
 */
export function validateSharedElement(spec: SharedElementSpec): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (typeof spec.semanticId !== "string" || spec.semanticId.trim().length === 0) {
    diagnostics.push(
      createDiagnostic("shared-element-id-missing", "error", "Shared element has no semanticId; continuity cannot be tracked."),
    );
  }

  const rangesValid = rangeLength(spec.from.range) > 0 && rangeLength(spec.to.range) > 0;
  if (!rangesValid) {
    diagnostics.push(
      createDiagnostic(
        "shared-element-range-invalid",
        "error",
        "from/to ranges must be non-empty (endFrame > startFrame).",
      ),
    );
  }

  if (rangeLength(spec.handoff) <= 0) {
    diagnostics.push(
      createDiagnostic("shared-element-handoff-empty", "warning", "Handoff range is empty; the element will jump at the cut."),
    );
  } else if (rangesValid && rangesOverlap(spec.from.range, spec.to.range)) {
    const overlap: FrameRange = {
      startFrame: Math.max(spec.from.range.startFrame, spec.to.range.startFrame),
      endFrame: Math.min(spec.from.range.endFrame, spec.to.range.endFrame),
    };
    if (!rangeContains(spec.handoff, overlap)) {
      diagnostics.push(
        createDiagnostic(
          "shared-element-range-overlap",
          "warning",
          "from and to ranges overlap outside the handoff window; both representations are visible at once.",
        ),
      );
    }
  }

  return diagnostics;
}

/**
 * Evaluate the spec at `frame`. Deterministic: phase comes from the handoff
 * range, progress from frame arithmetic, opacity from the owning side.
 *
 * Collision policies:
 * - `"cross-fade"` (default) — opacity lerps between both sides across the handoff.
 * - `"cut"` — jumps to `to` at the handoff midpoint, no interpolation.
 * - `"hold-old"` — keeps the `from` opacity for the whole handoff.
 */
export function evaluateSharedElement(spec: SharedElementSpec, frame: number): SharedElementSample {
  const { handoff } = spec;
  const collision = spec.collision ?? "cross-fade";
  const fromOpacity = spec.from.opacity ?? 1;
  const toOpacity = spec.to.opacity ?? 1;

  if (frame < handoff.startFrame) {
    return {
      semanticId: spec.semanticId,
      phase: "before",
      transform: copyMatrix(spec.from.transform),
      opacity: fromOpacity,
      owner: "from",
      frame,
    };
  }

  if (frame >= handoff.endFrame) {
    return {
      semanticId: spec.semanticId,
      phase: "after",
      transform: copyMatrix(spec.to.transform),
      opacity: toOpacity,
      owner: "to",
      frame,
    };
  }

  // Inside the handoff window.
  const span = handoff.endFrame - handoff.startFrame;
  const raw = span > 0 ? (frame - handoff.startFrame) / span : 0;
  const eased = evaluateEasing(HANDOFF_EASING, raw);

  if (collision === "cut") {
    const midpoint = (handoff.startFrame + handoff.endFrame) / 2;
    const useTo = frame >= midpoint;
    return {
      semanticId: spec.semanticId,
      phase: "handoff",
      transform: copyMatrix(useTo ? spec.to.transform : spec.from.transform),
      opacity: useTo ? toOpacity : fromOpacity,
      owner: useTo ? "to" : "from",
      frame,
    };
  }

  const transform = interpolateMatrix(spec.from.transform, spec.to.transform, eased);
  const opacity = collision === "hold-old" ? fromOpacity : lerpNumber(fromOpacity, toOpacity, eased);
  return {
    semanticId: spec.semanticId,
    phase: "handoff",
    transform,
    opacity,
    owner: "handoff",
    frame,
  };
}

/**
 * Specs actively in handoff at `frame`, sorted by `semanticId`. Sorting uses a
 * plain code-unit comparison (never `localeCompare`) so ordering is identical
 * across environments.
 */
export function sharedElementContacts(frame: number, specs: SharedElementSpec[]): SharedElementSample[] {
  const contacts: SharedElementSample[] = [];
  for (const spec of specs) {
    if (!isFrameInRange(frame, spec.handoff)) continue;
    const sample = evaluateSharedElement(spec, frame);
    if (sample.phase === "handoff") contacts.push(sample);
  }
  contacts.sort((a, b) => (a.semanticId < b.semanticId ? -1 : a.semanticId > b.semanticId ? 1 : 0));
  return contacts;
}
