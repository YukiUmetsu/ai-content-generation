import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { YoutubeIntelligencePanel } from "./youtube-intelligence-panel";

afterEach(() => vi.unstubAllGlobals());

function fakeApi(withVideo: boolean) {
  let watchlists: Array<Record<string, unknown>> = withVideo ? [{
    id: "watch-demo", name: "House Math", query: "heat pump cost",
    region: "US", language: "en", enabled: true,
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
      const item = {id:"watch-new",createdAt:123,updatedAt:123,nextDueAt:123,lastFinishedAt:null,backoffUntil:0,errorCode:null,...input};
      watchlists = [...watchlists,item];
      data = item;status=201;
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
});
