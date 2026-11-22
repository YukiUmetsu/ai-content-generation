/** Voice runs: a spoken line split by script, so each part is read by a voice of its own language
 * ("Do you know how to write the kanji" in an English voice, "つき?" in a Japanese one), and the
 * runs' takes joined back into one take on the exact sample timeline. Provider-neutral.
 */
import { SAMPLE_RATE } from "./narration-clips.mjs";

const fail = (message) => { throw new Error(`Voice runs: ${message}`); };
// Kana, kanji (with the iteration marks), Japanese punctuation and full-width forms.
const JAPANESE = /[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/u;
const LETTER = /[\p{L}\p{N}]/u;
const primary = (locale) => String(locale).toLowerCase().split("-")[0];

/**
 * The runs of a line, in order: `{ text, locale }`. Japanese script is "ja"; other letters and
 * digits take the line's own locale, or `other` (default "en") when the line is Japanese. Spaces
 * and punctuation stay with the run before them (at the start, with the run after), except that a
 * Japanese run of a split line drops ASCII punctuation at its ends: it belongs to the other
 * language's sentence ("…the kanji つき?" reads "つき", whose question mark made a Japanese voice
 * say すき). Japanese punctuation (、。？) stays. A line in one script is one run, unchanged.
 */
export function scriptRuns(text, lineLocale, { other = "en" } = {}) {
  const latin = primary(lineLocale) === "ja" ? other : lineLocale;
  const runs = [];
  let pending = "";
  for (const ch of text) {
    const locale = JAPANESE.test(ch) ? "ja" : LETTER.test(ch) ? latin : null;
    if (locale === null) { if (runs.length) runs[runs.length - 1].text += ch; else pending += ch; continue; }
    const last = runs[runs.length - 1];
    if (last && last.locale === locale) last.text += ch;
    else runs.push({ text: pending + ch, locale });
    pending = "";
  }
  if (!runs.length) return [{ text, locale: lineLocale }];
  if (runs.length === 1) return [{ text, locale: runs[0].locale }];
  const ascii = /^[\s!-/:-@[-`{-~]+|[\s!-/:-@[-`{-~]+$/gu;
  return runs.map(run => ({ text: run.locale === "ja" ? run.text.replace(ascii, "") : run.text.trim(), locale: run.locale })).filter(run => run.text);
}

/** The voice for a locale: `voiceIds` by primary language (ja, en…), else the default voice. */
export const voiceFor = (locale, voiceIds, fallback) => voiceIds?.[primary(locale)] ?? fallback;

/**
 * One take from the trimmed takes of a line's runs (`trimSpeech` results), with `gap` seconds of
 * extra silence between runs (whole milliseconds). Returns the joined `clip`, its `lead` and
 * `speech` (from the first run's speech to the last run's end), and `starts`: when each run's
 * speech starts, in seconds from the joined speech's start.
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
  return { clip, lead, speech, starts: starts.map(s => s - lead) };
}

/**
 * Where in a joined line a share of its text falls, as a share of its speech: the start of the
 * run that holds that character (for example the name a host pulses as it is spoken).
 */
export function runShare(runs, starts, speech, textShare, text) {
  const index = Math.min(text.length - 1, Math.max(0, Math.round(textShare * text.length)));
  let seen = 0, k = 0;
  // Runs keep the line's characters in order; find the run whose text covers the index.
  for (let i = 0; i < runs.length; i++) {
    const at = text.indexOf(runs[i].text, seen);
    if (at < 0) break;
    if (index >= at) k = i;
    seen = at + runs[i].text.length;
  }
  return speech > 0 ? Math.min(1, Math.max(0, starts[k] / speech)) : 0;
}
