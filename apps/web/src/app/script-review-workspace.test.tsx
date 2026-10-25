import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ScriptReviewWorkspace } from "./script-review-workspace";
import { createScriptDraft, fillScriptSection, loadScriptDraft, saveScriptDraft, type ScriptDraft, type ScriptEvidence } from "./script-review-model";

const evidence: ScriptEvidence[] = [{ claimId: "cost", claimText: "Repairs can affect insurance risk estimates.",
  sourceId: "insurance-study", sourceUrl: "https://example.org/study", quote: "Cost and exposure inform risk estimates.", reviewStatus: "verified" }];
const base = { productionId: "production-first", projectId: "brand-house", platforms: ["youtube" as const, "tiktok" as const],
  locale: "en" as const, title: "What makes insurance more expensive?", viewerQuestion: "Why does my bill rise?",
  audience: "Homeowners", angle: "Explain repair prices and changing risk", brandVoice: "Calm, direct", evidence, onApprove: vi.fn() };
const timestamp = "2026-10-25T00:00:00.000Z";
function saved(platform: "youtube" | "tiktok" = "youtube"): ScriptDraft {
  let draft = createScriptDraft({ ...base, platform, evidenceSnapshotId: "evidence-1" }, timestamp);
  for (const section of draft.sections) draft = fillScriptSection(draft, section.id, {
    narration: `The ${section.heading.toLowerCase()} explains how insurance works for a homeowner.`,
    claimRefs: ["cost"], sourceRefs: ["insurance-study"] }, 0, timestamp);
  saveScriptDraft(draft);
  return draft;
}
describe("AI-first script review UI", () => {
  afterEach(() => {localStorage.clear();vi.unstubAllGlobals();});

  it("shows automatically drafted narration and linked source review for each section", () => {
    saved();render(<ScriptReviewWorkspace {...base} />);
    expect(screen.getByRole("heading", {name: /Review AI-generated script/i})).toBeTruthy();
    expect(screen.getAllByRole("button", {name: /Regenerate section/i})).toHaveLength(5);
    expect(screen.getByText(/The opening hook explains/i)).toBeTruthy();
    expect(screen.getAllByRole("link", {name: /insurance-study/i}).length).toBeGreaterThan(0);
  });

  it("regenerates one section with instructions as a candidate and accepts only after review", async () => {
    const before = saved();
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body));
      expect(request.sectionId).toBe("hook");
      expect(request.extraInstructions).toContain("more curious");
      return {ok: true, json: async () => ({status: "candidate-needs-acceptance",
        narration: "You open a renewal notice, but what caused the increase? Your home is the same.",
        claimRefs: ["cost"], sourceRefs: ["insurance-study"]})};
    });
    vi.stubGlobal("fetch", fetcher);
    render(<ScriptReviewWorkspace {...base} />);
    fireEvent.click(screen.getAllByRole("button", {name: /Regenerate section/i})[0]);
    fireEvent.change(screen.getByLabelText("Extra instructions for Opening hook"), {target: {value: "Make it more curious"}});
    fireEvent.click(screen.getByRole("button", {name: "Generate section candidate"}));
    expect((loadScriptDraft(base.productionId, "youtube").draft?.sections[0].text)).toBe(before.sections[0].text);
    await waitFor(() => expect(screen.getByRole("button", {name: "Accept suggested section"})).toBeTruthy());
    fireEvent.click(screen.getByRole("button", {name: "Accept suggested section"}));
    const after = loadScriptDraft(base.productionId, "youtube").draft!;
    expect(after.sections[0].text).toContain("renewal notice");
    expect(after.sections[1]).toEqual(before.sections[1]);
    expect(after.sections[0].history).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("manual correction invalidates a pending candidate while leaving other platform drafts intact", async () => {
    const youtube = saved("youtube"), tiktok = saved("tiktok");
    const onDraftChange = vi.fn();
    render(<ScriptReviewWorkspace {...base} onDraftChange={onDraftChange} />);
    fireEvent.click(screen.getAllByRole("button", {name: /Edit section/i})[0]);
    fireEvent.change(screen.getByLabelText("Edit Opening hook"), {target: {value: "My corrected explanation is more precise."}});
    fireEvent.click(screen.getByRole("button", {name: "Save section edit"}));
    expect(loadScriptDraft(base.productionId, "youtube").draft?.sections[0].text).toContain("My corrected explanation");
    expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({status: "draft"}));
    fireEvent.click(screen.getByRole("button", {name: "TikTok"}));
    expect(screen.getByText(/The opening hook explains/i)).toBeTruthy();
    expect(loadScriptDraft(base.productionId, "tiktok").draft?.sections[0]).toEqual(tiktok.sections[0]);
    expect(loadScriptDraft(base.productionId, "youtube").draft?.sections[1]).toEqual(youtube.sections[1]);
  });

  it("withholds automatic AI generation when no evidence was captured", () => {
    const fetcher = vi.fn();vi.stubGlobal("fetch", fetcher);
    render(<ScriptReviewWorkspace {...base} evidence={[]} />);
    expect(screen.getByRole("alert").textContent).toMatch(/captured evidence/i);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("full regeneration requires confirmation and leaves every accepted section unchanged until accepted", async () => {
    const before = saved();
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls++;
      return {ok: true, json: async () => ({status: "candidate-needs-acceptance",
        narration: "A newly proposed narrated explanation grounded in our recorded source material.",
        claimRefs: ["cost"], sourceRefs: ["insurance-study"]})};
    }));
    render(<ScriptReviewWorkspace {...base} />);
    fireEvent.click(screen.getByRole("button", {name: "Regenerate full script"}));
    expect(calls).toBe(0);
    fireEvent.click(screen.getByRole("button", {name: "Generate five suggestions"}));
    await waitFor(() => expect(loadScriptDraft(base.productionId, "youtube").draft?.pending?.closing).toBeTruthy());
    const after = loadScriptDraft(base.productionId, "youtube").draft!;
    expect(calls).toBe(5);
    expect(after.sections).toEqual(before.sections);
    expect(Object.keys(after.pending)).toHaveLength(5);
  });
});
