import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { YoutubeIntelligencePanel } from "./youtube-intelligence-panel";
import type { EditorialDraft } from "./editorial-brief";

afterEach(() => vi.unstubAllGlobals());

function fakeApi(withVideo: boolean, enabled = true) {
  let watchlists: Array<Record<string, unknown>> = withVideo ? [{
    id: "watch-demo", name: "House Math", query: "heat pump cost",
    queryMode:"manual", queryPlan:[],queryPlanSource:"user-edited",queryIndex:0,queryPlanRevision:0,lastSearchQuery:null,nextSearchQuery:"heat pump cost",
    region: "US", language: "en", enabled,
    createdAt: 123, updatedAt: 123, nextDueAt: 456,
    lastFinishedAt: 789, backoffUntil: 0, errorCode: null,
  }] : [];
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push((init?.method ?? "GET") + " " + url);
    let data: unknown;
    let status = 200;
    if (url.endsWith("/status")) data = {apiKeyConfigured:true,collecting:false,searchCallsLast24h:1,searchCallLimit:20};
    else if (url.endsWith("/watchlists") && (init?.method ?? "GET") === "GET") data = {watchlists};
    else if (url.endsWith("/watchlists") && init?.method === "POST") {
      const input = JSON.parse(String(init.body)) as Record<string,unknown>;
      const item = {id:"watch-new",createdAt:123,updatedAt:123,nextDueAt:123,lastFinishedAt:null,backoffUntil:0,errorCode:null,queryIndex:0,queryPlanRevision:0,lastSearchQuery:null,nextSearchQuery:input.query || input.name,...input};
      watchlists = [...watchlists,item];
      data = item;status=201;
    }
    else if (url.endsWith("/market-queries") && init?.method === "POST") {
      data={queries:["mortgage closing costs","roof replacement price","heat pump ownership cost","property tax assessment"],source:"local-model-generated"};
    }
    else if (url.endsWith("/collect") && init?.method === "POST") {
      data = {runId:"run-test",state:"queued"}; status = 202;
    }
    else if (url.endsWith("/videos")) data = {videos: withVideo ? [{
      videoId:"abcABC12345",title:"Heating systems compared",channelId:"UCdemo",
      channelTitle:"Demo",publishedAt:"2026-01-01T00:00:00Z",durationSeconds:320,
      viewCount:1200,likeCount:null,commentCount:null,subscriberCount:null,
      sourceUrl:"https://www.youtube.com/watch?v=abcABC12345",
      provider:"youtube-data-api",observedAt:123,expiresAt:1234567
    }] : []};
    else throw Error("Unexpected request " + url);
    return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json"}});
  }));
  return requests;
}

