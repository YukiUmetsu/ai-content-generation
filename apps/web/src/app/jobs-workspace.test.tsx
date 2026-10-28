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
    const list=await screen.findByRole("list",{name:"Jobs"});
    expect(await within(list).findByText("Create draft video")).toBeInTheDocument();
    expect(within(list).getByText("Prepare scene media")).toBeInTheDocument();
    expect(within(list).getByText("Create thumbnail concept")).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button",{name:/Prepare scene media/i}));
    expect(await screen.findByRole("heading",{name:"Prepare scene media"})).toBeInTheDocument();
    expect(screen.getByText("Scene: beat-opening")).toBeInTheDocument();
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

  it("resizes the jobs list with a keyboard-accessible divider and remembers the width", () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ jobs: [] })));
    const view = render(<JobsWorkspace locale="en" />);
    const divider = screen.getByRole("separator", { name: "Resize job list and details" });
    const workspace = screen.getByRole("region", { name: "Jobs" });
    const splitPane = workspace.querySelector<HTMLElement>('[data-km-split-pane="root"]');
    expect(splitPane).not.toBeNull();
    vi.spyOn(splitPane!, "getBoundingClientRect").mockReturnValue({ left: 0, width: 1000 } as DOMRect);

    expect(divider).toHaveAttribute("aria-valuenow", "46");
    fireEvent.keyDown(divider, { key: "ArrowRight" });
    expect(divider).toHaveAttribute("aria-valuenow", "47");

    fireEvent.pointerDown(divider, { pointerId: 1, button: 0, isPrimary: true, clientX: 470 });
    fireEvent.pointerMove(divider, { pointerId: 1, clientX: 600 });
    fireEvent.pointerUp(divider, { pointerId: 1, clientX: 600 });
    expect(divider).toHaveAttribute("aria-valuenow", "60");
    expect(window.localStorage.getItem("contentgen.jobs.list-width")).toBe("60");

    view.unmount();
    render(<JobsWorkspace locale="en" />);
    expect(screen.getByRole("separator", { name: "Resize job list and details" }))
      .toHaveAttribute("aria-valuenow", "60");
  });

  it("reserves the minimum list and detail widths at a narrow desktop size", () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ jobs: [] })));
    render(<JobsWorkspace locale="en" />);
    const workspace = screen.getByRole("region", { name: "Jobs" });
    vi.spyOn(workspace, "getBoundingClientRect").mockReturnValue({ width: 768 } as DOMRect);
    fireEvent.resize(window);
    const divider = screen.getByRole("separator", { name: "Resize job list and details" });
    const available = 768 - 8;
    expect(Number(divider.getAttribute("aria-valuemin")) * available / 100).toBeGreaterThanOrEqual(279.99);
    expect((100 - Number(divider.getAttribute("aria-valuemax"))) * available / 100).toBeGreaterThanOrEqual(359.99);
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
    fireEvent.click(screen.getByRole("button", { name: /Refresh jobs/i }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Render video" })).toBeInTheDocument());
    expect(within(jobsList).getByRole("button", { name: /Render video/i })).toHaveAttribute("aria-current", "true");
    fireEvent.click(within(jobsList).getByRole("button", { name: /Household energy costs/i }));
    expect(screen.getByRole("heading", { name: "Household energy costs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Back to jobs/i })).toBeInTheDocument();
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
    const back = screen.getByRole("button", { name: /Back to jobs/i });
    await waitFor(() => expect(document.activeElement).toBe(back));
    fireEvent.click(back);
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
    await screen.findByRole("heading", { name: "Household energy costs" });
    expect(screen.getByRole("region", { name: "Run information" })).toHaveTextContent("—");
  });
});
