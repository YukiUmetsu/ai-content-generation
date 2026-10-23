import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResearchWorkspace } from "./research-workspace";
import type { EditorialDraft } from "./editorial-brief";
import { researchedFixture } from "./researched-storyboard.test";

vi.mock("./packaging-panel", () => ({PackagingPanel: () => null}));
vi.mock("./youtube-intelligence-panel", () => ({YoutubeIntelligencePanel: () => null}));

afterEach(() => { vi.unstubAllGlobals();localStorage.clear(); });

describe("automatic local video context in Studio Research", () => {
  it("prefills the project topic, retrieves related videos, and creates original storyboard with URL-only inspiration", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url.startsWith("/api/research/market/related")) return new Response(JSON.stringify({videos: [{
        videoId:"abcABC12345",title:"Cost to Install a Heat Pump",channelId:"UCsample",channelTitle:"Explainer",
        publishedAt:"2026-10-01T00:00:00Z",durationSeconds:400,viewCount:1200,
        likeCount:null,commentCount:null,subscriberCount:null,
        sourceUrl:"https://www.youtube.com/watch?v=abcABC12345",provider:"youtube-data-api",
        observedAt:1792000000,expiresAt:1794900000,watchlistName:"House Math",matchedTerms:["heat","pump"],
      }]}), {status:200});
      throw Error(`Unexpected network request: ${url}`);
    }));
    const onCreateStoryboard = vi.fn((draft:EditorialDraft) => Boolean(draft));
    const user = userEvent.setup();
    render(<ResearchWorkspace locale="en" projectTopic="heat pump installation" onUseVideo={vi.fn(()=>true)} onCreateStoryboard={onCreateStoryboard}/>);
    expect(await screen.findByText("Cost to Install a Heat Pump")).toBeInTheDocument();
    expect(requests.some(x => x.includes("topic=heat%20pump%20installation"))).toBe(true);
    await user.click(screen.getByRole("checkbox",{name:/select.*inspiration/i}));
    await user.click(screen.getByRole("button",{name:/create unresearched outline/i}));
    expect(onCreateStoryboard).toHaveBeenCalledTimes(1);
    const draft = onCreateStoryboard.mock.calls[0][0];
    expect(draft.input.inspirationUrls).toEqual(["https://www.youtube.com/watch?v=abcABC12345"]);
    expect(draft.input.topic).toBe("heat pump installation");
    expect(JSON.stringify(draft)).not.toContain("1200");
  });

  it("uses a changed evidence query to look up different videos automatically", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input:RequestInfo|URL) => {
      const url = String(input);requests.push(url);
      return new Response(JSON.stringify({videos:[]}),{status:200});
    }));
    const user = userEvent.setup();
    render(<ResearchWorkspace locale="en" onUseVideo={vi.fn(()=>true)} />);
    const search = screen.getByRole("textbox",{name:/search stored evidence/i});
    await user.type(search,"foundation repair costs");
    await waitFor(()=>expect(requests.some(url=>url.includes("topic=foundation%20repair%20costs"))).toBe(true));
    expect(requests.every(url => url.startsWith("/api/research/market/related"))).toBe(true);
  });
});

