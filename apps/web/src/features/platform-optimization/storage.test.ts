import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlatformOptimizationManifest } from "./model";
import { loadPlatformOptimization, platformOptimizationKey, savePlatformOptimization } from "./storage";

const input = {
  productionId: "production-123",
  projectId: "project-123",
  title: "What does a house really cost?",
  platforms: ["youtube"],
  scriptSections: [{ id: "one", heading: "A cost breakdown", text: "Property taxes add cost." }],
};

describe("durable platform-optimization drafts", () => {
  const entries = new Map<string, string>();
  beforeEach(() => {
    entries.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => { entries.set(key, value); },
      removeItem: (key: string) => { entries.delete(key); },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("restores a per-production package without changing its revisions or approvals", () => {
    const manifest = createPlatformOptimizationManifest(input);
    savePlatformOptimization(manifest);
    expect(loadPlatformOptimization(input.productionId, input.projectId)).toEqual({ manifest, warning: null });
    expect(platformOptimizationKey(input.productionId)).toContain("production-123");
  });

  it("never loads a saved package into another project", () => {
    savePlatformOptimization(createPlatformOptimizationManifest(input));
    const result = loadPlatformOptimization(input.productionId, "another-project");
    expect(result.manifest).toBeNull();
    expect(result.warning).toMatch(/different project/i);
  });

  it("rejects malformed or oversized saved draft data safely", () => {
    entries.set(platformOptimizationKey(input.productionId), '{"schemaVersion": 200}');
    expect(loadPlatformOptimization(input.productionId, input.projectId).warning).toMatch(/invalid/i);
    entries.set(platformOptimizationKey(input.productionId), "a".repeat(600_000));
    expect(loadPlatformOptimization(input.productionId, input.projectId).warning).toMatch(/limit/i);
  });
});
