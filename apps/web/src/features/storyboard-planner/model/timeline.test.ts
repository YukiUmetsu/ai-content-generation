import { describe, expect, it } from "vitest";
import { HVAC_EXAMPLE } from "./hvac-example";
import {
  computeTimeline,
  countNarrationUnits,
  estimateNarration,
  formatRuntime,
  formatTimecode,
  isFrameInTiming,
} from "./timeline";
import { cloneStoryboard, type StoryboardBeat } from "./types";

function timing(board = HVAC_EXAMPLE) {
  return computeTimeline(board.beats, board.fps);
}

describe("computeTimeline", () => {
  it("tiles the storyboard sequentially with end-exclusive ranges", () => {
    const result = timing();
    expect(result.entries.map((entry) => [entry.startFrame, entry.endFrame])).toEqual([
      [0, 240],
      [240, 450],
      [450, 690],
      [690, 900],
      [900, 1140],
    ]);
    expect(result.totalFrames).toBe(1140);
    expect(result.totalFrames).toBe(
      result.entries.reduce((sum, entry) => sum + entry.durationFrames, 0)
    );
  });

  it("treats the boundary as the next beat and never as the previous one", () => {
    const result = timing();
    expect(isFrameInTiming(239, result.entries[0])).toBe(true);
    expect(isFrameInTiming(240, result.entries[0])).toBe(false);
    expect(isFrameInTiming(240, result.entries[1])).toBe(true);
    expect(isFrameInTiming(1140, result.entries[4])).toBe(false);
  });

  it("recalculates downstream starts when a duration changes", () => {
    const board = cloneStoryboard(HVAC_EXAMPLE);
    board.beats[1] = { ...board.beats[1], durationFrames: 300 };
    const result = timing(board);
    expect(result.entries[1].startFrame).toBe(240);
    expect(result.entries[1].endFrame).toBe(540);
    expect(result.entries[2].startFrame).toBe(540);
    expect(result.entries[4].endFrame).toBe(1230);
    expect(result.totalFrames).toBe(1230);
  });

  it("keeps starts deterministic for an invalid duration and reports a zero span", () => {
    const board = cloneStoryboard(HVAC_EXAMPLE);
    board.beats[0] = { ...board.beats[0], durationFrames: 0 };
    const result = timing(board);
    expect(result.entries[0]).toEqual({
      beatId: "beat-hook",
      startFrame: 0,
      endFrame: 0,
      durationFrames: 0,
    });
    expect(result.entries[1].startFrame).toBe(0);
    expect(result.totalFrames).toBe(900);
  });

  it("uses a safe display rate for invalid rational fps", () => {
    const board = cloneStoryboard(HVAC_EXAMPLE);
    board.fps = { num: 0, den: 1 };
    expect(timing(board).fps).toEqual({ num: 30, den: 1 });
  });
});

describe("readable time", () => {
  it("formats total runtime in seconds for both locales", () => {
    expect(formatRuntime(1140, HVAC_EXAMPLE.fps, "en")).toBe("38.0 s");
    expect(formatRuntime(1140, HVAC_EXAMPLE.fps, "ja")).toBe("38.0 秒");
  });

  it("formats a minute clock", () => {
    expect(formatTimecode(0, HVAC_EXAMPLE.fps)).toBe("0:00");
    expect(formatTimecode(90, HVAC_EXAMPLE.fps)).toBe("0:03");
    expect(formatTimecode(1140, HVAC_EXAMPLE.fps)).toBe("0:38");
    expect(formatTimecode(1800, HVAC_EXAMPLE.fps)).toBe("1:00");
  });
});

describe("narration estimate", () => {
  it("counts words for English and characters for Japanese", () => {
    const beat = HVAC_EXAMPLE.beats[0];
    expect(countNarrationUnits(beat.narration, "en")).toBe(18);
    expect(countNarrationUnits("空調の交換費用は高くなります。", "ja")).toBe(15);
  });

  it("is advisory and fits the hook's 8 second allocation", () => {
    const estimate = estimateNarration(HVAC_EXAMPLE.beats[0], HVAC_EXAMPLE.fps, "en");
    expect(estimate.estimatedFrames).toBe(216);
    expect(estimate.estimatedSeconds).toBeCloseTo(7.2, 5);
    expect(estimate.allottedSeconds).toBe(8);
    expect(estimate.status).toBe("fits");
  });

  it("flags a materially over-budget narration", () => {
    const beat: StoryboardBeat = { ...HVAC_EXAMPLE.beats[0], durationFrames: 150 };
    const estimate = estimateNarration(beat, HVAC_EXAMPLE.fps, "en");
    expect(estimate.overByFrames).toBe(66);
    expect(estimate.status).toBe("over");
  });

  it("treats an estimate within 15 percent as tight rather than over", () => {
    const beat: StoryboardBeat = { ...HVAC_EXAMPLE.beats[0], durationFrames: 200 };
    const estimate = estimateNarration(beat, HVAC_EXAMPLE.fps, "en");
    expect(estimate.estimatedFrames).toBe(216);
    expect(estimate.status).toBe("tight");
  });
});
