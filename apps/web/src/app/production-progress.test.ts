import { describe, expect, it } from "vitest";
import { getProductionStages } from "./production-progress";

describe("guided production stage progression", () => {
  it("starts at Brief and does not mark unbuilt media ready", () => {
    const stages=getProductionStages({briefReady:false});
    expect(stages.map(item=>item.id)).toEqual([
      "brief","research","storyboard","visuals","audio","export",
    ]);
    expect(stages[0].status).toBe("not_started");
    expect(stages.filter(item=>item.status==="complete")).toHaveLength(0);
  });
  it("resumes a persisted research job without restarting it", () => {
    const stages=getProductionStages({briefReady:true,
      researchJob:{status:"running",stage:"scene:2"}});
    expect(stages[0].status).toBe("complete");
    expect(stages[1].status).toBe("running");
    expect(stages[2].status).toBe("not_started");
  });
  it("keeps sourced claims in human review instead of declaring sources missing", () => {
    const stages=getProductionStages({briefReady:true,
      researchJob:{status:"completed",stage:"completed",artifactId:"research_test-0123456789ab"},
      storyboardReady:true,unreviewedClaims:3,missingEvidenceClaims:0});
    expect(stages[1].status).toBe("complete");
    expect(stages[2].status).toBe("needs_review");
    expect(stages[2].reason).toMatch(/3/);
    expect(stages[3].status).toBe("not_started");
  });
  it("marks downstream artifacts stale when a newer research version appears", () => {
    const stages=getProductionStages({briefReady:true,
      researchJob:{status:"completed",stage:"completed",artifactId:"research_new-0123456789ab"},
      storyboardReady:true,storyboardResearchArtifactId:"research_old-0123456789ab",
      visualReady:true,audioReady:true,exportReady:true});
    expect(stages[2].status).toBe("stale");
    expect(stages[3].status).toBe("stale");
    expect(stages[4].status).toBe("stale");
    expect(stages[5].status).toBe("stale");
  });
});
