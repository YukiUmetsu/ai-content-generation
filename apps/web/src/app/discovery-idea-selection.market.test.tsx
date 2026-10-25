import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiscoveryIdeaSelection } from "./discovery-idea-selection";
import type { DiscoverySessionIdea, IdeaMarketAssessment } from "@/lib/api/discovery-sessions";

afterEach(() => vi.restoreAllMocks());

const session = { id: "session-1", projectId: "project-1", name: "Cost questions", platforms: ["youtube"],
  settingsSnapshot: {}, status: "ready", createdAt: 1760000000, updatedAt: 1760000000, archivedAt: null };

const idea = (id: string, assessment: IdeaMarketAssessment | null = null): DiscoverySessionIdea => ({
  id, sessionId: "session-1", runId: "run-1", rank: Number(id.split("-")[1]), title: `Question ${id}`,
  hook: "Why is this happening?", premise: "An evidenced explainer", whyNow: "A timely question",
  angleKey: "cost", confidence: "low", sourceIds: [], decision: null, opportunityScore: 77,
  scoreVersion: "evidence-readiness-v1", scoreInputs: {}, platformFit: {}, sources: [], marketAssessment: assessment,
});

const assessment = (format: "long" | "shorts", comparisonScore: number | null): IdeaMarketAssessment => ({
  runId: "market-1", state: "succeeded", query: "home energy costs", format,
  metricVersion: "youtube-comparables-v1", region: "US", language: "en",
  observedAt: 1760000000, searchedVideos: 25, sampleSize: 12, distinctChannels: 5,
  medianViews: 18400, p75Views: 38200, medianViewsPerDay: 52.4, recentUploads90d: 4,
  comparisonScore, comparisonCohortSize: comparisonScore === null ? 2 : 3, errorCode: null,
  videos: [{ videoId: "videoABC123", title: "What bills really cost", channelTitle: "Home Lab",
    viewCount: 18400, publishedAt: "2025-07-11T00:00:00Z",
    sourceUrl: "https://www.youtube.com/watch?v=videoABC123" }],
});

function serve(initialIdeas: DiscoverySessionIdea[], opts: { keyConfigured?: boolean; afterCollect?: DiscoverySessionIdea[]; lastRun?: Record<string, unknown>; backfillState?: "queued" | "running" | "no_pending" } = {}) {
  const posts: Array<{query:string;format:string}> = [];
  const backfills: string[] = [];
  let collected = false;
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (request, init) => {
    const url = String(request);
    if (url.endsWith("/market/status")) return new Response(JSON.stringify({ apiKeyConfigured: opts.keyConfigured ?? true,
      collecting: false, searchCallsLast24h: 1, searchCallLimit: 20 }), {status: 200});
    if (url.endsWith("/market/backfill") && init?.method === "POST") {
      backfills.push(url);
      return new Response(JSON.stringify({state:opts.backfillState ?? "no_pending",queuedRunIds:[]}),{status:202});
    }
    if (url.endsWith("/runs")) return new Response(JSON.stringify({runs:opts.lastRun ? [opts.lastRun] : []}),{status:200});
    if (url.endsWith("/ideas/idea-1/market") && init?.method === "POST") {
      collected = true;
      posts.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ runId: "market-1", state: "running" }), {status: 202});
    }
    if (url.endsWith("/ideas")) return new Response(JSON.stringify({ideas: collected && opts.afterCollect
      ? opts.afterCollect : initialIdeas}), {status:200});
    if (url.endsWith("/session-1")) return new Response(JSON.stringify({...session, ...(opts.lastRun ? {lastRun:opts.lastRun} : {})}),{status:200});
    throw Error(`Unexpected route: ${url}`);
  });
  return {posts, backfills, fetcher};
}

