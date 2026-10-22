import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLocalStageServer } from "./stage-server.mjs";

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
