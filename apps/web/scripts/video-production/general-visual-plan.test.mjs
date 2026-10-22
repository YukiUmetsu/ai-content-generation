import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildSampleTimeline } from "./timeline.mjs";
import { compileGeneralVisuals, getGeneralFrame } from "./general-visual-plan.mjs";

const source = JSON.parse(readFileSync(new URL("../../../../examples/video-production-general-smoke.json", import.meta.url), "utf8"));
const timeline = buildSampleTimeline(source.beats.map((beat) => ({ id: beat.id, samples: 4 * 48000, pauseAfterMs: beat.pauseAfterMs, eventIds: beat.eventIds })), { fps: source.destination.fps, events: source.events });

test("generic storyboard compiles to sample-driven chapters with meaningful diagrams", () => {
  const plan = compileGeneralVisuals(source, timeline);
  assert.equal(plan.kind, "general-explainer-visual-plan");
  assert.equal(plan.chapters.length, 4);
  assert.deepEqual(plan.chapters[1].visual.items, ["Phone", "Router", "Network", "Destination"]);
  assert.equal(plan.manifest.durationFrames, timeline.totalFrames);
  assert.equal(plan.commercialReady, false);
});

test("generic payoff starts hidden; sequential content reveals deterministically on direct seeks", () => {
  const plan = compileGeneralVisuals(source, timeline);
  const start = getGeneralFrame(plan, plan.chapters[1].startFrame);
  const later = getGeneralFrame(plan, Math.min(plan.chapters[1].endFrame - 1, plan.chapters[1].startFrame + 80));
  assert.ok(later.visibleItems > start.visibleItems);
  const at = getGeneralFrame(plan, plan.events[plan.payoffEventId]);
  const after = getGeneralFrame(plan, plan.events[plan.payoffEventId] + 30);
  assert.equal(at.visibleItems, 0);
  assert.ok(after.visibleItems > 0);
  assert.equal(after.visual.headline, "THE MESSAGE ARRIVES");
  assert.throws(() => getGeneralFrame(plan, timeline.totalFrames), /frame/i);
});

test("generic compiler rejects incompatible source, mismatched beats and short long-form", () => {
  assert.throws(() => compileGeneralVisuals({ ...source, visualFamily: "house-math-v1" }, timeline), /invalid|family|job/i);
  assert.throws(() => compileGeneralVisuals(source, { ...timeline, beats: timeline.beats.slice(1) }), /beat|chapter/i);
  assert.throws(() => compileGeneralVisuals({ ...source, mode: "youtube-long", destination: { ...source.destination, minimumDurationSeconds: 480, targetDurationSeconds: [480, 900] } }, timeline), /480|duration/i);
});
