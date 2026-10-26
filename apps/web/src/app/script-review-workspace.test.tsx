import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ScriptReviewWorkspace } from "./script-review-workspace";
import { approveScriptDraft, createScriptDraft, fillScriptSection, loadScriptDraft, saveScriptDraft, scriptEvidenceFingerprint,
  type ScriptDraft, type ScriptEvidence } from "./script-review-model";

const evidence: ScriptEvidence[] = [{ claimId: "cost", claimText: "Repairs can affect insurance risk estimates.",
  sourceId: "insurance-study", sourceUrl: "https://example.org/study", quote: "Cost and exposure inform risk estimates.", reviewStatus: "verified" }];
const base = { productionId: "production-first", projectId: "brand-house", platforms: ["youtube" as const, "tiktok" as const],
  locale: "en" as const, title: "What makes insurance more expensive?", viewerQuestion: "Why does my bill rise?",
  audience: "Homeowners", angle: "Explain repair prices and changing risk", brandVoice: "Calm, direct", evidence, onApprove: vi.fn() };
const timestamp = "2026-10-25T00:00:00.000Z";
function saved(platform: "youtube" | "tiktok" = "youtube"): ScriptDraft {
  const { productionId, projectId, locale, title, viewerQuestion, audience, angle, brandVoice } = base;
  let draft = createScriptDraft({ productionId, projectId, platform, locale, title, viewerQuestion,
    audience, angle, brandVoice, evidenceSnapshotId: scriptEvidenceFingerprint(evidence) }, timestamp);
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

  it("starts first-draft generation when evidence arrives after the editor mounts", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({
      narration: "The captured source helps explain insurance pricing for the homeowner.",
      claimRefs: ["cost"], sourceRefs: ["insurance-study"],
    }) }));
    vi.stubGlobal("fetch", fetcher);
    const { rerender } = render(<ScriptReviewWorkspace {...base} evidence={[]} />);
    rerender(<ScriptReviewWorkspace {...base} />);
    await waitFor(() => expect(loadScriptDraft(base.productionId, "youtube").draft?.sections[0].text)
      .toContain("captured source"));
    expect(fetcher).toHaveBeenCalled();
    expect(loadScriptDraft(base.productionId, "youtube").draft?.input.evidenceSnapshotId)
      .toBe(scriptEvidenceFingerprint(evidence));
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
  it("generates all missing Blog sections on demand without overwriting the approved YouTube draft", async () => {
    const youtube = approveScriptDraft(saved("youtube"));
    saveScriptDraft(youtube);
    const requests: Array<{platform:string;sectionId:string}> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init:RequestInit) => {
      const request = JSON.parse(String(init.body));
      requests.push(request);
      return Response.json({narration:`Blog ${request.sectionId} explains the source-backed homeowner question in fresh editorial prose.`,
        claimRefs:["cost"],sourceRefs:["insurance-study"]});
    }));
    render(<ScriptReviewWorkspace {...base} platforms={["youtube", "blog"]} />);
    fireEvent.click(screen.getByRole("button",{name:"Blog"}));
    expect(requests).toHaveLength(0);
    fireEvent.click(screen.getByRole("button",{name:"Generate full Blog script"}));
    await waitFor(() => expect(loadScriptDraft(base.productionId,"blog").draft?.sections.every(section=>section.text)).toBe(true));
    expect(requests.map(request=>request.sectionId)).toEqual(["hook","context","mechanism","practical","closing"]);
    expect(requests.every(request=>request.platform==="blog")).toBe(true);
    expect(loadScriptDraft(base.productionId,"youtube").draft).toEqual(youtube);
  });
  it("retries the remaining Blog draft from saved sections after a failed local model request", async () => {
    let calls = 0;
    vi.stubGlobal("fetch",vi.fn(async () => {
      calls++;
      if(calls===2) return Response.json({error:"Local model temporarily unavailable"},{status:422});
      return Response.json({narration:"This section explains the homeowner question with supported source context.",
        claimRefs:["cost"],sourceRefs:["insurance-study"]});
    }));
    render(<ScriptReviewWorkspace {...base} platforms={["blog"]} />);
    fireEvent.click(screen.getByRole("button",{name:"Generate full Blog script"}));
    await waitFor(()=>expect(screen.getByRole("alert")).toHaveTextContent("temporarily unavailable"));
    expect(loadScriptDraft(base.productionId,"blog").draft?.sections[0].text).not.toBe("");
    fireEvent.click(screen.getByRole("button",{name:"Generate remaining Blog sections"}));
    await waitFor(()=>expect(loadScriptDraft(base.productionId,"blog").draft?.sections.every(section=>section.text)).toBe(true));
    expect(calls).toBe(6);
  });
  it("finishes all five initial sections under the application's StrictMode lifecycle", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 5);
        init.signal?.addEventListener("abort", () => {clearTimeout(timer);reject(Error("Aborted"));}, {once:true});
        if (init.signal?.aborted) {clearTimeout(timer);reject(Error("Aborted"));}
      });
      return new Response(JSON.stringify({narration: "A captured source explains how insurance changes as rebuilding expenses change.",
        claimRefs: ["cost"], sourceRefs: ["insurance-study"]}));
    }));
    render(<StrictMode><ScriptReviewWorkspace {...base} /></StrictMode>);
    await waitFor(() => expect(loadScriptDraft(base.productionId, "youtube").draft?.sections
      .every(section => section.text.length > 0)).toBe(true));
  });

  it("stops the current request and preserves accepted text without starting later sections", async () => {
    let cancelled=false;
    vi.stubGlobal("fetch", vi.fn((_url, init:RequestInit)=>new Promise((_resolve,reject)=>{
      init.signal?.addEventListener("abort",()=>{cancelled=true;reject(Error("Cancelled"));},{once:true});
    })));
    render(<ScriptReviewWorkspace {...base}/>);
    fireEvent.click(await screen.findByRole("button",{name:"Stop writing"}));
    await waitFor(()=>expect(cancelled).toBe(true));
    expect(await screen.findByRole("button",{name:"Continue writing missing sections"})).toBeInTheDocument();
    expect(screen.queryByText(/Accepted sections and manual corrections remain saved/)).not.toBeInTheDocument();
  });

  it("sends all section text and uses earlier proposed rewrites when regenerating the full script",async()=>{
    const before=saved();
    const requests:Record<string,unknown>[]=[];
    vi.stubGlobal("fetch",vi.fn(async(_url,init:RequestInit)=>{
      const request=JSON.parse(String(init.body));requests.push(request);
      return Response.json({narration:`The proposed ${request.sectionId} uses a distinct explanation of the same captured evidence.`,
        claimRefs:["cost"],sourceRefs:["insurance-study"]});
    }));
    render(<ScriptReviewWorkspace {...base}/>);
    fireEvent.click(screen.getByRole("button",{name:"Regenerate full script"}));
    fireEvent.click(screen.getByRole("button",{name:"Generate five suggestions"}));
    await waitFor(()=>expect(loadScriptDraft(base.productionId,"youtube").draft?.pending.closing).toBeTruthy());
    expect(requests).toHaveLength(5);
    const last=requests[4].scriptSections as {sectionId:string;text:string}[];
    expect(last.map(section=>section.sectionId)).toEqual(["hook","context","mechanism","practical","closing"]);
    expect(last[0].text).toContain("proposed hook");
    expect(last[3].text).toContain("proposed practical");
    expect(requests[4].previousSection).toBe(last[3].text);
    expect(last[4].text).toBe(before.sections[4].text);
    expect(loadScriptDraft(base.productionId,"youtube").draft?.sections).toEqual(before.sections);
    fireEvent.click(screen.getByRole("button",{name:"Regenerate full script"}));
    fireEvent.click(screen.getByRole("button",{name:"Generate five suggestions"}));
    await waitFor(()=>expect(requests).toHaveLength(10));
    expect(requests[5].rejectedTexts).toContain("The proposed hook uses a distinct explanation of the same captured evidence.");
  });

  it("sends a discarded candidate as text to avoid on the next regeneration",async()=>{
    saved();
    const requests:Record<string,unknown>[]=[];
    vi.stubGlobal("fetch",vi.fn(async(_url,init:RequestInit)=>{
      requests.push(JSON.parse(String(init.body)));
      return Response.json({narration:"This proposed insurance explanation was considered and discarded by the author.",
        claimRefs:["cost"],sourceRefs:["insurance-study"]});
    }));
    render(<ScriptReviewWorkspace {...base}/>);
    const regenerate=()=>fireEvent.click(screen.getAllByRole("button",{name:/Regenerate section/i})[0]);
    regenerate();fireEvent.click(screen.getByRole("button",{name:"Generate section candidate"}));
    fireEvent.click(await screen.findByRole("button",{name:"Discard suggestion"}));
    regenerate();fireEvent.click(screen.getByRole("button",{name:"Generate section candidate"}));
    await waitFor(()=>expect(requests).toHaveLength(2));
    expect(requests[1].rejectedTexts).toEqual(["This proposed insurance explanation was considered and discarded by the author."]);
  });

  it("discards a response if another section was edited while regeneration was in flight",async()=>{
    saved();
    let release:(value:Response)=>void=()=>{};
    const pending=new Promise<Response>(resolve=>{release=resolve;});
    const fetcher=vi.fn(()=>pending);vi.stubGlobal("fetch",fetcher);
    render(<ScriptReviewWorkspace {...base}/>);
    fireEvent.click(screen.getAllByRole("button",{name:/Regenerate section/i})[4]);
    fireEvent.click(screen.getByRole("button",{name:"Generate section candidate"}));
    await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getAllByRole("button",{name:/Edit section/i})[0]);
    fireEvent.change(screen.getByLabelText("Edit Opening hook"),{target:{value:"The author changed the opening while a closing was being written."}});
    fireEvent.click(screen.getByRole("button",{name:"Save section edit"}));
    release(Response.json({narration:"This closing belongs to an outdated version of the script and must be discarded.",
      claimRefs:["cost"],sourceRefs:["insurance-study"]}));
    await waitFor(()=>expect(screen.getByRole("alert")).toHaveTextContent("Another script section changed"));
    const current=loadScriptDraft(base.productionId,"youtube").draft!;
    expect(current.pending.closing).toBeUndefined();
    expect(current.sections[0].text).toContain("author changed");
  });

  it("stops full regeneration on a failed section instead of writing an incoherent remainder",async()=>{
    const before=saved();
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({error:"Continuity repair failed."}),{status:422}));
    vi.stubGlobal("fetch",fetcher);render(<ScriptReviewWorkspace {...base}/>);
    fireEvent.click(screen.getByRole("button",{name:"Regenerate full script"}));
    fireEvent.click(screen.getByRole("button",{name:"Generate five suggestions"}));
    await waitFor(()=>expect(screen.getByRole("alert")).toHaveTextContent("Continuity repair failed"));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(loadScriptDraft(base.productionId,"youtube").draft?.sections).toEqual(before.sections);
  });

});

