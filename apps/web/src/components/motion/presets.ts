/**
 * Motion — constructive presets (docs/08 §3).
 *
 * A preset is a small piece of *library code* (`build`) that expands a compact,
 * serializable description (`PresetInstance`) into concrete {@link MotionNode}s.
 * What a consumer serializes is only the data record:
 *
 *     { preset, version?, targetId, property?, startFrame, timing?, intensity?, params? }
 *
 * never a function, so a motion document round-trips through JSON (docs/08 §1).
 *
 * Semantics
 * - `timing` is the number of frames the preset occupies (resolved by
 *   {@link resolveTiming}; default `preset.defaults.durationFrames`).
 * - `intensity` in `[0, 1]` scales *amplitude only* — travel distance, overshoot,
 *   scale delta — and never duration. Values outside the range are clamped
 *   silently by {@link resolveIntensity} (no diagnostic: clamping is a documented
 *   normalisation, not an authoring error).
 * - Parameters declared by a preset are clamped to their declared `[min, max]`
 *   when a caller supplies an out-of-range value; an unknown key emits the
 *   warning `preset-param-unknown`.
 *
 * Determinism
 * Presets never depend on the `motion` package (a browser player) or on any
 * playback state. Everything is a pure function of the arguments. Where a spring
 * reads better (scale overshoot) the response is pre-sampled at every integer
 * frame from the kernel's analytic `springs.springValue` — a closed-form,
 * order-independent function — and baked into a dense `keyframes` array. There is
 * no wall clock and no randomness anywhere in this module.
 */

import type {
  AnimationTrack,
  Diagnostic,
  EasingSpec,
  Keyframe,
  MotionNode,
  MotionValueType,
  RationalFps,
  TrackNode,
  Vec2,
} from "./types";
import { DEFAULT_FPS, fpsRatio } from "./constants";
import { createDiagnostic } from "./diagnostics";
import { evaluateEasing } from "./easing";
import { scaleMatrix } from "./matrix";
import { SPRING_PRESETS, springValue } from "./springs";

/* ------------------------------------------------------------------ *
 * Public types
 * ------------------------------------------------------------------ */

/** The authoring intent a preset serves. Purely descriptive. */
export type MotionRole = "reveal" | "emphasis" | "exit" | "handoff" | "kinetic";

/** A tunable numeric knob a preset declares. */
export interface MotionPresetParam {
  name: string;
  default: number;
  min?: number;
  max?: number;
  unit?: "frames" | "seconds" | "ratio" | "px" | "deg";
}

/** Fully-resolved arguments handed to {@link MotionPreset.build}. */
export interface PresetBuildArgs {
  targetId: string;
  property?: string;
  startFrame: number;
  timing: number;
  intensity: number;
  params: Record<string, number>;
  fps: RationalFps;
}

/** A constructive preset definition. */
export interface MotionPreset {
  name: string;
  version: number;
  role: MotionRole;
  description: string;
  params: MotionPresetParam[];
  defaults: Record<string, number>;
  build: (args: PresetBuildArgs) => MotionNode[];
}

/** The serializable description of one preset application. */
export interface PresetInstance {
  preset: string;
  version?: number;
  targetId: string;
  property?: string;
  startFrame: number;
  timing?: number;
  intensity?: number;
  params?: Record<string, number>;
}

/* ------------------------------------------------------------------ *
 * Internal helpers
 * ------------------------------------------------------------------ */

/** Defaults derived from the declared params (always includes `durationFrames`). */
function makeDefaults(params: MotionPresetParam[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const param of params) out[param.name] = param.default;
  return out;
}

/** Define a preset, deriving `defaults` from its declared params. */
function definePreset(def: Omit<MotionPreset, "defaults">): MotionPreset {
  return { ...def, defaults: makeDefaults(def.params) };
}

/** A single-leaf track node, offset to `startFrame`. */
function makeTrack(args: {
  id: string;
  targetId: string;
  property: string;
  valueType: MotionValueType;
  keyframes: Keyframe[];
  easing?: EasingSpec;
  startFrame: number;
}): TrackNode {
  const track: AnimationTrack = {
    id: args.id,
    targetId: args.targetId,
    property: args.property,
    valueType: args.valueType,
    keyframes: args.keyframes,
  };
  if (args.easing !== undefined) track.easing = args.easing;
  return { kind: "track", id: args.id, offset: args.startFrame, track };
}

/**
 * Pre-compute an eased progress curve sampled at every integer frame, using the
 * kernel's `evaluateEasing`. Sharing one array between paired tracks guarantees
 * they advance in exact lockstep. `timing <= 0` collapses to the end value.
 */
