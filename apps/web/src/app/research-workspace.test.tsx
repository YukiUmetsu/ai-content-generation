import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResearchWorkspace } from "./research-workspace";
import type { EditorialDraft } from "./editorial-brief";
import { researchedFixture } from "./researched-storyboard.test";

const readinessPath = "/api/local-research-model/readiness";
const readyServices = { version: 1, ready: true,
  search: { state: "ready" }, researchModel: { state: "ready", model: "local-model" },
  storyModel: { state: "ready", model: "local-model" } };
const savedSearchId = "search_20261024T015250000Z-aaaaaaaaaaaa";
const savedJobId = "job_aaaaaaaaaaaaaaaaaaaaaaaa";
const savedDraftId = "research_home-123456789abc";
function jobResponse(url:string, options?:RequestInit):Response|null{
  if(url==="/api/contentgen-director/research-jobs"&&options?.method==="POST")
    return new Response(JSON.stringify({jobId:savedJobId,status:"queued",stage:"queued",completedScenes:0,totalScenes:0}),{status:202});
  if(url==="/api/contentgen-director/research-jobs/"+savedJobId&&(!options?.method||options.method==="GET"))
    return new Response(JSON.stringify({jobId:savedJobId,status:"completed",stage:"completed",completedScenes:2,totalScenes:2,artifactId:savedDraftId}),{status:200});
  if(url==="/api/contentgen-director/research-draft/"+savedDraftId)
    return new Response(JSON.stringify(researchedFixture),{status:200});
  return null;
}
function searchResponse(url: string, options?: RequestInit): Response | null {
  if (url !== "/api/contentgen-director/research-search" || options?.method !== "POST") return null;
  const brief = JSON.parse(String(options.body)) as {title:string;viewerQuestion:string;audience:string;locale:string};
  return new Response(JSON.stringify({schemaVersion:1,kind:"studio-search-snapshot",
    artifactId:savedSearchId,topic:brief.title,query:brief.viewerQuestion,audience:brief.audience,
    locale:brief.locale,provider:"searxng",searchedAt:"2026-10-24T01:52:50.000Z",
    results:[{title:"DOE Energy Saver",url:"https://www.energy.gov/energysaver/insulation",
      snippet:"Insulation reduces the movement of heat."}]}),{status:200});
}
function readinessResponse(url: string) {
  return url === readinessPath ? new Response(JSON.stringify(readyServices), { status: 200 }) : null;
}
async function expectResearchEnabled() {
  await waitFor(() => expect(screen.getByRole("button", { name: /research.*generate storyboard/i })).toBeEnabled());
}

vi.mock("./packaging-panel", () => ({ PackagingPanel: () => null }));
vi.mock("./youtube-intelligence-panel", () => ({ YoutubeIntelligencePanel: () => null }));

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

