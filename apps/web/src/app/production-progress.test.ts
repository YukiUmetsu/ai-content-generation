import { describe, expect, it } from "vitest";
import { getProductionStages, PRODUCTION_STAGE_ORDER } from "./production-progress";

describe("production progress", () => {
  it("always displays the full navigable workflow without inventing completion", () => {
    const stages = getProductionStages({});
    expect(stages.map(stage => stage.id)).toEqual(PRODUCTION_STAGE_ORDER);
    expect(stages.map(stage => stage.id)).toEqual([
      "setup", "discover", "select", "script", "produce", "optimize", "export",
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

  it("shows real saved discovery run progress before any idea is selected", () => {
    const input = {sessionId:"session-1",discoveryIdeaCount:0};
    expect(getProductionStages({...input,discoverySessionRun:{status:"queued",stage:"queued"}})[1].status).toBe("running");
    expect(getProductionStages({...input,discoverySessionRun:{status:"running",stage:"collecting"}})[1].status).toBe("running");
    expect(getProductionStages({...input,discoverySessionRun:{status:"completed",stage:"complete"}})[1].status).toBe("needs_review");
    expect(getProductionStages({...input,discoverySessionRun:{status:"failed",stage:"search"}})[1].status).toBe("failed");
    expect(getProductionStages({...input,discoveryIdeaCount:3,
      discoverySessionRun:{status:"completed",stage:"complete"}})[1].status).toBe("complete");
    expect(getProductionStages({...input,discoveryIdeaCount:2,
      discoverySessionRun:{status:"insufficient_evidence",stage:"complete"}})[1].status).toBe("complete");
    expect(getProductionStages({...input,discoveryIdeaCount:0,
      discoverySessionRun:{status:"insufficient_evidence",stage:"complete"}})[1].status).toBe("needs_review");
    expect(getProductionStages({ideaId:"selected-old-idea",sessionId:"session-1",
      discoverySessionRun:{status:"completed",stage:"complete"},discoveryIdeaCount:0})[1].status).toBe("complete");
  });

  it("shows partial research as review, never false completion", () => {
    const stages=getProductionStages({setupReady:true,sessionId:"session-1",
      discoveryJob:{status:"paused",stage:"evidence-repair"}});
    expect(stages[1].status).toBe("needs_review");
    expect(stages[1].primaryAction).toMatch(/Review/);
    expect(stages[1].reason).toMatch(/sources require review/i);
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
    for(const id of ["produce","optimize","export"]){
      expect(stages.find(stage=>stage.id===id)?.status).toBe("stale");
    }
    expect(stages.find(stage=>stage.id==="script")?.status).toBe("complete");
  });

  it("flags partial media as stale instead of hiding work when upstream evidence changes", () => {
    const stages=getProductionStages({scriptStale:true,storyboardReady:true,
      audioReady:true,visualReady:false});
    expect(stages.find(stage=>stage.id==="produce")?.status).toBe("stale");
  });

  it("does not insert a scene-plan review step before a saved draft", () => {
    const stages=getProductionStages({storyboardReady:true,visualReady:true,audioReady:true});
    expect(stages.map(stage=>stage.id)).not.toContain("storyboard");
    expect(stages.find(stage=>stage.id==="produce")?.status).toBe("complete");
  });

  it("invalidates script approval and all saved downstream stages when its source context changes", () => {
    const stages = getProductionStages({scriptReady:false,scriptStale:true,storyboardReady:true,
      storyboardScriptStale:true,visualReady:true,audioReady:true,optimizationReady:true,exportReady:true});
    expect(stages.find(stage => stage.id === "script")?.status).toBe("stale");
    for (const id of ["produce","optimize","export"]) {
      expect(stages.find(stage => stage.id === id)?.status).toBe("stale");
    }
  });
});

