/** A one-click, non-destructive repair for imported storyboard references.
 * Source quotations were validated when the immutable research snapshot was saved.
 * This copies source IDs only: it NEVER marks the factual claim as verified.
 */
import { cloneStoryboard, type SemanticStoryboard } from "@/features/storyboard-planner/model/types";
import type { ResearchDraftResult } from "./researched-storyboard";

export interface StoryboardEvidenceRepair {
  board: SemanticStoryboard;
  fixed: string[];
  skipped: string[];
  reason?: "different_research_snapshot";
}

export function repairStoryboardEvidence(
  current: SemanticStoryboard,
  draft: ResearchDraftResult,
): StoryboardEvidenceRepair {
  const board=cloneStoryboard(current);
  const fixed:string[]=[];
  const skipped:string[]=[];
  const artifactId=draft.artifactId;
  // Never import citations from a different research run or an unbound browser cache.
  const matchesArtifact=Boolean(artifactId)&&board.assumptions.includes("Research artifact: "+artifactId);
  const matchesLegacySnapshot=!board.assumptions.some(text=>text.startsWith("Research artifact: ")) &&
    board.assumptions.some(text=>text.includes("Immutable research snapshot: "+draft.snapshotId+"."));
  if(!matchesArtifact&&!matchesLegacySnapshot)
    return {board,fixed,skipped,reason:"different_research_snapshot"};

  const sourceById=new Map(draft.dossier.evidence.map(source=>[source.id,source]));
  const claimById=new Map(draft.dossier.claims.map(claim=>[claim.id,claim]));
  for(const claim of board.claims){
    // Existing refs, changes to claim wording, or editorial status transitions belong to the author.
    if(claim.sourceRefs.length||claim.status!=="unverified")continue;
    const original=claimById.get(claim.id);
    if(!original||original.status!=="unverified"||original.text!==claim.note){
      skipped.push(claim.id);continue;
    }
    const links=[...new Set(draft.quotes.filter(quote=>
      quote.claimId===claim.id &&
      quote.quote.trim().length>=10 &&
      original.sourceRefs.includes(quote.sourceId) &&
      /^[a-f0-9]{64}$/iu.test(sourceById.get(quote.sourceId)?.snapshotSha256??"")
      ).map(quote=>quote.sourceId))];
    if(!links.length||links.length!==original.sourceRefs.length){
      skipped.push(claim.id);continue;
    }
    claim.sourceRefs=links;
    fixed.push(claim.id);
  }
  return {board,fixed,skipped};
}