describe("Research workspace navigation", () => {
  it("prefills a selected discovery angle and visibly labels its sources as unverified leads",async()=>{
    vi.stubGlobal("fetch",vi.fn(async (url:RequestInfo|URL)=>readinessResponse(String(url))??
      new Response(JSON.stringify({status:"empty",results:[],records:[]}),{status:200})));
    const user=userEvent.setup();
    render(<ResearchWorkspace locale="en" onUseVideo={()=>true} handoff={{
      title:"Why Home Insurance Premiums Keep Rising",hook:"The surprising drivers of your monthly premium",
      premise:"Explain replacement cost, climate risk and coverage exclusions",
      sourceLeads:[{title:"Insurance policy overview",url:"https://example.com/policy",evidenceState:"lead_only"}]}}/>);
    expect(screen.getByRole("textbox",{name:"Research topic"})).toHaveValue("Why Home Insurance Premiums Keep Rising");
    expect(screen.getByText("The surprising drivers of your monthly premium")).toBeInTheDocument();
    expect(screen.getByRole("link",{name:"Insurance policy overview"})).toHaveAttribute("href","https://example.com/policy");
    expect(screen.getByText(/unverified source leads/i)).toBeInTheDocument();
    await user.click(screen.getByText("Fine-tune your brief"));
    expect(screen.getByRole("textbox",{name:/Question to answer/i})).toHaveValue("Why Home Insurance Premiums Keep Rising");
  });

  it("has separate Research, Evidence Library, Packaging and YouTube tabs", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => readinessResponse(String(url)) ??
      new Response(JSON.stringify({ status: "empty", results: [], records: [] }), { status: 200 })));
    const user = userEvent.setup();
    render(<ResearchWorkspace locale="en" onUseVideo={() => true} onCreateStoryboard={() => true} />);

    const tabs = screen.getByRole("tablist", { name: "Research sections" });
    expect(tabs.querySelectorAll('[role="tab"]')).toHaveLength(4);
    expect(screen.getByRole("tab", { name: "Research" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Packaging" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "YouTube Intelligence" })).toBeInTheDocument();
    expect(screen.getByText("Local research readiness")).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Research topic" }), "heat pump cost");
    await user.click(screen.getByRole("tab", { name: "Evidence Library" }));
    expect(screen.getByRole("searchbox", { name: "Search stored evidence" })).toHaveValue("");
    await user.type(screen.getByRole("searchbox", { name: "Search stored evidence" }), "home insurance");
    await user.click(screen.getByRole("tab", { name: "Research" }));
    expect(screen.getByRole("textbox", { name: "Research topic" })).toHaveValue("heat pump cost");
    await user.click(screen.getByRole("tab", { name: "Evidence Library" }));
    expect(screen.getByRole("searchbox", { name: "Search stored evidence" })).toHaveValue("home insurance");
  });
});

describe("automatic local video context in Studio Research", () => {
  it("prefills the project topic, retrieves related videos on request, and creates an original storyboard with URL-only inspiration", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (readinessResponse(url)) return readinessResponse(url)!;
      if (url.startsWith("/api/research/market/related")) return new Response(JSON.stringify({ videos: [{
        videoId: "abcABC12345", title: "Cost to Install a Heat Pump", channelId: "UCsample", channelTitle: "Explainer",
        publishedAt: "2026-10-01T00:00:00Z", durationSeconds: 400, viewCount: 1200,
        likeCount: null, commentCount: null, subscriberCount: null,
        sourceUrl: "https://www.youtube.com/watch?v=abcABC12345", provider: "youtube-data-api",
        observedAt: 1792000000, expiresAt: 1794900000, watchlistName: "House Math", matchedTerms: ["heat", "pump"],
      }]}), { status: 200 });
      throw Error(`Unexpected network request: ${url}`);
    }));
    const onCreateStoryboard = vi.fn((draft: EditorialDraft) => Boolean(draft));
    const user = userEvent.setup();
    render(<ResearchWorkspace locale="en" projectTopic="heat pump installation" onUseVideo={vi.fn(() => true)} onCreateStoryboard={onCreateStoryboard} />);
    await waitFor(() => expect(requests).toContain(readinessPath));
    expect(requests.every(url => url === readinessPath)).toBe(true);
    await user.click(screen.getByText("YouTube inspiration (optional)"));
    expect(await screen.findByText("Cost to Install a Heat Pump")).toBeInTheDocument();
    expect(requests.some(x => x.includes("topic=heat%20pump%20installation"))).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: /select.*inspiration/i }));
    await user.click(screen.getByRole("button", { name: /create unresearched outline/i }));
    expect(onCreateStoryboard).toHaveBeenCalledTimes(1);
    const draft = onCreateStoryboard.mock.calls[0][0];
    expect(draft.input.inspirationUrls).toEqual(["https://www.youtube.com/watch?v=abcABC12345"]);
    expect(draft.input.topic).toBe("heat pump installation");
    expect(JSON.stringify(draft)).not.toContain("1200");
  });

  it("keeps evidence-library queries from changing the related-video lookup topic", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input); requests.push(url);
      if (readinessResponse(url)) return readinessResponse(url)!;
      return new Response(JSON.stringify({ videos: [] }), { status: 200 });
    }));
    const user = userEvent.setup();
    render(<ResearchWorkspace locale="en" onUseVideo={vi.fn(() => true)} />);
    await user.type(screen.getByRole("textbox", { name: "Research topic" }), "foundation repair costs");
    await user.click(screen.getByText("YouTube inspiration (optional)"));
    await waitFor(() => expect(requests.some(url => url.includes("topic=foundation%20repair%20costs"))).toBe(true));
    await user.click(screen.getByRole("tab", { name: "Evidence Library" }));
    await user.type(screen.getByRole("searchbox", { name: "Search stored evidence" }), "home insurance");
    await user.click(screen.getByRole("tab", { name: "Research" }));
    expect(screen.getByRole("textbox", { name: "Research topic" })).toHaveValue("foundation repair costs");
    expect(requests.every(url => url === readinessPath || url.startsWith("/api/research/market/related"))).toBe(true);
    expect(requests.some(url => url.includes("home%20insurance"))).toBe(false);
  });
});

