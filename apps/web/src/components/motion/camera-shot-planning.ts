import { Quaternion, Vector3 } from "three";
import { createCameraRig3D, evaluateCameraRig3D } from "./camera-rig-3d";
import { evaluateEasing } from "./easing";
import { CameraShotRecipe } from "./camera-shot-recipes";
import { frameCameraBounds, rotateCameraDirection } from "./camera-framing";
import { createCameraProjector, lookAtQuaternion, prepareCameraPath, tuple3, tuple4, unionCameraBounds, vector3 } from "./camera-spatial";
import type { CameraMotionProfile, CameraSequenceSpec, CameraShotSpec, CameraTargetSample, CameraVector3, CinematicCameraPose, PlannedCameraShot } from "./cinematic-camera-types";

export type CameraTargetReader = (id: string, frame: number) => CameraTargetSample;
const lerp3 = (a: CameraVector3, b: CameraVector3, t: number): CameraVector3 => tuple3(vector3(a).lerp(vector3(b), t));
export function cameraShotTargets(shot: CameraShotSpec): string[] { return typeof shot.target === "string" ? [shot.target] : shot.target; }

/** Prepares reusable paths/orbit math once. Frame evaluation here is compile-time. */
export function prepareCameraShot(placement: PlannedCameraShot, source: CameraSequenceSpec, profile: CameraMotionProfile, read: CameraTargetReader) {
  const shot = CameraShotRecipe(placement.spec.type, placement.spec), ids = cameraShotTargets(shot), duration = placement.endFrame - placement.startFrame;
  const projector = createCameraProjector(), aspect = source.output.width / source.output.height;
  const firstTarget = read(ids[0], placement.startFrame);
  const preferred = shot.overrides?.viewingDirection ?? firstTarget.preferredDirection;
  const preferredVector = preferred ? vector3(preferred).normalize() : undefined;
  const azimuth = shot.azimuth ?? (preferredVector ? Math.atan2(preferredVector.x, preferredVector.z) * 180 / Math.PI : 35);
  const elevation = shot.elevation ?? (preferredVector ? Math.asin(preferredVector.y) * 180 / Math.PI : 25);
  const movingOrbit = ["orbit", "inspect", "turntable", "exploded"].includes(shot.type);
  const degrees = (shot.orbitDegrees ?? (movingOrbit ? profile.orbitDegrees : 0)) * profile.intensity;
  const hold = shot.holdFrames ?? Math.floor(duration * profile.holdFraction), actionEnd = Math.max(1, duration - 1 - hold);
  const endPose = { target: [0, 0, 0] as const, distance: 1, azimuth: azimuth + degrees, elevation: shot.endElevation ?? elevation };
  const orbit = createCameraRig3D({ id: `${shot.id}-orbit-basis`, fps: source.fps, durationFrames: duration,
    keyframes: [{ frame: 0, target: [0, 0, 0], distance: 1, azimuth, elevation }, { frame: actionEnd, ...endPose, easing: shot.easing ?? profile.easing }, ...(actionEnd < duration - 1 ? [{ frame: duration - 1, ...endPose }] : [])] });
  const directions = Array.from({ length: duration }, (_, f) => evaluateCameraRig3D(orbit, f).position);
  const path = shot.path ? prepareCameraPath(shot.path) : undefined;
  const focusPath = shot.focusPath ? prepareCameraPath(shot.focusPath) : undefined;
  const smooth = shot.smoothingFrames ?? (shot.type === "follow" ? profile.smoothingFrames : 0);
  const clampFrame = (f: number) => Math.max(0, Math.min(source.durationFrames - 1, f));
  const weightedFocus = (samples: CameraTargetSample[]) => {
    const sum = samples.reduce((total, t) => total + t.importance, 0), focus = new Vector3();
    for (const t of samples) focus.addScaledVector(vector3(t.focus), t.importance / sum);
    return tuple3(focus);
  };
  return {
    shot,
    sample(frame: number, angleCorrection = 0, distanceCorrection = 1): { pose: CinematicCameraPose; targets: CameraTargetSample[] } {
      const local = frame - placement.startFrame, progress = Math.max(0, Math.min(1, evaluateEasing(shot.easing ?? profile.easing, Math.min(1, local / actionEnd))));
      let targets = ids.map(id => read(id, frame));
      let focus = weightedFocus(targets);
      if (smooth || shot.leadFrames) {
        const average = new Vector3(); let count = 0;
        for (let offset = -smooth; offset <= smooth; offset++) {
          average.add(vector3(weightedFocus(ids.map(id => read(id, clampFrame(frame + offset + (shot.leadFrames ?? 0))))))); count++;
        }
        focus = tuple3(average.divideScalar(count));
      }
      let bounds = unionCameraBounds(targets.map(t => t.bounds));
      if (shot.type === "detail-to-overview" && shot.endTarget) {
        const destination = read(shot.endTarget, frame);
        bounds = { min: lerp3(bounds.min, destination.bounds.min, progress), max: lerp3(bounds.max, destination.bounds.max, progress) };
        focus = lerp3(focus, destination.focus, progress);
        if (progress >= 1) targets = [destination];
      }
      if (focusPath) { const point = focusPath.point(progress); focus = shot.focusPath?.relativeToTarget ? tuple3(vector3(focus).add(vector3(point))) : point; }
      const override = shot.overrides ?? {};
      if (override.focus || override.endFocus) focus = override.endFocus ? lerp3(override.focus ?? focus, override.endFocus, progress) : override.focus!;
      let direction = directions[local];
      if (shot.type === "follow" && shot.followSide) {
        const velocity = vector3(read(ids[0], clampFrame(frame + 1)).focus).sub(vector3(read(ids[0], clampFrame(frame - 1)).focus));
        if (velocity.lengthSq() > 1e-10) {
          velocity.normalize().multiplyScalar(shot.followSide === "trailing" ? -1 : 1); velocity.y += 0.5;
          direction = tuple3(velocity.normalize());
        }
      }
      direction = rotateCameraDirection(direction, angleCorrection);
      const dolly = shot.movement === "dolly-in" ? 1.4 - 0.4 * progress : shot.movement === "dolly-out" ? 1 + 0.4 * progress : shot.movement === "slow-dolly" ? 1.12 - 0.12 * progress : 1;
      const startFov = override.fov ?? 40, fov = startFov + ((override.endFov ?? startFov) - startFov) * progress;
      const pose = frameCameraBounds({ bounds, focus, direction, aspect, framing: shot.framing ?? "medium", composition: shot.composition,
        margin: profile.margin, projection: shot.projection ?? "perspective", fov, roll: override.roll, distanceScale: dolly * distanceCorrection * (override.distanceScale ?? 1), projector });
      if (override.distance !== undefined) {
        const center = vector3(focus), offset = vector3(pose.position).sub(center).normalize().multiplyScalar(override.distance * distanceCorrection);
        pose.position = tuple3(center.add(offset));
      }
      if (path) {
        const point = path.point(progress); pose.position = shot.path?.relativeToTarget ? tuple3(vector3(focus).add(vector3(point))) : point;
        if (shot.orientAlongPath) pose.orientation = lookAtQuaternion(pose.position, tuple3(vector3(pose.position).add(vector3(path.tangent(progress)))), override.roll);
        else pose.orientation = lookAtQuaternion(pose.position, focus, override.roll);
      }
      if (override.position || override.endPosition) {
        pose.position = override.endPosition ? lerp3(override.position ?? pose.position, override.endPosition, progress) : override.position!;
        pose.orientation = lookAtQuaternion(pose.position, focus, override.roll);
      }
      if (shot.orientationPath) pose.orientation = tuple4(new Quaternion(...shot.orientationPath.from).slerp(new Quaternion(...shot.orientationPath.to), progress).normalize());
      if (override.orientation || override.endOrientation) pose.orientation = override.endOrientation ? tuple4(new Quaternion(...(override.orientation ?? pose.orientation)).slerp(new Quaternion(...override.endOrientation), progress).normalize()) : override.orientation!;
      if (pose.projection.kind === "orthographic" && override.orthographicScale !== undefined) pose.projection = { kind: "orthographic", scale: override.orthographicScale };
      pose.near = override.near ?? pose.near; pose.far = override.far ?? pose.far;
      pose.focusDistance = override.focusDistance ?? vector3(pose.position).distanceTo(vector3(focus));
      if (override.endFocusDistance !== undefined) pose.focusDistance += (override.endFocusDistance - pose.focusDistance) * progress;
      return { pose, targets };
    },
  };
}
