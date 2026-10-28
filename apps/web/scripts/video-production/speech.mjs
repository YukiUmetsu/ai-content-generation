/** Provider-neutral generated narration, FFmpeg normalization, and SHA-backed beat cache. */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, parse, resolve } from "node:path";
import { synthesizeFishBeat } from "./fish.mjs";
import { synthesizeLocalBeat } from "./local.mjs";

const execFileAsync = promisify(execFile);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fail = (message) => { throw new Error(`Narration preparation failed: ${message}`); };
const valid = (v) => typeof v === "string" && v.trim().length > 0;

async function execMedia(program, args, { signal, timeoutMs = 60000 } = {}) {
  try {
    return await execFileAsync(program, args, { signal, timeout: timeoutMs, maxBuffer: 256 * 1024 });
  } catch (error) {
    fail(`${program} failed (${error.code ?? error.signal ?? "unknown"}). Check the installed media tools and source WAV.`);
  }
}

export async function normalizeGeneratedWav(inputPath, outputPath, { ffmpeg = "ffmpeg", signal } = {}) {
  await execMedia(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", inputPath,
    "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", outputPath,
  ], { signal });
}

/** Probe normalized speech, requiring exact FFprobe sample count rather than predicted duration. */
export async function probeNormalizedWav(path, { ffprobe = "ffprobe", signal } = {}) {
  const { stdout } = await execMedia(ffprobe, [
    "-v", "error", "-select_streams", "a:0", "-show_entries",
    "stream=codec_name,sample_rate,channels,duration_ts,time_base", "-of", "json", path,
  ], { signal, timeoutMs: 30000 });
  let stream;
  try { stream = JSON.parse(stdout).streams?.[0]; }
  catch { fail("FFprobe emitted invalid JSON"); }
  const sampleRate = Number(stream?.sample_rate);
  const channels = stream?.channels;
  const codecName = stream?.codec_name;
  const timebase = stream?.time_base;
  const ticks = Number(stream?.duration_ts);
  const matches = /^([0-9]+)\/([0-9]+)$/.exec(timebase ?? "");
  if (!matches || !Number.isSafeInteger(ticks) || ticks <= 0) fail("FFprobe did not report a valid measured sample duration");
  const numerator = ticks * Number(matches[1]) * 48000;
  const denominator = Number(matches[2]);
  const samples = numerator / denominator;
  const output = { sampleRate, channels, codecName, samples };
  validateProbe(output);
  return output;
}

function validateProbe(probe) {
  if (probe?.sampleRate !== 48000 || probe.channels !== 1 || probe.codecName !== "pcm_s16le") {
    fail("normalized WAV format must be 48 kHz, mono, 16-bit PCM");
  }
  if (!Number.isSafeInteger(probe.samples) || probe.samples < 1) fail("FFprobe returned invalid or zero measured samples");
}

/**
 * @param {object} job validated video-production-job v1
 * @param {{provider:string,providerRevision:string,cacheRoot:string,synthesize?:Function,normalizeWav?:Function,probeWav?:Function,ffmpeg?:string,ffprobe?:string,signal?:AbortSignal,apiKey?:string,allowNetwork?:boolean,voiceReferenceConsent?:boolean,textTransmissionApproved?:boolean,localVoiceAuthorized?:boolean,authorizedVoiceIds?:string[],paidUsageApproved?:boolean,budgetUsd?:number,direction?:object,skipInvalidPriorCache?:boolean}} options
 */
