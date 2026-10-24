import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "../../../fixtures/packaging-set.json";
import { ApiError, fetchPackagingHypothesisSet } from "./client";

type MutableFixture = {
  metrics: Array<Record<string, unknown>>;
  hypotheses: Array<Record<string, unknown>>;
};

function cloneFixture(): MutableFixture {
  return JSON.parse(JSON.stringify(fixture)) as MutableFixture;
}

function mockFetch(status: number, body: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
    })),
  );
}

async function parse(payload: unknown) {
  mockFetch(200, JSON.stringify(payload));
  return fetchPackagingHypothesisSet();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchPackagingHypothesisSet", () => {
  it("accepts the checked-in illustrative QA fixture", async () => {
    const set = await parse(fixture);
    expect(set.schemaVersion).toBe(1);
    expect(set.status).toBe("draft");
    expect(set.hypotheses).toHaveLength(3);
    expect(set.metrics.map((metric) => metric.provenance)).toEqual([
      "estimated",
      "unknown",
    ]);
  });

  it("treats HTTP 204 as no locally saved packaging without substituting a fixture", async () => {
    mockFetch(204, "");
    await expect(fetchPackagingHypothesisSet()).resolves.toBeNull();
  });

  it("rejects an unsupported schema version", async () => {
    await expect(
      parse({ ...cloneFixture(), schemaVersion: 2 }),
    ).rejects.toMatchObject({ code: "unexpected_payload" });
  });

  it("rejects a metric key that predicts virality", async () => {
    const payload = cloneFixture();
    payload.metrics[0] = {
      metricKey: "predicted-CTR",
      provenance: "estimated",
      value: { kind: "number", value: 12 },
      method: "Illustrative method.",
    };
    await expect(parse(payload)).rejects.toMatchObject({
      code: "unsupported_virality_claim",
    });
  });

  it("rejects a measured metric without a source version and observation", async () => {
    const payload = cloneFixture();
    payload.metrics[0] = {
      metricKey: "scenario-purchase-price",
      provenance: "measured",
      value: { kind: "number", value: 500000 },
    };
    await expect(parse(payload)).rejects.toMatchObject({
      code: "unexpected_payload",
    });
  });

  it("rejects an unknown metric that carries a concrete value", async () => {
    const payload = cloneFixture();
    payload.metrics[1] = {
      metricKey: "sourced-lending-rate-series",
      provenance: "unknown",
      value: { kind: "number", value: 6 },
    };
    await expect(parse(payload)).rejects.toMatchObject({
      code: "unexpected_payload",
    });
  });

  it("rejects duplicate titles even when casing differs", async () => {
    const payload = cloneFixture();
    payload.hypotheses[1].title = String(payload.hypotheses[0].title).toUpperCase();
    await expect(parse(payload)).rejects.toMatchObject({
      code: "unexpected_payload",
    });
  });

  it("reports a plain-text proxy failure as an HTTP error", async () => {
    mockFetch(502, "<html>bad gateway</html>");
    await expect(fetchPackagingHypothesisSet()).rejects.toMatchObject({
      kind: "http",
      code: "http_502",
      status: 502,
    });
  });

  it("keeps the JSON not_implemented envelope intact", async () => {
    mockFetch(
      501,
      JSON.stringify({
        error: {
          code: "not_implemented",
          message: "feature 'creative.packaging' is registered but not implemented yet",
        },
      }),
    );
    await expect(fetchPackagingHypothesisSet()).rejects.toBeInstanceOf(ApiError);
    await expect(fetchPackagingHypothesisSet()).rejects.toMatchObject({
      kind: "http",
      code: "not_implemented",
      status: 501,
    });
  });
});
