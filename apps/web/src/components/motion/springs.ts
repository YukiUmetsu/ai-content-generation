/**
 * Motion core — analytic spring response (docs/08 §2).
 *
 * `springValue` is a closed-form unit-step response: the value is exactly `0` at
 * `t = 0` and approaches `1` as `t` grows. The optional `velocity` is the initial
 * rate of change (units per second) of the unit-step, so it never perturbs the
 * value at `t = 0` — only the shape afterwards.
 *
 * All three damping regimes are handled analytically (no integration), so the
 * result is a pure, order-independent function of `t`.
 */

import type { RationalFps } from "./types";
import { fpsRatio } from "./constants";

export interface SpringParams {
  mass: number;
  stiffness: number;
  damping: number;
  velocity?: number;
}

function guarded(value: number, fallback: number, positiveOnly: boolean): number {
  if (!Number.isFinite(value)) return fallback;
  if (positiveOnly && value <= 0) return fallback;
  return value;
}

/**
 * Unit-step response at time `t` (seconds). Always finite; exactly `0` for
 * `t <= 0`.
 */
export function springValue(t: number, params: SpringParams): number {
  if (!Number.isFinite(t) || t <= 0) return 0;

  const mass = guarded(params.mass, 1, true);
  const stiffness = guarded(params.stiffness, 0, true);
  const damping = guarded(params.damping, 0, true);
  const v0 = params.velocity !== undefined && Number.isFinite(params.velocity) ? params.velocity : 0;

  // No restoring force: behaves as an instantaneous step.
  if (stiffness <= 0) return 1;

  const omega0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  const finite = (y: number): number => (Number.isFinite(y) ? y : 1);

  if (Math.abs(zeta - 1) < 1e-9) {
    // Critically damped.
    const y = 1 - Math.exp(-omega0 * t) * (1 + (omega0 - v0) * t);
    return finite(y);
  }

  if (zeta < 1) {
    // Underdamped.
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
    const envelope = Math.exp(-zeta * omega0 * t);
    const y =
      1 -
      envelope *
        (Math.cos(omegaD * t) + ((zeta * omega0 - v0) / omegaD) * Math.sin(omegaD * t));
    return finite(y);
  }

  // Overdamped: two real roots.
  const s = Math.sqrt(zeta * zeta - 1);
  const r1 = -omega0 * (zeta - s);
  const r2 = -omega0 * (zeta + s);
  const a = (v0 + r2) / (r1 - r2);
  const b = -1 - a;
  const y = 1 + a * Math.exp(r1 * t) + b * Math.exp(r2 * t);
  return finite(y);
}

/** Whether the response is within `tolerance` of its asymptote. */
export function springIsSettled(t: number, params: SpringParams, tolerance = 0.001): boolean {
  return Math.abs(1 - springValue(t, params)) <= tolerance;
}

/**
 * Smallest integer frame count (capped at 600) at which the response is settled —
 * stable for two consecutive frames to avoid accepting a single oscillating
 * crossing.
 */
export function springSettleFrames(
  params: SpringParams,
  fps: RationalFps,
  tolerance = 0.001,
): number {
  const maxFrames = 600;
  const rate = fpsRatio(fps);
  for (let frame = 0; frame <= maxFrames; frame += 1) {
    const t = frame / rate;
    const tNext = (frame + 1) / rate;
    if (springIsSettled(t, params, tolerance) && springIsSettled(tNext, params, tolerance)) {
      return frame;
    }
  }
  return maxFrames;
}

/** Curated spring presets. Numeric params only, each versioned. */
export const SPRING_PRESETS: Record<string, { version: number; params: SpringParams }> = {
  gentle: { version: 1, params: { mass: 1, stiffness: 60, damping: 14 } },
  snappy: { version: 1, params: { mass: 1, stiffness: 220, damping: 26 } },
  bouncy: { version: 1, params: { mass: 1, stiffness: 300, damping: 12 } },
  settle: { version: 1, params: { mass: 1, stiffness: 180, damping: 30 } },
  heavy: { version: 1, params: { mass: 4, stiffness: 120, damping: 32 } },
};

/** Resolve a preset by name, applying optional overrides. Unknown → throws. */
export function resolveSpringPreset(name: string, overrides?: Partial<SpringParams>): SpringParams {
  const preset = SPRING_PRESETS[name];
  if (!preset) {
    throw new Error(
      `Unknown spring preset "${name}". Available presets: ${Object.keys(SPRING_PRESETS).join(", ")}.`,
    );
  }
  const params: SpringParams = { ...preset.params };
  if (overrides) {
    if (overrides.mass !== undefined) params.mass = overrides.mass;
    if (overrides.stiffness !== undefined) params.stiffness = overrides.stiffness;
    if (overrides.damping !== undefined) params.damping = overrides.damping;
    if (overrides.velocity !== undefined) params.velocity = overrides.velocity;
  }
  return params;
}
