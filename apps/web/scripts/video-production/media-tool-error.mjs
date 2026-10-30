/** Safe FFmpeg/FFprobe failure text. Raw logs and local paths never leave this function. */
import { basename } from "node:path";

const CODEC = /^[A-Za-z0-9_]{1,32}$/;
const EXIT = /^[A-Za-z0-9_+-]{1,24}$/;

function toolName(program) {
  const name = basename(String(program ?? ""));
  return name === "ffmpeg" || name === "ffprobe" ? name : "media tool";
}

function codec(match) {
  return CODEC.test(match?.[1] ?? "") ? match[1].toLowerCase() : null;
}

/**
 * A stable reason for Jobs. Returns null when the caller must rethrow a
 * cancellation instead of recording a media-tool failure.
 */
export function mediaToolFailureReason(program, error) {
  if (error?.name === "AbortError" || error?.code === "ABORT_ERR") return null;
  const tool = toolName(program);
  const text = `${error?.message ?? ""}\n${error?.stderr ?? ""}`;
  if (error?.code === "ENOENT") return `${tool} is not installed`;
  if (error?.code === "EACCES" || /\bPermission denied\b/u.test(text))
    return `${tool} cannot access a local media file`;
  if (error?.code === "ENOSPC" || /\bENOSPC\b|No space left on device/iu.test(text))
    return `${tool} failed: no space left on device`;
  const decoder = codec(text.match(/no decoder found for:\s*([A-Za-z0-9_]+)/iu))
    ?? codec(text.match(/Unknown decoder '([A-Za-z0-9_]+)'/u))
    ?? codec(text.match(/Decoder \(codec ([A-Za-z0-9_]+)\) not found/u));
  if (decoder) return `${tool} failed: no decoder found for: ${decoder}`;
  const encoder = codec(text.match(/Unknown encoder '([A-Za-z0-9_]+)'/u))
    ?? codec(text.match(/Encoder \(codec ([A-Za-z0-9_]+)\) not found/u));
  if (encoder) return `${tool} failed: unknown encoder ${encoder}`;
  if (/Invalid data found when processing input/iu.test(text))
    return `${tool} rejected a local media file`;
  if (error?.code === "ETIMEDOUT" || (error?.killed === true && error?.signal === "SIGTERM"))
    return `${tool} timed out`;
  const code = String(error?.code ?? error?.signal ?? "unknown");
  return `${tool} failed (${EXIT.test(code) ? code : "unknown"})`;
}
