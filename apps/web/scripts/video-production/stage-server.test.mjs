import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLocalStageServer, fingerprintBuiltStage } from "./stage-server.mjs";
import { createHash } from "node:crypto";

test("loopback server returns validated plan and built stage with restrictive headers", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "contentgen-stage-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "video-export.html"), "<html>export page</html>");
  await writeFile(join(root, "assets", "main.js"), "window.__stageSmoke=true;");
  const plan = { schemaVersion: 1, name: "house-math", safe: true };
  const server = await startLocalStageServer({ distRoot: root, validatedPlan: plan });
  t.after(() => server.close());
  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/video-export\.html$/);
  const response = await fetch(server.url);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /export page/);
  assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
  const api = await fetch(new URL("/__video_job", server.url));
  assert.deepEqual(await api.json(), plan);
  assert.equal(api.headers.get("cache-control"), "no-store");
  const script = await fetch(new URL("/assets/main.js", server.url));
  assert.equal(script.headers.get("content-type"), "text/javascript; charset=utf-8");
  const identity = await fetch(new URL("/__video_build", server.url));
  assert.equal((await identity.json()).sha256, server.buildHash);
});

test("no directory traversal, source-map access, external host binding or non-GET", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "contentgen-stage-safety-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "video-export.html"), "okay");
  await writeFile(join(root, "secret.map"), "do-not-expose");
  await assert.rejects(startLocalStageServer({ distRoot: root, validatedPlan: {}, host: "0.0.0.0" }), /loopback/i);
  const server = await startLocalStageServer({ distRoot: root, validatedPlan: { schemaVersion: 1 } });
  t.after(() => server.close());
  assert.equal((await fetch(new URL("/secret.map", server.url))).status, 404);
  assert.equal((await fetch(new URL("/%2e%2e/%2e%2e/etc/passwd", server.url))).status, 404);
  assert.equal((await fetch(new URL("/__video_job", server.url), { method: "POST" })).status, 405);
});

test("renderer identity changes with served scene JS/fonts but not an unrelated sourcemap", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "contentgen-stage-fingerprint-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "video-export.html"), "<script src='/assets/scene.js'></script>");
  await writeFile(join(root, "assets", "scene.js"), "scene-v1");
  const first = await fingerprintBuiltStage(root);
  assert.match(first, /^[a-f0-9]{64}$/);
  await writeFile(join(root, "assets", "scene.js"), "scene-v2");
  const second = await fingerprintBuiltStage(root);
  assert.notEqual(second, first);
  await writeFile(join(root, "assets", "ignored.map"), "not-a-served-asset");
  assert.equal(await fingerprintBuiltStage(root), second);
});

test("capture host serves only frozen media with a valid SHA-256 and a safe content type", async t => {
  const root = await mkdtemp(join(tmpdir(), "contentgen-stage-media-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "video-export.html"), "stage");
  const source = join(root, "private-photo.jpg");
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 0xff, 0xd9]);
  await writeFile(source, bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const url = `/__video_media/${sha256}.jpg`;
  const server = await startLocalStageServer({ distRoot: root, validatedPlan: { schemaVersion: 1 },
    approvedMedia: [{ url, path: source, sha256, assetType: "photo" }] });
  t.after(() => server.close());
  const served = await fetch(new URL(url, server.url));
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), bytes);
  const partial = await fetch(new URL(url, server.url), { headers: { Range: "bytes=2-6" } });
  assert.equal(partial.status, 206, "Chromium needs byte ranges to seek through reviewed MP4s");
  assert.equal(partial.headers.get("content-range"), `bytes 2-6/${bytes.length}`);
  assert.equal(partial.headers.get("accept-ranges"), "bytes");
  assert.deepEqual(Buffer.from(await partial.arrayBuffer()), bytes.subarray(2, 7));
  const lastFour = await fetch(new URL(url, server.url), { headers: { Range: "bytes=-4" } });
  assert.equal(lastFour.status, 206, "Chromium may request the tail of an MP4 to inspect its index");
  assert.deepEqual(Buffer.from(await lastFour.arrayBuffer()), bytes.subarray(-4));
  const beyondEnd = await fetch(new URL(url, server.url), { headers: { Range: "bytes=5-50000" } });
  assert.equal(beyondEnd.status, 206, "a byte-range end beyond EOF should clamp to the last byte");
  assert.deepEqual(Buffer.from(await beyondEnd.arrayBuffer()), bytes.subarray(5));
  assert.equal((await fetch(new URL(url, server.url), { headers: { Range: "bytes=9999-" } })).status, 416);
  assert.equal((await fetch(new URL("/__video_media/unknown.jpg", server.url))).status, 404);
  await writeFile(source, "tampered media");
  assert.equal((await fetch(new URL(url, server.url))).status, 404, "a changed frozen file must not reach Chromium");
  await assert.rejects(startLocalStageServer({ distRoot: root, validatedPlan: {},
    approvedMedia: [{ url: "/__video_media/../secret.jpg", path: source, sha256, assetType: "photo" }] }),
  /invalid|media|path/i);
});
