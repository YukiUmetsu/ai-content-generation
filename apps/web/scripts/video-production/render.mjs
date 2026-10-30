/** Bounded browser frame capture: verified H.264 segments, safe resume, capped review stills. */
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { promisify } from "node:util";
import { access, chmod, copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { listRenderChunks, reusableChapter } from "./media-reuse.mjs";
import { mediaToolFailureReason } from "./media-tool-error.mjs";
import { characterRasterPreflightList } from "./character-rig-render.mjs";
import { assertReviewStillBudget, MAX_SCENE_REVIEW_STILLS } from "./scene-review-coverage.mjs";
import { constants } from "node:fs";
import { basename, join, parse, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { homedir } from "node:os";
import { isDeepStrictEqual } from "node:util";

const exec = promisify(execFile);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
async function sha256File(path) {
  const hash=createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
const fail = (message) => { throw new Error(`Video export failed: ${message}`); };
const integer = (value, min) => Number.isSafeInteger(value) && value >= min;

/** Preserve incomplete worker artifacts for inspection without ever treating
 * them as valid cache entries. Only narrow, known regular files in the owned
 * render directory may be moved aside; links and directories are rejected. */
async function quarantineInterruptedFile(path) {
  let info;
  try { info = await lstat(path); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  if (!info.isFile() || info.isSymbolicLink()) fail("interrupted render artifact is not an owned regular file");
  await rename(path, join(resolve(path, ".."), `.recovery-${randomUUID()}-${basename(path)}`));
}

async function regularArtifact(path, maxBytes) {
  let info;
  try { info = await lstat(path); }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes)
    fail("interrupted render cache contains an unsafe file");
  return true;
}

async function safeRenderDirectory(path) {
  const absolute=resolve(path),root=parse(absolute).root;
  let current=root;
  for (const part of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current=join(current,part);
    try { await mkdir(current,{mode:0o700}); }
    catch (error) { if (error.code!=="EEXIST") throw error; }
    const info=await lstat(current);
    // macOS exposes /var and /tmp as fixed OS-managed links into /private.
    // Accept only those exact canonical targets, never project-controlled links.
    if (info.isSymbolicLink() && process.platform==="darwin" &&
        ((current==="/var" && await realpath(current)==="/private/var") ||
         (current==="/tmp" && await realpath(current)==="/private/tmp"))) continue;
    if (!info.isDirectory() || info.isSymbolicLink())
      fail("export output contains an unsafe linked or non-directory parent");
  }
}

/** Launch and close the actual installed browser before any billable synthesis. */
export async function probeBrowserExecutable(browserExecutable) {
  if (!browserExecutable) fail("configure an already-installed Chromium executable");
  try { await access(browserExecutable, constants.X_OK); }
  catch { fail("configured Chromium executable is missing or not executable"); }
  let chromium;
  try { ({ chromium } = await import("playwright-core")); }
  catch { fail("install the pinned playwright-core package before narration synthesis"); }
  let browser;
  try {
    browser = await chromium.launch({ executablePath: browserExecutable, headless: true, timeout: 30000 });
    const page = await browser.newPage();
    await page.close();
  } catch { fail("Chromium cannot launch and open an export page in this environment"); }
  finally { if (browser) await browser.close(); }
}

async function runTool(program, args, { signal, timeout = 600000 } = {}) {
  try { return await exec(program, args, { signal, timeout, maxBuffer: 512 * 1024 }); }
  catch (error) {
    const reason = mediaToolFailureReason(program, error);
    if (!reason) throw error;
    fail(reason);
  }
}

function verifyManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== 1 || !manifest.id ||
    !integer(manifest.width, 2) || !integer(manifest.height, 2) ||
    manifest.width > 7680 || manifest.height > 4320 || manifest.width % 2 || manifest.height % 2 ||
    !integer(manifest.durationFrames, 1) ||
    !integer(manifest.fps?.num, 1) || !integer(manifest.fps?.den, 1) ||
    manifest.fps.num / manifest.fps.den > 120) fail("invalid fixed-raster rational-FPS video manifest");
}

function validateOptions(options) {
  verifyManifest(options?.manifest);
  if (!/^[a-f\d]{64}$/i.test(options?.planHash ?? "")) fail("a SHA-256 validated render-plan hash is required for safe segment resume");
  if (!/^[a-f\d]{64}$/i.test(options?.buildHash ?? "")) fail("a SHA-256 identity for the built scene is required for safe segment resume");
  const parsed = new URL(options?.stageUrl ?? "http://invalid/");
  if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
      parsed.username || parsed.password || parsed.search || parsed.hash) fail("video stage must be a plain HTTP loopback endpoint");
  if (!options.outDir || typeof options.outDir !== "string") fail("dedicated export output directory required");
  const dir = resolve(options.outDir);
  if ([parse(dir).root, homedir(), process.cwd(), resolve(process.cwd(), ".."), "/tmp", "/workspace"].includes(dir)) {
    fail("output must be a narrow job-owned directory, not a filesystem root, home or workspace");
  }
  const limit = options.maxBatchFrames ?? 150;
  if (!integer(limit, 1) || limit > 150) fail("maximum capture batch size is 150 frames");
  const reviewFrames = options.reviewFrames ?? [];
  if (!Array.isArray(reviewFrames) || reviewFrames.length > MAX_SCENE_REVIEW_STILLS ||
    reviewFrames.some((frame) => !integer(frame, 0) || frame >= options.manifest.durationFrames) ||
    new Set(reviewFrames).size !== reviewFrames.length ||
    reviewFrames.some((frame, i) => i > 0 && frame <= reviewFrames[i - 1])) {
    fail(`review frames must be at most ${MAX_SCENE_REVIEW_STILLS} unique ascending in-range integer frame indices`);
  }
  return { dir, limit, reviewFrames };
}

