import { stableStringify } from "./serialize";
import { isEasingSpec } from "./easing";
import { validCameraQuaternion, validCameraVector } from "./camera-targets";
import { CAMERA_MOTION_PROFILES, CAMERA_SHOT_RECIPES, resolveCameraProfile } from "./camera-shot-recipes";
import { prepareCameraPath } from "./camera-spatial";
import type { CameraDiagnostic, CameraSequenceSpec, CameraShotSpec } from "./cinematic-camera-types";
import type { Rect } from "./types";

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const integer = (v: unknown, min = 0) => Number.isSafeInteger(v) && Number(v) >= min;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const screenPoint = (v: unknown) => validCameraVector(v, 2) && v.every(x => x >= 0 && x <= 1);
const screenRect = (v: unknown): v is Rect => object(v) && [v.x, v.y, v.width, v.height].every(finite) && Number(v.x) >= 0 && Number(v.y) >= 0 && Number(v.width) > 0 && Number(v.height) > 0 && Number(v.x) + Number(v.width) <= 1 && Number(v.y) + Number(v.height) <= 1;

export function validateCameraSequence(input: unknown): { spec?: CameraSequenceSpec; diagnostics: CameraDiagnostic[] } {
  const diagnostics: CameraDiagnostic[] = [];
  const error = (path: string, message: string) => diagnostics.push({ code: "camera-sequence-invalid", severity: "error", path, message });
  let raw: Record<string, unknown>;
  try {
    let count = 0;
    const stack: Array<{ value: unknown; depth: number }> = [{ value: input, depth: 0 }];
    while (stack.length) {
      const { value, depth } = stack.pop()!;
      if (++count > 200_000 || depth > 48) throw new Error("Camera specification exceeds the 48-level / 200,000-value safety budget; split the sequence.");
      if (value && typeof value === "object") {
        if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error("Scene-engine objects are not portable shot data; pass them through a target registry.");
        for (const [key, child] of Object.entries(value)) {
          if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("Reserved data key in camera specification; rename it.");
          stack.push({ value: child, depth: depth + 1 });
        }
      }
    }
    const parsed = JSON.parse(stableStringify(input));
    if (!object(parsed)) throw new Error("Supply a camera sequence object.");
    raw = parsed;
  } catch (cause) { error("sequence", String(cause)); return { diagnostics }; }
  if (raw.schemaVersion !== 1) error("schemaVersion", "This camera compiler reads CC1 schemaVersion 1.");
  for (const key of ["id", "title"]) if (!text(raw[key])) error(key, `Supply a non-empty ${key}.`);
  if (raw.cameraId !== undefined && !text(raw.cameraId)) error("cameraId", "Use a non-empty camera target ID.");
  if (!object(raw.fps) || !integer(raw.fps.num, 1) || !integer(raw.fps.den, 1)) error("fps", "Use positive integer rational fps.num/den.");
  if (!integer(raw.durationFrames, 2) || Number(raw.durationFrames) > 36_000) error("durationFrames", "Use 2..36,000 frames per compiled camera sequence; split longer productions.");
  if (!object(raw.output) || !finite(raw.output.width) || !finite(raw.output.height) || raw.output.width <= 0 || raw.output.height <= 0) error("output", "Supply positive finite output width and height.");
  if (raw.maxCandidates !== undefined && (!integer(raw.maxCandidates, 1) || Number(raw.maxCandidates) > 24)) error("maxCandidates", "Set a bounded candidate budget from 1 to 24.");
  if (typeof raw.profile === "string" && !Object.prototype.hasOwnProperty.call(CAMERA_MOTION_PROFILES, raw.profile)) error("profile", "Choose editorial, technical, cinematic, expressive or numeric overrides.");
  else if (raw.profile !== undefined && typeof raw.profile !== "string" && !object(raw.profile)) error("profile", "Use a named or numeric camera profile.");
  else {
    const profile = resolveCameraProfile(raw.profile as CameraSequenceSpec["profile"]);
    if (!isEasingSpec(profile.easing) || ![profile.intensity, profile.margin, profile.holdFraction, profile.orbitDegrees].every(finite) || profile.intensity < 0 || profile.intensity > 2 || profile.margin < 0 || profile.margin >= 0.45 || profile.holdFraction < 0 || profile.holdFraction > 0.5 || !integer(profile.smoothingFrames) || profile.smoothingFrames > 60 || !integer(profile.transitionFrames, 2)) error("profile", "Use finite intensity 0..2, margin <0.45, holdFraction 0..0.5, smoothingFrames 0..60 and transitionFrames >=2 with MG1 easing.");
    for (const key of ["maxTravelPerFrame", "maxAccelerationPerFrame"] as const) if (profile[key] !== undefined && (!finite(profile[key]) || profile[key]! <= 0)) error(`profile.${key}`, "Motion limits must be positive finite world-unit/frame values.");
  }
  function composition(value: unknown, path: string) {
    if (value === undefined) return;
    if (!object(value)) { error(path, "Use a normalized camera composition object."); return; }
    if (value.subjectPosition !== undefined && !screenPoint(value.subjectPosition)) error(`${path}.subjectPosition`, "Use normalized [x,y] inside the viewport.");
    for (const key of ["safeMargin", "reserveRight", "headroom"]) if (value[key] !== undefined && (!finite(value[key]) || Number(value[key]) < 0 || Number(value[key]) >= 0.5)) error(`${path}.${key}`, "Use a finite fraction in [0, 0.5).");
    if (value.safeRegion !== undefined && !screenRect(value.safeRegion)) error(`${path}.safeRegion`, "Use a positive normalized rectangle fully inside the viewport.");
    if (value.exclusions !== undefined && (!Array.isArray(value.exclusions) || value.exclusions.length > 16 || !value.exclusions.every(screenRect))) error(`${path}.exclusions`, "Supply at most 16 normalized text-exclusion rectangles.");
    const margin = Number(value.safeMargin ?? 0.08);
    if (!value.safeRegion && (1 - margin * 2 - Number(value.reserveRight ?? 0) <= 0 || 1 - margin * 2 - Number(value.headroom ?? 0) <= 0)) error(path, "Margins/reserved space leave no subject area; reduce them or provide a safeRegion.");
  }
  function overrides(value: unknown, path: string) {
    if (value === undefined) return;
    if (!object(value)) { error(path, "Use serializable camera pose overrides."); return; }
    for (const key of ["position", "endPosition", "focus", "endFocus", "viewingDirection"]) if (value[key] !== undefined && !validCameraVector(value[key])) error(`${path}.${key}`, "Use finite XYZ.");
    if (value.viewingDirection && validCameraVector(value.viewingDirection) && Math.hypot(...value.viewingDirection) < 1e-8) error(`${path}.viewingDirection`, "Viewing direction cannot be zero.");
    for (const key of ["orientation", "endOrientation"]) if (value[key] !== undefined && !validCameraQuaternion(value[key])) error(`${path}.${key}`, "Use a normalized XYZW quaternion.");
    for (const key of ["distance", "orthographicScale", "near", "far", "focusDistance", "endFocusDistance"]) if (value[key] !== undefined && (!finite(value[key]) || Number(value[key]) <= 0)) error(`${path}.${key}`, "Use a positive finite value.");
    if (value.distanceScale !== undefined && (!finite(value.distanceScale) || Number(value.distanceScale) < 1 || Number(value.distanceScale) > 12)) error(`${path}.distanceScale`, "Use a fitted-distance scale from 1 to 12 (context widening only).");
    if (value.distanceScale !== undefined && value.distance !== undefined) error(path, "Use distanceScale or the absolute distance override, not both.");
    if (value.distanceScale !== undefined && value.orthographicScale !== undefined) error(path, "distanceScale cannot be combined with a fixed orthographicScale; choose one projection size control.");
    for (const key of ["fov", "endFov"]) if (value[key] !== undefined && (!finite(value[key]) || Number(value[key]) < 5 || Number(value[key]) > 120)) error(`${path}.${key}`, "Perspective FOV must be 5..120 degrees.");
    if (value.roll !== undefined && !finite(value.roll)) error(`${path}.roll`, "Roll must be finite degrees.");
    if (value.allowCorrections !== undefined && typeof value.allowCorrections !== "boolean") error(`${path}.allowCorrections`, "Use a boolean correction policy.");
    if (finite(value.near) && finite(value.far) && value.far <= value.near) error(path, "Clipping requires 0 < near < far.");
  }
  const ids = new Set<string>();
  if (!Array.isArray(raw.shots) || !raw.shots.length || raw.shots.length > 1000) error("shots", "Supply 1..1000 semantic camera shots.");
  for (const [i, shot] of (Array.isArray(raw.shots) ? raw.shots : []).entries()) {
    const path = `shots[${i}]`;
    if (!object(shot)) { error(path, "A shot must be an object."); continue; }
    if (!text(shot.id) || ids.has(String(shot.id))) error(`${path}.id`, "Give each shot a unique, non-empty ID."); else ids.add(String(shot.id));
    for (const field of ["title", "objective"]) if (shot[field] !== undefined && !text(shot[field])) error(`${path}.${field}`, "Use non-empty readable text.");
    if (!CAMERA_SHOT_RECIPES.includes(shot.type as never)) error(`${path}.type`, `Choose ${CAMERA_SHOT_RECIPES.join(", ")}.`);
    if (!(text(shot.target) || (Array.isArray(shot.target) && shot.target.length > 0 && shot.target.length <= 64 && shot.target.every(text) && new Set(shot.target).size === shot.target.length))) error(`${path}.target`, "Name one semantic target or up to 64 distinct target IDs.");
    if (shot.endTarget !== undefined && !text(shot.endTarget)) error(`${path}.endTarget`, "Supply a semantic destination target ID.");
    if (!integer(shot.durationFrames, 2)) error(`${path}.durationFrames`, "Each shot needs at least two integer frames.");
    if (shot.framing !== undefined && !["wide", "medium", "close", "extreme-close"].includes(String(shot.framing))) error(`${path}.framing`, "Choose wide, medium, close or extreme-close.");
    if (shot.projection !== undefined && !["perspective", "orthographic"].includes(String(shot.projection))) error(`${path}.projection`, "Choose perspective or orthographic.");
    if (shot.movement !== undefined && !["hold", "slow-dolly", "dolly-in", "dolly-out"].includes(String(shot.movement))) error(`${path}.movement`, "Choose hold, slow-dolly, dolly-in or dolly-out.");
    if (shot.followSide !== undefined && !["leading", "trailing"].includes(String(shot.followSide))) error(`${path}.followSide`, "Choose leading or trailing follow placement.");
    for (const key of ["orbitDegrees", "azimuth", "elevation", "endElevation"]) if (shot[key] !== undefined && (!finite(shot[key]) || (key.includes("levation") && Math.abs(Number(shot[key])) >= 89))) error(`${path}.${key}`, "Use finite degrees, with elevation inside ±89°.");
    for (const key of ["leadFrames", "smoothingFrames", "holdFrames"]) if (shot[key] !== undefined && (!integer(shot[key]) || Number(shot[key]) >= Number(shot.durationFrames) - 1 || (key === "smoothingFrames" && Number(shot[key]) > 60))) error(`${path}.${key}`, "Use non-negative integer frames below duration-1; smoothing is capped at 60.");
    if (shot.easing !== undefined && !isEasingSpec(shot.easing)) error(`${path}.easing`, "Use existing MG1 easing.");
    composition(shot.composition, `${path}.composition`); overrides(shot.overrides, `${path}.overrides`);
    if (shot.aspects !== undefined) {
      if (!object(shot.aspects)) error(`${path}.aspects`, "Use named aspect overrides.");
      else for (const [key, variant] of Object.entries(shot.aspects)) {
        if (!object(variant)) { error(`${path}.aspects.${key}`, "Use a framing/composition/overrides object."); continue; }
        if (Object.keys(variant).some(field => !["framing", "composition", "overrides"].includes(field))) error(`${path}.aspects.${key}`, "Aspect variants support only framing, composition and overrides. Keep timing, targets, paths and constraints on the validated shot.");
        composition(variant.composition, `${path}.aspects.${key}.composition`); overrides(variant.overrides, `${path}.aspects.${key}.overrides`);
        if (variant.framing !== undefined && !["wide", "medium", "close", "extreme-close"].includes(String(variant.framing))) error(`${path}.aspects.${key}.framing`, "Use a supported framing size.");
      }
    }
    for (const key of ["path", "focusPath"]) if (shot[key] !== undefined) {
      try { prepareCameraPath(shot[key] as never); } catch (cause) { error(`${path}.${key}`, String(cause)); }
    }
    if (shot.type === "fly-through" && shot.path === undefined) error(`${path}.path`, "Fly-through shots need an authored CameraPath.");
    if (shot.orientationPath !== undefined && (!object(shot.orientationPath) || !validCameraQuaternion(shot.orientationPath.from) || !validCameraQuaternion(shot.orientationPath.to))) error(`${path}.orientationPath`, "Use normalized from/to XYZW quaternions.");
    if (shot.orientAlongPath !== undefined && typeof shot.orientAlongPath !== "boolean") error(`${path}.orientAlongPath`, "Use a boolean path-orientation policy.");
    if (shot.transition !== undefined) {
      const t = shot.transition;
      if (!object(t) || !["cut", "continuous"].includes(String(t.kind))) error(`${path}.transition`, "Declare an intentional cut or continuous transition.");
      else if (t.kind === "continuous") {
        if (t.durationFrames !== undefined && (!integer(t.durationFrames, 2) || Number(t.durationFrames) > Number(shot.durationFrames))) error(`${path}.transition.durationFrames`, "Transition must have 2..shot.durationFrames integer frames.");
        if (t.continuity !== undefined && !["C0", "C1"].includes(String(t.continuity))) error(`${path}.transition.continuity`, "Choose C0 or C1.");
        if (t.allowPartialFraming !== undefined && typeof t.allowPartialFraming !== "boolean") error(`${path}.transition.allowPartialFraming`, "Use an explicit boolean partial-framing policy.");
      }
    }
    if (shot.constraints !== undefined && (!Array.isArray(shot.constraints) || shot.constraints.length > 32)) error(`${path}.constraints`, "Use at most 32 explicit camera constraints.");
    const constraintIds = new Set<string>();
    for (const [j, c] of (Array.isArray(shot.constraints) ? shot.constraints : []).entries()) {
      const p = `${path}.constraints[${j}]`;
      if (!object(c) || !text(c.id) || !["hard", "soft"].includes(String(c.strength)) || !finite(c.priority) || (c.tolerance !== undefined && (!finite(c.tolerance) || c.tolerance < 0))) { error(p, "Constraints need an ID, hard/soft strength, finite priority and non-negative tolerance."); continue; }
      if (constraintIds.has(String(c.id))) error(p, "Constraint IDs must be unique inside each shot.");
      constraintIds.add(String(c.id));
      if (c.kind === "framing") { if (c.region !== undefined && !screenRect(c.region)) error(p, "Framing region must be a normalized screen rectangle."); }
      else if (c.kind === "collision") { if (!finite(c.clearance) || c.clearance < 0) error(p, "Collision clearance must be finite and non-negative."); }
      else if (c.kind === "occlusion") { if (!finite(c.minimumVisible) || c.minimumVisible < 0 || c.minimumVisible > 1) error(p, "Minimum visibility must be between 0 and 1."); }
      else if (c.kind === "placement") { if (!screenPoint(c.position)) error(p, "Placement needs normalized [x,y]."); }
      else if (c.kind === "distance") { if (!finite(c.min) || !finite(c.max) || c.min < 0 || c.max < c.min) error(p, "Distance requires 0 <= min <= max."); }
      else error(p, "Unknown camera constraint kind.");
    }
  }
  if (raw.anchors !== undefined && !Array.isArray(raw.anchors)) error("anchors", "Supply named {id, at} timeline anchors.");
  else for (const [i, anchor] of (Array.isArray(raw.anchors) ? raw.anchors : []).entries()) if (!object(anchor) || !text(anchor.id) || anchor.at === undefined) error(`anchors[${i}]`, "Each anchor needs a non-empty ID and an at frame/reference.");
  if (diagnostics.length) return { diagnostics };
  return { spec: raw as unknown as CameraSequenceSpec, diagnostics };
}

/** Merge selected aspect data before planning; the generic shot stays immutable. */
export function resolveCameraShotAspect(shot: CameraShotSpec, output: CameraSequenceSpec["output"]): CameraShotSpec {
  const key = output.variant ?? (Math.abs(output.width / output.height - 16 / 9) < 0.001 ? "16:9" : Math.abs(output.width / output.height - 9 / 16) < 0.001 ? "9:16" : output.width === output.height ? "1:1" : `${output.width}:${output.height}`);
  const override = shot.aspects?.[key];
  return override ? { ...shot, framing: override.framing ?? shot.framing, composition: { ...shot.composition, ...override.composition }, overrides: { ...shot.overrides, ...override.overrides } } : shot;
}
