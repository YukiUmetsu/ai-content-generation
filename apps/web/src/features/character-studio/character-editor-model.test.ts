import { describe, expect, it } from "vitest";
import { prepareCharacterPreview, characterPartWorldMatrices, screenDragToDesign, restCharacterDefinition } from "./character-editor-model";
import { initialRigPlacements } from "./rig-calibration";
import type { CharacterPackDefinition } from "./character-pack";
import { evaluateCharacter } from "@/components/character/evaluate";
import type { CharacterInstance } from "@/components/character/definition";
import { applyMatrixToPoint } from "@/components/motion/matrix";

const sample: CharacterPackDefinition = {
  schemaVersion: 1, characterId: "short-legged-squirrel", revision: "r1", mode: "puppet-2.5d",
  design: { width: 800, height: 600 }, channels: ["body", "paws"], palette: {},
  assets: { art: { kind: "image", uri: "layers/art.png", mediaType: "image/png", width: 100, height: 100,
    provenance: { source: "original", license: "original" } } },
  parts: [
    { id: "body", channel: "body", asset: "art", pivot: { x: 0, y: 0 }, rest: { x: 200, y: 100, rotation: 90 }, z: 0 },
    { id: "paw", channel: "paws", parent: "body", asset: "art", pivot: { x: 10, y: 0 }, rest: { x: 30, y: 0 }, z: 1 },
  ],
  poses: { neutral: {} }, basePose: "neutral", capabilities: [],
};
const performer: CharacterInstance = { instanceId: "preview", characterId: sample.characterId, revision: sample.revision, seed: 1 };

describe("character editor model", () => {
  it("builds a safe, composed preview for imported packs without action metadata", () => {
    const placements = initialRigPlacements(sample);
    placements.paw.x = "45";
    const preview = prepareCharacterPreview(sample, placements);
    expect(preview.definition.parts.find(part => part.id === "paw")?.rest?.x).toBe(45);
    expect(preview.actions).toEqual([]);
    expect(preview.definition.expressions.default).toBe("neutral");
    expect(sample.parts[1].rest?.x).toBe(30);
  });

  it("transforms child joint handles through a rotated parent's hierarchy", () => {
    const preview = prepareCharacterPreview(sample, initialRigPlacements(sample));
    const frame = evaluateCharacter(preview.definition, performer, [], 0);
    const matrices = characterPartWorldMatrices(preview.definition, frame);
    const paw = preview.definition.parts[1];
    const pivotWorld = applyMatrixToPoint(matrices.get("paw")!, paw.pivot);
    expect(pivotWorld.x).toBeCloseTo(200);
    expect(pivotWorld.y).toBeCloseTo(140);
  });

  it("converts viewport drags to design pixels and rejects zero-size viewports", () => {
    expect(screenDragToDesign({ x: 40, y: -20 }, { width: 400, height: 300 }, sample.design)).toEqual({ x: 80, y: -40 });
    expect(() => screenDragToDesign({ x: 1, y: 1 }, { width: 0, height: 500 }, sample.design)).toThrow(/viewport/i);
  });

  it("shows raw rest geometry during rig edits even when the imported base pose twists a paw", () => {
    const posed = { ...sample, poses: { neutral: { paw: { rotation: 45 } } } };
    const preview = prepareCharacterPreview(posed, initialRigPlacements(posed));
    const normal = evaluateCharacter(preview.definition, performer, [], 0);
    const setup = evaluateCharacter(restCharacterDefinition(preview.definition), performer, [], 0);
    expect(normal.parts.paw.rotation).toBe(45);
    expect(setup.parts.paw.rotation).toBe(0);
    expect(posed.poses.neutral.paw.rotation).toBe(45);
  });
});
