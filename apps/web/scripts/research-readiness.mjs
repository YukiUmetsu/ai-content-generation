/**
 * Read-only Studio Research readiness probe. No model inference, Docker startup,
 * remote search request or filesystem mutation happens here.
 */
export async function inspectResearchReadiness({ endpoint, profiles, modelForTask, checkSearch, listModels }) {
  const search = { state: "not_configured" };
  const assignments = {};
  for (const task of ["research", "story"]) {
    try {
      const selected = modelForTask(profiles, task);
      assignments[task] = selected?.model
        ? { state: "checking", endpoint: selected.endpoint, model: selected.model }
        : { state: "not_configured" };
    } catch {
      assignments[task] = { state: "not_configured" };
    }
  }

  const checks = [];
  if (endpoint) {
    checks.push(Promise.resolve().then(() => checkSearch({ endpoint, search: false }))
      .then(result => {
        search.state = result.ok ? "ready" : "unavailable";
        if (!result.ok) search.detail = "The local search service did not respond correctly.";
      })
      .catch(() => {
        search.state = "unavailable";
        search.detail = "The local search service could not be reached.";
      }));
    search.state = "checking";
  }

  const endpoints = new Map();
  for (const task of ["research", "story"]) {
    const assignment = assignments[task];
    if (assignment.state !== "checking") continue;
    if (!endpoints.has(assignment.endpoint)) {
      endpoints.set(assignment.endpoint, Promise.resolve()
        .then(() => listModels(assignment.endpoint))
        .then(models => ({ models }))
        .catch(() => ({ error: true })));
    }
    checks.push(endpoints.get(assignment.endpoint).then(result => {
      if (result.error) {
        // Some otherwise working OpenAI-compatible servers do not expose /models.
        assignment.state = "unverified";
        assignment.detail = "Could not inspect the model list; inference has not been tested.";
      } else if (!result.models.includes(assignment.model)) {
        assignment.state = "model_missing";
      } else {
        assignment.state = "ready";
      }
    }));
  }
  await Promise.all(checks);
  // Endpoints stay server-side: the browser only needs task/model status.
  const publicModel = assignment => ({ state: assignment.state,
    ...(assignment.model ? { model: assignment.model } : {}),
    ...(assignment.detail ? { detail: assignment.detail } : {}) });
  return {
    version: 1,
    search,
    researchModel: publicModel(assignments.research),
    storyModel: publicModel(assignments.story),
    ready: search.state === "ready" && assignments.research.state === "ready" && assignments.story.state === "ready",
  };
}
