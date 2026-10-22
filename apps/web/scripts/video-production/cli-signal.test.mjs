import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const fixture = JSON.parse(readFileSync(new URL("../../../../examples/video-production-house-math-smoke.json", import.meta.url), "utf8"));
const exists = async (p) => stat(p).then(() => true, () => false);

test("real SIGINT reaches production AbortSignal and lets owned staging clean up", { timeout: 12000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "contentgen-cli-signal-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const job = structuredClone(fixture);
  job.voice = { profileId: "synthetic", provider: "local", modelId: "local", voiceId: "authorized", locale: "en-US", endpoint: "http://127.0.0.1:8765", licenseStatus: "test-only" };
  const jobPath = join(dir, "job.json"), ready = join(dir, "ready"), cleanup = join(dir, "cleaned");
  await writeFile(jobPath, JSON.stringify(job));
  const args = ["--job", jobPath, "--out", join(dir, "export"), "--provider", "local", "--provider-revision", "bridge-v1", "--local-voice-authorized", "--allow-test-assets"];
  const code = `
    import { main } from ${JSON.stringify(new URL("./cli.mjs", import.meta.url).href)};
    import { writeFile } from "node:fs/promises";
    const result = await main(${JSON.stringify(args)}, {
      env: {}, probeTool: async () => ({ available: true }),
      inspectRenderBuild: async () => "b".repeat(64),
      produceVideo: async (_job, options) => {
        const keepAlive = setInterval(() => {}, 100);
        // Arm abort before publishing the ready marker: the parent may send SIGINT
        // as soon as the file appears. Otherwise an early abort is lost forever.
        // A signal may arrive while writing the ready marker. Keep the promise
        // fulfilled until it is awaited so Node cannot report an unhandled
        // rejection before the cancellation path attaches its handler.
        const aborted = new Promise((resolve) => {
          const onAbort = () => resolve();
          if (options.signal?.aborted) onAbort();
          else options.signal?.addEventListener("abort", onAbort, { once: true });
        });
        try {
          await writeFile(${JSON.stringify(ready)}, "started");
          // Model a short I/O gap: SIGINT can arrive immediately after ready is written.
          await new Promise(resolve => setTimeout(resolve, 100));
          await aborted;
          throw new Error("cancelled");
        }
        finally { clearInterval(keepAlive); await writeFile(${JSON.stringify(cleanup)}, "clean"); }
      },
    });
    process.exitCode = result;
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  for (let i = 0; i < 80 && !await exists(ready); i++) await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(await exists(ready), true, "child reached real production with a pending AbortSignal");
  const exitPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(async () => reject(new Error(`child did not exit after SIGINT (pid=${child.pid}, cleaned=${await exists(cleanup)}, stderr=${stderr})`)), 8000);
    child.once("exit", (exitCode, signal) => { clearTimeout(timeout); resolve({ exitCode, signal }); });
  });
  assert.equal(child.kill("SIGINT"), true);
  const outcome = await exitPromise;
  assert.deepEqual(outcome, { exitCode: 130, signal: null });
  assert.equal(await readFile(cleanup, "utf8"), "clean");
});
