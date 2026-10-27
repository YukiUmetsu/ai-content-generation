/** Local, bounded, no-dependency ZIP inspection for portable Kumiki character packs.
 * This is a structural import preview, NOT rig approval, persistence or rendering.
 */
export const CHARACTER_PACK_LIMITS = {
  compressedBytes: 16 * 1024 * 1024,
  expandedBytes: 64 * 1024 * 1024,
  entryBytes: 12 * 1024 * 1024,
  manifestBytes: 1024 * 1024,
  entries: 128,
} as const;

export class CharacterPackError extends Error {
  constructor(message: string) { super(message); this.name = "CharacterPackError"; }
}

export interface CharacterPackAsset {
  kind: "image";
  uri: string;
  mediaType: "image/png" | "image/webp";
  width: number;
  height: number;
  sha256?: string;
  provenance: { source: string; license: string; attribution?: string };
}

export interface CharacterPackPart {
  id: string;
  parent?: string;
  channel: string;
  asset: string;
  variants?: Record<string, string>;
  pivot: { x: number; y: number };
  rest?: Partial<{ x: number; y: number; rotation: number; scaleX: number; scaleY: number }>;
  z: number;
}

export interface CharacterPackDefinition {
  schemaVersion: 1;
  characterId: string;
  revision: string;
  mode: "sprite-2d" | "puppet-2.5d";
  design: { width: number; height: number };
  channels: string[];
  palette: Record<string, string>;
  assets: Record<string, CharacterPackAsset>;
  parts: CharacterPackPart[];
  poses: Record<string, Record<string, Partial<{ x: number; y: number; rotation: number; scaleX: number; scaleY: number }>>>;
  basePose: string;
  capabilities: string[];
  /** Other Kumiki definition fields are preserved in the parsed JSON but not trusted as validated. */
  [extra: string]: unknown;
}

export interface InspectedCharacterPack {
  definition: CharacterPackDefinition;
  images: Map<string, Blob>;
  parts: CharacterPackPart[];
  issues: string[];
  compressedBytes: number;
  expandedBytes: number;
}

