import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDiscoverySession, createProduction, getProduction,
  listDiscoverySessions, listSessionIdeas, decideSessionIdea, discoverSession,
} from "./discovery-sessions";

afterEach(() => vi.restoreAllMocks());

describe("discovery session API", () => {
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