export async function synthesizeNarration(job, options) {
  const voice = job?.voice;
  if (!voice || !Array.isArray(job?.beats) || job.beats.length === 0) fail("a validated job with narration beats is required");
  if (!options || !["fish", "local"].includes(options.provider) || options.provider !== voice.provider) fail("requested provider must match the job voice");
  if (!valid(options.providerRevision) || options.providerRevision.length > 128) fail("a pinned provider/engine revision is required for safe cache reuse");
  if (!valid(options.cacheRoot)) fail("a dedicated cache root is required");
  if (options.signal?.aborted) fail("cancelled before narration synthesis");
  if (options.provider === "local" && options.localVoiceAuthorized !== true) fail("local voice consent/authorization is required, including on cache hits");
  if (options.provider === "fish" && (!options.allowNetwork || options.voiceReferenceConsent !== true || options.textTransmissionApproved !== true)) {
    fail("Fish requires explicit network and voice/text transmission consent, including on cache hits");
  }
  if (job.approval === "approved" && (voice.licenseStatus !== "verified" || job.policy?.commercialRightsVerified !== true)) fail("approved narration requires verified commercial voice rights");

  // A visual beat remains one continuous scene. Its speech turns have their
  // own stable cache/Jobs identities and are assembled into one scene audio
  // range only after all provider results have been checked.
  const units=[];
  for(const beat of job.beats){
    if(beat.speechTurns===undefined){units.push(beat);continue;}
    if(beat.speaker!==undefined||!Array.isArray(beat.speechTurns)||
      beat.speechTurns.length<2||beat.speechTurns.length>16)
      fail("multi-speaker scenes require 2–16 explicitly ordered turns and no scene-wide voice");
    const seen=new Set();
    for(const turn of beat.speechTurns){
      if(!turn||typeof turn!=="object"||Array.isArray(turn)||
        Object.keys(turn).some(key=>!["id","narration","speaker","pauseAfterMs"].includes(key))||
        typeof turn.id!=="string"||!/^[a-zA-Z0-9_-]{1,80}$/u.test(turn.id)||
        beat.id.length+turn.id.length+1>127||seen.has(turn.id)||
        !valid(turn.narration)||turn.narration.length>2000||/[\u0000-\u001f\u007f]/u.test(turn.narration)||
        !Number.isSafeInteger(turn.pauseAfterMs)||turn.pauseAfterMs<0||turn.pauseAfterMs>3000)
        fail("invalid dialogue turn identity, text or pause; reopen the scene editor");
      seen.add(turn.id);
      units.push({...turn,id:`${beat.id}.${turn.id}`,eventIds:[]});
    }
    if(beat.speechTurns.map(turn=>turn.narration.trim()).join(" ")!==beat.narration?.trim())
      fail("scene narration differs from the approved dialogue turn transcript");
  }
  if(units.length>160)fail("too many speech turns for one video (maximum 160); split the conversation before submitting a voice request");

  // Non-default cast voices require separate, explicit authorization. Validate
  // ALL beats before any TTS or cache reuse so a late unauthorized character
  // cannot leave earlier provider requests half-completed.
  if (options.authorizedVoiceIds !== undefined &&
      (!Array.isArray(options.authorizedVoiceIds) || options.authorizedVoiceIds.length > 16 ||
        options.authorizedVoiceIds.some(id => typeof id !== "string" || !id.trim() ||
          id.length > 128 || id.trim() !== id || /[\u0000-\u001f\u007f]/u.test(id))))
    fail("authorized cast voice IDs must be a bounded list of nonsecret provider references");
  const authorized = new Set(options.authorizedVoiceIds ?? []);
  for (const beat of units) {
    if (beat?.speaker === undefined) continue;
    const speaker = beat.speaker;
    if (!speaker || typeof speaker !== "object" || Array.isArray(speaker) ||
        typeof speaker.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/u.test(speaker.id) ||
        !["narrator", "character"].includes(speaker.role) ||
        typeof speaker.voiceId !== "string" || !speaker.voiceId.trim() ||
        speaker.voiceId.length > 128 || speaker.voiceId.trim() !== speaker.voiceId ||
        /[\u0000-\u001f\u007f]/u.test(speaker.voiceId))
      fail("invalid beat speaker assignment; reopen the cast editor");
    if (speaker.voiceId !== voice.voiceId && !authorized.has(speaker.voiceId))
      fail("an additional speaker voice is not authorized; review each cast voice before generating speech");
    if (job.approval === "approved" && speaker.voiceId !== voice.voiceId)
      fail("commercial multi-voice export requires individually verified cast voice rights; use a private draft until rights can be verified");
  }

  const root = resolve(options.cacheRoot);
  if (parse(root).root === root) fail("filesystem root cannot be used as a narration cache");
  const direction = options.direction ?? { pace: "measured" };
  const normalized = options.normalizeWav ?? ((input, output) => normalizeGeneratedWav(input, output, { ffmpeg: options.ffmpeg, signal: options.signal }));
  const probe = options.probeWav ?? ((path) => probeNormalizedWav(path, { ffprobe: options.ffprobe, signal: options.signal }));
  const synthesize = options.synthesize ?? ((request, beatId) => options.provider === "fish"
    ? synthesizeFishBeat({
      ...request, allowNetwork: options.allowNetwork,
      rightsContext: { voiceReferenceConsent: options.voiceReferenceConsent, textTransmissionApproved: options.textTransmissionApproved, commercialRightsVerified: job.policy?.commercialRightsVerified },
    }, { apiKey: options.apiKey, paidUsageApproved: options.paidUsageApproved, budgetUsd: options.budgetUsd ?? 0, signal: options.signal,
      onDiagnostic: (detail) => options.onDiagnostic?.({ ...detail, beatId }) })
    : synthesizeLocalBeat({
      ...request, endpoint: voice.endpoint,
      rightsContext: { localVoiceAuthorized: options.localVoiceAuthorized, commercialRightsVerified: job.policy?.commercialRightsVerified },
    }, { signal: options.signal }));

  const outputs = [];
  for (const beat of units) {
    if (options.signal?.aborted) fail("narration synthesis cancelled");
    if (!valid(beat?.id) || !valid(beat?.narration)) fail("each beat needs an ID and nonempty narration");
    const selectedVoiceId = beat.speaker?.voiceId ?? voice.voiceId;
    const speakerId = beat.speaker?.id ?? "narrator";
    const speakerRole = beat.speaker?.role ?? "narrator";
    const signature = {
      schemaVersion: 1, text: beat.narration.trim().normalize("NFC"),
      locale: job.locale, provider: options.provider, providerRevision: options.providerRevision,
      modelId: voice.modelId, voiceId: selectedVoiceId, profileId: voice.profileId,
      ...(beat.speaker ? {speakerId,speakerRole} : {}),
      direction, encoding: "wav/pcm_s16le/mono/48000", approval: job.approval,
      licenseStatus: voice.licenseStatus, commercialRightsVerified: job.policy?.commercialRightsVerified === true,
    };
    const key = sha256(JSON.stringify(signature));
    const sceneAttempt=await options.sceneJobs?.beginScene({kind:"narration-scene",sceneId:beat.id,fingerprint:key});
    try {
    const keyDir = join(root, "narration", key.slice(0, 2), key);
    const wavPath = join(keyDir, "speech.wav");
    const metaPath = join(keyDir, "metadata.json");

    let cached = null;
    try {
      const meta = JSON.parse(await readFile(metaPath, "utf8"));
      const bytes = await readFile(wavPath);
      if (meta.key === key && meta.sha256 === sha256(bytes) && meta.providerRevision === options.providerRevision) {
        const measured = await probe(wavPath);
        validateProbe(measured);
        if (measured.samples === meta.samples) cached = meta;
      }
    } catch { /* Missing, interrupted or corrupt cache: safely regenerate this beat only. */ }

    // Reuse an unchanged, content-addressed 48 kHz speech beat from an earlier
    // run. Never trust a filename alone, and never bypass the provider consent
    // and commercial-rights gates checked before entering this loop.
    if (!cached && options.reuseCacheRoot) {
      const sourceDir = join(resolve(options.reuseCacheRoot), "narration", key.slice(0, 2), key);
      const sourceWav = join(sourceDir, "speech.wav");
      const sourceMeta = join(sourceDir, "metadata.json");
      let earlier = null;
      try {
        const meta = JSON.parse(await readFile(sourceMeta, "utf8"));
        const wavBytes = await readFile(sourceWav);
        if (meta.key !== key || meta.sha256 !== sha256(wavBytes) ||
            meta.providerRevision !== options.providerRevision ||
            meta.provider !== options.provider ||
            meta.modelId !== voice.modelId ||
            meta.licenseStatus !== voice.licenseStatus ||
            meta.commercialRightsVerified !== signature.commercialRightsVerified)
          fail("previous narration cache identity or hash mismatch for beat " + beat.id);
        const measured = await probe(sourceWav);
        validateProbe(measured);
        if (meta.samples !== measured.samples)
          fail("previous narration cache samples mismatch for beat " + beat.id);
        earlier = {meta, wavBytes};
      } catch (error) {
        const invalidPrior=error instanceof SyntaxError ||
          /^Narration preparation failed: previous narration cache /u.test(error?.message??"");
        if(error?.code!=="ENOENT"&&!(options.skipInvalidPriorCache===true&&invalidPrior&&!options.signal?.aborted))throw error;
        // A draft retry may discard a corrupt, untrusted cache entry and
        // synthesize again under fresh voice consent. A trusted released
        // cache still fails closed on mismatched provenance by default.
      }
      if (earlier) {
        await mkdir(keyDir, { recursive:true });
        await writeFile(wavPath, earlier.wavBytes, {flag:"wx"});
        await writeFile(metaPath, JSON.stringify(earlier.meta, null, 2), {flag:"wx"});
        cached = earlier.meta;
        options.onReuse?.({beatId:beat.id,source:"previous-verified-cache"});
      }
    }
    const reused=Boolean(cached);
    if (!cached) {
      await mkdir(keyDir, { recursive: true });
      const staging = await mkdtemp(join(keyDir, ".staging-"));
      try {
        const request = { text: signature.text, locale: job.locale, voiceId: selectedVoiceId, modelId: voice.modelId, direction };
        const result = await synthesize(request, beat.id);
        if (!(result?.audio instanceof Uint8Array) || result.audio.length === 0 ||
          result.provider !== options.provider || result.modelId !== voice.modelId ||
          result.voiceId !== selectedVoiceId || result.encoding !== "wav") fail(`provider returned invalid speech identity/audio for beat ${beat.id}`);
        if (options.provider === "local" && result.engineVersion !== options.providerRevision) fail("local engine version differs from the pinned cache revision");
        const generatedPath = join(staging, "generated.wav");
        const outputPath = join(staging, "normalized.wav");
        await writeFile(generatedPath, result.audio, { flag: "wx" });
        await normalized(generatedPath, outputPath);
        const measured = await probe(outputPath);
        validateProbe(measured);
        const normalizedBytes = await readFile(outputPath);
        const metadata = {
          key, sha256: sha256(normalizedBytes), provider: options.provider,
          providerRevision: options.providerRevision, modelId: voice.modelId,
          engineVersion: result.engineVersion ?? null, samples: measured.samples,
          sampleRate: 48000, channels: 1, codecName: "pcm_s16le", licenseStatus: voice.licenseStatus,
          commercialRightsVerified: signature.commercialRightsVerified,
        };
        await writeFile(join(staging, "metadata.json"), JSON.stringify(metadata, null, 2), { flag: "wx" });
        await rename(outputPath, wavPath);
        await rename(join(staging, "metadata.json"), metaPath);
        cached = metadata;
      } finally {
        // Staging was created under this exact cache key; never delete a caller path.
        await rm(staging, { recursive: true, force: true });
      }
    }
    outputs.push({
      id: beat.id, text: beat.narration, samples: cached.samples,
      wavPath, sha256: cached.sha256, provider: options.provider,
      providerRevision: options.providerRevision, modelId: voice.modelId, voiceId: selectedVoiceId,
      speakerId, speakerRole,
      licenseStatus: cached.licenseStatus, commercialRightsVerified: cached.commercialRightsVerified,
      pauseAfterMs: beat.pauseAfterMs, eventIds: beat.eventIds ?? [],
    });
    if(sceneAttempt)await options.sceneJobs.completeScene(sceneAttempt,{
      sha256:cached.sha256,samples:cached.samples,reused});
    } catch(error){
      if(sceneAttempt)await options.sceneJobs.failScene(sceneAttempt,error);
      throw error;
    }
  }
  const completed=new Map(outputs.map(unit=>[unit.id,unit]));
  return job.beats.map(beat=>{
    if(beat.speechTurns===undefined)return completed.get(beat.id);
    const turns=beat.speechTurns.map(turn=>completed.get(`${beat.id}.${turn.id}`));
    const samples=turns.reduce((total,turn)=>total+turn.samples+turn.pauseAfterMs*48,0);
    if(!Number.isSafeInteger(samples)||samples<1)fail("scene speech exceeds safe sample count");
    // An exact composite manifest hash; the audio writer independently checks
    // every turn's WAV hash and measured samples before creating the stem.
    const sha256Composite=sha256(JSON.stringify({kind:"scene-speech-turns/v1",
      turns:turns.map(turn=>({id:turn.id,sha256:turn.sha256,samples:turn.samples,
        pauseAfterMs:turn.pauseAfterMs}))}));
    return {id:beat.id,text:beat.narration,samples,sha256:sha256Composite,
      pauseAfterMs:beat.pauseAfterMs,eventIds:beat.eventIds??[],turns};
  });
}
