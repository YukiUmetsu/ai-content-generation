import { describe, expect, it } from "vitest";
import type { ClaimEvidenceIssue } from "./claim-evidence";
import type { ResearchDraftResult } from "./researched-storyboard";
import {
  createClaimReviewReceipt, isClaimReviewCurrent, loadClaimReviews,
  saveClaimReviews,
} from "./production-claim-reviews";

const issue:ClaimEvidenceIssue={claimId:"claim_02",claimText:"Electrical upgrades may be required.",
  kind:"needs_factual_review",beatIds:["beat_1"],sourceRefs:["source_01"]};
const draft={artifactId:"research_sample-0123456789ab",
  dossier:{evidence:[{id:"source_01",title:"Captured report",sourceUri:"https://example.org/report",
    passageLocator:"captured-text:[0,50)",retrievedAt:"2026-10-24T00:00:00Z",
    snapshotSha256:"a".repeat(64)}]},
  quotes:[{claimId:"claim_02",sourceId:"source_01",
    quote:"Electrical upgrades may be required as part of the work."}],
} as ResearchDraftResult;

describe("local claim-review receipts",()=>{
  it("records explicit review for the exact claim and immutable source snapshot",()=>{
    const receipt=createClaimReviewReceipt(issue,draft,new Date("2026-10-24T12:00:00Z"));
    expect(isClaimReviewCurrent(issue,draft,receipt)).toBe(true);
    expect(receipt.reviewedAt).toBe("2026-10-24T12:00:00.000Z");
    expect(isClaimReviewCurrent({...issue,claimText:"Changed estimate"},draft,receipt)).toBe(false);
    expect(isClaimReviewCurrent({...issue,sourceRefs:["source_02"]},draft,receipt)).toBe(false);
    expect(isClaimReviewCurrent(issue,{...draft,artifactId:"research_new-0123456789ab"},receipt)).toBe(false);
  });
  it("never records missing, unchecked, or mismatched evidence as reviewed",()=>{
    for(const kind of ["source_missing","source_unchecked","source_mismatch"] as const){
      expect(()=>createClaimReviewReceipt({...issue,kind},draft)).toThrow();
    }
  });
  it("persists receipts only for the selected local project",()=>{
    const receipt=createClaimReviewReceipt(issue,draft);
    const project="project-receipt-test";
    const other="project-other-test";
    try{
      saveClaimReviews(project,{[issue.claimId]:receipt});
      expect(loadClaimReviews(project)[issue.claimId]).toEqual(receipt);
      expect(loadClaimReviews(other)[issue.claimId]).toBeUndefined();
    }finally{localStorage.removeItem("contentgen:claim-reviews:v1:"+project);}
  });
});
