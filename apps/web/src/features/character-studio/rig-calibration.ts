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
export type RigLayerOverrides = Record<string, number>;
export type RigLayerMovement = "down" | "up" | "bottom" | "top";

const layerZ = (part: CharacterPackPart, overrides: RigLayerOverrides) => overrides[part.id] ?? part.z;

/** The nearest drawable stacking group, favoring own children when selected. */
function layerGroup(definition: CharacterPackDefinition, selectedId: string) {
  const selected = definition.parts.find(part => part.id === selectedId);
  if (!selected) return { parent: undefined, peers: [] as CharacterPackPart[] };
  const children = definition.parts.filter(part => part.parent === selectedId);
  if (children.length) return { parent: selected, peers: [selected, ...children] };
  const parent = selected.parent ? definition.parts.find(part => part.id === selected.parent) : undefined;
  const siblings = definition.parts.filter(part => part.parent === selected.parent);
  return { parent, peers: parent ? [parent, ...siblings] : siblings };
}

/** All drawable peers, including the body itself to let it cover wings. */
export function rigLayerPeers(definition: CharacterPackDefinition, overrides: RigLayerOverrides, selectedId: string): CharacterPackPart[] {
  const { parent, peers } = layerGroup(definition, selectedId);
  const inputOrder = new Map(definition.parts.map((part, index) => [part.id, index]));
  return peers.sort((a, b) => layerZ(a, overrides) - layerZ(b, overrides) ||
    (a.id === parent?.id ? -1 : b.id === parent?.id ? 1 : (inputOrder.get(a.id) ?? 0) - (inputOrder.get(b.id) ?? 0)));
}

/** Reorder visual layers without changing parentage or the occlusion within child subtrees. */
export function moveRigLayer(
  definition: CharacterPackDefinition, overrides: RigLayerOverrides, selectedId: string, movement: RigLayerMovement,
): RigLayerOverrides | null {
  const selected = definition.parts.find(part => part.id === selectedId);
  if (!selected) return null;
  const peers = rigLayerPeers(definition, overrides, selectedId);
  const from = peers.findIndex(part => part.id === selectedId);
  if (from < 0) return null;
  const to = movement === "up" ? from + 1 : movement === "down" ? from - 1
    : movement === "top" ? peers.length - 1 : 0;
  if (to < 0 || to >= peers.length || to === from) return null;
  const ordered = [...peers];
  ordered.splice(from, 1);
  ordered.splice(to, 0, selected);
  const parent = layerGroup(definition, selectedId).parent;
  const next = { ...overrides };
  const targetZ = new Map<string, number>();
  if (parent) {
    const parentIndex = ordered.findIndex(part => part.id === parent.id);
    const anchor = layerZ(parent, overrides);
    ordered.forEach((part, index) => {
      if (part.id === parent.id) return;
      targetZ.set(part.id, anchor + index - parentIndex);
    });
  } else {
    const first = -Math.floor(ordered.length / 2);
    ordered.forEach((part, index) => targetZ.set(part.id, first + index));
  }
  const children = new Map<string, CharacterPackPart[]>();
  for (const part of definition.parts) if (part.parent) {
    const branch = children.get(part.parent) ?? [];
    branch.push(part);
    children.set(part.parent, branch);
  }
  const shiftSubtree = (part: CharacterPackPart, delta: number) => {
    const value = layerZ(part, overrides) + delta;
    if (!Number.isFinite(value) || value < -1000 || value > 1000) throw Error("Layer order exceeds supported depth.");
    next[part.id] = value;
    for (const child of children.get(part.id) ?? []) shiftSubtree(child, delta);
  };
  try {
    for (const peer of peers) {
      const wanted = targetZ.get(peer.id);
      if (wanted === undefined) continue; // The parent's artwork is fixed in place.
      shiftSubtree(peer, wanted - layerZ(peer, overrides));
    }
  } catch { return null; }
  return next;
}

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
  layers: RigLayerOverrides = {},
): CharacterPackDefinition {
  if (!revision.trim() || new TextEncoder().encode(revision).length > 64 ||
      [...revision].some(char => (char.charCodeAt(0) < 32 || (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159) || char === "/" || char === "\\"))) {
    throw Error("Enter a readable new revision (1–64 UTF-8 bytes; no slashes or control characters).");
  }
  if (revision === definition.revision) throw Error("Use a new revision to preserve the imported ZIP and its immutable identity.");
  const partIds = new Set(definition.parts.map(part => part.id));
  for (const id of Object.keys(changes)) if (!partIds.has(id)) throw Error(`Unknown character part: ${id}`);
  for (const [id, z] of Object.entries(layers)) {
    if (!partIds.has(id)) throw Error(`Unknown character part: ${id}`);
    if (!Number.isFinite(z) || z < -1000 || z > 1000) throw Error(`${id} layer depth must be within −1000…1000.`);
  }
  let edited = false;
  const parts: CharacterPackPart[] = definition.parts.map(part => {
    const entry = changes[part.id];
    const z = layerZ(part, layers);
    if (!entry) {
      if (z !== part.z) edited = true;
      return z === part.z ? part : { ...part, z };
    }
    const pivot = { x: numeric(entry.pivotX, part.id, "pivotX"), y: numeric(entry.pivotY, part.id, "pivotY") };
    const rest = {
      x: numeric(entry.x, part.id, "x"), y: numeric(entry.y, part.id, "y"), rotation: numeric(entry.rotation, part.id, "rotation"),
      scaleX: numeric(entry.scaleX, part.id, "scaleX"), scaleY: numeric(entry.scaleY, part.id, "scaleY"),
    };
    const previous = { ...identity, ...part.rest };
    if (pivot.x === part.pivot.x && pivot.y === part.pivot.y &&
        rest.x === previous.x && rest.y === previous.y && rest.rotation === previous.rotation &&
        rest.scaleX === previous.scaleX && rest.scaleY === previous.scaleY && z === part.z) return part;
    edited = true;
    return { ...part, pivot, rest, z };
  });
  if (!edited) throw Error("Change at least one placement value or layer order before exporting a new revision.");
  return { ...definition, revision, parts };
}
