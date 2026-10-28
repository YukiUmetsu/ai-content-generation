/** Produce editable, script-grounded Kumiki compositions and verified PNGs.
 * The composer is the same pinned MediaDocument implementation used by Publish Kit.
 */
import { createHash,randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat,mkdir,readFile,rename,rm,writeFile } from "node:fs/promises";
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

async function ownedFile(path,limit){
  const entry=await lstat(path);
  if(!entry.isFile()||entry.isSymbolicLink()||entry.size<1||entry.size>limit)
    throw Error("A cached thumbnail artifact is unsafe or too large.");
  return readFile(path);
}

async function readVerifiedConcept(directory,name,svgHash){
  if(!directory)return null;
  let record;
  try{
    record=JSON.parse(await ownedFile(join(directory,`${name}.json`),1024));
  }catch(error){if(error?.code==="ENOENT")return null;throw error;}
  if(record.name!==name||record.sourceSha256!==svgHash||
    !/^[a-f0-9]{64}$/u.test(record.sha256??""))return null;
  const source=await ownedFile(join(directory,`${name}.svg`),2_000_000);
  const png=await ownedFile(join(directory,`${name}.png`),12*1024*1024);
  verifyPng(png);
  if(hash(source)!==svgHash||hash(png)!==record.sha256)
    throw Error("Cached thumbnail failed checksum verification.");
  return {source,png,sha256:record.sha256};
}

async function reusableConcept(directory,name,svgHash){
  try{return await readVerifiedConcept(directory,name,svgHash);}
  catch(error){
    // Corrupt/truncated cached media is an ordinary cache miss. Re-render the
    // affected concept, but never paper over a symlink or filesystem denial.
    if(error instanceof SyntaxError||error?.code==="ENOENT"||
      ["Cached thumbnail failed checksum verification.",
        "Kumiki thumbnail export is not a valid 1280×720 PNG."].includes(error?.message))return null;
    throw error;
  }
}

async function persistConcept(directory,name,source,png,sourceSha256,sha256){
  await mkdir(directory,{recursive:true,mode:0o700});
  const id=randomUUID(),working=`.thumbnail-${id}`;
  const staging=[join(directory,working+".svg"),join(directory,working+".png"),
    join(directory,working+".json")];
  try{
    await writeFile(staging[0],source,{flag:"wx",mode:0o600});
    await writeFile(staging[1],png,{flag:"wx",mode:0o600});
    await writeFile(staging[2],JSON.stringify({name,sourceSha256,sha256}),{flag:"wx",mode:0o600});
    await rename(staging[0],join(directory,`${name}.svg`));
    await rename(staging[1],join(directory,`${name}.png`));
    // Commit marker is last: a killed worker cannot make partial output reusable.
    await rename(staging[2],join(directory,`${name}.json`));
  }finally{await Promise.all(staging.map(path=>rm(path,{force:true})));}
}

export async function generateProductionThumbnails(job, { outputDir,cacheDir,reuseCacheDir,sceneJobs,
  ffmpeg = "ffmpeg", signal,
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
  const outputs = new Array(artworks.length);
  async function generateConcept(index) {
    if (signal?.aborted) throw signal.reason ?? Error("Thumbnail generation cancelled.");
    const art = artworks[index];
    if (!art?.media || typeof art.svg !== "string" || art.svg.length > 2_000_000 ||
      /<(?:script|foreignObject|image)\b/iu.test(art.svg)) {
      throw Error("Kumiki returned an unsafe or incomplete thumbnail composition.");
    }
    const name = `thumbnail-${index + 1}`;
    const svgPath = join(outputDir, `${name}.svg`);
    const pngPath = join(outputDir, `${name}.png`);
    const source=Buffer.from(art.svg),sourceSha256=hash(source);
    let cached=await reusableConcept(cacheDir,name,sourceSha256);
    const cachedLocally=Boolean(cached);
    if(!cached)cached=await reusableConcept(reuseCacheDir,name,sourceSha256);
    let attempt=null;
    try{
      if(cached){
        if(signal?.aborted)throw signal.reason??Error("Thumbnail generation cancelled.");
        await writeFile(svgPath,cached.source,{flag:"wx",mode:0o600});
        await writeFile(pngPath,cached.png,{flag:"wx",mode:0o600});
        if(cacheDir&&!cachedLocally)
          await persistConcept(cacheDir,name,cached.source,cached.png,sourceSha256,cached.sha256);
      }else{
        if(sceneJobs){
          attempt=await sceneJobs.beginScene({kind:"thumbnail-concept",sceneId:name,
            fingerprint:sourceSha256});
        }
        if(signal?.aborted)throw signal.reason??Error("Thumbnail generation cancelled.");
        await writeFile(svgPath,source,{flag:"wx",mode:0o600});
        if (convert) await convert(svgPath, pngPath, { signal, ffmpeg });
        else await exec(ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostdin", "-n",
          "-protocol_whitelist", "file,pipe", "-i", svgPath, "-frames:v", "1",
          "-vf", "scale=1280:720:flags=lanczos", "-pix_fmt", "rgb24", pngPath],
        { signal, timeout: 90_000, maxBuffer: 64 * 1024 });
      }
      const bytes=await readFile(pngPath);
      verifyPng(bytes);
      const digest=hash(bytes);
      if(cacheDir&&!cached)await persistConcept(cacheDir,name,source,bytes,sourceSha256,digest);
      if(attempt)await sceneJobs.completeScene(attempt,{sha256:digest});
      outputs[index] = { id: name, label: art.label, headline: copy.headlines[index],
        file: `${name}.png`, source: `${name}.svg`, sha256: digest,
        sourceSha256, width: 1280, height: 720 };
    }catch(error){
      if(attempt)await sceneJobs.failScene(attempt,error);
      throw error;
    }
  }
  // Each concept has an independent durable claim and distinct owned files.
  // All three may execute together. Drain all in-flight work on failure before
  // the caller cleans up or advances the parent Job; successful concepts stay
  // hash-verified in the cache for a targeted retry.
  const results=await Promise.allSettled(artworks.map((_,index)=>generateConcept(index)));
  const failed=results.find(result=>result.status==="rejected");
  if(failed)throw failed.reason;
  return outputs;
}
