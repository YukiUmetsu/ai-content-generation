/**
 * The takes of one recorded text of the kanji shorts (a reading, a word, a phrase): listed from the
 * cache, recorded anew, and measured, so a person can hear and choose one (narration.retakes).
 * A take is asked for exactly as the producer asks (kanjiSpeech), so the chosen take is the very
 * recording a short uses.
 */
import { readFile } from "node:fs/promises";
import { int16Wav } from "./music-bed.mjs";
import { kanjiSpeech } from "./kanji-short-producer.mjs";
import { trimSpeech } from "./narration-clips.mjs";
import { pitchContour, pitchShape } from "./narration-pitch.mjs";
import { cachedNarration, synthesizeNarration } from "./speech.mjs";

/** The highest take number (as narration.retakes allows). */
export const MAX_TAKE = 99;
const LOCALE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/u;
const fail = (message) => { throw new Error(message); };

/** A recorded text and its language, checked: what a take belongs to. */
export function takeText({ text, locale } = {}) {
  if (typeof text !== "string" || !text.trim() || text.length > 400 || /[\u0000-\u001f\u007f]/u.test(text)) fail("takes: a text of 1 to 400 characters is required");
  if (typeof locale !== "string" || !LOCALE.test(locale)) fail("takes: a language such as ja or en is required");
  return { text, locale };
}

const beatOf = (voicing, { text, locale }, take) => voicing.beat({ id: "take", text, locale, ...(take > 1 ? { take } : {}) });

/** The cached takes of a text, in order: `[{ take, wavPath, sha256 }]` (take 1 is the first recording). */
export async function kanjiTakes(config, part) {
  const { text, locale } = takeText(part);
  const voicing = kanjiSpeech(config), options = voicing.options(config.cacheDir), job = voicing.job(locale, []);
  const takes = [];
  for (let take = 1; take <= MAX_TAKE; take++) {
    const found = await cachedNarration(job, beatOf(voicing, { text, locale }, take), options);
    if (found) takes.push({ take, wavPath: found.wavPath, sha256: found.sha256 });
  }
  return takes;
}

/**
 * Record the next take of a text (one more than the highest cached, or the first). The provider's
 * own consent rules apply (kanjiSpeech: Fish needs the key and the person's consent).
 */
export async function recordKanjiTake(config, part, { apiKey, signal, synthesize = synthesizeNarration } = {}) {
  const { text, locale } = takeText(part);
  const existing = await kanjiTakes(config, { text, locale });
  const take = existing.length ? Math.max(...existing.map(t => t.take)) + 1 : 1;
  if (take > MAX_TAKE) fail(`takes: "${text}" already has ${MAX_TAKE} takes`);
  const voicing = kanjiSpeech(config, { apiKey, signal });
  const [done] = await synthesize(voicing.job(locale, [beatOf(voicing, { text, locale }, take)]), voicing.options(config.cacheDir));
  if (!done?.wavPath) fail("takes: the voice returned no recording");
  return { take, wavPath: done.wavPath, sha256: done.sha256 };
}

/**
 * A take measured: its spoken length, its pitch over time (up to 48 points, Hz or null) and its
 * shape (pitchShape: "rises" to its end like a question, "falls" after its peak, "level").
 */
export async function takeMeasure(wavPath) {
  const trimmed = trimSpeech(int16Wav(await readFile(wavPath)));
  const contour = pitchContour(trimmed.clip);
  const every = Math.max(1, Math.ceil(contour.length / 48));
  return {
    seconds: Math.round(trimmed.speech * 100) / 100,
    pitch: contour.filter((_, i) => i % every === 0).map(frame => frame.hz),
    ...pitchShape(contour),
  };
}
