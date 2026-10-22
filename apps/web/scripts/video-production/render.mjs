/** Bounded browser frame capture: verified H.264 segments, safe resume, no PNG hoarding. */
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, parse, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { homedir } from "node:os";
import { isDeepStrictEqual } from "node:util";

const exec = promisify(execFile);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fail = (message) => { throw new Error(`Video export failed: ${message}`); };
const integer = (value, min) => Number.isSafeInteger(value) && value >= min;
const exists = async (path) => stat(path).then(() => true, (error) => error.code !== "ENOENT");

async function runTool(program, args, { signal, timeout = 600000 } = {}) {
  try { return await exec(program, args, { signal, timeout, maxBuffer: 512 * 1024 }); }
  catch (error) { fail(`${program} exited unsuccessfully (${error.code ?? error.signal ?? "unknown"}).`); }
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
  return { dir, limit };
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

async function defaultOpenCapture(stageUrl, manifest, options) {
  if (!options.browserExecutable) fail("configure an already-installed Chromium executable for browser export");
  let chromium;
  try { ({ chromium } = await import("playwright-core")); }
  catch { fail("playwright-core is unavailable; install the pinned driver without downloading a browser"); }
  const browser = await chromium.launch({ executablePath: options.browserExecutable, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: manifest.width, height: manifest.height }, deviceScaleFactor: 1, reducedMotion: "reduce" });
    await page.goto(stageUrl, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForFunction(() => Boolean(window.__kmVideoExport?.manifest), undefined, { timeout: 20000 });
    const live = await page.evaluate(() => window.__kmVideoExport?.manifest);
    return {
      manifest: live,
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
 * @param {{stageUrl:string,manifest:object,planHash:string,outDir:string,maxBatchFrames?:number,browserExecutable?:string,ffmpeg?:string,ffprobe?:string,signal?:AbortSignal}} options
 * @param {{openCapture?:Function,encodeBatch?:Function,probeSegment?:Function,concatSegments?:Function,probeFinal?:Function}} dependencies
 */
export async function renderVideoSegments(options, dependencies = {}) {
  const { dir, limit } = validateOptions(options);
  const { manifest } = options;
  const fingerprint = sha256(JSON.stringify({ version: 1, planHash: options.planHash, manifest, h264Profile: "libx264-crf18-yuv420p" }));
  const segmentsDir = join(dir, "segments");
  const openCapture = dependencies.openCapture ?? ((url, expected) => defaultOpenCapture(url, expected, options));
  const encodeBatch = dependencies.encodeBatch ?? ((batch) => defaultEncode({ ...batch, ffmpeg: options.ffmpeg ?? "ffmpeg", signal: options.signal }));
  const probe = dependencies.probeSegment ?? ((path) => probeVideo(path, { ffprobe: options.ffprobe ?? "ffprobe", signal: options.signal }));
  const concat = dependencies.concatSegments ?? ((paths, path) => defaultConcat(paths, path, { ffmpeg: options.ffmpeg ?? "ffmpeg", signal: options.signal }));
  const probeFinal = dependencies.probeFinal ?? probe;
  const started = performance.now();
  const segments = [];
  let peakScratchBytes = 0;
  await mkdir(segmentsDir, { recursive: true });
  let capture;
  try {
    // Even resume must establish the correct live visual page, not stale/bypassed output.
    capture = await openCapture(options.stageUrl, manifest);
    if (!isDeepStrictEqual(capture?.manifest, manifest)) fail("live Kumiki export manifest differs from the validated render plan");
    for (let startFrame = 0, index = 0; startFrame < manifest.durationFrames; startFrame += limit, index++) {
      if (options.signal?.aborted) fail("video capture cancelled");
      const frameCount = Math.min(limit, manifest.durationFrames - startFrame);
      const name = `segment-${String(index).padStart(5, "0")}.mp4`;
      const path = join(segmentsDir, name), metadataPath = join(segmentsDir, `${name}.json`);
      let completed = false, segmentHash;
      const hasVideo = await exists(path), hasMeta = await exists(metadataPath);
      if (hasVideo || hasMeta) {
        if (!hasVideo || !hasMeta) fail(`incomplete resume record for ${name}; remove manually after inspection`);
        let meta;
        try { meta = JSON.parse(await readFile(metadataPath, "utf8")); }
        catch { fail(`invalid resume metadata for ${name}`); }
        if (meta.fingerprint !== fingerprint || meta.startFrame !== startFrame || meta.frameCount !== frameCount) fail(`stale resume manifest for ${name}`);
        const bytes = await readFile(path);
        if (sha256(bytes) !== meta.sha256) fail(`corrupt segment hash during resume: ${name}`);
        const measured = await probe(path);
        if (!matchProbe(measured, manifest, frameCount)) fail(`corrupt segment probe during resume: ${name}`);
        completed = true;
        segmentHash = meta.sha256;
      }
      if (!completed) {
        const batchDir = await mkdtemp(join(dir, ".capture-"));
        const partialPath = join(segmentsDir, `.partial-${randomUUID()}.mp4`);
        try {
          let scratch = 0;
          for (let j = 0; j < frameCount; j++) {
            if (options.signal?.aborted) fail("video capture cancelled");
            const file = join(batchDir, `frame-${String(j).padStart(5, "0")}.png`);
            await capture.captureFrame(startFrame + j, file);
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
    }
  } finally { if (capture) await capture.close(); }

  const videoOnlyPath = join(dir, "video-only.mp4");
  const finalMetadataPath = join(dir, "video-only.mp4.json");
  if (await exists(videoOnlyPath)) {
    if (!await exists(finalMetadataPath)) fail("existing final video lacks a verified resume manifest");
    const record = JSON.parse(await readFile(finalMetadataPath, "utf8"));
    if (record.fingerprint !== fingerprint || record.sha256 !== sha256(await readFile(videoOnlyPath))) fail("existing final video has a mismatched hash or plan");
  } else {
    const stagedPath = join(dir, `.video-only-${randomUUID()}.mp4`);
    try {
      await concat(segments.map((item) => item.path), stagedPath);
      const check = await probeFinal(stagedPath);
      if (!matchProbe(check, manifest, manifest.durationFrames)) fail("concatenated video failed final frame/FPS/raster QA");
      const digest = sha256(await readFile(stagedPath));
      await rename(stagedPath, videoOnlyPath);
      await writeFile(finalMetadataPath, JSON.stringify({ fingerprint, sha256: digest, frameCount: manifest.durationFrames }, null, 2), { flag: "wx" });
    } finally { await rm(stagedPath, { force: true }); }
  }
  const finishedProbe = await probeFinal(videoOnlyPath);
  if (!matchProbe(finishedProbe, manifest, manifest.durationFrames)) fail("finished video lost its verified frame count or FPS");
  return {
    videoOnlyPath, frameCount: manifest.durationFrames,
    segmentHashes: segments.map(({ sha256: digest, startFrame, frameCount }) => ({ sha256: digest, startFrame, frameCount })),
    peakScratchBytes, renderSeconds: (performance.now() - started) / 1000,
  };
}
