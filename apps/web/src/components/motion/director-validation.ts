import type { AnimationTrack, Diagnostic, MotionValueType } from "./types";
import type { MotionDirection } from "./director-types";
import { validateTimeline } from "./validate";
import { validateValue } from "./interpolate";
import { prepareVisualScene } from "./visual-transformation-scene";
import { isEasingSpec } from "./easing";

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const frames = (v: unknown, min = 0) => Number.isSafeInteger(v) && (v as number) >= min;
const valueTypes: MotionValueType[] = ["number", "opacity", "length", "angle", "vec2", "transform", "color", "path", "boolean", "discrete"];

/** Validate untrusted fragments before the compiler touches their structure. */
export function validateMotionDirection(input: unknown): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const error = (path: string, message: string) => diagnostics.push({ code: "director-invalid-data", severity: "error", path, message } as Diagnostic);
  const ancestors = new WeakSet<object>();
  let count = 0;
  function safe(value: unknown, path: string, depth: number) {
    if (++count > 500_000 || depth > 64) throw new Error(`${path}: document exceeds the 64-level / 500,000-value safety budget; split the production.`);
    if (value === undefined || value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (typeof value !== "object") throw new Error(`${path}: use finite JSON data, not ${typeof value}.`);
    if (ancestors.has(value)) throw new Error(`${path}: cyclic data cannot be serialized; use an ID reference.`);
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error(`${path}: engine instances are not portable data; supply plain objects.`);
    ancestors.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error(`${path}.${key}: reserved data key; rename it.`);
      safe(child, `${path}.${key}`, depth + 1);
    }
    ancestors.delete(value);
  }
  try { safe(input, "direction", 0); } catch (cause) { error("direction", String(cause)); return diagnostics; }
  if (!record(input)) { error("direction", "Supply a MotionDirection object."); return diagnostics; }
  if (input.schemaVersion !== 1) error("schemaVersion", "Unsupported choreography version; this compiler reads schemaVersion 1.");
  for (const field of ["id", "title"]) if (!text(input[field])) error(field, `Supply a non-empty ${field}.`);
  if (!frames(input.durationFrames, 1)) error("durationFrames", "Set durationFrames to a positive safe integer.");
  if (!record(input.fps) || !frames(input.fps.num, 1) || !frames(input.fps.den, 1)) error("fps", "Use positive integer fps.num and fps.den.");
  if (!Array.isArray(input.targets) || !input.targets.every(text) || new Set(input.targets).size !== input.targets.length) error("targets", "Declare unique, non-empty target IDs, including cameras and effects.");
  if (input.profile !== undefined) {
    if (!record(input.profile)) error("profile", "Use an intensity/pacing/personality object.");
    else {
      const { intensity, pacing, personality } = input.profile;
      if (intensity !== undefined && (typeof intensity !== "number" || intensity < 0 || intensity > 1)) error("profile.intensity", "Set intensity between 0 and 1.");
      if (pacing !== undefined && (typeof pacing !== "number" || pacing < 0.25 || pacing > 4)) error("profile.pacing", "Set pacing between 0.25 and 4.");
      if (personality !== undefined && !["precise", "gentle", "expressive"].includes(String(personality))) error("profile.personality", "Choose precise, gentle or expressive.");
    }
  }
  const ids = new Set<string>();
  const authoredDuration = Number(input.durationFrames);
  function time(value: unknown, path: string) {
    if (value === undefined) return;
    if (typeof value === "number") { if (!frames(value)) error(path, "Local at must be a non-negative integer frame."); return; }
    if (!record(value) || !text(value.ref) || (value.edge !== undefined && value.edge !== "start" && value.edge !== "end") || (value.offsetFrames !== undefined && !Number.isSafeInteger(value.offsetFrames))) error(path, "Use { ref: nodeOrCueId, edge: 'start' | 'end', offsetFrames: integer }.");
  }
  function children(value: unknown, path: string) {
    if (!Array.isArray(value)) { error(path, "Supply a children array (use [] for an empty group)."); return; }
    for (const [index, raw] of value.entries()) {
      const p = `${path}[${index}]`;
      if (!record(raw)) { error(p, "Each choreography node must be a plain object."); continue; }
      if (!text(raw.id) || ids.has(raw.id)) error(`${p}.id`, `Node ID "${String(raw.id)}" is empty or duplicated; give every node a globally unique ID.`);
      else ids.add(raw.id);
      time(raw.at, `${p}.at`);
      if (raw.after !== undefined && (!Array.isArray(raw.after) || !raw.after.every(text))) error(`${p}.after`, "Use an array of node/cue IDs.");
      if (raw.durationFrames !== undefined && !frames(raw.durationFrames, raw.kind === "cue" ? 0 : 1)) error(`${p}.durationFrames`, "Use a positive integer duration (cues may have zero duration).");
      if (raw.recipe !== undefined && (!record(raw.recipe) || !text(raw.recipe.id) || !frames(raw.recipe.version, 1) || !record(raw.recipe.parameters) || !Object.values(raw.recipe.parameters).every(v => ["string", "number", "boolean"].includes(typeof v)))) error(`${p}.recipe`, "Recipe provenance needs id, positive version and scalar parameters.");
      switch (raw.kind) {
        case "animation": {
          if (!record(raw.track) || !text(raw.track.id) || !text(raw.track.targetId) || !text(raw.track.property) || !Array.isArray(raw.track.keyframes)) { error(`${p}.track`, "Supply an existing MG1 AnimationTrack with targetId, property and keyframes."); break; }
          if (!valueTypes.includes(raw.track.valueType as MotionValueType)) { error(`${p}.track.valueType`, `Use a supported MG1 valueType: ${valueTypes.join(", ")}.`); break; }
          if (!raw.track.keyframes.every(record)) { error(`${p}.track.keyframes`, "Each keyframe must be an object containing frame and value; remove nulls and invalid entries."); break; }
          const track = raw.track as unknown as AnimationTrack;
          const ds = validateTimeline({ schemaVersion: 1, id: "validation", fps: { num: 30, den: 1 }, durationFrames: authoredDuration, nodes: [{ kind: "track", id: "validation", track }] });
          diagnostics.push(...ds.filter(d => d.severity === "error" || d.code === "motion-keyframe-unordered").map(d => ({ ...d, path: `${p}.track${d.path?.replace(/^nodes\[0\]\.track/, "") ?? ""}` })));
          if (track.keyframes[0]?.frame !== 0) error(`${p}.track.keyframes`, "Start each animation at local frame 0; use node.at for placement.");
          if (raw.track.conflict !== undefined && !["error", "priority", "additive"].includes(String(raw.track.conflict))) error(`${p}.track.conflict`, "Choose MG1 error, priority or additive conflict handling.");
          if (raw.track.priority !== undefined && typeof raw.track.priority !== "number") error(`${p}.track.priority`, "Priority must be a finite number.");
          if (raw.track.angleMode !== undefined && !["shortest", "full-turn"].includes(String(raw.track.angleMode))) error(`${p}.track.angleMode`, "Choose shortest or full-turn.");
          if (raw.track.blend !== undefined && !["override", "additive"].includes(String(raw.track.blend))) error(`${p}.track.blend`, "Choose override or additive.");
          if (raw.track.easing !== undefined && !isEasingSpec(raw.track.easing)) error(`${p}.track.easing`, "Use an existing MG1 easing specification.");
          for (const [i, keyframe] of raw.track.keyframes.entries()) if (record(keyframe) && keyframe.easing !== undefined && !isEasingSpec(keyframe.easing)) error(`${p}.track.keyframes[${i}].easing`, "Use an existing MG1 easing specification.");
          if (raw.entry !== undefined && !["continuous", "cut"].includes(String(raw.entry))) error(`${p}.entry`, "Choose continuous or cut.");
          if (raw.intensityOrigin !== undefined) {
            const mismatch = validateValue(raw.track.valueType as never, raw.intensityOrigin as never);
            if (mismatch) diagnostics.push({ ...mismatch, path: `${p}.intensityOrigin` });
            if (!["number", "length", "angle", "vec2", "transform"].includes(String(raw.track.valueType))) error(`${p}.intensityOrigin`, "Intensity is for spatial/decorative channels; keep opacity, color and semantic state truthful.");
          }
          break;
        }
        case "group":
          if (!["sequence", "parallel", "stagger"].includes(String(raw.mode))) error(`${p}.mode`, "Choose sequence, parallel or stagger.");
          for (const field of ["intervalFrames", "overlapFrames"]) if (raw[field] !== undefined && !frames(raw[field])) error(`${p}.${field}`, "Use a non-negative integer frame count.");
          if (raw.mode === "stagger" && !frames(raw.intervalFrames)) error(`${p}.intervalFrames`, "Stagger requires a non-negative integer intervalFrames.");
          if (raw.direction !== undefined && !["forward", "reverse", "from-center", "from-edges"].includes(String(raw.direction))) error(`${p}.direction`, "Use an existing MG1 stagger direction.");
          if (raw.importedFps !== undefined && (!record(raw.importedFps) || !frames(raw.importedFps.num, 1) || !frames(raw.importedFps.den, 1))) error(`${p}.importedFps`, "Imported FPS needs positive integer num/den.");
          children(raw.children, `${p}.children`); break;
        case "shot":
          for (const field of ["sceneRef", "focusTarget", "claim", "visualObjective", "staticFallback"]) if (!text(raw[field])) error(`${p}.${field}`, `Shot needs ${field}.`);
          if (!Array.isArray(raw.onScreenLabels) || !raw.onScreenLabels.length || !raw.onScreenLabels.every(text)) error(`${p}.onScreenLabels`, "Supply concise on-screen labels.");
          if (!frames(raw.durationFrames, 1)) error(`${p}.durationFrames`, "A shot needs a positive durationFrames.");
          children(raw.children, `${p}.children`); break;
        case "hold":
          if (!frames(raw.durationFrames, 1)) error(`${p}.durationFrames`, "Hold needs a positive durationFrames."); break;
        case "transformation":
          if (!frames(raw.durationFrames, 2)) error(`${p}.durationFrames`, "A transformation needs at least two frames.");
          for (const field of ["fromScene", "toScene"]) if (!text(raw[field])) error(`${p}.${field}`, `Transformation needs ${field}.`);
          if (raw.easing !== undefined && !isEasingSpec(raw.easing)) error(`${p}.easing`, "Use an existing MG1 easing specification.");
          break;
        case "cue": {
          const payload = raw.payload;
          if (!record(payload)) { error(`${p}.payload`, "Supply a typed cue payload."); break; }
          const fields: Record<string, string[]> = { event: ["name"], narration: ["text", "language"], "speech-marker": ["narrationId", "marker"], "sound-effect": ["assetRef"], "music-beat": [] };
          if (!Object.prototype.hasOwnProperty.call(fields, String(payload.kind))) error(`${p}.payload.kind`, "Choose event, narration, speech-marker, sound-effect or music-beat.");
          else for (const field of fields[String(payload.kind)]) if (!text(payload[field])) error(`${p}.payload.${field}`, `Cue needs ${field}.`);
          if (payload.kind === "music-beat" && !frames(payload.beat)) error(`${p}.payload.beat`, "Music beats need a non-negative integer beat.");
          if (payload.bar !== undefined && !frames(payload.bar)) error(`${p}.payload.bar`, "Use a non-negative integer bar.");
          if (payload.gainDb !== undefined && typeof payload.gainDb !== "number") error(`${p}.payload.gainDb`, "Use finite gainDb.");
          break;
        }
        default: error(`${p}.kind`, `Unknown choreography kind "${String(raw.kind)}"; use animation, group, hold, cue, shot or transformation.`);
      }
    }
  }
  children(input.children, "children");
  if (input.scenes !== undefined && !Array.isArray(input.scenes)) error("scenes", "Supply an array of existing VT1 VisualScene snapshots.");
  const sceneIds = new Set<string>();
  for (const [index, scene] of ((Array.isArray(input.scenes) ? input.scenes : []) as unknown[]).entries()) {
    try {
      if (!record(scene) || !text(scene.id) || sceneIds.has(scene.id)) throw new Error("Scene IDs must be unique non-empty strings.");
      sceneIds.add(scene.id);
      prepareVisualScene(scene as unknown as NonNullable<MotionDirection["scenes"]>[number]);
    } catch (cause) { error(`scenes[${index}]`, `Invalid scene: ${String(cause)}`); }
  }
  return diagnostics;
}
