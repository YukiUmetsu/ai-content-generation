import { describe, expect, it } from "vitest";
import { HVAC_EXAMPLE } from "@/features/storyboard-planner/model/hvac-example";
import { cloneStoryboard } from "@/features/storyboard-planner/model/types";
import { inspectClaimEvidence, countClaimIssues } from "./claim-evidence";
import type { ResearchDraftResult } from "./researched-storyboard";

const draft = {
  dossier: {
    evidence: [{ id: "source_01", title: "Captured primary source", sourceUri: "https://example.org", retrievedAt: "2026-10-24T00:00:00Z", passageLocator: "p1", snapshotSha256: "a".repeat(64) }],
  },
  quotes: [
    { claimId: "claim_02", sourceId: "source_01", quote: "This is an exact stored captured passage." },
    { claimId: "claim_04", sourceId: "source_01", quote: "Another distinct exact stored captured passage." },
    { claimId: "claim_08", sourceId: "source_01", quote: "Third unique exact captured passage." },
  ],
} as unknown as ResearchDraftResult;

function populated() {
  const board = cloneStoryboard(HVAC_EXAMPLE);
  board.claims = ["claim_02", "claim_04", "claim_08"].map(id => ({
    id, status: "unverified" as const, note: id + " needs factual review", sourceRefs: ["source_01"],
  }));
  board.beats = board.beats.slice(0, 3).map((beat, index) => ({ ...beat,
    id: "beat_" + index, claimRefs: ["claim_02", "claim_04", "claim_08"] }));
  return board;
}

describe("claim evidence inspection", () => {
  it("deduplicates three claims repeated across three beats", () => {
    const issues = inspectClaimEvidence(populated(), draft);
    expect(issues).toHaveLength(3);
    expect(issues.map(issue => issue.claimId)).toEqual(["claim_02", "claim_04", "claim_08"]);
    expect(issues.every(issue => issue.kind === "needs_factual_review")).toBe(true);
    expect(issues.every(issue => issue.beatIds.length === 3)).toBe(true);
    expect(countClaimIssues(issues)).toEqual({
      source_missing: 0, source_mismatch: 0, needs_factual_review: 3, source_unchecked: 0,
    });
  });

  it("does not call an unverified linked claim missing evidence", () => {
    const issues = inspectClaimEvidence(populated(), draft);
    expect(issues[0].claimText).toBe("claim_02 needs factual review");
    expect(issues[0].sourceRefs).toEqual(["source_01"]);
  });

  it("distinguishes absent, dangling, and not-yet-loaded provenance", () => {
    const value = populated();
    value.claims[0].sourceRefs = [];
    value.claims[1].sourceRefs = ["source_not_captured"];
    const resolved = inspectClaimEvidence(value, draft);
    expect(resolved.map(issue => issue.kind)).toEqual([
      "source_missing", "source_mismatch", "needs_factual_review",
    ]);
    const withoutDraft = inspectClaimEvidence(populated());
    expect(withoutDraft.every(issue => issue.kind === "source_unchecked")).toBe(true);
  });

  it("requires a valid saved quotation for every cited source, not just one", () => {
    const value=populated();
    value.claims[0].sourceRefs=["source_01","source_02"];
    const second={id:"source_02",title:"Another captured source",sourceUri:"https://example.org/2",
      retrievedAt:"2026-10-24T00:00:00Z",passageLocator:"p2",snapshotSha256:"b".repeat(64)};
    const twoSources={...draft,dossier:{...draft.dossier,evidence:[...draft.dossier.evidence,second]}} as ResearchDraftResult;
    expect(inspectClaimEvidence(value,twoSources)[0].kind).toBe("source_mismatch");
    const twoQuotes={...twoSources,quotes:[...twoSources.quotes,
      {claimId:"claim_02",sourceId:"source_02",quote:"A second independently saved excerpt."}]};
    expect(inspectClaimEvidence(value,twoQuotes)[0].kind).toBe("needs_factual_review");
  });

  it("requires a stored per-claim quotation, not merely a source ID", () => {
    const withoutQuote = { ...draft, quotes: draft.quotes.filter(quote => quote.claimId !== "claim_02") };
    expect(inspectClaimEvidence(populated(), withoutQuote)[0].kind).toBe("source_mismatch");
  });
});
