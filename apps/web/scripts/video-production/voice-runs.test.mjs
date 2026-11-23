import { test } from "node:test";
import assert from "node:assert/strict";
import { joinRunTakes, runShare, scriptRuns as runsWithPlace, voiceFor } from "./voice-runs.mjs";
// Most cases check what is read by which voice; where each run lies is checked on its own below.
const scriptRuns = (...args) => runsWithPlace(...args).map(({ text, locale }) => ({ text, locale }));

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
  const runs = runsWithPlace("Do you know how to write the kanji つき?", "en");
  const text = "Do you know how to write the kanji つき?";
  assert.ok(Math.abs(runShare(runs, joined.starts, joined.speech, 35 / 38, text) - 1040 / 1430) < 1e-9);
  assert.equal(runShare(runs, joined.starts, joined.speech, .1, text), 0);
});

test("digits go with the text they touch, every kanji counts as Japanese, and a Japanese run reads no ASCII punctuation", () => {
  assert.deepEqual(scriptRuns("1", "ja"), [{ text: "1", locale: "ja" }]);                                      // a stroke count in a Japanese line
  assert.deepEqual(scriptRuns("1画目。", "ja"), [{ text: "1画目。", locale: "ja" }]);
  assert.deepEqual(scriptRuns("How about 12月?", "en"), [{ text: "How about", locale: "en" }, { text: "12月", locale: "ja" }]);
  assert.deepEqual(scriptRuns("Count 3 strokes", "en"), [{ text: "Count 3 strokes", locale: "en" }]);
  assert.deepEqual(scriptRuns("𠮟る。", "ja"), [{ text: "𠮟る。", locale: "ja" }]);                             // a kanji beyond the basic plane
  assert.deepEqual(scriptRuns("Read ㇰ", "en"), [{ text: "Read", locale: "en" }, { text: "ㇰ", locale: "ja" }]);
  assert.deepEqual(scriptRuns("月 (つき), means moon", "en"), [{ text: "月 つき", locale: "ja" }, { text: "means moon", locale: "en" }]);
  assert.deepEqual(scriptRuns("つき?", "en"), [{ text: "つき", locale: "ja" }]);                                 // all Japanese in an English line
  assert.deepEqual(scriptRuns("つき？", "ja"), [{ text: "つき？", locale: "ja" }]);                               // a Japanese line keeps its own punctuation
});

test("a pulse inside a run keeps its place in that run", () => {
  const text = "Write the word moon, 月.";
  const runs = runsWithPlace(text, "en");
  assert.deepEqual(runs.map(r => r.text), ["Write the word moon,", "月"]);
  // "moon" starts at character 15 of the English run (21 characters with its trailing space), which lasts 2 s.
  const share = runShare(runs, [0, 2.2], 2.6, 15 / text.length, text, [2, .4]);
  assert.ok(Math.abs(share * 2.6 - 2 * 15 / 21) < .01);
});

test("each run knows where it lies in the line, so a pulse finds its run after punctuation was dropped", () => {
  const text = "The kanji 月 (つき), means moon.";
  const runs = runsWithPlace(text, "en");
  assert.deepEqual(runs.map(r => [r.text, text.slice(r.from, r.to).trim()]), [["The kanji", "The kanji"], ["月 つき", "月 (つき),"], ["means moon.", "means moon."]]);
  const at = (word) => runShare(runs, [0, 1, 2], 2.8, text.indexOf(word) / text.length, text, [.8, .8, .8]);
  assert.ok(Math.abs(at("means") - 2 / 2.8) < .01);
  assert.ok(Math.abs(at("つき") * 2.8 - (1 + .8 * 3 / 8)) < .05);
  assert.deepEqual(scriptRuns("It's 'つき'.", "en"), [{ text: "It's", locale: "en" }, { text: "つき", locale: "ja" }]);
});

test("a run's own gap replaces the line's gap before it (a comma's pause after a phrase)", async () => {
  const { joinRunTakes } = await import("./voice-runs.mjs");
  const take = (ms) => ({ clip: new Int16Array(48 * ms).fill(1000), lead: 0, speech: ms / 1000 });
  const joined = joinRunTakes([take(100), { ...take(100), gapBefore: .15 }, take(100)], { gap: .04 });
  assert.equal(joined.clip.length, 48 * (100 + 150 + 100 + 40 + 100));
  assert.deepEqual(joined.starts.map(s => Math.round(s * 1000)), [0, 250, 390]);
  assert.throws(() => joinRunTakes([take(100), { ...take(100), gapBefore: 3 }]), /0 to 2 seconds/u);
});
