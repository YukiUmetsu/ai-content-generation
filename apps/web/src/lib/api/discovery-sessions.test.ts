import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDiscoverySession, createProduction, getProduction,
  listDiscoverySessions, listSessionIdeas, decideSessionIdea, discoverSession,
  collectIdeaMarketEvidence,
} from "./discovery-sessions";
import { listDiscoveryRuns } from "./discovery";

afterEach(() => vi.restoreAllMocks());

describe("discovery session API", () => {
  it("normalizes the nested run before exposing provider diagnostics to a session view", async () => {
    const lastRun = { id:"run-1", projectId:"brand-1", inputRevision:"revision-1",
      status:"failed", stage:"measure_market", createdAt:1760000000, updatedAt:1760000001,
      errorCode:null, candidates:[], providerHealth:{market:{state:"partial",privateToken:"secret",
        youtube:{succeeded:2,unavailable:1,attempts:3,apiKey:"secret"}}} };
    vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({sessions:[{
      id:"session-a",projectId:"brand-1",name:"Home costs",platforms:["youtube"],
      settingsSnapshot:{},status:"failed",createdAt:1760000000,updatedAt:1760000001,
      archivedAt:null,lastRun,
    }]})));
    const [session] = await listDiscoverySessions("brand-1");
    expect(session.lastRun?.providerHealth).toEqual({market:{state:"partial",
      youtube:{succeeded:2,unavailable:1,attempts:3}}});
    expect(JSON.stringify(session.lastRun)).not.toContain("secret");
  });

  it("rejects a malformed run error instead of passing an object to React", async () => {
    vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({runs:[{
      id:"run-1",projectId:"brand-1",inputRevision:"revision-1",status:"failed",
      stage:"complete",createdAt:1760000000,updatedAt:1760000001,
      errorCode:{message:"Unexpected server shape"},candidates:[],providerHealth:{},
    }]})));
    await expect(listDiscoveryRuns("brand-1")).rejects.toThrow(/Invalid discovery run response/);
  });

  it("lists durable sessions and creates a second session without reusing the first ID", async () => {
    const first = { id: "session-a", projectId: "brand-1", name: "Home costs", platforms: ["youtube"],
      settingsSnapshot: {}, status: "ready", createdAt: 1760000000, updatedAt: 1760000000,
      archivedAt: null, lastRun: null };
    const created = { ...first, id: "session-b", name: "Insurance", platforms: ["tiktok", "instagram"] };
    const requests: { path: string; body: unknown }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
      const path = String(input);
      requests.push({ path, body: options?.body ? JSON.parse(String(options.body)) : null });
      return new Response(JSON.stringify(options?.method === "POST" ? created : { sessions: [first] }), { status: 200 });
    });
    const history = await listDiscoverySessions("brand-1");
    const next = await createDiscoverySession("brand-1", { name: "Insurance", platforms: ["tiktok", "instagram"] });
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe("session-a");
    expect(next.id).toBe("session-b");
    expect(requests[1].body).toEqual({ name: "Insurance", platforms: ["tiktok", "instagram"] });
  });

  it("keeps unsupported opportunity data unmeasured and records the selected idea only in its session", async () => {
    const source = { id: "source-1", title: "Insurance report", url: "https://example.org/report",
      provider: "searxng", observedAt: 1760000000, evidenceState: "captured" };
    const idea = { id: "idea-1", runId: "run-1", sessionId: "session-a", rank: 1,
      title: "What changes insurance costs?", hook: "Look at rebuilding costs", premise: "Home insurance explanation",
      whyNow: "Relevant to homeowners", angleKey: "insurance", sourceIds: ["source-1"], confidence: "low",
      decision: null, opportunityScore: null, scoreVersion: null, scoreInputs: {}, platformFit: {}, sources: [source],
      evidence: [{claimId:"claim-1",claimText:"Replacement costs affect coverage",sourceId:"source-1",
        sourceUrl:source.url,quote:"Replacement costs may affect insurance pricing.",reviewStatus:"unverified"}] };
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
      calls.push(`${options?.method ?? "GET"} ${String(input)}`);
      return new Response(JSON.stringify(options?.method === "POST" ? { saved: true } : { ideas: [idea] }), { status: 200 });
    });
    expect((await listSessionIdeas("brand-1", "session-a"))[0]).toMatchObject({
      opportunityScore: null, platformFit: {}, sources: [source], evidence: idea.evidence,
    });
    await decideSessionIdea("brand-1", "session-a", "idea-1", "saved");
    expect(calls[1]).toContain("/projects/brand-1/sessions/session-a/ideas/idea-1/decision");
  });

  it("parses dated per-idea observations without replacing editorial readiness", async () => {
    const assessment = { runId: "market-1", state: "succeeded", query: "roof replacement cost",
      format: "long", observedAt: 1760000000, searchedVideos: 25, sampleSize: 11,
      distinctChannels: 4, medianViews: 12400, p75Views: 28000, medianViewsPerDay: 32.5,
      recentUploads90d: 3, comparisonScore: null, comparisonCohortSize: 2, errorCode: null,
      videos: [{ videoId: "abc123", title: "Roof economics", channelTitle: "Builder",
        viewCount: 12400, publishedAt: "2025-01-01T00:00:00Z", sourceUrl: "https://www.youtube.com/watch?v=abc123" }] };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ideas: [{
      id: "idea-1", sessionId: "session-a", runId: "run-a", title: "Roof cost", opportunityScore: 62,
      marketAssessment: assessment,
    }] }), { status: 200 }));
    const idea = (await listSessionIdeas("brand-1", "session-a"))[0];
    expect(idea.opportunityScore).toBe(62);
    expect(idea.marketAssessment).toEqual(assessment);
    expect(idea.marketAssessment?.comparisonScore).toBeNull();
  });

  it("parses versioned viral potential independently of legacy research readiness", async () => {
    const viralPotential = {score:77,state:"measured",scoreVersion:"viral-potential-v1",
      format:"long",youtubeScore:76,trendScore:78,trendChangePercent:56,
      coveragePercent:100,sampleSize:12,distinctChannels:5,comparisonCohortSize:3,
      youtubeObservedAt:1760000000,trendsObservedAt:1760000000};
    vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({ideas:[{
      id:"idea-1",sessionId:"session-a",runId:"run-a",title:"House costs",
      opportunityScore:60,viralPotential,
    }]}),{status:200}));
    const [idea] = await listSessionIdeas("brand-1","session-a");
    expect(idea.opportunityScore).toBe(60);
    expect(idea.viralPotential).toEqual(viralPotential);
  });

  it("accepts a low-confidence provisional channel benchmark without other idea cohorts", async () => {
    const provisional = {score:72,state:"provisional",scoreVersion:"viral-potential-v2",
      confidence:"low",comparisonBasis:"channel_baseline",format:"long",
      youtubeScore:72,trendScore:null,trendChangePercent:null,coveragePercent:75,
      sampleSize:2,distinctChannels:1,comparisonCohortSize:0,
      channelBreakoutScore:72,channelBaselineVideos:6,channelBaselineChannels:1,
      youtubeObservedAt:1760000000,trendsObservedAt:null};
    const googleAds = {state:"succeeded",metricVersion:"google-ads-search-keywords-v1",
      query:"bookkeeping automation",observedAt:1760000000,errorCode:null,
      keywords:[{keyword:"bookkeeping software",closeVariants:["automated bookkeeping"],
        googleMonthlySearches:1200,advertiserCompetition:"HIGH",
        lowTopPageBidMicros:null,highTopPageBidMicros:null}]};
    vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({ideas:[{
      id:"idea-1",sessionId:"session-a",runId:"run-a",title:"Bookkeeping automation",
      viralPotential:provisional,googleAds,
    }]}),{status:200}));
    const [idea] = await listSessionIdeas("brand-1","session-a");
    expect(idea.viralPotential).toEqual(provisional);
    expect(idea.googleAds).toEqual(googleAds);
  });

  it("exposes attributed comparison uploads but rejects malformed baseline links", async () => {
    const source = {videoId:"abcABC12345",title:"Roof insulation tips",channelTitle:"Builder",
      viewCount:6200,publishedAt:"2026-02-01T00:00:00Z",
      sourceUrl:"https://www.youtube.com/watch?v=abcABC12345"};
    const assessment = {runId:"market-1",state:"succeeded",query:"roof insulation",format:"long",
      observedAt:1760000000,searchedVideos:3,sampleSize:1,distinctChannels:1,
      medianViews:4000,p75Views:4000,medianViewsPerDay:40,recentUploads90d:1,
      comparisonScore:null,comparisonCohortSize:0,channelBreakoutScore:72,
      channelBaselineVideos:3,channelBaselineChannels:1,
      channelBaselineExamples:[source,{...source,sourceUrl:"javascript:alert(1)"}],
      errorCode:null,videos:[]};
    vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({ideas:[{
      id:"idea-1",sessionId:"session-a",runId:"run-a",title:"Roof insulation",marketAssessment:assessment,
    }]}),{status:200}));
    const [idea] = await listSessionIdeas("brand-1","session-a");
    expect(idea.marketAssessment?.channelBaselineExamples).toEqual([source]);
  });

  it("rejects malformed viral scores instead of rendering a fabricated 100/100", async () => {
    vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({ideas:[
      {id:"idea-1",sessionId:"session-a",runId:"run-a",title:"House costs",
        opportunityScore:100,viralPotential:{score:100,state:"measured",scoreVersion:"evidence-readiness-v1",
          format:"long",youtubeScore:100,trendScore:100,trendChangePercent:100,coveragePercent:100,
          sampleSize:12,distinctChannels:5,comparisonCohortSize:3,youtubeObservedAt:1,trendsObservedAt:1}},
      {id:"idea-2",sessionId:"session-a",runId:"run-a",title:"Insurance costs",
        viralPotential:{score:999,state:"partial",scoreVersion:"viral-potential-v1",
          format:"long",youtubeScore:50,trendScore:null,trendChangePercent:null,coveragePercent:75,
          sampleSize:12,distinctChannels:5,comparisonCohortSize:3,youtubeObservedAt:1,trendsObservedAt:null}},
    ]}),{status:200}));
    const ideas = await listSessionIdeas("brand-1","session-a");
    expect(ideas[0].viralPotential).toBeNull();
    expect(ideas[1].viralPotential).toBeNull();
  });

  it("parses a saved Google Trends momentum change but never substitutes a value for unavailable data", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ideas:[
      {id:"idea-1",sessionId:"session-a",runId:"run-a",title:"Repair costs",googleTrends:{
        state:"succeeded",query:"roof repair cost",region:"US",observedAt:1760000000,
        recentMean:34.5,previousMean:49.0,changePercent:-29.6,points:52,
        metricVersion:"google-trends-momentum-v1",errorCode:null}},
      {id:"idea-2",sessionId:"session-a",runId:"run-a",title:"Insulation costs",googleTrends:{
        state:"unavailable",query:"insulation cost",region:"US",observedAt:null,
        recentMean:0,previousMean:null,changePercent:null,points:0,errorCode:"rate_limited"}},
    ]}),{status:200}));
    const results=await listSessionIdeas("brand-1","session-a");
    expect(results[0].googleTrends).toMatchObject({state:"succeeded",changePercent:-29.6,points:52});
    expect(results[1].googleTrends).toMatchObject({state:"unavailable",changePercent:null,errorCode:"rate_limited"});
    expect(results[1].marketAssessment).toBeNull();
  });

  it("explicit collection sends only the search phrase and video format with a scoped local header", async () => {
    const requests: {url:string; method:string | undefined; headers: Headers; body: unknown}[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
      requests.push({url:String(input), method:options?.method,
        headers:new Headers(options?.headers), body:JSON.parse(String(options?.body))});
      return new Response(JSON.stringify({ runId: "market-1", state: "running" }), { status: 202 });
    });
    await collectIdeaMarketEvidence("project 1", "session-1", "idea-1", {
      query: "  roof replacement cost  ", format: "shorts",
    });
    expect(requests[0].url).toBe("/api/research/discovery/projects/project%201/sessions/session-1/ideas/idea-1/market");
    expect(requests[0].method).toBe("POST");
    expect(requests[0].headers.get("X-Contentgen-Discovery")).toBe("local-only");
    expect(requests[0].body).toEqual({ query: "roof replacement cost", format: "shorts" });
  });

  it("rejects a search phrase that exceeds the local collector limit without making a request", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch");
    await expect(collectIdeaMarketEvidence("project-1","session-1","idea-1",{
      query:"x".repeat(121),format:"long",
    })).rejects.toThrow(/120/);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(collectIdeaMarketEvidence("project-1","session-1","idea-1",{
      query:"valid phrase\ninvalid",format:"long",
    })).rejects.toThrow(/control characters/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("starts the real director worker with session ownership instead of creating an unprocessed Rust run", async () => {
    const requests: {url:string;body:unknown;header:string|null}[] = [];
    vi.spyOn(globalThis,"fetch").mockImplementation(async (input,options) => {
      requests.push({url:String(input),body:JSON.parse(String(options?.body)),
        header:new Headers(options?.headers).get("X-Contentgen-Director")});
      return new Response(JSON.stringify({id:"discover_"+"a".repeat(24),projectId:"brand-1",sessionId:"session-a",
        status:"queued",stage:"select_topics",candidates:[],providerHealth:{},createdAt:1760000000,updatedAt:1760000000,
        inputRevision:"rev-a",errorCode:null}),{status:202});
    });
    await discoverSession("brand-1","session-a",{projectName:"Margin Atlas",description:"Owner economics"});
    expect(requests).toEqual([{url:"/api/contentgen-director/project-discovery",header:"local-only",body:{
      projectId:"brand-1",sessionId:"session-a",projectName:"Margin Atlas",description:"Owner economics",
    }}]);
  });

  it("creates distinct productions under the existing brand with a stable idea reference", async () => {
    const body = { projectId: "brand-1", sessionId: "session-a", ideaId: "idea-1",
      platforms: ["youtube" as const], brief: { topic: "Home insurance", title: "Insurance costs explained",
        angle: "Hidden replacement costs", description: "A grounded homeowner explainer", keywords: [],
        platforms: ["youtube" as const] } };
    const saved = { id: "production-1", ...body, status: "draft", createdAt: 1760000000, updatedAt: 1760000000 };
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
      calls.push(`${options?.method ?? "GET"} ${String(input)}`);
      return new Response(JSON.stringify(saved), { status: 200 });
    });
    const produced = await createProduction(body);
    expect(produced).toMatchObject({ id: "production-1", projectId: "brand-1", ideaId: "idea-1" });
    expect((await getProduction("production-1")).id).toBe("production-1");
    expect(calls).toEqual(["POST /api/productions", "GET /api/productions/production-1"]);
  });
});
