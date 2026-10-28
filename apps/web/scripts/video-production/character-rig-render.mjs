/** Freeze project-owned Character Studio ZIP revisions into a verified, same-origin render cast.
 * Archives are inert: never extracted to disk, executed, or trusted as voice permissions.
 */
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const MAX_ZIP = 16 * 1024 * 1024;
const MAX_ENTRY = 12 * 1024 * 1024;
const MAX_EXPANDED = 64 * 1024 * 1024;
const UTF8 = new TextDecoder("utf-8", { fatal: true });
const safeId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value) &&
  !["__proto__", "prototype", "constructor"].includes(value);
const safePath = value => typeof value === "string" && value.length <= 240 &&
  /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) && !value.split("/").some(part => part === "." || part === ".." || !part);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = message => { throw Error("Character rig export blocked: " + message); };

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Validate local/central ZIP metadata before inflating a bounded entry. No ZIP64 or links. */
export function readCharacterZip(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 22 || bytes.length > MAX_ZIP) fail("ZIP exceeds the 16 MiB limit or is incomplete.");
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0 ||
    bytes.readUInt16LE(end + 8) !== bytes.readUInt16LE(end + 10)) fail("ZIP central directory is invalid.");
  const count = bytes.readUInt16LE(end + 10), length = bytes.readUInt32LE(end + 12), offset = bytes.readUInt32LE(end + 16);
  if (count < 2 || count > 128 || offset === 0xffffffff || length === 0xffffffff || offset + length !== end)
    fail("ZIP directory is oversized or malformed.");
  const entries = new Map(), ranges = [];
  let position = offset, expanded = 0;
  for (let i = 0; i < count; i++) {
    if (position + 46 > end || bytes.readUInt32LE(position) !== 0x02014b50) fail("Broken ZIP central record.");
    const flags = bytes.readUInt16LE(position + 8), method = bytes.readUInt16LE(position + 10);
    const crc = bytes.readUInt32LE(position + 16), compressed = bytes.readUInt32LE(position + 20);
    const uncompressed = bytes.readUInt32LE(position + 24), nameLength = bytes.readUInt16LE(position + 28);
    const extra = bytes.readUInt16LE(position + 30), comment = bytes.readUInt16LE(position + 32);
    const disk = bytes.readUInt16LE(position + 34), local = bytes.readUInt32LE(position + 42);
    if ((flags & (1 | 0x40)) || ![0, 8].includes(method) || disk || compressed === 0xffffffff ||
      uncompressed === 0xffffffff || local === 0xffffffff || uncompressed > MAX_ENTRY ||
      position + 46 + nameLength + extra + comment > end || local + 30 > offset)
      fail("Unsupported or oversized ZIP entry.");
    let name;
    try { name = UTF8.decode(bytes.subarray(position + 46, position + 46 + nameLength)); }
    catch { fail("ZIP entry names must be UTF-8."); }
    if (!safePath(name) || entries.has(name.toLowerCase())) fail("Duplicate or unsafe ZIP layer path.");
    if (bytes.readUInt32LE(local) !== 0x04034b50 ||
      bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method)
      fail("ZIP local header differs from the central record.");
    const localNameLength = bytes.readUInt16LE(local + 26), localExtra = bytes.readUInt16LE(local + 28);
    const dataStart = local + 30 + localNameLength + localExtra;
    if (dataStart + compressed > offset || local + 30 + localNameLength > offset ||
      !bytes.subarray(local + 30, local + 30 + localNameLength).equals(Buffer.from(name, "utf8")) ||
      ranges.some(([a, b]) => dataStart < b && dataStart + compressed > a))
      fail("ZIP layer has overlapping or mismatched bytes.");
    ranges.push([dataStart, dataStart + compressed]);
    const raw = bytes.subarray(dataStart, dataStart + compressed);
    let data;
    try { data = method === 0 ? raw : inflateRawSync(raw, { maxOutputLength: Math.min(MAX_ENTRY, uncompressed) + 1 }); }
    catch { fail("ZIP layer could not be safely decompressed."); }
    if (data.length !== uncompressed || crc32(data) !== crc) fail("ZIP layer checksum or expanded length differs.");
    expanded += data.length;
    if (expanded > MAX_EXPANDED) fail("ZIP exceeds the 64 MiB expanded limit.");
    entries.set(name.toLowerCase(), { name, data });
    position += 46 + nameLength + extra + comment;
  }
  if (position !== end || !entries.has("character.json")) fail("ZIP is missing a valid root character.json.");
  const manifest = entries.get("character.json").data;
  if (manifest.length > 1024 * 1024) fail("Character manifest exceeds 1 MiB.");
  let definition;
  try { definition = JSON.parse(UTF8.decode(manifest)); }
  catch { fail("Character manifest is not valid UTF-8 JSON."); }
  return { definition, entries };
}

