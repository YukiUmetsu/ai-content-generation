import { describe, expect, it } from "vitest";
import { calibrateRigDefinition, initialRigPlacements, moveRigLayer, rigLayerPeers } from "./rig-calibration";
import type { CharacterPackDefinition } from "./character-pack";

const animal: CharacterPackDefinition = {
  schemaVersion: 1, characterId: "pip", revision: "r1", mode: "puppet-2.5d",
  design: { width: 768, height: 576 }, channels: ["torso", "face", "paws", "hindLegs", "tail"], palette: {},
  assets: {
    torso: { kind: "image", uri: "layers/torso.png", mediaType: "image/png", width: 240, height: 220,
      provenance: { source: "original", license: "original" } },
  },
  parts: [
    { id: "torso", asset: "torso", channel: "torso", pivot: { x: 120, y: 200 }, rest: { x: 375, y: 280 }, z: 0 },
    { id: "muzzle", parent: "torso", asset: "torso", channel: "face", pivot: { x: 135, y: 175 }, rest: { x: -65, y: -190 }, z: 2 },
    { id: "front-paw", parent: "torso", asset: "torso", channel: "paws", pivot: { x: 80, y: 50 }, rest: { x: -40, y: -20 }, z: 1 },
    { id: "rear-leg", parent: "torso", asset: "torso", channel: "hindLegs", pivot: { x: 50, y: 10 }, rest: { x: 70, y: 140 }, z: 1 },
    { id: "tail-curl", parent: "torso", asset: "torso", channel: "tail", pivot: { x: 200, y: 400 }, z: -1 },
  ],
  poses: { idle: {} }, basePose: "idle", capabilities: [],
};

