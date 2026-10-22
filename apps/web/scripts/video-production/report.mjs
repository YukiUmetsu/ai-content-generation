/** Mechanical release gate. It cannot replace normal-speed human viewing/listening. */
import { toFrame } from "./timeline.mjs";

const fail = (message) => { throw new Error(`Video QA failed: ${message}`); };
const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const hash = (value) => typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
const finite = (value) => typeof value === "number" && Number.isFinite(value);

/** No caller can set commercialReady. A separate verified human-review workflow is mandatory. */
export function buildQaReport({ job, timeline, audio, render, mp4, artifacts, toolVersions, reviewStatus = "not-reviewed" }) {
  const fps = job?.destination?.fps;
  if (!integer(fps?.num, 1) || !integer(fps?.den, 1) || fps.num / fps.den > 120) fail("invalid rational FPS");
  if (job.destination.presetId !== "youtube") fail("unsupported release output profile");
  if (!integer(timeline?.totalSamples, 1) || timeline.sampleRate !== 48000 || audio?.samples !== timeline.totalSamples) fail("mastered audio and timeline sample counts differ");
  if (!integer(render?.frameCount, 1) || !integer(mp4?.frameCount, 1) || render.frameCount !== mp4.frameCount) fail("rendered vs muxed frame counts differ");
  if (job.destination.width !== mp4.width || job.destination.height !== mp4.height ||
    mp4.fps?.num * fps.den !== fps.num * mp4.fps?.den) fail("MP4 raster or FPS differs from the validated plan");
  if (mp4.audioSampleRate !== 48000) fail("muxed audio must remain 48 kHz");
  const durationSeconds = timeline.totalSamples / 48000;
  const frameDuration = fps.den / fps.num;
  const videoFromFrames = mp4.frameCount * frameDuration;
  if (!finite(mp4.audioDurationSeconds) || !finite(mp4.videoDurationSeconds) ||
      Math.abs(durationSeconds - videoFromFrames) > frameDuration ||
      Math.abs(durationSeconds - mp4.audioDurationSeconds) > frameDuration ||
      Math.abs(videoFromFrames - mp4.videoDurationSeconds) > frameDuration) fail("audio/video duration drift exceeds one video frame");
  const minimumSeconds = Math.max(job.mode === "youtube-long" ? 480 : 0, job.destination.minimumDurationSeconds ?? 0);
  if (Math.min(durationSeconds, videoFromFrames, mp4.audioDurationSeconds) < minimumSeconds) fail(`finished film requires at least ${minimumSeconds} measured seconds`);
  if (!Object.hasOwn(timeline.eventSamples ?? {}, job.topic?.payoffEventId)) fail("named payoff event is missing");
  const namedPayoffFrame = toFrame(timeline.eventSamples[job.topic.payoffEventId], fps);
  if (!integer(namedPayoffFrame) || namedPayoffFrame >= mp4.frameCount) fail("named payoff event falls outside the finished movie");
  if (!finite(audio.loudness?.integratedLufs) || !finite(audio.loudness?.truePeakDbtp) || audio.loudness.truePeakDbtp > -1.45) fail("measured true peak exceeds the audio safety limit");
  if (!Array.isArray(render.segmentHashes) || render.segmentHashes.length === 0) fail("verified video segments are required");
  let frameCursor = 0;
  for (const segment of render.segmentHashes) {
    if (!hash(segment.sha256) || segment.startFrame !== frameCursor || !integer(segment.frameCount, 1) || segment.frameCount > 150) fail("segment hash or contiguous capture range is invalid");
    frameCursor += segment.frameCount;
  }
  if (frameCursor !== render.frameCount) fail("the concatenated frame range is incomplete");
  const reviewStills = render.reviewStills;
  if (!Array.isArray(reviewStills) || reviewStills.length < 2 || reviewStills.length > 5 ||
    reviewStills[0].frame !== 0 || reviewStills.at(-1).frame !== render.frameCount - 1 ||
    reviewStills.some((still, i) => !integer(still.frame) || still.frame >= render.frameCount ||
      (i > 0 && still.frame <= reviewStills[i - 1].frame) || !hash(still.sha256) ||
      still.file !== `stills/frame-${String(still.frame).padStart(6, "0")}.png`)) {
    fail("first/end review still frames need verified, ordered hashes and safe filenames");
  }
  if (!Object.values(artifacts ?? {}).length || !Object.values(artifacts).every(hash)) fail("all published artifact hashes must be valid SHA-256 values");
  if (!integer(render.peakScratchBytes, 0) || !toolVersions?.ffmpeg || !toolVersions?.ffprobe) fail("resource peak or media tool version is missing");
  if (!Array.isArray(audio.findings)) fail("audio rights/QA findings must be explicit");
  if (reviewStatus !== "not-reviewed" && reviewStatus !== "human-reviewed") fail("review status must be explicit");

  const rightsVerified = job.approval === "approved" && job.policy?.commercialRightsVerified === true &&
    job.policy?.reviewerApproved === true && job.voice?.licenseStatus === "verified" && audio.findings.every((f) => f.severity !== "error" && f.code !== "test-only-audio-not-commercial");
  return {
    schemaVersion: 1, jobId: job.id, technicalPass: true,
    commercialReady: false, releaseStatus: "draft-needs-human-review",
    rightsVerified, reviewStatus, durationSeconds, frameCount: mp4.frameCount,
    audioVideoDriftSeconds: Math.abs(durationSeconds - videoFromFrames), namedPayoffFrame,
    peakScratchBytes: render.peakScratchBytes, loudness: audio.loudness,
    artifacts, segments: render.segmentHashes, reviewStills, tools: toolVersions,
    findings: [...audio.findings, {
      severity: "warning", code: "human-review-required",
      message: "Watch and listen to the entire exported film at normal speed and verify commercial rights before publication.",
    }],
  };
}
