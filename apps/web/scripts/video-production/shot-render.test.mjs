import assert from "node:assert/strict";
import { test } from "node:test";
import { kumikiBlenderTool, shotCacheKey } from "./shot-render.mjs";

const base = { intent: { objective: "o" }, speechWindows: { a: { startFrame: 1, endFrame: 9 } }, assetHashes: { pack: "1" }, tools: { blender: "5.2.3" }, render: { profile: "review" } };

test("the key ignores object key order", () => {
  assert.equal(shotCacheKey(base), shotCacheKey({ render: base.render, tools: base.tools, assetHashes: base.assetHashes, speechWindows: base.speechWindows, intent: base.intent }));
});
for (const [name, change] of [
  ["narration timing", { speechWindows: { a: { startFrame: 2, endFrame: 9 } } }],
  ["the intent", { intent: { objective: "x" } }],
  ["an asset", { assetHashes: { pack: "2" } }],
  ["the tools", { tools: { blender: "5.3" } }],
  ["the render profile", { render: { profile: "final" } }],
]) test(`a change to ${name} forces a new render`, () => assert.notEqual(shotCacheKey(base), shotCacheKey({ ...base, ...change })));
test("a missing tool fails with the setting to change", () => {
  assert.throws(() => kumikiBlenderTool({}), /KUMIKI_BLENDER_ROOT/u);
});
