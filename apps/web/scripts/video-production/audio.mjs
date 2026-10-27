/** Semantic, sample-domain audio mix. FFmpeg owns DSP; no imported narrator bypass. */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import { join, parse, resolve } from "node:path";
import { probeNormalizedWav } from "./speech.mjs";
import { writeSrt } from "./timeline.mjs";

const run = promisify(execFile);
const SAMPLE_RATE = 48000;
const NARRATION_DUCKING = Object.freeze({threshold:0.018,ratio:8,attackMs:70,releaseMs:350});
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (message) => { throw new Error(`Audio mastering failed: ${message}`); };

function pcmHeader(samples) {
  if (!Number.isSafeInteger(samples) || samples <= 0 || samples * 2 > 0xffffffff - 36) fail("master exceeds classic PCM WAV capacity");
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + samples * 2, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28); header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(samples * 2, 40);
  return header;
}

function readPcmData(bytes) {
  if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE" ||
    bytes.readUInt32LE(4) + 8 > bytes.length) fail("missing, truncated or invalid WAV speech");
  const end = bytes.readUInt32LE(4) + 8;
  let format = false, audio = null;
  for (let i = 12; i + 8 <= end;) {
    const kind = bytes.toString("ascii", i, i + 4);
    const size = bytes.readUInt32LE(i + 4);
    const start = i + 8;
    if (start + size > end) fail("truncated WAV chunk");
    if (kind === "fmt " && size >= 16) {
      if (bytes.readUInt16LE(start) !== 1 || bytes.readUInt16LE(start + 2) !== 1 ||
        bytes.readUInt32LE(start + 4) !== SAMPLE_RATE || bytes.readUInt16LE(start + 14) !== 16) {
        fail("normalized WAV format must be 48 kHz mono 16-bit PCM");
      }
      format = true;
    }
    if (kind === "data") audio = bytes.subarray(start, start + size);
    i = start + size + (size % 2);
  }
  if (!format || !audio || !audio.length || audio.length % 2) fail("WAV has no valid 16-bit PCM samples");
  return audio;
}

async function mediaExec(program, args, { signal, timeoutMs = 180000 } = {}) {
  try { return await run(program, args, { signal, timeout: timeoutMs, maxBuffer: 1024 * 1024 }); }
  catch (error) { fail(`${program} failed (${error.code ?? error.signal ?? "unknown"}); inspect local audio tools.`); }
}

async function saveVoiceStem(beats, timeline, outputPath) {
  const byId = new Map(beats.map((beat) => [beat.id, beat]));
  if (byId.size !== beats.length) fail("duplicate beat IDs");
  const handle = await open(outputPath, "wx");
  try {
    await handle.writeFile(pcmHeader(timeline.totalSamples));
    for (const range of timeline.beats) {
      const beat = byId.get(range.id);
      if (!beat || !beat.wavPath) fail(`missing WAV speech for beat ${range.id}`);
      let bytes;
      try { bytes = await readFile(beat.wavPath); }
      catch { fail(`missing or unreadable WAV speech for beat ${range.id}`); }
      if (hash(bytes) !== beat.sha256) fail(`corrupt WAV speech hash for beat ${range.id}`);
      const data = readPcmData(bytes);
      if (data.length / 2 !== range.endSample - range.startSample || beat.samples !== data.length / 2) {
        fail(`measured speech sample count mismatch for beat ${range.id}`);
      }
      let hasSignal = false;
      for (let i = 0; i < data.length; i += 2) {
        const value = data.readInt16LE(i);
        if (Math.abs(value) >= 32766) fail(`clipping in generated speech beat ${range.id}`);
        if (value !== 0) hasSignal = true;
      }
      if (!hasSignal) fail(`unexpected silence in generated narration beat ${range.id}`);
      await handle.writeFile(data);
      const pauseSamples = range.pauseEndSample - range.endSample;
      if (pauseSamples > 0) await handle.writeFile(Buffer.alloc(pauseSamples * 2));
    }
  } finally { await handle.close(); }
}

