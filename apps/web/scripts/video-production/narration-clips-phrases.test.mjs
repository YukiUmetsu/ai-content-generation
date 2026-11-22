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

test("cuts the last phrase from 50 ms before it (not the whole pause), or gives null with no pause", () => {
  const take = Int16Array.from([...tone(.6), ...silence(.25), ...tone(.4), ...silence(.1)]);
  const last = lastPhrase(take);
  assert.ok(Math.abs(last.length / 48000 - (.05 + .4 + .1)) < .02);                  // 50 ms lead-in, the phrase, the tail
  assert.equal(speechPhrases(last).length, 1);
  assert.equal(lastPhrase(Int16Array.from(tone(.5))), null);
});

test("the comma's pause is the break, not a consonant's closure inside a word, and a click is no phrase", () => {
  // "くんよみ" 0.5 s, the comma's pause 0.25 s, then "ひ" 0.15 s, a 0.08 s closure, "と" 0.2 s.
  const take = Int16Array.from([...tone(.5), ...silence(.25), ...tone(.15), ...silence(.08), ...tone(.2), ...silence(.1)]);
  const last = lastPhrase(take, { pauses: 1 });
  assert.ok(Math.abs(last.length / 48000 - (.05 + .15 + .08 + .2 + .1)) < .02);      // all of "ひと", from 50 ms before it
  assert.equal(lastPhrase(take, { pauses: 3 }), null);                                // fewer pauses than the text's commas
  // A faint click after the line is not a phrase to reuse.
  assert.equal(lastPhrase(Int16Array.from([...tone(.5), ...silence(.3), ...tone(.03, 300)]), { pauses: 1 }), null);
});
