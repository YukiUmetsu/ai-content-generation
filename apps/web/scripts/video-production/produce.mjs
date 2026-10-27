/** One-command generated narration → exact audio/scene timeline → bounded MP4 → gated draft. */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseVideoProductionJob } from "./job.mjs";
import { localSpeechEndpoint } from "./local.mjs";
import { synthesizeNarration } from "./speech.mjs";
import { buildSampleTimeline, toFrame } from "./timeline.mjs";
import { resolveVisualSfxTimeline } from "./visual-sfx-timing.mjs";
import { analyzeCaptionReadability } from "./caption-readability.mjs";
import { renderMasterAudio } from "./audio.mjs";
import { compileHouseMathVisuals } from "./visual-plan.mjs";
import { compileGeneralVisuals } from "./general-visual-plan.mjs";
import { startLocalStageServer } from "./stage-server.mjs";
import { probeBrowserExecutable, renderVideoSegments } from "./render.mjs";
import { fingerprintBuiltStage } from "./stage-server.mjs";
import { buildQaReport } from "./report.mjs";
import { prepareApprovedSceneMedia } from "./render-scene-media.mjs";

const run = promisify(execFile);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (message) => { throw new Error(`ContentGen production blocked: ${message}`); };
const exists = async (path) => stat(path).then(() => true, (error) => error.code !== "ENOENT");

async function subprocess(command, args, signal, timeout = 600000) {
  try { return await run(command, args, { signal, timeout, maxBuffer: 512 * 1024 }); }
  catch (error) { fail(`${command} failed (${error.code ?? error.signal ?? "unknown"}).`); }
}

export async function muxVideo(videoPath, audioPath, outputPath, { ffmpeg = "ffmpeg", signal } = {}) {
  await subprocess(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-n",
    "-i", videoPath, "-i", audioPath, "-map", "0:v:0", "-map", "1:a:0",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", outputPath,
  ], signal);
}

/** Probe the finished MP4's actual encoded streams, not the declared scene duration. */
export async function probeMuxedMp4(path, { ffprobe = "ffprobe", signal } = {}) {
  const { stdout } = await subprocess(ffprobe, [
    "-v", "error", "-count_frames", "-show_entries",
    "stream=codec_type,sample_rate,width,height,nb_read_frames,r_frame_rate,duration:format=duration", "-of", "json", path,
  ], signal, 60000);
  let doc;
  try { doc = JSON.parse(stdout); }
  catch { fail("FFprobe emitted invalid MP4 JSON"); }
  const video = doc.streams?.find((s) => s.codec_type === "video");
  const audio = doc.streams?.find((s) => s.codec_type === "audio");
  const ratio = /^(\d+)\/(\d+)$/.exec(video?.r_frame_rate ?? "");
  if (!video || !audio || !ratio || !Number(ratio[2]) || !Number.isSafeInteger(Number(video.nb_read_frames))) fail("MP4 lacks a measured video and audio stream");
  const output = {
    width: video.width, height: video.height, fps: { num: Number(ratio[1]), den: Number(ratio[2]) },
    frameCount: Number(video.nb_read_frames), audioSampleRate: Number(audio.sample_rate),
    audioDurationSeconds: Number(audio.duration), videoDurationSeconds: Number(video.duration),
  };
  if (!Number.isFinite(output.audioDurationSeconds) || !Number.isFinite(output.videoDurationSeconds)) fail("MP4 streams do not report measurable duration");
  return output;
}

async function toolVersions() {
  const records = {};
  for (const tool of ["ffmpeg", "ffprobe"]) {
    const { stdout } = await subprocess(tool, ["-version"]);
    records[tool] = stdout.split("\n")[0].slice(0, 200);
  }
  return records;
}

