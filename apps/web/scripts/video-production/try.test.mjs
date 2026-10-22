import assert from "node:assert/strict";
import test from "node:test";
import { runGuidedTrial, findChromium } from "./try.mjs";

function harness(overrides = {}) {
  const calls = { answers: [], builds: 0, inspections: [], productions: [], saved: [] };
  const answers = ["authorized-fish-voice"];
  const deps = {
    env: { FISH_AUDIO_API_KEY: "test-secret" },
    prompt: {
      ask: async () => { calls.answers.push("voice-id"); return answers.shift(); },
      secret: async () => { calls.answers.push("secret"); return "prompted-secret"; },
      confirm: async (message) => { calls.answers.push(message); return true; },
    },
    findBrowser: async () => "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    build: async () => { calls.builds++; },
    inspect: async (job, options) => { calls.inspections.push({ job, options }); return { ready: true, findings: [], tools: {} }; },
    produce: async (job, options) => { calls.productions.push({ job, options }); return { releaseDir: `${options.out}/release`, videoPath: `${options.out}/release/video.mp4`, qa: { technicalPass: true, commercialReady: false } }; },
    saveJob: async (path, job) => { calls.saved.push({ path, job }); },
    output: () => {},
    now: () => new Date("2026-10-22T12:00:00Z"),
    random: () => "a1b2c3d4",
    home: "/Users/tester",
    ...overrides,
  };
  return { calls, deps };
}

test("finds installed macOS Chrome without browser download or environment configuration", async () => {
  const target = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const found = await findChromium({}, async (candidate) => candidate === target, "darwin");
  assert.equal(found, target);
});

test("guided dry-run creates an in-memory Fish fixture and never writes, synthesizes or renders", async () => {
  const { calls, deps } = harness();
  const result = await runGuidedTrial(["--dry-run"], deps);
  assert.equal(result.status, "preflight-only");
  assert.equal(calls.builds, 1);
  assert.equal(calls.inspections.length, 1);
  assert.equal(calls.inspections[0].job.voice.voiceId, "authorized-fish-voice");
  assert.equal(calls.inspections[0].job.voice.modelId, "s2.1-pro-free");
  assert.equal(calls.inspections[0].options.browserExecutable.includes("Google Chrome"), true);
  assert.equal(calls.productions.length, 0);
  assert.equal(calls.saved.length, 0);
  assert.equal(calls.answers.some((answer) => answer.includes("Render the smoke")), false);
});

test("interactive confirmation runs one complete video into a unique owned directory", async () => {
  const { calls, deps } = harness();
  const result = await runGuidedTrial([], deps);
  assert.equal(result.status, "rendered");
  assert.equal(calls.productions.length, 1);
  assert.equal(calls.saved.length, 1);
  const { options } = calls.productions[0];
  assert.match(options.out, /^\/Users\/tester\/Movies\/ContentGen\/smoke-20261022-120000-a1b2c3d4$/);
  assert.equal(options.apiKey, "test-secret");
  assert.equal(options.provider, "fish");
  assert.equal(options.allowNetwork, true);
  assert.equal(options.voiceReferenceConsent, true);
  assert.equal(options.textTransmissionApproved, true);
  assert.equal(options.allowTestAssets, true);
  assert.equal(calls.saved[0].path, `${options.out}/job.json`);
});

test("refused transmission consent never builds, contacts a provider or writes a job", async () => {
  const { calls, deps } = harness({ prompt: {
    ask: async () => "voice-id",
    secret: async () => "key",
    confirm: async () => false,
  } });
  const result = await runGuidedTrial([], deps);
  assert.equal(result.status, "cancelled");
  assert.equal(calls.builds, 0);
  assert.equal(calls.productions.length, 0);
  assert.equal(calls.saved.length, 0);
});

test("without a Fish key a noninteractive preflight fails clearly, never sending text", async () => {
  const { calls, deps } = harness({ env: {}, prompt: {
    ask: async () => "licensed",
    secret: async () => "",
    confirm: async () => true,
  } });
  await assert.rejects(runGuidedTrial(["--dry-run"], deps), /Fish API key|FISH_AUDIO_API_KEY/i);
  assert.equal(calls.productions.length, 0);
});

test("a hidden Fish key entered at the prompt is visible to preflight only in memory", async () => {
  const { calls, deps } = harness({ env: {}, prompt: {
    ask: async () => "licensed-voice",
    secret: async () => "prompted-secret",
    confirm: async () => true,
  } });
  const result = await runGuidedTrial(["--dry-run"], deps);
  assert.equal(result.status, "preflight-only");
  assert.equal(calls.inspections[0].options.env.FISH_AUDIO_API_KEY, "prompted-secret");
  assert.equal(calls.productions.length, 0);
});

test("local provider uses pinned engine version without Fish network access", async () => {
  const { calls, deps } = harness({ env: {
    CONTENTGEN_LOCAL_VOICE_ID: "local-voice",
    CONTENTGEN_LOCAL_MODEL_ID: "local-model",
    CONTENTGEN_LOCAL_ENGINE_VERSION: "engine-v1",
    CONTENTGEN_LOCAL_ENDPOINT: "http://127.0.0.1:8765",
  } });
  const result = await runGuidedTrial(["--provider", "local", "--dry-run"], deps);
  assert.equal(result.status, "preflight-only");
  assert.equal(calls.inspections[0].options.provider, "local");
  assert.equal(calls.inspections[0].options.allowNetwork, false);
  assert.equal(calls.inspections[0].job.voice.modelId, "local-model");
  assert.equal(calls.inspections[0].options.providerRevision, "engine-v1");
});

test("invalid options fail before browser, build or provider work", async () => {
  const { calls, deps } = harness();
  await assert.rejects(runGuidedTrial(["--render-now"], deps), /Unknown|unsupported/i);
  assert.equal(calls.builds, 0);
  assert.equal(calls.productions.length, 0);
});