describe("non-human rig calibration manifest", () => {
  it("preserves species-neutral part names and produces an immutable new revision", () => {
    const draft = initialRigPlacements(animal);
    draft.muzzle.y = "-160"; // lower the squirrel face
    draft["front-paw"].x = "-25"; // tuck a paw closer to its torso
    draft["rear-leg"].scaleY = "0.65"; // shorter animal legs
    draft["tail-curl"].rotation = "-15";
    draft["front-paw"].pivotX = "70";
    const revised = calibrateRigDefinition(animal, draft, "r2");

    expect(revised.revision).toBe("r2");
    expect(revised.parts.find(part => part.id === "muzzle")?.rest?.y).toBe(-160);
    expect(revised.parts.find(part => part.id === "front-paw")?.rest?.x).toBe(-25);
    expect(revised.parts.find(part => part.id === "front-paw")?.pivot.x).toBe(70);
    expect(revised.parts.find(part => part.id === "rear-leg")?.rest?.scaleY).toBe(0.65);
    expect(revised.parts.find(part => part.id === "tail-curl")?.rest?.rotation).toBe(-15);
    expect(animal.parts[1].rest?.y).toBe(-190);
    expect(animal.parts[3].rest?.scaleY).toBeUndefined();
    expect(revised.assets).toBe(animal.assets);
  });

  it("retains omitted rest transforms as identity and validates the authored revision", () => {
    const draft = initialRigPlacements(animal);
    expect(draft["tail-curl"]).toMatchObject({ x: "0", y: "0", rotation: "0", scaleX: "1", scaleY: "1" });
    draft["tail-curl"].rotation = "15";
    expect(() => calibrateRigDefinition(animal, draft, "r1")).toThrow(/new revision/i);
    expect(() => calibrateRigDefinition(animal, draft, " ")).toThrow(/revision/i);
    expect(() => calibrateRigDefinition(animal, draft, "r/2")).toThrow(/revision/i);
    expect(() => calibrateRigDefinition(animal, draft, "r\\2")).toThrow(/revision/i);
    expect(() => calibrateRigDefinition(animal, draft, "改".repeat(22))).toThrow(/revision/i);
    expect(() => calibrateRigDefinition(animal, draft, "r\u0085bad")).toThrow(/revision/i);
    expect(() => calibrateRigDefinition(animal, draft, "r2")).not.toThrow();
  });

  it("rejects invalid coordinates, missing parts and collapsed scales", () => {
    const draft = initialRigPlacements(animal);
    draft.muzzle.y = "NaN";
    expect(() => calibrateRigDefinition(animal, draft, "r2")).toThrow(/muzzle.*y/i);
    draft.muzzle.y = "-160";
    draft["rear-leg"].scaleY = "0";
    expect(() => calibrateRigDefinition(animal, draft, "r2")).toThrow(/rear-leg.*scaleY/i);
    draft["rear-leg"].scaleY = "0.65";
    draft["unknown-animal-part"] = { ...draft.muzzle };
    expect(() => calibrateRigDefinition(animal, draft, "r2")).toThrow(/unknown.*part/i);
  });

  it("does not generate a new manifest when no placement changed", () => {
    expect(() => calibrateRigDefinition(animal, initialRigPlacements(animal), "r2")).toThrow(/change at least one/i);
  });

  it("moves an animal limb behind its torso, previewing and exporting the layer-only edit", () => {
    const first = rigLayerPeers(animal, {}, "front-paw");
    expect(first.map(part => part.id)).toEqual(["tail-curl", "torso", "front-paw", "rear-leg", "muzzle"]);
    const behind = moveRigLayer(animal, {}, "front-paw", "bottom");
    expect(behind).not.toBeNull();
    expect((behind?.["front-paw"] ?? 0) < (behind?.torso ?? 0)).toBe(true);
    const revised = calibrateRigDefinition(animal, initialRigPlacements(animal), "r2", behind!);
    expect(revised.parts.find(part => part.id === "front-paw")?.z).toBeLessThan(revised.parts[0].z);
    expect(animal.parts.find(part => part.id === "front-paw")?.z).toBe(1);
  });

  it("preserves grandchild occlusion while changing a parent layer", () => {
    const nested: CharacterPackDefinition = { ...animal, parts: [
      ...animal.parts,
      { id: "paw-tip", parent: "front-paw", asset: "torso", channel: "paws", pivot: { x: 10, y: 10 }, z: 3 },
    ] };
    const moved = moveRigLayer(nested, {}, "torso", "top")!;
    expect(moved["paw-tip"] - moved["front-paw"]).toBe(2);
    expect(rigLayerPeers(nested, moved, "front-paw")[0].id).toBe("front-paw");
    expect(moveRigLayer(nested, moved, "torso", "top")).toBeNull();
  });

  it("lets the user select the torso and bring its artwork in front of the wing", () => {
    const arranged = moveRigLayer(animal, {}, "torso", "top")!;
    const torso = animal.parts.find(part => part.id === "torso")!;
    const paw = animal.parts.find(part => part.id === "front-paw")!;
    expect(arranged[torso.id] ?? torso.z).toBeGreaterThan(arranged[paw.id] ?? paw.z);
    expect(rigLayerPeers(animal, arranged, "torso").at(-1)?.id).toBe("torso");
    expect(moveRigLayer(animal, arranged, "torso", "top")).toBeNull();
  });

  it("rejects arbitrary or overflowing layer depths", () => {
    expect(() => calibrateRigDefinition(animal, initialRigPlacements(animal), "r2", { "unknown-part": 2 })).toThrow(/unknown/i);
    expect(() => calibrateRigDefinition(animal, initialRigPlacements(animal), "r2", { torso: 1001 })).toThrow(/depth/i);
    expect(() => calibrateRigDefinition(animal, initialRigPlacements(animal), "r2", { torso: NaN })).toThrow(/depth/i);
    const extreme: CharacterPackDefinition = { ...animal, parts: animal.parts.map(part => part.id === "torso" ? { ...part, z: -1000 } : part) };
    const ordered = rigLayerPeers(extreme, {}, "front-paw");
    expect(ordered.some(part => part.id === "torso")).toBe(true);
  });
});
