import { createContext } from "react";
import type { CameraLightingBounds, CameraLightingPreset } from "./camera-lighting-preset";

/** Optional scoped preview override. Without a provider, all authored shots render unchanged. */
export const CameraLightingPreviewContext = createContext<CameraLightingPreset | null>(null);

/**
 * A timeline-only viewport has an authored focus, not necessarily an asset box.
 * For interactive QA only, estimate a subject-relative scale from that shot;
 * explicitly supplied scene bounds always take priority.
 */
export function cameraLightingShotBounds(position: readonly number[], focus: readonly number[]): CameraLightingBounds {
  const distance = Math.hypot(position[0] - focus[0], position[1] - focus[1], position[2] - focus[2]);
  const radius = Math.max(0.1, distance / 3);
  return {
    min: [focus[0] - radius, focus[1] - radius, focus[2] - radius],
    max: [focus[0] + radius, focus[1] + radius, focus[2] + radius],
  };
}
