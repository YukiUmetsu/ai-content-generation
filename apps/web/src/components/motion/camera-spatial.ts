/** Three.js math/projection boundary. No renderer, clock or scene traversal. */
import { Box3, CatmullRomCurve3, CubicBezierCurve3, CurvePath, LineCurve3, Matrix4, OrthographicCamera, PerspectiveCamera, Quaternion, Sphere, Vector3 } from "three";
import type { Curve } from "three";
import type { CameraBounds3D, CameraPathSpec, CameraQuaternion, CameraVector3, CinematicCameraPose } from "./cinematic-camera-types";
import type { Rect } from "./types";

export const vector3 = (v: CameraVector3) => new Vector3(...v);
export const tuple3 = (v: Vector3): CameraVector3 => [v.x, v.y, v.z];
export const tuple4 = (q: Quaternion): CameraQuaternion => [q.x, q.y, q.z, q.w];
export function boundsBox(bounds: CameraBounds3D) { return new Box3(vector3(bounds.min), vector3(bounds.max)); }
export function boundsCenter(bounds: CameraBounds3D): CameraVector3 { return tuple3(boundsBox(bounds).getCenter(new Vector3())); }
export function boundsRadius(bounds: CameraBounds3D): number { return Math.max(1e-5, boundsBox(bounds).getBoundingSphere(new Sphere()).radius); }
export function unionCameraBounds(bounds: readonly CameraBounds3D[]): CameraBounds3D {
  const box = new Box3();
  for (const item of bounds) box.union(boundsBox(item));
  return { min: tuple3(box.min), max: tuple3(box.max) };
}
export function lookAtQuaternion(position: CameraVector3, target: CameraVector3, roll = 0): CameraQuaternion {
  const eye = vector3(position), focus = vector3(target);
  if (eye.distanceToSquared(focus) < 1e-12) throw new Error("Camera position equals its look-at point. Move it away from the subject or provide a valid orientation.");
  const q = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(eye, focus, new Vector3(0, 1, 0)));
  if (roll) q.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), roll * Math.PI / 180));
  return tuple4(q.normalize());
}
export function interpolateCameraPose(a: CinematicCameraPose, b: CinematicCameraPose, t: number): CinematicCameraPose {
  const u = Math.max(0, Math.min(1, t));
  if (u === 0) return structuredClone(a);
  if (u === 1) return structuredClone(b);
  if (a.projection.kind !== b.projection.kind) throw new Error("A continuous handoff cannot change perspective/orthographic projection. Use an intentional cut.");
  const lerp = (x: number, y: number) => x + (y - x) * u;
  const lensA = a.projection.kind === "perspective" ? a.projection.fov : a.projection.scale;
  const lensB = b.projection.kind === "perspective" ? b.projection.fov : b.projection.scale;
  return { position: tuple3(vector3(a.position).lerp(vector3(b.position), u)), focus: tuple3(vector3(a.focus).lerp(vector3(b.focus), u)),
    orientation: tuple4(new Quaternion(...a.orientation).slerp(new Quaternion(...b.orientation), u).normalize()),
    projection: a.projection.kind === "perspective" ? { kind: "perspective", fov: lerp(lensA, lensB) } : { kind: "orthographic", scale: lerp(lensA, lensB) },
    near: lerp(a.near, b.near), far: lerp(a.far, b.far), focusDistance: lerp(a.focusDistance, b.focusDistance) };
}
export function prepareCameraPath(spec: CameraPathSpec) {
  if (!spec.points || spec.points.length < 2 || spec.points.some(p => p.length !== 3 || !p.every(Number.isFinite))) throw new Error("CameraPath needs at least two finite XYZ control points.");
  const points = spec.points.map(vector3);
  let curve: Curve<Vector3>;
  if (spec.kind === "bezier") {
    if (points.length !== 4) throw new Error("A cubic Bezier camera path needs exactly four control points.");
    curve = new CubicBezierCurve3(points[0], points[1], points[2], points[3]);
  } else if (spec.kind === "catmull-rom") curve = new CatmullRomCurve3(points, false, "centripetal");
  else if (spec.kind === "linear") {
    const path = new CurvePath<Vector3>();
    for (let i = 1; i < points.length; i++) path.add(new LineCurve3(points[i - 1], points[i]));
    curve = path;
  } else throw new Error(`Unknown camera path kind "${String(spec.kind)}". Choose linear, bezier or catmull-rom.`);
  curve.arcLengthDivisions = 256; curve.updateArcLengths();
  if (curve.getLength() <= 1e-8) throw new Error("Camera path has no travel length. Use movement: 'hold' or separate its control points.");
  const point = new Vector3(), tangent = new Vector3();
  return {
    point(t: number): CameraVector3 { const u = Math.max(0, Math.min(1, t)); return tuple3(spec.arcLength === false ? curve.getPoint(u, point) : curve.getPointAt(u, point)); },
    tangent(t: number): CameraVector3 { const u = Math.max(0, Math.min(1, t)); return tuple3(spec.arcLength === false ? curve.getTangent(u, tangent) : curve.getTangentAt(u, tangent)); },
    length: curve.getLength(),
  };
}

/** Per-compilation scratch state, never a frame-history cache. */
export function createCameraProjector() { return { perspective: new PerspectiveCamera(), orthographic: new OrthographicCamera(), point: new Vector3() }; }
export type CameraProjector = ReturnType<typeof createCameraProjector>;
export function cameraFromPose(pose: CinematicCameraPose, aspect: number, workspace = createCameraProjector()) {
  if (!Number.isFinite(aspect) || aspect <= 0) throw new Error("Camera projection needs a positive finite aspect ratio.");
  const camera = pose.projection.kind === "perspective" ? workspace.perspective : workspace.orthographic;
  if (pose.projection.kind === "perspective") { workspace.perspective.aspect = aspect; workspace.perspective.fov = pose.projection.fov; }
  else { const h = pose.projection.scale / 2; Object.assign(workspace.orthographic, { left: -h * aspect, right: h * aspect, top: h, bottom: -h }); }
  camera.position.set(...pose.position); camera.quaternion.set(...pose.orientation); camera.near = pose.near; camera.far = pose.far;
  camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  return camera;
}
export function projectCameraBounds(pose: CinematicCameraPose, bounds: CameraBounds3D, aspect: number, workspace = createCameraProjector()): { rect: Rect; clipped: boolean; depth: readonly [number, number] } {
  const camera = cameraFromPose(pose, aspect, workspace), point = workspace.point;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity, closest = Infinity, farthest = -Infinity, clipped = false;
  for (let corner = 0; corner < 8; corner++) {
    point.set(corner & 1 ? bounds.max[0] : bounds.min[0], corner & 2 ? bounds.max[1] : bounds.min[1], corner & 4 ? bounds.max[2] : bounds.min[2]);
    point.applyMatrix4(camera.matrixWorldInverse);
    const depth = -point.z; closest = Math.min(closest, depth); farthest = Math.max(farthest, depth);
    if (depth <= pose.near || depth >= pose.far) clipped = true;
    point.applyMatrix4(camera.projectionMatrix);
    const x = (point.x + 1) / 2, y = (1 - point.y) / 2;
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  return { rect: { x: left, y: top, width: right - left, height: bottom - top }, clipped, depth: [closest, farthest] };
}
