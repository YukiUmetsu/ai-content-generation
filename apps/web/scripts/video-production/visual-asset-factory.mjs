/** Versioned, content-addressed 2D/2.5D asset boundary. No image generation happens here. */
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { inflateSync } from "node:zlib";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const shaPattern = /^[a-f0-9]{64}$/u;
const idPattern = /^[a-z][a-z0-9-]{0,63}$/u;
const ROLES = new Set(["background", "midground", "subject", "foreground", "shadow", "overlay"]);
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_PACK_BYTES = 48 * 1024 * 1024;

function assert(condition, reason) {
  if (!condition) throw new Error(`Visual Asset Factory: ${reason}`);
}
function text(value, name, limit = 160) {
  assert(typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= limit, `invalid ${name}`);
}
function point(value, name) {
  assert(value && Number.isFinite(value.x) && Number.isFinite(value.y) && value.x >= 0 && value.x <= 1 &&
    value.y >= 0 && value.y <= 1, `invalid ${name}`);
}

/** Visible text and facts are authored, never invented by an image model. */
export function validateVisualBriefV1(brief) {
  assert(brief?.kind === "contentgen-visual-brief" && brief.schemaVersion === 1, "expected VisualBriefV1");
  assert(idPattern.test(brief.beatId ?? ""), "invalid beat ID");
  for (const key of ["subject", "initialState", "action", "finalState", "framing", "artDirection"])
    text(brief[key], key, 320);
  assert(Array.isArray(brief.claimRefs) && brief.claimRefs.length > 0 && brief.claimRefs.length <= 12 &&
    brief.claimRefs.every((id) => typeof id === "string" && idPattern.test(id)), "invalid claim references");
  assert(brief.aspect === "16:9" || brief.aspect === "9:16", "invalid aspect");
  assert(Array.isArray(brief.assetRoles) && brief.assetRoles.length >= 2 && brief.assetRoles.length <= 6 &&
    brief.assetRoles.includes("background") && brief.assetRoles.includes("subject") &&
    new Set(brief.assetRoles).size === brief.assetRoles.length && brief.assetRoles.every((role) => ROLES.has(role)), "invalid layer roles");
  assert(Array.isArray(brief.onScreenText) && brief.onScreenText.length <= 5 &&
    brief.onScreenText.every((line) => typeof line === "string" && line.trim() === line && line.length > 0 &&
      line.length <= 72 && line.split(/\s+/u).length <= 9), "visible text must be short, exact and authored");
  assert(Array.isArray(brief.cueEventIds) && brief.cueEventIds.length <= 12 &&
    brief.cueEventIds.every((id) => typeof id === "string" && idPattern.test(id)), "invalid timed cue references");
  return brief;
}

export function visualBriefHash(brief) {
  validateVisualBriefV1(brief);
  // Authoring code fixes key insertion order; callers must save the exact brief
  // alongside its digest rather than reconstituting it from a model response.
  return sha256(Buffer.from(JSON.stringify(brief)));
}

function pngInfo(bytes) {
  assert(Buffer.isBuffer(bytes) && bytes.length >= 57 && bytes.length <= MAX_IMAGE_BYTES, "PNG size outside bounds");
  assert(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString("ascii", 12, 16) === "IHDR" && bytes.readUInt32BE(8) === 13, "not a PNG image");
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20), color = bytes[25];
  assert(width >= 128 && height >= 128 && width <= 4096 && height <= 4096 && [2, 4, 6].includes(color) &&
    bytes[24] === 8 && bytes[26] === 0 && bytes[27] === 0 && bytes[28] === 0,
    "invalid PNG geometry, bit depth or interlace");
  const data = [];
  let offset = 8, ended = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    assert(length <= MAX_IMAGE_BYTES && offset + 12 + length <= bytes.length, "PNG chunk exceeds file bounds");
    const kind = bytes.toString("ascii", offset + 4, offset + 8);
    const contents = bytes.subarray(offset + 8, offset + 8 + length);
    let crc = 0xffffffff;
    for (let pos = offset + 4; pos < offset + 8 + length; pos++) {
      crc ^= bytes[pos];
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    assert(((crc ^ 0xffffffff) >>> 0) === bytes.readUInt32BE(offset + 8 + length), "PNG chunk checksum mismatch");
    if (kind === "IDAT") data.push(contents);
    if (kind === "IEND") { assert(length === 0 && offset + 12 === bytes.length, "PNG has trailing data"); ended = true; break; }
    offset += 12 + length;
  }
  assert(ended && data.length > 0, "PNG is missing image data or its end marker");
  const channels = color === 2 ? 3 : color === 4 ? 2 : 4;
  const expected = height * (1 + width * channels);
  let decoded;
  try { decoded = inflateSync(Buffer.concat(data), { maxOutputLength: expected + 1 }); }
  catch { throw Error("Visual Asset Factory: PNG image cannot be decoded"); }
  assert(decoded.length === expected, "PNG pixel data length mismatch");
  for (let row = 0; row < height; row++)
    assert(decoded[row * (1 + width * channels)] <= 4, "invalid PNG row filter");
  return { width, height, hasAlpha: color === 4 || color === 6 };
}