type ZipEntry = { name: string; offset: number; size: number; expandedSize: number; crc: number; method: number; flags: number };
const reject = (message: string): never => { throw new CharacterPackError(message); };
const reader = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const decoder = new TextDecoder("utf-8", { fatal: true });
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject("Character manifest contains an invalid object.");
  return value as Record<string, unknown>;
};
const hasControlCharacter = (value: string) => [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const str = (value: unknown, what: string, max = 200): string => {
  if (typeof value !== "string" || !value.trim() || value.length > max || hasControlCharacter(value)) reject(`${what} must be readable text (1–${max} characters).`);
  return value as string;
};
const reservedKeys = new Set(["__proto__", "prototype", "constructor"]);
function safeKey(value: unknown, what: string, max = 80): string {
  const name = str(value, what, max);
  if (reservedKeys.has(name)) reject(`${what} uses a reserved object property name.`);
  return name;
}
const finite = (value: unknown, what: string, lower = -100_000, upper = 100_000): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < lower || value > upper) reject(`${what} must be a finite number from ${lower} to ${upper}.`);
  return value as number;
};
const owns = (source: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(source, key);
const poseFields = new Set(["x", "y", "rotation", "scaleX", "scaleY"]);
function validatePoseDelta(value: unknown, name: string): void {
  const pose = object(value);
  for (const [key, number] of Object.entries(pose)) {
    if (!poseFields.has(key)) reject(`${name} has unsupported transform field ${key}.`);
    finite(number, `${name} ${key}`);
  }
}
const isSafePath = (path: string): boolean => path.length <= 240 && path.length > 0 &&
  !/^[/.]|[\\:]/.test(path) && !hasControlCharacter(path) &&
  path.split("/").every(segment => !!segment && segment !== "." && segment !== "..");

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let i = 0; i < 8; i++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
const crc32 = (bytes: Uint8Array): number => {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ CRC_TABLE[(value ^ byte) & 255];
  return (value ^ 0xffffffff) >>> 0;
};

function zipEntries(bytes: Uint8Array): ZipEntry[] {
  if (bytes.byteLength > CHARACTER_PACK_LIMITS.compressedBytes) reject("ZIP exceeds the 16 MB import limit.");
  const view = reader(bytes);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  }
  if (end < 0) reject("Missing ZIP central directory. Choose a complete .zip file.");
  const count = view.getUint16(end + 10, true), directorySize = view.getUint32(end + 12, true);
  const directoryOffset = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0 ||
      view.getUint16(end + 8, true) !== count || count > CHARACTER_PACK_LIMITS.entries ||
      count === 0 || count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    reject("Unsupported multi-disk, ZIP64 or oversized archive directory.");
  }
  if (directoryOffset + directorySize !== end) reject("ZIP directory has invalid boundaries.");
  const entries: ZipEntry[] = [], seen = new Set<string>();
  let position = directoryOffset, expandedTotal = 0;
  const compressedRegions: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    if (position + 46 > end || view.getUint32(position, true) !== 0x02014b50) reject("Broken ZIP directory entry.");
    const flags = view.getUint16(position + 8, true), method = view.getUint16(position + 10, true);
    const crc = view.getUint32(position + 16, true), size = view.getUint32(position + 20, true);
    const expandedSize = view.getUint32(position + 24, true), nameLength = view.getUint16(position + 28, true);
    const extra = view.getUint16(position + 30, true), comment = view.getUint16(position + 32, true);
    const disk = view.getUint16(position + 34, true), madeBy = view.getUint16(position + 4, true) >> 8;
    const attrs = view.getUint32(position + 38, true), offset = view.getUint32(position + 42, true);
    const recordEnd = position + 46 + nameLength + extra + comment;
    if (recordEnd > end || size === 0xffffffff || expandedSize === 0xffffffff || offset === 0xffffffff) reject("Malformed or ZIP64 file entry.");
    let name: string;
    try { name = decoder.decode(bytes.subarray(position + 46, position + 46 + nameLength)); }
    catch { return reject("ZIP names must be UTF-8."); }
    position = recordEnd;
    if (!isSafePath(name.endsWith("/") ? name.slice(0, -1) : name)) reject(`Unsafe ZIP path: ${name.slice(0, 100)}`);
    if (seen.has(name.toLowerCase())) reject(`Duplicate ZIP entry: ${name}`);
    seen.add(name.toLowerCase());
    if ((flags & 1) || (flags & 0x40) || ![0, 8].includes(method) || disk !== 0) reject(`Encrypted or unsupported ZIP entry: ${name}`);
    if (madeBy === 3 && ((attrs >>> 16) & 0xf000) === 0xa000) reject(`Symlinks are not allowed: ${name}`);
    if (name.endsWith("/")) continue; // Directory metadata is not an asset.
    if (expandedSize > CHARACTER_PACK_LIMITS.entryBytes) reject(`Layer exceeds 12 MB expanded limit: ${name}`);
    expandedTotal += expandedSize;
    if (expandedTotal > CHARACTER_PACK_LIMITS.expandedBytes) reject("ZIP exceeds the 64 MB expanded limit.");
    if (offset + 30 > directoryOffset || view.getUint32(offset, true) !== 0x04034b50) reject(`Broken ZIP local header: ${name}`);
    const localFlags = view.getUint16(offset + 6, true), localMethod = view.getUint16(offset + 8, true);
    const localNameLength = view.getUint16(offset + 26, true), localExtra = view.getUint16(offset + 28, true);
    const dataStart = offset + 30 + localNameLength + localExtra;
    if (localFlags !== flags || localMethod !== method || dataStart + size > directoryOffset) reject(`ZIP header mismatch: ${name}`);
    let localName: string;
    try { localName = decoder.decode(bytes.subarray(offset + 30, offset + 30 + localNameLength)); }
    catch { return reject(`Invalid UTF-8 local ZIP path: ${name}`); }
    if (localName !== name) reject(`ZIP path mismatch: ${name}`);
    if (compressedRegions.some(([start, stop]) => dataStart < stop && dataStart + size > start)) reject(`Overlapping ZIP entries: ${name}`);
    compressedRegions.push([offset, dataStart + size]);
    entries.push({ name, offset: dataStart, size, expandedSize, crc, method, flags });
  }
  if (position !== end) reject("ZIP directory length mismatch.");
  return entries;
}