function verifyPack(archive, draft, id) {
  const { definition, entries } = readCharacterZip(archive);
  if (!object(definition) || definition.schemaVersion !== 1 || definition.characterId !== id ||
    definition.revision !== draft.revision || !["sprite-2d", "puppet-2.5d"].includes(definition.mode) ||
    !object(definition.design) || !Number.isFinite(definition.design.width) ||
    !Number.isFinite(definition.design.height) || !Array.isArray(definition.channels) ||
    !object(definition.assets) || !Array.isArray(definition.parts) ||
    !definition.parts.length || definition.parts.length > 128 || !object(definition.poses) ||
    !object(definition.actions) || !object(definition.expressions) ||
    !object(definition.expressions.sets) || !object(definition.palette))
    fail(`Saved ${id} revision has an incomplete or mismatched animation definition.`);
  const assets = [], assetUrls = {}, used = new Set();
  for (const [key, asset] of Object.entries(definition.assets)) {
    if (!safeId(key) || !object(asset) || asset.kind !== "image" ||
      !safePath(asset.uri) || !asset.uri.startsWith("layers/") ||
      !["image/png", "image/webp"].includes(asset.mediaType) ||
      !Number.isSafeInteger(asset.width) || asset.width < 1 || asset.width > 8192 ||
      !Number.isSafeInteger(asset.height) || asset.height < 1 || asset.height > 8192 ||
      !object(asset.provenance) || typeof asset.provenance.source !== "string" ||
      !asset.provenance.source.trim() || typeof asset.provenance.license !== "string" ||
      !asset.provenance.license.trim() || used.has(asset.uri.toLowerCase()))
      fail(`Saved ${id} has an invalid image layer.`);
    const extension = asset.mediaType === "image/png" ? ".png" : ".webp";
    if (!asset.uri.endsWith(extension)) fail("Character image extension and media type disagree.");
    const file = entries.get(asset.uri.toLowerCase());
    if (!file || file.name !== asset.uri) fail("Character ZIP is missing an exact referenced layer.");
    const bytes = file.data;
    if (extension === ".png" && (bytes.length < 24 ||
      !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ||
      bytes.readUInt32BE(16) !== asset.width || bytes.readUInt32BE(20) !== asset.height))
      fail("Character PNG signature or dimensions differ from its manifest.");
    if (extension === ".webp" && (bytes.length < 12 || bytes.toString("ascii",0,4) !== "RIFF" ||
      bytes.toString("ascii",8,12) !== "WEBP")) fail("Character WebP signature is invalid.");
    const digest = sha256(bytes);
    if (asset.sha256 && asset.sha256.toLowerCase() !== digest) fail("Character image checksum differs from its manifest.");
    const url = `/__character_assets/${digest}${extension}`;
    assetUrls[asset.uri] = url;
    assets.push({ url, sha256: digest, mediaType: asset.mediaType, bytes });
    used.add(asset.uri.toLowerCase());
  }
  if (!used.size || used.size > 128 || Object.keys(assetUrls).length !== used.size)
    fail("Character has no usable image layers.");
  for (const [name] of entries) {
    if (name === "character.json" || used.has(name)) continue;
    if (name.startsWith("docs/") && /\.(md|txt)$/.test(name)) continue;
    fail("Character ZIP contains unreferenced or unsupported content.");
  }
  const parts = new Map();
  for (const part of definition.parts) {
    if (!object(part) || !safeId(part.id) || parts.has(part.id) || !safeId(part.asset) ||
      !Object.hasOwn(definition.assets, part.asset) || !definition.channels.includes(part.channel) ||
      !object(part.pivot) || !Number.isFinite(part.pivot.x) || !Number.isFinite(part.pivot.y))
      fail("Character has invalid articulated parts.");
    if (!Number.isFinite(part.z) || part.z < -1000 || part.z > 1000 ||
      (part.variants && (!object(part.variants) || Object.values(part.variants).some(value =>
        !safeId(value) || !Object.hasOwn(definition.assets, value)))))
      fail("Character has an invalid layer order or missing pose image.");
    parts.set(part.id, part);
  }
  for (const part of parts.values()) {
    const seen = new Set([part.id]);
    let parent = part.parent;
    while (parent !== undefined) {
      if (!safeId(parent) || !parts.has(parent) || seen.has(parent))
        fail("Character part hierarchy contains a cycle or missing parent.");
      seen.add(parent);
      parent = parts.get(parent).parent;
    }
  }
  const speech = definition.speech;
  if (!object(speech) || !safeId(speech.mouthPart) || !parts.has(speech.mouthPart) ||
    !Array.isArray(speech.approximateCycle) || speech.approximateCycle.length < 2 ||
    new Set(speech.approximateCycle).size < 2 ||
    speech.approximateCycle.some(value => typeof value !== "string"))
    fail(`Saved ${id} must include an articulated speech mouth and at least two mouth shapes for video export.`);
  const mouth = parts.get(speech.mouthPart);
  if (!object(mouth.variants) || speech.approximateCycle.some(value =>
    value !== speech.rest && !Object.hasOwn(mouth.variants, value)))
    fail("Character speech mouth references an unavailable image variant.");
  return { draftId: draft.id, archiveSha256: draft.archiveSha256, definition, assetUrls, assets };
}