/** Test fixture only; never evidence of licensed third-party music or stock effects. */
function makeTestRevealChime() {
  const samples = Math.round(SAMPLE_RATE * 0.26);
  const output = Buffer.concat([pcmHeader(samples), Buffer.alloc(samples * 2)]);
  for (let i = 0; i < samples; i++) {
    const t = i / SAMPLE_RATE;
    const envelope = Math.min(1, i / (0.012 * SAMPLE_RATE)) * Math.exp(-t * 14);
    const value = Math.round(15000 * envelope * (Math.sin(2 * Math.PI * 880 * t) + 0.3 * Math.sin(2 * Math.PI * 1320 * t)) / 1.3);
    output.writeInt16LE(value, 44 + i * 2);
  }
  return output;
}

/** Original, no-asset transition tick, deliberately softer/shorter than the answer chime.
 * Test-only material: an editor must explicitly approve the eventual audio master.
 */
export function makeTestSoftTick() {
  const samples = Math.round(SAMPLE_RATE * 0.12);
  const output = Buffer.concat([pcmHeader(samples), Buffer.alloc(samples * 2)]);
  for (let i = 0; i < samples; i++) {
    const t = i / SAMPLE_RATE;
    const envelope = Math.min(1, t / 0.006) * Math.exp(-t * 32);
    const value = Math.round(9000 * envelope * (
      Math.sin(2 * Math.PI * 620 * t) + 0.15 * Math.sin(2 * Math.PI * 1240 * t)) / 1.15);
    output.writeInt16LE(value, 44 + i * 2);
  }
  return output;
}

