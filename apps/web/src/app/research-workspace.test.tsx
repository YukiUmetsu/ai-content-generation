import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResearchWorkspace } from "./research-workspace";
import type { EditorialDraft } from "./editorial-brief";

vi.mock("./packaging-panel", () => ({PackagingPanel: () => null}));
vi.mock("./youtube-intelligence-panel", () => ({YoutubeIntelligencePanel: () => null}));

afterEach(() => vi.unstubAllGlobals());

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
    await user.click(screen.getByRole("button",{name:/create.*storyboard/i}));
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
