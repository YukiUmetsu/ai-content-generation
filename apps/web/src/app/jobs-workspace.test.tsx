import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { JobsWorkspace } from "./jobs-workspace";

const project = { id: "brand-1", name: "Margin Atlas" };
const running = {
  id: "discover_" + "a".repeat(24), projectId: project.id, inputRevision: "revision-1",
  status: "running", stage: "collect_sources", createdAt: 1760000000, updatedAt: 1760000100,
  errorCode: null, providerHealth: {}, candidates: [],
};
const session = {
  id: "session-1", projectId: project.id, name: "Household energy costs",
  platforms: ["youtube"], settingsSnapshot: {}, status: "running",
  createdAt: 1760000000, updatedAt: 1760000100, archivedAt: null,
  ideaCount: 0, lastRun: running,
};
const finishedSession = {
  ...session, id: "session-2", name: "Past research", status: "failed", updatedAt: 1759990000,
  lastRun: { ...running, id: "discover_failed", status: "failed", stage: "score_ideas", errorCode: "provider_unavailable" },
};
const pipelineJob = {
  schemaVersion: 1, id: "job-123", jobKind: "render_video", state: "SUCCEEDED",
  idempotencyKey: "render-123", createdAt: "2026-10-25T08:00:00Z", updatedAt: "2026-10-25T09:00:00Z",
};
const pipelineDetail = {
  job: pipelineJob,
  nodes: [], edges: [], attempts: [],
  progress: { total: 0, pending: 0, ready: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0 },
};

const marketProviderHealth = {
  market: { state: "partial", youtube: { succeeded: 2, unavailable: 1, attempts: 3 },
    googleTrends: { succeeded: 1, unavailable: 2, attempts: 3 } },
};

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); window.localStorage.removeItem("contentgen.jobs.list-width"); });

