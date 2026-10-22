import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildSampleTimeline } from "./timeline.mjs";
import { compileHouseMathVisuals, getHouseMathFrame } from "./visual-plan.mjs";

const smoke = JSON.parse(readFileSync(new URL("../../../../examples/video-production-house-math-smoke.json", import.meta.url), "utf8"));
const long = JSON.parse(readFileSync(new URL("../../../../examples/video-production-house-math-long.json", import.meta.url), "utf8"));
const audio = smoke.beats.map((b, i) => ({ id: b.id, samples: [48000, 96000, 72000][i], pauseAfterMs: b.pauseAfterMs, eventIds: b.eventIds }));
const timeline = buildSampleTimeline(audio, { fps: smoke.destination.fps, events: smoke.events });

test("compiled visual plan has clear chapters, correct arithmetic and a grounded scenario caveat", () => {
  const plan = compileHouseMathVisuals(smoke, timeline);
  assert.equal(plan.manifest.durationFrames, timeline.totalFrames);
  assert.equal(plan.chapters.length, 3);
  assert.equal(plan.chapters[0].visual.headline, "THE PRICE ISN'T THE COST");
  assert.equal(plan.scenario.purchasePrice, 500000);
  assert.ok(plan.economics.totalCashOutflow > 1_400_000 && plan.economics.totalCashOutflow < 1_420_000);
  assert.equal(Math.round(plan.economics.totalCashOutflow), Math.round(plan.economics.downPayment + plan.economics.totalMortgagePayments + plan.economics.totalCarryingCosts));
  assert.equal(plan.disclaimer, "ILLUSTRATIVE SCENARIO · NOT A MARKET FORECAST OR NET WEALTH COST");
});

test("first, middle and payoff frames are distinct; payoff is hidden before its actual event", () => {
  const plan = compileHouseMathVisuals(smoke, timeline);
  const first = getHouseMathFrame(plan, 0);
  const middle = getHouseMathFrame(plan, plan.chapters[1].startFrame + 15);
  const before = getHouseMathFrame(plan, plan.events["lifetime-total-reveal"] - 1);
  const at = getHouseMathFrame(plan, plan.events["lifetime-total-reveal"]);
  const after = getHouseMathFrame(plan, Math.min(plan.manifest.durationFrames - 1, plan.events["lifetime-total-reveal"] + 20));
  assert.equal(first.intent, "house-intro");
  assert.equal(middle.intent, "cost-breakdown");
  assert.equal(after.intent, "cost-payoff");
  assert.equal(before.revealProgress, 0);
  assert.equal(at.revealProgress, 0, "the payoff is not visible on the first event frame");
  assert.ok(after.revealProgress > 0);
  assert.equal(after.disclaimer, plan.disclaimer);
});

test("invalid scenario arithmetic, unsupported scene intent, missing event and short long-form are refused", () => {
  assert.throws(() => compileHouseMathVisuals({ ...smoke, scenario: { ...smoke.scenario, purchasePrice: 0 } }, timeline), /scenario|invalid/i);
  assert.throws(() => compileHouseMathVisuals({ ...smoke, beats: [{ ...smoke.beats[0], visualIntent: "unknown" }, ...smoke.beats.slice(1)] }, timeline), /scene|unsupported/i);
  assert.throws(() => compileHouseMathVisuals({ ...smoke, topic: { ...smoke.topic, payoffEventId: "orphan" } }, timeline), /payoff|event/i);
  assert.throws(() => compileHouseMathVisuals({ ...smoke, mode: "youtube-long", destination: { ...smoke.destination, minimumDurationSeconds: 480, targetDurationSeconds: [540, 900] } }, timeline), /480|duration/i);
  assert.throws(() => getHouseMathFrame(compileHouseMathVisuals(smoke, timeline), timeline.totalFrames), /frame/i);
});

test("long authored episode has varied chapters; synthetic sample fixtures exercise the 480-second gate", () => {
  assert.ok(long.beats.map((beat) => beat.narration.split(/\s+/).length).reduce((a, b) => a + b, 0) > 1300, "script must contain substantive narration, not padding");
  const longAudio = long.beats.map((beat) => ({ id: beat.id, samples: 20 * 48000, pauseAfterMs: beat.pauseAfterMs, eventIds: beat.eventIds }));
  const measured = buildSampleTimeline(longAudio, { fps: long.destination.fps, events: long.events });
  const plan = compileHouseMathVisuals(long, measured);
  assert.equal(plan.chapters.length, long.beats.length);
  assert.equal(new Set(plan.chapters.map((chapter) => chapter.visual.headline)).size, long.beats.length);
  assert.ok(measured.totalSamples / 48000 >= 480);
  assert.equal(getHouseMathFrame(plan, plan.manifest.durationFrames - 1).chapterIndex, long.beats.length - 1);
});