function easedProgress(timing: number, easing: EasingSpec): number[] {
  const frames = Math.max(0, Math.trunc(timing));
  const out: number[] = [];
  for (let f = 0; f <= frames; f += 1) {
    out.push(evaluateEasing(easing, frames === 0 ? 1 : f / frames));
  }
  return out;
}

/** Linear interpolation of a scalar slice; used by dense builders. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Dense transform-scale keyframes for `scale-pop`.
 *
 * The shape is the kernel's analytic spring unit-step (`springs.springValue`,
 * "snappy") sampled at every integer frame. The amount by which the natural
 * curve exceeds `1` is rescaled so the transform's peak overshoot equals the
 * `overshoot` param scaled by `intensity`; the start (`0.6`) and end (`1`) are
 * pinned exactly. `intensity === 0` therefore yields a monotonic pop with no
 * overshoot, and `intensity === 1` a peak of `1 + overshoot`.
 */
function scalePopKeyframes(
  timing: number,
  fps: RationalFps,
  overshoot: number,
  intensity: number,
): Keyframe[] {
  const from = 0.6;
  const frames = Math.max(1, Math.trunc(timing));
  const rate = fpsRatio(fps);
  const springParams = SPRING_PRESETS.snappy.params;

  const base: number[] = [];
  for (let f = 0; f <= frames; f += 1) {
    const s = f === frames ? 1 : f === 0 ? 0 : springValue(f / rate, springParams);
    base.push(lerp(from, 1, s));
  }
  base[0] = from;
  base[frames] = 1;

  let naturalExcess = 0;
  for (const value of base) {
    if (value - 1 > naturalExcess) naturalExcess = value - 1;
  }
  const desiredExcess = Math.max(0, overshoot * intensity);
  const factor = naturalExcess > 1e-9 ? desiredExcess / naturalExcess : 0;

  const keyframes: Keyframe[] = [];
  for (let f = 0; f <= frames; f += 1) {
    let scale = base[f];
    if (scale > 1) scale = 1 + (scale - 1) * factor;
    if (f === 0) scale = from;
    if (f === frames) scale = 1;
    keyframes.push({ frame: f, value: scaleMatrix(scale, scale) });
  }
  return keyframes;
}

const DURATION_PARAM: MotionPresetParam = {
  name: "durationFrames",
  default: 18,
  min: 1,
  max: 600,
  unit: "frames",
};

function durationParam(defaultFrames: number): MotionPresetParam {
  return { ...DURATION_PARAM, default: defaultFrames };
}

/* ------------------------------------------------------------------ *
 * Preset definitions
 * ------------------------------------------------------------------ */

