/** Conservative, offline readability heuristics for measured beat-level captions.
 *
 * These checks do not modify captions, claim word alignment, or substitute for
 * visual inspection. Warnings identify review risks, not exact browser bounds.
 */
const SAMPLE_RATE = 48000;
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const latinWord = /[\p{Script=Latin}\p{Number}]+(?:['’][\p{Script=Latin}\p{Number}]+)*/gu;
const wideScript = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}]/u;
const emoji = /\p{Extended_Pictographic}/u;
const isInteger = (value) => Number.isSafeInteger(value);

export const CAPTION_READABILITY_PROFILES = Object.freeze({
  short: Object.freeze({
    maxLines: 2, maxDisplayUnitsPerLine: 30,
    maxDisplayUnitsPerSecond: 15, maxLatinWordsPerMinute: 200,
  }),
  long: Object.freeze({
    maxLines: 2, maxDisplayUnitsPerLine: 42,
    maxDisplayUnitsPerSecond: 18, maxLatinWordsPerMinute: 220,
  }),
});

function displayUnitsFor(grapheme) {
  if (/^\s+$/u.test(grapheme)) return 0.5;
  if (wideScript.test(grapheme) || emoji.test(grapheme)) return 2;
  if (/^[\p{Script=Latin}\p{Number}]$/u.test(grapheme)) return 1;
  if (/^[\u0021-\u007e]$/u.test(grapheme)) return 0.8;
  return 1.5; // Conservative for unknown scripts and glyph combinations.
}

function countGraphemesAndUnits(text) {
  let graphemes = 0;
  let displayUnits = 0;
  let latinGraphemes = 0;
  for (const { segment } of graphemeSegmenter.segment(text)) {
    graphemes += 1;
    displayUnits += displayUnitsFor(segment);
    if (/\p{Script=Latin}/u.test(segment)) latinGraphemes += 1;
  }
  return { graphemes, displayUnits: Math.round(displayUnits * 10) / 10, latinGraphemes };
}

function findProfile(name) {
  if (typeof name !== "string" || !Object.hasOwn(CAPTION_READABILITY_PROFILES, name)) {
    throw new Error("Caption readability profile must be short or long");
  }
  return CAPTION_READABILITY_PROFILES[name];
}

function validateTimeline(timeline) {
  if (!timeline || timeline.sampleRate !== SAMPLE_RATE || !Array.isArray(timeline.beats) || timeline.beats.length === 0) {
    throw new Error("Caption readability requires a 48 kHz measured beat timeline");
  }
  const seen = new Set();
  let previousEnd = 0;
  for (const beat of timeline.beats) {
    if (!beat || typeof beat.id !== "string" || !beat.id.trim()) throw new Error("Caption beat ID is required");
    if (seen.has(beat.id)) throw new Error(`Duplicate caption beat ID: ${beat.id}`);
    seen.add(beat.id);
    if (!isInteger(beat.startSample) || !isInteger(beat.endSample) ||
        beat.startSample < previousEnd || beat.endSample <= beat.startSample) {
      throw new Error(`Invalid caption sample range for beat ${beat.id}`);
    }
    previousEnd = beat.endSample;
  }
}

/**
 * @param {object} timeline - `buildSampleTimeline` output, with measured samples.
 * @param {Record<string,string>} captions - Full, unmodified text keyed by beat ID.
 * @param {{profile?: 'short'|'long'}} options
 * @returns {{ok:boolean,profile:object,findings:object[],beats:object[]}}
 */
export function analyzeCaptionReadability(timeline, captions, { profile = "long" } = {}) {
  const limits = findProfile(profile);
  validateTimeline(timeline);
  if (!captions || typeof captions !== "object" || Array.isArray(captions)) {
    throw new Error("Caption text must be an object keyed by beat ID");
  }

  const findings = [];
  const beats = [];
  for (const beat of timeline.beats) {
    const durationSeconds = (beat.endSample - beat.startSample) / SAMPLE_RATE;
    const raw = captions[beat.id];
    if (typeof raw !== "string" || !raw.trim()) {
      findings.push({
        severity: "error", code: "caption-missing", beatId: beat.id,
        message: `Beat ${beat.id} has no caption text`,
      });
      beats.push({ beatId: beat.id, durationSeconds, text: raw ?? null, sourcePrecision: "beat" });
      continue;
    }

    // Canonicalization is only for measurements; the caller retains original text.
    const measured = raw.normalize("NFC").replace(/\s+/gu, " ").trim();
    const counts = countGraphemesAndUnits(measured);
    const latinWords = (measured.match(latinWord) ?? []).length;
    const latinWpm = counts.latinGraphemes / counts.graphemes >= 0.8
      ? Math.round((latinWords / durationSeconds) * 60) : null;
    const displayUnitsPerSecond = Math.round(counts.displayUnits / durationSeconds * 10) / 10;
    const estimatedMinimumLines = Math.ceil(counts.displayUnits / limits.maxDisplayUnitsPerLine);
    const metrics = {
      beatId: beat.id, text: raw, sourcePrecision: "beat", durationSeconds,
      graphemes: counts.graphemes, displayUnits: counts.displayUnits,
      displayUnitsPerSecond, latinWords, latinWpm, estimatedMinimumLines,
    };
    beats.push(metrics);

    if (estimatedMinimumLines > limits.maxLines) {
      findings.push({
        severity: "warning", code: "caption-display-overflow", beatId: beat.id,
        message: `Beat ${beat.id} may need more than ${limits.maxLines} readable caption lines`,
        estimatedMinimumLines,
      });
    }
    if (displayUnitsPerSecond > limits.maxDisplayUnitsPerSecond ||
        (latinWpm !== null && latinWpm > limits.maxLatinWordsPerMinute)) {
      findings.push({
        severity: "warning", code: "caption-reading-speed", beatId: beat.id,
        message: `Beat ${beat.id} may be too fast to read at ${durationSeconds.toFixed(2)} s`,
        displayUnitsPerSecond, latinWpm,
      });
    }
  }

  return {
    ok: !findings.some(({ severity }) => severity === "error"),
    profile: Object.freeze({ name: profile, ...limits }),
    findings, beats,
  };
}
