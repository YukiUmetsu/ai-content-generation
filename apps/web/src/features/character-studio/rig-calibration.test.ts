import { describe, expect, it } from "vitest";
import { calibrateRigDefinition, initialRigPlacements } from "./rig-calibration";
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
});
