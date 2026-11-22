/** Measured narration clips on an exact sample timeline: find the speech in a take, trim it, and
 * place each clip so its speech starts at a planned time. Provider- and video-neutral.
 */

export const SAMPLE_RATE = 48000;
const fail = (message) => { throw new Error(`Narration clips: ${message}`); };

/**
 * Where the speech in a mono 16-bit take starts and ends: a 10 ms RMS envelope above `floorDb` of
 * the take's own peak level. Returns sample indices, or null for a take with no speech.
 * @param {Int16Array} samples
 */
export function speechBounds(samples, { sampleRate = SAMPLE_RATE, floorDb = -42 } = {}) {
  const win = Math.max(1, Math.round(sampleRate * .01));
  const env = new Float64Array(samples.length);
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
    if (i >= win) sum -= samples[i - win] * samples[i - win];
    env[i] = Math.sqrt(Math.max(0, sum) / Math.min(i + 1, win));
  }
  let peak = 0;
  for (const v of env) if (v > peak) peak = v;
  if (peak < 1) return null;
  const floor = peak * 10 ** (floorDb / 20);
  let a = -1, b = -1;
  for (let i = 0; i < env.length; i++) if (env[i] > floor) { if (a < 0) a = i; b = i; }
  // The envelope trails its window: the speech starts one window earlier than its first loud value.
  return { start: Math.max(0, a - win), end: b };
}

const envelope = (samples, sampleRate) => {
  const win = Math.max(1, Math.round(sampleRate * .01)), frames = Math.floor(samples.length / win);
  const level = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * win; i < (f + 1) * win; i++) sum += samples[i] * samples[i];
    level[f] = Math.sqrt(sum / win);
  }
  return { win, level, peak: level.reduce((a, b) => Math.max(a, b), 0) };
};

/**
 * The pauses inside a take's speech: stretches of at least `minPause` seconds where the 10 ms RMS
 * envelope stays `pauseDb` below the take's peak, between its first and last speech. Sample
 * indices `{ start, end }`, in order. A comma's breath is a pause; so can be the closure of a
 * consonant inside a word, which is why a caller picks pauses by length (see `lastPhrase`).
 * @param {Int16Array} samples
 */
export function speechPauses(samples, { sampleRate = SAMPLE_RATE, pauseDb = -30, minPause = .06 } = {}) {
  const { win, level, peak } = envelope(samples, sampleRate);
  if (peak < 1) return [];
  const floor = peak * 10 ** (pauseDb / 20), need = Math.max(1, Math.round(minPause / .01));
  const pauses = [];
  let seen = false, quiet = -1;
  for (let f = 0; f < level.length; f++) {
    if (level[f] > floor) {
      if (seen && quiet >= 0 && f - quiet >= need) pauses.push({ start: quiet * win, end: f * win });
      seen = true; quiet = -1;
    } else if (seen && quiet < 0) quiet = f;
  }
  return pauses;
}

/**
 * The phrases of a take: its speech split at pauses of at least `minPause` seconds (default
 * 0.12 s). Sample indices `{ start, end }`, in order; empty for a take with no speech.
 * @param {Int16Array} samples
 */
export function speechPhrases(samples, { sampleRate = SAMPLE_RATE, pauseDb = -30, minPause = .12 } = {}) {
  const { win, level, peak } = envelope(samples, sampleRate);
  if (peak < 1) return [];
  const floor = peak * 10 ** (pauseDb / 20);
  let first = -1, last = -1;
  for (let f = 0; f < level.length; f++) if (level[f] > floor) { if (first < 0) first = f; last = f; }
  const cuts = speechPauses(samples, { sampleRate, pauseDb, minPause });
  const bounds = [first * win, ...cuts.flatMap(p => [p.start, p.end]), (last + 1) * win];
  return Array.from({ length: bounds.length / 2 }, (_, i) => ({ start: bounds[2 * i], end: bounds[2 * i + 1] }));
}

/**
 * The samples of a take's last phrase, for example "ひと" out of "くんよみ、ひと。", to reuse that
 * natural reading elsewhere. `pauses` is how many phrase breaks the text has (its commas): the
 * longest that many pauses are the breaks, so a consonant's closure inside a word is not one. The
 * phrase starts where the sound before it falls 50 dB under the take's peak (a soft "h" or "s"
 * included), never before the middle of its pause, and runs to the end of the take. Null when the take has fewer pauses, or the last phrase is shorter than
 * 0.12 s or never comes within 20 dB of the take's peak (a click or a breath, not a word).
 * @param {Int16Array} samples
 */
