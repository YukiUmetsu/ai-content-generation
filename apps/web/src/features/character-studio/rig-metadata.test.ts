import { describe, expect, it } from "vitest";
import { summarizeRigMetadata } from "./rig-metadata";
import type { CharacterPackDefinition } from "./character-pack";

const minimal: CharacterPackDefinition = {
  schemaVersion: 1, characterId: "pip", revision: "1", mode: "puppet-2.5d",
  design: { width: 400, height: 400 }, channels: ["body"], palette: {},
  assets: { body: { kind: "image", uri: "layers/body.png", mediaType: "image/png", width: 200, height: 200,
    provenance: { source: "original", license: "owned" } } },
  parts: [{ id: "body", channel: "body", asset: "body", pivot: { x: 50, y: 50 }, z: 0 }],
  poses: { idle: {} }, basePose: "idle", capabilities: [],
};

describe("character rig metadata inventory", () => {
  it("reports missing capabilities without claiming a renderer passed them", () => {
    expect(summarizeRigMetadata(minimal)).toEqual({
      poses: ["idle"], actions: [], expressions: [], variants: 0, restTransforms: 0,
      speechDeclared: false, anchors: 0,
    });
  });

  it("counts arbitrary action names and optional art controls without assuming valid playback", () => {
    const rich = {
      ...minimal,
      poses: { idle: {}, surprised: { body: { rotation: -4 } } },
      parts: [{ ...minimal.parts[0], rest: { x: 25 }, variants: { smiling: "body", speaking: "body" } }],
      actions: { wave: { phases: [] }, walk: { phases: [] } },
      expressions: { default: "neutral", sets: { neutral: {}, joy: {} } },
      anchors: { prop: { part: "body", at: { x: 5, y: 5 } } },
      speech: { mouthPart: "body", rest: "smiling" },
    } as unknown as CharacterPackDefinition;
    expect(summarizeRigMetadata(rich)).toEqual({
      poses: ["idle", "surprised"], actions: ["wave", "walk"], expressions: ["neutral", "joy"],
      variants: 2, restTransforms: 1, speechDeclared: true, anchors: 1,
    });
  });
});
