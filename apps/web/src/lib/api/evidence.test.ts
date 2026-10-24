import { afterEach, describe, expect, it, vi } from "vitest";
import { searchEvidence } from "./client";

afterEach(() => vi.unstubAllGlobals());

describe("stored evidence client", () => {
  it("reads a real empty SQLite index without treating it as a network failure", async () => {
    const request = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe("/api/research/search?q=house+costs&limit=20");
      return new Response(JSON.stringify({
        schemaVersion: 1, query: "house costs", tokenizer: "unicode61",
        index: { state: "empty", sourcePassageCount: 0, indexedPassageCount: 0 },
        results: [], contradictions: [],
        degradation: { reason: "index_empty", hint: null },
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", request);
    const result = await searchEvidence("house costs");
    expect(result.index.state).toBe("empty");
    expect(result.results).toEqual([]);
    expect(result.degradation?.reason).toBe("index_empty");
  });
});
