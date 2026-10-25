import { describe, expect, it } from "vitest";
import { getProductionStages, PRODUCTION_STAGE_ORDER } from "./production-progress";

describe("eight-step production progress", () => {
  it("always displays the full navigable workflow without inventing completion", () => {
    const stages = getProductionStages({});
    expect(stages.map(stage => stage.id)).toEqual(PRODUCTION_STAGE_ORDER);
    expect(stages.map(stage => stage.id)).toEqual([
      "setup", "discover", "select", "script", "storyboard", "produce", "optimize", "export",
    ]);
    expect(stages.every(stage => stage.status === "not_started")).toBe(true);
  });

  it("tracks discovery sessions and a running job independently of a production", () => {
    const stages = getProductionStages({setupReady:true, sessionId:"session-1",
      discoveryJob:{status:"running",stage:"source-collection"}});
    expect(stages[0].status).toBe("complete");
    expect(stages[1].status).toBe("running");
    expect(stages[2].status).toBe("not_started");
    expect(stages[3].status).toBe("not_started");
  });

  it("shows partial research as review, never false completion", () => {
    const stages=getProductionStages({setupReady:true,sessionId:"session-1",
      discoveryJob:{status:"paused",stage:"evidence-repair"}});
    expect(stages[1].status).toBe("needs_review");
    expect(stages[1].primaryAction).toMatch(/Review/);
  });

  it("allows an approved idea to advance directly to Script without a research stage", () => {
    const stages=getProductionStages({setupReady:true,sessionId:"session-1",
      discoveryJob:{status:"completed",stage:"completed",artifactId:"evidence-1"},
      ideaId:"idea-1",scriptReady:true});
    expect(stages[1].status).toBe("complete");
    expect(stages[2].status).toBe("complete");
    expect(stages[3].status).toBe("complete");
    expect(stages[4].status).toBe("not_started");
  });

  it("marks saved downstream work stale after upstream evidence changes", () => {
    const stages=getProductionStages({setupReady:true,sessionId:"session-1",ideaId:"idea-1",
      discoveryArtifactId:"new",scriptReady:true,storyboardReady:true,
      storyboardResearchArtifactId:"old",visualReady:true,optimizationReady:true,exportReady:true});
    for(const id of ["storyboard","produce","optimize","export"]){
      expect(stages.find(stage=>stage.id===id)?.status).toBe("stale");
    }
    expect(stages.find(stage=>stage.id==="script")?.status).toBe("complete");
  });

  it("flags partial media as stale instead of hiding work when upstream evidence changes", () => {
    const stages=getProductionStages({scriptStale:true,storyboardReady:true,
      audioReady:true,visualReady:false});
    expect(stages.find(stage=>stage.id==="produce")?.status).toBe("stale");
  });

  it("keeps storyboard warnings as explicit review even with saved media", () => {
    const stages=getProductionStages({storyboardReady:true,missingEvidenceClaims:2,
      storyboardEditorialWarnings:1,visualReady:true});
    const storyboard=stages.find(stage=>stage.id==="storyboard");
    expect(storyboard?.status).toBe("needs_review");
    expect(storyboard?.reason).toMatch(/2/);
  });

  it("invalidates script approval and all saved downstream stages when its source context changes", () => {
    const stages = getProductionStages({scriptReady:false,scriptStale:true,storyboardReady:true,
      storyboardScriptStale:true,visualReady:true,audioReady:true,optimizationReady:true,exportReady:true});
    expect(stages.find(stage => stage.id === "script")?.status).toBe("stale");
    for (const id of ["storyboard","produce","optimize","export"]) {
      expect(stages.find(stage => stage.id === id)?.status).toBe("stale");
    }
  });
});

