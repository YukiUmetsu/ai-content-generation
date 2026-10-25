import { describe, expect, it } from "vitest";
import { HVAC_EXAMPLE } from "./hvac-example";
import { cloneStoryboard, type SemanticStoryboard } from "./types";
import { countBySeverity, diagnosticsForBeat, validateStoryboard } from "./validate";

function board(): SemanticStoryboard {
  return cloneStoryboard(HVAC_EXAMPLE);
}

function codes(value: SemanticStoryboard): string[] {
  return validateStoryboard(value).map((diagnostic) => diagnostic.code);
}

describe("the example fixture", () => {
  it("has no structural or narrative findings", () => {
    expect(validateStoryboard(HVAC_EXAMPLE)).toEqual([]);
  });

  it("is deterministic across repeated runs", () => {
    const changed = board();
    changed.beats[0].narration = "";
    changed.beats[0].durationFrames = 0;
    expect(validateStoryboard(changed)).toEqual(validateStoryboard(changed));
  });
});

describe("structural checks", () => {
  it("reports an empty storyboard", () => {
    const value = board();
    value.beats = [];
    expect(codes(value)).toContain("storyboard-no-beats");
  });

  it("reports duplicate beat ids", () => {
    const value = board();
    value.beats.push({ ...value.beats[0] });
    expect(codes(value)).toContain("storyboard-duplicate-beat-id");
  });

  it("reports a missing opening hook", () => {
    const value = board();
    value.beats[0].role = "setup";
    expect(codes(value)).toEqual(["storyboard-no-opening-hook"]);
  });

  it("reports invalid durations and fps", () => {
    const value = board();
    value.beats[0].durationFrames = 0;
    value.fps = { num: 0, den: 1 };
    expect(codes(value)).toEqual(
      expect.arrayContaining(["storyboard-invalid-duration", "storyboard-invalid-fps"])
    );
  });

  it("reports unknown semantic objects", () => {
    const value = board();
    value.beats[0].semanticObjects.push("not-an-object");
    expect(codes(value)).toContain("storyboard-object-unknown");
  });

  it("reports an event whose object the beat does not reference", () => {
    const value = board();
    value.beats[1].semanticObjects = value.beats[1].semanticObjects.filter(
      (id) => id !== "equipment-price"
    );
    expect(codes(value)).toContain("storyboard-event-without-object");
  });

  it("reports a camera move with no focus target", () => {
    const value = board();
    value.beats[0].focusTarget = "";
    value.beats[0].cameraIntent = "Orbit the unit.";
    expect(codes(value)).toEqual(
      expect.arrayContaining(["storyboard-focus-missing", "storyboard-camera-without-focus"])
    );
  });

  it("reports missing static fallback", () => {
    const value = board();
    value.beats[1].staticFallback = "";
    expect(codes(value)).toContain("storyboard-static-fallback-missing");
  });
});

describe("narrative and copy checks", () => {
  it("reports missing narration, objective and visual objective", () => {
    const value = board();
    value.beats[0].narration = "   ";
    value.beats[0].objective = "";
    value.beats[0].visualObjective = "";
    expect(codes(value)).toEqual(
      expect.arrayContaining([
        "storyboard-narration-missing",
        "storyboard-objective-missing",
        "storyboard-visual-objective-missing",
      ])
    );
  });

  it("reports missing and overly long on-screen text", () => {
    const missing = board();
    missing.beats[0].onScreenText = "";
    expect(codes(missing)).toContain("storyboard-on-screen-text-missing");

    const long = board();
    long.beats[0].onScreenText = "x".repeat(65);
    const diagnostic = validateStoryboard(long).find(
      (item) => item.code === "storyboard-on-screen-text-long"
    );
    expect(diagnostic?.params).toEqual({ id: "beat-hook", count: 65, max: 64 });
  });

  it("reports a question that never receives a payoff", () => {
    const value = board();
    delete value.beats[4].answersQuestion;
    const diagnostic = validateStoryboard(value).find(
      (item) => item.code === "storyboard-question-unanswered"
    );
    expect(diagnostic?.questionId).toBe("q-hvac-total");
  });

  it("reports unknown questions in both directions", () => {
    const value = board();
    value.beats[0].opensQuestion = "q-missing";
    value.beats[4].answersQuestion = "q-also-missing";
    expect(codes(value)).toEqual(
      expect.arrayContaining(["storyboard-opens-question-unknown", "storyboard-question-unknown"])
    );
  });

  it("reports unknown claim references", () => {
    const value = board();
    value.beats[0].claimRefs.push("claim-missing");
    expect(codes(value)).toContain("storyboard-claim-unknown");
  });

  it("reports a sourced claim with no sources as unresolved", () => {
    const value = board();
    value.claims.push({
      id: "claim-sourced-empty",
      status: "sourced",
      note: "No source yet",
      sourceRefs: [],
    });
    value.beats[0].claimRefs.push("claim-sourced-empty");
    expect(codes(value)).toContain("storyboard-claim-unresolved");
  });

  it("does not call a source-linked but unverified claim missing evidence", () => {
    const value = board();
    value.claims.push({
      id: "claim-source-linked",
      status: "unverified",
      note: "Claim has a source but still needs a human factual review.",
      sourceRefs: ["source_01"],
    });
    value.beats[0].claimRefs.push("claim-source-linked");
    const findings = validateStoryboard(value).filter(item => item.params?.claimId === "claim-source-linked");
    expect(findings.some(item => item.code === "storyboard-claim-unresolved")).toBe(false);
  });

  it("reports an unverified claim with no source reference as unresolved", () => {
    const value = board();
    value.claims.push({
      id: "claim-unlinked",
      status: "unverified",
      note: "A claim without captured evidence.",
      sourceRefs: [],
    });
    value.beats[0].claimRefs.push("claim-unlinked");
    expect(validateStoryboard(value).some(item =>
      item.code === "storyboard-claim-unresolved" && item.params?.claimId === "claim-unlinked")).toBe(true);
  });

  it("reports illustrative claims without an illustrative-data label", () => {
    const value = board();
    value.illustrativeData = false;
    expect(codes(value)).toContain("storyboard-illustrative-unlabeled");
  });

  it("reports narration that is materially over the allotted time", () => {
    const value = board();
    value.beats[0].durationFrames = 150;
    expect(codes(value)).toContain("storyboard-narration-over-budget");
  });
});

describe("helper queries", () => {
  it("counts severities and filters by beat", () => {
    const value = board();
    value.beats[0].narration = "";
    value.beats[1].durationFrames = 0;
    const diagnostics = validateStoryboard(value);
    const counts = countBySeverity(diagnostics);
    expect(counts).toEqual({ errors: 1, warnings: 1 });
    expect(diagnosticsForBeat(diagnostics, "beat-hook")).toHaveLength(1);
    expect(diagnosticsForBeat(diagnostics, "beat-equipment")).toHaveLength(1);
  });
});

describe("editorial repetition warnings", () => {
  it("flags repeated teaching copy across separate scenes without blocking the draft", () => {
    const value=board();
    value.beats[1].onScreenText="Hidden costs: permits and ductwork";
    value.beats[2].onScreenText="Hidden labor and permits drive the costs";
    const issue=validateStoryboard(value).find(x=>x.code==="storyboard-repeated-information");
    expect(issue).toMatchObject({severity:"warning",beatId:value.beats[2].id,
      params:{previousIndex:2,field:"onScreenText"}});
  });
  it("does not confuse a new operation with a repeated idea merely because both mention costs", () => {
    expect(validateStoryboard(HVAC_EXAMPLE)).toEqual([]);
  });
});