export function lastPhrase(samples, { pauses = 1, sampleRate = SAMPLE_RATE, pauseDb = -30 } = {}) {
  const found = speechPauses(samples, { sampleRate, pauseDb });
  if (pauses < 1 || found.length < pauses) return null;
  const breaks = [...found].sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, pauses);
  const brk = breaks.reduce((a, b) => b.start > a.start ? b : a);
  const tail = samples.subarray(brk.end);
  const { peak } = envelope(samples, sampleRate), tailEnv = envelope(tail, sampleRate);
  if (tailEnv.peak < peak * 10 ** (-20 / 20)) return null;
  let speech = 0;
  for (const v of tailEnv.level) if (v > peak * 10 ** (pauseDb / 20)) speech++;
  if (speech * .01 < .12) return null;
  // Walk back from the speech to true quiet, so a breathy start is kept whole.
  const env = envelope(samples, sampleRate), quiet = peak * 10 ** (-50 / 20), mid = Math.round((brk.start + brk.end) / 2);
  let frame = Math.floor(brk.end / env.win) - 1;
  while (frame > 0 && frame * env.win > mid && env.level[frame] > quiet) frame--;
  return samples.slice(Math.max(mid, (frame - 1) * env.win));
}

/** How much silence a trimmed clip keeps around its speech, and its fades, seconds. */
export const TRIM_DEFAULTS = Object.freeze({ preRoll: .03, postRoll: .08, fade: .012 });

/**
 * The smallest gap between two lines' speech and the earliest start of the first, so clips trimmed
 * with these settings never overlap or start before 0 (plus a 10 ms margin for millisecond rounding).
 */
export const clipPlacementFloor = ({ preRoll = TRIM_DEFAULTS.preRoll, postRoll = TRIM_DEFAULTS.postRoll } = {}) =>
  ({ minGap: preRoll + postRoll + .01, minStart: preRoll + .01 });

/**
 * The trimmed clip of a take: `preRoll` before the speech and `postRoll` after it, faded over
 * `fade` seconds, padded to a whole number of milliseconds so the sample timeline stays exact.
 * `lead` is the time from the clip's start to the speech, `speech` the speech's length (seconds).
 * @param {Int16Array} samples
 */
export function trimSpeech(samples, { sampleRate = SAMPLE_RATE, preRoll = TRIM_DEFAULTS.preRoll, postRoll = TRIM_DEFAULTS.postRoll, fade = TRIM_DEFAULTS.fade } = {}) {
  const bounds = speechBounds(samples, { sampleRate });
  if (!bounds) fail("a narration take has no speech");
  const pre = Math.round(preRoll * sampleRate), post = Math.round(postRoll * sampleRate), fadeSamples = Math.max(1, Math.round(fade * sampleRate));
  const a = Math.max(0, bounds.start - pre), b = Math.min(samples.length, bounds.end + post);
  const ms = sampleRate / 1000;
  const length = Math.ceil((b - a) / ms) * ms;
  const clip = new Int16Array(length);
  for (let i = 0; i < b - a; i++) {
    const gain = Math.min(1, i / fadeSamples, (b - a - 1 - i) / fadeSamples);
    clip[i] = Math.round(samples[a + i] * Math.max(0, gain));
  }
  return { clip, lead: (bounds.start - a) / sampleRate, speech: (bounds.end - bounds.start) / sampleRate };
}

/**
 * Clips as beats of ContentGen's sample timeline (`buildSampleTimeline`): each clip placed so its
 * speech starts at its onset. Pauses are whole milliseconds; the first beat carries the silence
 * before it, and the last pause ends the audio exactly at `totalSamples`.
 * @param {{id:string,clip:Int16Array,lead:number}[]} takes in spoken order
 * @param {Record<string, number>} onsets seconds
 */
export function placeClips(takes, onsets, totalSamples, { sampleRate = SAMPLE_RATE } = {}) {
  const ms = sampleRate / 1000;
  if (!takes.length) fail("at least one clip is required");
  const beats = [];
  let cursor = 0;
  takes.forEach((take, i) => {
    const at = onsets[take.id];
    if (!Number.isFinite(at)) fail(`line ${take.id} has no onset`);
    if (take.clip.length % ms) fail(`clip ${take.id} is not a whole number of milliseconds`);
    const start = Math.round((at - take.lead) * 1000) * ms;
    if (start < cursor || start < 0) fail(`line ${take.id} would start before ${i ? "the previous line ends" : "the video starts"}`);
    let samples = take.clip;
    if (i === 0) {
      samples = new Int16Array(start + take.clip.length);
      samples.set(take.clip, start);
    } else beats.at(-1).pauseAfterMs = (start - cursor) / ms;
    beats.push({ id: take.id, samples, pauseAfterMs: 0 });
    cursor = i === 0 ? samples.length : start + samples.length;
  });
  if (cursor > totalSamples) fail("the narration runs past the end of the video");
  if ((totalSamples - cursor) % ms) fail("the video length is not a whole number of milliseconds");
  beats.at(-1).pauseAfterMs = (totalSamples - cursor) / ms;
  return beats;
}

/** Seconds on a frame grid, so planned times and a renderer's whole-frame phases agree exactly. */
export const toFrameGrid = (seconds, fps = 30) => Math.round(seconds * fps) / fps;

/**
 * Whole frames that last at least `seconds`, rounded up to a multiple of `multiple`. With
 * `multiple` 3 at 30 fps the length is a whole number of milliseconds (and of 48 kHz samples).
 */
export const framesFor = (seconds, fps = 30, multiple = 1) => Math.ceil(seconds * fps / multiple - 1e-6) * multiple;
