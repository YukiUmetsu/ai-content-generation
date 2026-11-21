import { test } from "node:test";
import assert from "node:assert/strict";
import { SAMPLE_RATE, framesFor, placeClips, speechBounds, toFrameGrid, trimSpeech } from "./narration-clips.mjs";

/** Silence, a 200 Hz tone, silence. */
function take(before, tone, after) {
  const s = new Int16Array(Math.round((before + tone + after) * SAMPLE_RATE));
  const a = Math.round(before * SAMPLE_RATE), b = a + Math.round(tone * SAMPLE_RATE);
  for (let i = a; i < b; i++) s[i] = Math.round(8000 * Math.sin(2 * Math.PI * 200 * i / SAMPLE_RATE));
  return s;
}

test("finds the speech in a take and trims it to whole milliseconds with a short lead", () => {
  const bounds = speechBounds(take(.2, .5, .3));
  assert.ok(Math.abs(bounds.start / SAMPLE_RATE - .2) < .012);
  assert.ok(Math.abs(bounds.end / SAMPLE_RATE - .7) < .012);
  const trimmed = trimSpeech(take(.2, .5, .3));
  assert.equal(trimmed.clip.length % 48, 0);
  assert.ok(Math.abs(trimmed.lead - .03) < .002);
  assert.ok(Math.abs(trimmed.speech - .5) < .02);
  assert.equal(trimmed.clip[0], 0);                                                     // faded in from silence
  assert.ok(Math.abs(trimSpeech(take(.2, .5, .3), { preRoll: .1 }).lead - .1) < .002);  // configurable
  assert.equal(speechBounds(new Int16Array(4800)), null);
  assert.throws(() => trimSpeech(new Int16Array(4800)), /no speech/u);
});

test("places each clip so its speech starts on its onset, with whole-millisecond pauses that end on the last sample", () => {
  const clip = (seconds) => ({ clip: new Int16Array(Math.round(seconds * 1000) * 48).fill(1000), lead: .03 });
  const takes = [{ id: "a", ...clip(1) }, { id: "b", ...clip(.5) }];
  const beats = placeClips(takes, { a: .35, b: 2 }, 3 * 1600 * 30);
  assert.equal(beats[0].samples.length, Math.round((.35 - .03) * 1000) * 48 + 48000);   // leading silence + clip
  assert.equal(beats[0].samples[0], 0);
  const pauseEnd = beats[0].samples.length + beats[0].pauseAfterMs * 48;
  assert.equal(pauseEnd, Math.round((2 - .03) * 1000) * 48);                              // b's speech starts at 2 s
  assert.equal(pauseEnd + beats[1].samples.length + beats[1].pauseAfterMs * 48, 3 * 1600 * 30);
  assert.ok(beats.every(b => Number.isInteger(b.pauseAfterMs) && b.pauseAfterMs >= 0));
  assert.throws(() => placeClips(takes, { a: .35, b: .8 }, 144000), /before the previous line ends/u);
  assert.throws(() => placeClips(takes, { a: .01, b: 2 }, 144000), /before the video starts/u);
  assert.throws(() => placeClips(takes, { a: .35, b: 2 }, 48000), /past the end/u);
  assert.throws(() => placeClips([{ id: "a", clip: new Int16Array(50), lead: 0 }], { a: 0 }, 48000), /whole number of milliseconds/u);
});

test("puts lengths on the frame grid", () => {
  assert.equal(toFrameGrid(6.51), 6.5);
  assert.equal(toFrameGrid(6.52), 196 / 30);
  assert.equal(toFrameGrid(1.01, 25), 1);
  assert.equal(framesFor(10.01, 30, 3), 303);
  assert.equal(framesFor(10, 30, 3), 300);
});
