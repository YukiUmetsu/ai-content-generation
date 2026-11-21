/** Measurements of finished media with FFmpeg: loudness, peak level and the longest still picture. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const fail = (message) => { throw new Error(`Media measure: ${message}`); };
const big = { maxBuffer: 16 * 1024 * 1024 };

/** Integrated loudness (EBU R128), LUFS. */
export async function measureLufs(path, { ffmpeg = "ffmpeg", signal } = {}) {
  const { stderr } = await run(ffmpeg, ["-hide_banner", "-nostats", "-nostdin", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"], { signal, ...big });
  const value = Number(/I:\s+(-?[\d.]+) LUFS/u.exec(stderr.slice(stderr.lastIndexOf("Summary:")))?.[1]);
  if (!Number.isFinite(value)) fail(`the loudness of ${path} could not be measured`);
  return value;
}

/** Highest sample, dBFS. */
export async function measurePeak(path, { ffmpeg = "ffmpeg", signal } = {}) {
  const { stderr } = await run(ffmpeg, ["-hide_banner", "-nostats", "-nostdin", "-i", path, "-af", "volumedetect", "-f", "null", "-"], { signal, ...big });
  const value = Number(/max_volume:\s+(-?[\d.]+) dB/u.exec(stderr)?.[1]);
  if (!Number.isFinite(value)) fail(`the peak of ${path} could not be measured`);
  return value;
}

/** Longest stretch in which the picture does not change (FFmpeg's freeze detector), seconds. */
export async function longestStill(videoPath, { ffmpeg = "ffmpeg", ffprobe = "ffprobe", signal, minSeconds = .5 } = {}) {
  const { stderr } = await run(ffmpeg, ["-hide_banner", "-nostdin", "-i", videoPath, "-vf", `freezedetect=n=-60dB:d=${minSeconds}`, "-map", "0:v", "-f", "null", "-"], { signal, ...big });
  const starts = [...stderr.matchAll(/freeze_start: ([\d.]+)/gu)].map(m => Number(m[1]));
  const durations = [...stderr.matchAll(/freeze_duration: ([\d.]+)/gu)].map(m => Number(m[1]));
  // A freeze still open at the end of the file has no duration line: it runs to the end.
  const { stdout } = await run(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", videoPath], { signal });
  const total = Number(stdout.trim());
  const stills = starts.map((start, i) => ({ start, seconds: durations[i] ?? Math.max(0, total - start) }));
  return stills.reduce((best, still) => still.seconds > best.seconds ? still : best, { start: 0, seconds: 0 });
}
