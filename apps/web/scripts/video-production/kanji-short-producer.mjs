/** Produces one kanji study short: Kumiki's `shodo-kanji-card` for the picture, Fish narration
 * timed to the card's brush strokes, a ducked music bed, and a hash-verified release folder.
 * Every external step (KanjiVG, Fish) needs explicit permission; nothing is published.
 */
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join, parse, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readPcmData, renderMasterAudio, wavBytes } from "./audio.mjs";
import { synthesizeNarration } from "./speech.mjs";
import { buildSampleTimeline } from "./timeline.mjs";
import { fingerprintBuiltStage, startLocalStageServer } from "./stage-server.mjs";
import { probeBrowserExecutable, renderVideoSegments } from "./render.mjs";
import { muxVideo, probeMuxedMp4 } from "./produce.mjs";
import {
  KANJI_FPS, KANJI_SHORT_PACING, SAMPLE_RATE, chooseMusicWindow, kanjiShortContent, kanjiShortLines, placeNarration, planKanjiIntro,
  planKanjiShort, readKanjiDataset, toFrameGrid, trimSpeech,
} from "./kanji-short.mjs";
import presets from "../../src/components/video/platform-presets.json" with { type: "json" };

const run = promisify(execFile);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (message) => { throw new Error(`Kanji short: ${message}`); };
const exists = (path) => lstat(path).then(() => true, (error) => error.code === "ENOENT" ? false : Promise.reject(error));
const FISH_REVISION = "fish-api-v1";

/** The Node bundle with Kumiki's kanji card planning (built by `pnpm build`). */
export async function loadKanjiPlanner(path = fileURLToPath(new URL("../../dist-shot/kanji-entry.mjs", import.meta.url))) {
  try { return await import(pathToFileURL(path).href); }
  catch { fail("the kanji card planner is not built. Run pnpm build, then start again."); }
}

/**
 * KanjiVG stroke data for one character from the pinned release, kept in `cacheDir` with its
 * hash. A cached file is used without the network; a new one needs `allowNetwork`.
 */
