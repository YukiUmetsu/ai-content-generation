/** Portable, renderer-neutral camera/lighting settings. Canonical coordinates are Y-up. */
export type CameraLightingVec3 = readonly [number, number, number];
export type CameraLightingBounds = { min: CameraLightingVec3; max: CameraLightingVec3 };
export type CameraLightingProjection = { kind: "perspective"; fovDeg: number } | { kind: "orthographic"; scale: number };
export interface CameraLightingPreset {
  schemaVersion: 1;
  id: string;
  mode: "preview-offset" | "replace-shot";
  camera: {
    space: "subject-relative" | "world";
    target: "subject:center" | CameraLightingVec3;
    azimuthDeg: number;
    elevationDeg: number;
    heightOffset: number;
    distanceFactor: number;
    rollDeg: number;
    projection: CameraLightingProjection;
  };
  lighting: {
    exposure: number;
    environment: "keep" | "disable";
    mode: "replace-managed" | "augment";
    lights: Array<{
      id: string;
      type: "ambient" | "directional" | "point" | "spot";
      enabled: boolean;
      position: CameraLightingVec3;
      color?: string;
      temperatureK?: number;
      intensity: number;
      castShadow: boolean;
    }>;
  };
}

export type CameraLightingAuthoredPose = {
  position: CameraLightingVec3;
  target: CameraLightingVec3;
  /** Optional CC1 quaternion: preserve authored look direction/roll beyond focus. */
  orientation?: readonly [number, number, number, number];
  /** MG1 orbit's authored roll, when no explicit quaternion is provided. */
  rollDeg?: number;
  fov?: number;
  projection?: { kind: "perspective"; fov: number } | { kind: "orthographic"; scale: number };
};
export type ResolvedCameraLightingPreset = {
  camera: { position: [number, number, number]; target: [number, number, number]; rollDeg: number; fov: number; projection: CameraLightingProjection };
  lights: Array<CameraLightingPreset["lighting"]["lights"][number] & { position: [number, number, number] }>;
  exposure: number;
  environment: CameraLightingPreset["lighting"]["environment"];
  mode: CameraLightingPreset["lighting"]["mode"];
  radius: number;
};

export const DEFAULT_CAMERA_LIGHTING_PRESET: CameraLightingPreset = {
  schemaVersion: 1,
  id: "studio-three-quarter",
  mode: "replace-shot",
  camera: {
    space: "subject-relative", target: "subject:center", azimuthDeg: 28, elevationDeg: 18,
    heightOffset: 0, distanceFactor: 3, rollDeg: 0,
    projection: { kind: "perspective", fovDeg: 32 },
  },
  lighting: {
    exposure: 1, environment: "disable", mode: "replace-managed",
    lights: [
      { id: "key", type: "directional", enabled: true, position: [1.2, 2.4, 2.8], color: "#fff2df", intensity: 2, castShadow: true },
      { id: "fill", type: "directional", enabled: true, position: [-2, 1.4, 1], color: "#cbdcff", intensity: .55, castShadow: false },
    ],
  },
};

function record(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}
function finite(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    throw new Error(`${name} must be a finite number between ${min} and ${max}`);
  return value;
}
function choice<T extends string>(value: unknown, name: string, choices: readonly T[]): T {
  if (typeof value !== "string" || !choices.includes(value as T)) throw new Error(`${name} must be one of ${choices.join(", ")}`);
  return value as T;
}
function identifier(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value))
    throw new Error(`${name} must be a non-empty safe identifier (letters, numbers, ._- only)`);
  return value;
}
function vec3(value: unknown, name: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${name} must contain exactly three numbers`);
  return [0, 1, 2].map(i => finite(value[i], `${name}[${i}]`, -1e6, 1e6)) as [number, number, number];
}

/** Rejects incompatible/unsafe JSON atomically, then returns a canonical copy. */
export function validateCameraLightingPreset(value: unknown): CameraLightingPreset {
  const p = record(value, "preset");
  if (p.schemaVersion !== 1) throw new Error("schemaVersion: only version 1 is supported");
  const camera = record(p.camera, "camera");
  const projection = record(camera.projection, "camera.projection");
  const kind = choice(projection.kind, "camera.projection.kind", ["perspective", "orthographic"] as const);
  const target = camera.target === "subject:center" ? "subject:center" : vec3(camera.target, "camera.target");
  const lighting = record(p.lighting, "lighting");
  if (!Array.isArray(lighting.lights)) throw new Error("lighting.lights must be an array");
  if (lighting.lights.length > 8) throw new Error("lighting.lights supports at most 8 lights");
  const ids = new Set<string>();
  const lights: CameraLightingPreset["lighting"]["lights"] = lighting.lights.map((raw, i) => {
    const light = record(raw, `lighting.lights[${i}]`);
    const id = identifier(light.id, `lighting.lights[${i}].id`);
    if (ids.has(id)) throw new Error(`Duplicate lighting light ID: ${id}`);
    ids.add(id);
    if ((typeof light.color === "string") === (light.temperatureK !== undefined))
      throw new Error(`lighting.lights[${i}]: supply exactly one of color or temperatureK`);
    if (light.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(String(light.color)))
      throw new Error(`lighting.lights[${i}].color must be #RRGGBB`);
    if (light.enabled !== true && light.enabled !== false) throw new Error(`lighting.lights[${i}].enabled must be boolean`);
    if (light.castShadow !== true && light.castShadow !== false) throw new Error(`lighting.lights[${i}].castShadow must be boolean`);
    return {
      id, type: choice(light.type, `lighting.lights[${i}].type`, ["ambient", "directional", "point", "spot"] as const),
      enabled: light.enabled, position: vec3(light.position, `lighting.lights[${i}].position`),
      ...(light.color !== undefined ? { color: light.color as string } : { temperatureK: finite(light.temperatureK, `lighting.lights[${i}].temperatureK`, 1000, 20000) }),
      intensity: finite(light.intensity, `lighting.lights[${i}].intensity`, 0, 100), castShadow: light.castShadow,
    };
  });
  if (lights.filter(light => light.enabled && light.castShadow).length > 2) throw new Error("At most 2 enabled shadow casters are supported");
  return {
    schemaVersion: 1,
    id: identifier(p.id, "id"),
    mode: choice(p.mode, "mode", ["preview-offset", "replace-shot"] as const),
    camera: {
      space: choice(camera.space, "camera.space", ["subject-relative", "world"] as const), target,
      azimuthDeg: finite(camera.azimuthDeg, "camera.azimuthDeg", -360, 360),
      elevationDeg: finite(camera.elevationDeg, "camera.elevationDeg", -89, 89),
      heightOffset: finite(camera.heightOffset, "camera.heightOffset", -1000, 1000),
      distanceFactor: finite(camera.distanceFactor, "camera.distanceFactor", .05, 1000),
      rollDeg: finite(camera.rollDeg, "camera.rollDeg", -180, 180),
      projection: kind === "perspective"
        ? { kind, fovDeg: finite(projection.fovDeg, "camera.projection.fovDeg", 5, 150) }
        : { kind, scale: finite(projection.scale, "camera.projection.scale", .01, 1000) },
    },
    lighting: {
      exposure: finite(lighting.exposure, "lighting.exposure", .01, 20),
      environment: choice(lighting.environment, "lighting.environment", ["keep", "disable"] as const),
      mode: choice(lighting.mode, "lighting.mode", ["replace-managed", "augment"] as const), lights,
    },
  };
}

