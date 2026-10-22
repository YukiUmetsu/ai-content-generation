import assert from "node:assert/strict";
import test from "node:test";
import { buildQaReport } from "./report.mjs";

const base = {
  job: { id: "house", mode: "smoke", approval: "test-only", destination: { presetId: "youtube", width: 1920, height: 1080, fps: { num: 30, den: 1 } }, topic: { payoffEventId: "lifetime-total-reveal" }, voice: { licenseStatus: "unknown" }, policy: { commercialRightsVerified: false, reviewerApproved: false } },
  timeline: { totalSamples: 240000, eventSamples: { "lifetime-total-reveal": 144000 }, sampleRate: 48000 },
  audio: { samples: 240000, loudness: { integratedLufs: -16, truePeakDbtp: -2 }, findings: [] },
  render: { frameCount: 150, peakScratchBytes: 30000000, segmentHashes: [{ sha256: "a".repeat(64), startFrame: 0, frameCount: 150 }], reviewStills: [
    { frame: 0, file: "stills/frame-000000.png", sha256: "d".repeat(64) },
    { frame: 149, file: "stills/frame-000149.png", sha256: "e".repeat(64) },
  ] },
  mp4: { width: 1920, height: 1080, fps: { num: 30, den: 1 }, frameCount: 150, audioSampleRate: 48000, audioDurationSeconds: 5, videoDurationSeconds: 5 },
  artifacts: { video: "a".repeat(64), master: "b".repeat(64), captions: "c".repeat(64) },
  toolVersions: { ffmpeg: "ffmpeg 6", ffprobe: "ffprobe 6" },
  reviewStatus: "not-reviewed",
};

test("test-only film is a verifiable draft, never commercial-ready", () => {
  const report = buildQaReport(base);
  assert.equal(report.technicalPass, true);
  assert.equal(report.commercialReady, false);
  assert.equal(report.releaseStatus, "draft-needs-human-review");
  assert.equal(report.durationSeconds, 5);
  assert.equal(report.namedPayoffFrame, 90);
  assert.equal(report.peakScratchBytes, 30000000);
  assert.equal(report.reviewStills.length, 2);
});

test("long mode never passes when rendered film is shorter than 480 seconds", () => {
  const short = { ...base, job: { ...base.job, mode: "youtube-long" } };
  assert.throws(() => buildQaReport(short), /480|duration/i);
  const long = {
    ...short,
    timeline: { ...short.timeline, totalSamples: 480 * 48000 },
    audio: { ...short.audio, samples: 480 * 48000 },
    render: { ...short.render, frameCount: 480 * 30, segmentHashes: Array.from({ length: 96 }, (_, i) => ({ sha256: "a".repeat(64), startFrame: i * 150, frameCount: 150 })), reviewStills: [short.render.reviewStills[0], { frame: 480 * 30 - 1, file: "stills/frame-014399.png", sha256: "e".repeat(64) }] },
    mp4: { ...short.mp4, frameCount: 480 * 30, audioDurationSeconds: 480, videoDurationSeconds: 480 },
  };
  assert.equal(buildQaReport(long).technicalPass, true);
  assert.throws(() => buildQaReport({ ...long, job: { ...long.job, destination: { ...long.job.destination, minimumDurationSeconds: 600 } } }), /600|minimum|duration/i);
});

test("missing payoff, mismatched hash, clipped peak and audio/video drift are release blockers", () => {
  assert.throws(() => buildQaReport({ ...base, timeline: { ...base.timeline, eventSamples: {} } }), /payoff/i);
  assert.throws(() => buildQaReport({ ...base, artifacts: { ...base.artifacts, video: "invalid" } }), /hash/i);
  assert.throws(() => buildQaReport({ ...base, audio: { ...base.audio, loudness: { truePeakDbtp: 0, integratedLufs: -16 } } }), /peak/i);
  assert.throws(() => buildQaReport({ ...base, mp4: { ...base.mp4, audioDurationSeconds: 4.5 } }), /drift|duration/i);
});

test("declared approval never substitutes for playback review, licenses or measured rights", () => {
  const approved = { ...base, job: { ...base.job, approval: "approved", voice: { licenseStatus: "verified" }, policy: { commercialRightsVerified: true, reviewerApproved: true } }, reviewStatus: "not-reviewed" };
  const r = buildQaReport(approved);
  assert.equal(r.commercialReady, false);
  assert.match(r.releaseStatus, /review/i);
});

test("missing, tampered or incomplete first/end visual review frames block technical QA", () => {
  assert.throws(() => buildQaReport({ ...base, render: { ...base.render, reviewStills: [] } }), /review still|frame/i);
  assert.throws(() => buildQaReport({ ...base, render: { ...base.render, reviewStills: [{ frame: 0, file: "stills/frame-000000.png", sha256: "f".repeat(64) }] } }), /review still|frame/i);
  assert.throws(() => buildQaReport({ ...base, render: { ...base.render, reviewStills: [base.render.reviewStills[0], { frame: 149, file: "../escape.png", sha256: "e".repeat(64) }] } }), /review still|file/i);
});
