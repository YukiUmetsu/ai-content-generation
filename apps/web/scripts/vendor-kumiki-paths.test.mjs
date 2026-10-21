import assert from "node:assert/strict";
import test from "node:test";
import { dedupeVendorFiles, targetForRegistryFile } from "./vendor-kumiki-paths.mjs";

test("preserves registry namespaces so relative imports remain valid", () => {
  assert.equal(targetForRegistryFile("registry/ui/button.tsx"), "src/components/ui/button.tsx");
  assert.equal(targetForRegistryFile("registry/media/artboard.tsx"), "src/components/media/artboard.tsx");
  assert.equal(targetForRegistryFile("registry/infographic/types.ts"), "src/components/infographic/types.ts");
  assert.equal(targetForRegistryFile("registry/motion/types.ts"), "src/components/motion/types.ts");
  assert.equal(targetForRegistryFile("registry/video/platform-presets.json"), "src/components/video/platform-presets.json");
});

test("rejects unsafe or non-registry source paths", () => {
  assert.throws(() => targetForRegistryFile("../registry/ui/button.tsx"), /begin with/);
  assert.throws(() => targetForRegistryFile("registry/../secret.ts"), /Unsafe/);
  assert.throws(() => targetForRegistryFile("registry/ui//button.tsx"), /Unsafe/);
  assert.throws(() => targetForRegistryFile("registry/ui/button.tsx", "../outside"), /Unsafe/);
});

test("deduplicates the same source included through multiple registry dependencies", () => {
  const files = [
    { item: "motion-track", source: "registry/motion/storyboard.ts", target: "src/components/motion/storyboard.ts" },
    { item: "scene-storyboard", source: "registry/motion/storyboard.ts", target: "src/components/motion/storyboard.ts" },
  ];
  assert.deepEqual(dedupeVendorFiles(files), [files[0]]);
});

test("rejects different registry sources targeting the same file", () => {
  assert.throws(() => dedupeVendorFiles([
    { source: "registry/a/types.ts", target: "src/components/types.ts" },
    { source: "registry/b/types.ts", target: "src/components/types.ts" },
  ]), /target collision/);
});
