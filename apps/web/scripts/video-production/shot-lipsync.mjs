/** Mouth shapes from the real voice audio, using the optional Rhubarb tool.
 * Rhubarb is English-first and estimates shapes. Callers must report the source they got.
 */
import { execFile } from "node:child_process";
import { access, readFile, rename } from "node:fs/promises";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** Rhubarb shape to rig viseme, best match first. X is rest, so it adds no cue. */
const SHAPE_VISEMES = Object.freeze({
  A: ["M", "closed", "P", "B"], B: ["E", "I", "A"], C: ["E", "A", "open"], D: ["A", "wide", "open"],
  E: ["O", "round", "A"], F: ["U", "O", "round"], G: ["I", "E", "A"], H: ["A", "open"],
});

export function visemeFor(shape, rigVisemes) {
  return (SHAPE_VISEMES[shape] ?? []).find(name => rigVisemes.includes(name)) ?? null;
}

/** Frame-timed viseme cues for one line. Unknown shapes are dropped, and silence closes the mouth. */
export function visemeCues(mouthCues, window, fps, rigVisemes) {
  const rate = fps.num / fps.den;
  const cues = [];
  for (const cue of mouthCues) {
    const viseme = visemeFor(cue.value, rigVisemes);
    if (!viseme) continue;
    const startFrame = window.startFrame + Math.round(cue.start * rate);
    const endFrame = Math.min(window.endFrame, window.startFrame + Math.round(cue.end * rate));
    if (endFrame > startFrame) cues.push({ startFrame, endFrame, viseme });
  }
  return cues;
}

/** Cached per audio file. Returns null when the tool is absent, so the caller can report it. */
export async function mouthCuesFor(wavPath, { rhubarb = process.env.CONTENTGEN_RHUBARB, signal } = {}) {
  if (!rhubarb) return null;
  const output = `${wavPath}.mouth.json`;
  if (await access(output).then(() => false, () => true)) {
    await exec(rhubarb, ["--quiet", "--exportFormat", "json", "--output", `${output}.tmp`, wavPath], { signal, timeout: 120000 });
    await rename(`${output}.tmp`, output);
  }
  return JSON.parse(await readFile(output, "utf8")).mouthCues;
}