describe("Studio Research to source-backed story", () => {
  it("generates research explicitly, previews exact citations and shots, then creates a reviewed editable storyboard", async () => {
    const requests: { url: string; options?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, options?: RequestInit) => {
      requests.push({ url: String(url), options });
      if (readinessResponse(String(url))) return readinessResponse(String(url))!;
      if (searchResponse(String(url),options)) return searchResponse(String(url),options)!;
      if (String(url).startsWith("/api/research/market/related")) return new Response(JSON.stringify({ videos: [] }), { status: 200 });
      if (jobResponse(String(url),options)) return jobResponse(String(url),options)!;
      throw Error("Unexpected request");
    }));
    const create = vi.fn(() => true), user = userEvent.setup();
    render(<ResearchWorkspace locale="en" projectTopic="Why insulation saves energy" onUseVideo={vi.fn(() => true)} onCreateStoryboard={create} />);
    await expectResearchEnabled();
    await user.click(screen.getByRole("button", { name: /research.*generate/i }));
    expect(await screen.findByText("Insulation resists heat flow.")).toBeInTheDocument();
    expect(screen.getByText(/Insulation resists the flow of heat/)).toBeInTheDocument();
    expect(screen.getByText(/fewer heat arrows cross/)).toBeInTheDocument();
    const request = requests.find(x => x.url.endsWith("/research-jobs"));
    expect(request?.options?.method).toBe("POST");
    expect(request?.options?.headers).toMatchObject({ "x-contentgen-director": "local-only" });
    await user.click(screen.getByRole("button", { name: /create editable.*storyboard/i }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ version: 1 }), researchedFixture);
  });

  it("reports research errors and never invents a source-backed storyboard", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, options?:RequestInit) => readinessResponse(String(url)) ?? searchResponse(String(url),options) ?? (String(url).endsWith("/research-jobs")
      ? new Response(JSON.stringify({ error: "Local SearXNG unavailable" }), { status: 422 })
      : new Response(JSON.stringify({ videos: [] }), { status: 200 }))));
    const create = vi.fn(() => true), user = userEvent.setup();
    render(<ResearchWorkspace locale="en" projectTopic="heat pump costs" onUseVideo={vi.fn(() => true)} onCreateStoryboard={create} />);
    await expectResearchEnabled();
    await user.click(screen.getByRole("button", { name: /research.*generate/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Local SearXNG unavailable/);
    expect(create).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /create editable.*storyboard/i })).not.toBeInTheDocument();
  });

  it("clears stale research as soon as the Research topic changes", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, options?:RequestInit) => readinessResponse(String(url)) ?? searchResponse(String(url),options) ?? jobResponse(String(url),options) ?? (String(url).includes("/research-draft")
      ? new Response(JSON.stringify(researchedFixture), { status: 200 })
      : new Response(JSON.stringify({ videos: [] }), { status: 200 }))));
    const create = vi.fn(() => true), user = userEvent.setup();
    render(<ResearchWorkspace locale="en" projectTopic="Why insulation saves energy" onUseVideo={vi.fn(() => true)} onCreateStoryboard={create} />);
    await expectResearchEnabled();
    await user.click(screen.getByRole("button", { name: /research.*generate/i }));
    expect(await screen.findByText("Insulation resists heat flow.")).toBeInTheDocument();
    const topic = screen.getByRole("textbox", { name: "Research topic" });
    await user.clear(topic); await user.type(topic, "different home heating costs");
    expect(screen.queryByText("Insulation resists heat flow.")).not.toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it("does not invalidate reviewed research when only the Evidence Library query changes", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, options?:RequestInit) => readinessResponse(String(url)) ?? searchResponse(String(url),options) ?? jobResponse(String(url),options) ?? (String(url).includes("/research-draft")
      ? new Response(JSON.stringify(researchedFixture), { status: 200 })
      : new Response(JSON.stringify({ videos: [] }), { status: 200 }))));
    const user = userEvent.setup();
    render(<ResearchWorkspace locale="en" projectTopic="Why insulation saves energy" onUseVideo={vi.fn(() => true)} onCreateStoryboard={vi.fn(() => true)} />);
    await expectResearchEnabled();
    await user.click(screen.getByRole("button", { name: /research.*generate/i }));
    expect(await screen.findByText("Insulation resists heat flow.")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Evidence Library" }));
    await user.type(screen.getByRole("searchbox", { name: "Search stored evidence" }), "different heating costs");
    await user.click(screen.getByRole("tab", { name: "Research" }));
    expect(screen.getByText("Insulation resists heat flow.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create editable sourced storyboard/i })).toBeInTheDocument();
  });

  it("invalidates reviewed evidence if the intended viewer question or audience changes", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, options?:RequestInit) => readinessResponse(String(url)) ?? searchResponse(String(url),options) ?? jobResponse(String(url),options) ?? (String(url).includes("/research-draft")
      ? new Response(JSON.stringify(researchedFixture), { status: 200 })
      : new Response(JSON.stringify({ videos: [] }), { status: 200 }))));
    const user = userEvent.setup();
    render(<ResearchWorkspace locale="en" projectTopic="Why insulation saves energy" onUseVideo={vi.fn(() => true)} onCreateStoryboard={vi.fn(() => true)} />);
    await expectResearchEnabled();
    await user.click(screen.getByRole("button", { name: /research.*generate/i }));
    expect(await screen.findByText("Insulation resists heat flow.")).toBeInTheDocument();
    await user.click(screen.getByText("Fine-tune your brief"));
    await user.type(screen.getByRole("textbox", { name: /question to answer/i }), "But how?");
    expect(screen.queryByRole("button", { name: /create editable sourced storyboard/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /research.*generate/i }));
    expect(await screen.findByText("Insulation resists heat flow.")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: /audience/i }), "New homeowners");
    expect(screen.queryByRole("button", { name: /create editable sourced storyboard/i })).not.toBeInTheDocument();
  });

  it("restores the last immutable research draft without re-running the public search or model", async () => {
    localStorage.setItem("contentgen:studio-research:latest:v1", JSON.stringify({ topic: "Why insulation saves energy", artifactId: "research_home-123456789abc" }));
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => {
      requests.push(String(url));
      if (readinessResponse(String(url))) return readinessResponse(String(url))!;
      if (String(url) === "/api/contentgen-director/research-draft/research_home-123456789abc")
        return new Response(JSON.stringify(researchedFixture), { status: 200 });
      return new Response(JSON.stringify({ videos: [] }), { status: 200 });
    }));
    render(<ResearchWorkspace locale="en" projectTopic="Why insulation saves energy" onUseVideo={vi.fn(() => true)} onCreateStoryboard={vi.fn(() => true)} />);
    expect(await screen.findByText("Insulation resists heat flow.")).toBeInTheDocument();
    expect(requests).toContain("/api/contentgen-director/research-draft/research_home-123456789abc");
    expect(requests.every(x => !x.endsWith("/research-draft"))).toBe(true);
  });

  it("shows missing local search on page open, blocks only source-backed generation, and recovers on recheck", async () => {
    let checkCount = 0, researchPosts = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL,options?:RequestInit) => {
      if (String(url) === readinessPath) {
        checkCount++;
        return new Response(JSON.stringify(checkCount === 1
          ? { ...readyServices, ready: false, search: { state: "not_configured" } }
          : readyServices), { status: 200 });
      }
      if (String(url) === "/api/contentgen-director/research-jobs" && options?.method==="POST") {
        researchPosts++;
      }
      if (jobResponse(String(url),options)) return jobResponse(String(url),options)!;
      if (searchResponse(String(url),options)) return searchResponse(String(url),options)!;
      throw Error(`Unexpected URL ${String(url)}`);
    }));
    const create = vi.fn<(draft:EditorialDraft) => boolean>(() => true), user = userEvent.setup();
    render(<ResearchWorkspace locale="en" projectTopic="Why insulation saves energy" onUseVideo={vi.fn(() => true)} onCreateStoryboard={create} />);
    expect(await screen.findByText(/Set up local search:/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /research.*generate storyboard/i })).toBeDisabled();
    expect(researchPosts).toBe(0);
    await user.click(screen.getByRole("button", { name: /create unresearched outline/i }));
    expect(create).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: /check again/i }));
    await expectResearchEnabled();
    await user.click(screen.getByRole("button", { name: /research.*generate/i }));
    expect(await screen.findByText("Insulation resists heat flow.")).toBeInTheDocument();
    expect(researchPosts).toBe(1);
  });

  it("selects a story direction with native radios and hides optional inputs until expanded", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => readinessResponse(String(url)) ?? new Response("{}", { status: 200 })));
    const create = vi.fn<(draft:EditorialDraft) => boolean>(() => true), user = userEvent.setup();
    render(<ResearchWorkspace locale="en" projectTopic="Rent vs buy" onUseVideo={vi.fn(() => true)} onCreateStoryboard={create} />);
    await user.click(screen.getByRole("radio", { name: /compare the options/i }));
    expect(screen.getByRole("radio", { name: /compare the options/i })).toBeChecked();
    await user.click(screen.getByText("Fine-tune your brief"));
    await user.type(screen.getByRole("textbox", { name: /audience/i }), "First-time buyers");
    await user.click(screen.getByRole("button", { name: /create unresearched outline/i }));
    expect(create.mock.calls[0][0].selectedId).toBe("comparison");
    expect(create.mock.calls[0][0].input.audience).toBe("First-time buyers");
  });

  it("does not falsely block generation when a local model cannot list IDs", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => String(url) === readinessPath
      ? new Response(JSON.stringify({ ...readyServices, ready: false,
          researchModel: { state: "unverified" }, storyModel: { state: "unverified" } }), { status: 200 })
      : new Response(JSON.stringify(researchedFixture), { status: 200 })));
    render(<ResearchWorkspace locale="en" projectTopic="Heat pumps" onUseVideo={vi.fn(() => true)} onCreateStoryboard={vi.fn(() => true)} />);
    expect(await screen.findByText(/story model is not responding/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /research.*generate storyboard/i })).toBeEnabled();
  });

  it("can search and save sources when both local models are unavailable", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch",vi.fn(async (url:RequestInfo|URL,options?:RequestInit) => {
      const path=String(url);requests.push(path);
      if(path===readinessPath)return new Response(JSON.stringify({...readyServices,
        researchModel:{state:"unavailable"},storyModel:{state:"model_missing"}}),{status:200});
      return searchResponse(path,options) ?? new Response(JSON.stringify({items:[]}),{status:200});
    }));
    const user=userEvent.setup();
    render(<ResearchWorkspace locale="en" projectTopic="Heat pump costs" onUseVideo={()=>true} onCreateStoryboard={()=>true}/>);
    const search=await screen.findByRole("button",{name:/search.*save sources/i});
    await waitFor(()=>expect(search).toBeEnabled());
    expect(screen.getByRole("button",{name:/research.*generate storyboard/i})).toBeDisabled();
    await user.click(search);
    expect(await screen.findByRole("link",{name:/DOE Energy Saver/i})).toHaveAttribute("href","https://www.energy.gov/energysaver/insulation");
    expect(screen.getByText(/Insulation reduces the movement of heat/)).toBeInTheDocument();
    expect(screen.getByText(/Search leads are not verified evidence/i)).toBeInTheDocument();
    expect(requests.filter(x=>x==="/api/contentgen-director/research-search")).toHaveLength(1);
    expect(requests).not.toContain("/api/contentgen-director/research-jobs");
  });

  it("keeps search links after a failed scene and resumes without searching again", async () => {
    let searches=0,jobs=0,resumed=false;
    vi.stubGlobal("fetch",vi.fn(async (url:RequestInfo|URL,options?:RequestInit) => {
      const path=String(url);
      if(path===readinessPath)return readinessResponse(path)!;
      if(path==="/api/contentgen-director/research-search"){
        searches++;return searchResponse(path,options)!;
      }
      if(path==="/api/contentgen-director/research-jobs"&&options?.method==="POST"){
        jobs++;
        expect(JSON.parse(String(options?.body)).searchArtifactId).toBe(savedSearchId);
        return jobResponse(path,options)!;
      }
      if(path==="/api/contentgen-director/research-jobs/"+savedJobId+"/resume"){
        resumed=true;return new Response(JSON.stringify({jobId:savedJobId,status:"queued",stage:"queued",completedScenes:1,totalScenes:2}),{status:202});
      }
      if(path==="/api/contentgen-director/research-jobs/"+savedJobId){
        return resumed?jobResponse(path,options)!:new Response(JSON.stringify({jobId:savedJobId,status:"failed",stage:"scene:2",completedScenes:1,totalScenes:2,error:{code:"invalid_output",message:"Local model returned invalid structured data."}}),{status:200});
      }
      if(jobResponse(path,options))return jobResponse(path,options)!;
      return new Response(JSON.stringify({items:[]}),{status:200});
    }));
    const user=userEvent.setup();
    render(<ResearchWorkspace locale="en" projectTopic="Why insulation saves energy" onUseVideo={()=>true} onCreateStoryboard={()=>true}/>);
    await expectResearchEnabled();
    await user.click(screen.getByRole("button",{name:/research.*generate storyboard/i}));
    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid structured data/i);
    expect(screen.getByRole("link",{name:/DOE Energy Saver/i})).toBeInTheDocument();
    expect(localStorage.getItem("contentgen:studio-search:latest:v1")).toContain(savedSearchId);
    await user.click(screen.getByRole("button",{name:/resume saved job/i}));
    expect(await screen.findByText("Insulation resists heat flow.")).toBeInTheDocument();
    expect(searches).toBe(1);
    expect(jobs).toBe(1);
  });

  it("restores a selected saved search from the local history without running AI", async () => {
    const paths:string[]=[];
    vi.stubGlobal("fetch",vi.fn(async (url:RequestInfo|URL) => {
      const path=String(url);paths.push(path);
      if(path===readinessPath)return readinessResponse(path)!;
      if(path==="/api/contentgen-director/research-search")
        return new Response(JSON.stringify({items:[{artifactId:savedSearchId,topic:"Heat pump costs",
          query:"Why heat pumps?",audience:"Homeowners",locale:"en-US",resultCount:1,searchedAt:"2026-10-24T01:52:50.000Z"}]}),{status:200});
      if(path.endsWith("/"+savedSearchId))
        return new Response(JSON.stringify({artifactId:savedSearchId,topic:"Heat pump costs",
          query:"Why heat pumps?",audience:"Homeowners",locale:"en-US",
          results:[{title:"DOE Energy Saver",url:"https://www.energy.gov/energysaver/insulation",snippet:"Costs vary."}]}),{status:200});
      return new Response(JSON.stringify({items:[]}),{status:200});
    }));
    const user=userEvent.setup();
    render(<ResearchWorkspace locale="en" onUseVideo={()=>true} onCreateStoryboard={()=>true}/>);
    await user.click(screen.getByText("Saved searches",{exact:true}));
    await user.click(await screen.findByRole("button",{name:/Heat pump costs.*1 source/i}));
    expect(screen.getByRole("textbox",{name:"Research topic"})).toHaveValue("Heat pump costs");
    expect(screen.getByRole("link",{name:/DOE Energy Saver/i})).toBeInTheDocument();
    expect(paths).not.toContain("/api/contentgen-director/research-draft");
  });

  it("never generates from a search that finishes after its topic was edited",async()=>{
    let finishSearch:(response:Response)=>void=()=>{};
    const deferred=new Promise<Response>(resolve=>{finishSearch=resolve;});
    let drafts=0;
    vi.stubGlobal("fetch",vi.fn(async (url:RequestInfo|URL,options?:RequestInit)=>{
      const path=String(url);
      if(path===readinessPath)return readinessResponse(path)!;
      if(path==="/api/contentgen-director/research-search")return deferred;
      if(path==="/api/contentgen-director/research-jobs"){drafts++;return jobResponse(path,options)!;}
      return searchResponse(path,options)??new Response(JSON.stringify({items:[]}),{status:200});
    }));
    const user=userEvent.setup();
    render(<ResearchWorkspace locale="en" projectTopic="Why insulation saves energy" onUseVideo={()=>true} onCreateStoryboard={()=>true}/>);
    await expectResearchEnabled();
    await user.click(screen.getByRole("button",{name:/research.*generate storyboard/i}));
    const topic=screen.getByRole("textbox",{name:"Research topic"});
    await user.clear(topic);await user.type(topic,"Home insurance premiums");
    await act(async()=>{
      finishSearch(searchResponse("/api/contentgen-director/research-search",{method:"POST",body:JSON.stringify({
        title:"Why insulation saves energy",viewerQuestion:"What should I understand about Why insulation saves energy?",
        audience:"people exploring this topic",locale:"en-US"})})!);
      await deferred;
    });
    expect(screen.queryByRole("link",{name:/DOE Energy Saver/i})).not.toBeInTheDocument();
    expect(drafts).toBe(0);
  });

  it("can generate from an existing saved search while SearXNG is offline",async()=>{
    localStorage.setItem("contentgen:studio-search:latest:v1",JSON.stringify({
      topic:"Heat pump costs",artifactId:savedSearchId}));
    const requests:string[]=[];
    vi.stubGlobal("fetch",vi.fn(async (url:RequestInfo|URL,options?:RequestInit)=>{
      const path=String(url);requests.push(path);
      if(path===readinessPath)return new Response(JSON.stringify({...readyServices,
        search:{state:"unavailable"}}),{status:200});
      if(path.endsWith("/"+savedSearchId))return new Response(JSON.stringify({
        artifactId:savedSearchId,topic:"Heat pump costs",
        query:"What should I understand about Heat pump costs?",
        audience:"people exploring this topic",locale:"en-US",
        searchedAt:"2026-10-24T01:52:50.000Z",results:[
          {title:"DOE Energy Saver",url:"https://www.energy.gov/energysaver/insulation",snippet:"Insulation overview."}
        ]}),{status:200});
      if(jobResponse(path,options))return jobResponse(path,options)!;
      throw Error(`Unexpected URL ${path}`);
    }));
    const user=userEvent.setup();
    render(<ResearchWorkspace locale="en" projectTopic="Heat pump costs" onUseVideo={()=>true} onCreateStoryboard={()=>true}/>);
    expect(await screen.findByRole("link",{name:/DOE Energy Saver/i})).toBeInTheDocument();
    const generate=screen.getByRole("button",{name:/generate storyboard from saved sources/i});
    await waitFor(()=>expect(generate).toBeEnabled());
    await user.click(generate);
    expect(requests).not.toContain("/api/contentgen-director/research-search");
    expect(requests).toContain("/api/contentgen-director/research-jobs");
  });
});

