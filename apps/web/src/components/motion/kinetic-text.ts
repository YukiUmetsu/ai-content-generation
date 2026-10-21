/**
 * Kinetic text — deterministic per-token text animation (docs/08 §3).
 *
 * The layer is renderer-neutral: a spec is segmented into tokens, one target is
 * created per token, each token is animated by a preset and the whole run is
 * placed inside a single `stagger` node. The result is a plain
 * {@link MotionTimeline} that any renderer can evaluate.
 *
 * Determinism and purity
 * `segmentText` and `buildKineticTextTimeline` are pure: the same spec always
 * yields an identical timeline. There is no wall clock, no randomness and no
 * dependency on the `motion` package or on playback state.
 *
 * Grapheme segmentation uses the platform `Intl.Segmenter` when present. When a
 * runtime lacks it, a documented approximation is used that never splits inside
 * a grapheme cluster: a code-point scan groups each base code point with any
 * following combining marks, variation selectors, emoji modifiers and ZWJ-joined
 * continuations. `line` always splits on `\n` only.
 */

import type {
  Diagnostic,
  MotionNode,
  MotionTimeline,
  RationalFps,
  StaggerDirection,
  StaggerItem,
  StaggerNode,
} from "./types";
import { DEFAULT_FPS } from "./constants";
import { createDiagnostic } from "./diagnostics";
import { MOTION_PRESETS, materializePreset, resolveIntensity, resolveTiming } from "./presets";
import type { MotionPreset } from "./presets";

/* ------------------------------------------------------------------ *
 * Public types
 * ------------------------------------------------------------------ */

export type KineticGranularity = "grapheme" | "word" | "line";

export interface KineticTextSpec {
  id: string;
  text: string;
  granularity?: KineticGranularity;
  startFrame: number;
  durationFrames: number;
  fps?: RationalFps;
  stagger?: number;
  direction?: StaggerDirection;
  preset?: string;
  intensity?: number;
  timing?: number;
  distance?: number;
  gap?: number;
}

/* ------------------------------------------------------------------ *
 * Segmentation
 * ------------------------------------------------------------------ */

interface SegmentPart {
  segment: string;
  isWordLike?: boolean;
}

interface SegmenterLike {
  segment(input: string): Iterable<SegmentPart>;
}

type SegmenterCtor = new (
  locales?: string | string[],
  options?: { granularity: "grapheme" | "word" },
) => SegmenterLike;

/** The platform `Intl.Segmenter` constructor, or `null` when unavailable. */
function getSegmenterCtor(): SegmenterCtor | null {
  const ctor = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
  return typeof ctor === "function" ? ctor : null;
}

function trySegmentWithIntl(
  text: string,
  granularity: "grapheme" | "word",
): string[] | null {
  const ctor = getSegmenterCtor();
  if (!ctor) return null;
  try {
    const segmenter = new ctor(undefined, { granularity });
    const out: string[] = [];
    for (const part of segmenter.segment(text)) {
      if (granularity === "word") {
        if (part.isWordLike) out.push(part.segment);
      } else {
        out.push(part.segment);
      }
    }
    return out;
  } catch {
    return null;
  }
}

const COMBINING = /^\p{M}$/u;
const EMOJI_MODIFIER = /^\p{Emoji_Modifier}$/u;
const ZWJ = "\u200D";

function isCombining(codePoint: string): boolean {
  return COMBINING.test(codePoint);
}

function isEmojiModifier(codePoint: string): boolean {
  return EMOJI_MODIFIER.test(codePoint);
}

function isVariationSelector(codePoint: string): boolean {
  return codePoint === "\uFE0E" || codePoint === "\uFE0F";
}

/** True for a code point that extends the current grapheme cluster. */
function isExtender(codePoint: string): boolean {
  return isCombining(codePoint) || isEmojiModifier(codePoint) || isVariationSelector(codePoint);
}

/**
 * Combining-mark-aware fallback grapheme segmentation. Code points are iterated
 * with `Array.from` (so surrogate pairs stay intact) and never split inside a
 * cluster: a base code point absorbs trailing extenders and every ZWJ-joined
 * continuation.
 */
function fallbackGraphemes(text: string): string[] {
  const codePoints = Array.from(text);
  const out: string[] = [];
  let i = 0;
  while (i < codePoints.length) {
    let cluster = codePoints[i];
    i += 1;
    while (i < codePoints.length && isExtender(codePoints[i])) {
      cluster += codePoints[i];
      i += 1;
    }
    while (i < codePoints.length && codePoints[i] === ZWJ && i + 1 < codePoints.length) {
      cluster += codePoints[i];
      i += 1;
      cluster += codePoints[i];
      i += 1;
      while (i < codePoints.length && isExtender(codePoints[i])) {
        cluster += codePoints[i];
        i += 1;
      }
    }
    out.push(cluster);
  }
  return out;
}

