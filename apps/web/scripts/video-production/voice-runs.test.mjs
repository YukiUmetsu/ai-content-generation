import { test } from "node:test";
import assert from "node:assert/strict";
import { joinRunTakes, runShare, scriptRuns, voiceFor } from "./voice-runs.mjs";

test("splits a line by script: English words for the English voice, the Japanese name for the Japanese one", () => {
  assert.deepEqual(scriptRuns("Do you know how to write the kanji つき?", "en"),
    [{ text: "Do you know how to write the kanji", locale: "en" }, { text: "つき", locale: "ja" }]);   // the English "?" is not read by the Japanese voice
  // One script is one run, unchanged: Japanese lines and English lines are not split.
  assert.deepEqual(scriptRuns("おんよみ、ゲツ、ガツ。", "ja"), [{ text: "おんよみ、ゲツ、ガツ。", locale: "ja" }]);
  assert.deepEqual(scriptRuns("Some common words using this kanji are", "en"), [{ text: "Some common words using this kanji are", locale: "en" }]);
  // Latin letters inside a Japanese line go to the other language (English by default).
  assert.deepEqual(scriptRuns("これはABCです。", "ja"), [{ text: "これは", locale: "ja" }, { text: "ABC", locale: "en" }, { text: "です。", locale: "ja" }]);
  assert.deepEqual(scriptRuns("「水」 means water", "en-US"), [{ text: "「水」", locale: "ja" }, { text: "means water", locale: "en-US" }]);
  assert.deepEqual(scriptRuns("?!", "en"), [{ text: "?!", locale: "en" }]);
  assert.deepEqual(scriptRuns("Write 水？", "en"), [{ text: "Write", locale: "en" }, { text: "水？", locale: "ja" }]);   // Japanese punctuation stays
  assert.equal(voiceFor("en-US", { ja: "J", en: "E" }, "D"), "E");
  assert.equal(voiceFor("fr", { ja: "J", en: "E" }, "D"), "D");
});

test("joins run takes on whole milliseconds and says when each run's speech starts", () => {
  const take = (ms, leadMs, speechMs) => ({ clip: new Int16Array(ms * 48).fill(1), lead: leadMs / 1000, speech: speechMs / 1000 });
  const joined = joinRunTakes([take(1000, 30, 890), take(500, 30, 390)], { gap: .04 });
  assert.equal(joined.clip.length, (1000 + 40 + 500) * 48);
  assert.equal(joined.lead, .03);
  assert.deepEqual(joined.starts.map(s => Math.round(s * 1000)), [0, 1040]);   // 1000 ms clip + 40 ms gap, from speech start to speech start
  assert.equal(Math.round(joined.speech * 1000), 1040 + 390);
  assert.throws(() => joinRunTakes([{ clip: new Int16Array(47), lead: 0, speech: .001 }]), /whole number of milliseconds/u);
  // The name is pulsed as its run starts.
  const runs = scriptRuns("Do you know how to write the kanji つき?", "en");
  const text = "Do you know how to write the kanji つき?";
  assert.ok(Math.abs(runShare(runs, joined.starts, joined.speech, 35 / 38, text) - 1040 / 1430) < 1e-9);
  assert.equal(runShare(runs, joined.starts, joined.speech, .1, text), 0);
});
