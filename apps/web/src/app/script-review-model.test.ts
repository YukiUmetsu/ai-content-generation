import { describe, expect, it } from "vitest";
import {
  acceptScriptCandidate, approveScriptDraft, createScriptDraft, discardScriptCandidate,
  copyShortFormScript, editScriptSection, fillScriptSection, insertScriptSection, isScriptContextCurrent, proposeScriptCandidate, rebaseScriptDraftContext, rebindEmptyScriptEvidence, restoreScriptRevision,
  scriptDraftKey, scriptEvidenceFingerprint, validateScriptDraft, type ScriptDraft,
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
  it("copies an accepted Shorts script into an empty TikTok draft with references and traceable revisions", () => {
    const source = approveScriptDraft({ ...filled(), input: { ...context, platform: "youtube_shorts" } }, timestamp);
    const targetContext = { ...context, platform: "tiktok" as const };
    const copied = copyShortFormScript(source, targetContext, null, { now: timestamp });
    expect(copied.input.platform).toBe("tiktok");
    expect(copied.status).toBe("draft");
    expect(copied.approvedAt).toBeNull();
    expect(copied.sections.map((item) => item.text)).toEqual(source.sections.map((item) => item.text));
    expect(copied.sections[0].claimRefs).toEqual(source.sections[0].claimRefs);
    expect(copied.sections[0].sourceRefs).toEqual(source.sections[0].sourceRefs);
    expect(copied.sections[0].history[0]).toMatchObject({ origin: "copied", copiedFrom: { platform: "youtube_shorts", revision: 1 } });
    expect(validateScriptDraft(JSON.parse(JSON.stringify(copied)))).toEqual(copied);
  });

  it("requires explicit overwrite, preserves prior target revisions, clears stale suggestions and revokes approval", () => {
    const source = { ...filled(), input: { ...context, platform: "youtube_shorts" as const } };
    let target: ScriptDraft = { ...filled(), input: { ...context, platform: "instagram" as const } };
    target = editScriptSection(target, "hook", "Existing human-authored Instagram introduction.", timestamp);
    target = proposeScriptCandidate(target, "hook", result, target.sections[0].revision, timestamp);
    const destContext = { ...context, platform: "instagram" as const };
    expect(() => copyShortFormScript(source, destContext, target, { now: timestamp })).toThrow(/replace|overwrite/i);
    const copied = copyShortFormScript(source, destContext, target, { replaceExisting: true, now: timestamp });
    expect(copied.sections[0].history.at(-2)?.text).toBe("Existing human-authored Instagram introduction.");
    expect(copied.sections[0].history.at(-1)?.origin).toBe("copied");
    expect(copied.pending).toEqual({});
    expect(copied.status).toBe("draft");
    expect(target.sections[0].text).toContain("human-authored");
  });

  it("restores overwritten accepted text as a new traceable revision without deleting the copy", () => {
    const source = { ...filled(), input: { ...context, platform: "youtube_shorts" as const } };
    const targetInput = { ...context, platform: "instagram" as const };
    const authored = editScriptSection(createScriptDraft(targetInput), "hook", "Previously approved Instagram opener.", timestamp);
    const copied = copyShortFormScript(source, targetInput, authored, { replaceExisting: true, now: timestamp });
    const restored = restoreScriptRevision(copied, "hook", 1, timestamp);
    expect(restored.sections[0].text).toBe("Previously approved Instagram opener.");
    expect(restored.sections[0].history).toHaveLength(3);
    expect(restored.sections[0].history[1].origin).toBe("copied");
    expect(restored.sections[0].history[2]).toMatchObject({ origin: "restored", restoredFromRevision: 1 });
    expect(restored.status).toBe("draft");
    expect(validateScriptDraft(JSON.parse(JSON.stringify(restored)))).toEqual(restored);
  });
  it("carries inserted sections into an empty destination without losing structure or prior edited work", () => {
    const shortContext = { ...context, platform: "youtube_shorts" as const };
    let source = insertScriptSection(createScriptDraft(shortContext), "hook", "after", {
      heading: "Special announcement", purpose: "Describe a relevant workflow product with a direct example.",
      text: "This extra narrated announcement belongs between the opening and the explanation.",
    }, timestamp);
    for (const section of source.sections.filter(section => section.revision === 0)) {
      source = fillScriptSection(source, section.id, result, 0, timestamp);
    }
    const targetContext = { ...context, platform: "tiktok" as const };
    const copied = copyShortFormScript(source, targetContext, null, {now: timestamp});
    expect(copied.sections).toHaveLength(6);
    expect(copied.sections.map(item => item.id)).toEqual(source.sections.map(item => item.id));
    expect(copied.sections[1].heading).toBe("Special announcement");
    expect(copied.sections[1].text).toBe(source.sections[1].text);
    expect(copied.sections[1].history[0].origin).toBe("copied");
    expect(() => copyShortFormScript(source, targetContext, filled(), {replaceExisting: true})).toThrow(/identity|platform/i);
    const occupied = { ...filled(), input: targetContext };
    expect(() => copyShortFormScript(source, targetContext, occupied, {replaceExisting: true})).toThrow(/section structures differ/i);
  });

  it("refuses incomplete, stale, long-form and cross-project copies before touching targets", () => {
    const short = { ...filled(), input: { ...context, platform: "youtube_shorts" as const } };
    const destination = { ...context, platform: "facebook" as const };
    expect(() => copyShortFormScript(createScriptDraft(short.input), destination, null)).toThrow(/complete/i);
    expect(() => copyShortFormScript(filled(), destination, null)).toThrow(/short-form/i);
    expect(() => copyShortFormScript(short, { ...destination, projectId: "other-project" }, null)).toThrow(/context|project/i);
    expect(() => copyShortFormScript(short, { ...destination, evidenceSnapshotId: "changed-evidence" }, null)).toThrow(/context|evidence/i);
    expect(() => copyShortFormScript(short, { ...destination, platform: "youtube_shorts" }, null)).toThrow(/different/i);
  });
  it("invalidates a script when a source URL or claim text changes without changing the quote", () => {
    const captured = [{claimId:"claim-1",claimText:"Original interpretation",sourceId:"source-1",
      sourceUrl:"https://example.org/a",quote:"The captured passage",reviewStatus:"unverified" as const}];
    const fingerprint=scriptEvidenceFingerprint(captured);
    expect(scriptEvidenceFingerprint([{...captured[0],sourceUrl:"https://example.org/b"}])).not.toBe(fingerprint);
    expect(scriptEvidenceFingerprint([{...captured[0],claimText:"Corrected interpretation"}])).not.toBe(fingerprint);
  });
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
    expect(() => validateScriptDraft({ ...filled(), unknown: true })).toThrow(/unknown/i);
  });

  it("rejects nonprinting control characters but retains ordinary narration line breaks", () => {
    expect(() => createScriptDraft({ ...context, title: "Bad\u0007 title" }, timestamp)).toThrow(/invalid title/i);
    expect(createScriptDraft({ ...context, title: "First line\nSecond line" }, timestamp).input.title)
      .toBe("First line\nSecond line");
  });

  it("rebases only a pristine empty draft when captured evidence arrives after mount", () => {
    const pristine = createScriptDraft({ ...context, evidenceSnapshotId: "sources-empty" }, timestamp);
    expect(rebindEmptyScriptEvidence(pristine, "sources-new", timestamp).input.evidenceSnapshotId).toBe("sources-new");
    const wrote = fillScriptSection(pristine, "hook", result, 0, timestamp);
    expect(rebindEmptyScriptEvidence(wrote, "sources-new", timestamp)).toEqual(wrote);
  });

  it("explicitly rebinds a reviewed script after evidence or brand changes without discarding narration history", () => {
    const approved = approveScriptDraft(filled(), timestamp);
    const nextContext = { ...context, evidenceSnapshotId: "capture-2", brandVoice: "Friendly and factual" };
    expect(isScriptContextCurrent(approved, nextContext)).toBe(false);
    const rebased = rebaseScriptDraftContext(approved, nextContext, "2026-10-25T13:00:00.000Z");
    expect(rebased.input).toEqual(nextContext);
    expect(rebased.status).toBe("draft");
    expect(rebased.approvedAt).toBeNull();
    expect(rebased.sections).toEqual(approved.sections);
    expect(rebased.sections[0].history).toEqual(approved.sections[0].history);
    expect(isScriptContextCurrent(rebased, nextContext)).toBe(true);
    expect(() => rebaseScriptDraftContext(rebased, { ...nextContext, platform: "tiktok" })).toThrow(/different script/i);
  });
});


