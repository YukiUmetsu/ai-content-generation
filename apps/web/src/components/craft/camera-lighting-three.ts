/** Opt-in Three.js adapter for the portable camera/lighting contract. */
import {
  AmbientLight, Color, DirectionalLight, Group, Light, OrthographicCamera,
  PerspectiveCamera, PointLight, Quaternion, Scene, SpotLight,
} from "three";
import type { Texture } from "three";
import {
  resolveCameraLightingPreset,
  type CameraLightingAuthoredPose, type CameraLightingBounds, type CameraLightingPreset,
} from "../motion/camera-lighting-preset";

export interface CameraLightingThreeOptions {
  /** Exactly the host's studio lights (not scene lights authored for a shot). */
  managedLights?: readonly Light[];
  /** Baked photographs support camera and exposure, not synthetic relighting. */
  physicalLights?: boolean;
}

function kelvinToColor(temperature: number): Color {
  // A renderer-neutral UI's approximate white balance; physical radiometry is not promised.
  const t = temperature / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return new Color().setRGB(...[r, g, b].map(channel => Math.max(0, Math.min(255, channel)) / 255) as [number, number, number]);
}

type OwnedLight = AmbientLight | DirectionalLight | PointLight | SpotLight;
function newLight(type: CameraLightingPreset["lighting"]["lights"][number]["type"]): OwnedLight {
  switch (type) {
    case "ambient": return new AmbientLight();
    case "directional": return new DirectionalLight();
    case "point": return new PointLight();
    case "spot": return new SpotLight();
  }
}
function releaseLight(light: OwnedLight, group: Group) {
  if (light instanceof DirectionalLight || light instanceof SpotLight) group.remove(light.target);
  if ("shadow" in light) light.shadow.dispose();
  group.remove(light);
}

/** Preserve vertical composition while a host switches between 16:9 and 9:16. */
export function setOrthographicCameraAspect(camera: OrthographicCamera, aspect: number): void {
  if (!Number.isFinite(aspect) || aspect <= 0) throw new Error("Orthographic camera needs a positive finite aspect ratio");
  const halfHeight = (camera.top - camera.bottom) / 2 || 1;
  camera.left = -halfHeight * aspect;
  camera.right = halfHeight * aspect;
  camera.updateProjectionMatrix();
}