function verifyScreenshot(bytes, manifest) {
  if (bytes.byteLength < 24 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
    bytes.readUInt32BE(16) !== manifest.width || bytes.readUInt32BE(20) !== manifest.height ||
    bytes.byteLength > 20 * 1024 * 1024) fail("review still must be a bounded PNG at the exact exported raster");
}

/** Per-segment FFprobe verification. Never trust file existence alone. */
export async function probeVideo(path, { ffprobe = "ffprobe", signal } = {}) {
  const { stdout } = await runTool(ffprobe, ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate,nb_read_frames", "-of", "json", path], { signal, timeout: 30000 });
  let stream;
  try { stream = JSON.parse(stdout).streams?.[0]; }
  catch { fail("invalid FFprobe video JSON"); }
  const ratio = /^(\d+)\/(\d+)$/.exec(stream?.r_frame_rate ?? "");
  if (!ratio || !Number(ratio[2])) fail("FFprobe did not return a rational frame rate");
  const frameCount = Number(stream?.nb_read_frames);
  if (!integer(frameCount, 1)) fail("FFprobe did not return a measured video frame count");
  return { width: stream.width, height: stream.height, frameCount, fps: { num: Number(ratio[1]), den: Number(ratio[2]) } };
}

function matchProbe(actual, expected, count) {
  return actual && actual.width === expected.width && actual.height === expected.height && actual.frameCount === count &&
    actual.fps?.num * expected.fps.den === expected.fps.num * actual.fps.den;
}

/** Only the existing explicit visual-test override may disable Chromium's
 * process sandbox; normal production capture retains browser isolation. */
export function chromiumExportLaunchArgs(env = process.env) {
  return env.CONTENTGEN_BROWSER_TEST_NO_SANDBOX === "1" ? ["--no-sandbox"] : [];
}

async function defaultOpenCapture(stageUrl, manifest, options) {
  if (!options.browserExecutable) fail("configure an already-installed Chromium executable for browser export");
  let chromium;
  try { ({ chromium } = await import("playwright-core")); }
  catch { fail("playwright-core is unavailable; install the pinned driver without downloading a browser"); }
  const browser = await chromium.launch({ executablePath: options.browserExecutable,
    headless: true, args: chromiumExportLaunchArgs() });
  try {
    const page = await browser.newPage({ viewport: { width: manifest.width, height: manifest.height }, deviceScaleFactor: 1, reducedMotion: "reduce" });
    await page.goto(stageUrl, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForFunction(() => Boolean(window.__kmVideoExport?.manifest), undefined, { timeout: 20000 });
    const live = await page.evaluate(() => window.__kmVideoExport?.manifest);
    const buildHash = await page.evaluate(() => window.__contentgenBuildHash);
    // SVG <image> URLs can be present while the artwork is undecodable, which
    // otherwise produces a black/empty actor without any React diagnostic.
    // Decode *all* pinned layers, including expressions not visible in frame 0.
    const characterLayers = characterRasterPreflightList(options.visualPlan?.characterRigs,
      options.visualPlan?.characterRigsByScene);
    if (characterLayers.length) {
      try {
        await page.evaluate(async layers => {
          let cursor = 0;
          await Promise.all(Array.from({length:Math.min(4,layers.length)},async()=>{
            while (cursor < layers.length) {
              const layer = layers[cursor++], image = new Image();
              image.src = layer.url;
              let timer;
              try {
                await Promise.race([
                  image.decode(),
                  new Promise((_, reject) => { timer = setTimeout(() => reject(Error("decode timed out")), 15000); }),
                ]);
              } finally { clearTimeout(timer); }
              if (image.naturalWidth !== layer.width || image.naturalHeight !== layer.height)
                throw Error("decoded dimensions changed");
            }
          }));
        }, characterLayers);
      } catch (error) {
        fail(`saved Character Studio raster failed Chromium image decoding: ${error.message}`);
      }
    }
    return {
      manifest: live,
      buildHash,
      captureFrame: async (absoluteFrame, path) => {
        await page.evaluate((frame) => window.__kmVideoExport.seek(frame), absoluteFrame);
        await page.locator("[data-km-video-capture]").screenshot({ path, animations: "disabled", scale: "css", timeout: 30000 });
      },
      close: async () => browser.close(),
    };
  } catch (error) { await browser.close(); throw error; }
}

async function defaultEncode({ batchDir, frameCount, outputPath, manifest, ffmpeg, signal }) {
  await runTool(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-n", "-framerate", `${manifest.fps.num}/${manifest.fps.den}`,
    "-start_number", "0", "-i", join(batchDir, "frame-%05d.png"), "-frames:v", String(frameCount),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "18", "-r", `${manifest.fps.num}/${manifest.fps.den}`, outputPath,
  ], { signal });
}

async function defaultConcat(paths, outputPath, { ffmpeg, signal }) {
  const dir = resolve(outputPath, "..");
  const listPath = join(dir, `.concat-${randomUUID()}.txt`);
  const segmentsDir = resolve(paths[0], "..");
  const lines = paths.map((path) => {
    if (resolve(path, "..") !== segmentsDir) fail("all segments must reside within the same owned directory");
    const basename = path.slice(segmentsDir.length + 1);
    if (!/^segment-\d{5}\.mp4$/.test(basename)) fail("unexpected segment filename");
    return `file '${path.replace(/'/g, "'\\''")}'`;
  });
  await writeFile(listPath, lines.join("\n") + "\n", { flag: "wx" });
  try {
    await runTool(ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostdin", "-n", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath], { signal });
  } finally { await rm(listPath, { force: true }); }
}

/**
 * @param {{stageUrl:string,manifest:object,planHash:string,buildHash:string,outDir:string,maxBatchFrames?:number,reviewFrames?:number[],browserExecutable?:string,ffmpeg?:string,ffprobe?:string,signal?:AbortSignal,onProgress?:(event:{phase:string,completedFrames:number,totalFrames:number})=>void}} options
 * @param {{openCapture?:Function,encodeBatch?:Function,probeSegment?:Function,concatSegments?:Function,probeFinal?:Function}} dependencies
 */
export async function renderVideoSegments(options, dependencies = {}) {
  const { dir, limit, reviewFrames } = validateOptions(options);
  const { manifest } = options;
  const selectedId=options.onlyChapterId;
  if (selectedId!==undefined && (typeof selectedId!=="string" ||
      !/^[a-z0-9][a-z0-9._:-]{0,127}$/iu.test(selectedId) ||
      !Array.isArray(options.visualPlan?.chapters) ||
      options.visualPlan.chapters.filter(chapter=>chapter.id===selectedId).length!==1))
    fail("choose an existing storyboard scene to render independently");
  const fingerprint = sha256(JSON.stringify({ version: 2, planHash: options.planHash, buildHash: options.buildHash, manifest, h264Profile: "libx264-crf18-yuv420p",
    ...(selectedId===undefined?{}:{onlyChapterId:selectedId}) }));
  const segmentsDir = join(dir, "segments");
  const openCapture = dependencies.openCapture ?? ((url, expected) => defaultOpenCapture(url, expected, options));
  const encodeBatch = dependencies.encodeBatch ?? ((batch) => defaultEncode({ ...batch, ffmpeg: options.ffmpeg ?? "ffmpeg", signal: options.signal }));
  const probe = dependencies.probeSegment ?? ((path) => probeVideo(path, { ffprobe: options.ffprobe ?? "ffprobe", signal: options.signal }));
  const concat = dependencies.concatSegments ?? ((paths, path) => defaultConcat(paths, path, { ffmpeg: options.ffmpeg ?? "ffmpeg", signal: options.signal }));
  const probeFinal = dependencies.probeFinal ?? probe;
  const publishReusableSegment = dependencies.copyReusableSegment ?? (async (from, to) => {
    await copyFile(from, to, constants.COPYFILE_EXCL);
    await chmod(to, 0o600);
  });
  const started = performance.now();
  const allChunks = listRenderChunks(manifest,limit,options.visualPlan);
  const selectedChapter=selectedId===undefined?null:options.visualPlan.chapters.find(chapter=>chapter.id===selectedId);
  const chunks = selectedChapter?allChunks.filter(chunk=>
    chunk.chapterIndex!==null&&options.visualPlan.chapters[chunk.chapterIndex].id===selectedId):allChunks;
  const outputFrames=selectedChapter?selectedChapter.endFrame-selectedChapter.startFrame:manifest.durationFrames;
  if(!chunks.length||chunks.reduce((sum,chunk)=>sum+chunk.frameCount,0)!==outputFrames||
    (selectedChapter&&reviewFrames.some(frame=>frame<selectedChapter.startFrame||frame>=selectedChapter.endFrame)))
    fail("selected scene must have a complete renderable chapter and scene-local preview frames");
  const prior = options.reuseFrom;
  if(prior && (!prior.sourcePlan || !prior.segmentsDir ||
      prior.buildHash!==options.buildHash || !options.visualPlan))
    fail("segment reuse requires a same-build validated previous scene and dedicated segments directory");
  const priorFingerprint = prior ? sha256(JSON.stringify({
    version:2, planHash:sha256(JSON.stringify(prior.sourcePlan)),
    buildHash:prior.buildHash, manifest:prior.sourcePlan.manifest,
    h264Profile:"libx264-crf18-yuv420p"
  })) : null;
  const segments = [];
  const reviewStills = [];
  let peakScratchBytes = 0;
  let reusedSegmentCount = 0, renderedSegmentCount = 0;
  await safeRenderDirectory(segmentsDir);
  let capture = null;
  // Chromium is only needed for a missing or damaged frame. A retry whose
  // saved scenes and review stills still match must not launch a browser.
  async function ensureCapture() {
    if (capture) return capture;
    capture = await openCapture(options.stageUrl, manifest);
    if (!isDeepStrictEqual(capture?.manifest, manifest)) fail("live Kumiki export manifest differs from the validated render plan");
    if (capture?.buildHash !== options.buildHash) fail("live browser export handshake has a mismatched built-scene fingerprint");
    return capture;
  }
  const priorStillsDir = prior?.stillsDir ? resolve(prior.stillsDir) : null;
  try {
    for (const { index,startFrame,frameCount,chapterIndex } of chunks) {
      if (options.signal?.aborted) fail("video capture cancelled");
      const sceneAttempt=await options.sceneJobs?.beginScene({kind:"render-segment",
        sceneId:`segment-${String(index).padStart(5,"0")}`,
        fingerprint:sha256(JSON.stringify({fingerprint,startFrame,frameCount,chapterIndex}))});
      try {
      const name = `segment-${String(index).padStart(5, "0")}.mp4`;
      const path = join(segmentsDir, name), metadataPath = join(segmentsDir, `${name}.json`);
      let completed = false, segmentHash;
      const hasVideo = await regularArtifact(path,256*1024*1024);
      const hasMeta = await regularArtifact(metadataPath,8192);
      if (hasVideo || hasMeta) {
        let damaged = !hasVideo || !hasMeta;
        if (!damaged) {
          let meta;
          try { meta = JSON.parse(await readFile(metadataPath, "utf8")); }
          catch { damaged = true; }
          if (!meta || typeof meta !== "object") damaged = true;
          if (!damaged) {
            // A different production identity is a caller error, never an
            // interrupted artifact that may be silently replaced.
            if (meta.fingerprint !== fingerprint || meta.startFrame !== startFrame ||
                meta.frameCount !== frameCount) fail(`stale resume manifest for ${name}`);
            const bytes = await readFile(path);
            if (sha256(bytes) !== meta.sha256) damaged = true;
            else {
              try { completed = matchProbe(await probe(path), manifest, frameCount); }
              catch (error) { if (options.signal?.aborted) throw error; completed = false; }
              damaged = !completed;
              if (completed) segmentHash = meta.sha256;
            }
          }
        }
        if (damaged) {
          // A SIGKILL may land between publishing the H.264 file and its
          // sidecar, or leave a damaged file. Move both aside, then render
          // only this chunk; all verified siblings remain unchanged.
          if (hasVideo) await quarantineInterruptedFile(path);
          if (hasMeta) await quarantineInterruptedFile(metadataPath);
          options.onProgress?.({phase:"rendering",message:"Restoring an interrupted scene; finished scenes are preserved.",
            startFrame,frameCount,chapterIndex});
        }
      }
      // Reuse unchanged, identical-timeline chapters from the previous render
      // only after checking the old sidecar, H.264 SHA and measured frame count.
      // Every changed scene is rendered normally, never silently treated as equal.
      if(!completed && prior && chapterIndex !== null &&
          reusableChapter(prior.sourcePlan,options.visualPlan,chapterIndex,options.buildHash)){
        const oldFile = join(prior.segmentsDir,name);
        const oldMetaFile = oldFile + ".json";
        let reusableBytes=null,oldHash=null;
        try {
          const [videoInfo,metaInfo]=await Promise.all([lstat(oldFile),lstat(oldMetaFile)]);
          if(videoInfo.isFile()&&!videoInfo.isSymbolicLink()&&videoInfo.size>0&&videoInfo.size<=256*1024*1024&&
            metaInfo.isFile()&&!metaInfo.isSymbolicLink()&&metaInfo.size>16&&metaInfo.size<8192){
            const oldMeta=JSON.parse(await readFile(oldMetaFile,"utf8"));
            if(oldMeta.fingerprint===priorFingerprint&&oldMeta.startFrame===startFrame&&
              oldMeta.frameCount===frameCount&&/^[a-f0-9]{64}$/u.test(oldMeta.sha256??"")){
              if(await sha256File(oldFile)===oldMeta.sha256&&matchProbe(await probe(oldFile),manifest,frameCount)){
                oldHash=oldMeta.sha256;
                reusableBytes=true;
              }
            }
          }
        }catch(error){
          // A previous attempt is an optional cache, never a release. Damaged
          // or missing bytes are regenerated, not converted into new failures.
          if(options.signal?.aborted)throw error;
        }
        if(reusableBytes){
          // The checksum and probe already passed. Copy the file instead of
          // holding the whole scene in memory; exclusive create refuses a race.
          // A failed copy redraws that scene. A full disk still fails the draft.
          let published=false;
          try {
            if(options.signal?.aborted)fail("video capture cancelled");
            await publishReusableSegment(oldFile,path);
            await writeFile(metadataPath,JSON.stringify({
              fingerprint,name,startFrame,frameCount,sha256:oldHash
            },null,2),{flag:"wx"});
            published=true;
          } catch (error) {
            if(options.signal?.aborted||error?.name==="AbortError"||error?.code==="ABORT_ERR")throw error;
            if(error?.code==="ENOSPC"||/\bENOSPC\b|no space left on device/iu.test(error?.message??""))throw error;
            await rm(path,{force:true});
            await rm(metadataPath,{force:true});
          }
          if(published){
            segmentHash=oldHash;
            completed=true;
            reusedSegmentCount++;
            options.onProgress?.({phase:"segment-reused",startFrame,frameCount,chapterIndex});
          }
        }
      }
      if (!completed) {
        const batchDir = await mkdtemp(join(dir, ".capture-"));
        const partialPath = join(segmentsDir, `.partial-${randomUUID()}.mp4`);
        try {
          let scratch = 0;
          const live = await ensureCapture();
          for (let j = 0; j < frameCount; j++) {
            if (options.signal?.aborted) fail("video capture cancelled");
            const file = join(batchDir, `frame-${String(j).padStart(5, "0")}.png`);
            await live.captureFrame(startFrame + j, file);
            const png = await stat(file);
            if (png.size <= 0) fail(`empty PNG screenshot for absolute frame ${startFrame + j}`);
            scratch += png.size;
            peakScratchBytes = Math.max(peakScratchBytes, scratch);
          }
          await encodeBatch({ batchDir, startFrame, frameCount, outputPath: partialPath, manifest });
          const measured = await probe(partialPath);
          if (!matchProbe(measured, manifest, frameCount)) fail(`encoded segment ${name} has incorrect dimensions/FPS/frame count`);
          const bytes = await readFile(partialPath);
          peakScratchBytes = Math.max(peakScratchBytes, scratch + bytes.length);
          segmentHash = sha256(bytes);
          renderedSegmentCount++;
          const meta = { fingerprint, name, startFrame, frameCount, sha256: segmentHash };
          // Video first, then metadata as the commit marker. Missing sidecar means incomplete.
          await rename(partialPath, path);
          const metaTemp = join(segmentsDir, `.metadata-${randomUUID()}.json`);
          try { await writeFile(metaTemp, JSON.stringify(meta, null, 2), { flag: "wx" }); await rename(metaTemp, metadataPath); }
          finally { await rm(metaTemp, { force: true }); }
        } finally {
          await rm(batchDir, { recursive: true, force: true });
          await rm(partialPath, { force: true });
        }
      }
      segments.push({ path, sha256: segmentHash, startFrame, frameCount });
      if(sceneAttempt)await options.sceneJobs.completeScene(sceneAttempt,{
        sha256:segmentHash,frameCount,reused:completed});
      // Report verified progress only after segment metadata and probe succeed, including safe resume.
      options.onProgress?.({ phase: "rendering",
        completedFrames: selectedChapter?startFrame+frameCount-selectedChapter.startFrame:startFrame+frameCount,
        totalFrames: outputFrames });
      } catch(error){
        if(sceneAttempt)await options.sceneJobs.failScene(sceneAttempt,error);
        throw error;
      }
    }
    if (reviewFrames.length) await safeRenderDirectory(join(dir, "stills"));
    let reviewStillBytes=0;
    for (const frame of reviewFrames) {
      if (options.signal?.aborted) fail("review still capture cancelled");
      const path = join(dir, "stills", `frame-${String(frame).padStart(6, "0")}.png`);
      const metadataPath = `${path}.json`;
      const hasImage = await regularArtifact(path,20*1024*1024);
      const hasMetadata = await regularArtifact(metadataPath,8192);
      let digest;
      if (hasImage || hasMetadata) {
        let damaged = !hasImage || !hasMetadata;
        if (!damaged) {
          let metadata;
          try { metadata = JSON.parse(await readFile(metadataPath, "utf8")); }
          catch { damaged = true; }
          if (!metadata || typeof metadata !== "object") damaged = true;
          if (!damaged) {
            if (metadata.fingerprint !== fingerprint || metadata.frame !== frame)
              fail(`stale review still provenance: frame ${frame}`);
            const bytes = await readFile(path);
            digest = sha256(bytes);
            try { verifyScreenshot(bytes, manifest); }
            catch { damaged = true; }
            if (metadata.sha256 !== digest) damaged = true;
          }
        }
        if (damaged) {
          if (hasImage) await quarantineInterruptedFile(path);
          if (hasMetadata) await quarantineInterruptedFile(metadataPath);
          digest = undefined;
          options.onProgress?.({phase:"rendering",message:"Restoring a damaged video preview image.",frame});
        }
      }
      if (!digest && priorStillsDir && priorFingerprint) {
        const oldImage = join(priorStillsDir, `frame-${String(frame).padStart(6, "0")}.png`);
        const oldMetaPath = `${oldImage}.json`;
        try {
          const [imageInfo, metaInfo] = await Promise.all([lstat(oldImage), lstat(oldMetaPath)]);
          if (imageInfo.isFile() && !imageInfo.isSymbolicLink() && imageInfo.size > 0 && imageInfo.size <= 20 * 1024 * 1024 &&
            metaInfo.isFile() && !metaInfo.isSymbolicLink() && metaInfo.size > 16 && metaInfo.size < 8192) {
            const oldMeta = JSON.parse(await readFile(oldMetaPath, "utf8"));
            if (oldMeta.fingerprint === priorFingerprint && oldMeta.frame === frame &&
              /^[a-f0-9]{64}$/u.test(oldMeta.sha256 ?? "") && await sha256File(oldImage) === oldMeta.sha256) {
              const bytes = await readFile(oldImage);
              verifyScreenshot(bytes, manifest);
              if (sha256(bytes) === oldMeta.sha256) {
                await copyFile(oldImage, path, constants.COPYFILE_EXCL);
                await chmod(path, 0o600);
                digest = oldMeta.sha256;
                await writeFile(metadataPath, JSON.stringify({ fingerprint, frame, sha256: digest }, null, 2), { flag: "wx" });
              }
            }
          }
        } catch (error) {
          if (options.signal?.aborted || error?.name === "AbortError" || error?.code === "ABORT_ERR") throw error;
          if (error?.code === "ENOSPC" || /\bENOSPC\b|no space left on device/iu.test(error?.message ?? "")) throw error;
          digest = undefined;
        }
      }
      if (!digest) {
        const temporary = join(dir, "stills", `.frame-${randomUUID()}.png`);
        try {
          await (await ensureCapture()).captureFrame(frame, temporary);
          const bytes = await readFile(temporary);
          verifyScreenshot(bytes, manifest);
          digest = sha256(bytes);
          await rename(temporary, path);
          await writeFile(metadataPath, JSON.stringify({ fingerprint, frame, sha256: digest }, null, 2), { flag: "wx" });
        } finally { await rm(temporary, { force: true }); }
      }
      reviewStillBytes=assertReviewStillBudget(reviewStillBytes,(await lstat(path)).size);
      reviewStills.push({ frame, path, sha256: digest });
    }
  } finally { if (capture) await capture.close(); }

  const videoOnlyPath = join(dir, "video-only.mp4");
  const finalMetadataPath = join(dir, "video-only.mp4.json");
  const hasFinal = await regularArtifact(videoOnlyPath,4*1024*1024*1024);
  const hasFinalMeta = await regularArtifact(finalMetadataPath,8192);
  let finalVerified = false;
  if (hasFinal || hasFinalMeta) {
    let damaged = !hasFinal || !hasFinalMeta;
    if (!damaged) {
      let record;
      try { record = JSON.parse(await readFile(finalMetadataPath, "utf8")); }
      catch { damaged = true; }
      if (!record || typeof record !== "object") damaged = true;
      if (!damaged) {
        if (record.fingerprint !== fingerprint) fail("stale final video resume plan");
        // The finished file is a local artifact, not a user release. A crash
        // before the sidecar write leaves it intact for recovery and re-mux.
        if (record.sha256 !== await sha256File(videoOnlyPath)) damaged = true;
        else {
          try { finalVerified = matchProbe(await probeFinal(videoOnlyPath),manifest,outputFrames); }
          catch (error) { if (options.signal?.aborted) throw error; }
          damaged = !finalVerified;
        }
      }
    }
    if (damaged) {
      if (hasFinal) await quarantineInterruptedFile(videoOnlyPath);
      if (hasFinalMeta) await quarantineInterruptedFile(finalMetadataPath);
      options.onProgress?.({phase:"rendering",message:"Resuming the video assembly without recapturing completed scenes."});
    }
  }
  if (!finalVerified) {
    const stagedPath = join(dir, `.video-only-${randomUUID()}.mp4`);
    try {
      await concat(segments.map((item) => item.path), stagedPath);
      const check = await probeFinal(stagedPath);
      if (!matchProbe(check, manifest, outputFrames)) fail("concatenated video failed final frame/FPS/raster QA");
      const digest = await sha256File(stagedPath);
      await rename(stagedPath, videoOnlyPath);
      await writeFile(finalMetadataPath, JSON.stringify({ fingerprint, sha256: digest, frameCount: outputFrames }, null, 2), { flag: "wx" });
    } finally { await rm(stagedPath, { force: true }); }
  }
  const finishedProbe = await probeFinal(videoOnlyPath);
  if (!matchProbe(finishedProbe, manifest, outputFrames)) fail("finished video lost its verified frame count or FPS");
  return {
    videoOnlyPath, frameCount:outputFrames,
    ...(selectedChapter?{sourceChapterId:selectedId,sourceStartFrame:selectedChapter.startFrame}:{}),
    segmentHashes: segments.map(({ sha256: digest, startFrame, frameCount }) => ({ sha256: digest, startFrame, frameCount })),
    reviewStills, peakScratchBytes, renderedSegmentCount, reusedSegmentCount,
    renderSeconds: (performance.now() - started) / 1000,
  };
}
