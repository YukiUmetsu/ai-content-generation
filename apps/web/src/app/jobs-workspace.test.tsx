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

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("Jobs & QA discovery visibility", () => {
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

  it("combines discovery and pipeline jobs, prioritizes active work, and filters jobs needing attention", async () => {
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
    expect(within(jobsList).getAllByRole("button")[0]).toHaveTextContent("Household energy costs");
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
    const row = within(jobsList).getByRole("button", { name: /Household energy costs/i });
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
