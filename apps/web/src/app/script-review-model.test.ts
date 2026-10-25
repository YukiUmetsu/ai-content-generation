import { describe, expect, it } from "vitest";
import {
  acceptScriptCandidate, approveScriptDraft, createScriptDraft, discardScriptCandidate,
  editScriptSection, fillScriptSection, proposeScriptCandidate, rebindEmptyScriptEvidence,
  scriptDraftKey, validateScriptDraft, type ScriptDraft,
} from "./script-review-model";

const context = {
  productionId: "production-one", projectId: "brand-main", platform: "youtube" as const,
  locale: "en" as const, title: "Why home insurance gets expensive",
  viewerQuestion: "What actually pushes insurance prices up?",
  audience: "US homeowners", angle: "Explain how risk and rebuilding costs interact",
  brandVoice: "Calm, precise, empathetic", evidenceSnapshotId: "capture-1",
};
const result = {
  narration: "Rebuilding costs and storm exposure can affect premiums, depending on the insurer and market.",
  claimRefs: ["claim-cost"], sourceRefs: ["source-1"],
};
const timestamp = "2026-10-25T12:00:00.000Z";
const filled = (): ScriptDraft => {
  let draft = createScriptDraft(context, timestamp);
  for (const section of draft.sections) {
    draft = fillScriptSection(draft, section.id, result, 0, timestamp);
  }
  return draft;
};

describe("AI-first script revision model", () => {
  it("initializes predictable stable section IDs separately for each production/platform", () => {
    const draft = createScriptDraft(context, timestamp);
    expect(draft.sections.map(s => s.id)).toEqual(["hook", "context", "mechanism", "practical", "closing"]);
    expect(draft.sections.every(s => s.text === "" && s.revision === 0)).toBe(true);
    expect(scriptDraftKey("production-one", "youtube")).not.toBe(scriptDraftKey("production-one", "tiktok"));
    expect(scriptDraftKey("production-one", "youtube")).not.toBe(scriptDraftKey("production-one", "youtube_shorts"));
    expect(scriptDraftKey("production-one", "blog")).not.toBe(scriptDraftKey("production-one", "website"));
    expect(scriptDraftKey("production-one", "youtube")).not.toBe(scriptDraftKey("production-two", "youtube"));
    expect(scriptDraftKey("production_1234567890abcdef12345678", "youtube")).toMatch(/production_1234567890abcdef12345678/);
  });

  it("fills first AI sections, rejecting delayed responses that could overwrite a manual correction", () => {
    let draft = createScriptDraft(context, timestamp);
    draft = editScriptSection(draft, "hook", "My hand-written correction is the opener.", timestamp);
    expect(() => fillScriptSection(draft, "hook", result, 0, timestamp)).toThrow(/stale/i);
    const original = draft.sections[0].text;
    draft = fillScriptSection(draft, "context", result, 0, timestamp);
    expect(draft.sections[0].text).toBe(original);
    expect(draft.sections[1].text).toBe(result.narration);
  });

  it("proposes a candidate without replacing text, then accepts only matching source revision and preserves history", () => {
    const draft = filled();
    const earlier = draft.sections[0];
    const candidate = { ...result, narration: "Imagine receiving the renewal notice: the same home, but a different price." };
    const suggested = proposeScriptCandidate(draft, "hook", candidate, earlier.revision, timestamp);
    expect(suggested.sections[0].text).toBe(earlier.text);
    expect(suggested.pending?.hook?.text).toBe(candidate.narration);
    const accepted = acceptScriptCandidate(suggested, "hook", timestamp);
    expect(accepted.sections[0].text).toBe(candidate.narration);
    expect(accepted.sections[0].history.map(h => h.text)).toEqual([result.narration, candidate.narration]);
    expect(accepted.sections.slice(1)).toEqual(draft.sections.slice(1));
    expect(accepted.pending?.hook).toBeUndefined();
  });

  it("discards candidate and prevents stale acceptance after the user edits the same section", () => {
    const draft = filled();
    const suggested = proposeScriptCandidate(draft, "hook", result, 1, timestamp);
    expect(discardScriptCandidate(suggested, "hook").sections).toEqual(draft.sections);
    const edited = editScriptSection(suggested, "hook", "User now owns this text.", timestamp);
    expect(() => acceptScriptCandidate(edited, "hook", timestamp)).toThrow(/candidate|stale/i);
    expect(edited.sections[0].text).toBe("User now owns this text.");
  });

  it("blocks approval while any section is empty and validates exact versioned documents", () => {
    expect(() => approveScriptDraft(createScriptDraft(context, timestamp), timestamp)).toThrow(/complete/i);
    expect(approveScriptDraft(filled(), timestamp).status).toBe("approved");
    expect(validateScriptDraft({ ...filled(), unknown: true })).toThrow(/unknown/i);
  });

  it("rebases only a pristine empty draft when captured evidence arrives after mount", () => {
    const pristine = createScriptDraft({ ...context, evidenceSnapshotId: "sources-empty" }, timestamp);
    expect(rebindEmptyScriptEvidence(pristine, "sources-new", timestamp).input.evidenceSnapshotId).toBe("sources-new");
    const wrote = fillScriptSection(pristine, "hook", result, 0, timestamp);
    expect(rebindEmptyScriptEvidence(wrote, "sources-new", timestamp)).toEqual(wrote);
  });
});
