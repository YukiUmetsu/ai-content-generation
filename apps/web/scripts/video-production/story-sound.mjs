/** Sound for what happens on stage: one short cue per visible change, placed on that change's frame.
 * Every sound is synthesized locally, so no third-party rights apply. The table is data.
 */
import { frameToSample } from "./shot-audio.mjs";

/** One cue for each kind of change. `land` is a second cue on the frame the change completes:
 * the satisfying moment, when a count finishes, a link closes or something arrives.
 * `priority` decides which cue stays when two fall too close together.
 */
export const STORY_CUES = Object.freeze({
  enter: { sound: "story-pop", gainDb: -21, priority: 2 },
  "set-value": { sound: "story-tick", gainDb: -24, priority: 2, land: { sound: "story-land", gainDb: -15, priority: 5 } },
  level: { sound: "story-rise", gainDb: -22, priority: 3 },
  "trend-rise": { sound: "story-rise", gainDb: -18, priority: 4, land: { sound: "story-land", gainDb: -16, priority: 5 } },
  "trend-fall": { sound: "story-fall", gainDb: -18, priority: 4 },
  // The climb, then the hit on the frame the line falls off the cliff.
  "trend-crash": { sound: "story-rise", gainDb: -21, priority: 3, land: { sound: "story-crash", gainDb: -12, priority: 6, at: .8 } },
  "trend-recover": { sound: "story-fall", gainDb: -22, priority: 3, land: { sound: "story-land", gainDb: -16, priority: 5 } },
  "trend-spike": { sound: "story-hop", gainDb: -17, priority: 4 },
  "trend-plateau": { sound: "story-rise", gainDb: -23, priority: 3 },
  connect: { sound: "story-draw", gainDb: -23, priority: 3, land: { sound: "story-click", gainDb: -17, priority: 4 } },
  transfer: { sound: "story-whoosh", gainDb: -20, priority: 4, land: { sound: "story-land", gainDb: -16, priority: 5 } },
  absorb: { sound: "story-whoosh", gainDb: -20, priority: 4, land: { sound: "story-land", gainDb: -16, priority: 5 } },
  "measure-gap": { sound: "story-measure", gainDb: -17, priority: 5, land: { sound: "story-reveal", gainDb: -14, priority: 6 } },
  highlight: { sound: "story-glow", gainDb: -25, priority: 1 },
  statement: { sound: "story-whoosh", gainDb: -22, priority: 4 },
  finale: { sound: "story-finale", gainDb: -13, priority: 7 },
  check: { sound: "story-check", gainDb: -14, priority: 6 },
  cross: { sound: "story-cross", gainDb: -17, priority: 5 },
  question: { sound: "story-question", gainDb: -18, priority: 5 },
  warning: { sound: "story-cross", gainDb: -19, priority: 5 },
  hop: { sound: "story-hop", gainDb: -19, priority: 4 },
  shake: { sound: "story-shake", gainDb: -19, priority: 4 },
  spin: { sound: "story-spin", gainDb: -20, priority: 4 },
  grow: { sound: "story-rise", gainDb: -20, priority: 3 },
  shrink: { sound: "story-fall", gainDb: -20, priority: 3 },
  drop: { sound: "story-thud", gainDb: -15, priority: 5 },
  lift: { sound: "story-lift", gainDb: -19, priority: 4 },
  walk: { sound: "story-step", gainDb: -21, priority: 3, everySeconds: .42 },
  explode: { sound: "story-explode", gainDb: -12, priority: 7, offset: .2 },
  pop: { sound: "story-popping", gainDb: -14, priority: 6, offset: .42 },
  print: { sound: "story-print", gainDb: -18, priority: 4 },
  stamp: { sound: "story-thud", gainDb: -13, priority: 6, offset: .28 },
  split: { sound: "story-tear", gainDb: -17, priority: 4, offset: .1 },
  vanish: { sound: "story-vanish", gainDb: -19, priority: 4 },
  melt: { sound: "story-fall", gainDb: -20, priority: 3 },
  burn: { sound: "story-burn", gainDb: -18, priority: 4 },
  inflate: { sound: "story-lift", gainDb: -19, priority: 4 },
  deflate: { sound: "story-deflate", gainDb: -18, priority: 4 },
  pulse: { sound: "story-thump", gainDb: -16, priority: 4, everySeconds: .33 },
  wobble: { sound: "story-wobble", gainDb: -20, priority: 3 },
  slide: { sound: "story-whoosh", gainDb: -20, priority: 4 },
  rain: { sound: "story-tick", gainDb: -20, priority: 3, everySeconds: .14 },
  stack: { sound: "story-click", gainDb: -16, priority: 4, everySeconds: .26 },
  flip: { sound: "story-whoosh", gainDb: -21, priority: 3 },
});

/** Two cues closer than this blur together, so the stronger one stays. */
export const MIN_CUE_SECONDS = .16;

const cueKey = (op) => (op.kind === "mark" ? op.mark : op.kind === "act" ? op.motion : op.kind === "trend" ? `trend-${op.shape}` : op.kind);

/** Cues for one story, in order, relative to the scene's first frame.
 * @param {{finale?:boolean,table?:object}} [options] `finale` gives the last statement its closing chord.
 */
export function storyCues(spec, { finale = false, table = STORY_CUES } = {}) {
  const cues = [];
  const add = (cue, frame, id) => { if (cue) cues.push({ sound: cue.sound, gainDb: cue.gainDb, priority: cue.priority, id, frame, sample: frameToSample(frame, spec.fps) }); };
  const frameRate = spec.fps.num / spec.fps.den;
  let onStage = new Set(spec.carried?.objects ?? []);
  for (const beat of spec.beats) {
    const arrived = beat.arrangement.objects.filter(id => !onStage.has(id));
    const closing = finale && beat === spec.beats[spec.beats.length - 1] && beat.arrangement.kind === "statement";
    if (beat.arrangement.kind === "statement") add(closing ? table.finale : table.statement, beat.startFrame, `${beat.id}-statement`);
    else if (arrived.length) add(table.enter, beat.startFrame, `${beat.id}-enter`);
    onStage = new Set(beat.arrangement.objects);
    (beat.ops ?? []).forEach((op, index) => {
      const cue = table[cueKey(op)], start = op.atFrame ?? beat.startFrame, end = start + (op.durationFrames ?? 0);
      if (!cue) return;
      if (cue.everySeconds) {
        const step = Math.max(1, Math.round(cue.everySeconds * frameRate));
        for (let frame = start, count = 0; frame < end; frame += step, count++) add(cue, frame, `${beat.id}-${index}-${count}`);
        return;
      }
      // `offset` starts a cue at the moment a motion hits, not when it begins.
      add(cue, start + Math.round((cue.offset ?? 0) * (end - start)), `${beat.id}-${index}`);
      if (cue.land && end > start) add(cue.land, Math.min(start + Math.round((cue.land.at ?? 1) * (end - start)), beat.endFrame - 1), `${beat.id}-${index}-land`);
    });
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
