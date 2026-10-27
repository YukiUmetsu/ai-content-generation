/** Pure, renderer-agnostic rig and pose editing utilities. No media clock or UI state. */
import { applyMatrixToVector, invertMatrix, multiplyMatrix, rotationMatrix, scaleMatrix } from "../motion/matrix";
import type { AffineMatrix } from "../motion/types";
import type {
  CharacterPart, CharacterPoseCorrectionKey, CharacterPoseCorrectionTracks,
  CharacterPoseDelta, CharacterPose2D, CharacterVec2,
} from "./definition";

const fields = ["x", "y", "rotation", "scaleX", "scaleY"] as const;
const identity: CharacterPose2D = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
const validFrame = (frame: number) => Number.isSafeInteger(frame) && frame >= 0 && frame <= 10_000_000;
const within = (value: number) => Number.isFinite(value) && Math.abs(value) <= 100_000;

function checkPoint(point: CharacterVec2): void {
  if (!within(point.x) || !within(point.y)) throw Error("Joint and part positions must be finite bounded coordinates.");
}

/** Change the part rest translation; descendants follow their parent hierarchy normally. */
export function moveCharacterRest(part: CharacterPart, point: CharacterVec2): CharacterPart {
  checkPoint(point);
  return { ...part, rest: { ...part.rest, x: point.x, y: point.y } };
}

/**
 * Shift the local rotation/attachment point while preserving the unrotated drawing's
 * actual world location in the current rest pose. Handles rotated/non-uniformly scaled
 * parts; the pivot handle itself moves, not the artwork. No humanoid assumptions.
 */
export function moveCharacterJoint(part: CharacterPart, pivot: CharacterVec2): CharacterPart {
  checkPoint(pivot);
  const old = part.pivot;
  const dx = pivot.x - old.x, dy = pivot.y - old.y;
  const rest = { ...identity, ...part.rest };
  const linear = multiplyMatrix(scaleMatrix(rest.scaleX, rest.scaleY), rotationMatrix(rest.rotation * Math.PI / 180));
  const moved = applyMatrixToVector(linear, { x: dx, y: dy });
  return {
    ...part,
    pivot: { ...pivot },
    rest: { ...part.rest, x: rest.x + moved.x - dx, y: rest.y + moved.y - dy },
  };
}

/** A pointer delta in world design pixels expressed relative to an arbitrary parent. */
export function worldDragToParentDelta(worldDelta: CharacterVec2, parentWorld: AffineMatrix): CharacterVec2 {
  checkPoint(worldDelta);
  const inverse = invertMatrix(parentWorld);
  if (!inverse) throw Error("Cannot drag a joint through a singular parent transform.");
  return applyMatrixToVector(inverse, worldDelta);
}

function validatePose(pose: CharacterPoseDelta): void {
  for (const [name, value] of Object.entries(pose)) {
    if (!fields.includes(name as typeof fields[number]) || typeof value !== "number" || !within(value)) {
      throw Error(`Correction ${name} must be a finite bounded transform.`);
    }
    if ((name === "scaleX" || name === "scaleY") && (value < 0.02 || value > 10)) {
      throw Error("Correction scale must stay between 0.02 and 10.");
    }
  }
}

/** Validate imported tracks and produce a predictable, non-mutating view for evaluation. */
export function isValidCorrectionKeys(value: unknown): value is CharacterPoseCorrectionKey[] {
  if (!Array.isArray(value) || value.length > 512) return false;
  let previous = -1;
  for (const key of value) {
    if (!key || typeof key !== "object" || !validFrame(key.frame) || key.frame <= previous ||
        !key.pose || typeof key.pose !== "object" || Array.isArray(key.pose)) return false;
    try { validatePose(key.pose); } catch { return false; }
    previous = key.frame;
  }
  return true;
}

/** Sample a correction independently of playback order, with bounded C1 smoothstep easing. */
export function samplePoseCorrection(tracks: CharacterPoseCorrectionTracks, partId: string, frame: number): CharacterPoseDelta {
  const keys = tracks[partId];
  if (!keys?.length || !isValidCorrectionKeys(keys) || !Number.isFinite(frame)) return {};
  const names = new Set(keys.flatMap(key => Object.keys(key.pose)) as Array<keyof CharacterPose2D>);
  const empty = Object.fromEntries([...names].map(name => [name, identity[name]])) as CharacterPoseDelta;
  if (frame < keys[0].frame) return empty;
  if (frame >= keys[keys.length - 1].frame) return { ...empty, ...keys[keys.length - 1].pose };
  let lo = 0, hi = keys.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1;
    if (keys[mid].frame <= frame) lo = mid;
    else hi = mid;
  }
  const from = keys[lo], to = keys[hi];
  const t = (frame - from.frame) / (to.frame - from.frame);
  const ease = t * t * (3 - 2 * t);
  const result: CharacterPoseDelta = {};
  for (const name of names) result[name] = (from.pose[name] ?? identity[name]) * (1 - ease) + (to.pose[name] ?? identity[name]) * ease;
  return result;
}

/** Insert a localized edit; immutable end anchors preserve the old motion outside the window. */
export function insertPoseCorrection(
  tracks: CharacterPoseCorrectionTracks,
  partId: string,
  frame: number,
  pose: CharacterPoseDelta,
  radius = 12,
): CharacterPoseCorrectionTracks {
  if (!validFrame(frame)) throw Error("Correction frame must be a non-negative integer within the supported range.");
  if (!Number.isSafeInteger(radius) || radius < 1 || radius > 300) throw Error("Correction influence radius must be 1–300 frames.");
  if (!partId || partId.length > 80 || ["__proto__", "constructor", "prototype"].includes(partId)) throw Error("Invalid character part ID.");
  validatePose(pose);
  const old = tracks[partId] ?? [];
  if (!isValidCorrectionKeys(old)) throw Error("Existing correction track is malformed.");
  const left = Math.max(0, frame - radius);
  const right = Math.min(10_000_000, frame + radius);
  const additions: CharacterPoseCorrectionKey[] = [];
  if (left < frame) additions.push({ frame: left, pose: samplePoseCorrection(tracks, partId, left) });
  additions.push({ frame, pose: { ...pose } });
  if (right > frame) additions.push({ frame: right, pose: samplePoseCorrection(tracks, partId, right) });
  const keys = [...old.filter(key => key.frame < left || key.frame > right), ...additions].sort((a, b) => a.frame - b.frame);
  if (keys.length > 512) throw Error("Too many correction keys on one part.");
  return { ...tracks, [partId]: keys };
}
