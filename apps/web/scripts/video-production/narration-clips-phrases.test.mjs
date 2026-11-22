import { test } from "node:test";
import assert from "node:assert/strict";
import { lastPhrase, speechPhrases } from "./narration-clips.mjs";

const tone = (seconds, amp = 8000) => Array.from({ length: Math.round(seconds * 48000) }, (_, i) => Math.round(amp * Math.sin(2 * Math.PI * 220 * i / 48000)));
const silence = (seconds) => new Array(Math.round(seconds * 48000)).fill(0);

test("finds the phrases of a take at its pauses, not at short dips", () => {
  // "くんよみ" (0.6 s), a 0.25 s pause, "ひと" (0.4 s); then a word with a 60 ms dip inside.
  const take = Int16Array.from([...silence(.05), ...tone(.6), ...silence(.25), ...tone(.4), ...silence(.1)]);
  const phrases = speechPhrases(take);
  assert.equal(phrases.length, 2);
  assert.ok(Math.abs(phrases[1].start / 48000 - .9) < .02);
  assert.equal(speechPhrases(Int16Array.from([...tone(.3), ...silence(.06), ...tone(.3)])).length, 1);
  assert.deepEqual(speechPhrases(new Int16Array(4800)), []);
});

test("cuts the last phrase from the middle of the pause before it, or gives null with no pause", () => {
  const take = Int16Array.from([...tone(.6), ...silence(.25), ...tone(.4), ...silence(.1)]);
  const last = lastPhrase(take);
  assert.ok(Math.abs(last.length / 48000 - (.125 + .4 + .1)) < .02);                 // half the pause, the phrase, the tail
  assert.equal(speechPhrases(last).length, 1);
  assert.equal(lastPhrase(Int16Array.from(tone(.5))), null);
});