/** A per-scene owner. Reuse it across slider changes, and dispose on unmount. */
export function createCameraLightingThreeController(scene: Scene, options: CameraLightingThreeOptions = {}) {
  const group = new Group(); group.name = "kumiki-camera-lighting-preset";
  scene.add(group);
  const lights = new Map<string, { type: string; light: OwnedLight }>();
  const originalVisibility = new Map((options.managedLights ?? []).map(light => [light, light.visible]));
  const originalEnvironment: Texture | null = scene.environment;
  const originalEnvironmentIntensity = scene.environmentIntensity;
  let disposed = false;

  return {
    apply(camera: PerspectiveCamera | OrthographicCamera, preset: CameraLightingPreset,
      bounds: CameraLightingBounds, authoredPose?: CameraLightingAuthoredPose,
      applyOptions?: { physicalLights?: boolean }) {
      if (disposed) throw new Error("Camera/lighting controller has been disposed");
      const resolved = resolveCameraLightingPreset(preset, bounds, authoredPose);
      if (resolved.camera.projection.kind === "orthographic" && !(camera instanceof OrthographicCamera))
        throw new Error("Orthographic preset requires an OrthographicCamera host");
      if (resolved.camera.projection.kind === "perspective" && !(camera instanceof PerspectiveCamera))
        throw new Error("Perspective preset requires a PerspectiveCamera host");
      let authoredCorrection: Quaternion | undefined;
      if (preset.mode === "preview-offset" && authoredPose?.orientation) {
        const originalView = new PerspectiveCamera();
        originalView.position.set(...authoredPose.position);
        originalView.lookAt(...authoredPose.target);
        const [x, y, z, w] = authoredPose.orientation;
        if (![x, y, z, w].every(Number.isFinite)) throw new Error("Authored camera quaternion must be finite");
        authoredCorrection = new Quaternion(x, y, z, w).normalize().multiply(originalView.quaternion.invert());
      }
      camera.position.set(...resolved.camera.position);
      camera.up.set(0, 1, 0);
      camera.lookAt(...resolved.camera.target);
      const authoredRoll = preset.mode === "preview-offset" && !authoredPose?.orientation ? authoredPose?.rollDeg ?? 0 : 0;
      camera.rotateZ((resolved.camera.rollDeg + authoredRoll) * Math.PI / 180);
      if (authoredCorrection) camera.quaternion.premultiply(authoredCorrection);
      if (camera instanceof PerspectiveCamera) camera.fov = resolved.camera.fov;
      else {
        const h = resolved.camera.projection.kind === "orthographic" ? resolved.camera.projection.scale / 2 : 1;
        const aspect = (camera.right - camera.left) / (camera.top - camera.bottom) || 1;
        camera.top = h; camera.bottom = -h; camera.left = -h * aspect; camera.right = h * aspect;
      }
      const distance = Math.hypot(...resolved.camera.position.map((value, i) => value - resolved.camera.target[i]));
      camera.near = Math.max(.01, Math.min(camera.near, Math.max(.01, distance - resolved.radius * 3)));
      camera.far = Math.max(camera.far, distance + resolved.radius * 5);
      camera.updateProjectionMatrix();

      const physicalLights = applyOptions?.physicalLights ?? options.physicalLights ?? true;
      for (const [light, original] of originalVisibility) light.visible = !physicalLights || resolved.mode === "augment" ? original : false;
      if (physicalLights && resolved.environment === "disable") scene.environment = null;
      else { scene.environment = originalEnvironment; scene.environmentIntensity = originalEnvironmentIntensity; }

      const incoming = new Set<string>();
      for (const entry of physicalLights ? resolved.lights : []) {
        incoming.add(entry.id);
        let existing = lights.get(entry.id);
        if (existing && existing.type !== entry.type) { releaseLight(existing.light, group); lights.delete(entry.id); existing = undefined; }
        if (!existing) {
          const light = newLight(entry.type);
          light.name = `preset-${entry.id}`;
          group.add(light);
          if (light instanceof DirectionalLight || light instanceof SpotLight) group.add(light.target);
          existing = { type: entry.type, light };
          lights.set(entry.id, existing);
        }
        const light = existing.light;
        light.visible = entry.enabled;
        light.position.set(entry.position[0], entry.position[1], entry.position[2]);
        light.color.copy(entry.color ? new Color(entry.color) : kelvinToColor(entry.temperatureK!));
        light.intensity = entry.intensity;
        if (light instanceof DirectionalLight || light instanceof PointLight || light instanceof SpotLight) {
          light.castShadow = entry.castShadow;
          if (light instanceof DirectionalLight || light instanceof SpotLight) light.target.position.set(...resolved.camera.target);
          if (light instanceof DirectionalLight) {
            const extent = resolved.radius * 2;
            light.shadow.camera.left = -extent; light.shadow.camera.right = extent;
            light.shadow.camera.top = extent; light.shadow.camera.bottom = -extent;
            light.shadow.camera.near = .01; light.shadow.camera.far = resolved.radius * 12;
            light.shadow.camera.updateProjectionMatrix();
          }
          light.shadow.mapSize.set(1024, 1024);
          light.shadow.bias = -.00015;
        }
      }
      for (const [id, existing] of lights) if (!incoming.has(id)) {
        releaseLight(existing.light, group); lights.delete(id);
      }
      return { exposure: resolved.exposure, camera: resolved.camera,
        diagnostics: physicalLights
          ? ["Three.js light intensities and Kelvin color are approximate across renderers."]
          : ["Physical lights disabled for baked-image 2.5D; only camera/exposure apply."] };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const entry of lights.values()) releaseLight(entry.light, group);
      lights.clear();
      for (const [light, original] of originalVisibility) light.visible = original;
      if (scene.environment === null || scene.environment === originalEnvironment) {
        scene.environment = originalEnvironment;
        scene.environmentIntensity = originalEnvironmentIntensity;
      }
      scene.remove(group);
      group.clear();
    },
  };
}

/** Convenience for hosts applying one static preset; call dispose before replacing it. */
export function applyCameraLightingToThree(camera: PerspectiveCamera | OrthographicCamera, scene: Scene,
  preset: CameraLightingPreset, bounds: CameraLightingBounds, authoredPose?: CameraLightingAuthoredPose,
  options?: CameraLightingThreeOptions) {
  const controller = createCameraLightingThreeController(scene, options);
  try { const result = controller.apply(camera, preset, bounds, authoredPose); return { ...result, dispose: controller.dispose }; }
  catch (error) { controller.dispose(); throw error; }
}
