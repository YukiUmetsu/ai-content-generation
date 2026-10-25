import { describe, expect, it } from "vitest";
import { formatDiscoveryProviderHealth } from "./discovery-provider-health";

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
});
