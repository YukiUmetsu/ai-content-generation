import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ScriptReviewWorkspace } from "./script-review-workspace";
import { approveScriptDraft, createScriptDraft, editScriptSection, fillScriptSection, insertScriptSection, loadScriptDraft, saveScriptDraft, scriptEvidenceFingerprint,
  type ScriptDraft, type ScriptEvidence } from "./script-review-model";

const evidence: ScriptEvidence[] = [{ claimId: "cost", claimText: "Repairs can affect insurance risk estimates.",
  sourceId: "insurance-study", sourceUrl: "https://example.org/study", quote: "Cost and exposure inform risk estimates.", reviewStatus: "verified" }];
const base = { productionId: "production-first", projectId: "brand-house", platforms: ["youtube" as const, "tiktok" as const],
  locale: "en" as const, title: "What makes insurance more expensive?", viewerQuestion: "Why does my bill rise?",
  audience: "Homeowners", angle: "Explain repair prices and changing risk", brandVoice: "Calm, direct", evidence, onApprove: vi.fn() };
const timestamp = "2026-10-25T00:00:00.000Z";
function saved(platform: "youtube" | "youtube_shorts" | "tiktok" | "instagram" | "facebook" = "youtube"): ScriptDraft {
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

  it("copies a complete Shorts script to other empty short-form tabs without calling AI", () => {
    const shorts = approveScriptDraft(saved("youtube_shorts"));
    saveScriptDraft(shorts);
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const onDraftChange = vi.fn();
    render(<ScriptReviewWorkspace {...base} platforms={["youtube_shorts", "tiktok", "instagram", "facebook"]}
      onDraftChange={onDraftChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy to other platforms" }));
    expect(screen.getByRole("checkbox", { name: "Copy to TikTok" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Copy to Instagram" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Copy to Facebook" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Copy to 3 platforms" }));
    for (const platform of ["tiktok", "instagram", "facebook"] as const) {
      const target = loadScriptDraft(base.productionId, platform).draft!;
      expect(target.status).toBe("draft");
      expect(target.sections.map(section => section.text)).toEqual(shorts.sections.map(section => section.text));
      expect(target.sections[0].history[0]).toMatchObject({origin:"copied",copiedFrom:{platform:"youtube_shorts",revision:1}});
    }
    expect(loadScriptDraft(base.productionId, "youtube_shorts").draft).toEqual(shorts);
    expect(onDraftChange).toHaveBeenCalledTimes(3);
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", {name:"TikTok"}));
    expect(screen.getByText(/The opening hook explains/i)).toBeInTheDocument();
  });

  it("requires deliberate confirmation before replacing existing destination scripts", () => {
    saved("youtube_shorts");
    const before = approveScriptDraft(saved("tiktok"));
    saveScriptDraft(before);
    render(<ScriptReviewWorkspace {...base} platforms={["youtube_shorts", "tiktok"]} />);
    fireEvent.click(screen.getByRole("button", {name:"Copy to other platforms"}));
    expect(screen.getByRole("checkbox", {name:"Copy to TikTok"})).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", {name:"Copy to TikTok"}));
    expect(screen.getByRole("button", {name:"Copy to 1 platform"})).toBeDisabled();
    expect(loadScriptDraft(base.productionId,"tiktok").draft).toEqual(before);
    fireEvent.click(screen.getByRole("checkbox", {name:/Replace the selected existing scripts/i}));
    fireEvent.click(screen.getByRole("button", {name:"Copy to 1 platform"}));
    const updated = loadScriptDraft(base.productionId,"tiktok").draft!;
    expect(updated.status).toBe("draft");
    expect(updated.approvedAt).toBeNull();
    expect(updated.sections[0].history).toHaveLength(2);
    expect(updated.sections[0].history[0]).toEqual(before.sections[0].history[0]);
    expect(updated.sections[0].history[1].origin).toBe("copied");
  });

  it("refuses to overwrite a destination edited in another tab after the picker opened", () => {
    saved("youtube_shorts");
    const existing = saved("tiktok");
    render(<ScriptReviewWorkspace {...base} platforms={["youtube_shorts", "tiktok"]} />);
    fireEvent.click(screen.getByRole("button", {name:"Copy to other platforms"}));
    fireEvent.click(screen.getByRole("checkbox", {name:"Copy to TikTok"}));
    fireEvent.click(screen.getByRole("checkbox", {name:/Replace the selected existing scripts/i}));
    const concurrent = approveScriptDraft(existing);
    saveScriptDraft(concurrent);
    fireEvent.click(screen.getByRole("button", {name:"Copy to 1 platform"}));
    expect(screen.getByRole("alert")).toHaveTextContent(/changed after you opened copy options/i);
    expect(loadScriptDraft(base.productionId,"tiktok").draft).toEqual(concurrent);
  });

  it("lets the author see and restore accepted target text after copying over it", () => {
    saved("youtube_shorts");
    const authored = editScriptSection(saved("tiktok"), "hook", "My unique TikTok explanation before the copy.", timestamp);
    saveScriptDraft(authored);
    render(<ScriptReviewWorkspace {...base} platforms={["youtube_shorts", "tiktok"]} />);
    fireEvent.click(screen.getByRole("button", {name:"Copy to other platforms"}));
    fireEvent.click(screen.getByRole("checkbox", {name:"Copy to TikTok"}));
    fireEvent.click(screen.getByRole("checkbox", {name:/Replace the selected existing scripts/i}));
    fireEvent.click(screen.getByRole("button", {name:"Copy to 1 platform"}));
    fireEvent.click(screen.getByRole("button", {name:"TikTok"}));
    fireEvent.click(screen.getByRole("button", {name:"Revision history (3)"}));
    expect(screen.getByText("My unique TikTok explanation before the copy.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name:"Restore revision 2"}));
    const restored = loadScriptDraft(base.productionId,"tiktok").draft!;
    expect(restored.sections[0].text).toBe("My unique TikTok explanation before the copy.");
    expect(restored.sections[0].history.at(-1)).toMatchObject({origin:"restored",restoredFromRevision:2});
  });

  it("recognizes a blank but inserted destination section as authored work", () => {
    saved("youtube_shorts");
    const tiktok = insertScriptSection(createScriptDraft(saved("tiktok").input), "hook", "after", {
      heading:"Reserved explanation",purpose:"Keep a section for a future example.",text:"",
    }, timestamp);
    saveScriptDraft(tiktok);
    render(<ScriptReviewWorkspace {...base} platforms={["youtube_shorts", "tiktok"]} />);
    fireEvent.click(screen.getByRole("button", {name:"Copy to other platforms"}));
    expect(screen.getByRole("checkbox", {name:"Copy to TikTok"})).not.toBeChecked();
    expect(screen.getByText(/Existing script — replacing requires confirmation/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", {name:"Copy to TikTok"}));
    fireEvent.click(screen.getByRole("checkbox", {name:/Replace the selected existing scripts/i}));
    fireEvent.click(screen.getByRole("button", {name:"Copy to 1 platform"}));
    expect(screen.getByRole("alert")).toHaveTextContent(/section structures differ/i);
    expect(loadScriptDraft(base.productionId,"tiktok").draft).toEqual(tiktok);
  });

  it("skips destinations whose saved drafts cannot be read", () => {
    const source = saved("youtube_shorts");
    // A non-blank source shows the destination picker, but corrupt target data is not replaced.
    localStorage.setItem(`contentgen:script-draft:v1:${base.productionId}:tiktok`, "not json");
    render(<ScriptReviewWorkspace {...base} platforms={["youtube_shorts", "tiktok", "instagram"]} />);
    fireEvent.click(screen.getByRole("button", {name:"Copy to other platforms"}));
    expect(screen.getByRole("checkbox", {name:"Copy to TikTok"})).toBeDisabled();
    expect(screen.getByRole("checkbox", {name:"Copy to Instagram"})).toBeChecked();
    fireEvent.click(screen.getByRole("button", {name:"Copy to 1 platform"}));
    expect(loadScriptDraft(base.productionId,"instagram").draft?.sections[0].text).toBe(source.sections[0].text);
    expect(localStorage.getItem(`contentgen:script-draft:v1:${base.productionId}:tiktok`)).toBe("not json");
  });

  it("disables cross-platform copying until all source sections are complete", () => {
    render(<ScriptReviewWorkspace {...base} platforms={["youtube_shorts", "tiktok"]} />);
    expect(screen.getByRole("button", {name:"Copy to other platforms"})).toBeDisabled();
  });

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
    fireEvent.click(screen.getByRole("button", {name: "Generate 5 suggestions"}));
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
    fireEvent.click(screen.getByRole("button",{name:"Generate 5 suggestions"}));
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
    fireEvent.click(screen.getByRole("button",{name:"Generate 5 suggestions"}));
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
    let requestSignal:AbortSignal|undefined;
    const fetcher=vi.fn((_url:string,init:RequestInit)=>{requestSignal=init.signal??undefined;return pending;});vi.stubGlobal("fetch",fetcher);
    render(<ScriptReviewWorkspace {...base}/>);
    fireEvent.click(screen.getAllByRole("button",{name:/Regenerate section/i})[4]);
    fireEvent.click(screen.getByRole("button",{name:"Generate section candidate"}));
    await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getAllByRole("button",{name:/Edit section/i})[0]);
    fireEvent.change(screen.getByLabelText("Edit Opening hook"),{target:{value:"The author changed the opening while a closing was being written."}});
    fireEvent.click(screen.getByRole("button",{name:"Save section edit"}));
    release(Response.json({narration:"This closing belongs to an outdated version of the script and must be discarded.",
      claimRefs:["cost"],sourceRefs:["insurance-study"]}));
    expect(requestSignal?.aborted).toBe(true);
    await waitFor(()=>expect(screen.queryByText("Writing one section at a time with your configured local script model…")).toBeNull());
    const current=loadScriptDraft(base.productionId,"youtube").draft!;
    expect(current.pending.closing).toBeUndefined();
    expect(current.sections[0].text).toContain("author changed");
  });

  it("stops full regeneration on a failed section instead of writing an incoherent remainder",async()=>{
    const before=saved();
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({error:"Continuity repair failed."}),{status:422}));
    vi.stubGlobal("fetch",fetcher);render(<ScriptReviewWorkspace {...base}/>);
    fireEvent.click(screen.getByRole("button",{name:"Regenerate full script"}));
    fireEvent.click(screen.getByRole("button",{name:"Generate 5 suggestions"}));
    await waitFor(()=>expect(screen.getByRole("alert")).toHaveTextContent("Continuity repair failed"));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(loadScriptDraft(base.productionId,"youtube").draft?.sections).toEqual(before.sections);
  });

});


describe("flexible script editing",()=>{
  afterEach(()=>{localStorage.clear();vi.unstubAllGlobals();});
  it("inserts a FileQuell promotion after the closing and a blank section before the hook without altering accepted text",async()=>{
    const before=saved(),onDraftChange=vi.fn();
    const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
    render(<ScriptReviewWorkspace {...base} onDraftChange={onDraftChange} />);
    fireEvent.click(screen.getByRole("button",{name:"Add section after Answer and takeaway"}));
    fireEvent.change(screen.getByLabelText("Section heading"),{target:{value:"FileQuell for accountants"}});
    fireEvent.change(screen.getByLabelText("Section role"),{target:{value:"promotion"}});
    fireEvent.change(screen.getByLabelText("Narration (optional)"),{target:{value:"Consider where FileQuell could fit into your accounting workflow, and review its capabilities with your team."}});
    fireEvent.click(screen.getByRole("button",{name:"Add section"}));
    await waitFor(()=>expect(screen.getByText("6/6 sections")).toBeTruthy());
    const after=loadScriptDraft(base.productionId,"youtube").draft!;
    expect(after.sections.slice(0,5)).toEqual(before.sections);
    expect(after.sections[5]).toMatchObject({heading:"FileQuell for accountants",role:"promotion",sourceRefs:[],revision:1});
    expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({status:"draft"}));
    fireEvent.click(screen.getByRole("button",{name:"Add section before Opening hook"}));
    fireEvent.change(screen.getByLabelText("Section heading"),{target:{value:"A brief introduction"}});
    fireEvent.click(screen.getByRole("button",{name:"Add section"}));
    await waitFor(()=>expect(screen.getByText("6/7 sections")).toBeTruthy());
    expect(loadScriptDraft(base.productionId,"youtube").draft!.sections[1]).toEqual(before.sections[0]);
    fireEvent.click(screen.getByRole("button",{name:"Edit section A brief introduction"}));
    fireEvent.change(screen.getByLabelText("Edit A brief introduction"),{target:{value:"Here is the introduction I wrote myself."}});
    fireEvent.click(screen.getByRole("button",{name:"Save section edit"}));
    expect(loadScriptDraft(base.productionId,"youtube").draft!.sections[0].text).toContain("wrote myself");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("previews and imports six numbered sections with recovery and platform isolation",async()=>{
    const before=saved(),other=saved("tiktok");
    render(<ScriptReviewWorkspace {...base} />);
    fireEvent.click(screen.getByRole("button",{name:"Import full script"}));
    fireEvent.change(screen.getByLabelText("Script to import"),{target:{value:Array.from({length:6},(_,i)=>`[${i+1}] Narration for section ${i+1}.\nAnother paragraph with my own wording.`).join("\n\n")}});
    fireEvent.click(screen.getByRole("button",{name:"Preview import"}));
    expect(screen.getByText("6 sections ready to import")).toBeTruthy();
    expect(loadScriptDraft(base.productionId,"youtube").draft).toEqual(before);
    fireEvent.click(screen.getByRole("button",{name:"Replace current script"}));
    await waitFor(()=>expect(screen.getByText("6/6 sections")).toBeTruthy());
    expect(loadScriptDraft(base.productionId,"youtube").draft!.sections).toHaveLength(6);
    expect(loadScriptDraft(base.productionId,"youtube").draft!.sections[0]).toMatchObject({text:"Narration for section 1.\nAnother paragraph with my own wording.",sourceRefs:[],history:[expect.objectContaining({origin:"manual"})]});
    expect(loadScriptDraft(base.productionId,"tiktok").draft).toEqual(other);
    fireEvent.click(screen.getByRole("button",{name:"Restore previous script"}));
    expect(loadScriptDraft(base.productionId,"youtube").draft!.sections).toEqual(before.sections);
    expect(loadScriptDraft(base.productionId,"youtube").draft!.status).toBe("draft");
  });
  it("keeps the active script when import is invalid or cancelled, and links captured evidence on manual edits",async()=>{
    const before=saved();render(<ScriptReviewWorkspace {...base} />);
    fireEvent.click(screen.getByRole("button",{name:"Import full script"}));
    fireEvent.change(screen.getByLabelText("Script to import"),{target:{value:"[1] Opening\n[3] Skipped a section"}});
    fireEvent.click(screen.getByRole("button",{name:"Preview import"}));
    expect(screen.getByRole("alert").textContent).toContain("consecutive");
    expect(screen.queryByRole("button",{name:"Replace current script"})).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"Cancel import"}));
    await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());
    expect(loadScriptDraft(base.productionId,"youtube").draft).toEqual(before);
    fireEvent.click(screen.getByRole("button",{name:"Edit section Opening hook"}));
    fireEvent.click(screen.getByRole("checkbox",{name:/Repairs can affect insurance/}));
    fireEvent.click(screen.getByRole("button",{name:"Save section edit"}));
    expect(loadScriptDraft(base.productionId,"youtube").draft!.sections[0]).toMatchObject({claimRefs:[],sourceRefs:[],revision:2,text:before.sections[0].text});
  });
});
