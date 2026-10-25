/** Browser-safe, deterministic classification of claim provenance and editorial review.
 * Captured-source proof is always distinct from approval of the claim's truth.
 */
import type { SemanticStoryboard } from "@/features/storyboard-planner/model/types";
import type { ResearchDraftResult } from "./researched-storyboard";

export type ClaimEvidenceKind =
  | "source_missing"
  | "source_mismatch"
  | "source_unchecked"
  | "needs_factual_review";

export interface ClaimEvidenceIssue {
  claimId: string;
  claimText: string;
  kind: ClaimEvidenceKind;
  beatIds: string[];
  sourceRefs: string[];
}

/** Never display a citation from another project's cached research just because source IDs overlap. */
export function matchesStoryboardResearch(board:SemanticStoryboard,draft:ResearchDraftResult):boolean {
  const explicit=board.assumptions.find(value=>value.startsWith("Research artifact: "));
  if(explicit)return Boolean(draft.artifactId)&&explicit==="Research artifact: "+draft.artifactId;
  return Boolean(draft.snapshotId)&&board.assumptions.some(value=>
    value.startsWith("Immutable research snapshot: "+draft.snapshotId+". "));
}

export function countClaimIssues(issues: readonly ClaimEvidenceIssue[]): Record<ClaimEvidenceKind, number> {
  const counts = { source_missing: 0, source_mismatch: 0, needs_factual_review: 0, source_unchecked: 0 };
  for (const issue of issues) counts[issue.kind]++;
  return counts;
}

export function inspectClaimEvidence(
  board: SemanticStoryboard,
  draft?: ResearchDraftResult,
): ClaimEvidenceIssue[] {
  const byId = new Map(board.claims.map(claim => [claim.id, claim]));
  const sourceById = new Map(draft?.dossier?.evidence?.map(source => [source.id, source] as const) ?? []);
  const quotations = draft?.quotes ?? [];
  const issues = new Map<string, ClaimEvidenceIssue>();

  for (const beat of board.beats) {
    for (const id of new Set(beat.claimRefs)) {
      const existing = issues.get(id);
      if (existing) {
        if (!existing.beatIds.includes(beat.id)) existing.beatIds.push(beat.id);
        continue;
      }
      const claim = byId.get(id);
      const refs = claim?.sourceRefs ?? [];
      let kind: ClaimEvidenceKind;
      if (!claim || refs.length === 0) kind = "source_missing";
      else if (!draft) kind = "source_unchecked";
      else {
        const everySourceHasCapturedQuote = refs.every(ref => {
          const source = sourceById.get(ref);
          return source && /^[a-f0-9]{64}$/iu.test(source.snapshotSha256) &&
            quotations.some(quote => quote.claimId === id && quote.sourceId === ref &&
              typeof quote.quote === "string" && quote.quote.trim().length >= 10);
        });
        kind = everySourceHasCapturedQuote ? "needs_factual_review" : "source_mismatch";
      }
      issues.set(id, { claimId: id, claimText: claim?.note || id, kind,
        beatIds: [beat.id], sourceRefs: [...refs] });
    }
  }

  return [...issues.values()];
}