async function inflateEntry(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const compressed = bytes.subarray(entry.offset, entry.offset + entry.size);
  if (entry.method === 0) {
    if (compressed.length !== entry.expandedSize) reject(`Size mismatch for ${entry.name}.`);
    if (crc32(compressed) !== entry.crc) reject(`CRC checksum mismatch for ${entry.name}.`);
    return compressed;
  }
  if (typeof DecompressionStream === "undefined") reject("This browser cannot inspect deflated ZIPs. Please use a modern browser.");
  let stream: ReadableStream<Uint8Array>;
  try { stream = new Blob([new Uint8Array(compressed)]).stream().pipeThrough(new DecompressionStream("deflate-raw")); }
  catch { return reject("Raw DEFLATE decompression is not supported in this browser."); }
  const result: Uint8Array[] = [];
  const r = stream.getReader();
  let count = 0;
  try {
    for (;;) {
      const { value, done } = await r.read();
      if (done) break;
      count += value.byteLength;
      if (count > entry.expandedSize || count > CHARACTER_PACK_LIMITS.entryBytes) reject(`Decompressed size exceeds limit: ${entry.name}`);
      result.push(value);
    }
  } catch (error) {
    try { await r.cancel(); } catch { /* A failed stream may already be closed. */ }
    if (error instanceof CharacterPackError) throw error;
    return reject(`Could not decompress ${entry.name}.`);
  } finally { r.releaseLock(); }
  if (count !== entry.expandedSize) reject(`Expanded size mismatch for ${entry.name}.`);
  const output = new Uint8Array(count);
  let offset = 0;
  for (const chunk of result) { output.set(chunk, offset); offset += chunk.length; }
  if (crc32(output) !== entry.crc) reject(`CRC checksum mismatch for ${entry.name}.`);
  return output;
}

