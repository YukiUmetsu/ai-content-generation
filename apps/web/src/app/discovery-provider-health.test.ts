import { describe, expect, it } from "vitest";
import { formatDiscoveryProviderHealth, parseDiscoveryProviderHealth } from "./discovery-provider-health";

describe("discovery provider health formatting", () => {
  it("preserves legacy plain-language statuses", () => {
    expect(formatDiscoveryProviderHealth("SearXNG unavailable", "en")).toBe("SearXNG unavailable");
  });

  it("does not expose unexpected structured metadata or embedded credentials", () => {
    expect(formatDiscoveryProviderHealth({ apiKey: "private-token", note: "hidden-message" }, "en"))
      .toBe("Details unavailable");
    expect(formatDiscoveryProviderHealth({ state: "constructor" }, "en"))
      .toBe("Details unavailable");
  });

  it("ignores invalid market counts instead of displaying negative or fractional measurements", () => {
    expect(formatDiscoveryProviderHealth({ state: "partial",
      youtube: { succeeded: -1, unavailable: 0.5, attempts: 2 } }, "en"))
      .toBe("Partial");
  });
  it.each([
    [{ state: "unavailable" }, "Unavailable"],
    [{ state: "skipped" }, "Skipped"],
    [{ state: "queued" }, "Queued"],
    [{ state: "unknown_future_state" }, "Details unavailable"],
    [null, "Unknown"],
    [[], "Unknown"],
    [{ youtube: { succeeded: 1, unavailable: 0, attempts: 1 } }, "YouTube: 1 succeeded, 0 unavailable"],
  ] as const)("handles state and payload %j", (value, expected) => {
    expect(formatDiscoveryProviderHealth(value, "en")).toBe(expected);
  });

  it("normalizes mixed legacy and structured data without retaining unknown metadata", () => {
    const health = parseDiscoveryProviderHealth({
      news: "SearXNG unavailable",
      market: { state: "partial", apiKey: "secret",
        youtube: { succeeded: 2, unavailable: 1, attempts: 3, token: "secret" },
        googleTrends: { succeeded: 1, unavailable: 0, attempts: 0 } },
      invalid: ["unexpected"], ignored: null,
    });
    expect(health).toEqual({
      news: "SearXNG unavailable",
      market: { state: "partial", youtube: { succeeded: 2, unavailable: 1, attempts: 3 } },
    });
    expect(JSON.stringify(health)).not.toContain("secret");
  });

  it("does not render arbitrary structured fields in Japanese", () => {
    expect(formatDiscoveryProviderHealth({ apiKey: "secret" }, "ja")).toBe("詳細を表示できません");
    expect(formatDiscoveryProviderHealth({ state: "partial" }, "ja")).toBe("一部のみ");
  });
});
