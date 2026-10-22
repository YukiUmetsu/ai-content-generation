import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { produceVideo } from "./produce.mjs";

const source = JSON.parse(readFileSync(new URL("../../../../examples/video-production-house-math-smoke.json", import.meta.url), "utf8"));
const hash = (b) => createHash("sha256").update(b).digest("hex");

async function context(t) {
  const root = await mkdtemp(join(tmpdir(), "contentgen-pipeline-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const job = structuredClone(source);
  job.voice = { profileId: "local-narrator", provider: "local", modelId: "installed-mock", voiceId: "licensed", locale: "en-US", endpoint: "http://127.0.0.1:8765", licenseStatus: "test-only" };
  let providerCalls = 0, sceneCalls = 0, browserCalls = 0, closed = false;
  const injected = {
    synthesizeNarration: async (j) => {
      providerCalls += j.beats.length;
      return j.beats.map((b) => ({ id: b.id, samples: 48000, pauseAfterMs: b.pauseAfterMs, eventIds: b.eventIds, text: b.narration, wavPath: "mocked", sha256: hash(b.narration), provider: "local", modelId: "installed-mock", providerRevision: "bridge-1" }));
    },
    renderMasterAudio: async (input, options) => {
      await mkdir(options.outputDir, { recursive: true });
      const wavPath = join(options.outputDir, "master.wav"), voiceStemPath = join(options.outputDir, "voice.wav"), srtPath = join(options.outputDir, "captions.srt");
      await writeFile(wavPath, "generated-audio");
      await writeFile(voiceStemPath, "voice");
      await writeFile(srtPath, "1\n00:00:00,000 --> 00:00:01,000\nSample");
      return { wavPath, voiceStemPath, srtPath, samples: input.timeline.totalSamples, loudness: { integratedLufs: -16, truePeakDbtp: -2 }, findings: [] };
    },
    startLocalStageServer: async ({ validatedPlan }) => {
      sceneCalls++;
      assert.equal(validatedPlan.kind, "house-math-visual-plan");
      return { url: "http://127.0.0.1:9876/video-export.html", buildHash: "b".repeat(64), close: async () => { closed = true; } };
    },
    preflightExport: async () => ({ buildHash: "b".repeat(64) }),
    renderVideoSegments: async ({ manifest, outDir, reviewFrames }) => {
      browserCalls++;
      await mkdir(outDir, { recursive: true });
      const videoOnlyPath = join(outDir, "video-only.mp4");
      await writeFile(videoOnlyPath, "h264-video");
      await mkdir(join(outDir, "stills"), { recursive: true });
      const reviewStills = await Promise.all(reviewFrames.map(async (frame) => {
        const path = join(outDir, "stills", `frame-${String(frame).padStart(6, "0")}.png`);
        const bytes = Buffer.from(`captured-frame-${frame}`);
        await writeFile(path, bytes);
        return { frame, path, sha256: hash(bytes) };
      }));
      return { videoOnlyPath, frameCount: manifest.durationFrames, segmentHashes: [{ sha256: hash("seg"), startFrame: 0, frameCount: manifest.durationFrames }], reviewStills, peakScratchBytes: 10000 };
    },
    mux: async (_video, _audio, output) => { await writeFile(output, "muxed-film"); },
    probeMp4: async (_path, { fps, totalFrames, totalSamples }) => ({ width: 1920, height: 1080, fps, frameCount: totalFrames, audioSampleRate: 48000, audioDurationSeconds: totalSamples / 48000, videoDurationSeconds: totalFrames * fps.den / fps.num }),
    toolVersions: { ffmpeg: "mock-ffmpeg", ffprobe: "mock-ffprobe" },
  };
  const opts = { out: join(root, "production"), provider: "local", providerRevision: "bridge-1", localVoiceAuthorized: true, allowTestAssets: true, distRoot: join(root, "dist") };
  return { root, job, injected, opts, status: () => ({ providerCalls, sceneCalls, browserCalls, closed }) };
}

test("one command connects synthetic adapter outputs into atomically published reviewed-draft artifacts", async (t) => {
  const ctx = await context(t);
  const result = await produceVideo(ctx.job, ctx.opts, ctx.injected);
  assert.equal(ctx.status().providerCalls, 3);
  assert.equal(ctx.status().browserCalls, 1);
  assert.equal(ctx.status().closed, true);
  assert.equal(result.qa.technicalPass, true);
  assert.equal(result.qa.commercialReady, false);
  assert.ok(result.qa.findings.some(({ code, severity }) => code === "caption-reading-speed" && severity === "warning"));
  assert.match(await readFile(join(result.releaseDir, "video.mp4"), "utf8"), /muxed-film/);
  assert.deepEqual((await readdir(result.releaseDir)).sort(), ["captions.srt", "master.wav", "qa-report.json", "render-manifest.json", "stills", "video.mp4", "voice.wav"]);
  assert.equal(result.qa.reviewStills.length >= 2, true);
  for (const still of result.qa.reviewStills) {
    const bytes = await readFile(join(result.releaseDir, still.file));
    assert.equal(hash(bytes), still.sha256);
  }
  const manifest = JSON.parse(await readFile(join(result.releaseDir, "render-manifest.json"), "utf8"));
  assert.equal(manifest.buildHash, "b".repeat(64));
  assert.equal(manifest.artifacts.voice, hash(await readFile(join(result.releaseDir, "voice.wav"))));
  assert.equal(manifest.narration.length, ctx.job.beats.length);
  assert.equal(manifest.narration[0].providerRevision, "bridge-1");
  assert.equal(manifest.narration[0].sha256, hash(ctx.job.beats[0].narration));
});

test("production emits real stage transitions and forwards verified capture frame progress", async (t) => {
  const ctx = await context(t);
  const events = [];
  const originalRender = ctx.injected.renderVideoSegments;
  ctx.injected.renderVideoSegments = async (options) => {
    options.onProgress?.({ phase: "rendering", completedFrames: 90, totalFrames: 90 });
    return originalRender(options);
  };
  await produceVideo(ctx.job, { ...ctx.opts, onProgress: (event) => events.push(event) }, ctx.injected);
  const phases = events.map((event) => event.phase);
  assert.deepEqual(phases, ["browser-preflight", "narration", "timeline", "audio", "rendering", "rendering", "mux", "qa", "review"]);
  assert.deepEqual(events.find((event) => event.completedFrames === 90),
    { phase: "rendering", completedFrames: 90, totalFrames: 90 });
});

test("stage/render failure closes the local server and never publishes an incomplete release", async (t) => {
  const ctx = await context(t);
  ctx.injected.renderVideoSegments = async () => { throw new Error("mock browser crash"); };
  await assert.rejects(produceVideo(ctx.job, ctx.opts, ctx.injected), /browser crash/);
  assert.equal(ctx.status().closed, true);
  assert.equal((await readdir(ctx.opts.out)).includes("release"), false);
  assert.equal((await readdir(ctx.opts.out)).some((name) => name.startsWith(".release-staging-")), false);
});

test("denies unauthorized local voice and mismatched provider before any TTS call", async (t) => {
  const ctx = await context(t);
  await assert.rejects(produceVideo(ctx.job, { ...ctx.opts, localVoiceAuthorized: false }, ctx.injected), /voice|authoriz/i);
  await assert.rejects(produceVideo(ctx.job, { ...ctx.opts, provider: "fish" }, ctx.injected), /provider|substitution/i);
  assert.equal(ctx.status().providerCalls, 0);
});

test("final release cannot silently overwrite prior output", async (t) => {
  const ctx = await context(t);
  await produceVideo(ctx.job, ctx.opts, ctx.injected);
  await assert.rejects(produceVideo(ctx.job, ctx.opts, ctx.injected), /exists|release/i);
  assert.equal(ctx.status().browserCalls, 1);
});

test("blocks paid Fish models before any provider call when per-job spending is not metered", async (t) => {
  const ctx = await context(t);
  ctx.job.voice = { ...source.voice, modelId: "s2.1-pro", voiceId: "licensed-reference" };
  const fish = {
    ...ctx.opts, provider: "fish", allowNetwork: true, voiceReferenceConsent: true,
    textTransmissionApproved: true, apiKey: "dummy", paidUsageApproved: true, budgetUsd: 1,
  };
  await assert.rejects(produceVideo(ctx.job, fish, ctx.injected), /paid|meter|budget/i);
  assert.equal(ctx.status().providerCalls, 0);
});

test("direct pipeline call rejects budget exceeding job cap before generation", async (t) => {
  const ctx = await context(t);
  await assert.rejects(produceVideo(ctx.job, { ...ctx.opts, budgetUsd: 1 }, ctx.injected), /budget|cost/i);
  assert.equal(ctx.status().providerCalls, 0);
});

test("missing review frames aborts publication rather than claiming a complete export", async (t) => {
  const ctx = await context(t);
  ctx.injected.renderVideoSegments = async () => ({ frameCount: 90, segmentHashes: [], reviewStills: [], peakScratchBytes: 0, videoOnlyPath: "missing" });
  await assert.rejects(produceVideo(ctx.job, ctx.opts, ctx.injected), /review still|preview/i);
  assert.equal((await readdir(ctx.opts.out)).includes("release"), false);
});

test("broken renderer prerequisites fail before any provider usage or output publication", async (t) => {
  const ctx = await context(t);
  ctx.injected.preflightExport = async () => { throw new Error("built renderer missing"); };
  await assert.rejects(produceVideo(ctx.job, ctx.opts, ctx.injected), /renderer missing/);
  assert.equal(ctx.status().providerCalls, 0);
  assert.equal(ctx.status().sceneCalls, 0);
});

test("rebuilding scene between preflight and capture never publishes stale pixels", async (t) => {
  const ctx = await context(t);
  const serve = ctx.injected.startLocalStageServer;
  ctx.injected.startLocalStageServer = async (data) => ({ ...await serve(data), buildHash: "c".repeat(64) });
  await assert.rejects(produceVideo(ctx.job, ctx.opts, ctx.injected), /build|scene.*changed/i);
  assert.equal(ctx.status().browserCalls, 0);
});
