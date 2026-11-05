import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { layoutLines, frameToSample, foleyEvents, makeSound, SOUND_NAMES } from "./shot-audio.mjs";
import { probeNormalizedWav } from "./speech.mjs";

const fps = { num: 30, den: 1 };
const line = (id, seconds, notBeforeFrame) => ({ id, samples: seconds * 48000, notBeforeFrame });

test("places each line at its earliest frame on the measured clock", () => {
  const { windows } = layoutLines([line("a", 2, 18), line("b", 1.5, 120)], { fps, durationFrames: 300, minGapFrames: 6 });
  assert.deepEqual(windows.a, { startFrame: 18, endFrame: 78 });
  assert.deepEqual(windows.b, { startFrame: 120, endFrame: 165 });
});
test("a long line pushes the next one later", () => {
  const { windows } = layoutLines([line("a", 5, 18), line("b", 1, 120)], { fps, durationFrames: 300, minGapFrames: 6 });
  assert.equal(windows.b.startFrame, 174);
});
test("the timeline covers the shot exactly", () => {
  const { timeline } = layoutLines([line("a", 2, 18)], { fps, durationFrames: 300, minGapFrames: 6 });
  assert.equal(timeline.totalSamples, 480000);
  assert.equal(timeline.totalFrames, 300);
  assert.equal(timeline.beats.at(-1).pauseEndSample, 480000);
  assert.equal(timeline.beats[0].startSample, 0);
});
test("narration that overruns the shot fails with the line named", () => {
  assert.throws(() => layoutLines([line("a", 11, 18)], { fps, durationFrames: 300, minGapFrames: 6 }), /a.*overruns/u);
});
test("frames map to exact samples at fractional rates", () => {
  assert.equal(frameToSample(30, { num: 30000, den: 1001 }), 48048);
});
test("each contact gets one material sound at its exact sample", () => {
  const events = foleyEvents([{ frame: 90, kind: "place", object: "invoice" }, { frame: 10, kind: "grasp", object: "receipt" }],
    { invoice: "paper", receipt: "paper" }, fps);
  assert.deepEqual(events.map(item => [item.sound, item.sample]), [["paper-land", 144000], ["paper-lift", 16000]]);
});
test("a contact with no material is skipped, not guessed", () => {
  assert.deepEqual(foleyEvents([{ frame: 9, kind: "place", object: "cup" }], {}, fps), []);
});
test("every sound recipe renders real 48 kHz audio", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shot-audio-"));
  try {
    for (const name of SOUND_NAMES) {
      const probe = await probeNormalizedWav(await makeSound(name, dir));
      assert.ok(probe.samples > 1000, name);
    }
  } finally { await rm(dir, { recursive: true }); }
});
test("foley ignores the frame-1 grasp of objects that start in a hand", () => {
  assert.deepEqual(foleyEvents([{ frame: 1, kind: "grasp", object: "invoice" }], { invoice: "paper" }, fps), []);
});
