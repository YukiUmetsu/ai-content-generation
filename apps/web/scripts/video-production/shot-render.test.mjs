import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { kumikiBlenderTool, renderPerformanceShot, shotCacheKey } from "./shot-render.mjs";

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
test("a cancelled render fails and reports no shot", async t => {
  const root = await mkdtemp(join(tmpdir(), "shot-cancel-"));
  t.after(() => rm(root, { recursive: true }));
  await mkdir(join(root, "pack"));
  await writeFile(join(root, "pack/character.json"), JSON.stringify({ characterId: "c", revision: "r1" }));
  await writeFile(join(root, "rig.json"), JSON.stringify({ height_m: .2, effectors: {} }));
  const script = join(root, "kumiki_blender.py"), bake = join(root, "bake.mjs");
  await writeFile(bake, `import { writeFileSync } from "node:fs"; writeFileSync(process.argv[3], JSON.stringify({ contacts: [] }));`);
  await writeFile(script, "");
  const controller = new AbortController();
  const python = join(root, "python");
  await writeFile(python, "#!/bin/sh\nexec sleep 30\n", { mode: 0o755 });
  const running = renderPerformanceShot({ root, intent: { durationFrames: 1, fps: { num: 30, den: 1 }, cast: [], objects: [], actions: [], shots: [] }, cast: [], grips: {},
    speechWindows: {}, shotId: "s", output: join(root, "out"), signal: controller.signal }, { tool: { python, env: process.env }, bakeEntry: bake });
  setTimeout(() => controller.abort(), 200);
  await assert.rejects(running);
  await assert.rejects(access(join(root, "out")));
});