async function boundedResponse(response, max) {
  if (!response.ok) fail(`Character Studio backend returned HTTP ${response.status}.`);
  if (Number(response.headers.get("content-length") ?? 0) > max) fail("Character Studio response exceeds its size limit.");
  const chunks = []; let size = 0;
  if (!response.body) fail("Character Studio returned an empty response.");
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > max) { await response.body.cancel().catch(() => {}); fail("Character Studio response exceeds its size limit."); }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Resolve only the two currently staged characters. Newest saved revision wins;
 * an absent character uses original bundled art, never an unrelated project's rig.
 */
export async function loadProjectCharacterRigs({ projectId, speakers, origin = process.env.CONTENTGEN_JOBS_ORIGIN ?? "http://127.0.0.1:8787", fetchImpl = fetch }) {
  const ids = [...new Set(speakers ?? [])].filter(id => id === "pip" || id === "quill");
  if (!ids.length) return { rigs: {}, assets: [], identity: [] };
  if (!safeId(projectId) || projectId.length > 120) fail("Select a valid Character Studio project before rendering its custom cast.");
  let base;
  try { base = new URL(origin); }
  catch { fail("Character Studio backend URL is invalid."); }
  if (base.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(base.hostname) ||
    base.username || base.password || base.pathname !== "/" || base.search || base.hash)
    fail("Character Studio backend must be a local loopback service.");
  const request = async (path, max) => {
    const url = new URL(path, base);
    const response = await fetchImpl(url, { headers: { Accept: path.includes("/archive") ? "application/zip" : "application/json" },
      signal: AbortSignal.timeout(12000), cache: "no-store" });
    return boundedResponse(response, max);
  };
  let catalog;
  try { catalog = JSON.parse((await request(`/api/character-drafts?projectId=${encodeURIComponent(projectId)}`, 180000)).toString("utf8")); }
  catch (error) { fail(`Cannot load saved character revisions: ${error.message}`); }
  if (!Array.isArray(catalog?.drafts) || catalog.drafts.length > 250) fail("Character Studio returned an invalid revision catalog.");
  const rigs = {}, assets = [], identity = [];
  for (const id of ids) {
    const draft = catalog.drafts.find(item => item?.characterId === id);
    if (!draft) continue;
    if (!/^character-draft-[a-f0-9]{32}$/.test(draft.id) || draft.projectId !== projectId ||
      typeof draft.revision !== "string" || !draft.revision || draft.revision.length > 64 ||
      !/^[a-f0-9]{64}$/.test(draft.archiveSha256) || !Number.isSafeInteger(draft.sizeBytes) ||
      draft.sizeBytes < 22 || draft.sizeBytes > MAX_ZIP)
      fail(`Character Studio returned an invalid ${id} revision.`);
    const archive = await request(`/api/character-drafts/${draft.id}/archive?projectId=${encodeURIComponent(projectId)}`, MAX_ZIP);
    if (archive.length !== draft.sizeBytes || sha256(archive) !== draft.archiveSha256)
      fail(`Saved ${id} ZIP differs from its immutable Character Studio revision.`);
    const verified = verifyPack(archive, draft, id);
    rigs[id] = { draftId: verified.draftId, archiveSha256: verified.archiveSha256,
      definition: verified.definition, assetUrls: verified.assetUrls };
    assets.push(...verified.assets);
    identity.push({ speakerId: id, draftId: draft.id, revision: draft.revision, archiveSha256: draft.archiveSha256 });
  }
  return { rigs, assets, identity };
}
