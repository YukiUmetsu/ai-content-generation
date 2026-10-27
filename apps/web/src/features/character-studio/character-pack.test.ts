import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { deflateRawSync } from "node:zlib";
import { createHash, webcrypto as nodeCrypto } from "node:crypto";
import { Blob as NodeBlob } from "node:buffer";
import { DecompressionStream as NodeDecompressionStream } from "node:stream/web";
import { inspectCharacterZip, CharacterPackError } from "./character-pack";

const utf8 = new TextEncoder();
// jsdom's Blob lacks stream(); real browsers and Node both implement it.
beforeAll(() => {
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("DecompressionStream", NodeDecompressionStream);
  vi.stubGlobal("crypto", nodeCrypto);
});
afterAll(() => vi.unstubAllGlobals());
const packNumber = (value: number, bytes: number) => Array.from({ length: bytes }, (_, i) => (value >>> (i * 8)) & 255);
function crc(bytes: Uint8Array) {
  let value = 0xffffffff;
  for (const b of bytes) {
    value ^= b;
    for (let i = 0; i < 8; i++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
type Entry = { name: string; bytes: Uint8Array; compressed?: boolean; externalAttributes?: number; flags?: number; declaredSize?: number; corruptCrc?: boolean };
function zip(entries: Entry[]): ArrayBuffer {
  const local: number[] = [], central: number[] = [];
  for (const entry of entries) {
    const name = utf8.encode(entry.name), method = entry.compressed ? 8 : 0;
    const packed = entry.compressed ? new Uint8Array(deflateRawSync(entry.bytes)) : entry.bytes;
    const offset = local.length, checksum = (crc(entry.bytes) + (entry.corruptCrc ? 1 : 0)) >>> 0;
    local.push(...packNumber(0x04034b50, 4), ...packNumber(20, 2), ...packNumber(entry.flags ?? 0x800, 2),
      ...packNumber(method, 2), ...packNumber(0, 4), ...packNumber(checksum, 4), ...packNumber(packed.length, 4),
      ...packNumber(entry.declaredSize ?? entry.bytes.length, 4), ...packNumber(name.length, 2), 0, 0, ...name, ...packed);
    central.push(...packNumber(0x02014b50, 4), ...packNumber((3 << 8) | 20, 2), ...packNumber(20, 2),
      ...packNumber(entry.flags ?? 0x800, 2), ...packNumber(method, 2), ...packNumber(0, 4), ...packNumber(checksum, 4),
      ...packNumber(packed.length, 4), ...packNumber(entry.declaredSize ?? entry.bytes.length, 4),
      ...packNumber(name.length, 2), 0, 0, 0, 0, 0, 0, 0, 0, ...packNumber(entry.externalAttributes ?? 0, 4),
      ...packNumber(offset, 4), ...name);
  }
  const end = [...packNumber(0x06054b50, 4), 0, 0, 0, 0, ...packNumber(entries.length, 2),
    ...packNumber(entries.length, 2), ...packNumber(central.length, 4), ...packNumber(local.length, 4), 0, 0];
  return new Uint8Array([...local, ...central, ...end]).buffer;
}
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 8, 0, 0, 0, 8, 8, 6, 0, 0, 0]);
const definition = () => ({ schemaVersion: 1, characterId: "pip", revision: "1", mode: "puppet-2.5d",
  design: { width: 512, height: 512 }, channels: ["body", "eyes"], palette: {},
  assets: { torso: { kind: "image", uri: "layers/torso.png", mediaType: "image/png", width: 8, height: 8,
    provenance: { source: "original", license: "CC0-1.0" } } },
  parts: [{ id: "body", channel: "body", asset: "torso", pivot: { x: 4, y: 4 }, z: 0 }],
  poses: { idle: {} }, basePose: "idle", actions: {}, expressions: { default: "neutral", sets: { neutral: {} } }, capabilities: [],
});
const makeZip = (overrides?: { def?: unknown; layers?: Entry[]; extra?: Entry[]; compressed?: boolean }) =>
  zip([{ name: "character.json", bytes: utf8.encode(JSON.stringify(overrides?.def ?? definition())), compressed: overrides?.compressed },
    ...(overrides?.layers ?? [{ name: "layers/torso.png", bytes: png, compressed: overrides?.compressed }]),
    ...(overrides?.extra ?? [])]);

const speakingPack = () => {
  const base = definition();
  return {
    ...base,
    channels: [...base.channels, "head"],
    assets: {
      ...base.assets,
      head: { ...base.assets.torso, uri: "layers/head.png" },
      cleanHead: { ...base.assets.torso, uri: "layers/clean-head.png" },
      beak: { ...base.assets.torso, uri: "layers/beak.png" },
    },
    parts: [
      ...base.parts,
      { id: "head", channel: "head", asset: "head", variants: { clean: "cleanHead" }, pivot: { x: 4, y: 4 }, z: 1 },
      { id: "beak", parent: "head", channel: "head", asset: "beak", variants: { closed: "beak", open: "beak" }, pivot: { x: 4, y: 4 }, z: 2 },
    ],
    speech: {
      mouthPart: "beak", rest: "closed", visemes: { A: "open" }, approximateCycle: ["closed", "open"],
      approximateStepFrames: 3, transitionFrames: 0, activeVariants: { head: "clean" },
    },
  };
};
const speakingLayers: Entry[] = ["torso", "head", "clean-head", "beak"].map(name => ({ name: `layers/${name}.png`, bytes: png }));

describe("character ZIP package inspector", () => {
  it("reads stored and deflated portable packs with stable asset references", async () => {
    for (const compressed of [false, true]) {
      const inspected = await inspectCharacterZip(makeZip({ compressed }));
      expect(inspected.definition.characterId).toBe("pip");
      expect(inspected.parts).toHaveLength(1);
      expect(inspected.images.get("layers/torso.png")?.type).toBe("image/png");
      expect(inspected.issues).toEqual([]);
    }
  });

  it("accepts a clean-head companion swap needed for a single opening owl beak", async () => {
    const inspected = await inspectCharacterZip(makeZip({ def: speakingPack(), layers: speakingLayers }));
    expect(inspected.definition.speech).toMatchObject({ activeVariants: { head: "clean" }, mouthPart: "beak" });
    expect(inspected.images.size).toBe(4);
  });

  it("rejects broken speech mouth, viseme, cycle, and companion references", async () => {
    const base = speakingPack();
    const invalid: unknown[] = [
      { ...base, speech: { ...base.speech, mouthPart: "missing" } },
      { ...base, speech: { ...base.speech, visemes: { A: "missing" } } },
      { ...base, speech: { ...base.speech, approximateCycle: ["missing"] } },
      { ...base, speech: { ...base.speech, activeVariants: { head: "missing" } } },
      { ...base, speech: { ...base.speech, activeVariants: { beak: "open" } } },
      { ...base, speech: { ...base.speech, activeVariants: { constructor: "clean" } } },
    ];
    for (const manifest of invalid) {
      await expect(inspectCharacterZip(makeZip({ def: manifest, layers: speakingLayers }))).rejects.toThrow(/speech|viseme|mouth|companion/i);
    }
  });

  it("explains how to import a standalone rig kit safely", async () => {
    const standalone = zip([{ name: "doctor-quill.rig.json", bytes: utf8.encode("{}") }]);
    await expect(inspectCharacterZip(standalone)).rejects.toThrow(/standalone rig kit.*character\.json/i);
  });

  it("rejects archive traversal, duplicate files, symlinks and encrypted archives", async () => {
    for (const extra of [
      [{ name: "../outside.png", bytes: png }],
      [{ name: "layers/torso.png", bytes: png }],
      [{ name: "layers/link.png", bytes: png, externalAttributes: 0xa000 << 16 }],
      [{ name: "layers/secret.png", bytes: png, flags: 1 }],
    ]) {
      await expect(inspectCharacterZip(makeZip({ extra }))).rejects.toBeInstanceOf(CharacterPackError);
    }
  });

  it("rejects missing layers, forged sizes, incorrect CRC and invalid image bytes", async () => {
    await expect(inspectCharacterZip(makeZip({ layers: [] }))).rejects.toThrow(/missing|layer/i);
    await expect(inspectCharacterZip(makeZip({ layers: [{ name: "layers/torso.png", bytes: png, declaredSize: 90_000_000 }] }))).rejects.toThrow(/size|limit/i);
    await expect(inspectCharacterZip(makeZip({ layers: [{ name: "layers/torso.png", bytes: png, corruptCrc: true }] }))).rejects.toThrow(/checksum|CRC/i);
    await expect(inspectCharacterZip(makeZip({ layers: [{ name: "layers/torso.png", bytes: utf8.encode("not an image") }] }))).rejects.toThrow(/image|PNG/i);
  });

  it("verifies an optional content hash and rejects untrusted extra files", async () => {
    const base = definition();
    const withHash = { ...base, assets: { torso: { ...base.assets.torso, sha256: createHash("sha256").update(png).digest("hex") } } };
    expect((await inspectCharacterZip(makeZip({ def: withHash }))).images.size).toBe(1);
    withHash.assets.torso.sha256 = "0".repeat(64);
    await expect(inspectCharacterZip(makeZip({ def: withHash }))).rejects.toThrow(/SHA-256 mismatch/i);
    await expect(inspectCharacterZip(makeZip({ extra: [{ name: "run.js", bytes: utf8.encode("alert(1)") }] }))).rejects.toThrow(/Unexpected file/i);
  });

  it("does not skip integrity checks when multiple asset IDs point to one ZIP image", async () => {
    const base = definition();
    const duplicate = { ...base, assets: {
      ...base.assets,
      duplicate: { ...base.assets.torso, sha256: "0".repeat(64) },
    } };
    await expect(inspectCharacterZip(makeZip({ def: duplicate }))).rejects.toThrow(/duplicate|same.*file|shared.*path/i);
  });

  it("rejects a broken skeleton and a manifest with unsafe asset paths", async () => {
    const malformed = definition();
    malformed.parts[0] = { ...malformed.parts[0], id: "body", parent: "body" } as typeof malformed.parts[0];
    await expect(inspectCharacterZip(makeZip({ def: malformed }))).rejects.toThrow(/cycle|parent/i);
    const missing = definition();
    missing.assets.torso.uri = "../secret.png";
    await expect(inspectCharacterZip(makeZip({ def: missing }))).rejects.toThrow(/path|layers/i);
    await expect(inspectCharacterZip(makeZip({ def: { ...definition(), schemaVersion: 999 } }))).rejects.toThrow(/version|schema/i);
  });

  it("does not accept inherited JavaScript prototype names as actual ZIP assets", async () => {
    for (const inherited of ["constructor", "toString", "__proto__"]) {
      const missing = definition();
      missing.parts[0].asset = inherited;
      await expect(inspectCharacterZip(makeZip({ def: missing }))).rejects.toThrow(/missing asset/i);
      const variant = definition();
      variant.parts[0] = { ...variant.parts[0], variants: { smile: inherited } } as typeof variant.parts[0];
      await expect(inspectCharacterZip(makeZip({ def: variant }))).rejects.toThrow(/no asset/i);
    }
  });

  it("rejects pose and rest transforms that reference missing parts or contain invalid coordinates", async () => {
    const extraPart = { ...definition(), poses: { idle: { "missing-arm": { rotation: 20 } } } };
    await expect(inspectCharacterZip(makeZip({ def: extraPart }))).rejects.toThrow(/pose.*unknown part/i);
    const badPose = { ...definition(), poses: { idle: { body: { x: "far-right" } } } };
    await expect(inspectCharacterZip(makeZip({ def: badPose }))).rejects.toThrow(/pose.*finite/i);
    const badRest = { ...definition(), parts: [{ ...definition().parts[0], rest: { rotation: "a lot" } }] };
    await expect(inspectCharacterZip(makeZip({ def: badRest }))).rejects.toThrow(/rest.*finite/i);
  });

  it("rejects anchors attached to undeclared parts", async () => {
    const invalid = { ...definition(), anchors: { hand: { part: "missing-hand", at: { x: 10, y: 20 } } } };
    await expect(inspectCharacterZip(makeZip({ def: invalid }))).rejects.toThrow(/anchor.*unknown part/i);
  });

  it("rejects property names that could change renderer object prototypes", async () => {
    for (const reserved of ["__proto__", "constructor", "prototype"]) {
      const invalid = { ...definition(), parts: [{ ...definition().parts[0], id: reserved }] };
      await expect(inspectCharacterZip(makeZip({ def: invalid }))).rejects.toThrow(/reserved/i);
    }
  });

  it("accepts bounded rest transforms and anchors for valid articulated parts", async () => {
    const valid = {
      ...definition(),
      parts: [{ ...definition().parts[0], rest: { x: 4, rotation: -10 }, variants: { neutral: "torso" } }],
      poses: { idle: { body: { scaleX: 1, scaleY: 1 } } },
      anchors: { heldProp: { part: "body", at: { x: 6, y: 2 } } },
    };
    const inspected = await inspectCharacterZip(makeZip({ def: valid }));
    expect(inspected.parts[0].rest?.rotation).toBe(-10);
    expect(inspected.definition.poses.idle.body.scaleX).toBe(1);
  });
});
