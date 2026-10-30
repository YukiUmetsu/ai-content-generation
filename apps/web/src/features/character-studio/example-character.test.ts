import { describe, expect, it } from "vitest";
import { inspectCharacterZip } from "./character-pack";
import { EXAMPLE_CHARACTER, exampleCharacterJson, exampleCharacterZip } from "./example-character";

describe("downloadable Character Studio examples", () => {
  it("keeps the documented JSON identical to the portable ZIP manifest and accepted rig", async () => {
    const archive = exampleCharacterZip();
    const inspected = await inspectCharacterZip(archive.buffer);
    expect(inspected.definition).toEqual(EXAMPLE_CHARACTER);
    expect(JSON.parse(exampleCharacterJson())).toEqual(inspected.definition);
    expect([...inspected.images.keys()].sort()).toEqual([
      "layers/body.png", "layers/mouth-closed.png", "layers/mouth-open.png",
    ]);
    expect(inspected.parts).toHaveLength(2);
    expect(inspected.definition.speech).toMatchObject({ mouthPart: "mouth", visemes: { A: "open" } });
    expect(inspected.issues).toEqual([]);
  });

  it("rejects an altered example ZIP rather than bypassing the production CRC check", async () => {
    const archive = exampleCharacterZip();
    archive[100] ^= 0xff;
    await expect(inspectCharacterZip(archive.buffer)).rejects.toThrow(/CRC|checksum/i);
  });
});
