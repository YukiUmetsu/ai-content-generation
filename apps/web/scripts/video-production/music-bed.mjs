/** A reviewed music bed under a voice-over: choose the window of the track with the fewest silent
 * stretches where nobody speaks, cut it, and set its level a given distance under the voice.
 * Produces the bed and the gain for `renderMasterAudio`'s ambience lane (-48..-12 dB).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { readPcmData } from "./audio.mjs";
import { measureLufs, measurePeak } from "./media-measure.mjs";

const run = promisify(execFile);
const SAMPLE_RATE = 48000;
const fail = (message) => { throw new Error(`Music bed: ${message}`); };
const round = (v, d = 1000) => Math.round(v * d) / d;

/** Mono 48 kHz 16-bit samples of a WAV file in that format. */
export const int16Wav = (bytes) => { const pcm = readPcmData(bytes); return new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2); };

/** Decodes any audio file to mono 48 kHz 16-bit WAV at `outPath`, and returns its samples. */
export async function decodeMono(inputPath, outPath, { ffmpeg = "ffmpeg", signal } = {}) {
  await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", inputPath, "-ac", "1", "-ar", String(SAMPLE_RATE), "-c:a", "pcm_s16le", outPath], { signal });
  return int16Wav(await readFile(outPath));
}

/**
 * The start of the music window of `length` seconds with the fewest near-silent stretches where no
 * voice speaks (a near-silent stretch under the voice matters less). Samples: mono 48 kHz Int16.
 * @param {Int16Array} music
 * @param {{onset:number,end:number}[]} speech seconds
 */
export function chooseMusicWindow(music, length, speech, { from = 1, step = .1 } = {}) {
  const hop = Math.round(.05 * SAMPLE_RATE), win = Math.round(.4 * SAMPLE_RATE);
  const count = Math.floor(music.length / hop);
  const db = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    const centre = k * hop, a = Math.max(0, centre - win / 2), b = Math.min(music.length, centre + win / 2);
    let sum = 0;
    for (let i = a; i < b; i++) sum += music[i] * music[i];
    db[k] = 10 * Math.log10(sum / Math.max(1, b - a) + 1e-9);
  }
  const sorted = [...db.slice(Math.round(from / .05))].sort((x, y) => x - y);
  if (!sorted.length) fail("the music is too short");
  const quiet = sorted[Math.floor(sorted.length / 2)] - 18;
  const n = Math.round(length / .05);
  const voiced = Array.from({ length: n }, (_, k) => speech.some(s => k * .05 >= s.onset - .1 && k * .05 <= s.end + .3));
  let best = null;
  for (let start = from; start * SAMPLE_RATE + length * SAMPLE_RATE <= music.length; start = round(start + step)) {
    const k0 = Math.round(start / .05);
    let run = 0, longest = 0, weighted = 0;
    for (let k = 0; k < n; k++) {
      const q = db[k0 + k] < quiet;
      run = q && !voiced[k] ? run + 1 : 0;
      longest = Math.max(longest, run);
      weighted += q ? (voiced[k] ? .25 : 1) : 0;
    }
    const score = [longest * .05, weighted / n];
    if (!best || score[0] < best.score[0] - 1e-9 || Math.abs(score[0] - best.score[0]) < 1e-9 && score[1] < best.score[1]) best = { start, score };
  }
  if (!best) fail(`the music is shorter than the video (${length.toFixed(1)} s from ${from} s)`);
  return { start: best.start, longestQuietSeconds: round(best.score[0]) };
}

/**
 * The gain for a bed so it sits `belowVoiceDb` under the voice. The ambience lane takes -48..-12 dB,
 * so a quiet bed is raised by `preGainDb` first, as far as its peak allows (to -1 dBFS).
 */
export function bedLevels({ voiceLufs, bedLufs, bedPeakDb, belowVoiceDb }) {
  const wanted = voiceLufs - belowVoiceDb - bedLufs;
  const preGainDb = wanted > -12 ? Math.max(0, round(Math.min(wanted + 12, -1 - bedPeakDb), 10)) : 0;
  const gainDb = round(Math.min(-12, Math.max(-48, wanted - preGainDb)), 10);
  return { gainDb, preGainDb, belowVoiceDb: round(voiceLufs - (bedLufs + preGainDb + gainDb), 10) };
}

/**
 * Cuts the bed of `length` seconds from `window` of the decoded track and levels it under the voice.
 * @returns {Promise<{bedPath:string,gainDb:number,preGainDb:number,belowVoiceDb:number,bedLufs:number}>}
 */
export async function prepareMusicBed({ sourceWav, musicSeconds, window, length, voiceLufs, belowVoiceDb, bedPath }, { ffmpeg = "ffmpeg", signal } = {}) {
  if (window.start + length > musicSeconds) fail(`the music ends ${(window.start + length - musicSeconds).toFixed(1)} s before the video does`);
  const cut = (extraDb) => run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-ss", String(window.start), "-t", String(length + .5), "-i", sourceWav,
    ...(extraDb ? ["-af", `volume=${extraDb}dB`] : []), "-c:a", "pcm_s16le", bedPath], { signal });
  await cut(0);
  const bedLufs = await measureLufs(bedPath, { ffmpeg, signal });
  const levels = bedLevels({ voiceLufs, bedLufs, bedPeakDb: await measurePeak(bedPath, { ffmpeg, signal }), belowVoiceDb });
  if (levels.preGainDb > 0) await cut(levels.preGainDb);
  return { bedPath, bedLufs, ...levels };
}
