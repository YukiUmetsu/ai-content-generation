import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { inspectProduction, main, parseCliArgs, validateOutputTarget } from "./cli.mjs";

const job = JSON.parse(readFileSync(new URL("../../../../examples/video-production-house-math-smoke.json", import.meta.url), "utf8"));

test("reads CLI flags and refuses unknown arguments", () => {
  assert.deepEqual(parseCliArgs(["--", "--job", "./fixture.json", "--provider", "fish", "--allow-network", "--dry-run", "--out", "./output"]).provider, "fish");
  assert.throws(() => parseCliArgs(["--mystery"]), /unknown/i);
  const complete = parseCliArgs(["--job", "fixture.json", "--out", "./owned-output", "--provider", "local", "--provider-revision", "qwen-mlx-v1", "--local-voice-authorized", "--allow-test-assets", "--browser-executable", "/usr/bin/chromium"]);
  assert.equal(complete.localVoiceAuthorized, true);
  assert.equal(complete.allowTestAssets, true);
  assert.equal(complete.providerRevision, "qwen-mlx-v1");
  assert.equal(complete.browserExecutable, "/usr/bin/chromium");
});

test("dry-run inspects config without sending requests or rendering", async () => {
  let toolChecks = 0;
  const result = await inspectProduction(job, {
    dryRun: true,
    provider: "fish",
    allowNetwork: false,
    budgetUsd: 0,
    out: "./production-output",
    env: { FISH_AUDIO_API_KEY: "private-token" },
    inspectRenderBuild: async () => "b".repeat(64),
    probeTool: async () => { toolChecks += 1; return { available: true, version: "test" }; },
  });
  assert.equal(toolChecks, 3);
  assert.equal(result.networkAllowed, false);
  assert.equal(result.provider, "fish");
  assert.equal(result.findings.some((item) => item.code === "network-not-approved"), true);
  assert.equal(JSON.stringify(result).includes("private-token"), false);
});

test("does not accept broad or dangerous output directories", () => {
  assert.throws(() => validateOutputTarget("/"), /output/i);
  assert.throws(() => validateOutputTarget("/tmp"), /output/i);
  assert.throws(() => validateOutputTarget(process.cwd()), /output/i);
  assert.match(validateOutputTarget("./owned-output"), /owned-output$/);
});

test("authorized CLI delegates the entire media job exactly once without leaking Fish key", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "contentgen-cli-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "job.json");
  const readyJob = structuredClone(job);
  readyJob.voice.voiceId = "licensed-reference";
  await writeFile(path, JSON.stringify(readyJob));
  let calls = 0;
  const code = await main([
    "--job", path, "--out", join(dir, "result"), "--provider", "fish", "--allow-network",
    "--voice-consent", "--transmit-text", "--allow-test-assets", "--provider-revision", "fish-api-v1",
  ], {
    env: { FISH_AUDIO_API_KEY: "secret-key" },
    probeTool: async () => ({ available: true, version: "mock" }),
    inspectRenderBuild: async () => "b".repeat(64),
    produceVideo: async (_job, options) => {
      calls++;
      assert.equal(options.apiKey, "secret-key");
      return { releaseDir: join(dir, "release"), videoPath: join(dir, "release", "video.mp4"), qa: { releaseStatus: "draft-needs-human-review", technicalPass: true, commercialReady: false } };
    },
  });
  assert.equal(code, 0);
  assert.equal(calls, 1);
});

test("preflight blocks paid Fish model and placeholder voice reference", async () => {
  const invalidVoice = structuredClone(job);
  invalidVoice.voice.modelId = "s2.1-pro";
  const opts = {
    out: "./job-output", provider: "fish", providerRevision: "fish-api-v1", allowNetwork: true,
    voiceReferenceConsent: true, textTransmissionApproved: true, paidUsageApproved: true,
    allowTestAssets: true, budgetUsd: 0, env: { FISH_AUDIO_API_KEY: "dummy" },
    probeTool: async () => ({ available: true }),
    inspectRenderBuild: async () => "b".repeat(64),
  };
  const paid = await inspectProduction(invalidVoice, opts);
  assert.equal(paid.ready, false);
  assert.equal(paid.findings.some(({ code }) => code === "paid-fish-model-unmetered"), true);
  const placeholder = await inspectProduction(job, opts);
  assert.equal(placeholder.ready, false);
  assert.equal(placeholder.findings.some(({ code }) => code === "fish-voice-missing"), true);
});

test("dry-run identifies a missing export build even when media tools appear available", async () => {
  const availableJob = structuredClone(job);
  availableJob.voice.voiceId = "authorized-reference";
  const result = await inspectProduction(availableJob, {
    provider: "fish", providerRevision: "fish-api-v1", out: "./safe-output", allowNetwork: true,
    voiceReferenceConsent: true, textTransmissionApproved: true, allowTestAssets: true,
    env: { FISH_AUDIO_API_KEY: "dummy" }, probeTool: async () => ({ available: true }),
    inspectRenderBuild: async () => { throw new Error("not built"); },
  });
  assert.equal(result.ready, false);
  assert.ok(result.findings.some(({ code }) => code === "export-build-unavailable"));
});
