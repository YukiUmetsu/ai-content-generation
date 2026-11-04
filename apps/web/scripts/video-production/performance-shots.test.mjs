import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applyPerformanceShots, chapterSpeechWindows } from "./performance-shots.mjs";

const fps = { num: 30, den: 1 };
const plan = (performance = true) => ({ manifest: { fps, width: 1920, height: 1080 }, chapters: [
  { id: "plain", startFrame: 0, endFrame: 30, visual: {} },
  { id: "desk", startFrame: 30, endFrame: 330, dialogue: { turns: [{ id: "one", startFrame: 42, endFrame: 90 }] },
    visual: performance ? { direction: { performance: { version: 1 } } } : {} },
] });
async function fakeRender({ output, intent }, bytes = "video") {
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "shot.mp4"), bytes);
  return { manifest: { frames: intent.durationFrames, contact_error_m: { "a.hand": .0001 }, video_sha256: createHash("sha256").update(bytes).digest("hex") },
    contacts: [{ frame: 40, kind: "place", object: "paper" }] };
}
/** build-shot writes its manifest. The fake does the same, so a cache can be read back. */
const withManifest = render => async input => {
  const result = await render(input);
  await writeFile(join(input.output, "shot-manifest.json"), JSON.stringify(result.manifest));
  return result;
};
const dir = () => mkdtemp(join(tmpdir(), "perf-shot-"));
const shots = { desk: { intent: { materials: { paper: "paper" } }, profile: "review", label: { text: "gap" } } };

test("windows are relative to the scene start", () => {
  assert.deepEqual(chapterSpeechWindows(plan().chapters[1]), { one: { startFrame: 12, endFrame: 60 } });
});
test("a scene with no shot request is untouched", async t => {
  const outputDir = await dir(); t.after(() => rm(outputDir, { recursive: true }));
  const result = await applyPerformanceShots(plan(false), { outputDir });
  assert.deepEqual(result.assets, []);
  assert.equal(result.plan.chapters[1].visual.stockMedia, undefined);
});
test("a requested shot with nothing staged stops production", async t => {
  const outputDir = await dir(); t.after(() => rm(outputDir, { recursive: true }));
  await assert.rejects(applyPerformanceShots(plan(), { outputDir }), /asks for a 3D shot/u);
});
test("a rendered shot binds through the hash-addressed media route", async t => {
  const outputDir = await dir(); t.after(() => rm(outputDir, { recursive: true }));
  const result = await applyPerformanceShots(plan(), { outputDir, shots }, { renderShot: fakeRender, mouthCues: async () => null });
  const visual = result.plan.chapters[1].visual;
  assert.equal(visual.stockMedia.assetType, "video");
  assert.equal(visual.stockMedia.url, result.assets[0].url);
  assert.match(visual.stockMedia.url, /^\/__video_media\/[a-f0-9]{64}\.mp4$/u);
  assert.equal(visual.performanceClip.label.text, "gap");
  assert.equal(result.plan.chapters[0].visual.stockMedia, undefined);
});
test("the shot takes the scene's measured length", async t => {
  const outputDir = await dir(); t.after(() => rm(outputDir, { recursive: true }));
  let seen;
  await applyPerformanceShots(plan(), { outputDir, shots }, { mouthCues: async () => null, renderShot: input => { seen = input; return fakeRender(input); } });
  assert.equal(seen.intent.durationFrames, 300);
});
test("a wrong frame count or changed bytes stops production", async t => {
  const outputDir = await dir(); t.after(() => rm(outputDir, { recursive: true }));
  await assert.rejects(applyPerformanceShots(plan(), { outputDir, shots }, { mouthCues: async () => null,
    renderShot: async input => ({ ...(await fakeRender(input)), manifest: { frames: 1 } }) }), /expected 300/u);
  await assert.rejects(applyPerformanceShots(plan(), { outputDir, shots }, { mouthCues: async () => null,
    renderShot: async input => { const done = await fakeRender(input); done.manifest.video_sha256 = "0"; return done; } }), /changed after render/u);
});
test("contacts become foley with the report saying how lips were made", async t => {
  const outputDir = await dir(); t.after(() => rm(outputDir, { recursive: true }));
  const result = await applyPerformanceShots(plan(), { outputDir, shots }, { renderShot: fakeRender, mouthCues: async () => null });
  assert.equal(result.sounds[0].sound, "paper-land");
  assert.equal(result.report[0].lipSync, "approximate cycle");
});

test("an unchanged scene reuses its clip, and new narration timing renders again", async t => {
  const outputDir = await dir(); t.after(() => rm(outputDir, { recursive: true }));
  let renders = 0;
  const renderShot = async input => { renders += 1; return fakeRender(input); };
  const first = await applyPerformanceShots(plan(), { outputDir, shots }, { renderShot: withManifest(renderShot), mouthCues: async () => null });
  const again = await applyPerformanceShots(plan(), { outputDir, shots }, { renderShot: withManifest(renderShot), mouthCues: async () => null });
  assert.equal(renders, 1);
  assert.equal(first.report[0].cacheHit, false);
  assert.equal(again.report[0].cacheHit, true);
  assert.equal(again.sounds.length, 1, "a reused clip keeps its foley");
  const retimed = plan();
  retimed.chapters[1].dialogue.turns[0].startFrame = 50;
  await applyPerformanceShots(retimed, { outputDir, shots }, { renderShot: withManifest(renderShot), mouthCues: async () => null });
  assert.equal(renders, 2);
});
test("a damaged cached clip stops production instead of being trusted", async t => {
  const outputDir = await dir(); t.after(() => rm(outputDir, { recursive: true }));
  const first = await applyPerformanceShots(plan(), { outputDir, shots }, { renderShot: withManifest(fakeRender), mouthCues: async () => null });
  await writeFile(first.assets[0].path, "tampered");
  await assert.rejects(applyPerformanceShots(plan(), { outputDir, shots }, { renderShot: withManifest(fakeRender), mouthCues: async () => null }), /changed after render/u);
});
