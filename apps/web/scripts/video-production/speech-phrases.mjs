/** Where each spoken phrase falls inside a scene's narration.
 * Speech rate gives a first estimate from text length. Real pauses in the audio then correct it,
 * so timing is measured for any voice, with no provider word timestamps required.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { spokenSentences } from "./audience-copy.mjs";

const exec = promisify(execFile);
/** A sentence this long is split at a clause when it can be. */
const LONG_SENTENCE = 46;
const MIN_PHRASE = 14;
const CLAUSE = /(?:[,;:、，；：]\s*)|(?:\s+(?=(?:and|but|so|because|which|while|then|or|until)\s))/iu;

/** Split narration into phrases short enough for one visible change each. */
export function speechPhrases(narration) {
  const phrases = [];
  for (const sentence of spokenSentences(narration)) {
    if (sentence.length <= LONG_SENTENCE) { phrases.push(sentence); continue; }
    const parts = [];
    let rest = sentence;
    while (rest.length > LONG_SENTENCE) {
      const cuts = [...rest.matchAll(new RegExp(CLAUSE, "giu"))].map(match => match.index + match[0].length)
        .filter(at => at >= MIN_PHRASE && rest.length - at >= MIN_PHRASE);
      if (!cuts.length) break;
      const at = cuts.reduce((best, cut) => (Math.abs(cut - rest.length / 2) < Math.abs(best - rest.length / 2) ? cut : best), cuts[0]);
      parts.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    phrases.push(...parts, rest);
  }
  return phrases;
}

/** Pause ranges in seconds, from FFmpeg's silence detector. */
export async function detectPauses(wavPath, { ffmpeg = "ffmpeg", noiseDb = -35, minSeconds = .11, signal, run = exec } = {}) {
  const { stderr } = await run(ffmpeg, ["-hide_banner", "-nostdin", "-i", wavPath, "-af", `silencedetect=noise=${noiseDb}dB:d=${minSeconds}`, "-f", "null", "-"],
    { maxBuffer: 1 << 22, timeout: 60000, signal });
  const pauses = [];
  let start = null;
  for (const line of String(stderr).split("\n")) {
    const opened = /silence_start:\s*(-?[\d.]+)/u.exec(line), closed = /silence_end:\s*([\d.]+)/u.exec(line);
    if (opened) start = Math.max(0, Number(opened[1]));
    if (closed && start !== null) { pauses.push({ start, end: Number(closed[1]) }); start = null; }
  }
  return pauses;
}

/** Frame windows for phrases, contiguous over `frames`. Pure, so timing can be tested without audio.
 * @param {{phrases:string[],frames:number,fps:{num:number,den:number},spokenSeconds?:number,pauses?:{start:number,end:number}[],snapSeconds?:number,minPhraseSeconds?:number}} input
 */
export function phraseWindows({ phrases, frames, fps, spokenSeconds, pauses = [], snapSeconds = .7, minPhraseSeconds = .7 }) {
  if (!phrases.length) throw Error("A scene needs at least one spoken phrase.");
  const frameRate = fps.num / fps.den;
  const total = spokenSeconds ?? frames / frameRate;
  const weights = phrases.map(phrase => Math.max(4, phrase.length));
  const weightSum = weights.reduce((sum, value) => sum + value, 0);
  const boundaries = [];
  let elapsed = 0;
  for (const weight of weights.slice(0, -1)) {
    elapsed += weight / weightSum * total;
    const near = pauses.map(pause => (pause.start + pause.end) / 2).filter(at => Math.abs(at - elapsed) <= snapSeconds);
    const snapped = near.length ? near.reduce((best, at) => (Math.abs(at - elapsed) < Math.abs(best - elapsed) ? at : best), near[0]) : elapsed;
    boundaries.push(snapped);
    elapsed = snapped;
  }
  const shortest = Math.max(1, Math.round(minPhraseSeconds * frameRate));
  const windows = [];
  let previous = 0, waiting = "";
  phrases.forEach((text, index) => {
    const last = index === phrases.length - 1;
    const end = last ? frames : Math.min(frames, Math.max(previous, Math.round(boundaries[index] * frameRate)));
    const words = waiting ? `${waiting} ${text}` : text;
    // A phrase too short to show a change joins the next one.
    if (!last && end - previous < shortest) { waiting = words; return; }
    if (last && end - previous < shortest && windows.length) {
      const before = windows[windows.length - 1];
      windows[windows.length - 1] = { ...before, text: `${before.text} ${words}`, endFrame: frames };
      return;
    }
    windows.push({ text: words, startFrame: previous, endFrame: end });
    previous = end;
    waiting = "";
  });
  return windows;
}