function validateManifest(value: unknown): CharacterPackDefinition {
  const doc = object(value);
  if (doc.schemaVersion !== 1) reject("Unsupported character schema version. Expected 1.");
  safeKey(doc.characterId, "characterId", 80);
  str(doc.revision, "revision", 64);
  if (doc.mode !== "sprite-2d" && doc.mode !== "puppet-2.5d") reject("mode must be sprite-2d or puppet-2.5d.");
  const design = object(doc.design);
  finite(design.width, "canvas width", 1, 8192);
  finite(design.height, "canvas height", 1, 8192);
  const channelValues = doc.channels;
  if (!Array.isArray(channelValues) || !channelValues.length || channelValues.length > 32) reject("Declare 1–32 animation channels.");
  const channels = new Set<string>((channelValues as unknown[]).map(value => safeKey(value, "channel", 64)));
  if (channels.size !== (channelValues as unknown[]).length) reject("Animation channels must be unique.");
  const assets = object(doc.assets);
  if (!Object.keys(assets).length || Object.keys(assets).length > 128) reject("Declare 1–128 sprite assets.");
  const assetPaths = new Set<string>();
  for (const [key, raw] of Object.entries(assets)) {
    safeKey(key, "asset key", 80);
    const asset = object(raw);
    if (asset.kind !== "image") reject(`Asset ${key} is not an image; this inspector currently supports raster layers only.`);
    const uri = str(asset.uri, `${key} file path`, 240);
    if (!isSafePath(uri) || !uri.startsWith("layers/")) reject(`Asset ${key} must use a safe layers/ path.`);
    // Different asset records pointing at one file can declare conflicting
    // checksums/dimensions. The second record would otherwise skip verification.
    if (assetPaths.has(uri)) reject(`Duplicate asset file path: ${uri}. Reuse the same asset ID across parts.`);
    assetPaths.add(uri);
    if ((asset.mediaType === "image/png" && !uri.endsWith(".png")) || (asset.mediaType === "image/webp" && !uri.endsWith(".webp")) ||
        (asset.mediaType !== "image/png" && asset.mediaType !== "image/webp")) reject(`Asset ${key} needs matching PNG or WebP media type and extension.`);
    finite(asset.width, `${key} width`, 1, 8192);
    finite(asset.height, `${key} height`, 1, 8192);
    const rights = object(asset.provenance);
    str(rights.source, `${key} source`);
    str(rights.license, `${key} license`);
    if (asset.sha256 !== undefined && (typeof asset.sha256 !== "string" || !/^[a-f\d]{64}$/i.test(asset.sha256))) reject(`Asset ${key} SHA-256 is invalid.`);
  }
  const partValues = doc.parts;
  if (!Array.isArray(partValues) || !partValues.length || partValues.length > 128) reject("Declare 1–128 character parts.");
  const parts = new Map<string, CharacterPackPart>();
  for (const raw of partValues as unknown[]) {
    const part = object(raw), id = safeKey(part.id, "part id", 80);
    if (parts.has(id)) reject(`Duplicate part: ${id}`);
    if (!channels.has(part.channel as string)) reject(`Part ${id} uses an undeclared channel.`);
    if (typeof part.asset !== "string" || !owns(assets, part.asset)) reject(`Part ${id} refers to a missing asset.`);
    const pivot = object(part.pivot);
    finite(pivot.x, `${id} pivot x`);
    finite(pivot.y, `${id} pivot y`);
    if (part.rest !== undefined) validatePoseDelta(part.rest, `${id} rest`);
    finite(part.z, `${id} z-index`, -1000, 1000);
    if (part.parent !== undefined) safeKey(part.parent, `${id} parent`, 80);
    if (part.variants !== undefined) {
      for (const [variant, asset] of Object.entries(object(part.variants))) {
        safeKey(variant, `${id} variant`, 80);
        if (typeof asset !== "string" || !owns(assets, asset)) reject(`Variant ${variant} on ${id} has no asset.`);
      }
    }
    parts.set(id, part as unknown as CharacterPackPart);
  }
  for (const part of parts.values()) {
    const traversed = new Set<string>();
    let parent: string | undefined = part.parent;
    while (parent) {
      if (!parts.has(parent) || traversed.has(parent) || parent === part.id) reject(`Missing parent or cycle in part hierarchy: ${part.id}`);
      traversed.add(parent);
      parent = parts.get(parent)?.parent;
    }
  }
  const poses = object(doc.poses);
  if (Object.keys(poses).length > 64) reject("Character pack declares too many poses (64 max).");
  for (const [name, rawPose] of Object.entries(poses)) {
    safeKey(name, "pose name", 80);
    const pose = object(rawPose);
    for (const [id, transform] of Object.entries(pose)) {
      if (!parts.has(id)) reject(`Pose ${name} refers to unknown part ${id}.`);
      validatePoseDelta(transform, `Pose ${name} on ${id}`);
    }
  }
  if (!Object.prototype.hasOwnProperty.call(poses, safeKey(doc.basePose, "basePose", 80))) reject("basePose must name a declared pose.");
  if (doc.anchors !== undefined) {
    const anchors = object(doc.anchors);
    if (Object.keys(anchors).length > 128) reject("Character pack declares too many anchors (128 max).");
    for (const [name, value] of Object.entries(anchors)) {
      safeKey(name, "anchor name", 80);
      const anchor = object(value), at = object(anchor.at);
      finite(at.x, `Anchor ${name} x`);
      finite(at.y, `Anchor ${name} y`);
      if (anchor.part !== undefined && (typeof anchor.part !== "string" || !parts.has(anchor.part))) {
        reject(`Anchor ${name} refers to unknown part.`);
      }
    }
  }
  for (const field of ["actions", "skins", "params"] as const) {
    if (doc[field] === undefined) continue;
    const declarations = object(doc[field]);
    if (Object.keys(declarations).length > 128) reject(`${field} exceeds 128 declarations.`);
    for (const name of Object.keys(declarations)) safeKey(name, `${field} key`);
  }
  if (doc.expressions !== undefined) {
    const expressions = object(doc.expressions);
    if (expressions.sets !== undefined) {
      const sets = object(expressions.sets);
      for (const name of Object.keys(sets)) safeKey(name, "expression key");
    }
  }
  // A talking beak can require an alternate clean head while speech is active.
  // Validate its cross-part references before passing the manifest to Kumiki;
  // the inspector otherwise retains unknown animation fields without checking them.
  if (doc.speech !== undefined) {
    const speech = object(doc.speech);
    const mouthId = safeKey(speech.mouthPart, "speech mouth part");
    const mouth = parts.get(mouthId) ?? reject(`Speech refers to unknown mouth part ${mouthId}.`);
    const rest = safeKey(speech.rest, "speech resting mouth variant");
    // The resting pose may use the part's default image, without a named variant.
    const visemes = object(speech.visemes);
    if (Object.keys(visemes).length > 64) reject("Speech declares too many visemes (64 max).");
    for (const [key, value] of Object.entries(visemes)) {
      safeKey(key, "viseme key");
      const variant = safeKey(value, `viseme ${key}`);
      if (variant !== rest && !owns(mouth.variants ?? {}, variant)) reject(`Speech viseme ${key} refers to missing variant ${variant} on ${mouthId}.`);
    }
    if (!Array.isArray(speech.approximateCycle) || speech.approximateCycle.length > 64) reject("Speech approximateCycle must contain at most 64 mouth variants.");
    for (const value of speech.approximateCycle as unknown[]) {
      const variant = safeKey(value, "speech cycle variant");
      if (variant !== rest && !owns(mouth.variants ?? {}, variant)) reject(`Speech cycle refers to missing variant ${variant} on ${mouthId}.`);
    }
    finite(speech.approximateStepFrames, "speech approximateStepFrames", 1, 120);
    if (speech.transitionFrames !== undefined) finite(speech.transitionFrames, "speech transitionFrames", 0, 120);
    if (speech.activeVariants !== undefined) {
      const companions = object(speech.activeVariants);
      if (Object.keys(companions).length > 16) reject("Speech may switch at most 16 companion parts.");
      for (const [id, value] of Object.entries(companions)) {
        safeKey(id, "speech companion part");
        const variant = safeKey(value, `speech companion ${id} variant`);
        if (id === mouthId) reject("Speech companion variants cannot override the mouth part.");
        const part = parts.get(id);
        if (!part || !owns(part.variants ?? {}, variant)) reject(`Speech companion ${id} refers to missing part or variant ${variant}.`);
      }
    }
  }
  object(doc.palette);
  const caps = doc.capabilities;
  if (!Array.isArray(caps)) reject("capabilities must be an array.");
  (caps as unknown[]).forEach(value => str(value, "capability", 80));
  return doc as unknown as CharacterPackDefinition;
}

