/**
 * The pitch of recorded speech, measured (YIN), so a person choosing between takes can see a
 * word's pitch shape and whether it ends rising like a question. A measurement, not a judgement of
 * the right accent: the person listens and chooses. Provider-neutral, no dependencies.
 */
const STEP = 3;   // 48 kHz analysed at 16 kHz

/** The pitch every `hop` seconds: `[{ t, hz }]`, `hz` null where the sound is unvoiced or quiet. */
export function pitchContour(samples, { sampleRate = 48000, hop = .01, window = .04, min = 70, max = 400, threshold = .15, quietDb = -35 } = {}) {
  const rate = sampleRate / STEP, length = Math.floor(samples.length / STEP), x = new Float32Array(length);
  for (let i = 0; i < length; i++) { let sum = 0; for (let k = 0; k < STEP; k++) sum += samples[i * STEP + k]; x[i] = sum / STEP / 32768; }
  const size = Math.round(window * rate), step = Math.round(hop * rate), lo = Math.floor(rate / max), hi = Math.ceil(rate / min);
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  const quiet = peak * 10 ** (quietDb / 20), diff = new Float32Array(hi + 1), out = [];
  for (let start = 0; start + size + hi < length; start += step) {
    let energy = 0;
    for (let i = 0; i < size; i++) energy = Math.max(energy, Math.abs(x[start + i]));
    let hz = null;
    if (energy > quiet) {
      // YIN: the cumulative mean normalized difference, its first dip under the threshold.
      let running = 0;
      for (let lag = 1; lag <= hi; lag++) {
        let d = 0;
        for (let i = 0; i < size; i++) { const v = x[start + i] - x[start + i + lag]; d += v * v; }
        running += d; diff[lag] = running ? d * lag / running : 1;
      }
      for (let lag = lo; lag <= hi; lag++) if (diff[lag] < threshold) {
        while (lag + 1 <= hi && diff[lag + 1] < diff[lag]) lag++;
        const a = diff[lag - 1] ?? diff[lag], b = diff[lag], c = diff[lag + 1] ?? diff[lag], shift = (a - c) / (2 * (a - 2 * b + c) || 1);
        hz = rate / (lag + (Number.isFinite(shift) ? Math.max(-1, Math.min(1, shift)) : 0));
        break;
      }
    }
    out.push({ t: Math.round((start / rate + window / 2) * 1000) / 1000, hz: hz && Math.round(hz * 10) / 10 });
  }
  return out;
}

const median = (values) => { const v = [...values].sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
const semitones = (from, to) => Math.round(12 * Math.log2(to / from) * 10) / 10;

/**
 * The shape of a short take's pitch (a word or a phrase), over its voiced frames:
 * - `rise`: from its start to its end (the median of the first and of the last quarter), in semitones;
 * - `fall`: from its peak to its end (0 or less);
 * - `shape`: "rises" when the pitch climbs to its end like a question (the peak in the last quarter
 *   and a rise above 1 semitone), "falls" when it ends more than 1 semitone below its peak (今: い high,
 *   ま low), else "level"; null when too little is voiced to tell (a devoiced し).
 * A frame more than 6 semitones off its neighbours (a creak, an octave slip) is left out.
 */
export function pitchShape(contour) {
  const hz = contour.map(frame => frame.hz).filter(Boolean);
  const kept = hz.filter((value, i) => {
    const near = median(hz.slice(Math.max(0, i - 2), i + 3));
    return Math.abs(12 * Math.log2(value / near)) <= 6;
  });
  if (kept.length < 8) return { shape: null, rise: null, fall: null };
  const smooth = kept.map((_, i) => median(kept.slice(Math.max(0, i - 1), i + 2)));
  const quarter = Math.max(2, Math.floor(kept.length / 4));
  const start = median(kept.slice(0, quarter)), end = median(kept.slice(-quarter));
  const peak = Math.max(...smooth), at = smooth.lastIndexOf(peak) / (smooth.length - 1);
  const rise = semitones(start, end), fall = Math.min(0, semitones(peak, end));
  return { shape: at >= .75 && rise > 1 ? "rises" : fall < -1 ? "falls" : "level", rise, fall };
}
