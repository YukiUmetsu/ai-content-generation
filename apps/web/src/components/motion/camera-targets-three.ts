/** Optional mutable-engine boundary. Caller updates every pose absolutely. */
import { Box3, Mesh, Quaternion, Raycaster, Vector3 } from "three";
import type { Object3D } from "three";
import { tuple3, tuple4 } from "./camera-spatial";
import { validCameraBounds, validCameraVector } from "./camera-targets";
import type { CameraDiagnostic, CameraTargetRegistry, CameraTargetSample, CameraVector3 } from "./cinematic-camera-types";

export interface ThreeCameraTarget {
  id: string;
  object: Object3D;
  /** Local-space anchor. Defaults to measured world-bounds center. */
  focusAnchor?: CameraVector3;
  importance?: number;
  preferredDirection?: CameraVector3;
}
export function createThreeCameraTargets(options: {
  revision: string;
  root: Object3D;
  targets: readonly ThreeCameraTarget[];
  updateFrame: (frame: number) => void;
  collisionObjects?: readonly { id: string; object: Object3D }[];
  occluders?: readonly Object3D[];
  /** Rigid geometry only: cache local geometry boxes and transform their corners. */
  boundsMode?: "precise" | "conservative";
}): CameraTargetRegistry {
  const { revision, root, updateFrame } = options;
  if (!revision?.trim() || !root?.isObject3D || typeof updateFrame !== "function") throw new Error("Three camera targets need a root Object3D, revision and absolute-frame updater.");
  const byId = new Map<string, ThreeCameraTarget>();
  const diagnostics: CameraDiagnostic[] = [];
  if (options.boundsMode === "conservative") {
    const geometries = new Set<Mesh["geometry"]>();
    for (const target of options.targets) target.object.traverse(child => { if (child instanceof Mesh) geometries.add(child.geometry); });
    geometries.forEach(geometry => geometry.computeBoundingBox());
    diagnostics.push({ code: "camera-bounds-conservative", severity: "warning", message: "Using cached local geometry boxes for rigid targets. Rebuild the registry when vertex geometry changes; use precise bounds for deformation.", remainingLimitation: "Transformed local boxes conservatively include empty space; no pixel-tight framing claim." });
  }
  for (const target of options.targets) {
    if (!target.id?.trim() || byId.has(target.id) || !target.object?.isObject3D) throw new Error(`Three target "${target.id}" needs a unique ID and an Object3D.`);
    if (target.focusAnchor && !validCameraVector(target.focusAnchor)) throw new Error(`Target "${target.id}" focusAnchor must be finite local XYZ.`);
    if (target.importance !== undefined && (!Number.isFinite(target.importance) || target.importance <= 0)) throw new Error(`Target "${target.id}" importance must be positive.`);
    if (target.preferredDirection && (!validCameraVector(target.preferredDirection) || Math.hypot(...target.preferredDirection) < 1e-8)) throw new Error(`Target "${target.id}" viewing direction must be nonzero XYZ.`);
    byId.set(target.id, target);
  }
  const occluders: Mesh[] = [];
  const seen = new Set<Object3D>();
  for (const object of options.occluders ?? []) object.traverse(child => {
    if (!(child instanceof Mesh) || seen.has(child)) return;
    seen.add(child);
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    if (materials.some(m => m.transparent || m.opacity < 1 || m.alphaTest > 0) || "isSkinnedMesh" in child || child.morphTargetInfluences?.length) {
      diagnostics.push({ code: "camera-occlusion-unsupported-material", severity: "warning", layerId: child.name || child.uuid,
        message: "Transparent/alpha-tested/skinned/morphed occluders are excluded from geometric visibility rays. Supply an explicit visibility adapter for these surfaces.", remainingLimitation: "No pixel/depth/volume visibility guarantee." });
    } else occluders.push(child);
  });
  let preparedFrame = -1;
  const measurements = new Map<string, CameraTargetSample>();
  const box = new Box3(), world = new Vector3(), orientation = new Quaternion();
  const ray = new Raycaster(), origin = new Vector3(), endpoint = new Vector3(), direction = new Vector3(), cameraOrigin = new Vector3(), forward = new Vector3();
  const hits: ReturnType<Raycaster["intersectObjects"]> = [];
  const descendantOf = (object: Object3D, ancestor: Object3D) => { let current: Object3D | null = object; while (current) { if (current === ancestor) return true; current = current.parent; } return false; };
  const visible = (object: Object3D) => { let current: Object3D | null = object; while (current) { if (!current.visible) return false; current = current.parent; } return true; };
  function prepareFrame(frame: number) {
    if (!Number.isSafeInteger(frame) || frame < 0) throw new Error("Three camera target sampling needs a non-negative integer frame.");
    if (frame === preparedFrame) return;
    updateFrame(frame); root.updateWorldMatrix(true, true);
    preparedFrame = frame; measurements.clear();
  }
  return { revision, ids: [...byId.keys()], diagnostics, prepareFrame,
    sample(id, frame) {
      prepareFrame(frame);
      const target = byId.get(id);
      if (!target) throw new Error(`Three camera target "${id}" is missing. Register the object's semantic ID.`);
      const cached = measurements.get(id);
      if (cached) return cached;
      // Precise Box3 uses actual transformed vertices (including supported morph
      // deformation) rather than previous-frame matrices or scene-wide traversal.
      target.object.updateWorldMatrix(true, true); box.setFromObject(target.object, options.boundsMode !== "conservative");
      const bounds = { min: tuple3(box.min), max: tuple3(box.max) };
      if (!validCameraBounds(bounds)) throw new Error(`Target "${id}" has empty/invalid world geometry at frame ${frame}. Attach measurable geometry or provide explicit world-bound samples.`);
      if (target.focusAnchor) world.set(...target.focusAnchor).applyMatrix4(target.object.matrixWorld); else box.getCenter(world);
      target.object.getWorldQuaternion(orientation).normalize();
      const sample: CameraTargetSample = { id, bounds, focus: tuple3(world), orientation: tuple4(orientation), worldMatrix: target.object.matrixWorld.toArray(), importance: target.importance ?? 1, preferredDirection: target.preferredDirection };
      measurements.set(id, sample); return sample;
    },
    obstacles(frame) {
      prepareFrame(frame);
      return (options.collisionObjects ?? []).map(({ id, object }) => {
        object.updateWorldMatrix(true, true); box.setFromObject(object, true);
        const bounds = { min: tuple3(box.min), max: tuple3(box.max) };
        if (!validCameraBounds(bounds)) throw new Error(`Collision object "${id}" has invalid bounds at frame ${frame}; supply measurable geometry.`);
        return { id, bounds };
      });
    },
    visibility(pose, target, frame) {
      prepareFrame(frame);
      const owner = byId.get(target.id)!.object;
      const candidates = occluders.filter(object => !descendantOf(object, owner) && visible(object));
      if (!candidates.length) return 1;
      cameraOrigin.set(...pose.position);
      forward.set(0, 0, -1).applyQuaternion(orientation.set(...pose.orientation));
      let clear = 0;
      for (let index = 0; index < 9; index++) {
        if (index === 0) endpoint.set(...target.focus);
        else { const c = index - 1; endpoint.set(c & 1 ? target.bounds.max[0] : target.bounds.min[0], c & 2 ? target.bounds.max[1] : target.bounds.min[1], c & 4 ? target.bounds.max[2] : target.bounds.min[2]); }
        origin.copy(cameraOrigin);
        let distance = origin.distanceTo(endpoint);
        if (pose.projection.kind === "orthographic") {
          distance = direction.copy(endpoint).sub(cameraOrigin).dot(forward);
          origin.copy(endpoint).addScaledVector(forward, -distance); direction.copy(forward);
        } else direction.copy(endpoint).sub(origin).normalize();
        ray.set(origin, direction); ray.near = pose.near; ray.far = Math.max(pose.near, distance - 0.001);
        hits.length = 0; ray.intersectObjects(candidates, false, hits);
        if (!hits.length) clear++;
      }
      return clear / 9;
    },
  };
}
