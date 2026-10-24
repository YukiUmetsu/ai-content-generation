import test from "node:test";
import assert from "node:assert/strict";
import { inspectResearchReadiness } from "./research-readiness.mjs";

const profiles = { research: { endpoint: "http://127.0.0.1:11434/v1/chat/completions", model: "test-a" },
  story: { endpoint: "http://127.0.0.1:11434/v1/chat/completions", model: "test-b" } };
const defaults = { endpoint: "http://127.0.0.1:20000/search", profiles,
  modelForTask: (value, task) => value[task], checkSearch: async () => ({ ok: true }),
  listModels: async () => ["test-a", "test-b"] };

test("reports configured and reachable local search plus assigned models", async () => {
  let searchCalls = 0, modelCalls = 0;
  const result = await inspectResearchReadiness({ ...defaults,
    checkSearch: async opts => { searchCalls++; assert.equal(opts.search, false); return { ok: true }; },
    listModels: async () => { modelCalls++; return ["test-a", "test-b"]; } });
  assert.equal(result.ready, true);
  assert.equal(result.search.state, "ready");
  assert.equal(result.storyModel.state, "ready");
  assert.equal(searchCalls, 1);
  assert.equal(modelCalls, 1, "shared model endpoint is checked once");
});

test("never sends a search when SearXNG is unconfigured, and distinguishes absent model IDs", async () => {
  const result = await inspectResearchReadiness({ ...defaults, endpoint: null,
    modelForTask: (value, task) => task === "story" ? { ...value[task], model: "" } : value[task],
    checkSearch: () => { throw Error("must not request search"); } });
  assert.equal(result.search.state, "not_configured");
  assert.equal(result.storyModel.state, "not_configured");
  assert.equal(result.ready, false);
});

test("distinguishes unavailable search and unavailable model listing from an absent model", async () => {
  const result = await inspectResearchReadiness({ ...defaults,
    checkSearch: async () => ({ ok: false, reason: "Connection refused" }),
    listModels: async () => { throw Error("models endpoint not supported"); } });
  assert.equal(result.search.state, "unavailable");
  assert.equal(result.researchModel.state, "unverified");
  assert.equal(result.storyModel.state, "unverified");
  assert.equal(result.ready, false);

  const missing = await inspectResearchReadiness({ ...defaults, listModels: async () => ["test-a"] });
  assert.equal(missing.researchModel.state, "ready");
  assert.equal(missing.storyModel.state, "model_missing");
});
