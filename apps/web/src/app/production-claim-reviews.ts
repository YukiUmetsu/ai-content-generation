/** Explicit, reversible editorial review receipts, scoped to an immutable source snapshot.
 * A receipt represents a human action in the local workspace, NOT automated fact verification,
 * a new source citation, or permission to skip independent publishing gates.
 */
import type { ClaimEvidenceIssue } from "./claim-evidence";
import type { ClaimEvidenceSnapshot } from "./claim-evidence";

const PREFIX="contentgen:claim-reviews:v1:";
const PROJECT_ID=/^[a-z0-9][a-z0-9_-]{1,79}$/iu;
export interface ClaimReviewReceipt { fingerprint:string; reviewedAt:string }
export type ClaimReviewReceipts=Record<string,ClaimReviewReceipt>;

function storageKey(projectId:string){
  if(!PROJECT_ID.test(projectId))throw Error("Invalid project ID for local claim review.");
  return PREFIX+projectId;
}

/** Binds an attestation to the claim text, all source IDs, snapshot hashes and research artifact. */
function fingerprintFor(issue:ClaimEvidenceIssue,draft:ClaimEvidenceSnapshot):string {
  if(issue.kind!=="needs_factual_review"||!draft.artifactId||
    issue.sourceRefs.length===0||!draft.dossier?.evidence||!draft.quotes)
    throw Error("Only source-linked claims with a saved research snapshot can be reviewed.");
  const sources=new Map(draft.dossier.evidence.map(source=>[source.id,source]));
  const refs=[...new Set(issue.sourceRefs)].sort();
  const matches=refs.map(id=>{
    const source=sources.get(id);
    const quoted=draft.quotes.some(quote=>quote.claimId===issue.claimId&&quote.sourceId===id&&
      typeof quote.quote==="string"&&quote.quote.trim().length>=10);
    if(!source||!/^[a-f0-9]{64}$/iu.test(source.snapshotSha256)||!quoted)
      throw Error("The cited source has not been captured and linked to this exact claim.");
    return [id,source.snapshotSha256];
  });
  return JSON.stringify([draft.artifactId,issue.claimId,issue.claimText,matches]);
}
export function createClaimReviewReceipt(
  issue:ClaimEvidenceIssue,draft:ClaimEvidenceSnapshot,at=new Date(),
):ClaimReviewReceipt {
  return {fingerprint:fingerprintFor(issue,draft),reviewedAt:at.toISOString()};
}
export function isClaimReviewCurrent(
  issue:ClaimEvidenceIssue,draft:ClaimEvidenceSnapshot|undefined|null,
  receipt:ClaimReviewReceipt|undefined,
):boolean {
  if(!draft||!receipt)return false;
  try{return receipt.fingerprint===fingerprintFor(issue,draft);}
  catch{return false;}
}
export function loadClaimReviews(projectId:string):ClaimReviewReceipts {
  try {
    const raw=localStorage.getItem(storageKey(projectId));
    if(!raw||raw.length>131072)return {};
    const parsed:unknown=JSON.parse(raw);
    if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))return {};
    const safe:ClaimReviewReceipts={};
    for(const [id,value] of Object.entries(parsed).slice(0,120)){
      if(!/^[a-z0-9_-]{1,80}$/iu.test(id)||!value||typeof value!=="object"||Array.isArray(value))continue;
      const item=value as Record<string,unknown>;
      if(typeof item.fingerprint==="string"&&item.fingerprint.length<=4096&&
        typeof item.reviewedAt==="string"&&item.reviewedAt.length<=40&&
        Number.isFinite(Date.parse(item.reviewedAt)))
        safe[id]={fingerprint:item.fingerprint,reviewedAt:item.reviewedAt};
    }
    return safe;
  }catch{return {};}
}
export function saveClaimReviews(projectId:string,receipts:ClaimReviewReceipts):void {
  if(Object.keys(receipts).length>120)throw Error("Too many local claim reviews.");
  const raw=JSON.stringify(receipts);
  if(raw.length>131072)throw Error("Local claim reviews exceed the storage limit.");
  localStorage.setItem(storageKey(projectId),raw);
}