/** Resolve absolute positions from the bounding sphere (or world units). No renderer is involved. */
export function resolveCameraLightingPreset(
  preset: CameraLightingPreset, bounds: CameraLightingBounds, authoredPose?: CameraLightingAuthoredPose,
): ResolvedCameraLightingPreset {
  const p = validateCameraLightingPreset(preset);
  const min = vec3(bounds.min, "bounds.min"), max = vec3(bounds.max, "bounds.max");
  if (max.some((value, i) => value < min[i])) throw new Error("bounds.min must not exceed bounds.max");
  const radius = Math.hypot(...max.map((value, i) => value - min[i])) / 2;
  if (radius <= 0) throw new Error("bounds must have a nonzero radius");
  const center = min.map((value, i) => (value + max[i]) / 2) as [number, number, number];
  const relative = p.camera.space === "subject-relative";
  const unit = relative ? radius : 1;
  const baseTarget = p.camera.target === "subject:center" ? center
    : p.camera.target.map((value, i) => (relative ? center[i] : 0) + value * unit) as [number, number, number];
  const rad = Math.PI / 180;
  const az = p.camera.azimuthDeg * rad;
  const el = p.camera.elevationDeg * rad;
  const useOffset = p.mode === "preview-offset" && authoredPose !== undefined;
  const target = useOffset ? [...authoredPose.target] as [number, number, number] : baseTarget;
  let position: [number, number, number];
  if (useOffset) {
    const dx = authoredPose.position[0] - target[0], dy = authoredPose.position[1] - target[1], dz = authoredPose.position[2] - target[2];
    const originalAz = Math.atan2(dx, dz), originalEl = Math.atan2(dy, Math.hypot(dx, dz));
    const d = Math.hypot(dx, dy, dz) * p.camera.distanceFactor;
    const a = originalAz + az, e = Math.max(-89 * rad, Math.min(89 * rad, originalEl + el));
    position = [target[0] + Math.sin(a) * Math.cos(e) * d, target[1] + Math.sin(e) * d + p.camera.heightOffset * unit,
      target[2] + Math.cos(a) * Math.cos(e) * d];
  } else {
    const d = p.camera.distanceFactor * unit;
    position = [target[0] + Math.sin(az) * Math.cos(el) * d, target[1] + Math.sin(el) * d + p.camera.heightOffset * unit,
      target[2] + Math.cos(az) * Math.cos(el) * d];
  }
  const projection = useOffset && authoredPose.projection
    ? authoredPose.projection.kind === "perspective"
      ? { kind: "perspective" as const, fovDeg: authoredPose.projection.fov }
      : { kind: "orthographic" as const, scale: authoredPose.projection.scale * p.camera.distanceFactor }
    : useOffset && authoredPose.fov
      ? { kind: "perspective" as const, fovDeg: authoredPose.fov }
      : p.camera.projection.kind === "orthographic"
        ? { kind: "orthographic" as const, scale: p.camera.projection.scale * unit }
        : p.camera.projection;
  const lights = p.lighting.lights.map(light => ({ ...light, position: light.position.map((value, i) =>
    (relative ? center[i] : 0) + value * unit) as [number, number, number] }));
  return { camera: { position, target, rollDeg: p.camera.rollDeg, fov: projection.kind === "perspective" ? projection.fovDeg : 32, projection },
    lights, exposure: p.lighting.exposure, environment: p.lighting.environment, mode: p.lighting.mode, radius };
}

/** Canonical JSON is safe to save, diff, copy and import in another host. */
export function serializeCameraLightingPreset(preset: CameraLightingPreset): string {
  return JSON.stringify(validateCameraLightingPreset(preset), null, 2);
}

/** Preview offsets inherit the authored lens; replace-shot deliberately selects the preset lens. */
export function selectCameraLightingProjection(preset: CameraLightingPreset,
  authoredKind: CameraLightingProjection["kind"]): CameraLightingProjection["kind"] {
  return preset.mode === "preview-offset" ? authoredKind : preset.camera.projection.kind;
}
