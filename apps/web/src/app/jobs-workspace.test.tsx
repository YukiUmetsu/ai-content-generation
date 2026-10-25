import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
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

    const discovery = await screen.findByRole("region", { name: "Discovery searches" });
    await waitFor(() => expect(within(discovery).getByText("Household energy costs")).toBeInTheDocument());
    expect(within(discovery).getByText("Margin Atlas")).toBeInTheDocument();
    expect(within(discovery).getByText("Running")).toBeInTheDocument();
    expect(within(discovery).getByText(/collect sources/i)).toBeInTheDocument();
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
    const discovery = await screen.findByRole("region", { name: "Discovery searches" });
    await waitFor(() => expect(within(discovery).getByText("Running")).toBeInTheDocument());

    current = { ...session, status: "completed", ideaCount: 3,
      lastRun: { ...running, status: "completed", stage: "complete", updatedAt: 1760000200 } };
    await act(async () => { await vi.advanceTimersByTimeAsync(5200); });
    await waitFor(() => expect(within(discovery).getByText("Completed")).toBeInTheDocument());
    expect(within(discovery).getByText(/3 saved ideas/i)).toBeInTheDocument();
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
    const discovery = await screen.findByRole("region", { name: "Discovery searches" });
    await waitFor(() => expect(within(discovery).getByText("Household energy costs")).toBeInTheDocument());
    expect(within(discovery).getByText("Running")).toBeInTheDocument();
    expect(within(discovery).getByRole("alert")).toHaveTextContent("1 project(s)");
  });
});
