/** Produces one kanji study short: Kumiki's `shodo-kanji-card` for the picture, an anchored
 * narration (a script of templated lines on the card's moments, read by Fish), a reviewed music bed
 * under the voice, and a hash-verified release folder. Every external step (KanjiVG, Fish) needs
 * explicit permission; nothing is published.
 */
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderMasterAudio, wavBytes } from "./audio.mjs";
import { synthesizeNarration } from "./speech.mjs";
import { buildSampleTimeline } from "./timeline.mjs";
import { fingerprintBuiltStage, startLocalStageServer } from "./stage-server.mjs";
import { probeBrowserExecutable, renderVideoSegments } from "./render.mjs";
import { muxVideo, probeMuxedMp4 } from "./produce.mjs";
import { expandNarrationScript, placeOnAnchors, readNarrationScript, scriptAnchors } from "./anchored-narration.mjs";
import { SAMPLE_RATE, TRIM_DEFAULTS, clipPlacementFloor, lastPhrase, placeClips, toFrameGrid, trimSpeech } from "./narration-clips.mjs";
import { chooseMusicWindow, decodeMono, int16Wav, prepareMusicBed } from "./music-bed.mjs";
import { longestStill, measureLufs } from "./media-measure.mjs";
import { srtFromCues } from "./cue-captions.mjs";
import { joinRunTakes, runShare, scriptRuns, voiceFor } from "./voice-runs.mjs";
import {
  KANJI_CARD_ANCHORS, KANJI_FPS, KANJI_SHORT_PACING, kanjiCardAnchors, kanjiCardInset, kanjiCardInsetProblem, retakeFor, reuseFor, reuseSources, kanjiIntro, kanjiTextSettings, kanjiScriptData, kanjiShortContent, kanjiShortTiming, readKanjiDataset,
} from "./kanji-short.mjs";
import presets from "../../src/components/video/platform-presets.json" with { type: "json" };

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (message) => { throw new Error(`Kanji short: ${message}`); };
const exists = (path) => lstat(path).then(() => true, (error) => error.code === "ENOENT" ? false : Promise.reject(error));
const FISH_REVISION = "fish-api-v1";
/** The floor for every gap and the first start: the silence trimmed clips keep around their speech. */
const PLACEMENT_FLOOR = clipPlacementFloor(TRIM_DEFAULTS);
/** A rough length of a line before it is synthesized, only to check a script's placement early: 0.09 s per character, at least 0.4 s. */
const estimatedSpeech = (lines) => Object.fromEntries(lines.map(line => [line.id, Math.max(.4, [...line.say].length * .09)]));
/** The default narration: a data file, replaced by `narration.script` in the config. */
export const DEFAULT_KANJI_SCRIPT = fileURLToPath(new URL("./kanji-short-script.json", import.meta.url));

/**
 * The Node bundle with Kumiki's kanji card planning (built by `pnpm build`), imported from the
 * bytes that are hashed, so the recorded hash is the planner that timed the narration. The bundle
 * is self-contained (no imports).
 */
export async function loadKanjiPlanner(path = fileURLToPath(new URL("../../dist-shot/kanji-entry.mjs", import.meta.url))) {
  let bytes;
  try { bytes = await readFile(path); }
  catch { fail("the kanji card planner is not built. Run pnpm build, then start again."); }
  const planner = await import(`data:text/javascript;base64,${bytes.toString("base64")}`);
  return { ...planner, plannerSha256: sha256(bytes) };
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

const pcmBytes = (samples) => Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);

/**
 * Shortest music a short may use, checked first: about the two writing passes plus 12 s of intro,
 * the words' introduction and three words, at least 30 s. Once the script is placed with
 * estimated speech, the music is checked against that too, before any voice is made.
 */
export const musicSecondsNeeded = (pacing) => Math.max(30, pacing.write + pacing.review + 12);