const WORD_RUN = /[\p{L}\p{N}\p{M}]+(?:['’-][\p{L}\p{N}\p{M}]+)*/gu;

/** Fallback word segmentation: maximal word-like runs, whitespace discarded. */
function fallbackWords(text: string): string[] {
  const matches = text.match(WORD_RUN);
  return matches ? [...matches] : [];
}

/**
 * Segment `text` at the requested granularity.
 *
 * - `grapheme`: every grapheme cluster, including spaces.
 * - `word`: word-like tokens only (whitespace and punctuation discarded), so a
 *   run animates words rather than the gaps between them.
 * - `line`: `text.split("\n")` exactly — no other newline handling.
 */
export function segmentText(text: string, granularity: KineticGranularity): string[] {
  if (granularity === "line") return text.split("\n");
  const viaIntl = trySegmentWithIntl(text, granularity);
  if (viaIntl !== null) return viaIntl;
  return granularity === "word" ? fallbackWords(text) : fallbackGraphemes(text);
}

/* ------------------------------------------------------------------ *
 * Token identity
 * ------------------------------------------------------------------ */

/** Stable target id for the token at `index` of spec `specId`. */
export function glyphTargetId(specId: string, index: number): string {
  return `${specId}-glyph-${index}`;
}

/** Target ids for a run of `count` tokens (empty when `count <= 0`). */
export function glyphRunIds(specId: string, count: number): string[] {
  const size = Math.max(0, Math.trunc(count));
  const out: string[] = [];
  for (let i = 0; i < size; i += 1) out.push(glyphTargetId(specId, i));
  return out;
}

/* ------------------------------------------------------------------ *
 * Timeline construction
 * ------------------------------------------------------------------ */

/**
 * Build a deterministic kinetic-text timeline.
 *
 * One target per token (`glyphTargetId`) is animated by the spec's `preset`
 * (default `"rise-reveal"`); every glyph track lives inside a single `stagger`
 * node whose `intervalFrames` is `spec.stagger` (default `2`) and whose
 * direction is `spec.direction` (default `"forward"`). The stagger node is
 * offset to `spec.startFrame`.
 *
 * Diagnostics
 * - `kinetic-text-empty` (error): the text segments to zero tokens.
 * - `kinetic-text-stagger-clamped` (warning): a negative stagger was clamped to
 *   `0`.
 * - `kinetic-text-overrun` (error): `startFrame + timing + stagger·(count-1)`
 *   exceeds `durationFrames`.
 * - plus any diagnostic surfaced by {@link materializePreset} (e.g.
 *   `preset-unknown`).
 */
export function buildKineticTextTimeline(
  spec: KineticTextSpec,
  registry: Record<string, MotionPreset> = MOTION_PRESETS,
): {
  timeline: MotionTimeline;
  glyphIds: string[];
  tokens: string[];
  diagnostics: Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [];
  const granularity = spec.granularity ?? "grapheme";
  const tokens = segmentText(spec.text, granularity);
  const fps = spec.fps ?? DEFAULT_FPS;
  const presetName = spec.preset ?? "rise-reveal";
  const preset = registry[presetName];
  const glyphIds = glyphRunIds(spec.id, tokens.length);

  if (tokens.length === 0) {
    diagnostics.push(
      createDiagnostic(
        "kinetic-text-empty",
        "error",
        `Kinetic text "${spec.id}" segments to zero tokens.`,
      ),
    );
  }

  let stagger = spec.stagger ?? 2;
  if (stagger < 0) {
    diagnostics.push(
      createDiagnostic(
        "kinetic-text-stagger-clamped",
        "warning",
        `Kinetic text "${spec.id}" stagger ${spec.stagger} was clamped to 0.`,
      ),
    );
    stagger = 0;
  }
  if (!Number.isFinite(stagger)) stagger = 0;

  const direction: StaggerDirection = spec.direction ?? "forward";
  const intensity = resolveIntensity(spec.intensity);
  const timing = preset
    ? resolveTiming(spec.timing, preset)
    : Number.isFinite(spec.timing)
      ? Math.max(1, Math.round(spec.timing as number))
      : (MOTION_PRESETS["rise-reveal"].defaults.durationFrames ?? 18);

  // Map spec-level knobs onto the target preset's declared params only, so the
  // kinetic layer never manufactures `preset-param-unknown` noise.
  const params: Record<string, number> = {};
  if (preset) {
    const declared = new Set(preset.params.map((param) => param.name));
    if (spec.distance !== undefined && declared.has("distance")) params.distance = spec.distance;
    if (spec.gap !== undefined && declared.has("spacing")) params.spacing = spec.gap;
  }

  const items: StaggerItem[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const targetId = glyphTargetId(spec.id, i);
    const materialized = materializePreset(
      {
        preset: presetName,
        targetId,
        startFrame: 0,
        timing,
        intensity,
        params,
      },
      registry,
    );
    diagnostics.push(...materialized.diagnostics);
    const node: MotionNode = {
      kind: "parallel",
      id: `${targetId}-preset`,
      children: materialized.nodes,
    };
    items.push({ id: targetId, node });
  }

  const nodes: MotionNode[] = [];
  if (tokens.length > 0) {
    const glyphNode: StaggerNode = {
      kind: "stagger",
      id: `${spec.id}-glyphs`,
      intervalFrames: stagger,
      direction,
      items,
      offset: spec.startFrame,
    };
    nodes.push(glyphNode);

    const span = spec.startFrame + timing + stagger * (tokens.length - 1);
    if (span > spec.durationFrames) {
      diagnostics.push(
        createDiagnostic(
          "kinetic-text-overrun",
          "error",
          `Kinetic text "${spec.id}" ends at frame ${span}, beyond durationFrames ${spec.durationFrames}.`,
          { frame: spec.durationFrames },
        ),
      );
    }
  }

  const timeline: MotionTimeline = {
    schemaVersion: 1,
    id: spec.id,
    fps,
    durationFrames: spec.durationFrames,
    nodes,
  };

  return { timeline, glyphIds, tokens, diagnostics };
}