export function validateVisualAssetPackV1(pack, brief) {
  validateVisualBriefV1(brief);
  assert(pack?.kind === "contentgen-visual-asset-pack" && pack.schemaVersion === 1 &&
    pack.beatId === brief.beatId && pack.briefSha256 === visualBriefHash(brief), "pack/brief identity mismatch");
  assert(Array.isArray(pack.assets) && pack.assets.length === brief.assetRoles.length && pack.assets.length <= 6, "incorrect layer count");
  const ids = new Set(), roles = new Set();
  for (const asset of pack.assets) {
    assert(idPattern.test(asset?.id ?? "") && !ids.has(asset.id), "duplicate or invalid layer ID");
    ids.add(asset.id);
    assert(ROLES.has(asset.role) && brief.assetRoles.includes(asset.role) && !roles.has(asset.role), "duplicate or unexpected layer role");
    roles.add(asset.role);
    assert(asset.mimeType === "image/png" && shaPattern.test(asset.sha256 ?? "") &&
      asset.file === `assets/${asset.sha256}.png`, "layer must be content-addressed PNG");
    assert(Number.isInteger(asset.width) && asset.width >= 128 && asset.width <= 4096 &&
      Number.isInteger(asset.height) && asset.height >= 128 && asset.height <= 4096, "invalid layer dimensions");
    point(asset.anchor, "anchor");
    assert(Number.isFinite(asset.depth) && asset.depth >= 0 && asset.depth <= 1, "invalid layer depth");
    assert(asset.rights === "self-created" || asset.rights === "verified-licensed", "unapproved or unknown rights");
    assert(asset.reviewStatus === "approved", "unreviewed visual layer");
    text(asset.provenance?.generator, "generator", 120);
    text(asset.provenance?.workflowSha256, "workflow hash", 64);
    assert(shaPattern.test(asset.provenance.workflowSha256), "invalid workflow hash");
    assert(Number.isSafeInteger(asset.provenance.seed) && asset.provenance.seed >= 0, "invalid generation seed");
    text(asset.provenance.model, "checkpoint", 180);
  }
  assert(brief.assetRoles.every((role) => roles.has(role)), "pack has missing roles");
  return pack;
}

/** Build an asset pack from explicit reviewed image bytes (e.g. ComfyUI /view downloads). */
export async function createVisualAssetPackV1({ brief, layers, outputDir }) {
  validateVisualBriefV1(brief);
  assert(Array.isArray(layers) && layers.length === brief.assetRoles.length, "expected one image per requested role");
  assert(typeof outputDir === "string" && outputDir.length > 1, "asset output directory required");
  let total = 0;
  const assets = [];
  const files = [];
  for (const layer of layers) {
    const info = pngInfo(layer.bytes);
    total += layer.bytes.length;
    assert(total <= MAX_PACK_BYTES, "pack exceeds 48 MiB");
    const hash = sha256(layer.bytes), file = `assets/${hash}.png`;
    const asset = {
      id: layer.id, role: layer.role, mimeType: "image/png", sha256: hash, file,
      width: info.width, height: info.height, anchor: layer.anchor ?? { x: 0.5, y: 0.5 },
      depth: layer.depth ?? 0.5, rights: layer.rights, reviewStatus: layer.reviewStatus,
      provenance: layer.provenance,
    };
    assets.push(asset);
    files.push({ file, bytes: layer.bytes, hash });
  }
  const pack = { kind: "contentgen-visual-asset-pack", schemaVersion: 1,
    beatId: brief.beatId, briefSha256: visualBriefHash(brief), assets };
  validateVisualAssetPackV1(pack, brief);
  await mkdir(join(outputDir, "assets"), { recursive: true, mode: 0o700 });
  for (const { file, bytes, hash } of files) {
    const path = join(outputDir, file);
    try { await writeFile(path, bytes, { flag: "wx", mode: 0o600 }); }
    catch (error) {
      if (error.code !== "EEXIST" || sha256(await readFile(path)) !== hash) throw error;
    }
  }
  return pack;
}

/** Re-read and hash-check before granting a browser capture URL; reject symlinked layers. */
export async function prepareVisualAssetPackV1({ brief, pack, assetsRoot }) {
  validateVisualAssetPackV1(pack, brief);
  assert(typeof assetsRoot === "string" && assetsRoot.length > 1, "asset root is required");
  const root = resolve(assetsRoot);
  const rootStat = await lstat(root);
  assert(rootStat.isDirectory() && !rootStat.isSymbolicLink(), "asset root must be a real directory");
  const assetsDir = await lstat(join(root, "assets"));
  assert(assetsDir.isDirectory() && !assetsDir.isSymbolicLink(), "assets must be a real directory");
  let total = 0;
  const browserAssets = [];
  for (const asset of pack.assets) {
    const path = join(root, asset.file);
    const stats = await lstat(path);
    assert(stats.isFile() && !stats.isSymbolicLink() && stats.size <= MAX_IMAGE_BYTES, "layer is not a bounded regular file");
    const bytes = await readFile(path);
    total += bytes.length;
    assert(total <= MAX_PACK_BYTES && sha256(bytes) === asset.sha256, "layer checksum or pack budget failure");
    const actual = pngInfo(bytes);
    assert(actual.width === asset.width && actual.height === asset.height, "layer geometry mismatch");
    assert(["subject", "foreground", "midground", "shadow", "overlay"].includes(asset.role) ? actual.hasAlpha : true,
      `the ${asset.role} layer needs transparency for compositing`);
    browserAssets.push({ url: `/__visual_assets/${asset.sha256}.png`, sha256: asset.sha256,
      mediaType: asset.mimeType, bytes });
  }
  return { beatId: pack.beatId, layers: pack.assets.map((asset) => ({ ...asset,
    url: `/__visual_assets/${asset.sha256}.png` })), browserAssets };
}