describe("YouTube Intelligence", () => {

  it("saves a niche-only watchlist without a phrase and marks automatic exploration", async () => {
    fakeApi(false);
    const user=userEvent.setup();
    render(<YoutubeIntelligencePanel locale="en" onUseVideo={vi.fn(() => true)}/>);
    await user.type(await screen.findByRole("textbox",{name:/niche name/i}),"House Math");
    expect(screen.getByRole("button",{name:/add watchlist/i})).toBeEnabled();
    await user.click(screen.getByRole("button",{name:/add watchlist/i}));
    expect((await screen.findAllByText(/Explore niche automatically/i)).length).toBeGreaterThan(0);
    const posts=(fetch as ReturnType<typeof vi.fn>).mock.calls.filter((call:unknown[])=>String(call[0]).endsWith("/watchlists") && (call[1] as RequestInit)?.method==="POST");
    const body=JSON.parse(String((posts[0][1] as RequestInit).body));
    expect(body).toMatchObject({name:"House Math",query:"",queryMode:"auto",queryPlan:[]});
  });

  it("generates an editable local research query plan before saving",async()=>{
    fakeApi(false);
    const user=userEvent.setup();
    render(<YoutubeIntelligencePanel locale="en" onUseVideo={vi.fn(() => true)}/>);
    await user.type(await screen.findByRole("textbox",{name:/niche name/i}),"House Math");
    await user.click(screen.getByRole("button",{name:/suggest searches with local ai/i}));
    expect((await screen.findByRole("textbox",{name:/proposed searches/i}) as HTMLTextAreaElement).value).toContain("mortgage closing costs");
    await user.click(screen.getByRole("button",{name:/add watchlist/i}));
    const posts=(fetch as ReturnType<typeof vi.fn>).mock.calls.filter((call:unknown[])=>String(call[0]).endsWith("/watchlists") && (call[1] as RequestInit)?.method==="POST");
    expect(JSON.parse(String((posts[0][1] as RequestInit).body)).queryPlan).toContain("roof replacement price");
  });
  it("creates a user-controlled watchlist through the local server", async () => {
    const requests = fakeApi(false);
    const user = userEvent.setup();
    render(<YoutubeIntelligencePanel locale="en" onUseVideo={vi.fn(() => true)}/>);
    await user.type(await screen.findByRole("textbox",{name:/niche name/i}), "House Math");
    await user.type(screen.getByRole("textbox",{name:/search phrase/i}), "heat pump cost");
    await user.click(screen.getByRole("button",{name:/add watchlist/i}));
    await waitFor(() => expect(screen.getByText("House Math")).toBeInTheDocument());
    expect(requests).toContain("POST /api/research/market/watchlists");
  });

  it("allows Collect now without activating daily automatic collection", async () => {
    const requests = fakeApi(true, false);
    const user = userEvent.setup();
    render(<YoutubeIntelligencePanel locale="en" onUseVideo={vi.fn(() => true)}/>);
    const collect = await screen.findByRole("button",{name:/collect now/i});
    expect(collect).toBeEnabled();
    await user.click(collect);
    expect(await screen.findByText(/Collection queued locally/i)).toBeInTheDocument();
    expect(requests).toContain("POST /api/research/market/watchlists/watch-demo/collect");
    expect(screen.getByText(/Daily automatic collection off/i)).toBeInTheDocument();
  });

  it("saves an original editable idea without copying competitor metrics", async () => {
    fakeApi(true);
    const onUseVideo=vi.fn(() => true);
    const user=userEvent.setup();
    render(<YoutubeIntelligencePanel locale="en" onUseVideo={onUseVideo}/>);
    await user.click(await screen.findByRole("button",{name:/use for video/i}));
    const title = screen.getByRole("textbox",{name:/working video title/i});
    await user.clear(title);
    await user.type(title,"Does a Heat Pump Save Money in Oklahoma?");
    await user.click(screen.getByRole("button",{name:/save video idea/i}));
    expect(onUseVideo).toHaveBeenCalledWith({
      title:"Does a Heat Pump Save Money in Oklahoma?",
      sourceUrl:"https://www.youtube.com/watch?v=abcABC12345"
    });
  });

  it("turns a niche into an editable original brief and passes the selected pattern to Storyboard", async () => {
    fakeApi(true);
    const onCreateStoryboard = vi.fn((draft: EditorialDraft) => draft.version === 1);
    const user = userEvent.setup();
    render(<YoutubeIntelligencePanel locale="en" onUseVideo={vi.fn(() => true)} onCreateStoryboard={onCreateStoryboard}/>);
    const audience = await screen.findByRole("textbox",{name:"Who is this for?"});
    await user.clear(audience);
    await user.type(audience,"Homeowners comparing heating systems");
    await user.click(screen.getByText("Decision comparison", {selector:"span"}));
    const narration = screen.getByRole("textbox",{name:"Opening narration / hook"});
    await user.clear(narration);
    await user.type(narration,"Before replacing a furnace, what needs comparing?");
    await user.click(screen.getByRole("button",{name:/Create video project.*Storyboard/i}));
    expect(onCreateStoryboard).toHaveBeenCalledTimes(1);
    const draft = onCreateStoryboard.mock.calls[0][0];
    expect(draft.selectedId).toBe("comparison");
    expect(draft.input.audience).toBe("Homeowners comparing heating systems");
    expect(draft.approaches[2].hook).toBe("Before replacing a furnace, what needs comparing?");
    expect(JSON.stringify(draft)).not.toContain("1200");
  });

  it("keeps observed video links as inspiration only rather than factual evidence", async () => {
    fakeApi(true);
    const user = userEvent.setup();
    render(<YoutubeIntelligencePanel locale="en" onUseVideo={vi.fn(() => true)} onCreateStoryboard={vi.fn(() => true)}/>);
    await user.click(await screen.findByRole("button",{name:/reference in brief/i}));
    expect(screen.getByRole("textbox",{name:/selected youtube inspiration/i})).toHaveValue("https://www.youtube.com/watch?v=abcABC12345");
    expect(screen.getByRole("textbox",{name:"Original topic"})).toHaveValue("heat pump cost");
    expect(JSON.stringify(localStorage)).not.toContain("Heating systems compared");
  });
});
