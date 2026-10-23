import assert from "node:assert/strict";
import test from "node:test";
import { analyzeCaptionReadability } from "./caption-readability.mjs";

const seconds = (value) => Math.round(value * 48000);
const timeline = (...items) => ({
  sampleRate: 48000,
  beats: items.map(([id, start, end]) => ({
    id, startSample: seconds(start), endSample: seconds(end), pauseEndSample: seconds(end),
  })),
});

test("ordinary beat-level captions produce an empty findings list", () => {
  const result = analyzeCaptionReadability(timeline(["intro", 0, 4]), {
    intro: "A heat pump moves warmth between your home and the outside air.",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.findings, []);
  assert.equal(result.beats[0].durationSeconds, 4);
  assert.equal(result.beats[0].latinWords, 12);
});

test("unreadably fast narration produces a warning, not fabricated finer captions", () => {
  const result = analyzeCaptionReadability(timeline(["intro", 0, 1]), {
    intro: "A heat pump moves warmth between your home and outside air.",
  }, { profile: "short" });
  assert.equal(result.ok, true);
  assert.ok(result.findings.some((finding) => finding.code === "caption-reading-speed" && finding.severity === "warning" && finding.beatId === "intro"));
  assert.equal(result.beats[0].durationSeconds, 1);
  assert.equal(result.beats[0].sourcePrecision, "beat");
});

test("caption content exceeding two readable lines reports layout risk without truncating", () => {
  const text = Array.from({ length: 35 }, () => "renovation").join(" ");
  const result = analyzeCaptionReadability(timeline(["intro", 0, 15]), { intro: text }, { profile: "short" });
  assert.equal(result.ok, true);
  assert.ok(result.findings.some((finding) => finding.code === "caption-display-overflow" && finding.severity === "warning"));
  assert.equal(result.beats[0].text, text);
});

test("CJK characters count as wide visible glyphs without fake Latin WPM", () => {
  const text = "これは暖房の説明です。";
  const result = analyzeCaptionReadability(timeline(["ja", 0, 3]), { ja: text }, { profile: "short" });
  assert.equal(result.ok, true);
  assert.equal(result.beats[0].latinWpm, null);
  assert.equal(result.beats[0].graphemes, [...text].length);
  assert.ok(result.beats[0].displayUnits >= [...text].length * 1.8);
});

test("emoji ZWJ sequences are counted once, and NFC equivalent text scores equally", () => {
  const composite = "👩‍💻";
  const combined = "Cafe\u0301 " + composite;
  const precomposed = "Café " + composite;
  const combinedResult = analyzeCaptionReadability(timeline(["a", 0, 2]), { a: combined });
  const composedResult = analyzeCaptionReadability(timeline(["a", 0, 2]), { a: precomposed });
  assert.equal(combinedResult.beats[0].graphemes, composedResult.beats[0].graphemes);
  assert.equal(combinedResult.beats[0].displayUnits, composedResult.beats[0].displayUnits);
  assert.equal(combinedResult.beats[0].graphemes, 6);
});

test("missing caption, duplicate beat, invalid sample range and unknown profile fail explicitly", () => {
  const t = timeline(["intro", 0, 2]);
  const missing = analyzeCaptionReadability(t, {});
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.findings.map(({ code, severity }) => ({ code, severity })), [
    { code: "caption-missing", severity: "error" },
  ]);
  assert.throws(() => analyzeCaptionReadability(timeline(["a", 0, 2], ["a", 2, 3]), { a: "yes" }), /duplicate/i);
  assert.throws(() => analyzeCaptionReadability(timeline(["a", 1, 0]), { a: "yes" }), /sample range/i);
  assert.throws(() => analyzeCaptionReadability(t, { intro: "yes" }, { profile: "wat" }), /profile/i);
});

test("long and short profiles have different readable-line limits and equal audio measurements", () => {
  const content = "A moderately sized single caption about monthly ownership costs and fees.";
  const short = analyzeCaptionReadability(timeline(["a", 0, 6]), { a: content }, { profile: "short" });
  const long = analyzeCaptionReadability(timeline(["a", 0, 6]), { a: content }, { profile: "long" });
  assert.ok(short.profile.maxDisplayUnitsPerLine < long.profile.maxDisplayUnitsPerLine);
  assert.equal(short.beats[0].durationSeconds, long.beats[0].durationSeconds);
  assert.equal(short.beats[0].displayUnits, long.beats[0].displayUnits);
});
