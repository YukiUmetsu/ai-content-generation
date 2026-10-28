/** Produce editable, script-grounded Kumiki compositions and verified PNGs.
 * The composer is the same pinned MediaDocument implementation used by Publish Kit.
 */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const webRoot = fileURLToPath(new URL("../..", import.meta.url));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const pngSignature = "89504e470d0a1a0a";

const compact = (value, limit) => {
  const text = String(value ?? "").replace(/\s+/gu, " ").trim();
  if (text.length <= limit) return text;
  const prefix = text.slice(0, limit - 1);
  return prefix.slice(0, Math.max(prefix.lastIndexOf(" "), Math.floor(limit * .65))).trimEnd() + "…";
};

/** No facts/numbers may be invented: candidates come exclusively from visual script copy. */
export function thumbnailCopy(job) {
  if (!Array.isArray(job?.beats) || !job.beats.length || !job.topic?.title) {
    throw Error("Thumbnail generation requires a narrated script with a title.");
  }
  const sections = job.beats.slice(0, 12).map((beat, index) => ({
    id: beat.id ?? String(index),
    heading: compact(beat.visual?.headline || beat.visual?.emphasis || beat.narration, 45),
    text: compact(beat.narration, 160),
  })).filter(section => section.heading && section.text);
  if (!sections.length) throw Error("Thumbnail generation requires nonempty script scenes.");
  const title = compact(job.topic.title, 80);
  const candidates = [title,...sections.map(section=>section.heading),
    ...sections.map(section=>compact(section.text,55)),
    `A closer look: ${title}`,`Inside the story: ${title}`];
  const headlines = [...new Map(candidates.map(value=>[value.toLocaleLowerCase(),value])).values()].slice(0,3);
  if(headlines.length!==3)throw Error("The script lacks three distinct thumbnail messages.");
  return { title, sections, headlines };
}

async function loadKumikiComposer() {
  const { createServer } = await import("vite");
  const vite = await createServer({ root: webRoot, appType: "custom",
    server: { middlewareMode: true, hmr: false }, logLevel: "error" });
  try {
    const module = await vite.ssrLoadModule("/src/features/platform-optimization/cover-art.ts");
    return module.createCoverArtwork;
  } finally { await vite.close(); }
}

function verifyPng(bytes) {
  if (bytes.length < 128 || bytes.length > 12 * 1024 * 1024 ||
    bytes.subarray(0, 8).toString("hex") !== pngSignature ||
    bytes.readUInt32BE(16) !== 1280 || bytes.readUInt32BE(20) !== 720) {
    throw Error("Kumiki thumbnail export is not a valid 1280×720 PNG.");
  }
}

export async function generateProductionThumbnails(job, { outputDir, ffmpeg = "ffmpeg", signal,
  compose = loadKumikiComposer, convert } = {}) {
  if (!outputDir) throw Error("Thumbnails need an owned production output directory.");
  if (signal?.aborted) throw signal.reason ?? Error("Thumbnail generation cancelled.");
  const copy = thumbnailCopy(job);
  const build = await compose();
  const artworks = build(copy.title, copy.sections, "youtube-landscape", undefined,
    "youtube", "draft", undefined, copy.headlines);
  if (!Array.isArray(artworks) || artworks.length !== 3 ||
    new Set(artworks.map(art => art.id)).size !== 3) {
    throw Error("Kumiki did not produce three distinct thumbnail compositions.");
  }
  const outputs = [];
  for (let index = 0; index < artworks.length; index++) {
    if (signal?.aborted) throw signal.reason ?? Error("Thumbnail generation cancelled.");
    const art = artworks[index];
    if (!art?.media || typeof art.svg !== "string" || art.svg.length > 2_000_000 ||
      /<(?:script|foreignObject|image)\b/iu.test(art.svg)) {
      throw Error("Kumiki returned an unsafe or incomplete thumbnail composition.");
    }
    const name = `thumbnail-${index + 1}`;
    const svgPath = join(outputDir, `${name}.svg`);
    const pngPath = join(outputDir, `${name}.png`);
    await writeFile(svgPath, art.svg, { flag: "wx", mode: 0o600 });
    if (convert) await convert(svgPath, pngPath, { signal, ffmpeg });
    else await exec(ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostdin", "-n",
      "-protocol_whitelist", "file,pipe", "-i", svgPath, "-frames:v", "1",
      "-vf", "scale=1280:720:flags=lanczos", "-pix_fmt", "rgb24", pngPath],
    { signal, timeout: 90_000, maxBuffer: 64 * 1024 });
    const bytes = await readFile(pngPath);
    verifyPng(bytes);
    outputs.push({ id: name, label: art.label, headline: copy.headlines[index],
      file: `${name}.png`, source: `${name}.svg`, sha256: hash(bytes),
      sourceSha256: hash(Buffer.from(art.svg)), width: 1280, height: 720 });
  }
  return outputs;
}
