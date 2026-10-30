import test from "node:test";
import assert from "node:assert/strict";
import { mediaToolFailureReason } from "./media-tool-error.mjs";

test("media tool failures keep a safe reason and drop paths and logs", () => {
  assert.equal(mediaToolFailureReason("/opt/homebrew/bin/ffmpeg", { code: "ENOENT" }), "ffmpeg is not installed");
  assert.equal(mediaToolFailureReason("ffprobe", { code: "EACCES" }), "ffprobe cannot access a local media file");
  assert.equal(mediaToolFailureReason("ffmpeg", {
    code: 1,
    stderr: "No space left on device\n/Users/secret/draft.mp4",
  }), "ffmpeg failed: no space left on device");
  const decoder = mediaToolFailureReason("ffmpeg", {
    code: 234,
    stderr: "Decoding requested, but no decoder found for: svg\n/Users/secret/thumbnail-1.svg",
  });
  assert.equal(decoder, "ffmpeg failed: no decoder found for: svg");
  assert.doesNotMatch(decoder, /secret|Users/);
  assert.equal(mediaToolFailureReason("ffmpeg", {
    message: "Unknown encoder 'libx264' while writing /tmp/secret/segment.mp4",
  }), "ffmpeg failed: unknown encoder libx264");
  assert.equal(mediaToolFailureReason("ffmpeg", {
    stderr: "Invalid data found when processing input\n/private/narration.wav",
  }), "ffmpeg rejected a local media file");
  assert.equal(mediaToolFailureReason("ffprobe", { killed: true, signal: "SIGTERM" }), "ffprobe timed out");
  const generic = mediaToolFailureReason("ffmpeg", {
    code: 1,
    stderr: "filtergraph failed near /Users/secret/script.txt",
  });
  assert.equal(generic, "ffmpeg failed (1)");
  assert.doesNotMatch(generic, /secret|script/);
  assert.equal(mediaToolFailureReason("ffmpeg", { name: "AbortError", code: "ABORT_ERR" }), null);
});
