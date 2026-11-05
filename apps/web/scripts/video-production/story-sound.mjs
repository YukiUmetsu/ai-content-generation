/** Sound for what happens on stage: one short cue per visible change, placed on that change's frame.
 * Every sound is synthesized locally, so no third-party rights apply. The table is data.
 */
import { frameToSample } from "./shot-audio.mjs";

/** `priority` decides what survives when a long film has more cues than the mixer takes. */
export const STORY_CUES = Object.freeze({
  enter: { sound: "story-pop", gainDb: -21, priority: 2 },
  "set-value": { sound: "story-tick", gainDb: -22, priority: 3 },
  connect: { sound: "story-draw", gainDb: -23, priority: 3 },
  transfer: { sound: "story-whoosh", gainDb: -20, priority: 4 },
  absorb: { sound: "story-whoosh", gainDb: -20, priority: 4 },
  "measure-gap": { sound: "story-measure", gainDb: -18, priority: 5 },
  highlight: { sound: "story-glow", gainDb: -25, priority: 1 },
  check: { sound: "story-check", gainDb: -18, priority: 5 },
  cross: { sound: "story-cross", gainDb: -18, priority: 5 },
  question: { sound: "story-question", gainDb: -19, priority: 5 },
  warning: { sound: "story-cross", gainDb: -19, priority: 5 },
});

/** Two cues closer than this blur together, so the stronger one stays. */
export const MIN_CUE_SECONDS = .16;

/** Cues for one story, in order, relative to the scene's first frame. */
export function storyCues(spec, table = STORY_CUES) {
  const cues = [];
  const add = (key, frame, id) => { if (table[key]) cues.push({ ...table[key], id, frame, sample: frameToSample(frame, spec.fps) }); };
  let onStage = new Set(spec.carried?.objects ?? []);
  for (const beat of spec.beats) {
    const arrived = beat.arrangement.objects.filter(id => !onStage.has(id));
    if (arrived.length) add("enter", beat.startFrame, `${beat.id}-enter`);
    onStage = new Set(beat.arrangement.objects);
    (beat.ops ?? []).forEach((op, index) => add(op.kind === "mark" ? op.mark : op.kind, op.atFrame ?? beat.startFrame, `${beat.id}-${index}`));
  }
  return cues.sort((a, b) => a.frame - b.frame);
}

/** Keep cues apart in time, always preferring the most meaningful. */
export function thinCues(cues, { fps }) {
  const spacing = Math.ceil(MIN_CUE_SECONDS * fps.num / fps.den);
  const kept = [];
  for (const cue of [...cues].sort((a, b) => b.priority - a.priority || a.absolute - b.absolute))
    if (!kept.some(other => Math.abs(other.absolute - cue.absolute) < spacing)) kept.push(cue);
  return kept.sort((a, b) => a.absolute - b.absolute);
}

/** Mix cues into one 16-bit PCM track, so a long film can have a cue on every change.
 * @param {{sample:number,pcm:Int16Array,gainDb:number}[]} placed
 * @param {number} totalSamples
 * @returns {Int16Array}
 */
export function mixCueTrack(placed, totalSamples) {
  const mix = new Float64Array(totalSamples);
  for (const { sample, pcm, gainDb } of placed) {
    const gain = 10 ** (gainDb / 20);
    for (let index = 0; index < pcm.length && sample + index < totalSamples; index++) mix[sample + index] += pcm[index] * gain;
  }
  return Int16Array.from(mix, value => Math.max(-32768, Math.min(32767, Math.round(value))));
}