export const MOTION_PRESETS: Record<string, MotionPreset> = {
  "fade-reveal": definePreset({
    name: "fade-reveal",
    version: 1,
    role: "reveal",
    description: "Fade a target in from fully transparent to opaque.",
    params: [durationParam(18)],
    build: ({ targetId, property, startFrame, timing }) => [
      makeTrack({
        id: `${targetId}-fade-reveal`,
        targetId,
        property: property ?? "opacity",
        valueType: "opacity",
        keyframes: [
          { frame: 0, value: 0 },
          { frame: timing, value: 1, easing: "ease-out-cubic" },
        ],
        startFrame,
      }),
    ],
  }),

  "rise-reveal": definePreset({
    name: "rise-reveal",
    version: 1,
    role: "reveal",
    description: "Rise a target into place along Y while fading it in.",
    params: [
      durationParam(18),
      { name: "distance", default: 24, min: 0, max: 400, unit: "px" },
    ],
    build: ({ targetId, property, startFrame, timing, intensity, params }) => {
      const distance = (params.distance ?? 24) * intensity;
      const progress = easedProgress(timing, "ease-out-cubic");
      const position: Keyframe[] = progress.map((p, f) => ({
        frame: f,
        value: { x: 0, y: distance * (1 - p) } as Vec2,
      }));
      const opacity: Keyframe[] = progress.map((p, f) => ({ frame: f, value: p }));
      return [
        makeTrack({
          id: `${targetId}-rise-reveal-position`,
          targetId,
          property: property ?? "position",
          valueType: "vec2",
          keyframes: position,
          startFrame,
        }),
        makeTrack({
          id: `${targetId}-rise-reveal-opacity`,
          targetId,
          property: "opacity",
          valueType: "opacity",
          keyframes: opacity,
          startFrame,
        }),
      ];
    },
  }),

  "scale-pop": definePreset({
    name: "scale-pop",
    version: 1,
    role: "emphasis",
    description: "Pop a target in from a smaller scale with a controlled overshoot.",
    params: [
      durationParam(18),
      { name: "overshoot", default: 0.08, min: 0, max: 1, unit: "ratio" },
    ],
    build: ({ targetId, property, startFrame, timing, intensity, params, fps }) => [
      makeTrack({
        id: `${targetId}-scale-pop`,
        targetId,
        property: property ?? "transform",
        valueType: "transform",
        keyframes: scalePopKeyframes(timing, fps, params.overshoot ?? 0.08, intensity),
        startFrame,
      }),
    ],
  }),

  "slide-exit": definePreset({
    name: "slide-exit",
    version: 1,
    role: "exit",
    description: "Slide a target off along X while fading it out.",
    params: [
      durationParam(16),
      { name: "distance", default: 48, min: 0, max: 800, unit: "px" },
    ],
    build: ({ targetId, property, startFrame, timing, intensity, params }) => {
      const distance = (params.distance ?? 48) * intensity;
      return [
        makeTrack({
          id: `${targetId}-slide-exit-position`,
          targetId,
          property: property ?? "position",
          valueType: "vec2",
          keyframes: [
            { frame: 0, value: { x: 0, y: 0 } as Vec2 },
            { frame: timing, value: { x: -distance, y: 0 } as Vec2, easing: "ease-in-cubic" },
          ],
          startFrame,
        }),
        makeTrack({
          id: `${targetId}-slide-exit-opacity`,
          targetId,
          property: "opacity",
          valueType: "opacity",
          keyframes: [
            { frame: 0, value: 1 },
            { frame: timing, value: 0, easing: "ease-in-cubic" },
          ],
          startFrame,
        }),
      ];
    },
  }),

  "wipe-reveal": definePreset({
    name: "wipe-reveal",
    version: 1,
    role: "reveal",
    description: "Drive a normalized 0→1 reveal length consumed by a mask or trim.",
    params: [durationParam(24)],
    build: ({ targetId, property, startFrame, timing }) => [
      makeTrack({
        id: `${targetId}-wipe-reveal`,
        targetId,
        property: property ?? "revealLength",
        valueType: "length",
        keyframes: [
          { frame: 0, value: 0 },
          { frame: timing, value: 1, easing: "ease-out-cubic" },
        ],
        startFrame,
      }),
    ],
  }),

  "track-in": definePreset({
    name: "track-in",
    version: 1,
    role: "kinetic",
    description: "Tighten letter-spacing from an open value down to zero.",
    params: [
      durationParam(20),
      { name: "spacing", default: 8, min: 0, max: 100, unit: "px" },
    ],
    build: ({ targetId, property, startFrame, timing, intensity, params }) => {
      const spacing = (params.spacing ?? 8) * intensity;
      return [
        makeTrack({
          id: `${targetId}-track-in`,
          targetId,
          property: property ?? "letterSpacing",
          valueType: "number",
          keyframes: [
            { frame: 0, value: spacing },
            { frame: timing, value: 0, easing: "ease-out-cubic" },
          ],
          startFrame,
        }),
      ];
    },
  }),

  "handoff-swap": definePreset({
    name: "handoff-swap",
    version: 1,
    role: "handoff",
    description: "Cross-fade a target out and back in across the full span.",
    params: [durationParam(14)],
    build: ({ targetId, property, startFrame, timing }) => {
      const keyframes: Keyframe[] = [{ frame: 0, value: 1 }];
      if (timing >= 2) {
        const mid = Math.min(timing - 1, Math.max(1, Math.round(timing / 2)));
        keyframes.push({ frame: mid, value: 0, easing: "ease-in-out-cubic" });
      }
      if (timing >= 1) {
        keyframes.push({ frame: timing, value: 1, easing: "ease-in-out-cubic" });
      }
      return [
        makeTrack({
          id: `${targetId}-handoff-swap`,
          targetId,
          property: property ?? "opacity",
          valueType: "opacity",
          keyframes,
          startFrame,
        }),
      ];
    },
  }),
};

/* ------------------------------------------------------------------ *
 * Resolution API
 * ------------------------------------------------------------------ */

/**
 * Look a preset up by name. When `version` is supplied it must match exactly,
 * otherwise `null` is returned (so a caller can fall back deliberately rather
 * than silently running a different revision).
 */
export function getPreset(name: string, version?: number): MotionPreset | null {
  const preset = MOTION_PRESETS[name];
  if (!preset) return null;
  if (version !== undefined && version !== preset.version) return null;
  return preset;
}