export async function kanjiVgSvg(char, { planner, cacheDir, allowNetwork, fetchImpl = fetch, signal }) {
  const file = planner.kanjiVgFileName(char);
  const dir = join(cacheDir, "kanjivg", planner.SHODO_KANJIVG_RELEASE);
  const path = join(dir, file), url = planner.SHODO_KANJIVG_BASE + file;
  try {
    const bytes = await readFile(path), meta = JSON.parse(await readFile(`${path}.json`, "utf8"));
    if (meta.sha256 === sha256(bytes) && meta.url === url) return { svg: bytes.toString("utf8"), url, sha256: meta.sha256, cached: true };
  } catch (error) { if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error; }
  if (!allowNetwork) fail(`KanjiVG stroke data for ${char} is not cached; downloading it needs --allow-network`);
  const response = await fetchImpl(url, { signal, redirect: "error" });
  if (!response.ok) fail(`KanjiVG has no stroke data for ${char} (HTTP ${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 256 * 1024 || !bytes.toString("utf8").includes("<svg")) fail(`KanjiVG returned an unexpected file for ${char}`);
  await mkdir(dir, { recursive: true });
  const digest = sha256(bytes);
  await writeFile(`${path}.partial`, bytes);
  await rename(`${path}.partial`, path);
  await writeFile(`${path}.json`, JSON.stringify({ url, sha256: digest, release: planner.SHODO_KANJIVG_RELEASE, fetchedAt: new Date().toISOString() }, null, 2));
  return { svg: bytes.toString("utf8"), url, sha256: digest, cached: false };
}

async function ffmpegLufs(path, { ffmpeg = "ffmpeg", signal } = {}) {
  const { stderr } = await run(ffmpeg, ["-hide_banner", "-nostats", "-nostdin", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"],
    { signal, maxBuffer: 16 * 1024 * 1024 });
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  const value = Number(/I:\s+(-?[\d.]+) LUFS/u.exec(summary)?.[1]);
  if (!Number.isFinite(value)) fail("loudness could not be measured");
  return value;
}

/** Longest stretch in which the picture does not change, from FFmpeg's freeze detector. */
export async function longestStill(videoPath, { ffmpeg = "ffmpeg", ffprobe = "ffprobe", signal, minSeconds = .5 } = {}) {
  const { stderr } = await run(ffmpeg, ["-hide_banner", "-nostdin", "-i", videoPath, "-vf", `freezedetect=n=-60dB:d=${minSeconds}`, "-map", "0:v", "-f", "null", "-"],
    { signal, maxBuffer: 16 * 1024 * 1024 });
  const starts = [...stderr.matchAll(/freeze_start: ([\d.]+)/gu)].map(m => Number(m[1]));
  const durations = [...stderr.matchAll(/freeze_duration: ([\d.]+)/gu)].map(m => Number(m[1]));
  // A freeze still open at the end of the file has no duration line: it runs to the end.
  const { stdout } = await run(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", videoPath], { signal });
  const total = Number(stdout.trim());
  const stills = starts.map((start, i) => ({ start, seconds: durations[i] ?? Math.max(0, total - start) }));
  return stills.reduce((best, still) => still.seconds > best.seconds ? still : best, { start: 0, seconds: 0 });
}

const int16 = (bytes) => { const pcm = readPcmData(bytes); return new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2); };
const pcmBytes = (samples) => Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);

/**
 * @param {{char:string,config:object,out:string,allowNetwork?:boolean,voiceReferenceConsent?:boolean,textTransmissionApproved?:boolean,
 *   apiKey?:string,browserExecutable:string,distRoot?:string,signal?:AbortSignal,onProgress?:(event:object)=>void,ffmpeg?:string,ffprobe?:string}} request
 */
export async function produceKanjiShort(request, deps = {}) {
  const { char, config } = request;
  const progress = (phase, message) => request.onProgress?.({ phase, char, message });
  if (typeof char !== "string" || [...char].length !== 1) fail("one kanji is required");
  const out = resolve(request.out ?? "");
  if (!request.out || [parse(out).root, homedir(), process.cwd(), "/tmp"].includes(out)) fail("choose a narrow, video-owned output directory");
  const releaseDir = join(out, "release");
  if (await exists(releaseDir)) fail(`${releaseDir} already exists; choose a new output directory instead of overwriting a release`);
  if (!request.allowNetwork || !request.voiceReferenceConsent || !request.textTransmissionApproved)
    fail("Fish narration needs --allow-network, --voice-consent and --transmit-text");
  if (!request.apiKey) fail("FISH_AUDIO_API_KEY is not configured (Keychain or environment)");
  const preset = presets.find(p => p.id === config.destination);
  if (!preset || preset.width !== 1080 || preset.height !== 1920) fail("the destination must be a 1080 × 1920 short preset");
  const pacing = { ...KANJI_SHORT_PACING, ...config.timing };
  pacing.write = toFrameGrid(pacing.write);
  pacing.review = toFrameGrid(pacing.review);

  // Everything that can fail locally fails before any text is sent to Fish.
  progress("preflight", "Checking the built export page, the browser and the kanji planner…");
  const distRoot = request.distRoot ?? fileURLToPath(new URL("../../dist", import.meta.url));
  const buildHash = await (deps.fingerprintBuiltStage ?? fingerprintBuiltStage)(distRoot);
  await (deps.probeBrowserExecutable ?? probeBrowserExecutable)(request.browserExecutable);
  const planner = await (deps.loadKanjiPlanner ?? loadKanjiPlanner)();
  const datasetBytes = await readFile(config.dataset);
  const { entries, problems } = readKanjiDataset(JSON.parse(datasetBytes.toString("utf8")));
  const entry = entries.get(char);
  if (!entry) fail(`${char} is not in the kanji data${problems.length ? ` (${problems.length} entries had problems)` : ""}`);
  const content = kanjiShortContent(entry, { speech: config.narration?.speech });
  const lines = kanjiShortLines(content, config.narration);
  const musicSource = await readFile(config.music.path);
  if (sha256(musicSource) !== config.music.sha256) fail("the music file changed since it was reviewed; check it and update its sha256");

  await mkdir(out, { recursive: true });
  const cacheDir = resolve(config.cacheDir ?? join(out, ".cache"));
  const renderDir = join(out, ".render");
  await mkdir(renderDir, { recursive: true });
  const working = await mkdtemp(join(out, ".release-staging-"));
  let stage = null;
  try {
    progress("strokes", `Loading KanjiVG stroke data for ${char}…`);
    const kanjivg = await (deps.kanjiVgSvg ?? kanjiVgSvg)(char, { planner, cacheDir, allowNetwork: request.allowNetwork, signal: request.signal });
    const glyph = await planner.glyphFromKanjiVg(char, kanjivg.svg);

    progress("narration", `Synthesizing ${lines.length} lines with Fish…`);
    const voice = { provider: "fish", voiceId: config.voice.voiceId, modelId: config.voice.modelId ?? "s2.1-pro-free", licenseStatus: config.voice.licenseStatus ?? "unknown" };
    const synth = (locale, units) => (deps.synthesizeNarration ?? synthesizeNarration)({
      voice, locale, approval: "test-only", policy: { commercialRightsVerified: config.voice.commercialRightsVerified === true },
      beats: units.map(line => ({ id: line.id, narration: line.text, pauseAfterMs: 0, eventIds: [] })),
    }, {
      provider: "fish", providerRevision: FISH_REVISION, cacheRoot: cacheDir, apiKey: request.apiKey, allowNetwork: true,
      voiceReferenceConsent: true, textTransmissionApproved: true, direction: { pace: config.voice.pace ?? "slow" }, signal: request.signal,
    });
    const question = lines.filter(line => line.role === "question"), rest = lines.filter(line => line.role !== "question");
    const synthesized = [...await synth(config.narration?.questionLocale ?? "en", question), ...await synth("ja", rest)];
    const takes = await Promise.all(lines.map(async (line, i) => {
      const result = synthesized[i];
      if (result?.id !== line.id) fail("narration came back out of order");
      return { ...line, ...trimSpeech(int16(await readFile(result.wavPath))), sourceSha256: result.sha256 };
    }));

    progress("timing", "Timing the narration to the brush strokes…");
    const q = takes.find(take => take.role === "question");
    const intro = planKanjiIntro({ speech: q.speech, nameAt: q.nameAt }, pacing, [...content.name.kana].length);
    const cardOptions = {
      layout: "portrait", density: config.card?.density ?? "compact", safeInset: preset.safeInset, withCard: true, withLabel: true,
    };
    const probe = planner.planKanjiCard(glyph, { ...cardOptions, timing: { intro: intro.intro, write: pacing.write, review: pacing.review, info: 1 } });
    const timing = planKanjiShort({ lines: takes, strokes: probe.strokes, intro, pacing });
    const final = planner.planKanjiCard(glyph, { ...cardOptions, timing: timing.timing });
    if (final.timeline.frames !== timing.frames) fail(`the card plans ${final.timeline.frames} frames, the narration ${timing.frames}`);

    const beatDir = join(renderDir, "narration");
    await mkdir(beatDir, { recursive: true });
    const placed = placeNarration(takes, timing.onsets, timing.totalSamples);
    const beats = await Promise.all(placed.map(async (beat, i) => {
      const bytes = wavBytes(pcmBytes(beat.samples));
      const wavPath = join(beatDir, `${String(i).padStart(2, "0")}-${beat.id}.wav`);
      await writeFile(wavPath, bytes);
      return { id: beat.id, text: takes[i].caption, samples: beat.samples.length, pauseAfterMs: beat.pauseAfterMs, wavPath, sha256: sha256(bytes),
        eventIds: i === 0 ? ["music-start"] : [] };
    }));
    const timeline = buildSampleTimeline(beats, { fps: { num: KANJI_FPS, den: 1 }, events: [{ id: "music-start", beatId: beats[0].id }] });
    if (timeline.totalSamples !== timing.totalSamples) fail("the narration timeline does not end on the last frame");

    progress("music", "Choosing the music window and its level…");
    const sourceWav = join(renderDir, "music-source.wav");
    await run(request.ffmpeg ?? "ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", config.music.path, "-ac", "1", "-ar", String(SAMPLE_RATE), "-c:a", "pcm_s16le", sourceWav], { signal: request.signal });
    const length = timing.frames / KANJI_FPS;
    const speech = takes.map(take => ({ onset: timing.onsets[take.id], end: timing.onsets[take.id] + take.speech }));
    const window = Number.isFinite(config.music.startSeconds) ? { start: config.music.startSeconds, longestQuietSeconds: null }
      : chooseMusicWindow(int16(await readFile(sourceWav)), length, speech);
    const bedPath = join(renderDir, "music-bed.wav");
    await run(request.ffmpeg ?? "ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-ss", String(window.start), "-t", String(length + .5), "-i", sourceWav,
      "-c:a", "pcm_s16le", bedPath], { signal: request.signal });
    const bedBytes = await readFile(bedPath);
    // Voice level: the placed narration on its own.
    const voiceProbe = join(renderDir, "voice-probe.wav");
    const voiceSamples = new Int16Array(timing.totalSamples);
    for (let i = 0, cursor = 0; i < beats.length; i++) { voiceSamples.set(placed[i].samples, cursor); cursor += placed[i].samples.length + placed[i].pauseAfterMs * 48; }
    await writeFile(voiceProbe, wavBytes(pcmBytes(voiceSamples)));
    const voiceLufs = await ffmpegLufs(voiceProbe, request), bedLufs = await ffmpegLufs(bedPath, request);
    const below = config.music.belowVoiceDb ?? 11;
    const gainDb = Math.round(Math.min(-12, Math.max(-48, voiceLufs - below - bedLufs)) * 10) / 10;

    progress("mix", "Mixing the voice and the ducked music bed…");
    const audio = await (deps.renderMasterAudio ?? renderMasterAudio)({ beats, timeline, sfx: [{
      id: "music", eventId: "music-start", kind: "ambience", licenseStatus: "verified", assetPath: bedPath, assetSha256: sha256(bedBytes),
      gainDb, fadeInMs: 250, fadeOutMs: 1200,
    }] }, { outputDir: await mkdtemp(join(renderDir, "audio-")), ffmpeg: request.ffmpeg, ffprobe: request.ffprobe, signal: request.signal });

    const manifest = { schemaVersion: 1, id: `kanji-short-${char.codePointAt(0).toString(16)}`, durationFrames: timing.frames,
      width: preset.width, height: preset.height, fps: { num: KANJI_FPS, den: 1 }, preset: preset.id };
    const plan = {
      schemaVersion: 1, kind: "kanji-study-visual-plan", manifest,
      card: {
        char, glyph, layout: "portrait", density: cardOptions.density, heading: config.card?.heading ?? "Kanji study", safeInset: preset.safeInset,
        timing: timing.timing, intro: { reading: content.name.kana, convertAt: intro.convertAt, emphasizeAt: intro.emphasizeAt },
        meanings: content.meanings, onyomi: content.onyomi, kunyomi: content.kunyomi, jlpt: content.jlpt, words: content.words,
        wordHighlights: timing.wordHighlights, strokeNumbers: true, reducedMotion: false,
      },
    };
    const planBytes = JSON.stringify(plan);
    const planHash = sha256(planBytes);
    const f = (seconds) => Math.min(timing.frames - 1, Math.max(0, Math.round(seconds * KANJI_FPS)));
    const reviewFrames = [...new Set([0, f(intro.convertAt + .4), f(final.strokes.write.at(-1)[1]), f(final.strokes.review.at(-1)[1]),
      ...timing.wordHighlights.map(cue => f(cue.at + .4)), timing.frames - 1])].sort((a, b) => a - b);

    progress("rendering", `Rendering ${timing.frames} frames…`);
    stage = await (deps.startLocalStageServer ?? startLocalStageServer)({ distRoot, validatedPlan: plan });
    if (stage.buildHash !== buildHash) fail("the export page build changed since the preflight");
    let render;
    try {
      render = await (deps.renderVideoSegments ?? renderVideoSegments)({
        stageUrl: stage.url, manifest, planHash, buildHash, outDir: renderDir, browserExecutable: request.browserExecutable, maxBatchFrames: 150,
        reviewFrames, ffmpeg: request.ffmpeg, ffprobe: request.ffprobe, signal: request.signal,
        onProgress: (event) => request.onProgress?.({ ...event, char }),
      });
    } finally { await stage.close(); stage = null; }

    progress("mux", "Combining the video and the sound master…");
    const video = join(working, "video.mp4");
    await (deps.muxVideo ?? muxVideo)(render.videoOnlyPath, audio.wavPath, video, request);
    const mp4 = await (deps.probeMuxedMp4 ?? probeMuxedMp4)(video, request);
    const frameSeconds = 1 / KANJI_FPS;
    const problemsFound = [];
    if (mp4.frameCount !== timing.frames || render.frameCount !== timing.frames) problemsFound.push(`frames: ${mp4.frameCount} muxed, ${timing.frames} planned`);
    if (mp4.width !== manifest.width || mp4.height !== manifest.height) problemsFound.push("raster differs from the plan");
    if (mp4.audioSampleRate !== SAMPLE_RATE) problemsFound.push("audio is not 48 kHz");
    if (Math.abs(mp4.audioDurationSeconds - length) > frameSeconds) problemsFound.push(`audio lasts ${mp4.audioDurationSeconds} s, the video ${length} s`);
    if (problemsFound.length) fail(`the finished video failed its checks: ${problemsFound.join("; ")}`);

    progress("qa", "Measuring the finished video…");
    const still = await (deps.longestStill ?? longestStill)(render.videoOnlyPath, request);
    await mkdir(join(working, "stills"));
    const stills = [];
    for (const item of render.reviewStills) {
      const name = `frame-${String(item.frame).padStart(6, "0")}.png`;
      const bytes = await readFile(item.path);
      if (sha256(bytes) !== item.sha256) fail("a review still changed after capture");
      await writeFile(join(working, "stills", name), bytes);
      stills.push({ frame: item.frame, file: `stills/${name}`, sha256: item.sha256 });
    }
    await copyFile(audio.wavPath, join(working, "master.wav"));
    await copyFile(audio.voiceStemPath, join(working, "voice.wav"));
    await copyFile(audio.srtPath, join(working, "captions.srt"));
    await writeFile(join(working, "card-plan.json"), planBytes);
    const credits = [
      ...(config.credits ?? []),
      `Stroke data: KanjiVG ${planner.SHODO_KANJIVG_RELEASE}, © Ulrich Apel, CC BY-SA 3.0 (kanjivg.tagaini.net).`,
      ...(config.music.attribution ? [config.music.attribution] : []),
    ];
    await writeFile(join(working, "credits.txt"), credits.join("\n") + "\n");
    const artifacts = {};
    for (const file of ["video.mp4", "master.wav", "voice.wav", "captions.srt", "card-plan.json", "credits.txt"]) artifacts[file] = sha256(await readFile(join(working, file)));
    const qa = {
      schemaVersion: 1, kind: "kanji-short-qa", char, reviewStatus: "not-reviewed", technicalPass: true,
      video: { frames: mp4.frameCount, width: mp4.width, height: mp4.height, fps: `${KANJI_FPS}/1`, seconds: Math.round(length * 1000) / 1000 },
      audio: { integratedLufs: audio.loudness.integratedLufs, truePeakDbtp: audio.loudness.truePeakDbtp, musicGainDb: gainDb, voiceLufs, bedLufs,
        musicWindowStart: window.start, musicLongestQuietWithoutVoice: window.longestQuietSeconds, ducking: audio.ducking },
      pacing: { longestStillSeconds: Math.round(still.seconds * 1000) / 1000, longestStillStart: still.start, budgetSeconds: 2.5,
        withinBudget: still.seconds <= 2.5 },
      timing: { phases: timing.timing, onsets: timing.onsets, wordHighlights: timing.wordHighlights, strokes: final.strokes, typedAt: intro.convertAt, nameSpokenAt: intro.emphasizeAt },
      speech: takes.map(take => ({ id: take.id, text: take.text, seconds: Math.round(take.speech * 1000) / 1000 })),
      pronunciation: "not machine-checked: listen to every line before publishing",
      layout: "text fit and overflow are checked on every captured frame by the export page",
    };
    const qaBytes = JSON.stringify(qa, null, 2);
    await writeFile(join(working, "qa-report.json"), qaBytes);
    const renderManifest = {
      schemaVersion: 1, kind: "kanji-short-release", char, buildHash, planHash, kumikiItem: "shodo-kanji-card",
      sources: {
        dataset: { path: config.dataset, sha256: sha256(datasetBytes), entry: entry.char },
        kanjivg: { url: kanjivg.url, sha256: kanjivg.sha256 },
        music: { title: config.music.title, source: config.music.source, license: config.music.license, sha256: config.music.sha256, windowStart: window.start, bedSha256: sha256(bedBytes) },
      },
      narration: beats.map((beat, i) => ({ id: beat.id, spoken: takes[i].text, caption: beat.text, sha256: beat.sha256, providerSha256: takes[i].sourceSha256,
        provider: "fish", modelId: voice.modelId, voiceId: voice.voiceId, licenseStatus: voice.licenseStatus })),
      segmentHashes: render.segmentHashes, stills, artifacts: { ...artifacts, "qa-report.json": sha256(qaBytes) },
    };
    await writeFile(join(working, "render-manifest.json"), JSON.stringify(renderManifest, null, 2));
    if (await exists(releaseDir)) fail("a release appeared while this one was being made; refusing to overwrite it");
    await rename(working, releaseDir);
    progress("done", `Ready for review: ${join(releaseDir, "video.mp4")}`);
    return { releaseDir, videoPath: join(releaseDir, "video.mp4"), qa };
  } finally {
    if (stage) await stage.close();
    await rm(working, { recursive: true, force: true });
  }
}
