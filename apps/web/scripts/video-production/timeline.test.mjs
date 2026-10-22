import assert from "node:assert/strict";
import test from "node:test";
import { buildSampleTimeline, toFrame, writeSrt } from "./timeline.mjs";

const fps = { num: 30, den: 1 };
const beats = [
  { id: "intro", samples: 48000, pauseAfterMs: 350, eventIds: ["start"] },
  { id: "payoff", samples: 96000, pauseAfterMs: 0, eventIds: ["lifetime-total-reveal"] },
];
const events = [{ id: "start", beatId: "intro" }, { id: "lifetime-total-reveal", beatId: "payoff" }];

test("timeline offsets are exact 48 kHz samples including intentional silence", () => {
  const result = buildSampleTimeline(beats, { fps, events });
  assert.deepEqual(result.beats.map(({ id, startSample, endSample, pauseEndSample }) => ({ id, startSample, endSample, pauseEndSample })), [
    { id: "intro", startSample: 0, endSample: 48000, pauseEndSample: 64800 },
    { id: "payoff", startSample: 64800, endSample: 160800, pauseEndSample: 160800 },
  ]);
  assert.equal(result.totalSamples, 160800);
  assert.equal(result.eventSamples["lifetime-total-reveal"], 64800);
  assert.equal(result.eventFrames["lifetime-total-reveal"], 41);
  assert.equal(result.totalFrames, 101);
});

test("fractional sample-to-frame conversion rounds once at the absolute boundary", () => {
  assert.equal(toFrame(799, fps), 0);
  assert.equal(toFrame(800, fps), 1);
  assert.equal(toFrame(2400, fps), 2);
  assert.equal(toFrame(48000, { num: 30000, den: 1001 }), 30);
});

test("SRT uses measured speech extents and leaves pauses uncaptained", () => {
  const timeline = buildSampleTimeline(beats, { fps, events });
  const srt = writeSrt(timeline, { intro: "You might think...", payoff: "Lifetime cost is $800k." });
  assert.match(srt, /1\n00:00:00,000 --> 00:00:01,000\nYou might think\.\.\./);
  assert.match(srt, /2\n00:00:01,350 --> 00:00:03,350\nLifetime cost is \$800k/);
  assert.doesNotMatch(srt, /00:00:01,000 --> 00:00:01,350/);
});

test("orphan event, duplicate event, empty/overlap speech, invalid fps and negative pause fail", () => {
  assert.throws(() => buildSampleTimeline(beats, { fps, events: [{ id: "wrong", beatId: "missing" }] }), /orphan/i);
  assert.throws(() => buildSampleTimeline(beats, { fps, events: [events[0], events[0]] }), /duplicate/i);
  assert.throws(() => buildSampleTimeline([{ ...beats[0], samples: 0 }], { fps, events: [] }), /samples/i);
  assert.throws(() => buildSampleTimeline([{ ...beats[0], pauseAfterMs: -2 }], { fps, events: [] }), /pause/i);
  assert.throws(() => buildSampleTimeline(beats, { fps: { num: 0, den: 1 }, events }), /fps/i);
  assert.throws(() => buildSampleTimeline(beats, { fps, events: [events[0]] }), /orphan|unregistered/i);
  assert.throws(() => writeSrt(buildSampleTimeline(beats, { fps, events }), { intro: "yes" }), /missing.*text/i);
});
