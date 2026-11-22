/** Voice runs: a spoken line split by script, so each part is read by a voice of its own language
 * ("Do you know how to write the kanji" in an English voice, "つき?" in a Japanese one), and the
 * runs' takes joined back into one take on the exact sample timeline. Provider-neutral.
 */
import { SAMPLE_RATE } from "./narration-clips.mjs";

const fail = (message) => { throw new Error(`Voice runs: ${message}`); };
// Japanese script by Unicode script (kanji beyond the basic plane too, such as 𠮟), plus Japanese
// punctuation, the long-vowel mark and full-width forms.
const JAPANESE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303f\u30fc\uff00-\uffef]/u;
const LETTER = /\p{L}/u;
const DIGIT = /\p{N}/u;
const ASCII_PUNCT = /[!-/:-@[-`{-~]/gu;
const primary = (locale) => String(locale).toLowerCase().split("-")[0];

/**
 * The runs of a line, in order: `{ text, locale, from, to }` (`from`/`to`: where the run lies in
 * the line's text, in UTF-16 units, before any cleaning). Japanese script is "ja"; other letters take
 * the line's own locale, or `other` (default "en") when the line is Japanese.
 * - Digits go with the text they touch: "12月" stays one Japanese run, "1画目" too; on their own
 *   they follow the run before them, or the line's language.
 * - Spaces and punctuation stay with the run before them (at the start, with the run after).
 * - A Japanese run in a line of another language reads no ASCII punctuation: it belongs to that
 *   language's sentence ("…the kanji つき?" reads "つき"; a lone "つき?" came out as すき).
 *   Japanese punctuation (、。？) stays.
 * - A line in one script is one run with its text unchanged, read in that script's language.
 */
export function scriptRuns(text, lineLocale, { other = "en" } = {}) {
  const japaneseLine = primary(lineLocale) === "ja";
  const latin = japaneseLine ? other : lineLocale;
  const chars = [...text];
  const kind = chars.map(ch => JAPANESE.test(ch) ? "ja" : LETTER.test(ch) ? latin : DIGIT.test(ch) ? "digit" : null);
  // A digit takes the language of the letter it touches after it, else of the one before it.
  for (let i = 0; i < chars.length; i++) if (kind[i] === "digit") {
    let j = i; while (j < chars.length && kind[j] === "digit") j++;
    let k = i - 1; while (k >= 0 && kind[k] === null) k--;
    const fill = j < chars.length && kind[j] !== null ? kind[j] : k >= 0 ? kind[k] : japaneseLine ? "ja" : latin;
    for (let d = i; d < j; d++) kind[d] = fill;
    i = j - 1;
  }
  const runs = [];
  let pending = "", offset = 0;
  chars.forEach((ch, i) => {
    const locale = kind[i], end = offset + ch.length;
    if (locale === null) {
      if (runs.length) { runs[runs.length - 1].text += ch; runs[runs.length - 1].to = end; } else pending += ch;
    } else {
      const last = runs[runs.length - 1];
      if (last && last.locale === locale) { last.text += ch; last.to = end; }
      else { runs.push({ text: pending + ch, locale, from: offset - pending.length, to: end }); pending = ""; }
    }
    offset = end;
  });
  if (!runs.length) return [{ text, locale: lineLocale, from: 0, to: text.length }];
  // A run of another language before a Japanese one does not end on an opening quote or bracket ("It's 'つき'").
  const clean = (run, i) => run.locale === "ja" && !japaneseLine
    ? run.text.replace(ASCII_PUNCT, " ").replace(/\s+/gu, " ").trim()
    : (runs[i + 1] ? run.text.replace(/[\s'"([{]+$/u, "") : run.text).trim();
  if (runs.length === 1) return [{ text: runs[0].locale === "ja" && !japaneseLine ? clean(runs[0], 0) || text : text, locale: runs[0].locale, from: 0, to: text.length }];
  return runs.map((run, i) => ({ text: clean(run, i), locale: run.locale, from: run.from, to: run.to })).filter(run => run.text);
}

/** The voice for a locale: `voiceIds` by primary language (ja, en…), else the default voice. */
export const voiceFor = (locale, voiceIds, fallback) => voiceIds?.[primary(locale)] ?? fallback;

/**
 * One take from the trimmed takes of a line's runs (`trimSpeech` results), with `gap` seconds of
 * extra silence between runs (whole milliseconds). Returns the joined `clip`, its `lead` and
 * `speech` (from the first run's speech to the last run's end), `starts`: when each run's speech
 * starts, in seconds from the joined speech's start, and `durations`: each run's speech.
 */
export function joinRunTakes(takes, { gap = .04, sampleRate = SAMPLE_RATE } = {}) {
  if (!takes.length) fail("a line needs at least one run");
  const ms = sampleRate / 1000, pause = Math.round(gap * 1000) * ms;
  const length = takes.reduce((n, t, i) => n + t.clip.length + (i ? pause : 0), 0);
  const clip = new Int16Array(length), starts = [];
  let at = 0;
  takes.forEach((take, i) => {
    if (take.clip.length % ms) fail(`run ${i + 1} is not a whole number of milliseconds`);
    if (i) at += pause;
    clip.set(take.clip, at);
    starts.push(at / sampleRate + take.lead);
    at += take.clip.length;
  });
  const lead = takes[0].lead, last = takes[takes.length - 1];
  const speech = starts[starts.length - 1] + last.speech - lead;
  return { clip, lead, speech, starts: starts.map(s => s - lead), durations: takes.map(t => t.speech) };
}

/**
 * Where in a joined line a share of its text falls, as a share of its speech: inside the run that
 * holds that character, at the same share of that run's speech (the start of the run for its first
 * character, for example the name a host pulses as it is spoken).
 */
export function runShare(runs, starts, speech, textShare, text, durations = []) {
  const index = Math.min(text.length - 1, Math.max(0, Math.round(textShare * text.length)));
  // Each run knows where it lies in the line (`from`, `to`), also after its punctuation was dropped.
  let k = 0;
  runs.forEach((run, i) => { if (index >= run.from) k = i; });
  const run = runs[k], within = Math.min(1, Math.max(0, (index - run.from) / Math.max(1, run.to - run.from)));
  const t = starts[k] + within * (durations[k] ?? 0);
  return speech > 0 ? Math.min(1, Math.max(0, t / speech)) : 0;
}
