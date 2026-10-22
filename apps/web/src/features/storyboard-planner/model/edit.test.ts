import { describe, expect, it } from "vitest";
import { HVAC_EXAMPLE } from "./hvac-example";
import {
  createBeat,
  deleteBeat,
  duplicateBeat,
  insertBeat,
  moveBeat,
  nextBeatId,
  reorderBeat,
  setBeatDuration,
  updateBeat,
} from "./edit";
import { computeTimeline } from "./timeline";
import { cloneStoryboard } from "./types";

describe("beat creation and deletion", () => {
  it("creates stable sequential ids without reusing existing ones", () => {
    let board = cloneStoryboard(HVAC_EXAMPLE);
    expect(nextBeatId(board)).toBe("beat-1");
    const first = createBeat(board, { objective: "First new beat" });
    board = insertBeat(board, first);
    expect(board.beats.at(-1)?.id).toBe("beat-1");
    expect(nextBeatId(board)).toBe("beat-2");
    const second = createBeat(board);
    board = insertBeat(board, second, 1);
    expect(board.beats[1].id).toBe("beat-2");
    expect(board.beats).toHaveLength(7);
  });

  it("deletes only the requested beat and leaves others untouched", () => {
    const board = deleteBeat(HVAC_EXAMPLE, "beat-installation");
    expect(board.beats.map((beat) => beat.id)).toEqual([
      "beat-hook",
      "beat-equipment",
      "beat-evidence",
      "beat-payoff",
    ]);
    expect(board.beats[1]).toEqual(HVAC_EXAMPLE.beats[1]);
  });

  it("allows deleting every beat and reports the empty document", () => {
    let board = cloneStoryboard(HVAC_EXAMPLE);
    for (const beat of HVAC_EXAMPLE.beats) board = deleteBeat(board, beat.id);
    expect(board.beats).toEqual([]);
    expect(computeTimeline(board.beats, board.fps).totalFrames).toBe(0);
  });

  it("returns the same board when the id is absent", () => {
    expect(deleteBeat(HVAC_EXAMPLE, "missing")).toBe(HVAC_EXAMPLE);
  });
});

describe("reordering", () => {
  it("preserves every id and all content", () => {
    const board = reorderBeat(HVAC_EXAMPLE, 0, 4);
    expect(board.beats.map((beat) => beat.id)).toEqual([
      "beat-equipment",
      "beat-installation",
      "beat-evidence",
      "beat-payoff",
      "beat-hook",
    ]);
    expect(board.beats[4]).toEqual(HVAC_EXAMPLE.beats[0]);
    expect(board.beats[4].narration).toBe(HVAC_EXAMPLE.beats[0].narration);
  });

  it("moves a beat one position and clamps at the ends", () => {
    const moved = moveBeat(HVAC_EXAMPLE, "beat-equipment", -1);
    expect(moved.beats[0].id).toBe("beat-equipment");
    expect(moveBeat(HVAC_EXAMPLE, "beat-hook", -1)).toBe(HVAC_EXAMPLE);
    expect(moveBeat(moved, "beat-payoff", 1)).toBe(moved);
  });

  it("does not change the document when the index is invalid", () => {
    expect(reorderBeat(HVAC_EXAMPLE, -1, 2)).toBe(HVAC_EXAMPLE);
    expect(reorderBeat(HVAC_EXAMPLE, 99, 2)).toBe(HVAC_EXAMPLE);
  });

  it("duplicates with a fresh id and independent arrays", () => {
    const board = duplicateBeat(HVAC_EXAMPLE, "beat-hook");
    expect(board.beats[1].id).toBe("beat-1");
    expect(board.beats[1].narration).toBe(HVAC_EXAMPLE.beats[0].narration);
    expect(board.beats[1].semanticObjects).not.toBe(HVAC_EXAMPLE.beats[0].semanticObjects);
  });
});

describe("editing", () => {
  it("changes only narration and leaves unrelated metadata intact", () => {
    const board = updateBeat(HVAC_EXAMPLE, "beat-hook", { narration: "New narration." });
    const before = HVAC_EXAMPLE.beats[0];
    const after = board.beats[0];
    expect(after.narration).toBe("New narration.");
    expect({ ...after, narration: before.narration }).toEqual(before);
    expect(board.beats.slice(1)).toEqual(HVAC_EXAMPLE.beats.slice(1));
  });

  it("never changes a beat id through a patch", () => {
    const board = updateBeat(HVAC_EXAMPLE, "beat-hook", { id: "hijacked" } as never);
    expect(board.beats[0].id).toBe("beat-hook");
  });

  it("recalculates start frames after a duration edit while preserving narration", () => {
    const board = setBeatDuration(HVAC_EXAMPLE, "beat-hook", 300);
    const timeline = computeTimeline(board.beats, board.fps);
    expect(board.beats[0].narration).toBe(HVAC_EXAMPLE.beats[0].narration);
    expect(timeline.entries[1].startFrame).toBe(300);
    expect(timeline.entries[4].endFrame).toBe(1200);
    expect(timeline.totalFrames).toBe(1200);
  });

  it("preserves an invalid duration for diagnostics instead of repairing it", () => {
    const board = setBeatDuration(HVAC_EXAMPLE, "beat-hook", 0);
    expect(board.beats[0].durationFrames).toBe(0);
  });

  it("is immutable", () => {
    const before = JSON.stringify(HVAC_EXAMPLE);
    updateBeat(HVAC_EXAMPLE, "beat-hook", { narration: "changed" });
    deleteBeat(HVAC_EXAMPLE, "beat-hook");
    reorderBeat(HVAC_EXAMPLE, 0, 2);
    expect(JSON.stringify(HVAC_EXAMPLE)).toBe(before);
  });
});
