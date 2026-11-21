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
