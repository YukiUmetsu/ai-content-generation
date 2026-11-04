import { forwardRef, useMemo } from "react";
import { CameraViewport3D } from "./camera-viewport-3d";
import type { CameraViewport3DProps } from "./camera-viewport-3d";
import { inspectCameraComposition } from "../visual/camera-composition";
import type { CameraCompositionContract } from "../visual/camera-composition";
import type { CameraTargetRegistry, CompiledCinematicCamera } from "./cinematic-camera-types";

export type CinematicCameraDirectorProps = Omit<CameraViewport3DProps, "timeline" | "cameraMode" | "cameraId" | "width" | "height"> & {
  plan: CompiledCinematicCamera;
} & ({ contract?: undefined; targetRegistry?: CameraTargetRegistry } | { contract: CameraCompositionContract; targetRegistry: CameraTargetRegistry });
/** Controlled preview of an already compiled camera. The caller owns the MG1 clock. */
export const CinematicCameraDirector = forwardRef<HTMLDivElement, CinematicCameraDirectorProps>(function CinematicCameraDirector({ plan, contract, targetRegistry, ...props }, ref) {
  const diagnostics = useMemo(() => contract && targetRegistry ? inspectCameraComposition(plan, targetRegistry, contract) : [], [plan, contract, targetRegistry]);
  if (diagnostics.length) return <div className={props.className} style={props.style} ref={ref} role="alert" data-km-camera-contract="failed">{diagnostics.map(d => d.message).join(" ")}</div>;
  return <CameraViewport3D ref={ref} {...props} timeline={plan.timeline} cameraMode="pose" cameraId={plan.spec.cameraId ?? "camera3d"} width={plan.spec.output.width} height={plan.spec.output.height} />;
});