describe("per-idea YouTube market evidence", () => {
  it("automatically starts the durable backfill job for unmeasured YouTube and Trends ideas", async () => {
    const {backfills} = serve([idea("idea-1")], {backfillState:"queued"});
    render(<DiscoveryIdeaSelection projectId="project-1" sessionId="session-1" locale="en" onStartProduction={()=>{}} />);
    await screen.findByText("Question idea-1");
    await waitFor(() => expect(backfills).toEqual([
      "/api/research/discovery/projects/project-1/sessions/session-1/market/backfill",
    ]));
    expect(await screen.findByText(/Market observations queued for background collection/)).toBeInTheDocument();
  });

  it("automatically queues saved failed and unavailable provider observations", async () => {
    const failedYoutube = { ...assessment("long", null), state: "failed" as const,
      errorCode: "provider_unavailable", sampleSize: 0, videos: [] };
    const unavailableTrends = { state: "unavailable" as const,
      query: "home energy costs", region: "US", observedAt: null,
      recentMean: null, previousMean: null, changePercent: null, points: 0,
      metricVersion: "google-trends-momentum-v1", errorCode: "provider_unavailable" };
    const {backfills} = serve([{...idea("idea-1", failedYoutube), googleTrends: unavailableTrends}],
      {backfillState: "queued"});
    render(<DiscoveryIdeaSelection projectId="project-1" sessionId="session-1"
      locale="en" onStartProduction={()=>{}} />);
    await screen.findByText("Question idea-1");
    await waitFor(() => expect(backfills).toHaveLength(1));
    expect(await screen.findByText(/Market observations queued for background collection/))
      .toBeInTheDocument();
  });

  it("explains cooldown instead of claiming collection is running", async () => {
    const failedYoutube = { ...assessment("long", null), state: "failed" as const,
      errorCode: "rate_limited", sampleSize: 0, videos: [] };
    const {backfills} = serve([idea("idea-1", failedYoutube)], {backfillState:"no_pending"});
    render(<DiscoveryIdeaSelection projectId="project-1" sessionId="session-1"
      locale="en" onStartProduction={()=>{}} />);
    await waitFor(() => expect(backfills).toHaveLength(1));
    expect(await screen.findByText(/Waiting to retry market collection/))
      .toBeInTheDocument();
    expect(screen.queryByText(/Collecting YouTube and Google Trends observations/))
      .not.toBeInTheDocument();
  });

  it("shows the saved partial market collection summary even when Discovery completed", async () => {
    serve([idea("idea-1")], {lastRun:{
      id:"discover_"+"a".repeat(24), projectId:"project-1", inputRevision:"revision",
      status:"completed", stage:"completed", createdAt:1760000000, updatedAt:1760000000,
      errorCode:null, candidates:[],
      providerHealth:{market:{state:"partial",
        youtube:{succeeded:0,unavailable:1}, googleTrends:{succeeded:0,unavailable:1}}},
    }});
    render(<DiscoveryIdeaSelection projectId="project-1" sessionId="session-1" locale="en" onStartProduction={()=>{}} />);
    expect(await screen.findByText(/Discovery market collection: Partial/)).toBeInTheDocument();
    expect(screen.getByText(/YouTube: 0 succeeded, 1 unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Google Trends: 0 succeeded, 1 unavailable/)).toBeInTheDocument();
  });

  it("shows readiness and why older ideas have no automatic market observations", async () => {
    serve([idea("idea-1")], {keyConfigured:false});
    render(<DiscoveryIdeaSelection projectId="project-1" sessionId="session-1" locale="en" onStartProduction={()=>{}} />);
    const card = (await screen.findByText("Question idea-1")).closest("article")!;
    expect(within(card).getByText("Research readiness: 77/100")).toBeInTheDocument();
    expect(within(card).getByText(/Add a YouTube API key in Settings/)).toBeInTheDocument();
    expect(within(card).getByText(/No saved observation. Missing Trends data is queued for background collection when eligible/)).toBeInTheDocument();
  });

  it("shows the exact saved provider failure categories without expanding details", async () => {
    const unavailable = {...assessment("long", null), state:"failed" as const,
      errorCode:"budget_exhausted", sampleSize:0, distinctChannels:0, videos:[]};
    const trend = {state:"unavailable" as const, query:"home energy costs", region:"US", observedAt:null,
      recentMean:null, previousMean:null, changePercent:null, points:0,
      metricVersion:"google-trends-momentum-v1", errorCode:"collection_limit"};
    serve([{...idea("idea-1", unavailable), googleTrends:trend}]);
    render(<DiscoveryIdeaSelection projectId="project-1" sessionId="session-1" locale="en" onStartProduction={()=>{}} />);
    const card = (await screen.findByText("Question idea-1")).closest("article")!;
    expect(within(card).getByText(/20 calls per 24 hours/)).toBeInTheDocument();
    expect(within(card).getByText(/Google Trends collection limit/)).toBeInTheDocument();
  });

  it("renders automatically saved YouTube and Google Trends signals without requesting a new collection", async () => {
    const trend = { state: "succeeded" as const, query: "home energy costs", region: "US", observedAt: 1760000000,
      recentMean: 62.4, previousMean: 40.0, changePercent: 56.0, points: 52,
      metricVersion: "google-trends-momentum-v1", errorCode: null };
    const { fetcher } = serve([{ ...idea("idea-1", assessment("long", 76)), googleTrends: trend }]);
    const user = userEvent.setup();
    render(<DiscoveryIdeaSelection projectId="project-1" sessionId="session-1" locale="en" onStartProduction={()=>{}} />);
    const card = (await screen.findByText("Question idea-1")).closest("article")!;
    expect(within(card).getByText("76")).toBeInTheDocument();
    expect(within(card).getByText("+56%")).toBeInTheDocument();
    expect(within(card).getByText(/Google search momentum/i)).toBeInTheDocument();
    expect(fetcher.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
    await user.click(within(card).getByRole("button", { name: "Evidence details" }));
    expect(within(card).getByText(/Previous interest index/i)).toBeInTheDocument();
    expect(within(card).getByText("40")).toBeInTheDocument();
    expect(within(card).getByText("62.4")).toBeInTheDocument();
    expect(within(card).getByText(/normalized within this query/i)).toBeInTheDocument();
  });

  it("labels a blocked Google Trends source as unavailable instead of inventing a score", async () => {
    serve([{ ...idea("idea-1", assessment("long", null)), googleTrends: {
      state: "failed", query: "home energy costs", region: "US", observedAt: null,
      recentMean: null, previousMean: null, changePercent: null, points: 0,
      metricVersion: "google-trends-momentum-v1", errorCode: "provider_blocked",
    } }]);
    render(<DiscoveryIdeaSelection projectId="project-1" sessionId="session-1" locale="en" onStartProduction={()=>{}} />);
    const card = (await screen.findByText("Question idea-1")).closest("article")!;
    expect(within(card).getByText(/Google Trends unavailable/i)).toBeInTheDocument();
    expect(within(card).queryByText(/\+0%/)).not.toBeInTheDocument();
    expect(within(card).queryByText(/\+50%/)).not.toBeInTheDocument();
  });

  it("sorts by measured within-query momentum only when YouTube cohort scores are missing", async () => {
    const googleTrends = (changePercent: number) => ({
      state:"succeeded" as const,query:"homeownership costs",region:"US",observedAt:1760000000,
      recentMean:44,previousMean:34,changePercent,points:52,metricVersion:"google-trends-momentum-v1",errorCode:null,
    });
    serve([{...idea("idea-1"),googleTrends:googleTrends(-12)},
      {...idea("idea-2"),googleTrends:googleTrends(34)},
      {...idea("idea-3"),googleTrends:googleTrends(8)}]);
    render(<DiscoveryIdeaSelection projectId="project-1" sessionId="session-1" locale="en" onStartProduction={()=>{}} />);
    await screen.findByText("Question idea-1");
    expect(screen.getAllByRole("article").map(article => within(article).getByRole("heading", {level:3}).textContent))
      .toEqual(["Question idea-2", "Question idea-3", "Question idea-1"]);
    expect(within(screen.getAllByRole("article")[2]).getByText("-12%")).toBeInTheDocument();
    expect(screen.queryByText("Leads measured cohort")).not.toBeInTheDocument();
  });
  it("queues missing observations on page load without directly spending YouTube quota", async () => {
    const { posts, backfills, fetcher } = serve([idea("idea-1")], {keyConfigured:false});
    render(<DiscoveryIdeaSelection projectId="project-1" sessionId="session-1" locale="en" onStartProduction={()=>{}} />);
    expect(await screen.findByText("Question idea-1")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", {name:"Evidence details"}));
    expect(await screen.findByText(/Connect YouTube in Settings/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Measure on YouTube" })).toBeDisabled();
    expect(posts).toEqual([]);
    await waitFor(() => expect(backfills).toHaveLength(1));
    expect(fetcher.mock.calls.filter(([request, init]) =>
      String(request).endsWith("/ideas/idea-1/market") && init?.method === "POST")).toHaveLength(0);
  });

  it("collects a user-edited search phrase for the chosen format and shows a running state", async () => {
    const running = { ...assessment("shorts", null), state: "running" as const, observedAt: null,
      sampleSize: 0, medianViews: null, videos: [] };
    const { posts } = serve([idea("idea-1")], {afterCollect:[idea("idea-1", running)]});
    const user = userEvent.setup();
    render(<DiscoveryIdeaSelection projectId="project-1" sessionId="session-1" locale="en" onStartProduction={()=>{}} />);
    await screen.findByText("Question idea-1");
    await user.selectOptions(screen.getByRole("combobox", {name:"Compare format"}), "shorts");
    await user.click(screen.getByRole("button", {name:"Evidence details"}));
    await user.clear(screen.getByRole("textbox", {name:"YouTube search phrase for Question idea-1"}));
    await user.type(screen.getByRole("textbox", {name:"YouTube search phrase for Question idea-1"}), "  household energy costs  ");
    await user.click(screen.getByRole("button", {name:"Measure on YouTube"}));
    await waitFor(() => expect(posts).toEqual([{query:"household energy costs", format:"shorts"}]));
    expect(await screen.findByText(/Collecting public videos/i)).toBeInTheDocument();
  });

  it("keeps a long idea title within the provider search-length limit", async () => {
    const longTitle = "Why municipal infrastructure repair bills keep increasing across multiple neighborhoods and varied construction sectors and over time";
    const longIdea = { ...idea("idea-1"), title: longTitle };
    const { posts } = serve([longIdea], {afterCollect:[idea("idea-1", { ...assessment("long", null), state:"running" })]});
    const user = userEvent.setup();
    render(<DiscoveryIdeaSelection projectId="project-1" sessionId="session-1" locale="en" onStartProduction={()=>{}} />);
    await screen.findByText(longTitle);
    await user.click(screen.getByRole("button", {name:"Evidence details"}));
    const input = screen.getByRole("textbox", {name:`YouTube search phrase for ${longTitle}`}) as HTMLInputElement;
    expect(input.value.length).toBeLessThanOrEqual(120);
    await user.click(screen.getByRole("button", {name:"Measure on YouTube"}));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].query.length).toBeLessThanOrEqual(120);
  });

  it("shows observed counts and sources on expansion but never treats readiness as market demand", async () => {
    serve([idea("idea-1", assessment("long", null))]);
    const user = userEvent.setup();
    render(<DiscoveryIdeaSelection projectId="project-1" sessionId="session-1" locale="en" onStartProduction={()=>{}} />);
    await screen.findByText("Question idea-1");
    expect(screen.getByText(/18\.4K median views/)).toBeInTheDocument();
    expect(screen.getByText("12 videos · 5 channels")).toBeInTheDocument();
    expect(screen.queryByText(/Top 3 recommendation/)).not.toBeInTheDocument();
    expect(screen.getByText(/Comparison unavailable/i)).toBeInTheDocument();
    const card = screen.getByText("Question idea-1").closest("article")!;
    await user.click(within(card).getByRole("button", {name:"Evidence details"}));
    expect(within(card).getByText(/75th percentile/i)).toBeInTheDocument();
    expect(within(card).getByText(/52.4/)).toBeInTheDocument();
    expect(within(card).getByText(/Search relevance: US \/ English · youtube-comparables-v1/)).toBeInTheDocument();
    expect(within(card).getByRole("link", {name:/What bills really cost/})).toHaveAttribute("href", "https://www.youtube.com/watch?v=videoABC123");
  });

  it("does not open a noncanonical URL as a cited YouTube observation", async () => {
    const market = assessment("long", null);
    serve([idea("idea-1", {...market, videos:[{...market.videos[0],
      sourceUrl:"https://outside.example/watch?v=videoABC123"}]})]);
    render(<DiscoveryIdeaSelection projectId="project-1" sessionId="session-1" locale="en" onStartProduction={()=>{}} />);
    await screen.findByText("Question idea-1");
    await userEvent.setup().click(screen.getByRole("button",{name:"Evidence details"}));
    expect(screen.getByText("What bills really cost")).toBeInTheDocument();
    expect(screen.queryByRole("link",{name:/What bills really cost/})).not.toBeInTheDocument();
  });

  it("reveals details on hover and keeps the disclosure usable without hover", async () => {
    serve([idea("idea-1", assessment("long", null))]);
    const user = userEvent.setup();
    render(<DiscoveryIdeaSelection projectId="project-1" sessionId="session-1" locale="en" onStartProduction={()=>{}} />);
    const details = await screen.findByRole("button", {name:"Evidence details"});
    expect(screen.queryByText(/75th percentile views/)).not.toBeInTheDocument();
    await user.hover(details);
    expect(screen.getByText(/75th percentile views/)).toBeInTheDocument();
    expect(screen.queryByRole("link", {name:/What bills really cost/})).not.toBeInTheDocument();
    await user.unhover(details);
    expect(screen.queryByText(/75th percentile views/)).not.toBeInTheDocument();
    await user.click(details);
    expect(details).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/75th percentile views/)).toBeInTheDocument();
  });

  it("does not name a leader for tied measured comparisons", async () => {
    serve([idea("idea-1", assessment("long", 50)), idea("idea-2", assessment("long", 50)),
      idea("idea-3", assessment("long", 50))]);
    render(<DiscoveryIdeaSelection projectId="project-1" sessionId="session-1" locale="en" onStartProduction={()=>{}} />);
    await screen.findByText("Question idea-1");
    expect(screen.queryByText("Leads measured cohort")).not.toBeInTheDocument();
  });

  it("does not offer another provider search before the saved per-idea cooldown ends", async () => {
    serve([idea("idea-1", {...assessment("long", null),
      nextCollectionAt:Math.floor(Date.now()/1000)+1800})]);
    render(<DiscoveryIdeaSelection projectId="project-1" sessionId="session-1" locale="en" onStartProduction={()=>{}} />);
    expect(await screen.findByText("Question idea-1")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button",{name:"Evidence details"}));
    expect(screen.getByRole("button",{name:"Measure on YouTube"})).toBeDisabled();
    expect(screen.getByText(/Next search after/)).toBeInTheDocument();
  });

  it("restarts local polling from a persisted running assessment and renders the finished observation", async () => {
    let checks = 0;
    const running = { ...assessment("long", null), state: "running" as const, observedAt: null, videos: [] };
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const url = String(input);
      if (url.endsWith("/market/status")) return new Response(JSON.stringify({apiKeyConfigured:true,
        collecting:false,searchCallsLast24h:1,searchCallLimit:20}),{status:200});
      if (url.endsWith("/ideas")) return new Response(JSON.stringify({ideas:[idea("idea-1",
        ++checks > 1 ? assessment("long", null) : running)]}),{status:200});
      return new Response(JSON.stringify(session),{status:200});
    });
    render(<DiscoveryIdeaSelection projectId="project-1" sessionId="session-1" locale="en" onStartProduction={()=>{}} />);
    expect(await screen.findByText(/Collecting public videos/i)).toBeInTheDocument();
    expect(await screen.findByText("12 videos · 5 channels", {}, {timeout:8000})).toBeInTheDocument();
  }, 12000);

  it("refreshes shared quota status when collection finishes so another idea remains actionable", async () => {
    const first = idea("idea-1");
    const second = idea("idea-2");
    const running = { ...assessment("long", null), state:"running" as const, observedAt:null, videos:[] };
    let started = false;
    let checks = 0;
    let statusCollecting = false;
    vi.spyOn(globalThis,"fetch").mockImplementation(async (request,init) => {
      const url = String(request);
      if (url.endsWith("/market/status")) return new Response(JSON.stringify({apiKeyConfigured:true,
        collecting:statusCollecting,searchCallsLast24h:started?2:1,searchCallLimit:20}),{status:200});
      if (url.endsWith("/idea-1/market") && init?.method === "POST") {
        started = true; statusCollecting = true;
        return new Response(JSON.stringify({runId:"market-1",state:"running"}),{status:202});
      }
      if (url.endsWith("/ideas")) {
        if (started && ++checks > 2) statusCollecting = false;
        return new Response(JSON.stringify({ideas:[started ? {...first, marketAssessment:statusCollecting
          ? running : assessment("long",null)} : first, second]}),{status:200});
      }
      return new Response(JSON.stringify(session),{status:200});
    });
    const user = userEvent.setup();
    render(<DiscoveryIdeaSelection projectId="project-1" sessionId="session-1" locale="en" onStartProduction={()=>{}} />);
    await screen.findByText("Question idea-1");
    for (const detail of screen.getAllByRole("button", {name:"Evidence details"})) await user.click(detail);
    await user.click(screen.getAllByRole("button",{name:"Measure on YouTube"})[0]);
    expect(await screen.findByText(/Collecting public videos/)).toBeInTheDocument();
    expect(await screen.findByText("12 videos · 5 channels", {}, {timeout:8000})).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("button",{name:"Measure on YouTube"})[1]).toBeEnabled());
  }, 12000);

  it("never ranks a shorts observation against a long-video cohort", async () => {
    serve([idea("idea-1", assessment("shorts", 95)), idea("idea-2", assessment("long", 65)),
      idea("idea-3", assessment("long", 45)), idea("idea-4", assessment("long", 25))]);
    const user = userEvent.setup();
    render(<DiscoveryIdeaSelection projectId="project-1" sessionId="session-1" locale="en" onStartProduction={()=>{}} />);
    await screen.findByText("Question idea-1");
    const articleTitles = () => screen.getAllByRole("article").map(article => within(article).getByRole("heading", {level:3}).textContent);
    expect(articleTitles()[0]).toBe("Question idea-2");
    expect(within(screen.getAllByRole("article")[0]).getByText("65")).toBeInTheDocument();
    expect(screen.queryByText("95")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", {name:"Compare format"}), "shorts");
    expect(articleTitles()[0]).toBe("Question idea-1");
    expect(within(screen.getAllByRole("article")[0]).getByText("95")).toBeInTheDocument();
    expect(screen.queryByText("65")).not.toBeInTheDocument();
  });
});
