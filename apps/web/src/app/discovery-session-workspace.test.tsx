import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiscoverySessionWorkspace } from "./discovery-session-workspace";
import { DiscoveryIdeaSelection } from "./discovery-idea-selection";
import type { DiscoveryIdeaBrief, DiscoverySessionIdea } from "@/lib/api/discovery-sessions";

afterEach(() => vi.restoreAllMocks());

const project = { id: "brand-1", name: "Margin Atlas", notes: "Home and finance questions", createdAt: "2026-10-24T12:00:00Z" };
const session = { id: "session-1", projectId: "brand-1", name: "Insurance costs", platforms: ["youtube", "tiktok"],
  settingsSnapshot: {}, status: "ready", createdAt: 1760000000, updatedAt: 1760000000, archivedAt: null, lastRun: null };
function mockFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => String(input).endsWith("/api/local-research-model/readiness")
    ? Promise.resolve(new Response(JSON.stringify({version:1,search:{state:"ready"}}),{status:200}))
    : handler(input,init));
}

describe("Content discovery sessions", () => {
  it("creates a named saved session with the selected platforms and announces its stable identifier", async () => {
    const selected = vi.fn();
    let stored: typeof session[] = [];
    const writes: unknown[] = [];
    mockFetch(async (input, options) => {
      const url = String(input);
      if (url.endsWith("/sessions") && options?.method === "POST") {
        writes.push(JSON.parse(String(options.body)));
        stored = [session];
        return new Response(JSON.stringify(session), { status: 200 });
      }
      if (url.endsWith("/sessions")) return new Response(JSON.stringify({ sessions: stored }), { status: 200 });
      if (url.endsWith("/sessions/session-1")) return new Response(JSON.stringify(session), { status: 200 });
      if (url.endsWith("/runs")) return new Response(JSON.stringify({ runs: [] }), { status: 200 });
      if (url.endsWith("/ideas")) return new Response(JSON.stringify({ ideas: [] }), { status: 200 });
      throw Error(`Unexpected session request ${url}`);
    });
    const user = userEvent.setup();
    render(<DiscoverySessionWorkspace project={project} platforms={["youtube", "tiktok"]} locale="en"
      selectedSessionId={null} onSelectSession={selected} />);
    await user.click(await screen.findByRole("button", { name: "New discovery session" }));
    await user.type(screen.getByRole("textbox", { name: "Session name" }), "Insurance costs");
    await user.click(screen.getByRole("button", { name: "Create session" }));
    await waitFor(() => expect(selected).toHaveBeenCalledWith("session-1"));
    expect(writes).toEqual([{ name: "Insurance costs", platforms: ["youtube", "tiktok"],
      settingsSnapshot: {version:1,resultBudget:12} }]);
    expect(await screen.findByText("Insurance costs")).toBeInTheDocument();
    expect(screen.queryByText(/session-1/)).not.toBeInTheDocument();
  });

  it("sends the chosen bounded idea budget and this brand's produced topics to the discovery worker", async () => {
    const requests: unknown[] = [];
    mockFetch(async (input, options) => {
      const path = String(input);
      if (path.endsWith("/project-discovery") && options?.method === "POST") {
        requests.push(JSON.parse(String(options.body)));
        return new Response(JSON.stringify({id:"discover_"+"b".repeat(24),projectId:"brand-1",status:"queued",
          stage:"select_topics",createdAt:1760000000,updatedAt:1760000000,errorCode:null,
          providerHealth:{},inputRevision:"revision",candidates:[]}),{status:202});
      }
      if (path.endsWith("/sessions")) return new Response(JSON.stringify({sessions:[{...session,
        settingsSnapshot:{resultBudget:18}}]}), {status:200});
      if (path.endsWith("/sessions/session-1")) return new Response(JSON.stringify({...session,
        settingsSnapshot:{resultBudget:18}}), {status:200});
      if (path.endsWith("/runs")) return new Response(JSON.stringify({runs:[]}),{status:200});
      if (path.endsWith("/ideas")) return new Response(JSON.stringify({ideas:[]}),{status:200});
      throw Error(`Unexpected discovery route ${path}`);
    });
    render(<DiscoverySessionWorkspace project={project} platforms={["youtube"]} locale="en"
      content={[{projectId:"brand-1",name:"Existing roof analysis",stage:"published"},
        {projectId:"another-brand",name:"Unrelated channel video",stage:"draft"}]}
      selectedSessionId="session-1" onSelectSession={()=>{}} />);
    await userEvent.setup().click(await screen.findByRole("button", {name:"Discover opportunities"}));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({sessionId:"session-1",resultBudget:18,
      content:[{name:"Existing roof analysis",stage:"published"}]});
  });

  it("disables discovery until SearXNG is reachable and tells the creator how to retry", async () => {
    let searchReady = false;
    let launches = 0;
    let finishRetry: ((response: Response) => void) | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
      const path = String(input);
      if (path.endsWith("/api/local-research-model/readiness"))
        return searchReady ? new Promise<Response>(resolve=>{finishRetry=resolve;})
          : new Response(JSON.stringify({version:1,search:{state:"unavailable",detail:"Probe diagnostic"}}),{status:200});
      if (path.endsWith("/project-discovery") && options?.method==="POST") {
        launches++;
        return new Response(JSON.stringify({id:"run-1",projectId:"brand-1",status:"queued",
          inputRevision:"revision",stage:"queued",createdAt:1760000000,updatedAt:1760000000,
          errorCode:null,providerHealth:{},candidates:[]}),{status:202});
      }
      if (path.endsWith("/sessions")) return new Response(JSON.stringify({sessions:[session]}),{status:200});
      if (path.endsWith("/sessions/session-1")) return new Response(JSON.stringify(session),{status:200});
      if (path.endsWith("/runs")) return new Response(JSON.stringify({runs:[]}),{status:200});
      if (path.endsWith("/ideas")) return new Response(JSON.stringify({ideas:[]}),{status:200});
      throw Error("Unexpected route "+path);
    });
    render(<DiscoverySessionWorkspace project={project} platforms={["youtube"]} locale="en"
      selectedSessionId="session-1" onSelectSession={()=>{}} />);
    const button=await screen.findByRole("button",{name:"Discover opportunities"});
    await waitFor(()=>expect(button).toBeDisabled());
    expect(screen.getByText(/SearXNG is not responding/i)).toBeInTheDocument();
    expect(screen.getByText(/Probe diagnostic/)).toBeInTheDocument();
    expect(launches).toBe(0);
    searchReady=true;
    await userEvent.setup().click(screen.getByRole("button",{name:"Retry search check"}));
    await waitFor(()=>expect(finishRetry).toBeDefined());
    expect(screen.queryByText(/Probe diagnostic/)).not.toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Retry search check"})).toBeDisabled();
    finishRetry!(new Response(JSON.stringify({version:1,search:{state:"ready"}}),{status:200}));
    await waitFor(()=>expect(button).toBeEnabled());
    await userEvent.setup().click(button);
    expect(launches).toBe(1);
  });

  it("moves to Select Idea only after a newly started run finishes with usable ideas", async () => {
    const candidate={id:"idea-1",rank:1,title:"Insurance",hook:"Why?",premise:"Costs",whyNow:"Now",
      angleKey:"insurance",sourceIds:[],confidence:"low",decision:null};
    const previousRun={id:"run-old",projectId:"brand-1",inputRevision:"old",status:"completed",
      stage:"complete",createdAt:1760000000,updatedAt:1760000000,errorCode:null,providerHealth:{},
      candidates:[candidate]};
    const startedRun={...previousRun,id:"run-new",status:"queued",stage:"queued",candidates:[]};
    let currentRun=previousRun;
    const onIdeasReady=vi.fn();
    mockFetch(async (input,options)=>{
      const path=String(input);
      if(path.endsWith("/project-discovery")&&options?.method==="POST") {
        currentRun=startedRun;
        return new Response(JSON.stringify(startedRun),{status:202});
      }
      if(path.endsWith("/sessions"))return new Response(JSON.stringify({sessions:[session]}),{status:200});
      if(path.endsWith("/sessions/session-1"))return new Response(JSON.stringify({...session,ideaCount:2}),{status:200});
      if(path.endsWith("/runs"))return new Response(JSON.stringify({runs:[currentRun]}),{status:200});
      if(path.endsWith("/ideas"))return new Response(JSON.stringify({ideas:[]}),{status:200});
      throw Error("Unexpected route "+path);
    });
    vi.useFakeTimers({toFake:["setInterval","clearInterval"]});
    try {
      render(<DiscoverySessionWorkspace project={project} platforms={["youtube"]} locale="en"
        selectedSessionId="session-1" onSelectSession={()=>{}} onIdeasReady={onIdeasReady} />);
      expect(await screen.findByText("Latest job: completed")).toBeInTheDocument();
      expect(onIdeasReady).not.toHaveBeenCalled();
      await userEvent.setup().click(screen.getByRole("button",{name:"Discover opportunities"}));
      currentRun={...startedRun,status:"completed",stage:"complete",candidates:[candidate]};
      await act(async()=>{await vi.advanceTimersByTimeAsync(3600);});
      await waitFor(()=>expect(onIdeasReady).toHaveBeenCalledWith("session-1","run-new"));
      await act(async()=>{await vi.advanceTimersByTimeAsync(3600);});
      expect(onIdeasReady).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it("does not auto-select when the new run finds no ideas despite older saved session ideas", async () => {
    const oldCandidate={id:"idea-old",rank:1,title:"Earlier idea",hook:"Why?",premise:"Costs",whyNow:"Now",
      angleKey:"insurance",sourceIds:[],confidence:"low",decision:null};
    const previousRun={id:"run-old",projectId:"brand-1",inputRevision:"old",status:"completed",
      stage:"complete",createdAt:1760000000,updatedAt:1760000000,errorCode:null,providerHealth:{},
      candidates:[oldCandidate]};
    const startedRun={...previousRun,id:"run-new",status:"queued",stage:"queued",candidates:[]};
    let currentRun=previousRun;
    const onIdeasReady=vi.fn();
    mockFetch(async(input,options)=>{
      const path=String(input);
      if(path.endsWith("/project-discovery")&&options?.method==="POST") {
        currentRun=startedRun;
        return new Response(JSON.stringify(startedRun),{status:202});
      }
      if(path.endsWith("/sessions"))return new Response(JSON.stringify({sessions:[session]}),{status:200});
      // ideaCount is intentionally session-wide: the last run may have produced no new ideas.
      if(path.endsWith("/sessions/session-1"))return new Response(JSON.stringify({...session,ideaCount:1}),{status:200});
      if(path.endsWith("/runs"))return new Response(JSON.stringify({runs:[currentRun]}),{status:200});
      if(path.endsWith("/ideas"))return new Response(JSON.stringify({ideas:[]}),{status:200});
      throw Error("Unexpected route "+path);
    });
    vi.useFakeTimers({toFake:["setInterval","clearInterval"]});
    try {
      render(<DiscoverySessionWorkspace project={project} platforms={["youtube"]} locale="en"
        selectedSessionId="session-1" onSelectSession={()=>{}} onIdeasReady={onIdeasReady}/>);
      expect(await screen.findByText("Latest job: completed")).toBeInTheDocument();
      await userEvent.setup().click(screen.getByRole("button",{name:"Discover opportunities"}));
      currentRun={...startedRun,status:"insufficient_evidence",stage:"complete"};
      await act(async()=>{await vi.advanceTimersByTimeAsync(3600);});
      await waitFor(()=>expect(screen.getByText("Latest job: insufficient evidence")).toBeInTheDocument());
      expect(onIdeasReady).not.toHaveBeenCalled();
    } finally {vi.useRealTimers();}
  });

  it("keeps saved sessions available while showing an actionable discovery failure", async () => {
    mockFetch(async (input, options) => {
      const path = String(input);
      if (path.endsWith("/project-discovery") && options?.method === "POST")
        return new Response(JSON.stringify({ error: "Search connector unavailable" }), { status: 503 });
      if (path.endsWith("/sessions")) return new Response(JSON.stringify({ sessions: [session] }), { status: 200 });
      if (path.endsWith("/sessions/session-1")) return new Response(JSON.stringify(session), { status: 200 });
      if (path.endsWith("/runs")) return new Response(JSON.stringify({ runs: [] }), { status: 200 });
      if (path.endsWith("/ideas")) return new Response(JSON.stringify({ ideas: [] }), { status: 200 });
      throw Error(`Unexpected session request ${path}`);
    });
    render(<DiscoverySessionWorkspace project={project} platforms={["youtube", "tiktok"]} locale="en"
      selectedSessionId="session-1" onSelectSession={()=>{}} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Discover opportunities" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Search connector unavailable");
    expect(screen.getByText("Insurance costs")).toBeInTheDocument();
  });

  it("archives a session without deleting it and restores it from saved history", async () => {
    let archived = false;
    mockFetch(async (input, options) => {
      const path = String(input);
      if (path.endsWith("/sessions/session-1") && options?.method === "PATCH") {
        archived = JSON.parse(String(options.body)).archived;
        return new Response(JSON.stringify({ ...session, archivedAt: archived ? 1760000100 : null,
          status: archived ? "archived" : "ready" }), { status: 200 });
      }
      if (path.endsWith("/sessions/session-1")) return new Response(JSON.stringify({ ...session,
        archivedAt: archived ? 1760000100 : null, status: archived ? "archived" : "ready" }), { status: 200 });
      if (path.endsWith("/sessions")) return new Response(JSON.stringify({ sessions: [{ ...session,
        archivedAt: archived ? 1760000100 : null, status: archived ? "archived" : "ready" }] }), { status: 200 });
      if (path.endsWith("/runs")) return new Response(JSON.stringify({ runs: [] }), { status: 200 });
      if (path.endsWith("/ideas")) return new Response(JSON.stringify({ ideas: [] }), { status: 200 });
      throw Error(`Unexpected session route ${path}`);
    });
    const user = userEvent.setup();
    render(<DiscoverySessionWorkspace project={project} platforms={["youtube"]} locale="en"
      selectedSessionId="session-1" onSelectSession={()=>{}} />);
    await user.click(await screen.findByRole("button", { name: "Archive session" }));
    expect(archived).toBe(true);
    expect(await screen.findByRole("button", { name: /Hide archived/ })).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Restore session" }));
    expect(archived).toBe(false);
    expect(await screen.findByText("Insurance costs")).toBeInTheDocument();
  });

  it("cancels only the active session run through the worker without removing saved results", async () => {
    const run = { id: "discover_" + "a".repeat(24), projectId: "brand-1", sessionId: "session-1",
      inputRevision: "revision", status: "running", stage: "refresh_sources", createdAt: 1760000000,
      updatedAt: 1760000000, errorCode: null, providerHealth: {}, candidates: [] };
    let cancelled = false;
    mockFetch(async (input, options) => {
      const path = String(input);
      if (path.endsWith(`/project-discovery/${run.id}/cancel`) && options?.method === "POST") {
        cancelled = true;
        return new Response(JSON.stringify({ ...run, status: "cancelled" }), { status: 200 });
      }
      if (path.endsWith("/sessions")) return new Response(JSON.stringify({ sessions: [session] }), { status: 200 });
      if (path.endsWith("/sessions/session-1")) return new Response(JSON.stringify(session), { status: 200 });
      if (path.endsWith("/runs")) return new Response(JSON.stringify({ runs: [{ ...run, status: cancelled ? "cancelled" : "running" }] }), { status: 200 });
      if (path.endsWith("/ideas")) return new Response(JSON.stringify({ ideas: [] }), { status: 200 });
      throw Error(`Unexpected discovery request ${path}`);
    });
    render(<DiscoverySessionWorkspace project={project} platforms={["youtube"]} locale="en"
      selectedSessionId="session-1" onSelectSession={()=>{}} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Cancel run" }));
    expect(cancelled).toBe(true);
    expect(await screen.findByText("Insurance costs")).toBeInTheDocument();
  });

  it("does not show the prior session's run while a newly selected session is loading", async () => {
    const secondSession = { ...session, id: "session-2", name: "Retirement questions" };
    const firstRun = { id: "discover_" + "a".repeat(24), projectId: "brand-1", sessionId: "session-1",
      inputRevision: "revision", status: "running", stage: "refresh_sources", createdAt: 1760000000,
      updatedAt: 1760000000, errorCode: null, providerHealth: {}, candidates: [] };
    let finishSecondRun: ((response: Response) => void) | undefined;
    mockFetch(async input => {
      const path = String(input);
      if (path.endsWith("/sessions")) return new Response(JSON.stringify({ sessions: [session, secondSession] }), { status: 200 });
      if (path.endsWith("/session-1")) return new Response(JSON.stringify({ ...session, ideaCount: 2 }), { status: 200 });
      if (path.endsWith("/session-2")) return new Response(JSON.stringify({ ...secondSession, ideaCount: 3 }), { status: 200 });
      if (path.endsWith("/session-1/runs")) return new Response(JSON.stringify({ runs: [firstRun] }), { status: 200 });
      if (path.endsWith("/session-2/runs")) return new Promise<Response>(resolve => { finishSecondRun = resolve; });
      throw Error(`Unexpected discovery route ${path}`);
    });
    const onSelectSession = vi.fn();
    const { rerender } = render(<DiscoverySessionWorkspace project={project} platforms={["youtube"]} locale="en"
      selectedSessionId="session-1" onSelectSession={onSelectSession} />);
    expect(await screen.findByText("Latest job: running")).toBeInTheDocument();

    rerender(<DiscoverySessionWorkspace project={project} platforms={["youtube"]} locale="en"
      selectedSessionId="session-2" onSelectSession={onSelectSession} />);
    expect(screen.queryByText("Latest job: running")).not.toBeInTheDocument();
    await waitFor(() => expect(finishSecondRun).toBeDefined());
    finishSecondRun!(new Response(JSON.stringify({ runs: [] }), { status: 200 }));
    await waitFor(() => expect(screen.getByText("Saved ideas").parentElement).toHaveTextContent("3"));
    expect(screen.queryByText("Latest job: running")).not.toBeInTheDocument();
  });
});
describe("Select idea", () => {
  const ideas = Array.from({ length: 7 }, (_, i): DiscoverySessionIdea => ({
    id: `idea-${i + 1}`, sessionId: "session-1", runId: "run-1", rank: i + 1,
    title: i === 0 ? "Why home insurance keeps rising" : `Original housing question ${i + 1}`,
    premise: `How household expenses change in example ${i + 1}`,
    hook: "What is causing this change?", whyNow: "Homeowner questions", angleKey: `angle-${i + 1}`,
    sourceIds: ["source-1"], confidence: "low", decision: null, opportunityScore: null,
    scoreVersion: null, scoreInputs: {}, platformFit: {}, sources: i === 0 ? [{
      id: "source-1", title: "An observed insurance source", url: "https://example.org/insurance",
      provider: "searxng", observedAt: 1760000000, evidenceState: "lead_only",
    }] : [],
  }));
  it("shows all ideas without a five-item cap, unknown scores, and attributable source leads", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async input =>
      new Response(JSON.stringify(String(input).endsWith("/ideas") ? { ideas } : session), { status: 200 }));
    const user = userEvent.setup();
    render(<DiscoveryIdeaSelection projectId="brand-1" sessionId="session-1" locale="en" onStartProduction={()=>{}} />);
    expect(await screen.findByText("Original housing question 7")).toBeInTheDocument();
    expect(screen.getAllByText("Not measured").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("link", { name: /An observed insurance source/ })).toHaveAttribute("href", "https://example.org/insurance");
    await user.type(screen.getByRole("searchbox", { name: "Search ideas" }), "insurance");
    expect(screen.queryByText("Original housing question 7")).not.toBeInTheDocument();
    expect(screen.getByText("Why home insurance keeps rising")).toBeInTheDocument();
  });

  it("highlights three explainable evidence-backed picks while retaining every idea", async () => {
    const scored = ideas.map((idea, index) => index < 4 ? { ...idea,
      opportunityScore: [78, 70, 60, 55][index], scoreVersion: "evidence-readiness-v1",
      scoreInputs: { capturedPassages: 2, sourcePoints: 40, audienceDemand: "unknown" },
    } : idea);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
      if (String(input).endsWith("/decision") && options?.method === "POST")
        return new Response(JSON.stringify({ saved: true }), { status: 200 });
      return new Response(JSON.stringify(String(input).endsWith("/ideas") ? { ideas: scored } : session), { status: 200 });
    });
    render(<DiscoveryIdeaSelection projectId="brand-1" sessionId="session-1" locale="en" onStartProduction={()=>{}} />);
    expect(await screen.findByText("Original housing question 7")).toBeInTheDocument();
    expect(screen.getAllByText("Top 3 recommendation")).toHaveLength(3);
    expect(screen.getByText("78/100")).toBeInTheDocument();
    expect(screen.getAllByText("Not measured")).toHaveLength(3);
    await userEvent.setup().click(screen.getAllByRole("button", { name: "Explain this score" })[0]);
    expect(screen.getByText(/Audience demand: unknown/)).toBeInTheDocument();
    const rejected = screen.getByText("Why home insurance keeps rising").closest("article")!;
    await userEvent.setup().click(within(rejected).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(within(rejected).queryByText("Top 3 recommendation")).not.toBeInTheDocument());
    expect(screen.getAllByText("Top 3 recommendation")).toHaveLength(3);
  });

  it("explains the source-based score in Japanese with an accessible disclosure", async () => {
    const first = { ...ideas[0], opportunityScore: 60, scoreVersion: "evidence-readiness-v1",
      scoreInputs: { capturedPassages: 1, audienceDemand: "unknown" } };
    vi.spyOn(globalThis, "fetch").mockImplementation(async input =>
      new Response(JSON.stringify(String(input).endsWith("/ideas") ? { ideas: [first] } : session), { status: 200 }));
    render(<DiscoveryIdeaSelection projectId="brand-1" sessionId="session-1" locale="ja" onStartProduction={()=>{}} />);
    const details = await screen.findByRole("button", { name: "評価の根拠を確認" });
    expect(details).toHaveAttribute("aria-expanded", "false");
    await userEvent.setup().click(details);
    expect(screen.getByRole("button", { name: "評価の詳細を閉じる" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("視聴者の需要: 不明")).toBeInTheDocument();
  });

  it("lets the creator revise an AI idea and send an approved brief under the original session", async () => {
    const handle = vi.fn<(idea: DiscoverySessionIdea, brief: DiscoveryIdeaBrief) => void>();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
      if (String(input).endsWith("/decision") && options?.method === "POST")
        return new Response(JSON.stringify({ saved: true }), { status: 200 });
      return new Response(JSON.stringify(String(input).endsWith("/ideas") ? { ideas: [ideas[0]] } : session), { status: 200 });
    });
    const user = userEvent.setup();
    render(<DiscoveryIdeaSelection projectId="brand-1" sessionId="session-1" locale="en" onStartProduction={handle} />);
    await user.click(await screen.findByRole("button", { name: "Use this idea" }));
    const editor = screen.getByRole("region", { name: "Prepare production brief" });
    await user.clear(within(editor).getByRole("textbox", { name: "Proposed title" }));
    await user.type(within(editor).getByRole("textbox", { name: "Proposed title" }), "The hidden cost of insurance");
    await user.click(within(editor).getByRole("button", { name: "Start production" }));
    await waitFor(() => expect(handle).toHaveBeenCalledTimes(1));
    expect(handle.mock.calls[0][0].sessionId).toBe("session-1");
    expect(handle.mock.calls[0][1]).toMatchObject({ title: "The hidden cost of insurance" });
  });

  it("starts a new session with fresh filters instead of hiding its ideas with the prior session's filter", async () => {
    const nextIdea = { ...ideas[0], id: "idea-next", sessionId: "session-2", title: "Planning for a new career" };
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const path = String(input);
      if (path.endsWith("/session-1/ideas")) return new Response(JSON.stringify({ ideas: [ideas[0]] }), { status: 200 });
      if (path.endsWith("/session-2/ideas")) return new Response(JSON.stringify({ ideas: [nextIdea] }), { status: 200 });
      if (path.endsWith("/session-1")) return new Response(JSON.stringify(session), { status: 200 });
      if (path.endsWith("/session-2")) return new Response(JSON.stringify({ ...session, id: "session-2" }), { status: 200 });
      throw Error(`Unexpected discovery route ${path}`);
    });
    const onStartProduction = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<DiscoveryIdeaSelection projectId="brand-1" sessionId="session-1" locale="en"
      onStartProduction={onStartProduction} />);
    expect(await screen.findByText("Why home insurance keeps rising")).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "saved");
    await user.type(screen.getByRole("searchbox", { name: "Search ideas" }), "insurance");

    rerender(<DiscoveryIdeaSelection projectId="brand-1" sessionId="session-2" locale="en"
      onStartProduction={onStartProduction} />);
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveValue("all");
    expect(screen.getByRole("searchbox", { name: "Search ideas" })).toHaveValue("");
    expect(await screen.findByText("Planning for a new career")).toBeInTheDocument();
    expect(screen.queryByText("Why home insurance keeps rising")).not.toBeInTheDocument();
  });
});
