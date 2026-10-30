import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approveAsset, selectApprovedSceneAsset, listSelectedSceneAssets } from "./asset-discovery.mjs";
import { prepareApprovedSceneMedia, selectedMediaFingerprint } from "./render-scene-media.mjs";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const reply = data => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
const shots = [{ shotId: "scene-roof", beatId: "beat-01" }];
const photo = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(64).fill(42), 0xff, 0xd9]);

async function setupPhoto(t) {
  const root = await mkdtemp(join(tmpdir(), "contentgen-render-media-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectId = "dossier-roof";
  const approved = await approveAsset({ projectId, shotId: "scene-roof", provider: "pexels", assetId: "49",
    assetType: "photo", confirmDownload: true, confirmRights: true }, {
    root, pexelsKey: "test", fetchImpl: async url =>
      String(url).includes("api.pexels.com") ? reply({ id: 49, url: "https://www.pexels.com/photo/roof-49/",
        alt: "Roof photograph", photographer: "A Photographer", src: { large: "https://images.pexels.com/photos/49/roof.jpg" } }) :
        new Response(photo, { headers: { "content-type": "image/jpeg" } }),
  });
  await selectApprovedSceneAsset({ projectId, shotId: "scene-roof", provider: "pexels", assetId: "49",
    sha256: approved.sha256 }, { root });
  return { root, projectId, approved, outputDir: join(root, "render", "scene-media") };
}

test("selected approved Pexels photo is frozen and bound to its exact storyboard beat", async t => {
  const ctx = await setupPhoto(t);
  const selected = await listSelectedSceneAssets({ projectId: ctx.projectId }, { root: ctx.root });
  const expected = selectedMediaFingerprint(selected, shots);
  const prepared = await prepareApprovedSceneMedia({ projectId: ctx.projectId, shotMap: shots,
    outputDir: ctx.outputDir, expectedFingerprint: expected }, { root: ctx.root });
  assert.equal(prepared.bindings["beat-01"].assetType, "photo");
  assert.equal(prepared.bindings["beat-01"].url, `/__video_media/${digest(photo)}.jpg`);
  assert.equal(prepared.bindings["beat-01"].sha256, digest(photo));
  assert.equal(prepared.bindings["beat-01"].creator, "A Photographer");
  assert.deepEqual(await readFile(prepared.assets[0].path), photo);
  assert.equal(prepared.assets[0].url, prepared.bindings["beat-01"].url);
  const again = await prepareApprovedSceneMedia({ projectId: ctx.projectId, shotMap: shots,
    outputDir: ctx.outputDir, expectedFingerprint: expected }, { root: ctx.root });
  assert.deepEqual(again.bindings, prepared.bindings, "retries reuse an intact frozen artifact");
});

test("changing only a scene photo's focal position changes its render identity but keeps the same verified bytes",async t=>{
  const ctx=await setupPhoto(t);
  const before=await listSelectedSceneAssets({projectId:ctx.projectId},{root:ctx.root});
  const oldFingerprint=selectedMediaFingerprint(before,shots);
  await selectApprovedSceneAsset({projectId:ctx.projectId,shotId:"scene-roof",provider:"pexels",
    assetId:"49",sha256:ctx.approved.sha256,focalPoint:{x:.2,y:.75}},{root:ctx.root});
  const changed=await listSelectedSceneAssets({projectId:ctx.projectId},{root:ctx.root});
  const fingerprint=selectedMediaFingerprint(changed,shots);
  assert.notEqual(fingerprint,oldFingerprint);
  await assert.rejects(prepareApprovedSceneMedia({projectId:ctx.projectId,shotMap:shots,
    outputDir:ctx.outputDir,expectedFingerprint:oldFingerprint},{root:ctx.root}),/changed after readiness/i);
  const output=await prepareApprovedSceneMedia({projectId:ctx.projectId,shotMap:shots,
    outputDir:ctx.outputDir,expectedFingerprint:fingerprint},{root:ctx.root});
  assert.deepEqual(output.bindings["beat-01"].focalPoint,{x:.2,y:.75});
  assert.equal(output.bindings["beat-01"].sha256,ctx.approved.sha256);
  assert.deepEqual(await readFile(output.assets[0].path),photo);
});

test("changed and unsupported selections fail before any narration can be synthesized", async t => {
  const ctx = await setupPhoto(t);
  const original = await listSelectedSceneAssets({ projectId: ctx.projectId }, { root: ctx.root });
  await writeFile(ctx.approved.localPath, Buffer.from("unrelated-image"));
  await assert.rejects(prepareApprovedSceneMedia({ projectId: ctx.projectId, shotMap: shots,
    outputDir: ctx.outputDir, expectedFingerprint: selectedMediaFingerprint(original, shots) },
  { root: ctx.root }), /changed|invalid|missing/i);
  const unexpected = { selections: [{ ...original.selections[0], provider: "polyhaven", assetType: "model" }], invalidShots: [] };
  assert.throws(() => selectedMediaFingerprint(unexpected, shots), /unsupported/i);
});

test("approved Pexels footage receives an independently probed, frame-seekable media binding", async t => {
  const root = await mkdtemp(join(tmpdir(), "contentgen-footage-render-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypisom"), Buffer.alloc(80)]);
  const source = join(root, "clip.mp4");
  await writeFile(source, bytes);
  const selection = { projectId: "project", shotId: "scene-roof", provider: "pexels", assetId: "83",
    assetType: "video", sha256: digest(bytes), localPath: source, sizeBytes: bytes.length,
    rightsStatus: "user-reviewed", sourceUrl: "https://www.pexels.com/video/roof-83/",
    license: "Pexels License", licenseUrl: "https://www.pexels.com/license/", creator: "Film Artist" };
  const loaded = { selections: [selection], invalidShots: [] };
  const calls = [];
  const result = await prepareApprovedSceneMedia({ projectId: "project", shotMap: shots,
    outputDir: join(root, "output"), expectedFingerprint: selectedMediaFingerprint(loaded, shots) }, {
    root, listSelections: async () => loaded, probeFootage: async path => {
      calls.push(path); return { codec: "h264", width: 1280, height: 720, durationSeconds: 12 };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(result.bindings["beat-01"].assetType, "video");
  assert.equal(result.bindings["beat-01"].durationSeconds, 12);
  assert.match(result.bindings["beat-01"].url, /\.mp4$/);
  assert.deepEqual(await readFile(result.assets[0].path), bytes);
  await assert.rejects(prepareApprovedSceneMedia({ projectId: "project", shotMap: shots,
    outputDir: join(root, "bad"), expectedFingerprint: selectedMediaFingerprint(loaded, shots) }, {
    root, listSelections: async () => loaded, probeFootage: async () => ({ codec: "hevc", width: 1280, height: 720, durationSeconds: 12 }),
  }), /H\.264|codec/i);
  const outside = join(root, "outside.mp4");
  await symlink(source, outside);
  await assert.rejects(prepareApprovedSceneMedia({ projectId: "project", shotMap: shots,
    outputDir: join(root, "linked"), expectedFingerprint: selectedMediaFingerprint(loaded, shots) }, {
    root, listSelections: async () => ({ selections: [{ ...selection, localPath: outside }], invalidShots: [] }),
    probeFootage: async () => ({ codec: "h264", width: 1280, height: 720, durationSeconds: 12 }),
  }), /symbolic|link/i);
  const elsewhere = await mkdtemp(join(tmpdir(), "contentgen-media-outside-"));
  t.after(() => rm(elsewhere, { recursive: true, force: true }));
  await writeFile(join(elsewhere, "clip.mp4"), bytes);
  await symlink(elsewhere, join(root, "linked-parent"));
  await assert.rejects(prepareApprovedSceneMedia({ projectId: "project", shotMap: shots,
    outputDir: join(root, "parent-link"), expectedFingerprint: selectedMediaFingerprint(loaded, shots) }, {
    root, listSelections: async () => ({ selections: [{ ...selection,
      localPath: join(root, "linked-parent", "clip.mp4") }], invalidShots: [] }),
    probeFootage: async () => ({ codec: "h264", width: 1280, height: 720, durationSeconds: 12 }),
  }), /outside|escapes|symbolic|link/i);
});
