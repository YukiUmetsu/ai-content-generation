import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { createVisualAssetPackV1, prepareVisualAssetPackV1, validateVisualAssetPackV1,
  validateVisualBriefV1, visualBriefHash } from "./visual-asset-factory.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function chunk(name, data) {
  const type = Buffer.from(name), output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length); type.copy(output, 4); data.copy(output, 8);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([type, data])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  output.writeUInt32BE((crc ^ 0xffffffff) >>> 0, output.length - 4);
  return output;
}
function png(alpha = true) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(128, 0); header.writeUInt32BE(128, 4);
  header[8] = 8; header[9] = alpha ? 6 : 2;
  const scan = Buffer.alloc(128 * (128 * (alpha ? 4 : 3) + 1));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header), chunk("IDAT", deflateSync(scan)), chunk("IEND", Buffer.alloc(0))]);
}
const brief = {
  kind: "contentgen-visual-brief", schemaVersion: 1, beatId: "invoice-beat", claimRefs: ["claim-1"],
  subject: "An invoice on a desk", initialState: "Invoice enters view", action: "Reveal the receipt",
  finalState: "A $20 mismatch is highlighted", framing: "Oblique desktop camera",
  artDirection: "Warm detailed illustration; no model-generated lettering", aspect: "16:9",
  assetRoles: ["background", "subject", "foreground"],
  onScreenText: ["Invoice · $120", "Receipt · $100", "Mismatch · $20"], cueEventIds: ["reveal-event"],
};
const workflow = "a".repeat(64);
const layer = (role) => ({ id: `layer-${role}`, role, bytes: png(role !== "background"),
  depth: role === "background" ? 0 : role === "subject" ? .5 : 1,
  rights: "self-created", reviewStatus: "approved",
  provenance: { generator: "ComfyUI", model: "sample-checkpoint.safetensors", workflowSha256: workflow, seed: 42 } });

test("approved layered pack is content-addressed and rechecked before browser use", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "contentgen-visual-pack-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pack = await createVisualAssetPackV1({ brief, layers: brief.assetRoles.map(layer), outputDir: root });
  assert.equal(pack.briefSha256, visualBriefHash(brief));
  assert.equal(pack.assets.length, 3);
  const ready = await prepareVisualAssetPackV1({ brief, pack, assetsRoot: root });
  assert.equal(ready.layers[1].url, `/__visual_assets/${ready.layers[1].sha256}.png`);
  assert.equal(ready.browserAssets.length, 3);
  const first = pack.assets[0];
  await writeFile(join(root, first.file), "damaged PNG");
  await assert.rejects(prepareVisualAssetPackV1({ brief, pack, assetsRoot: root }), /checksum|budget/);
});

test("factory rejects wrong brief/pack identity, unreviewed images and unsupported layer composition", async () => {
  assert.deepEqual(validateVisualBriefV1({ ...brief, cueEventIds: [] }).cueEventIds, [],
    "beats without authored events still get deterministic time-relative Kumiki cues");
  assert.throws(() => validateVisualBriefV1({ ...brief, onScreenText: ["A deliberately longer subtitle that goes well beyond the nine permitted visible words"] }), /visible text/);
  assert.throws(() => validateVisualBriefV1({ ...brief, assetRoles: ["background", "background"] }), /layer roles/);
  const root = await mkdtemp(join(tmpdir(), "contentgen-visual-reject-"));
  try {
    await assert.rejects(createVisualAssetPackV1({ brief, layers: [layer("background"),
      { ...layer("subject"), reviewStatus: "pending" }, layer("foreground")], outputDir: root }), /unreviewed/);
    await assert.rejects(createVisualAssetPackV1({ brief, layers: [layer("background"),
      { ...layer("subject"), bytes: png(false) }, layer("foreground")], outputDir: root })
      .then((pack) => prepareVisualAssetPackV1({ brief, pack, assetsRoot: root })), /transparency/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("symlink substitution and mismatched source claim identities fail closed", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "contentgen-visual-symlink-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pack = await createVisualAssetPackV1({ brief, layers: brief.assetRoles.map(layer), outputDir: root });
  assert.throws(() => validateVisualAssetPackV1({ ...pack, briefSha256: hash("other") }, brief), /identity mismatch/);
  const target = join(root, pack.assets[0].file);
  const original = await readFile(target);
  await rm(target);
  const elsewhere = join(root, "elsewhere.png");
  await writeFile(elsewhere, original);
  await symlink(elsewhere, target);
  await assert.rejects(prepareVisualAssetPackV1({ brief, pack, assetsRoot: root }), /regular file/);
});
