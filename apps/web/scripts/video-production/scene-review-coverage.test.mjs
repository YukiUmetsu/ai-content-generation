import assert from "node:assert/strict";
import test from "node:test";
import { assertReviewStillBudget, assertSceneReviewCapacity, selectSceneReviewFrames, summarizeSceneReviewCoverage } from "./scene-review-coverage.mjs";

const digest = "a".repeat(64);
const makeStill = (frame) => ({ frame, file: `stills/frame-${String(frame).padStart(6, "0")}.png`, sha256: digest });
const plan = {
  manifest: { durationFrames: 180, fps: { num: 30, den: 1 } }, payoffEventId: "reveal", events: { reveal: 120 },
  chapters: [
    { id: "intro", startFrame: 0, endFrame: 60, visual: { headline: "Opening" } },
    { id: "footage", startFrame: 60, endFrame: 120, visual: { stockMedia: { assetType: "video", license: "Pexels License" } } },
    { id: "payoff", startFrame: 120, endFrame: 180, visual: { stockMedia: { assetType: "photo", rightsStatus: "draft-provider-license" } } },
  ],
};

test("captures the first and last frame, a representative still for every scene, and a post-payoff still", () => {
  const frames = selectSceneReviewFrames(plan);
  assert.deepEqual(frames, [0, 30, 90, 150, 179]);
  const coverage = summarizeSceneReviewCoverage(plan, frames.map(makeStill));
  assert.equal(coverage.sceneCount, 3);
  assert.equal(coverage.reviewStillCount, 5);
  assert.deepEqual(coverage.mediaDeclarationCounts, { stockVideo: 1, stockPhoto: 1, kumikiOnly: 1 });
  assert.deepEqual(coverage.scenesWithoutStockVideo, ["intro", "payoff"]);
  assert.deepEqual(coverage.scenes.map(({ id, sourceType, reviewStill }) => [id, sourceType, reviewStill.frame]), [
    ["intro", "kumiki", 30], ["footage", "stock-video", 90], ["payoff", "stock-photo", 150],
  ]);
  assert.equal(coverage.scenes[2].rightsStatus, "draft-provider-license");
  assert.equal(coverage.humanVisualReviewRequired, true);
});

test("binds missing footage to the immutable storyboard shot ID, not the current scene position", () => {
  const frames=selectSceneReviewFrames(plan);
  const coverage=summarizeSceneReviewCoverage(plan,frames.map(makeStill),[
    {shotId:"shot-payoff",beatId:"payoff"},{shotId:"shot-intro",beatId:"intro"}]);
  assert.equal(coverage.scenes[0].shotId,"shot-intro");
  assert.equal(coverage.scenes[1].shotId,undefined);
  assert.equal(coverage.scenes[2].shotId,"shot-payoff");
  assert.throws(()=>summarizeSceneReviewCoverage(plan,frames.map(makeStill),[
    {shotId:"same-shot",beatId:"intro"},{shotId:"same-shot",beatId:"payoff"}]),/duplicate|shot/i);
});

test("short scenes still receive exactly one in-scene proof even when midpoints collide with boundaries", () => {
  const short = { manifest: { durationFrames: 3 }, chapters: [
    { id: "a", startFrame: 0, endFrame: 1, visual: {} },
    { id: "b", startFrame: 1, endFrame: 2, visual: {} },
    { id: "c", startFrame: 2, endFrame: 3, visual: {} },
  ] };
  assert.deepEqual(selectSceneReviewFrames(short), [0, 1, 2]);
  assert.equal(summarizeSceneReviewCoverage(short, [0, 1, 2].map(makeStill)).sceneCount, 3);
});

test("refuses to claim coverage if a scene, final still, hash, or range is missing", () => {
  const frames = selectSceneReviewFrames(plan);
  assert.throws(() => summarizeSceneReviewCoverage(plan, frames.filter(frame => frame !== 90).map(makeStill)), /scene|coverage|still/i);
  assert.throws(() => summarizeSceneReviewCoverage(plan, frames.filter(frame => frame !== 179).map(makeStill)), /last|final|still/i);
  assert.throws(() => summarizeSceneReviewCoverage(plan, frames.map(makeStill).map(s => s.frame === 90 ? { ...s, sha256: "bad" } : s)), /hash|still/i);
  assert.throws(() => selectSceneReviewFrames({ ...plan, chapters: [plan.chapters[0], { ...plan.chapters[1], startFrame: 61 }, plan.chapters[2]] }), /gap|contiguous|range/i);
  assert.throws(() => selectSceneReviewFrames({ ...plan, chapters: [plan.chapters[0], { ...plan.chapters[1], id: "intro" }, plan.chapters[2]] }), /duplicate|id/i);
});

test("limits screenshot output before capture begins rather than silently skipping scenes", () => {
  const huge = { manifest: { durationFrames: 200 }, chapters: Array.from({ length: 100 }, (_, i) =>
    ({ id: `s${i}`, startFrame: i * 2, endFrame: i * 2 + 2, visual: {} })) };
  assert.throws(() => selectSceneReviewFrames(huge), /64|limit|too many/i);
  const exactly64={manifest:{durationFrames:128},chapters:Array.from({length:64},(_,i)=>
    ({id:`beat-${i}`,startFrame:i*2,endFrame:i*2+2,visual:{}}))};
  const selected=selectSceneReviewFrames(exactly64);
  assert.equal(selected.length,64);
  assert.equal(selected[0],0);
  assert.equal(selected.at(-1),127);
  assert.equal(summarizeSceneReviewCoverage(exactly64,selected.map(makeStill)).sceneCount,64);
  assert.equal(assertSceneReviewCapacity(64),64);
  assert.throws(()=>assertSceneReviewCapacity(65),/64|scene/i);
});

test("caps aggregate screenshot bytes to prevent many individually valid PNGs exhausting local disk", () => {
  const mib=1024*1024;
  assert.equal(assertReviewStillBudget(240*mib,16*mib),256*mib);
  assert.throws(()=>assertReviewStillBudget(240*mib,17*mib),/256|still|budget|storage/i);
  assert.throws(()=>assertReviewStillBudget(0,-1),/byte|size|budget/i);
});
