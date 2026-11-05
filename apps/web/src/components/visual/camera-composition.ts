import { deriveSemanticTrackingWindow, inspectCriticalCameraFrames } from "./camera-constraints";
import type { CriticalCameraRequirement, TrackWindowRequirement } from "./camera-constraints";
import type { CameraDiagnostic, CameraTargetRegistry, CompiledCinematicCamera } from "../motion/cinematic-camera-types";

export interface CameraCompositionContract {
  /** Every integer frame by default. Explicit stride opts into sparse checking. */
  criticalSubjects?: readonly CriticalCameraRequirement[];
  tracking?: readonly (TrackWindowRequirement & { shotId: string })[];
}

/** Verify a compiled CC1 plan, sharing the existing MG1 absolute-frame clock. */
export function inspectCameraComposition(plan: CompiledCinematicCamera, registry: CameraTargetRegistry, contract: CameraCompositionContract): CameraDiagnostic[] {
  const diagnostics: CameraDiagnostic[] = [];
  if (registry.revision !== plan.targetRevision) return [{ code: "camera-target-revision", severity: "error", message: "Camera target geometry changed. Recompile the camera with the current registry before previewing." }];
  try {
    const guard = inspectCriticalCameraFrames(plan, registry, (contract.criticalSubjects ?? []).map(rule => ({ ...rule, strideFrames: rule.strideFrames ?? 1 })));
    diagnostics.push(...guard.failures.slice(0, 256).map(failure => ({ code: failure.code, severity: "error" as const,
      constraintId: failure.requirement, targetIds: [failure.targetId], frame: failure.frame,
      message: `${failure.message} Reframe the subject or correct its declared bounds/safe region.` })));
    for (const tracking of contract.tracking ?? []) {
      const window = deriveSemanticTrackingWindow(registry, tracking);
      const shot = plan.shots.find(shot => shot.id === tracking.shotId);
      const targets = shot ? typeof shot.spec.target === "string" ? [shot.spec.target] : shot.spec.target : [];
      if (!window.ok || !shot || shot.spec.type !== "follow" || !targets.includes(tracking.movingId) || shot.startFrame > window.startFrame || shot.endFrame < window.endFrame)
        diagnostics.push({ code: "camera-tracking-unsatisfied", severity: "error", shotId: tracking.shotId, targetIds: [tracking.movingId],
          message: !window.ok ? window.reason : `Follow shot "${tracking.shotId}" must target "${tracking.movingId}" and cover [${window.startFrame}, ${window.endFrame}). Derive its timing from the shared choreography events or trajectory, then recompile.` });
    }
  } catch (cause) {
    diagnostics.push({ code: "camera-composition-invalid", severity: "error", message: `Cannot check camera composition: ${cause instanceof Error ? cause.message : String(cause)} Correct the declared requirement and recompile.` });
  }
  return diagnostics;
}
