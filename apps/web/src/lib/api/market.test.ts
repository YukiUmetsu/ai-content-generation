import { afterEach, describe, expect, it, vi } from "vitest";
import { createMarketWatchlist } from "./market";

const draft = {
  name: "House Math", query: "", queryMode: "auto" as const, queryPlan: [],
  queryPlanSource: "niche-name fallback" as const, region: "US", language: "en", enabled: false,
};
afterEach(() => vi.unstubAllGlobals());

describe("local YouTube market watchlist errors", () => {
  it("makes legacy Axum plain-text 422 validation errors actionable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      'Failed to deserialize the JSON body into the target type: unknown field "queryMode"',
      { status: 422, headers: { "content-type": "text/plain; charset=utf-8" } },
    )));
    await expect(createMarketWatchlist(draft))
      .rejects.toThrow(/HTTP 422.*unknown field.*Rebuild and restart/s);
  });
  it("preserves structured JSON validation details from the current server", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: { code: "invalid_request_json", message: "Missing watchlist language" },
    }), { status: 422, headers: { "content-type": "application/json" } })));
    await expect(createMarketWatchlist(draft)).rejects.toThrow("Missing watchlist language");
  });
  it("does not leak HTML error pages from an upstream dev proxy", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>upstream details</html>", {
      status: 422, headers: { "content-type": "text/html" },
    })));
    await expect(createMarketWatchlist(draft))
      .rejects.toThrow(/Watchlist request rejected.*Rebuild and restart/);
  });
});
