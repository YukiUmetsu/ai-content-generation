/** Immutable, rights-reviewed media bindings for the existing Kumiki capture stage. */
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { DEFAULT_ROOT, listSelectedSceneAssets } from "./asset-discovery.mjs";

const exec = promisify(execFile);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const HEX = /^[a-f0-9]{64}$/u;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/u;
const LIMIT = 80 * 1024 * 1024;
const fail = message => { throw Error(`Selected scene media: ${message}`); };

/** Input identity is independent of paths/timestamps, and changes on selection edits. */
export function selectedMediaFingerprint(selected, shotMap) {
  if (!Array.isArray(shotMap) || shotMap.length > 60 || new Set(shotMap.map(s => s.shotId)).size !== shotMap.length ||
    new Set(shotMap.map(s => s.beatId)).size !== shotMap.length ||
    shotMap.some(s => !ID.test(s.shotId) || !ID.test(s.beatId))) fail("invalid shot-to-narration mapping");
  if (!Array.isArray(selected?.selections) || !Array.isArray(selected?.invalidShots)) fail("unreadable saved selections");
  const mapped = new Set(shotMap.map(s => s.shotId));
  if (selected.invalidShots.some(id => mapped.has(id))) fail("a selected asset has changed or is missing; review the affected scene");
  const selections = selected.selections.filter(s => mapped.has(s.shotId)).sort((a, b) => a.shotId.localeCompare(b.shotId));
  if (new Set(selections.map(s => s.shotId)).size !== selections.length) fail("multiple selections for one scene");
  for (const s of selections) {
    if (!ID.test(s.assetId) || !HEX.test(s.sha256) || s.provider !== "pexels" ||
      !["photo", "video"].includes(s.assetType) || s.rightsStatus !== "user-reviewed" ||
      typeof s.sourceUrl !== "string" || !s.sourceUrl.startsWith("https://www.pexels.com/") ||
      s.license !== "Pexels License" || s.licenseUrl !== "https://www.pexels.com/license/")
      fail("unsupported or unreviewed selected media; choose a reviewed Pexels photograph or video");
  }
  return hash(JSON.stringify(selections.map(s => [s.shotId, s.provider, s.assetType, s.assetId, s.sha256])));
}

/** FFprobe is mandatory for MP4 codec, dimensions and measured duration. */
export async function probeApprovedFootage(path, { ffprobe = "ffprobe", signal } = {}) {
  const { stdout } = await exec(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries",
    "stream=codec_name,width,height:format=duration", "-of", "json", path],
  { timeout: 30000, signal, maxBuffer: 32 * 1024 });
  let data;
  try { data = JSON.parse(stdout); } catch { fail("FFprobe returned unreadable video metadata"); }
  return { codec: data.streams?.[0]?.codec_name, width: data.streams?.[0]?.width,
    height: data.streams?.[0]?.height, durationSeconds: Number(data.format?.duration) };
}

/** Copies exact reviewed bytes into a job-owned, content-addressed directory. */
export async function prepareApprovedSceneMedia({ projectId, shotMap, outputDir, expectedFingerprint, signal },
  { root, listSelections = listSelectedSceneAssets, probeFootage = probeApprovedFootage, ffprobe } = {}) {
  if (!ID.test(projectId) || typeof outputDir !== "string" || !outputDir.trim()) fail("invalid production destination");
  if (signal?.aborted) throw signal.reason ?? Error("Media preparation cancelled");
  const selected = await listSelections({ projectId }, root ? { root } : {});
  const fingerprint = selectedMediaFingerprint(selected, shotMap);
  if (expectedFingerprint && expectedFingerprint !== fingerprint)
    fail("scene selection changed after readiness check; check the updated scenes and retry");
  const map = new Map(shotMap.map(s => [s.shotId, s.beatId]));
  const sourceRoot = selected.selections.some(s => map.has(s.shotId)) ?
    await realpath(resolve(root ?? DEFAULT_ROOT)) : null;
  const bindings = {}, assets = [];
  for (const asset of selected.selections.filter(s => map.has(s.shotId))) {
    if (signal?.aborted) throw signal.reason ?? Error("Media preparation cancelled");
    const original = resolve(asset.localPath ?? "");
    if (!isAbsolute(asset.localPath ?? ""))
      fail("approved source path escapes its local asset directory");
    if (sourceRoot) {
      let actual;
      try { actual = await realpath(original); } catch { fail(`approved media for scene ${asset.shotId} is missing`); }
      const position = relative(sourceRoot, actual);
      if (!position || position.startsWith("..") || isAbsolute(position))
        fail("approved source path escapes its local asset directory through a symbolic link");
    }
    let info;
    try { info = await lstat(original); } catch { fail(`approved media for scene ${asset.shotId} is missing`); }
    if (!info.isFile() || info.isSymbolicLink() || info.size < 12 || info.size > LIMIT)
      fail("approved media is a symbolic link, empty, or exceeds the 80 MB limit");
    const bytes = await readFile(original);
    if (bytes.length !== asset.sizeBytes || hash(bytes) !== asset.sha256)
      fail(`approved media for scene ${asset.shotId} changed; review and import again`);
    const video = asset.assetType === "video";
    if (video ? bytes.toString("ascii", 4, 8) !== "ftyp" :
      !(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff &&
        bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9))
      fail("media payload is not a supported MP4 or JPEG");
    let details = {};
    if (video) {
      const probe = await probeFootage(original, { ffprobe, signal });
      if (probe.codec !== "h264" || !Number.isSafeInteger(probe.width) || !Number.isSafeInteger(probe.height) ||
        probe.width < 320 || probe.height < 240 || probe.width > 3840 || probe.height > 2160 ||
        !Number.isFinite(probe.durationSeconds) || probe.durationSeconds < 0.25 || probe.durationSeconds > 90)
        fail("footage must be a decodable H.264 MP4 under 90 seconds with usable dimensions");
      details = { durationSeconds: probe.durationSeconds, width: probe.width, height: probe.height };
    }
    await mkdir(outputDir, { recursive: true, mode: 0o700 });
    const filename = `${asset.sha256}.${video ? "mp4" : "jpg"}`;
    const destination = join(outputDir, filename);
    let present = false;
    try {
      const existing = await lstat(destination);
      if (!existing.isFile() || existing.isSymbolicLink() || hash(await readFile(destination)) !== asset.sha256)
        fail("cached scene media is damaged; inspect the job-owned media before retrying");
      present = true;
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (!present) {
      const temporary = join(outputDir, `.media-${randomUUID()}`);
      try {
        await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
        await rename(temporary, destination);
      } finally { await rm(temporary, { force: true }); }
    }
    const url = `/__video_media/${filename}`;
    bindings[map.get(asset.shotId)] = { assetType: asset.assetType, url, sha256: asset.sha256,
      provider: asset.provider, assetId: asset.assetId, sourceUrl: asset.sourceUrl,
      license: asset.license, licenseUrl: asset.licenseUrl, creator: asset.creator ?? "", ...details };
    assets.push({ url, path: destination, sha256: asset.sha256, assetType: asset.assetType });
  }
  return { fingerprint, bindings, assets };
}