/** A stable, serializable catalogue of every registered preset. */
export function listPresets(): Array<{
  name: string;
  version: number;
  role: MotionRole;
  description: string;
  params: MotionPresetParam[];
}> {
  return Object.values(MOTION_PRESETS).map((preset) => ({
    name: preset.name,
    version: preset.version,
    role: preset.role,
    description: preset.description,
    params: preset.params.map((param) => ({ ...param })),
  }));
}

/** A fresh copy of a preset's defaults (callers may mutate the result safely). */
export function presetDefaults(preset: MotionPreset): Record<string, number> {
  return { ...preset.defaults };
}

/**
 * Resolve a preset's timing (frame span). A finite caller value is rounded to an
 * integer and floored at `1`; otherwise `preset.defaults.durationFrames` is used.
 */
export function resolveTiming(value: number | undefined, preset: MotionPreset): number {
  if (value !== undefined && Number.isFinite(value)) {
    return Math.max(1, Math.round(value));
  }
  const fallback = preset.defaults.durationFrames;
  return Number.isFinite(fallback) ? Math.max(1, Math.round(fallback)) : 1;
}

/**
 * Resolve an intensity to `[0, 1]`, defaulting to `1`. Out-of-range and
 * non-finite inputs are clamped silently; no diagnostic is emitted.
 */
export function resolveIntensity(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function clampParam(value: number, param: MotionPresetParam): number {
  let result = value;
  if (param.min !== undefined) result = Math.max(result, param.min);
  if (param.max !== undefined) result = Math.min(result, param.max);
  return result;
}

function resolveParams(
  preset: MotionPreset,
  provided: Record<string, number> | undefined,
): { params: Record<string, number>; unknown: string[] } {
  const params = presetDefaults(preset);
  const declared = new Map(preset.params.map((param) => [param.name, param]));
  const unknown: string[] = [];
  if (provided) {
    for (const key of Object.keys(provided)) {
      const param = declared.get(key);
      const value = provided[key];
      if (!param) {
        unknown.push(key);
        continue;
      }
      if (Number.isFinite(value)) params[key] = clampParam(value, param);
    }
  }
  return { params, unknown };
}

/**
 * Expand a serializable {@link PresetInstance} into concrete nodes.
 *
 * Diagnostics
 * - `preset-unknown` (error): the name is not registered — returns no nodes.
 * - `preset-version-mismatch` (warning): a requested version differs from the
 *   registered one; the registered revision is built.
 * - `preset-param-unknown` (warning): a supplied param key the preset does not
 *   declare; the key is ignored.
 * - `preset-target-missing` (error): no `targetId` — returns no nodes.
 *
 * The target's scene fps is not carried by a `PresetInstance`, so spring-shaped
 * presets are sampled at {@link DEFAULT_FPS}; this is deterministic and
 * independent of any playback state.
 */
export function materializePreset(
  instance: PresetInstance,
  registry: Record<string, MotionPreset> = MOTION_PRESETS,
): { nodes: MotionNode[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];

  const preset = registry[instance.preset];
  if (!preset) {
    diagnostics.push(
      createDiagnostic(
        "preset-unknown",
        "error",
        `Unknown motion preset "${instance.preset}".`,
      ),
    );
    return { nodes: [], diagnostics };
  }

  if (instance.version !== undefined && instance.version !== preset.version) {
    diagnostics.push(
      createDiagnostic(
        "preset-version-mismatch",
        "warning",
        `Preset "${instance.preset}" was requested at version ${instance.version} but version ${preset.version} is registered.`,
      ),
    );
  }

  if (!instance.targetId) {
    diagnostics.push(
      createDiagnostic(
        "preset-target-missing",
        "error",
        `Preset "${instance.preset}" requires a targetId.`,
      ),
    );
    return { nodes: [], diagnostics };
  }

  const { params, unknown } = resolveParams(preset, instance.params);
  for (const key of unknown) {
    diagnostics.push(
      createDiagnostic(
        "preset-param-unknown",
        "warning",
        `Preset "${instance.preset}" has no parameter "${key}"; it was ignored.`,
      ),
    );
  }

  const timing = resolveTiming(instance.timing ?? instance.params?.durationFrames, preset);
  const intensity = resolveIntensity(instance.intensity);

  const nodes = preset.build({
    targetId: instance.targetId,
    property: instance.property,
    startFrame: instance.startFrame,
    timing,
    intensity,
    params,
    fps: DEFAULT_FPS,
  });

  return { nodes, diagnostics };
}
