import { describe, expect, it } from "vitest";
import { HVAC_EXAMPLE } from "./hvac-example";
import { compileToKumiki, serializeKumikiProjection } from "./kumiki";
import { cloneStoryboard } from "./types";

describe("Kumiki projection", () => {
  it("maps every beat onto a gap-free storyboard with preserved fields", () => {
    const projection = compileToKumiki(HVAC_EXAMPLE);
    const shots = projection.storyboard.shots;
    expect(shots).toHaveLength(5);
    expect(shots.map((shot) => shot.id)).toEqual(HVAC_EXAMPLE.beats.map((beat) => beat.id));
    expect(shots.map((shot) => [shot.startFrame, shot.durationFrames])).toEqual([
      [0, 240],
      [240, 210],
      [450, 240],
      [690, 210],
      [900, 240],
    ]);
    expect(projection.storyboard.durationFrames).toBe(1140);
    expect(shots[0].claim).toBe(HVAC_EXAMPLE.beats[0].objective);
    expect(shots[0].visualObjective).toBe(HVAC_EXAMPLE.beats[0].visualObjective);
    expect(shots[0].focusTarget).toBe(HVAC_EXAMPLE.beats[0].focusTarget);
    expect(shots[0].onScreenLabels).toEqual([HVAC_EXAMPLE.beats[0].onScreenText]);
    expect(shots[0].sceneRef).toBe("scene-beat-hook");
    expect(shots[0].narrationCue).toBe("cue-hook");
    expect(shots[0].staticFallback).toBe(HVAC_EXAMPLE.beats[0].staticFallback);
  });

  it("passes Kumiki's own storyboard validation", () => {
    const projection = compileToKumiki(HVAC_EXAMPLE);
    expect(projection.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(projection.diagnostics).toEqual([]);
  });

  it("emits start and narration cues anchored at shot starts", () => {
    const projection = compileToKumiki(HVAC_EXAMPLE);
    expect(projection.cues).toEqual(
      expect.arrayContaining([
        { id: "shot-beat-hook", frame: 0, kind: "shot-start", targetId: "scene-beat-hook" },
        { id: "cue-hook", frame: 0, kind: "narration", targetId: "installed-quote" },
        { id: "shot-beat-payoff", frame: 900, kind: "shot-start", targetId: "scene-beat-payoff" },
      ])
    );
  });

  it("reports camera intent as unmapped instead of faking a shot field", () => {
    const projection = compileToKumiki(HVAC_EXAMPLE);
    expect("cameraIntent" in projection.storyboard.shots[0]).toBe(false);
    expect(projection.notes.filter((note) => note.code === "camera-intent-unmapped")).toEqual([
      { code: "camera-intent-unmapped", beatId: "beat-hook" },
      { code: "camera-intent-unmapped", beatId: "beat-payoff" },
    ]);
    expect(projection.notes.map((note) => note.code)).toEqual(
      expect.arrayContaining([
        "claim-provenance-authoring-only",
        "semantic-events-authoring-only",
        "questions-authoring-only",
      ])
    );
  });

  it("surfaces a structural Kumiki error for a beat without a focus target", () => {
    const board = cloneStoryboard(HVAC_EXAMPLE);
    board.beats[0].focusTarget = "";
    const projection = compileToKumiki(board);
    expect(projection.diagnostics.map((item) => item.code)).toContain("storyboard-focus-missing");
  });

  it("serializes the projection deterministically", () => {
    const first = serializeKumikiProjection(HVAC_EXAMPLE);
    const second = serializeKumikiProjection(cloneStoryboard(HVAC_EXAMPLE));
    expect(first).toBe(second);
    const parsed = JSON.parse(first) as { kind: string; adapter: string; sourceId: string };
    expect(parsed.kind).toBe("contentgen-kumiki-storyboard-projection");
    expect(parsed.adapter).toBe("storyboard-planner.kumiki-projection.v1");
    expect(parsed.sourceId).toBe(HVAC_EXAMPLE.id);
    expect(first.endsWith("\n")).toBe(true);
  });

  it("keeps the authoring document unchanged", () => {
    const before = JSON.stringify(HVAC_EXAMPLE);
    compileToKumiki(HVAC_EXAMPLE);
    expect(JSON.stringify(HVAC_EXAMPLE)).toBe(before);
  });
});