async function analyzeLoudness(path, { ffmpeg, signal }) {
  const { stderr } = await mediaExec(ffmpeg, ["-hide_banner", "-nostdin", "-i", path, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"], { signal });
  const match = stderr.match(/\{\s*"input_i"[\s\S]*?\}/);
  if (!match) fail("no measured loudness result from FFmpeg");
  let report;
  try { report = JSON.parse(match[0]); }
  catch { fail("malformed measured FFmpeg loudness JSON"); }
  const integratedLufs = Number(report.input_i);
  const truePeakDbtp = Number(report.input_tp);
  if (!Number.isFinite(integratedLufs) || !Number.isFinite(truePeakDbtp)) fail("unexpected silence/unknown loudness in mastered audio");
  if (truePeakDbtp > -1.45) fail("measured true-peak clipping/limit violation in mastered audio");
  return { integratedLufs, truePeakDbtp, targetIntegratedLufs: -16, maximumTruePeakDbtp: -1.5 };
}

/**
 * @param {{beats:Array<object>,timeline:object,sfx:Array<object>,music?:object}} input
 * @param {{outputDir:string,ffmpeg?:string,ffprobe?:string,allowTestAssets?:boolean,signal?:AbortSignal}} config
 */
export async function renderMasterAudio(input, config) {
  const { beats, timeline, sfx, music } = input ?? {};
  if (!timeline || timeline.sampleRate !== SAMPLE_RATE || !Array.isArray(timeline.beats) || !Number.isSafeInteger(timeline.totalSamples)) fail("48 kHz measured speech timeline is required");
  if (!Array.isArray(beats) || beats.length !== timeline.beats.length) fail("narrated WAV beat count must match the timeline");
  if (!Array.isArray(sfx) || sfx.length > 200) fail("SFX declarations are required and must be bounded");
  const ambienceCount=sfx.filter(effect=>effect?.kind==="ambience").length;
  if(ambienceCount>4)fail("maximum four sustained ambience beds per video");
  if (music) fail("standalone music input is unsupported; select a reviewed music bed through Sound Studio's looping ambience track");
  if (!config?.outputDir) fail("an explicit output directory is required");
  const dir = resolve(config.outputDir);
  if (dir === parse(dir).root) fail("filesystem root is not a safe mastering output directory");
  const ffmpeg = config.ffmpeg ?? "ffmpeg", ffprobe = config.ffprobe ?? "ffprobe";
  const voiceStemPath = join(dir, "voice.wav"), wavPath = join(dir, "master.wav"), srtPath = join(dir, "captions.srt");
  const sfxCueSamples = Object.create(null), inputPaths = [], clipSamples=[];
  const rightsFindings = [];
  for (const effect of sfx) {
    if (!effect?.id || !effect.eventId || !Object.hasOwn(timeline.eventSamples ?? {}, effect.eventId)) fail("SFX event is orphaned or missing from the timeline");
    if (Object.hasOwn(sfxCueSamples, effect.id)) fail(`duplicate SFX ${effect.id}`);
    if (effect.startSample !== undefined && effect.startSample !== timeline.eventSamples[effect.eventId]) fail("shifted SFX event timing is not allowed");
    if (effect.licenseStatus !== "verified" && effect.licenseStatus !== "test-only") fail(`missing rights/license for SFX ${effect.id}`);
    if (effect.licenseStatus === "test-only" && !config.allowTestAssets) fail("explicit test-only asset permission is required");
    if (effect.licenseStatus === "test-only" && !["self-authored-test-chime","self-authored-test-soft-tick"].includes(effect.assetRef)) fail("test-only SFX must be an original allowed procedural cue");
    if (effect.licenseStatus === "verified" && !effect.assetPath) fail("verified external SFX requires an asset path");
    if (effect.licenseStatus === "test-only") rightsFindings.push({ severity: "warning", code: "test-only-audio-not-commercial", id: effect.id });
    const ambience=effect.kind==="ambience",offset=effect.offsetMs??0;
    if(effect.kind!==undefined&&!ambience&&effect.kind!=="effect")fail("unsupported sound kind");
    if(!Number.isSafeInteger(offset)||offset<0||offset>(ambience?0:10000))fail("invalid sound offset");
    if(effect.gainDb!==undefined&&(!Number.isFinite(effect.gainDb)||effect.gainDb< -48||
      effect.gainDb>(ambience?-12:0)))fail("invalid sound gain range");
    for(const key of ["fadeInMs","fadeOutMs"])if(effect[key]!==undefined&&
      (!Number.isSafeInteger(effect[key])||effect[key]<0||effect[key]>(ambience?5000:2000)))
      fail("invalid sound fade range");
    const sample=timeline.eventSamples[effect.eventId]+offset*48;
    if(!Number.isSafeInteger(sample)||sample>=timeline.totalSamples||sample<0)
      fail("sound offset starts outside measured movie duration");
    if(ambience&&sample!==0)fail("ambience must start at the beginning of the movie");
    sfxCueSamples[effect.id]=sample;
  }

  // Avoid overwriting a different master, even if the caller points at an existing directory.
  for (const path of [voiceStemPath, wavPath, srtPath]) {
    if (await stat(path).then(() => true, (error) => error.code !== "ENOENT")) fail(`output already exists: ${path}`);
  }
  await mkdir(dir, { recursive: true });
  await saveVoiceStem(beats, timeline, voiceStemPath);
  const captions = Object.fromEntries(beats.map((beat) => [beat.id, beat.text]));
  const srtText = writeSrt(timeline, captions);
  await writeFile(srtPath, srtText, { flag: "wx" });

  for (const [index, effect] of sfx.entries()) {
    let path;
    if (effect.licenseStatus === "test-only") {
      path = join(dir, `sfx-${index}.wav`);
      await writeFile(path, effect.assetRef === "self-authored-test-soft-tick" ? makeTestSoftTick() : makeTestRevealChime(), { flag: "wx" });
    } else {
      path = effect.assetPath;
      const bytes = await readFile(path);
      readPcmData(bytes); // format check, not a license inference
      if(effect.assetSha256&&hash(bytes)!==effect.assetSha256)
        fail(`reviewed SFX checksum changed for ${effect.id}; inspect and reapprove the local sound`);
      // Mix exactly the checked bytes, even if the bank file changes later.
      path=join(dir,`sfx-${index}-reviewed.wav`);
      await writeFile(path,bytes,{flag:"wx"});
    }
    inputPaths.push(path);
    clipSamples.push(readPcmData(await readFile(path)).length/2);
  }

  const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-n", "-i", voiceStemPath];
  for (const path of inputPaths) args.push("-i", path);
  const filters = [];
  // Duck only sustained beds. Keep the voice untouched, and give each bed a
  // separate sidechain copy so SFX transient hits remain as authored.
  if(ambienceCount)filters.push(`[0:a]asplit=${ambienceCount+1}[voice]${Array.from(
    {length:ambienceCount},(_,i)=>`[voice-side-${i}]`).join("")}`);
  const lanes = [ambienceCount?"[voice]":"[0:a]"];
  let ambienceIndex=0;
  for (const [index, effect] of sfx.entries()) {
    const start=sfxCueSamples[effect.id],ambience=effect.kind==="ambience";
    const usable=ambience?timeline.totalSamples:Math.min(clipSamples[index],timeline.totalSamples-start);
    const clipDuration=usable/SAMPLE_RATE;
    let fadeIn=(effect.fadeInMs??0)/1000,fadeOut=(effect.fadeOutMs??0)/1000;
    if(fadeIn+fadeOut>clipDuration){const factor=clipDuration/(fadeIn+fadeOut);
      fadeIn*=factor;fadeOut*=factor;}
    const filtersForClip=[];
    if(ambience)filtersForClip.push(`aloop=loop=-1:size=${clipSamples[index]}`);
    filtersForClip.push(`atrim=end_sample=${usable}`);
    filtersForClip.push(effect.gainDb===undefined?"volume=0.12":`volume=${effect.gainDb}dB`);
    if(fadeIn>0)filtersForClip.push(`afade=t=in:st=0:d=${fadeIn}`);
    if(fadeOut>0)filtersForClip.push(`afade=t=out:st=${Math.max(0,clipDuration-fadeOut)}:d=${fadeOut}`);
    // FFmpeg's S suffix means exact audio samples, not milliseconds.
    filtersForClip.push(`adelay=${start}S${ambience?",asetpts=N/SR/TB":""}`+
      `[${ambience?`bed-${index}`:`s${index}`}]`);
    filters.push(`[${index+1}:a]${filtersForClip.join(",")}`);
    if(ambience){
      // The real voice waveform (not an estimated section boundary) drives
      // smooth, short attenuation. It releases during genuine speech pauses.
      filters.push(`[bed-${index}][voice-side-${ambienceIndex++}]`+
        `sidechaincompress=threshold=${NARRATION_DUCKING.threshold}:ratio=${NARRATION_DUCKING.ratio}`+
        `:attack=${NARRATION_DUCKING.attackMs}:release=${NARRATION_DUCKING.releaseMs}:mix=1[s${index}]`);
    }
    lanes.push(`[s${index}]`);
  }
  const mixed = lanes.length === 1 ? lanes[0] : `${lanes.join("")}amix=inputs=${lanes.length}:duration=longest:normalize=0`;
  // Sidechain and loudness filters may negotiate internally at 192 kHz.
  // Convert back to the measured 48 kHz sample domain *before* sample trims.
  filters.push(`${mixed}${lanes.length === 1 ? "" : ","}aresample=48000,atrim=end_sample=${timeline.totalSamples},alimiter=limit=0.84:latency=1,loudnorm=I=-16:TP=-1.5:LRA=11:linear=false,aresample=48000,atrim=end_sample=${timeline.totalSamples},asetpts=N/SR/TB[m]`);
  args.push("-filter_complex", filters.join(";"), "-map", "[m]", "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", wavPath);
  await mediaExec(ffmpeg, args, { signal: config.signal });
  const measured = await probeNormalizedWav(wavPath, { ffprobe, signal: config.signal });
  if (Math.abs(measured.samples - timeline.totalSamples) > 1) fail(`master sample count drift: expected ${timeline.totalSamples}, got ${measured.samples}`);
  const loudness = await analyzeLoudness(wavPath, { ffmpeg, signal: config.signal });
  return {
    wavPath, voiceStemPath, srtPath, srtText,
    samples: measured.samples, loudness, sfxCueSamples: { ...sfxCueSamples },
    ducking:ambienceCount?{mode:"voice-sidechain",beds:ambienceCount,...NARRATION_DUCKING}:null,
    stems: { voice: voiceStemPath, effects: inputPaths }, findings: rightsFindings,
  };
}