// A crashed render has no published release, but may have committed complete
// SHA-verified H.264 segments. Read only its own non-symlinked render ledger;
// damaged or older plans are hints to discard, never reasons to block a retry.
async function interruptedRenderCache(priorRoot, currentOutput, buildHash) {
  const dir = resolve(priorRoot);
  if (dir === currentOutput || [parse(dir).root, homedir(), process.cwd(), "/tmp", "/workspace"].includes(dir))
    fail("interrupted video cache must be a distinct, narrow job-owned directory");
  const renderRoot = join(dir, ".render");
  const planFile = join(renderRoot, "render-source-plan.json");
  const segmentsDir = join(renderRoot, "segments");
  try {
    const [parent, folder, file, segments] = await Promise.all([
      lstat(dir), lstat(renderRoot), lstat(planFile), lstat(segmentsDir),
    ]);
    if (!parent.isDirectory() || parent.isSymbolicLink() ||
      !folder.isDirectory() || folder.isSymbolicLink() ||
      !segments.isDirectory() || segments.isSymbolicLink() ||
      !file.isFile() || file.isSymbolicLink() || file.size < 32 || file.size > 2 * 1024 * 1024)
      return null;
    const saved = JSON.parse(await readFile(planFile, "utf8"));
    if (saved.schemaVersion !== 1 || saved.buildHash !== buildHash ||
      !/^[a-f0-9]{64}$/u.test(saved.planHash ?? "") ||
      !saved.plan?.manifest || !Array.isArray(saved.plan.chapters) ||
      sha256(JSON.stringify(saved.plan)) !== saved.planHash)
      return null;
    return { sourcePlan: saved.plan, buildHash, segmentsDir };
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

/**
 * @param {object} candidate JSON video-production-job v1
 * @param {{out:string,provider:string,providerRevision:string,apiKey?:string,allowNetwork?:boolean,voiceReferenceConsent?:boolean,textTransmissionApproved?:boolean,localVoiceAuthorized?:boolean,localEndpoint?:string,paidUsageApproved?:boolean,allowTestAssets?:boolean,browserExecutable?:string,distRoot?:string,ffmpeg?:string,ffprobe?:string,signal?:AbortSignal,onProgress?:(event:object)=>void,prepareAssetSuggestions?:(options:{signal?:AbortSignal})=>Promise<object>,reuseSpeechCacheFrom?:string,reuseRenderSegmentsFrom?:string,sceneAssetProjectId?:string,sceneShotMap?:Array<{shotId:string,beatId:string}>,expectedSceneMediaFingerprint?:string}} options
 * @param {{synthesizeNarration?:Function,renderMasterAudio?:Function,startLocalStageServer?:Function,renderVideoSegments?:Function,preflightExport?:Function,mux?:Function,probeMp4?:Function,toolVersions?:object}} deps
 */
export async function produceVideo(candidate, options, deps = {}) {
  const parsed = parseVideoProductionJob(candidate);
  if (!parsed.ok) fail(`invalid job: ${parsed.findings.filter((f) => f.severity === "error").map((f) => f.code).join(", ")}`);
  if (!options?.out || !options.providerRevision) fail("explicit output and provider/engine revision are required");
  if (options.provider !== parsed.job.voice.provider) fail("provider substitution is forbidden; change the job voice configuration first");
  if (!Number.isFinite(options.budgetUsd ?? 0) || (options.budgetUsd ?? 0) < 0 ||
    (options.budgetUsd ?? 0) > parsed.job.policy.maxCostUsd) fail("production budget exceeds the job's spending cap");
  if (options.provider === "local") {
    if (!options.localVoiceAuthorized) fail("explicit local voice authorization is required");
    localSpeechEndpoint(options.localEndpoint || parsed.job.voice.endpoint);
  } else {
    if (parsed.job.voice.modelId !== "s2.1-pro-free") fail("paid Fish models require reliable per-job cost metering; this renderer supports only the free-model ID");
    if (!parsed.job.voice.voiceId || parsed.job.voice.voiceId === "configure-a-licensed-reference") fail("configure an authorized Fish voice reference");
    if (!options.allowNetwork || !options.voiceReferenceConsent || !options.textTransmissionApproved) fail("Fish requires explicit network, voice and text-transmission approval");
    if (!options.apiKey) fail("FISH_AUDIO_API_KEY is not configured");
  }
  if (parsed.job.sounds.some((sound) => sound.licenseStatus === "test-only") && !options.allowTestAssets) fail("test-only sound use requires explicit permission");
  if (parsed.job.approval === "approved" && parsed.job.policy.commercialRightsVerified !== true) fail("approved release needs verified rights");
  if (options.signal?.aborted) fail("cancelled before start");
  const out = resolve(options.out);
  if ([parse(out).root, homedir(), process.cwd(), resolve(process.cwd(), ".."), "/tmp", "/workspace"].includes(out)) fail("choose a narrow, job-owned output directory");
  const releaseDir = join(out, "release");
  if (await exists(releaseDir)) fail("release already exists; choose a new output directory instead of overwriting published files");
  const distRoot = options.distRoot ?? fileURLToPath(new URL("../../dist", import.meta.url));
  // This potentially costly browser/build check MUST finish before provider transmission.
  options.onProgress?.({ phase: "browser-preflight", message: "Opening Chromium to verify the render environment…" });
  const preflight = await (deps.preflightExport ?? (async () => {
    const buildHash = await fingerprintBuiltStage(distRoot);
    await probeBrowserExecutable(options.browserExecutable);
    return { buildHash };
  }))();
  if (!/^[a-f0-9]{64}$/i.test(preflight?.buildHash ?? "")) fail("built scene must have a SHA-256 export identity");
  // A prior output is read-only. Validate its published scene fingerprint
  // before any narration synthesis or new render work takes place.
  let previous=null;
  if(options.reuseFrom){
    const priorDir=resolve(options.reuseFrom);
    if(priorDir===out||[parse(priorDir).root,homedir(),process.cwd(),"/tmp","/workspace"].includes(priorDir))
      fail("previous production must be a distinct, narrow job-owned directory");
    let priorManifest;
    try{priorManifest=JSON.parse(await readFile(join(priorDir,"release","render-manifest.json"),"utf8"));}
    catch{fail("previous release lacks a readable render manifest");}
    if(priorManifest.schemaVersion!==1 || !priorManifest.plan ||
        priorManifest.planHash!==sha256(JSON.stringify(priorManifest.plan)) ||
        !/^[a-f0-9]{64}$/i.test(priorManifest.buildHash??""))
      fail("previous render manifest has invalid or tampered scene provenance");
    if(priorManifest.buildHash!==preflight.buildHash)
      fail("previous render uses a different Kumiki build; unsafe to reuse frames");
    previous={
      sourcePlan:priorManifest.plan,
      buildHash:priorManifest.buildHash,
      segmentsDir:join(priorDir,".render","segments"),
      cacheRoot:join(priorDir,".cache")
    };
  }
  // A failed render has no immutable release manifest, but completed speech
  // beats were written to a content-addressed, hash-verified cache. Retrying
  // may reuse those beats without claiming the aborted video was successful.
  let interruptedCache=null;
  if(options.reuseSpeechCacheFrom){
    const priorDir=resolve(options.reuseSpeechCacheFrom);
    if(priorDir===out||[parse(priorDir).root,homedir(),process.cwd(),"/tmp","/workspace"].includes(priorDir))
      fail("interrupted production must be a distinct, narrow job-owned directory");
    try{
      const parent=await lstat(priorDir),cachePath=join(priorDir,".cache"),cache=await lstat(cachePath);
      if(!parent.isDirectory()||parent.isSymbolicLink()||!cache.isDirectory()||cache.isSymbolicLink())
        fail("interrupted narration cache must be an owned directory, not a link");
      interruptedCache=cachePath;
    }catch(error){if(error?.code!=="ENOENT")throw error;}
  }
  const interruptedVisual = options.reuseRenderSegmentsFrom && !previous ?
    await interruptedRenderCache(options.reuseRenderSegmentsFrom, out, preflight.buildHash) : null;
  const job = options.localEndpoint ? { ...parsed.job, voice: { ...parsed.job.voice, endpoint: options.localEndpoint } } : parsed.job;
  await mkdir(out, { recursive: true });
  const working = await mkdtemp(join(out, ".release-staging-"));
  const reusedSpeechIds = [];
  let stage;
  try {
    // Metadata search is optional, never a stock-media substitution or a
    // publication license decision. This step executes after browser preflight
    // and before external voice transmission, inside the tracked render job.
    options.onProgress?.({phase:"asset-search",message:options.prepareAssetSuggestions?
      "Finding optional scene media suggestions…":"Using Kumiki-generated scenes…"});
    const assetSearch=options.prepareAssetSuggestions?
      await options.prepareAssetSuggestions({signal:options.signal}):{status:"skipped"};
    if(options.signal?.aborted)fail("cancelled during scene media discovery");
    if (Boolean(options.sceneAssetProjectId) !== Boolean(options.sceneShotMap))
      fail("both the scene asset project and shot mapping are required");
    const sceneMedia = options.sceneAssetProjectId ? await
      (deps.prepareApprovedSceneMedia ?? prepareApprovedSceneMedia)({
        projectId: options.sceneAssetProjectId, shotMap: options.sceneShotMap,
        outputDir: join(out, ".render", "scene-media"),
        expectedFingerprint: options.expectedSceneMediaFingerprint, signal: options.signal,
      }, { ffprobe: options.ffprobe }) : { bindings: {}, assets: [] };
    if (Object.keys(sceneMedia.bindings).length && job.visualFamily !== "general-explainer-v1")
      fail("reviewed scene media requires the general Kumiki explainer; change the selected visual recipe");
    options.onProgress?.({ phase: "narration", assetSearchSummary:assetSearch,
      message: `Generating ${job.beats.length} authorized narration beats…` });
    const speech = await (deps.synthesizeNarration ?? synthesizeNarration)(job, {
      provider: options.provider, providerRevision: options.providerRevision, cacheRoot: join(out, ".cache"),
      reuseCacheRoot:previous?.cacheRoot??interruptedCache,
      skipInvalidPriorCache:!!interruptedCache&&!previous,
      onReuse:event=>{
        reusedSpeechIds.push(event.beatId);
        options.onProgress?.({phase:"speech-reused",...event});
      },
      allowNetwork: options.allowNetwork, voiceReferenceConsent: options.voiceReferenceConsent,
      textTransmissionApproved: options.textTransmissionApproved, localVoiceAuthorized: options.localVoiceAuthorized,
      apiKey: options.apiKey, paidUsageApproved: options.paidUsageApproved, budgetUsd: options.budgetUsd ?? 0, signal: options.signal,
      ffmpeg: options.ffmpeg, ffprobe: options.ffprobe,
      onDiagnostic: options.onProgress,
    });
    options.onProgress?.({ phase: "timeline", message: "Aligning measured speech to the visual timeline…" });
    let timeline = buildSampleTimeline(speech, { fps: job.destination.fps, events: job.events });
    const captionReadability = analyzeCaptionReadability(
      timeline, Object.fromEntries(job.beats.map((beat) => [beat.id, beat.narration])),
      { profile: job.mode === "youtube-long" ? "long" : "short" },
    );
    if (!captionReadability.ok) fail("caption-readability preflight found missing or invalid beat captions");
    let plan = job.visualFamily === "general-explainer-v1"
      ? compileGeneralVisuals(job, timeline) : compileHouseMathVisuals(job, timeline);
    const visualCueTimeline=resolveVisualSfxTimeline(job,timeline,plan);
    if(visualCueTimeline!==timeline){
      timeline=visualCueTimeline;
      plan=compileGeneralVisuals(job,timeline);
    }
    if (Object.keys(sceneMedia.bindings).length) {
      const known = new Set(plan.chapters.map(chapter => chapter.id));
      if (Object.keys(sceneMedia.bindings).some(beatId => !known.has(beatId)))
        fail("a selected scene no longer matches the narrated storyboard");
      plan = { ...plan, chapters: plan.chapters.map(chapter => ({ ...chapter,
        visual: { ...chapter.visual,
          ...(sceneMedia.bindings[chapter.id] ? { stockMedia: sceneMedia.bindings[chapter.id] } : {}),
        },
      })) };
    }
    const frames = plan.manifest.durationFrames;
    const payoffFrame = toFrame(timeline.eventSamples[job.topic.payoffEventId], job.destination.fps);
    const afterPayoff = Math.min(frames - 1, payoffFrame + Math.round(job.destination.fps.num / job.destination.fps.den));
    const reviewFrames = [...new Set([0, Math.floor(frames / 2), afterPayoff, frames - 1])].sort((a, b) => a - b);
    const sourcePlan = JSON.stringify(plan);
    const planHash = sha256(sourcePlan);
    const renderRoot = join(out, ".render");
    await mkdir(renderRoot, { recursive: true, mode: 0o700 });
    // Persist the exact plan before Chromium begins. Failed runs never publish
    // their release, yet a later Jobs retry can prove which frames were done.
    await writeFile(join(renderRoot, "render-source-plan.json"), JSON.stringify({
      schemaVersion: 1, buildHash: preflight.buildHash, planHash, plan,
    }), { flag: "wx", mode: 0o600 });
    const sfx = job.sounds.map((effect) => ({
      ...effect, assetPath: effect.licenseStatus === "verified" ? effect.assetRef : undefined,
    }));
    options.onProgress?.({ phase: "audio", message: "Mixing voice, SFX and beat-level captions…" });
    const audio = await (deps.renderMasterAudio ?? renderMasterAudio)({ beats: speech, timeline, sfx }, {
      outputDir: join(working, "audio"), allowTestAssets: options.allowTestAssets,
      ffmpeg: options.ffmpeg, ffprobe: options.ffprobe, signal: options.signal,
    });
    stage = await (deps.startLocalStageServer ?? startLocalStageServer)({ distRoot, validatedPlan: plan,
      approvedMedia: sceneMedia.assets });
    if (stage.buildHash !== preflight.buildHash) fail("scene build changed since renderer preflight; narration cache is safe but video export aborted");
    let render;
    try {
      options.onProgress?.({ phase: "rendering", completedFrames: 0, totalFrames: frames });
      render = await (deps.renderVideoSegments ?? renderVideoSegments)({
        stageUrl: stage.url, manifest: plan.manifest, planHash, buildHash: stage.buildHash,
        outDir: join(out, ".render"), browserExecutable: options.browserExecutable, onProgress: options.onProgress,
        maxBatchFrames: 150, reviewFrames, ffmpeg: options.ffmpeg, ffprobe: options.ffprobe, signal: options.signal,
        visualPlan:plan,reuseFrom:previous??interruptedVisual??undefined,
      });
    } finally { await stage.close(); stage = null; }

    if (!Array.isArray(render.reviewStills) || render.reviewStills.length !== reviewFrames.length) fail("review stills are missing or incomplete");
    const publishedStills = [];
    await mkdir(join(working, "stills"));
    for (let i = 0; i < reviewFrames.length; i++) {
      const still = render.reviewStills[i], frame = reviewFrames[i];
      const filename = `frame-${String(frame).padStart(6, "0")}.png`;
      const source = join(out, ".render", "stills", filename);
      if (still?.frame !== frame || resolve(still.path) !== source || !/^[a-f0-9]{64}$/i.test(still.sha256 ?? "")) fail("review still has an invalid frame, path or SHA-256 hash");
      const bytes = await readFile(source);
      if (sha256(bytes) !== still.sha256) fail("review still hash changed after browser capture");
      await copyFile(source, join(working, "stills", filename));
      publishedStills.push({ frame, file: `stills/${filename}`, sha256: still.sha256 });
    }
    // Export a genuine, renderer-captured first-frame image as the draft cover.
    // This is an editable starting still, not a claim that a designed thumbnail
    // or platform artwork was generated. The existing Kumiki composer handles design.
    const firstStill=publishedStills[0];
    if(!firstStill||firstStill.frame!==0)fail("draft cover requires a verified first-frame still");
    await copyFile(join(working,firstStill.file),join(working,"cover-still.png"));

    options.onProgress?.({ phase: "mux", message: "Combining verified H.264 video and the 48 kHz sound master…" });
    const video = join(working, "video.mp4");
    await (deps.mux ?? muxVideo)(render.videoOnlyPath, audio.wavPath, video, options);
    const mp4 = await (deps.probeMp4 ?? probeMuxedMp4)(video, {
      fps: job.destination.fps, totalFrames: plan.manifest.durationFrames, totalSamples: timeline.totalSamples,
      ffprobe: options.ffprobe, signal: options.signal,
    });
    const master = join(working, "master.wav"), voice = join(working, "voice.wav"), captions = join(working, "captions.srt");
    await Promise.all([
      copyFile(audio.wavPath, master), copyFile(audio.voiceStemPath, voice), copyFile(audio.srtPath, captions),
    ]);
    const artifactHashes = {
      video: sha256(await readFile(video)), master: sha256(await readFile(master)),
      voice: sha256(await readFile(voice)),
      captions: sha256(await readFile(captions)),
      coverStill:sha256(await readFile(join(working,"cover-still.png"))),
    };
    for (const still of publishedStills) artifactHashes[`still-${still.frame}`] = still.sha256;
    options.onProgress?.({ phase: "qa", message: "Probing finished media and generating the technical QA report…" });
    const versions = deps.toolVersions ?? await toolVersions();
    const qa = buildQaReport({ job, timeline, audio, render: { ...render, reviewStills: publishedStills }, mp4, artifacts: artifactHashes, toolVersions: versions, reviewStatus: "not-reviewed", captionReadability });
    const manifestPath = join(working, "render-manifest.json");
    const narration = speech.map((beat) => ({
      id: beat.id, sha256: beat.sha256, samples: beat.samples,
      provider: beat.provider, modelId: beat.modelId, providerRevision: beat.providerRevision,
      licenseStatus: beat.licenseStatus ?? job.voice.licenseStatus,
      commercialRightsVerified: beat.commercialRightsVerified === true,
    }));
    const regeneration = { previousOutputUsed: !!previous,
      interruptedSegmentCacheFound: !!interruptedVisual,
      reusedSpeechBeatIds: [...reusedSpeechIds], speechBeatsNotImportedFromPrevious:job.beats.length-reusedSpeechIds.length,
      reusedVideoSegments:render.reusedSegmentCount??0, newlyEncodedVideoSegments:render.renderedSegmentCount??null,
      audioRemixed:true,videoRemuxed:true,editorialReviewRequired:true };
    const soundEffects=job.sounds.map(({id,eventId,licenseStatus,assetSha256,kind,offsetMs,gainDb,fadeInMs,fadeOutMs})=>({
      id,eventId,eventSample:timeline.eventSamples[eventId]+(offsetMs??0)*48,licenseStatus,
      ...(assetSha256?{assetSha256}:{}),...(kind?{kind}:{}),
      ...(offsetMs!==undefined?{offsetMs}:{}),...(gainDb!==undefined?{gainDb}:{}),
      ...(fadeInMs!==undefined?{fadeInMs}:{}),...(fadeOutMs!==undefined?{fadeOutMs}:{})
    }));
    const mediaProvenance=Object.entries(sceneMedia.bindings).map(([beatId,media])=>({beatId,...media}));
    await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, jobId: job.id, buildHash: preflight.buildHash, planHash, plan, narration, soundEffects, sceneMedia:mediaProvenance, segmentHashes: render.segmentHashes, reviewStills: publishedStills, artifacts: artifactHashes, regeneration }, null, 2), { flag: "wx" });
    await writeFile(join(working, "qa-report.json"), JSON.stringify(qa, null, 2), { flag: "wx" });
    await rm(join(working, "audio"), { recursive: true, force: true });
    // Multi-artifact commit: until this rename, there is no top-level successful release.
    if (await exists(releaseDir)) fail("release appeared concurrently; refusing to overwrite");
    await rename(working, releaseDir);
    options.onProgress?.({ phase: "review", message: "A verified draft is ready for human playback and listening." });
    return { releaseDir, videoPath: join(releaseDir, "video.mp4"), qa, planHash, regeneration };
  } finally {
    if (stage) await stage.close();
    // Only the uniquely allocated staging directory is eligible for cleanup.
    await rm(working, { recursive: true, force: true });
  }
}