describe("flexible script sections",()=>{
  it("inserts a promotion after the closing without changing existing IDs, words or history",async()=>{
    const {insertScriptSection}=await import("./script-review-model");
    const original=approveScriptDraft(filled(),timestamp);
    const next=insertScriptSection(original,"closing","after",{heading:"FileQuell for accountants",role:"promotion",
      purpose:"Connect reviewed FileQuell features to an accountant's file preparation workflow.",text:"Review FileQuell to see whether its local file tools fit your accounting workflow."},timestamp);
    expect(next.sections).toHaveLength(6);
    expect(next.sections.slice(0,5)).toEqual(original.sections);
    expect(next.sections[5]).toMatchObject({heading:"FileQuell for accountants",role:"promotion",revision:1,claimRefs:[],sourceRefs:[]});
    expect(next.status).toBe("draft");expect(next.approvedAt).toBeNull();
    expect(validateScriptDraft(next)).toEqual(next);
    const first=insertScriptSection(next,"hook","before",{heading:"Preface",purpose:"Introduce the context before the opening question.",text:"",role:"custom"},timestamp);
    expect(first.sections[0].heading).toBe("Preface");
    expect(first.sections[1].id).toBe("hook");
  });
  it("rejects duplicate or prototype-key section IDs in saved drafts",()=>{
    const original=filled();
    expect(()=>validateScriptDraft({...original,sections:[...original.sections,original.sections[0]]})).toThrow(/duplicate/i);
    expect(()=>validateScriptDraft({...original,sections:[{...original.sections[0],id:"constructor"},...original.sections.slice(1)]})).toThrow(/identity|identifier/i);
  });
});
