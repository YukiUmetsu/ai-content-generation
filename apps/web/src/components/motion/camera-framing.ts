import { Quaternion, Ray, Vector3 } from "three";
import { boundsBox, boundsRadius, createCameraProjector, lookAtQuaternion, projectCameraBounds, tuple3, vector3 } from "./camera-spatial";
import type { CameraProjector } from "./camera-spatial";
import type { CameraBounds3D, CameraComposition, CameraFraming, CameraObstacle, CameraQuaternion, CameraShotSpec, CameraTargetRegistry, CameraTargetSample, CameraVector3, CinematicCameraPose, FramingConstraint } from "./cinematic-camera-types";
import type { Rect } from "./types";

const OCCUPANCY: Record<CameraFraming, number> = { wide: 0.48, medium: 0.64, close: 0.8, "extreme-close": 0.9 };
export function cameraSafeRegion(composition: CameraComposition = {}, margin = 0.08): Rect {
  if (composition.safeRegion) return composition.safeRegion;
  const m = composition.safeMargin ?? margin, headroom = composition.headroom ?? 0;
  return { x: m, y: m + headroom, width: 1 - 2 * m - (composition.reserveRight ?? 0), height: 1 - 2 * m - headroom };
}
export function rectViolation(rect: Rect, region: Rect): number {
  return Math.max(0, region.x - rect.x, region.y - rect.y, rect.x + rect.width - region.x - region.width, rect.y + rect.height - region.y - region.height);
}
const intersects = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Exact projected-corner fitting with a bounded binary search; no optimizer. */
export function frameCameraBounds(options: { bounds: CameraBounds3D; focus: CameraVector3; direction: CameraVector3; aspect: number; framing: CameraFraming; composition?: CameraComposition; margin: number; projection: "perspective" | "orthographic"; fov: number; roll?: number; distanceScale?: number; projector?: CameraProjector }): CinematicCameraPose {
  const { bounds, focus, aspect, framing, composition = {}, margin, projection, fov, roll = 0, distanceScale = 1 } = options;
  const projector = options.projector ?? createCameraProjector();
  const center = vector3(focus), radius = boundsRadius(bounds), direction = vector3(options.direction).normalize();
  const safe = cameraSafeRegion(composition, margin);
  const placement = composition.subjectPosition ?? [safe.x + safe.width / 2, safe.y + safe.height / 2];
  const occupancy = OCCUPANCY[framing];
  // Tighten the useful safe rectangle around the requested focal placement.
  const region = { x: placement[0] - (placement[0] - safe.x) * occupancy, y: placement[1] - (placement[1] - safe.y) * occupancy,
    width: safe.width * occupancy, height: safe.height * occupancy };
  const orientation = lookAtQuaternion(tuple3(center.clone().add(direction)), tuple3(center), roll);
  const q = new Quaternion(...orientation), right = new Vector3(1, 0, 0).applyQuaternion(q), up = new Vector3(0, 1, 0).applyQuaternion(q);
  const distanceFor = (size: number) => projection === "perspective" ? size : radius * 5;
  const make = (size: number): CinematicCameraPose => {
    const distance = distanceFor(size), halfHeight = projection === "perspective" ? Math.tan(fov * Math.PI / 360) * distance : size / 2;
    const offset = right.clone().multiplyScalar((0.5 - placement[0]) * 2 * halfHeight * aspect).addScaledVector(up, (placement[1] - 0.5) * 2 * halfHeight);
    const position = tuple3(center.clone().addScaledVector(direction, distance).add(offset));
    return { position, orientation, focus, projection: projection === "perspective" ? { kind: projection, fov } : { kind: projection, scale: size },
      near: 0.02, far: Math.max(200, distance + radius * 12), focusDistance: vector3(position).distanceTo(vector3(focus)) };
  };
  let low = projection === "perspective" ? radius * 1.01 : radius * 0.05, high = radius * 100;
  for (let iteration = 0; iteration < 18; iteration++) {
    const middle = (low + high) / 2, measured = projectCameraBounds(make(middle), bounds, aspect, projector);
    if (!measured.clipped && rectViolation(measured.rect, region) < 1e-6) high = middle; else low = middle;
  }
  return make(high * distanceScale);
}

