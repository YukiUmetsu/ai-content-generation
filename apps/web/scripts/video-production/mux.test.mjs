import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { muxVideo, probeMuxedMp4 } from "./produce.mjs";

const run = promisify(execFile);

test("FFmpeg mux produces a measured AAC+H264 MP4 without dropping video frames", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "contentgen-mux-real-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const video = join(dir, "picture.mp4");
  const audio = join(dir, "speech.wav");
  const final = join(dir, "export.mp4");
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=30:d=2", "-frames:v", "60", "-c:v", "libx264", "-pix_fmt", "yuv420p", video]);
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2", "-ac", "1", "-c:a", "pcm_s16le", audio]);
  await muxVideo(video, audio, final);
  const measured = await probeMuxedMp4(final);
  assert.deepEqual([measured.width, measured.height, measured.frameCount, measured.audioSampleRate], [320, 180, 60, 48000]);
  assert.ok(Math.abs(measured.audioDurationSeconds - 2) < 1 / 30);
  assert.ok(Math.abs(measured.videoDurationSeconds - 2) < 1 / 30);
});
