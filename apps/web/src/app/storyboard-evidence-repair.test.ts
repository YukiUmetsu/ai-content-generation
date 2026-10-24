import { describe, expect, it } from "vitest";
import { HVAC_EXAMPLE } from "@/features/storyboard-planner/model/hvac-example";
import type { ResearchDraftResult } from "./researched-storyboard";
import { repairStoryboardEvidence } from "./storyboard-evidence-repair";

const artifactId = "research_sample-aabbccddeeff";
function fixture() {
  const board = structuredClone(HVAC_EXAMPLE);
  board.assumptions.push("Research artifact: " + artifactId);
  board.claims = [{ id:"claim_02", status:"unverified", note:"A captured source describes ductwork.",
    sourceRefs:[] }];
  board.beats[0].claimRefs = ["claim_02"];
  const draft = {
    artifactId, snapshotId:"research_sample",
    dossier:{ claims:[{id:"claim_02",text:"A captured source describes ductwork.",
      status:"unverified",sourceRefs:["source_01"]}],
      evidence:[{id:"source_01",title:"Source",sourceUri:"https://example.com",
        passageLocator:"captured-text:[0,70)",retrievedAt:"2026-10-24T00:00:00Z",
        snapshotSha256:"a".repeat(64)}] },
    quotes:[{claimId:"claim_02",sourceId:"source_01",
      quote:"A captured source describes ductwork."}],
  } as ResearchDraftResult;
  return {board,draft};
}
describe("saved storyboard source-link repair", () => {
  it("safely relinks an unchanged claim from the same saved research artifact", () => {
    const {board,draft} = fixture();
    const result = repairStoryboardEvidence(board,draft);
    expect(result.fixed).toEqual(["claim_02"]);
    expect(result.board.claims[0].sourceRefs).toEqual(["source_01"]);
    expect(result.board.claims[0].status).toBe("unverified");
    expect(board.claims[0].sourceRefs).toEqual([]);
    expect(repairStoryboardEvidence(result.board,draft).fixed).toEqual([]);
  });
  it("does not alter user-edited claims or existing source choices", () => {
    const {board,draft}=fixture();
    board.claims[0].note="A human changed the evidence wording.";
    expect(repairStoryboardEvidence(board,draft).fixed).toEqual([]);
    board.claims[0].note=draft.dossier.claims[0].text;
    board.claims[0].sourceRefs=["manual_source"];
    expect(repairStoryboardEvidence(board,draft).fixed).toEqual([]);
  });
  it("refuses stale lineage or a quote with no matching captured source", () => {
    const {board,draft}=fixture();
    draft.artifactId="research_other-aabbccddeeff";
    expect(repairStoryboardEvidence(board,draft).fixed).toEqual([]);
    draft.artifactId=artifactId;
    draft.quotes[0].sourceId="source_unknown";
    expect(repairStoryboardEvidence(board,draft).fixed).toEqual([]);
  });
});