const sniffImage = (data: Uint8Array, asset: CharacterPackAsset, name: string) => {
  if (asset.mediaType === "image/png") {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (data.length < 24 || !signature.every((byte, i) => data[i] === byte)) reject(`Invalid PNG signature: ${name}`);
    const view = reader(data);
    if (view.getUint32(16) !== asset.width || view.getUint32(20) !== asset.height) reject(`PNG dimensions do not match the manifest: ${name}`);
  } else if (data.length < 12 || decoder.decode(data.subarray(0, 4)) !== "RIFF" || decoder.decode(data.subarray(8, 12)) !== "WEBP") {
    reject(`Invalid WebP signature: ${name}`);
  }
};

export async function inspectCharacterZip(source: ArrayBuffer): Promise<InspectedCharacterPack> {
  const bytes = new Uint8Array(source), entries = zipEntries(bytes);
  const byName = new Map(entries.map(entry => [entry.name, entry]));
  const manifest = byName.get("character.json") ?? reject(
    entries.some(entry => entry.name.endsWith(".rig.json"))
      ? "This is a standalone rig kit. ContentGen requires a portable ZIP with character.json at the root and PNG/WebP images under layers/."
      : "Missing character.json at the ZIP root.",
  );
  if (manifest.expandedSize > CHARACTER_PACK_LIMITS.manifestBytes) reject("character.json exceeds the 1 MB limit.");
  let document: unknown;
  try { document = JSON.parse(decoder.decode(await inflateEntry(bytes, manifest))); }
  catch (error) {
    if (error instanceof CharacterPackError) throw error;
    return reject("character.json is not valid UTF-8 JSON.");
  }
  const definition = validateManifest(document);
  const images = new Map<string, Blob>();
  let expandedBytes = manifest.expandedSize;
  for (const asset of Object.values(definition.assets)) {
    const entry = byName.get(asset.uri) ?? reject(`Missing layer referenced by character.json: ${asset.uri}`);
    if (images.has(asset.uri)) continue;
    const data = await inflateEntry(bytes, entry);
    sniffImage(data, asset, asset.uri);
    if (asset.sha256) {
      if (!globalThis.crypto?.subtle) reject("SHA-256 verification is not available in this browser.");
      const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(data));
      const hex = [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, "0")).join("");
      if (hex !== asset.sha256.toLowerCase()) reject(`SHA-256 mismatch for ${asset.uri}`);
    }
    images.set(asset.uri, new Blob([new Uint8Array(data)], { type: asset.mediaType }));
    expandedBytes += data.length;
  }
  // Never treat additional executable/unknown files as trusted material.
  for (const entry of entries) {
    if (entry.name !== "character.json" && !entry.name.startsWith("layers/") && !entry.name.startsWith("docs/")) reject(`Unexpected file outside layers/ or docs/: ${entry.name}`);
    if (entry.name.startsWith("layers/") && !images.has(entry.name)) reject(`Unreferenced image in ZIP: ${entry.name}`);
    if (entry.name.startsWith("docs/") && !/\.(md|txt)$/i.test(entry.name)) reject(`Unsupported documentation file: ${entry.name}`);
  }
  return { definition, images, parts: definition.parts, issues: [], compressedBytes: bytes.byteLength, expandedBytes };
}