/** The narration script of a config: its own `narration.script` (inline or a file), or the default. */
export async function kanjiNarrationScript(config) {
  const source = config.narration?.script;
  const json = source && typeof source === "object" ? source : JSON.parse(await readFile(typeof source === "string" ? source : DEFAULT_KANJI_SCRIPT, "utf8"));
  const script = readNarrationScript(json);
  const unknown = scriptAnchors(script).filter(name => !KANJI_CARD_ANCHORS.includes(name));
  if (unknown.length) fail(`the narration script uses anchors the kanji card does not have: ${unknown.join(", ")} (it has ${KANJI_CARD_ANCHORS.join(", ")})`);
  return script;
}

/**
 * @param {{char:string,config:object,out:string,allowNetwork?:boolean,voiceReferenceConsent?:boolean,textTransmissionApproved?:boolean,
 *   localVoiceAuthorized?:boolean,apiKey?:string,browserExecutable:string,distRoot?:string,signal?:AbortSignal,onProgress?:(event:object)=>void,
 *   ffmpeg?:string,ffprobe?:string}} request
 */
export async function produceKanjiShort(request, deps = {}) {
  const { char, config } = request;
  const progress = (phase, message) => request.onProgress?.({ phase, char, message });
  if (typeof char !== "string" || [...char].length !== 1) fail("one character is required");
  const out = resolve(request.out ?? "");
  if (!request.out || [parse(out).root, homedir(), process.cwd(), "/tmp"].includes(out)) fail("choose a narrow, video-owned output directory");
  const releaseDir = join(out, "release");
  if (await exists(releaseDir)) fail(`${releaseDir} already exists; choose a new output directory instead of overwriting a release`);
  // The voice: Fish (cloud) or a local engine, each with its own consent; KanjiVG needs the network only when not cached.
  const provider = config.voice.provider ?? "fish";
  if (provider === "fish") {
    if (!request.allowNetwork || !request.voiceReferenceConsent || !request.textTransmissionApproved)
      fail("Fish narration needs --allow-network, --voice-consent and --transmit-text");
    if (!request.apiKey) fail("FISH_AUDIO_API_KEY is not configured (Keychain or environment)");
  } else if (provider === "local") {
    if (!request.localVoiceAuthorized) fail("local narration needs --local-voice-consent");
    if (!config.voice.endpoint || !config.voice.engineRevision || !config.voice.modelId) fail("local narration needs voice.endpoint, voice.modelId and voice.engineRevision");
  } else fail(`voice.provider must be fish or local, not ${provider}`);
  const pacing = { ...KANJI_SHORT_PACING, ...config.timing };
  pacing.write = toFrameGrid(pacing.write, KANJI_FPS);
  pacing.review = toFrameGrid(pacing.review, KANJI_FPS);
  const card = config.card ?? {};

  // Everything that can fail locally fails before any text is sent to Fish.
  progress("preflight", "Checking the built export page, the browser, the kanji planner and the narration script…");
  const distRoot = request.distRoot ?? fileURLToPath(new URL("../../dist", import.meta.url));
  const buildHash = await (deps.fingerprintBuiltStage ?? fingerprintBuiltStage)(distRoot).catch(error => {
    if (error?.code === "ENOENT") fail("the export page is not built. Run pnpm build, then start again.");
    throw error;
  });
  await (deps.probeBrowserExecutable ?? probeBrowserExecutable)(request.browserExecutable);
  const planner = await (deps.loadKanjiPlanner ?? loadKanjiPlanner)();
  const preset = presets.find(p => p.id === config.destination);
  if (!preset || !planner.KANJI_SHORT_PRESETS.includes(preset.id)) fail(`the destination must be one of ${planner.KANJI_SHORT_PRESETS.join(", ")}`);
  // The card would shrink a pair of opposite bands over 0.45 of the frame without a word; say so instead.
  const safeInset = kanjiCardInset(preset.safeInset, card.safeInset);
  const insetProblem = kanjiCardInsetProblem(safeInset);
  if (insetProblem) fail(`card.safeInset: ${insetProblem}`);
  // Every theme problem, unknown keys included (the card itself ignores keys it does not have, so a typo would go unseen).
  const themeIssues = card.theme === undefined ? [] : planner.kanjiCardThemeIssues(card.theme);
  if (themeIssues.length) fail(`card.theme: ${themeIssues.join("; ")}`);
  const script = await kanjiNarrationScript(config);
  // A script cue must name a part of the card that a cue can draw attention to.
  const cueSections = planner.KANJI_CARD_CUE_SECTIONS ?? [];
  const unknownCue = script.steps.find(step => step.cue !== undefined && !cueSections.includes(step.cue));
  if (unknownCue) fail(`the narration script's step ${unknownCue.id} cues "${unknownCue.cue}"; the card can draw attention to ${cueSections.join(", ") || "nothing (rebuild with pnpm build)"}`);
  const datasetBytes = await readFile(config.dataset);
  const { entries, problems } = readKanjiDataset(JSON.parse(datasetBytes.toString("utf8")));
  const entry = entries.get(char);
  if (!entry) fail(`${char} is not in the kanji data${problems.length ? ` (${problems.length} entries had problems)` : ""}`);
  const ownProblems = problems.filter(problem => problem.includes(`(${char})`));
  const content = kanjiShortContent(entry, { speech: config.narration?.speech, maxWords: config.maxWords ?? 3 });
  // The script's templates, ids and conditions, checked before any download (strokes are counted later).
  expandNarrationScript(script, kanjiScriptData(content, { labels: config.narration?.labels, strokeCount: 1 }));
  // The card's text limits, before any download: a word the page would refuse stops here.
  for (const word of content.words) for (const [key, max] of Object.entries(planner.KANJI_WORD_LIMITS ?? {}))
    if (!(typeof word[key] === "string" && word[key].trim() && word[key].length <= max)) fail(`the word ${word.word} has a ${key} longer than the card shows (${max} characters)`);
  const musicSource = await readFile(config.music.path);
  if (sha256(musicSource) !== config.music.sha256) fail("the music file changed since it was reviewed; check it and update its sha256");

  await mkdir(out, { recursive: true });
  const cacheDir = resolve(config.cacheDir ?? join(out, ".cache"));
  // This run's own scratch folder, so a second run in the same folder cannot remove it.
  const renderDir = await mkdtemp(join(out, ".render-"));
  const working = await mkdtemp(join(out, ".release-staging-"));
  const media = { ffmpeg: request.ffmpeg ?? "ffmpeg", ffprobe: request.ffprobe ?? "ffprobe", signal: request.signal };
  let stage = null, released = false;
  try {
    // The music: decoded once, long enough for this short from where it starts.
    const sourceWav = join(renderDir, "music-source.wav");
    const music = await decodeMono(config.music.path, sourceWav, media);
    const musicSeconds = music.length / SAMPLE_RATE;
    const musicFrom = Number.isFinite(config.music.startSeconds) ? config.music.startSeconds : 1;
    const needed = musicSecondsNeeded(pacing);
    if (musicSeconds - musicFrom < needed) fail(`the music has ${Math.max(0, musicSeconds - musicFrom).toFixed(1)} s from ${musicFrom} s; this short needs at least ${needed} s`);

    progress("strokes", `Loading KanjiVG stroke data for ${char}…`);
    const kanjivg = await (deps.kanjiVgSvg ?? kanjiVgSvg)(char, { planner, cacheDir, allowNetwork: request.allowNetwork, signal: request.signal });
    const glyph = await planner.glyphFromKanjiVg(char, kanjivg.svg);
    const cardText = { meanings: content.meanings, onyomi: content.onyomi, kunyomi: content.kunyomi, jlpt: content.jlpt, words: content.words };
    const cardOptions = { layout: "portrait", density: card.density ?? "compact", safeInset, content: cardText, sections: {},
      ...(card.brushStyle ? { brushStyle: card.brushStyle } : {}) };
    const scriptData = kanjiScriptData(content, { labels: config.narration?.labels, strokeCount: glyph.strokes.length });
    const lines = expandNarrationScript(script, scriptData);
    if (!lines.length) fail("the narration script has no line for this kanji");
    const planFor = (timing, strokes, intro, wordHighlights, sectionCues = []) => ({
      schemaVersion: 1, kind: "kanji-study-visual-plan",
      manifest: { schemaVersion: 1, id: `kanji-short-${char.codePointAt(0).toString(16)}`, durationFrames: ["intro", "write", "review", "info"].reduce((sum, k) => sum + Math.round(timing[k] * KANJI_FPS), 0),
        width: preset.width, height: preset.height, fps: { num: KANJI_FPS, den: 1 }, preset: preset.id },
      card: {
        char, glyph, layout: "portrait", density: cardOptions.density, heading: card.heading ?? "Kanji study", safeInset, timing,
        ...(intro ? { intro } : {}), ...cardText, wordHighlights, ...(sectionCues.length ? { sectionCues } : {}), strokeNumbers: card.strokeNumbers ?? true, reducedMotion: false,
        ...(card.labels ? { labels: card.labels } : {}), ...(card.theme ? { theme: card.theme } : {}), ...(card.brushStyle ? { brushStyle: card.brushStyle } : {}),
      },
      strokes,
    });
    // The page's own check on a provisional plan, and the script placed with estimated speech, so a
    // plan the page would refuse or a line with no moment in the picture stops here, before any voice.
    const provisional = { intro: 3, write: pacing.write, review: pacing.review, info: 3 };
    const provisionalCard = planner.planKanjiCard(glyph, { ...cardOptions, timing: provisional });
    const unhighlightable = lines.find(line => line.highlight && (line.list !== "words" || line.index >= content.words.length));
    if (unhighlightable) fail(`line ${unhighlightable.id} highlights an item of ${unhighlightable.list}; the card highlights only its words (forEach "words")`);
    const estimate = placeOnAnchors({ lines, anchors: kanjiCardAnchors(provisionalCard.timeline, provisionalCard.strokes), speech: estimatedSpeech(lines),
      highlightTail: script.highlightTail, highlightLead: script.highlightLead, ...PLACEMENT_FLOOR });
    // The estimated highlights and cues, so a time the page would refuse stops here too.
    planner.readKanjiStudyPlan(JSON.parse(JSON.stringify(planFor(provisional, provisionalCard.strokes, { reading: content.name.kana },
      estimate.highlights.map(cue => ({ word: cue.item, at: cue.at, hold: cue.hold })),
      estimate.cues.map(cue => ({ section: cue.cue, at: cue.at, hold: cue.hold }))))));
    // The music must also last the estimated narration (more words make a longer short), checked before any voice.
    // Spoken words run longer than the estimate (up to about 1.2 s against 0.4 s), so keep a margin of 4 s.
    const estimatedSeconds = estimate.end + pacing.tail + 4;
    if (musicSeconds - musicFrom < estimatedSeconds)
      fail(`the music has ${Math.max(0, musicSeconds - musicFrom).toFixed(1)} s from ${musicFrom} s; this short's narration needs about ${Math.ceil(estimatedSeconds)} s`);

    const voice = { provider, voiceId: config.voice.voiceId, modelId: config.voice.modelId ?? "s2.1-pro-free", licenseStatus: config.voice.licenseStatus ?? "unknown",
      ...(provider === "local" ? { endpoint: config.voice.endpoint } : {}) };
    // With a voice per language, a line that mixes scripts is read in runs, each by its language's
    // voice ("Do you know how to write the kanji" in English, "つき?" in Japanese), then joined.
    const voiceIds = config.voice.voiceIds;
    // Retakes and reuses for this short: a key may name its fields ({ "{name.kana}": "kunyomi" }).
    const retakes = kanjiTextSettings(config.narration?.retakes, scriptData), reuse = kanjiTextSettings(config.narration?.reuse, scriptData);
    const runsOf = (line) => voiceIds ? scriptRuns(line.say, line.locale) : [{ text: line.say, locale: line.locale }];
    const units = lines.flatMap(line => {
      const runs = runsOf(line);
      return runs.map((run, k) => {
        const take = retakeFor(run.text, retakes), reusedFrom = reuseFor(run.text, reuse);
        return { line: line.id, id: runs.length === 1 ? line.id : `${line.id}-run${k + 1}`, ...run, ...(take ? { take } : {}), ...(reusedFrom ? { reusedFrom } : {}) };
      });
    });
    // A reused text is heard as the last phrase of another line of this short (reuseSources); in a
    // short where that does not apply, the text is read on its own. It is still read on its own too,
    // as a fallback should the line's audio have no clear pause.
    for (const [unit, found] of reuseSources(units)) if (found.cut) Object.assign(unit, found); else delete unit.reusedFrom;
    const reuseWarnings = [];
    progress("narration", `Synthesizing ${units.length} ${voiceIds ? "voice runs" : "lines"} (${provider})…`);
    const results = new Map();
    for (const locale of [...new Set(units.map(unit => unit.locale))]) {
      const group = units.filter(unit => unit.locale === locale);
      const done = await (deps.synthesizeNarration ?? synthesizeNarration)({
        voice, locale, approval: "test-only", policy: { commercialRightsVerified: config.voice.commercialRightsVerified === true },
        beats: group.map(unit => ({ id: unit.id, narration: unit.text, pauseAfterMs: 0, eventIds: [],
          // A retake of a text the voice flubbed (narration.retakes), matched on what the voice reads.
          ...(unit.take ? { take: unit.take } : {}),
          ...(voiceIds ? { speaker: { id: `voice-${locale.toLowerCase()}`, role: "narrator", voiceId: voiceFor(locale, voiceIds, voice.voiceId) } } : {}) })),
      }, {
        provider, cacheRoot: cacheDir, direction: { pace: config.voice.pace ?? "slow" }, signal: request.signal,
        ...(voiceIds ? { authorizedVoiceIds: [...new Set(Object.values(voiceIds))] } : {}),
        ...(provider === "fish"
          ? { providerRevision: FISH_REVISION, apiKey: request.apiKey, allowNetwork: true, voiceReferenceConsent: true, textTransmissionApproved: true }
          : { providerRevision: config.voice.engineRevision, localVoiceAuthorized: true }),
      });
      group.forEach((unit, i) => { if (done[i]?.id !== unit.id) fail("narration came back out of order"); results.set(unit.id, done[i]); });
    }
    // The take a unit is heard from: its own, or for a reused text the matching part of the source line's take.
    const reused = new Set();
    const takeOf = async (unit) => {
      if (unit.reusedFrom) {
        const samples = int16Wav(await readFile(results.get(unit.source.id).wavPath));
        const phrase = unit.cut.whole ? samples : lastPhrase(samples, { pauses: unit.cut.pauses });
        if (phrase) { reused.add(unit.id); return trimSpeech(phrase); }
        reuseWarnings.push(`"${unit.text}" could not be taken from line ${unit.reusedFrom} (no clear pause after its comma); it was read on its own`);
      }
      return trimSpeech(int16Wav(await readFile(results.get(unit.id).wavPath)));
    };
    const sourceOf = (unit) => reused.has(unit.id) ? results.get(unit.source.id) : results.get(unit.id);
    const voiceOf = (unit) => voiceFor(reused.has(unit.id) ? unit.source.locale : unit.locale, voiceIds, voice.voiceId);
    const provenance = (unit) => reused.has(unit.id) ? { reusedFrom: unit.reusedFrom } : unit.take ? { take: unit.take } : {};
    const takes = await Promise.all(lines.map(async line => {
      const runs = units.filter(unit => unit.line === line.id);
      const trimmed = await Promise.all(runs.map(takeOf));
      if (runs.length === 1) return { ...line, ...trimmed[0], sourceSha256: sourceOf(runs[0]).sha256, voiceId: voiceOf(runs[0]), ...provenance(runs[0]) };
      const joined = joinRunTakes(trimmed);
      return {
        ...line, clip: joined.clip, lead: joined.lead, speech: joined.speech,
        // An emphasized part (the kanji's name) is pulsed as its own run starts, not at a share of the text.
        ...(line.emphasizeAt === undefined ? {} : { emphasizeAt: runShare(runs, joined.starts, joined.speech, line.emphasizeAt, line.say, joined.durations) }),
        // A joined line has no single provider audio: each run keeps its own voice and provider hash.
        sourceSha256: null,
        voiceRuns: runs.map((unit, k) => ({ text: unit.text, locale: unit.locale, startsAt: Math.round(joined.starts[k] * 1000) / 1000, ...provenance(unit),
          voiceId: voiceOf(unit), providerSha256: sourceOf(unit).sha256 })),
      };
    }));
    const speech = Object.fromEntries(takes.map(take => [take.id, take.speech]));

    progress("timing", "Placing the narration on the card's moments…");
    const placing = { speech, highlightTail: script.highlightTail, highlightLead: script.highlightLead, ...PLACEMENT_FLOOR };
    const intro = kanjiIntro(placeOnAnchors({ ...placing, lines: takes, anchors: { start: 0 }, partial: true }), { introTail: pacing.introTail });
    const probe = planner.planKanjiCard(glyph, { ...cardOptions, timing: { intro: intro.intro, write: pacing.write, review: pacing.review, info: 1 } });
    const placement = placeOnAnchors({ ...placing, lines: takes, anchors: kanjiCardAnchors(probe.timeline, probe.strokes) });
    const timing = kanjiShortTiming({ intro: intro.intro, write: pacing.write, review: pacing.review, end: placement.end, tail: pacing.tail });
    const final = planner.planKanjiCard(glyph, { ...cardOptions, timing: timing.timing });
    if (final.timeline.frames !== timing.frames) fail(`the card plans ${final.timeline.frames} frames, the narration ${timing.frames}`);
    const wordHighlights = placement.highlights.map(cue => ({ word: cue.item, at: cue.at, hold: cue.hold }));
    // A line's cue (for example the words' introduction) draws attention to that part of the card while it plays.
    const sectionCues = placement.cues.map(cue => ({ section: cue.cue, at: cue.at, hold: cue.hold }));
    const cardIntro = intro.intro > 0 ? { reading: content.name.kana, convertAt: planner.kanjiCardConvertAt([...content.name.kana].length, { typeStep: card.typeStep }),
      ...(intro.emphasizeAt !== undefined ? { emphasizeAt: intro.emphasizeAt } : {}),
      ...(card.typeStep !== undefined ? { typeStep: card.typeStep } : {}) } : null;

    const beatDir = join(renderDir, "narration");
    await mkdir(beatDir, { recursive: true });
    const placed = placeClips(takes, placement.onsets, timing.totalSamples);
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
    const length = timing.frames / KANJI_FPS;
    const window = Number.isFinite(config.music.startSeconds) ? { start: config.music.startSeconds, longestQuietSeconds: null }
      : chooseMusicWindow(music, length, takes.map(take => ({ onset: placement.onsets[take.id], end: placement.ends[take.id] })));
    const voiceProbe = join(renderDir, "voice-probe.wav");
    const voiceSamples = new Int16Array(timing.totalSamples);
    for (let i = 0, cursor = 0; i < placed.length; i++) { voiceSamples.set(placed[i].samples, cursor); cursor += placed[i].samples.length + placed[i].pauseAfterMs * 48; }
    await writeFile(voiceProbe, wavBytes(pcmBytes(voiceSamples)));
    const voiceLufs = await measureLufs(voiceProbe, media);
    const below = config.music.belowVoiceDb ?? 11;
    const bed = await prepareMusicBed({ sourceWav, musicSeconds, window, length, voiceLufs, belowVoiceDb: below, bedPath: join(renderDir, "music-bed.wav") }, media);
    const bedBytes = await readFile(bed.bedPath);

    progress("mix", "Mixing the voice and the ducked music bed…");
    const audio = await (deps.renderMasterAudio ?? renderMasterAudio)({ beats, timeline, sfx: [{
      id: "music", eventId: "music-start", kind: "ambience", licenseStatus: "verified", assetPath: bed.bedPath, assetSha256: sha256(bedBytes),
      gainDb: bed.gainDb, fadeInMs: config.music.fadeInMs ?? 250, fadeOutMs: config.music.fadeOutMs ?? 1200,
    }] }, { outputDir: await mkdtemp(join(renderDir, "audio-")), ffmpeg: request.ffmpeg, ffprobe: request.ffprobe, signal: request.signal });

    const plan = planner.readKanjiStudyPlan(JSON.parse(JSON.stringify(planFor(timing.timing, final.strokes, cardIntro, wordHighlights, sectionCues))));
    const manifest = plan.manifest;
    if (manifest.durationFrames !== timing.frames) fail("the export plan's length differs from the narration");
    const planBytes = JSON.stringify(plan);
    const planHash = sha256(planBytes);
    const f = (seconds) => Math.min(timing.frames - 1, Math.max(0, Math.round(seconds * KANJI_FPS)));
    const reviewFrames = [...new Set([0, ...(cardIntro ? [f(cardIntro.convertAt + .4)] : []), f(final.strokes.write.at(-1)[1]), f(final.strokes.review.at(-1)[1]),
      ...wordHighlights.map(cue => f(cue.at + .4)), ...sectionCues.map(cue => f(cue.at + cue.hold / 2)), timing.frames - 1])].sort((a, b) => a - b);

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
    const problemsFound = [];
    if (mp4.frameCount !== timing.frames || render.frameCount !== timing.frames) problemsFound.push(`frames: ${mp4.frameCount} muxed, ${timing.frames} planned`);
    if (mp4.width !== manifest.width || mp4.height !== manifest.height) problemsFound.push("raster differs from the plan");
    if (mp4.audioSampleRate !== SAMPLE_RATE) problemsFound.push("audio is not 48 kHz");
    if (Math.abs(mp4.audioDurationSeconds - length) > 1 / KANJI_FPS) problemsFound.push(`audio lasts ${mp4.audioDurationSeconds} s, the video ${length} s`);
    if (problemsFound.length) fail(`the finished video failed its checks: ${problemsFound.join("; ")}`);

    progress("qa", "Measuring the finished video…");
    const still = await (deps.longestStill ?? longestStill)(render.videoOnlyPath, media);
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
    // A caption stays a little after its line, but never past the next line's start.
    const captionTail = config.captions?.tailSeconds ?? .2;
    await writeFile(join(working, "captions.srt"), srtFromCues(takes.map((take, i) => ({ start: placement.onsets[take.id],
      end: Math.min(placement.ends[take.id] + captionTail, takes[i + 1] ? placement.onsets[takes[i + 1].id] : Infinity), text: take.caption }))));
    await writeFile(join(working, "card-plan.json"), planBytes);
    const credits = [
      ...(config.credits ?? []),
      `Stroke data: KanjiVG ${planner.SHODO_KANJIVG_RELEASE}, © Ulrich Apel, CC BY-SA 3.0 (kanjivg.tagaini.net).`,
      config.music.attribution || `Music: ${config.music.title} (${config.music.source}), ${config.music.license}.`,
    ];
    await writeFile(join(working, "credits.txt"), credits.join("\n") + "\n");
    const artifacts = {};
    for (const file of ["video.mp4", "master.wav", "voice.wav", "captions.srt", "card-plan.json", "credits.txt"]) artifacts[file] = sha256(await readFile(join(working, file)));
    const maxDrift = Math.max(0, ...Object.values(placement.drift));
    const stillBudget = config.qa?.stillBudgetSeconds ?? 2.5, driftBudget = config.qa?.anchorDriftSeconds ?? 1.5;
    const warnings = ownProblems.map(problem => `kanji data: ${problem}`);
    if (still.seconds > stillBudget) warnings.push(`the picture stands still for ${still.seconds.toFixed(2)} s at ${still.start} s (budget ${stillBudget} s)`);
    if (bed.belowVoiceDb > below + 1) warnings.push(`the music sits ${bed.belowVoiceDb} dB under the voice, not ${below} dB: the bed is too quiet to raise further`);
    if (maxDrift > driftBudget) warnings.push(`a line starts ${maxDrift} s after its moment in the picture: the line before it is too long for the gap`);
    warnings.push(...reuseWarnings);
    const qa = {
      schemaVersion: 1, kind: "kanji-short-qa", char, reviewStatus: "not-reviewed", technicalPass: warnings.length === 0, warnings,
      video: { frames: mp4.frameCount, width: mp4.width, height: mp4.height, fps: `${KANJI_FPS}/1`, seconds: Math.round(length * 1000) / 1000 },
      audio: { integratedLufs: audio.loudness.integratedLufs, truePeakDbtp: audio.loudness.truePeakDbtp, channels: "mono (plays about 3 dB louder on two speakers)",
        voiceLufs, bedLufs: bed.bedLufs, musicPreGainDb: bed.preGainDb, musicGainDb: bed.gainDb, musicBelowVoiceDb: bed.belowVoiceDb, musicBelowVoiceTargetDb: below,
        musicWindowStart: window.start, musicLongestQuietWithoutVoice: window.longestQuietSeconds, ducking: audio.ducking },
      pacing: { longestStillSeconds: Math.round(still.seconds * 1000) / 1000, longestStillStart: still.start, budgetSeconds: stillBudget, withinBudget: still.seconds <= stillBudget },
      narration: { onsets: placement.onsets, ends: placement.ends, driftAfterAnchor: placement.drift, wordHighlights, sectionCues, emphasis: placement.emphasis },
      timing: { phases: timing.timing, strokes: final.strokes, intro: cardIntro },
      speech: takes.map(take => ({ id: take.id, locale: take.locale, spoken: take.say, caption: take.caption, seconds: Math.round(take.speech * 1000) / 1000,
        ...(take.voiceRuns ? { voiceRuns: take.voiceRuns } : {}), ...(take.take ? { take: take.take } : {}), ...(take.reusedFrom ? { reusedFrom: take.reusedFrom } : {}) })),
      pronunciation: "not machine-checked: listen to every line before publishing",
      layout: "text fit, overflow and the brush strokes are checked on every captured frame by the export page",
    };
    const qaBytes = JSON.stringify(qa, null, 2);
    await writeFile(join(working, "qa-report.json"), qaBytes);
    const renderManifest = {
      schemaVersion: 1, kind: "kanji-short-release", char, buildHash, planHash, kumikiItem: "shodo-kanji-card", plannerSha256: planner.plannerSha256 ?? null,
      narrationScriptSha256: sha256(JSON.stringify(script)),
      sources: {
        dataset: { path: config.dataset, sha256: sha256(datasetBytes), entry: entry.char },
        kanjivg: { url: kanjivg.url, sha256: kanjivg.sha256 },
        music: { title: config.music.title, source: config.music.source, license: config.music.license, sha256: config.music.sha256, windowStart: window.start, bedSha256: sha256(bedBytes) },
      },
      // The voice that read each line, or each run of a line read by several voices.
      narration: beats.map((beat, i) => ({ id: beat.id, locale: takes[i].locale, spoken: takes[i].say, caption: takes[i].caption, sha256: beat.sha256,
        provider, modelId: voice.modelId, licenseStatus: voice.licenseStatus,
        ...(takes[i].voiceRuns ? { voiceRuns: takes[i].voiceRuns } : { voiceId: takes[i].voiceId, providerSha256: takes[i].sourceSha256, ...(takes[i].take ? { take: takes[i].take } : {}), ...(takes[i].reusedFrom ? { reusedFrom: takes[i].reusedFrom } : {}) }) })),
      segmentHashes: render.segmentHashes, stills, artifacts: { ...artifacts, "qa-report.json": sha256(qaBytes) },
    };
    await writeFile(join(working, "render-manifest.json"), JSON.stringify(renderManifest, null, 2));
    if (await exists(releaseDir)) fail("a release appeared while this one was being made; refusing to overwrite it");
    await rename(working, releaseDir);
    released = true;
    progress("done", `Ready for review: ${join(releaseDir, "video.mp4")}`);
    return { releaseDir, videoPath: join(releaseDir, "video.mp4"), qa };
  } finally {
    if (stage) await stage.close();
    await rm(working, { recursive: true, force: true });
    // The scratch work is this run's own; the caches it used live in cacheDir and stay.
    await rm(renderDir, { recursive: true, force: true });
    if (!released) await rmdir(out).catch(() => {});                       // only when nothing else is in it
  }
}
