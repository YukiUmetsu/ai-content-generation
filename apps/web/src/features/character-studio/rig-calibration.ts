import type { CharacterPackDefinition, CharacterPackPart } from "./character-pack";

/** Editable authoring data; values stay as text until the manifest is exported. */
export interface RigPlacementInput {
  pivotX: string;
  pivotY: string;
  x: string;
  y: string;
  rotation: string;
  scaleX: string;
  scaleY: string;
}

export type RigPlacementInputs = Record<string, RigPlacementInput>;

const identity = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };

export function initialRigPlacements(definition: CharacterPackDefinition): RigPlacementInputs {
  const result: RigPlacementInputs = Object.create(null) as RigPlacementInputs;
  for (const part of definition.parts) {
    const rest = { ...identity, ...part.rest };
    result[part.id] = {
      pivotX: String(part.pivot.x), pivotY: String(part.pivot.y),
      x: String(rest.x), y: String(rest.y), rotation: String(rest.rotation),
      scaleX: String(rest.scaleX), scaleY: String(rest.scaleY),
    };
  }
  return result;
}

function numeric(value: string, part: string, field: keyof RigPlacementInput): number {
  if (typeof value !== "string" || !value.trim()) throw Error(`${part} ${field} must be a finite number.`);
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > 100_000) throw Error(`${part} ${field} must be a finite number within 100000.`);
  if ((field === "scaleX" || field === "scaleY") && (Math.abs(number) < 0.02 || Math.abs(number) > 10)) {
    throw Error(`${part} ${field} cannot collapse the image or exceed 10× scale.`);
  }
  return number;
}

/** Build a candidate manifest, never mutate the verified input or the ZIP saved on the server. */
export function calibrateRigDefinition(
  definition: CharacterPackDefinition,
  changes: RigPlacementInputs,
  revision: string,
): CharacterPackDefinition {
  if (!revision.trim() || new TextEncoder().encode(revision).length > 64 ||
      [...revision].some(char => (char.charCodeAt(0) < 32 || (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159) || char === "/" || char === "\\"))) {
    throw Error("Enter a readable new revision (1–64 UTF-8 bytes; no slashes or control characters).");
  }
  if (revision === definition.revision) throw Error("Use a new revision to preserve the imported ZIP and its immutable identity.");
  const partIds = new Set(definition.parts.map(part => part.id));
  for (const id of Object.keys(changes)) if (!partIds.has(id)) throw Error(`Unknown character part: ${id}`);
  let edited = false;
  const parts: CharacterPackPart[] = definition.parts.map(part => {
    const entry = changes[part.id];
    if (!entry) return part;
    const pivot = { x: numeric(entry.pivotX, part.id, "pivotX"), y: numeric(entry.pivotY, part.id, "pivotY") };
    const rest = {
      x: numeric(entry.x, part.id, "x"), y: numeric(entry.y, part.id, "y"), rotation: numeric(entry.rotation, part.id, "rotation"),
      scaleX: numeric(entry.scaleX, part.id, "scaleX"), scaleY: numeric(entry.scaleY, part.id, "scaleY"),
    };
    const previous = { ...identity, ...part.rest };
    if (pivot.x === part.pivot.x && pivot.y === part.pivot.y &&
        rest.x === previous.x && rest.y === previous.y && rest.rotation === previous.rotation &&
        rest.scaleX === previous.scaleX && rest.scaleY === previous.scaleY) return part;
    edited = true;
    return { ...part, pivot, rest };
  });
  if (!edited) throw Error("Change at least one placement value before exporting a new revision.");
  return { ...definition, revision, parts };
}
