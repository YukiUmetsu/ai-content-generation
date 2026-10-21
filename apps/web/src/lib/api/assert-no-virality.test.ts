import { describe, expect, it } from "vitest";
import { ApiError, assertNoViralityClaims } from "./client";

describe("assertNoViralityClaims", () => {
  it("accepts the explicit no_virality_claim constraint", () => {
    expect(() =>
      assertNoViralityClaims({
        creative_constraints: {
          genuine_variety_required: true,
          no_virality_claim: true,
        },
      }),
    ).not.toThrow();
  });

  it("refuses a virality score anywhere in the payload", () => {
    expect(() =>
      assertNoViralityClaims({ hypothesis: { title: "A", virality_score: 87 } }),
    ).toThrow(ApiError);
  });

  it("refuses nested virality forecasts but still allows the negation", () => {
    expect(() =>
      assertNoViralityClaims({
        no_virality_claim: true,
        hypotheses: [{ viral_forecast: "high" }],
      }),
    ).toThrow(/forbidden virality field/);
  });
});
