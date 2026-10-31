import test from "node:test";
import assert from "node:assert/strict";
import { SCRIPT_SCENE_MOTION, scriptSceneVisuals } from "./script-scene-visuals.mjs";

test("scene labels are phrases the narration actually says", () => {
  const narration = "File automation watches an inbox, files each invoice into the right folder, and leaves a receipt the bookkeeper can find.";
  const visuals = scriptSceneVisuals(narration);
  assert.ok(visuals);
  assert.ok(visuals.length >= 2 && visuals.length <= 5);
  for (const item of visuals) assert.ok(narration.toLocaleLowerCase().includes(item.label.toLocaleLowerCase()), item.label);
  assert.equal(visuals.some(item => /topic focus|main idea/i.test(item.label)), false);
  assert.deepEqual(SCRIPT_SCENE_MOTION, {
    revealDelayPercent: 8, revealPace: "deliberate", camera: "cinematic", transition: "cut",
  });
});

test("japanese clauses stay visible phrases from the spoken line", () => {
  const narration = "請求書は受信箱に届き、自動でフォルダへ移動し、記録が残るまで処理が続きます。";
  const visuals = scriptSceneVisuals(narration);
  assert.ok(visuals);
  for (const item of visuals) assert.ok(narration.includes(item.label), item.label);
});

test("function words alone do not invent a picture", () => {
  assert.equal(scriptSceneVisuals("It is to be as it was and it may be so for you."), null);
});
