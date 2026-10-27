import type { CharacterPackDefinition } from "./character-pack";

/** An inventory of declarations, not a Kumiki validation or render approval. */
export interface RigMetadataInventory {
  poses: string[];
  actions: string[];
  expressions: string[];
  variants: number;
  restTransforms: number;
  speechDeclared: boolean;
  anchors: number;
}

function keys(value: unknown): string[] {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value)
    : [];
}

export function summarizeRigMetadata(definition: CharacterPackDefinition): RigMetadataInventory {
  const expressionData = definition.expressions as unknown;
  const expressionSets = expressionData !== null && typeof expressionData === "object" && !Array.isArray(expressionData)
    ? (expressionData as Record<string, unknown>).sets : undefined;
  return {
    poses: keys(definition.poses),
    actions: keys(definition.actions),
    expressions: keys(expressionSets),
    variants: definition.parts.reduce((count, part) => count + keys(part.variants).length, 0),
    restTransforms: definition.parts.filter(part => part.rest !== undefined).length,
    speechDeclared: keys(definition.speech).length > 0,
    anchors: keys(definition.anchors).length,
  };
}