export interface CameraConstraintFailure { constraint: FramingConstraint; amount: number; targetId?: string; reason: string }
export function inspectCameraConstraints(options: { pose: CinematicCameraPose; targets: CameraTargetSample[]; shot: CameraShotSpec; aspect: number; margin: number; frame: number; registry: CameraTargetRegistry; constraints: FramingConstraint[]; obstacles: readonly CameraObstacle[]; previous?: CinematicCameraPose; allowPartial: boolean; projector: CameraProjector }): CameraConstraintFailure[] {
  const { pose, targets, shot, aspect, frame, registry, constraints, obstacles, previous, allowPartial, projector } = options;
  const failures: CameraConstraintFailure[] = [];
  for (const constraint of constraints) {
    const tolerance = constraint.tolerance ?? 0.002;
    if (constraint.kind === "framing") {
      if (allowPartial) continue;
      const region = constraint.region ?? cameraSafeRegion(shot.composition, options.margin);
      for (const target of targets) {
        const measured = projectCameraBounds(pose, target.bounds, aspect, projector);
        const excluded = (shot.composition?.exclusions ?? []).some(rect => intersects(measured.rect, rect));
        const amount = Math.max(measured.clipped ? 1 : 0, excluded ? 1 : 0, rectViolation(measured.rect, region));
        if (amount > tolerance) failures.push({ constraint, amount, targetId: target.id, reason: measured.clipped ? "Subject bounds cross a near/far plane or lie behind the camera." : excluded ? "Subject bounds overlap a declared caption/text exclusion." : "Subject bounds leave the declared safe region." });
      }
    } else if (constraint.kind === "collision") {
      const position = vector3(pose.position);
      for (const obstacle of obstacles) {
        const box = boundsBox(obstacle.bounds).expandByScalar(constraint.clearance), inside = box.containsPoint(position);
        let crossing = false;
        if (previous && !inside) {
          const from = vector3(previous.position), distance = from.distanceTo(position);
          if (distance > 1e-8) { const hit = new Ray(from, position.clone().sub(from).normalize()).intersectBox(box, new Vector3()); crossing = !!hit && from.distanceTo(hit) <= distance; }
        }
        if (inside || crossing) failures.push({ constraint, amount: 1, targetId: obstacle.id, reason: inside ? "Camera clearance sphere enters a declared obstacle's conservative world box." : "Camera segment crosses a declared obstacle's expanded world box." });
      }
    } else if (constraint.kind === "occlusion") {
      if (!registry.visibility) {
        failures.push({ constraint, amount: 1, reason: "This target registry has no visibility adapter; supply one or remove/soften the occlusion constraint." });
      } else for (const target of targets) {
        const visible = registry.visibility(pose, target, frame);
        if (!Number.isFinite(visible) || visible < 0 || visible > 1) throw new Error(`Visibility adapter returned invalid coverage for "${target.id}" at frame ${frame}; return a finite fraction in [0, 1].`);
        if (visible + tolerance < constraint.minimumVisible) failures.push({ constraint, amount: (constraint.minimumVisible - visible) * target.importance, targetId: target.id, reason: `Only ${Math.round(visible * 100)}% of sampled subject anchors are visible through declared occluders.` });
      }
    } else if (constraint.kind === "distance") {
      const distance = vector3(pose.position).distanceTo(vector3(pose.focus));
      const amount = Math.max(0, constraint.min - distance, distance - constraint.max);
      if (amount > tolerance) failures.push({ constraint, amount, reason: `Focus distance ${distance.toFixed(3)} is outside [${constraint.min}, ${constraint.max}].` });
    } else {
      const focusBounds = { min: pose.focus, max: pose.focus }, measured = projectCameraBounds(pose, focusBounds, aspect, projector);
      const amount = Math.hypot(measured.rect.x - constraint.position[0], measured.rect.y - constraint.position[1]);
      if (amount > tolerance) failures.push({ constraint, amount, reason: "Focal point misses the desired normalized screen position." });
    }
  }
  return failures;
}
export function rotateCameraDirection(direction: CameraVector3, degrees: number): CameraVector3 { return tuple3(vector3(direction).applyAxisAngle(new Vector3(0, 1, 0), degrees * Math.PI / 180)); }
export function composeCameraOrientation(from: CameraQuaternion, to: CameraQuaternion, progress: number): CameraQuaternion {
  const q = new Quaternion(...from).slerp(new Quaternion(...to), progress).normalize(); return [q.x, q.y, q.z, q.w];
}
