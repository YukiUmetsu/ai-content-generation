import { partLocalMatrix } from "@/components/character/evaluate";
import { validateCharacterDefinition } from "@/components/character/validate";
import { IDENTITY, multiplyMatrix } from "@/components/motion/matrix";
import type { AffineMatrix } from "@/components/motion/types";
import type { CharacterDefinition, CharacterFrameState, CharacterPart, CharacterVec2 } from "@/components/character/definition";
import type { CharacterPackDefinition } from "./character-pack";
import type { RigPlacementInputs } from "./rig-calibration";

const fallback = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
const numeric = (text: string | undefined, old: number, scale = false): number => {
  if (text === undefined || !text.trim()) return old;
  const next = Number(text);
  if (!Number.isFinite(next) || Math.abs(next) > 100_000 || (scale && (Math.abs(next) < 0.02 || Math.abs(next) > 10))) return old;
  return next;
};

/** Build only from structurally checked ZIP data; unknown or broken actions never run. */
export function prepareCharacterPreview(source: CharacterPackDefinition, placements: RigPlacementInputs): {
  definition: CharacterDefinition;
  actions: string[];
  limited: boolean;
} {
  const parts: CharacterPart[] = source.parts.map(part => {
    const entry = placements[part.id];
    if (!entry) return part;
    const rest = { ...fallback, ...part.rest };
    return { ...part,
      pivot: { x: numeric(entry.pivotX, part.pivot.x), y: numeric(entry.pivotY, part.pivot.y) },
      rest: {
        x: numeric(entry.x, rest.x), y: numeric(entry.y, rest.y),
        rotation: numeric(entry.rotation, rest.rotation),
        scaleX: numeric(entry.scaleX, rest.scaleX, true), scaleY: numeric(entry.scaleY, rest.scaleY, true),
      },
    };
  });
  const safe: CharacterDefinition = {
    schemaVersion: 1, characterId: source.characterId, revision: source.revision,
    design: source.design, mode: source.mode, channels: source.channels, palette: source.palette,
    assets: source.assets, parts, poses: source.poses, basePose: source.basePose,
    actions: {}, expressions: { default: "neutral", sets: { neutral: {} } }, capabilities: source.capabilities,
  };
  // Optionally perform imported actions/expressions, but only if Kumiki accepts
  // the complete imported document. An inspector import alone is not approval.
  if (source.actions && source.expressions) {
    try {
      const complete = { ...source, parts } as CharacterDefinition;
      if (!validateCharacterDefinition(complete).some(item => item.severity === "error")) {
        return { definition: complete, actions: Object.keys(complete.actions), limited: false };
      }
    } catch { /* Untrusted optional animation metadata is not executed. */ }
  }
  return { definition: safe, actions: [], limited: true };
}

/** Rigging uses uncluttered rest geometry, never residual motion from the editor's last clip. */
export function restCharacterDefinition(definition: CharacterDefinition): CharacterDefinition {
  return {
    ...definition,
    poses: { ...definition.poses, [definition.basePose]: {} },
    expressions: { default: "neutral", sets: { neutral: {} } },
    actions: {}, idle: undefined, gaze: undefined, blink: undefined,
  };
}

/** Resolve Kumiki's nested pivot transforms for editor handles (not a second renderer). */
export function characterPartWorldMatrices(definition: CharacterDefinition, frame: CharacterFrameState): Map<string, AffineMatrix> {
  const parts = new Map(definition.parts.map(part => [part.id, part]));
  const world = new Map<string, AffineMatrix>();
  const resolving = new Set<string>();
  const find = (id: string): AffineMatrix => {
    const cached = world.get(id);
    if (cached) return cached;
    if (resolving.has(id)) return IDENTITY;
    const part = parts.get(id), state = frame.parts[id];
    if (!part || !state) return IDENTITY;
    resolving.add(id);
    const matrix = part.parent && parts.has(part.parent)
      ? multiplyMatrix(partLocalMatrix(part, state), find(part.parent))
      : partLocalMatrix(part, state);
    world.set(id, matrix);
    resolving.delete(id);
    return matrix;
  };
  for (const part of definition.parts) find(part.id);
  return world;
}

/** Overlay matches the presenter's aspect ratio, so screen and design axes align. */
export function screenDragToDesign(
  screen: CharacterVec2,
  viewport: { width: number; height: number },
  design: { width: number; height: number },
): CharacterVec2 {
  if (![screen.x, screen.y, viewport.width, viewport.height, design.width, design.height].every(Number.isFinite) ||
      viewport.width <= 0 || viewport.height <= 0 || design.width <= 0 || design.height <= 0) {
    throw Error("Invalid viewport size for a character drag.");
  }
  return { x: screen.x * design.width / viewport.width, y: screen.y * design.height / viewport.height };
}