describe("Studio Research to source-backed story",()=>{
  it("generates research explicitly, previews exact citations and shots, then creates reviewed editable storyboard",async()=>{
    const requests:{url:string;options?:RequestInit}[]=[];
    vi.stubGlobal("fetch",vi.fn(async (url:RequestInfo|URL,options?:RequestInit)=>{
      requests.push({url:String(url),options});
      if(String(url).startsWith("/api/research/market/related"))return new Response(JSON.stringify({videos:[]}),{status:200});
      if(String(url)==="/api/contentgen-director/research-draft")return new Response(JSON.stringify(researchedFixture),{status:200});
      throw Error("Unexpected request");
    }));
    const create=vi.fn(()=>true),user=userEvent.setup();
    render(<ResearchWorkspace locale="en" projectTopic="Why insulation saves energy" onUseVideo={vi.fn(()=>true)} onCreateStoryboard={create}/>);
    await user.click(screen.getByRole("button",{name:/research.*generate/i}));
    expect(await screen.findByText("Insulation resists heat flow.")).toBeInTheDocument();
    expect(screen.getByText(/Insulation resists the flow of heat/)).toBeInTheDocument();
    expect(screen.getByText(/fewer heat arrows cross/)).toBeInTheDocument();
    const request=requests.find(x=>x.url.endsWith("/research-draft"));
    expect(request?.options?.method).toBe("POST");
    expect(request?.options?.headers).toMatchObject({"x-contentgen-director":"local-only"});
    await user.click(screen.getByRole("button",{name:/create editable.*storyboard/i}));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({version:1}),researchedFixture);
  });
  it("reports research errors and never invents a source-backed storyboard",async()=>{
    vi.stubGlobal("fetch",vi.fn(async (url:RequestInfo|URL)=>String(url).includes("/research-draft")
      ?new Response(JSON.stringify({error:"Local SearXNG unavailable"}),{status:422})
      :new Response(JSON.stringify({videos:[]}),{status:200})));
    const create=vi.fn(()=>true),user=userEvent.setup();
    render(<ResearchWorkspace locale="en" projectTopic="heat pump costs" onUseVideo={vi.fn(()=>true)} onCreateStoryboard={create}/>);
    await user.click(screen.getByRole("button",{name:/research.*generate/i}));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Local SearXNG unavailable/);
    expect(create).not.toHaveBeenCalled();
    expect(screen.queryByRole("button",{name:/create editable.*storyboard/i})).not.toBeInTheDocument();
  });
  it("clears stale research as soon as the topic changes",async()=>{
    vi.stubGlobal("fetch",vi.fn(async (url:RequestInfo|URL)=>String(url).includes("/research-draft")
      ?new Response(JSON.stringify(researchedFixture),{status:200})
      :new Response(JSON.stringify({videos:[]}),{status:200})));
    const create=vi.fn(()=>true),user=userEvent.setup();
    render(<ResearchWorkspace locale="en" projectTopic="Why insulation saves energy" onUseVideo={vi.fn(()=>true)} onCreateStoryboard={create}/>);
    await user.click(screen.getByRole("button",{name:/research.*generate/i}));
    expect(await screen.findByText("Insulation resists heat flow.")).toBeInTheDocument();
    const search=screen.getByRole("textbox",{name:/search stored evidence/i});
    await user.clear(search);await user.type(search,"different home heating costs");
    expect(screen.queryByText("Insulation resists heat flow.")).not.toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });
  it("invalidates reviewed evidence if the intended viewer question or audience changes",async()=>{
    vi.stubGlobal("fetch",vi.fn(async (url:RequestInfo|URL)=>String(url).includes("/research-draft")
      ?new Response(JSON.stringify(researchedFixture),{status:200})
      :new Response(JSON.stringify({videos:[]}),{status:200})));
    const user=userEvent.setup();
    render(<ResearchWorkspace locale="en" projectTopic="Why insulation saves energy" onUseVideo={vi.fn(()=>true)} onCreateStoryboard={vi.fn(()=>true)}/>);
    await user.click(screen.getByRole("button",{name:/research.*generate/i}));
    expect(await screen.findByText("Insulation resists heat flow.")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox",{name:/question to answer/i}),"But how?");
    expect(screen.queryByRole("button",{name:/create editable sourced storyboard/i})).not.toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:/research.*generate/i}));
    expect(await screen.findByText("Insulation resists heat flow.")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox",{name:/audience/i}),"New homeowners");
    expect(screen.queryByRole("button",{name:/create editable sourced storyboard/i})).not.toBeInTheDocument();
  });
  it("restores the last immutable research draft without re-running the public search or model",async()=>{
    localStorage.setItem("contentgen:studio-research:latest:v1",JSON.stringify({topic:"Why insulation saves energy",artifactId:"research_home-123456789abc"}));
    const requests:string[]=[];
    vi.stubGlobal("fetch",vi.fn(async (url:RequestInfo|URL)=>{
      requests.push(String(url));
      if(String(url)==="/api/contentgen-director/research-draft/research_home-123456789abc")
        return new Response(JSON.stringify(researchedFixture),{status:200});
      return new Response(JSON.stringify({videos:[]}),{status:200});
    }));
    render(<ResearchWorkspace locale="en" projectTopic="Why insulation saves energy" onUseVideo={vi.fn(()=>true)} onCreateStoryboard={vi.fn(()=>true)}/>);
    expect(await screen.findByText("Insulation resists heat flow.")).toBeInTheDocument();
    expect(requests).toContain("/api/contentgen-director/research-draft/research_home-123456789abc");
    expect(requests.every(x=>!x.endsWith("/research-draft"))).toBe(true);
  });
});
