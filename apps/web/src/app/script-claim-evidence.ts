import type {DiscoverySourceSummary} from "@/lib/api/discovery-sessions";
import type {ClaimEvidenceSnapshot} from "./claim-evidence";
import {scriptEvidenceFingerprint,type ScriptDraft,type ScriptEvidence} from "./script-review-model";

/** Reuses the claim review contract for captured script citations, without inventing a research plan. */
export async function scriptClaimSnapshot(script:ScriptDraft,evidence:readonly ScriptEvidence[],
  sources:readonly DiscoverySourceSummary[]):Promise<ClaimEvidenceSnapshot> {
  const fingerprint=scriptEvidenceFingerprint(evidence);
  if(script.input.evidenceSnapshotId!==fingerprint)throw Error("The script evidence context changed.");
  const cited=sources.filter(source=>evidence.some(item=>item.sourceId===source.id));
  const captured=await Promise.all(cited.map(async source=>{
    const passages=evidence.filter(item=>item.sourceId===source.id);
    if(passages.some(item=>item.sourceUrl!==source.url))throw Error("Script evidence source URL mismatch.");
    const bytes=new TextEncoder().encode(JSON.stringify(passages));
    const hash=await crypto.subtle.digest("SHA-256",bytes);
    return {id:source.id,title:source.title,sourceUri:source.url,
      retrievedAt:source.observedAt?new Date(source.observedAt*1000).toISOString():"",
      passageLocator:"Captured script source excerpts",
      snapshotSha256:Array.from(new Uint8Array(hash),value=>value.toString(16).padStart(2,"0")).join("")};
  }));
  return {artifactId:`script-evidence:${script.input.productionId}:${fingerprint}`,
    quotes:evidence.map(item=>({claimId:item.claimId,sourceId:item.sourceId,quote:item.quote})),
    dossier:{schemaVersion:1,kind:"research-dossier",id:script.input.productionId,
      topic:{title:script.input.title,viewerQuestion:script.input.viewerQuestion,audience:script.input.audience,locale:script.input.locale},
      evidence:captured,claims:evidence.map(item=>({id:item.claimId,text:item.claimText,
        sourceRefs:[item.sourceId],status:"unverified"})),gaps:[],review:{status:"draft"}}};
}