describe("Jobs & QA discovery visibility", () => {
  it("retries a failed draft from job details and refreshes its status", async () => {
    let state="FAILED";let retries=0;
    const job=()=>({...pipelineJob,jobKind:"video-production",state});
    const node=()=>({schemaVersion:1,id:"timing",jobId:pipelineJob.id,nodeKey:"timeline",nodeKind:"video.timeline",state:state==="FAILED"?"FAILED":"RUNNING",attemptCount:state==="FAILED"?1:2,maxAttempts:3,idempotencyKey:"timing",input:{},errorCode:state==="FAILED"?"timeline_failed":null,createdAt:pipelineJob.createdAt,updatedAt:pipelineJob.updatedAt});
    vi.spyOn(globalThis,"fetch").mockImplementation(async (input,options)=>{
      const path=String(input);
      if(path==="/api/jobs")return new Response(JSON.stringify({jobs:[job()]}));
      if(path==="/api/jobs/job-123")return new Response(JSON.stringify({...pipelineDetail,job:job(),nodes:[node()]}));
      if(path==="/api/contentgen-video/jobs/retry"){
        expect(JSON.parse(String(options?.body))).toEqual({jobId:"job-123"});retries++;state="RUNNING";
        return new Response(JSON.stringify({started:true,jobId:"job-123"}),{status:202});
      }
      throw Error(`Unexpected ${path}`);
    });
    render(<JobsWorkspace locale="en"/>);
    fireEvent.click(await screen.findByRole("button",{name:/Create draft video/i}));
    fireEvent.click(await screen.findByRole("button",{name:"Retry production"}));
    await waitFor(()=>expect(retries).toBe(1));
    expect(await screen.findByText(/Retry started/)).toBeInTheDocument();
    await waitFor(()=>expect(screen.getByRole("region",{name:"Queue and worker status"})).toHaveTextContent("Attempt 2 is recorded as running"));
  });

  it("keeps the job visible and reports an actionable retry failure", async () => {
    const job={...pipelineJob,jobKind:"video-production",state:"FAILED"};
    vi.spyOn(globalThis,"fetch").mockImplementation(async input=>{
      const path=String(input);
      if(path==="/api/jobs")return new Response(JSON.stringify({jobs:[job]}));
      if(path==="/api/jobs/job-123")return new Response(JSON.stringify({...pipelineDetail,job}));
      if(path==="/api/contentgen-video/jobs/retry")return new Response(JSON.stringify({error:"The draft did not pass readiness checks.",findings:[{code:"tool-unavailable",message:"ffmpeg is not currently available."}]}),{status:409});
      throw Error(`Unexpected ${path}`);
    });
    render(<JobsWorkspace locale="en"/>);
    fireEvent.click(await screen.findByRole("button",{name:/Create draft video/i}));
    fireEvent.click(await screen.findByRole("button",{name:"Retry production"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("ffmpeg is not currently available");
    expect(screen.getByRole("heading",{name:"Create draft video"})).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Retry production"})).toBeEnabled();
  });

  it("shows the changed input category returned by retry diagnostics", async () => {
    const job={...pipelineJob,jobKind:"video-production",state:"FAILED"};
    vi.spyOn(globalThis,"fetch").mockImplementation(async input=>{
      const path=String(input);
      if(path==="/api/jobs")return new Response(JSON.stringify({jobs:[job]}));
      if(path==="/api/jobs/job-123")return new Response(JSON.stringify({...pipelineDetail,job}));
      if(path==="/api/contentgen-video/jobs/retry")return new Response(JSON.stringify({error:"Inputs differ from the original job.",changedInputs:["selected scene media or media search settings"]}),{status:409});
      throw Error(`Unexpected ${path}`);
    });
    render(<JobsWorkspace locale="en"/>);
    fireEvent.click(await screen.findByRole("button",{name:/Create draft video/i}));
    fireEvent.click(await screen.findByRole("button",{name:"Retry production"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("selected scene media or media search settings");
  });

  it("opens a list-only job into a graph and shows waiting and running retry states", async () => {
    const base = {schemaVersion:1,jobId:pipelineJob.id,nodeKind:"video.step",idempotencyKey:"node",input:{},createdAt:pipelineJob.createdAt,updatedAt:pipelineJob.updatedAt};
    const job={...pipelineJob,state:"RUNNING"};
    const nodes=[{...base,id:"start",nodeKey:"narration",state:"SUCCEEDED",attemptCount:1,maxAttempts:3,errorCode:null},
      {...base,id:"wait",nodeKey:"timeline",state:"READY",attemptCount:1,maxAttempts:3,errorCode:"timeline_failed"},
      {...base,id:"run",nodeKey:"captions",state:"RUNNING",attemptCount:2,maxAttempts:3,errorCode:null}];
    const edges=["wait","run"].map(toNodeId=>({jobId:job.id,fromNodeId:"start",toNodeId,edgeKind:"dependency",createdAt:job.createdAt}));
    const detail={...pipelineDetail,job,nodes,edges,progress:{total:3,pending:0,ready:1,running:1,succeeded:1,failed:0,cancelled:0}};
    vi.spyOn(globalThis,"fetch").mockImplementation(async input=>new Response(JSON.stringify(String(input)==="/api/jobs"?{jobs:[job]}:detail)));
    render(<JobsWorkspace locale="en"/>);
    const list=await screen.findByRole("list",{name:"Jobs"});
    expect(screen.queryByRole("heading",{name:"Create draft video"})).not.toBeInTheDocument();
    fireEvent.click(await within(list).findByRole("button",{name:/render video/i}));
    const dialog=await screen.findByRole("dialog",{name:"Job details"});
    const graph=await within(dialog).findByRole("region",{name:"Pipeline graph"});
    expect(within(graph).getAllByRole("button")).toHaveLength(3);
    expect(within(graph).getByRole("button",{name:/Create captions/i}).querySelector("[data-running-indicator]")).not.toBeNull();
    expect(graph.querySelectorAll("[data-edge]")).toHaveLength(2);
    fireEvent.click(within(graph).getByRole("button",{name:/Synchronize scene timing/i}));
    expect(document.activeElement).toHaveAttribute("id", "job-node-wait");
    expect(within(dialog).getByText(/No worker has claimed this retry/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Attempt 2 is recorded as running/)).toBeInTheDocument();
  });
  it("updates the retry queue when a worker claims the next attempt", async () => {
    vi.useFakeTimers({toFake:["setInterval","clearInterval"]});
    let claimed=false;
    const job={...pipelineJob,state:"RUNNING"};
    vi.spyOn(globalThis,"fetch").mockImplementation(async input=>{
      if(String(input)==="/api/jobs")return new Response(JSON.stringify({jobs:[job]}));
      const node={schemaVersion:1,id:"timing",jobId:job.id,nodeKey:"timeline",nodeKind:"video.timeline",state:claimed?"RUNNING":"READY",attemptCount:claimed?2:1,maxAttempts:3,idempotencyKey:"timing",input:{},errorCode:claimed?null:"timeline_failed",createdAt:job.createdAt,updatedAt:job.updatedAt};
      return new Response(JSON.stringify({...pipelineDetail,job,nodes:[node],progress:{total:1,pending:0,ready:claimed?0:1,running:claimed?1:0,succeeded:0,failed:0,cancelled:0}}));
    });
    render(<JobsWorkspace locale="en"/>);
    fireEvent.click(await screen.findByRole("button",{name:/Render video/i}));
    expect(await screen.findByText(/No worker has claimed this retry/)).toBeInTheDocument();
    claimed=true;
    await act(async()=>{await vi.advanceTimersByTimeAsync(1100);});
    await waitFor(()=>expect(screen.getByText(/Attempt 2 is recorded as running/)).toBeInTheDocument());
    expect(screen.queryByText(/No worker has claimed this retry/)).not.toBeInTheDocument();
  });
  it("shows one date for same-day times and hides the first successful attempt card", async () => {
    const started=new Date(2026,9,29,11,56,3).toISOString();
    const finished=new Date(2026,9,29,11,57,10).toISOString();
    const base={schemaVersion:1,jobId:pipelineJob.id,nodeKind:"video.step",idempotencyKey:"node",input:{},createdAt:started,updatedAt:finished};
    const nodes=[{...base,id:"voice",nodeKey:"narration",state:"SUCCEEDED",attemptCount:1,maxAttempts:3,errorCode:null},
      {...base,id:"timing",nodeKey:"timeline",state:"FAILED",attemptCount:1,maxAttempts:3,errorCode:"timeline_failed"}];
    const attempt=(nodeId:string,state:string)=>({id:`attempt-${nodeId}`,nodeId,idempotencyKey:nodeId,createdAt:started,attemptNumber:1,state,startedAt:started,finishedAt:finished,errorCode:state==="FAILED"?"timeline_failed":null,errorDetail:state==="FAILED"?"Check the timing.":null});
    const detail={...pipelineDetail,nodes,attempts:[attempt("voice","SUCCEEDED"),attempt("timing","FAILED")]};
    vi.spyOn(globalThis,"fetch").mockImplementation(async input=>new Response(JSON.stringify(String(input)==="/api/jobs"?{jobs:[pipelineJob]}:detail)));
    render(<JobsWorkspace locale="en"/>);
    fireEvent.click(await screen.findByRole("button",{name:/Render video/i}));
    const voice=await screen.findByRole("region",{name:"Generate narration"});
    expect(within(voice).queryByText(/Attempt 1 of 3/)).not.toBeInTheDocument();
    expect(within(voice).getByLabelText(/Started.*Finished/)).toHaveTextContent(/Oct 29, 2026.*11:56.*11:57/);
    const timing=screen.getByRole("region",{name:"Synchronize scene timing"});
    expect(within(timing).getByText(/Attempt 1 of 3/)).toBeInTheDocument();
    const range=within(timing).getByLabelText(/Started.*Finished/);
    expect(range).toHaveTextContent(/Oct 29, 2026.*11:56.*11:57/);
    expect((range.textContent?.match(/2026/g)??[])).toHaveLength(1);
  });

  it("shows both dates for an attempt crossing midnight and preserves failed history", async () => {
    const started=new Date(2026,9,29,23,58).toISOString(),finished=new Date(2026,9,30,0,2).toISOString();
    const node={schemaVersion:1,id:"timing",jobId:pipelineJob.id,nodeKey:"timeline",nodeKind:"video.timeline",state:"SUCCEEDED",attemptCount:2,maxAttempts:3,idempotencyKey:"timing",input:{},errorCode:null,createdAt:started,updatedAt:finished};
    const attempt=(n:number,state:string)=>({id:`a${n}`,nodeId:node.id,idempotencyKey:`a${n}`,createdAt:started,attemptNumber:n,state,startedAt:started,finishedAt:finished,errorCode:state==="FAILED"?"timeline_failed":null,errorDetail:null});
    vi.spyOn(globalThis,"fetch").mockImplementation(async input=>new Response(JSON.stringify(String(input)==="/api/jobs"?{jobs:[pipelineJob]}:{...pipelineDetail,nodes:[node],attempts:[attempt(1,"FAILED"),attempt(2,"SUCCEEDED")]})));
    render(<JobsWorkspace locale="en"/>);fireEvent.click(await screen.findByRole("button",{name:/Render video/i}));
    const step=await screen.findByRole("region",{name:"Synchronize scene timing"});
    expect(within(step).getByText(/Attempt 1 of 3/)).toBeInTheDocument();
    expect(within(step).getByText(/Attempt 2 of 3/)).toBeInTheDocument();
    const ranges=within(step).getAllByLabelText(/Started.*Finished/);
    expect(ranges[0]).toHaveTextContent(/Oct 29, 2026.*Oct 30, 2026/);
  });

  it("opens pipeline details with ordered steps, dependencies and failed attempt details", async () => {
    const base = {schemaVersion: 1, jobId: pipelineJob.id, nodeKind: "video.step", idempotencyKey: "node", input: {}, createdAt: pipelineJob.createdAt, updatedAt: pipelineJob.updatedAt};
    const nodes = [
      {...base, id: "timing", nodeKey: "timeline", state: "READY", attemptCount: 1, maxAttempts: 3, errorCode: "timeline_failed"},
      {...base, id: "voice", nodeKey: "narration", state: "SUCCEEDED", attemptCount: 1, maxAttempts: 3, errorCode: null},
    ];
    const detail = {...pipelineDetail, nodes, edges: [{jobId:pipelineJob.id,createdAt:pipelineJob.createdAt,fromNodeId:"voice",toNodeId:"timing",edgeKind:"dependency"}], attempts: [{id:"attempt-1",nodeId:"timing",idempotencyKey:"attempt-1",createdAt:pipelineJob.createdAt,attemptNumber:1,state:"FAILED",startedAt:pipelineJob.createdAt,finishedAt:pipelineJob.updatedAt,errorCode:"timeline_failed",errorDetail:"Timing failed. Check the narration."}]};
    vi.spyOn(globalThis,"fetch").mockImplementation(async input => new Response(JSON.stringify(String(input)==="/api/jobs" ? {jobs:[pipelineJob]} : detail)));
    render(<JobsWorkspace locale="en"/>);
    fireEvent.click(await screen.findByRole("button",{name:/Render video/i}));
    const dialog=await screen.findByRole("dialog",{name:"Job details"});
    expect(within(dialog).getAllByText("Generate narration").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("Synchronize scene timing").length).toBeGreaterThan(0);
    const timingStep=within(dialog).getByRole("region",{name:"Synchronize scene timing"});
    expect(within(timingStep).getByText("Timing failed. Check the narration.")).toBeInTheDocument();
    expect(within(timingStep).getByText(/Attempt 1 of 3/)).toBeInTheDocument();
    expect(within(timingStep).getByLabelText(/Started.*Finished/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Dependency:/)).toHaveTextContent("Generate narration");
    fireEvent.keyDown(dialog,{key:"Escape"});
    await waitFor(()=>expect(screen.queryByRole("dialog",{name:"Job details"})).not.toBeInTheDocument());
  });
  it("names video production child Jobs by the work they perform and shows the affected scene",async()=>{
    const jobs=["video-production","video-asset-download","video-thumbnail-concept"].map((jobKind,index)=>({
      ...pipelineJob,id:`job-video-${index}`,jobKind,updatedAt:`2026-10-25T09:0${index}:00Z`}));
    vi.spyOn(globalThis,"fetch").mockImplementation(async input=>{
      const path=String(input);
      if(path==="/api/jobs")return new Response(JSON.stringify({jobs}));
      const job=jobs.find(item=>path===`/api/jobs/${item.id}`);
      if(job)return new Response(JSON.stringify({job,nodes:[{
        schemaVersion:1,id:`node-${job.id}`,jobId:job.id,
        idempotencyKey:`node-${job.id}`,createdAt:job.createdAt,updatedAt:job.updatedAt,
        nodeKey:job.jobKind==="video-asset-download"?"asset-download":"thumbnail-concept",
        state:"SUCCEEDED",nodeKind:"video.asset-download",input:{sceneId:"beat-opening"},
        attemptCount:1,maxAttempts:3,errorCode:null}],edges:[],attempts:[],
        progress:{total:1,pending:0,ready:0,running:0,succeeded:1,failed:0,cancelled:0}}));
      throw Error(`Unexpected Jobs request: ${path}`);
    });
    const view=render(<JobsWorkspace locale="en"/>);
    expect(screen.getByRole("region",{name:"Jobs"})).toHaveFocus();
    const list=await screen.findByRole("list",{name:"Jobs"});
    expect(await within(list).findByText("Create draft video")).toBeInTheDocument();
    expect(within(list).getByText("Prepare scene media")).toBeInTheDocument();
    expect(within(list).getByText("Create thumbnail concept")).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button",{name:/Prepare scene media/i}));
    expect(await screen.findByRole("heading",{name:"Prepare scene media"})).toBeInTheDocument();
    expect(screen.getByText("Scene: beat-opening")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name:"Close"}));
    fireEvent.change(screen.getByRole("searchbox",{name:"Search jobs"}),{target:{value:"Prepare scene"}});
    expect(within(list).getAllByRole("button")).toHaveLength(1);
    fireEvent.change(screen.getByRole("searchbox",{name:"Search jobs"}),{target:{value:""}});
    view.rerender(<JobsWorkspace locale="ja"/>);
    expect(within(list).getByText("シーン素材を準備")).toBeInTheDocument();
  });
  it("shows structured YouTube and Google Trends health without crashing the discovery details", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const path = String(input);
      if (path === "/api/jobs") return new Response(JSON.stringify({ jobs: [] }));
      if (path.endsWith("/projects/brand-1/sessions")) return new Response(JSON.stringify({ sessions: [
        { ...session, lastRun: { ...running, providerHealth: marketProviderHealth } },
      ] }));
      throw Error(`Unexpected Jobs request: ${path}`);
    });
    render(<JobsWorkspace locale="en" projects={[project]} />);
    fireEvent.click(await screen.findByRole("button", {name:/Household energy costs/i}));
    const provider = await screen.findByRole("region", { name: "Provider health" });
    expect(provider).toHaveTextContent("Partial");
    expect(provider).toHaveTextContent("YouTube: 2 succeeded, 1 unavailable");
    expect(provider).toHaveTextContent("Google Trends: 1 succeeded, 2 unavailable");
  });
  it("shows a running discovery search when the DAG job queue is empty", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const path = String(input);
      if (path === "/api/jobs") return new Response(JSON.stringify({ jobs: [] }));
      if (path.endsWith("/projects/brand-1/sessions"))
        return new Response(JSON.stringify({ sessions: [session] }));
      throw Error(`Unexpected Jobs request: ${path}`);
    });

    render(<JobsWorkspace locale="en" projects={[project]} />);

    const jobsList = await screen.findByRole("list", { name: "Jobs" });
    await waitFor(() => expect(within(jobsList).getByText("Household energy costs")).toBeInTheDocument());
    expect(within(jobsList).getByText("Margin Atlas")).toBeInTheDocument();
    expect(within(jobsList).getByText("Running")).toBeInTheDocument();
    expect(within(jobsList).getByText(/collect sources/i)).toBeInTheDocument();
    fireEvent.click(within(jobsList).getByRole("button", { name: /Household energy costs/i }));
    expect(screen.getByRole("heading", { name: "Household energy costs" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /collect sources/i })).toBeInTheDocument();
    expect(screen.queryByText("No jobs yet")).not.toBeInTheDocument();
  });

  it("refreshes discovery status while Jobs stays open", async () => {
    let current = session;
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const path = String(input);
      if (path === "/api/jobs") return new Response(JSON.stringify({ jobs: [] }));
      if (path.endsWith("/projects/brand-1/sessions"))
        return new Response(JSON.stringify({ sessions: [current] }));
      throw Error(`Unexpected Jobs request: ${path}`);
    });
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    render(<JobsWorkspace locale="en" projects={[project]} />);
    const jobsList = await screen.findByRole("list", { name: "Jobs" });
    await waitFor(() => expect(within(jobsList).getByText("Running")).toBeInTheDocument());

    current = { ...session, status: "completed", ideaCount: 3,
      lastRun: { ...running, status: "completed", stage: "complete", updatedAt: 1760000200 } };
    await act(async () => { await vi.advanceTimersByTimeAsync(5200); });
    await waitFor(() => expect(within(jobsList).getByText("Completed")).toBeInTheDocument());
    fireEvent.click(within(jobsList).getByRole("button", { name: /Household energy costs/i }));
    expect(screen.getByText(/3 ideas in this session/i)).toBeInTheDocument();
  });

  it("keeps a known running search visible when another project or the DAG queue is unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const path = String(input);
      if (path === "/api/jobs") throw Error("DAG server offline");
      if (path.endsWith("/projects/brand-1/sessions"))
        return new Response(JSON.stringify({ sessions: [session] }));
      if (path.endsWith("/projects/brand-2/sessions"))
        return new Response(JSON.stringify({ error: "Unavailable" }), { status: 503 });
      throw Error(`Unexpected Jobs request: ${path}`);
    });

    render(<JobsWorkspace locale="en" projects={[project, { id: "brand-2", name: "Other" }]} />);
    const jobsList = await screen.findByRole("list", { name: "Jobs" });
    await waitFor(() => expect(within(jobsList).getByText("Household energy costs")).toBeInTheDocument());
    expect(within(jobsList).getByText("Running")).toBeInTheDocument();
    expect(screen.getByRole("alert", { name: /discovery/i })).toHaveTextContent("1 project(s)");
  });

  it("puts recently updated jobs first regardless of status and filters jobs needing attention", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const path = String(input);
      if (path === "/api/jobs") return new Response(JSON.stringify({ jobs: [pipelineJob] }));
      if (path.endsWith("/projects/brand-1/sessions"))
        return new Response(JSON.stringify({ sessions: [finishedSession, session, { ...session, id: "session-unused", lastRun: null }] }));
      if (path === "/api/jobs/job-123") return new Response(JSON.stringify(pipelineDetail));
      throw Error(`Unexpected Jobs request: ${path}`);
    });
    render(<JobsWorkspace locale="en" projects={[project]} />);
    const jobsList = await screen.findByRole("list", { name: "Jobs" });
    await waitFor(() => expect(within(jobsList).getAllByRole("button")).toHaveLength(3));
    expect(within(jobsList).getAllByRole("button")[0]).toHaveTextContent("Render video");
    expect(within(jobsList).getByText("Render video")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Needs attention/i }));
    expect(within(jobsList).getAllByRole("button")).toHaveLength(1);
    expect(within(jobsList).getByText("Past research")).toBeInTheDocument();
    expect(within(jobsList).queryByText("Household energy costs")).not.toBeInTheDocument();
    fireEvent.click(within(jobsList).getByRole("button", { name: /Past research/i }));
    expect(screen.getByText("provider_unavailable")).toBeInTheDocument();
  });

  it("allows switching between discovery and pipeline detail without losing the selected item on refresh", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const path = String(input);
      if (path === "/api/jobs") return new Response(JSON.stringify({ jobs: [pipelineJob] }));
      if (path.endsWith("/projects/brand-1/sessions")) return new Response(JSON.stringify({ sessions: [session] }));
      if (path === "/api/jobs/job-123") return new Response(JSON.stringify(pipelineDetail));
      throw Error(`Unexpected Jobs request: ${path}`);
    });
    render(<JobsWorkspace locale="en" projects={[project]} />);
    const jobsList = await screen.findByRole("list", { name: "Jobs" });
    await waitFor(() => expect(within(jobsList).getAllByRole("button")).toHaveLength(2));
    fireEvent.click(within(jobsList).getByRole("button", { name: /Render video/i }));
    await screen.findByRole("heading", { name: "Render video" });
    expect(screen.getByRole("dialog", {name:"Job details"})).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name:"Close"}));
    fireEvent.click(screen.getByRole("button", { name: /Refresh jobs/i }));
    await waitFor(() => expect(within(jobsList).getByRole("button", { name: /Render video/i })).toHaveAttribute("aria-current", "true"));
    fireEvent.click(within(jobsList).getByRole("button", { name: /Household energy costs/i }));
    expect(screen.getByRole("heading", { name: "Household energy costs" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", {name:"Job details"})).toBeInTheDocument();
  });

  it("ignores a stale jobs response after an explicit refresh returns newer status", async () => {
    let resolveOld: ((response: Response) => void) | undefined;
    let listReads = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const path = String(input);
      if (path === "/api/jobs") {
        listReads += 1;
        if (listReads === 1) return new Promise<Response>(resolve => { resolveOld = resolve; });
        return new Response(JSON.stringify({ jobs: [pipelineJob] }));
      }
      if (path === "/api/jobs/job-123") return new Response(JSON.stringify(pipelineDetail));
      throw Error(`Unexpected Jobs request: ${path}`);
    });
    render(<JobsWorkspace locale="en" />);
    await waitFor(() => expect(listReads).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: /Refresh jobs/i }));
    const jobsList = await screen.findByRole("list", { name: "Jobs" });
    await waitFor(() => expect(within(jobsList).getByText("Succeeded")).toBeInTheDocument());
    resolveOld?.(new Response(JSON.stringify({ jobs: [{ ...pipelineJob, state: "RUNNING" }] })));
    await act(async () => { await Promise.resolve(); });
    expect(within(jobsList).getByText("Succeeded")).toBeInTheDocument();
    expect(within(jobsList).queryByText("Running")).not.toBeInTheDocument();
  });

  it("preserves the last visible search from a temporarily unavailable project", async () => {
    let secondUnavailable = false;
    const anotherProject = { id: "brand-2", name: "Archive Lab" };
    const otherSession = { ...session, projectId: anotherProject.id, id: "session-2", name: "Second running search",
      lastRun: { ...running, id: "run-2", projectId: anotherProject.id } };
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const path = String(input);
      if (path === "/api/jobs") return new Response(JSON.stringify({ jobs: [] }));
      if (path.endsWith("/projects/brand-1/sessions")) return new Response(JSON.stringify({ sessions: [session] }));
      if (path.endsWith("/projects/brand-2/sessions")) return secondUnavailable
        ? new Response(JSON.stringify({ error: "Offline" }), { status: 503 })
        : new Response(JSON.stringify({ sessions: [otherSession] }));
      throw Error(`Unexpected Jobs request: ${path}`);
    });
    render(<JobsWorkspace locale="en" projects={[project, anotherProject]} />);
    const jobsList = await screen.findByRole("list", { name: "Jobs" });
    await waitFor(() => expect(within(jobsList).getByText("Second running search")).toBeInTheDocument());
    secondUnavailable = true;
    fireEvent.click(screen.getByRole("button", { name: /Refresh jobs/i }));
    await screen.findByRole("alert", { name: /discovery/i });
    expect(within(jobsList).getByRole("button", { name: /Second running search/i })).toHaveTextContent("Last known");
    secondUnavailable = false;
    fireEvent.click(screen.getByRole("button", { name: /Refresh jobs/i }));
    await waitFor(() => expect(within(jobsList).getByRole("button", { name: /Second running search/i }))
      .not.toHaveTextContent("Last known"));
  });

  it("moves keyboard focus into a mobile job detail and restores it on Back", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const path = String(input);
      if (path === "/api/jobs") return new Response(JSON.stringify({ jobs: [] }));
      if (path.endsWith("/projects/brand-1/sessions"))
        return new Response(JSON.stringify({ sessions: [session] }));
      throw Error(`Unexpected Jobs request: ${path}`);
    });
    render(<JobsWorkspace locale="en" projects={[project]} />);
    const jobsList = await screen.findByRole("list", { name: "Jobs" });
    const row = await within(jobsList).findByRole("button", { name: /Household energy costs/i });
    row.focus();
    fireEvent.click(row);
    const close = screen.getByRole("button", { name: "Close" });
    expect(screen.getByRole("dialog", {name:"Job details"})).toBeInTheDocument();
    fireEvent.click(close);
    await waitFor(() => expect(document.activeElement).toBe(row));
  });

  it("finds a pipeline by its displayed name and discovers a stage by its spaced label", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const path = String(input);
      if (path === "/api/jobs") return new Response(JSON.stringify({ jobs: [pipelineJob] }));
      if (path.endsWith("/projects/brand-1/sessions")) return new Response(JSON.stringify({ sessions: [session] }));
      if (path === "/api/jobs/job-123") return new Response(JSON.stringify(pipelineDetail));
      throw Error(`Unexpected Jobs request: ${path}`);
    });
    render(<JobsWorkspace locale="en" projects={[project]} />);
    const jobsList = await screen.findByRole("list", { name: "Jobs" });
    await waitFor(() => expect(within(jobsList).getAllByRole("button")).toHaveLength(2));
    fireEvent.change(screen.getByRole("searchbox", { name: /Search jobs/i }), { target: { value: "render video" } });
    expect(within(jobsList).getByText("Render video")).toBeInTheDocument();
    expect(within(jobsList).queryByText("Household energy costs")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: /Search jobs/i }), { target: { value: "collect sources" } });
    expect(within(jobsList).getByText("Household energy costs")).toBeInTheDocument();
    expect(within(jobsList).queryByText("Render video")).not.toBeInTheDocument();
  });

  it("does not imply a cancelled discovery search succeeded", async () => {
    const cancelledSession = { ...session, lastRun: { ...running, status: "cancelled", stage: "collect_sources" } };
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const path = String(input);
      if (path === "/api/jobs") return new Response(JSON.stringify({ jobs: [] }));
      if (path.endsWith("/projects/brand-1/sessions"))
        return new Response(JSON.stringify({ sessions: [cancelledSession] }));
      throw Error(`Unexpected Jobs request: ${path}`);
    });
    render(<JobsWorkspace locale="en" projects={[project]} />);
    fireEvent.click(await screen.findByRole("button", {name:/Household energy costs/i}));
    const stage = await screen.findByRole("region", { name: "Current stage" });
    expect(stage.querySelector(".text-status-success")).toBeNull();
    expect(screen.getAllByText("Cancelled").length).toBeGreaterThan(0);
  });

  it("preserves confirmation and cancellation for a running pipeline job", async () => {
    let state: "RUNNING" | "CANCELLED" = "RUNNING";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
      const path = String(input);
      const view = () => ({ ...pipelineDetail, job: { ...pipelineJob, state } });
      if (path === "/api/jobs") return new Response(JSON.stringify({ jobs: [view().job] }));
      if (path === "/api/jobs/job-123" && options?.method === "GET")
        return new Response(JSON.stringify(view()));
      if (path === "/api/jobs/job-123/cancel" && options?.method === "POST") {
        state = "CANCELLED";
        return new Response(JSON.stringify(view()));
      }
      throw Error(`Unexpected Jobs request: ${path}`);
    });
    render(<JobsWorkspace locale="en" />);
    fireEvent.click(await screen.findByRole("button", {name:/Render video/i}));
    await screen.findByRole("heading", { name: "Render video" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel job" }));
    expect(screen.getByText("Cancel this job and stop its outstanding nodes?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Yes, cancel job" }));
    await waitFor(() => expect(screen.getAllByText("Cancelled").length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: "Yes, cancel job" })).not.toBeInTheDocument();
  });

  it("renders a safe fallback for out-of-range discovery timestamps", async () => {
    const invalidDateSession = { ...session, lastRun: { ...running, createdAt: 1e20, updatedAt: 1e20 } };
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const path = String(input);
      if (path === "/api/jobs") return new Response(JSON.stringify({ jobs: [] }));
      if (path.endsWith("/projects/brand-1/sessions"))
        return new Response(JSON.stringify({ sessions: [invalidDateSession] }));
      throw Error(`Unexpected Jobs request: ${path}`);
    });
    render(<JobsWorkspace locale="en" projects={[project]} />);
    fireEvent.click(await screen.findByRole("button", {name:/Household energy costs/i}));
    await screen.findByRole("heading", { name: "Household energy costs" });
    expect(screen.getByRole("region", { name: "Run information" })).toHaveTextContent("—");
  });
});
