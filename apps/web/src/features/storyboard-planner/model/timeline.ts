/**
 * Timeline + readability estimates.
 *
 * Authors own integer frame durations; starts are always derived, never stored.
 * This guarantees a gap-free, overlap-free, end-exclusive tiling:
 * `[0, totalFrames)` where `totalFrames === sum(durationFrames)`.
 */

import { framesToSeconds } from "@/components/motion/constants";
import {
  DEFAULT_FPS,
  isPositiveInteger,
  type Locale,
  type RationalFps,
  type StoryboardBeat,
} from "./types";

export interface BeatTiming {
  beatId: string;
  /** Inclusive start. */
  startFrame: number;
  /** Exclusive end. */
  endFrame: number;
  durationFrames: number;
}

export interface Timeline {
  entries: BeatTiming[];
  totalFrames: number;
  fps: RationalFps;
}

export interface NarrationEstimate {
  /** Words (English) or non-whitespace characters (Japanese) counted. */
  units: number;
  estimatedSeconds: number;
  estimatedFrames: number;
  allottedSeconds: number;
  /** Positive when the estimate exceeds the allotted time. */
  overByFrames: number;
  status: "fits" | "tight" | "over";
}

/** Fallback FPS only for display when the authored value is structurally invalid. */
function displayFps(fps: RationalFps): RationalFps {
  return isPositiveInteger(fps.num) && isPositiveInteger(fps.den) ? fps : DEFAULT_FPS;
}

/**
 * Sequential timeline. A structurally invalid duration is treated as a zero
 * span so downstream starts stay deterministic while validation reports it.
 * The invalid beat still receives an entry (zero length), never a gap.
 */
export function computeTimeline(beats: StoryboardBeat[], fps: RationalFps): Timeline {
  const safeFps = displayFps(fps);
  const entries: BeatTiming[] = [];
  let cursor = 0;
  for (const beat of beats) {
    const valid = isPositiveInteger(beat.durationFrames);
    const duration = valid ? beat.durationFrames : 0;
    entries.push({
      beatId: beat.id,
      startFrame: cursor,
      endFrame: cursor + duration,
      durationFrames: duration,
    });
    cursor += duration;
  }
  return { entries, totalFrames: cursor, fps: safeFps };
}

/** Readable `m:ss` clock (floor), used for the total runtime. */
export function formatTimecode(frames: number, fps: RationalFps): string {
  const safeFps = displayFps(fps);
  const seconds = framesToSeconds(Math.max(0, frames), safeFps);
  const whole = Math.floor(seconds + 1e-9);
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

/** One-decimal seconds, localized. */
export function formatSeconds(seconds: number, locale: Locale): string {
  const value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return locale === "ja" ? `${value.toFixed(1)} 秒` : `${value.toFixed(1)} s`;
}

export function formatRuntime(frames: number, fps: RationalFps, locale: Locale): string {
  return formatSeconds(framesToSeconds(Math.max(0, frames), displayFps(fps)), locale);
}

export function countNarrationUnits(text: string, locale: Locale): number {
  if (locale === "ja") {
    return Array.from(text.replace(/\s+/g, "")).length;
  }
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
}

/**
 * Advisory narration-length estimate. English uses 150 words/min, Japanese
 * 330 characters/min. This is a planning heuristic only — it makes no claim
 * about actual TTS output or audio alignment.
 */
export function estimateNarration(
  beat: StoryboardBeat,
  fps: RationalFps,
  locale: Locale
): NarrationEstimate {
  const safeFps = displayFps(fps);
  const units = countNarrationUnits(beat.narration, locale);
  const perMinute = locale === "ja" ? 330 : 150;
  const estimatedSeconds = (units / perMinute) * 60;
  const estimatedFrames = Math.round((estimatedSeconds * safeFps.num) / safeFps.den);
  const allottedSeconds = framesToSeconds(
    isPositiveInteger(beat.durationFrames) ? beat.durationFrames : 0,
    safeFps
  );
  const overByFrames = Math.max(0, estimatedFrames - (isPositiveInteger(beat.durationFrames) ? beat.durationFrames : 0));
  return {
    units,
    estimatedSeconds,
    estimatedFrames,
    allottedSeconds,
    overByFrames,
    status:
      estimatedFrames <= (isPositiveInteger(beat.durationFrames) ? beat.durationFrames : 0)
        ? "fits"
        : estimatedSeconds > allottedSeconds * 1.15
          ? "over"
          : "tight",
  };
}

export function findTiming(timeline: Timeline, beatId: string): BeatTiming | undefined {
  return timeline.entries.find((entry) => entry.beatId === beatId);
}

/** End-exclusive containment. */
export function isFrameInTiming(frame: number, timing: BeatTiming): boolean {
  return Number.isFinite(frame) && frame >= timing.startFrame && frame < timing.endFrame;
}
