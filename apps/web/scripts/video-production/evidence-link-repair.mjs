/** Strict source-reference repair: captured bytes and per-claim verbatim quotes are the authority.
 * This does not fact-check claims or write to immutable research artifacts.
 */
import { createHash } from "node:crypto";

const digest=text=>createHash("sha256").update(text).digest("hex");
const validText=value=>typeof value==="string" && value.length>=10 && value.length<=400;
const safeCopy=value=>structuredClone(value);

function capturesWithVerifiedHashes({captures,dossier}) {
  const evidence=new Map((dossier?.evidence??[]).map(item=>[item.id,item]));
  return (captures??[]).filter(capture=>typeof capture?.id==="string" &&
    typeof capture?.text==="string" &&
    evidence.get(capture.id)?.snapshotSha256===digest(capture.text));
}

function matchingCaptures(document,quote) {
  if(!validText(quote))return [];
  return capturesWithVerifiedHashes(document).filter(capture=>capture.text.includes(quote));
}

/** Verify structural binding, exact quotation, and capture integrity without asserting factual truth. */
export function inspectCapturedLinks(document) {
  const claims=document?.dossier?.claims??[];
  const quotes=document?.quotes??[];
  const verified=capturesWithVerifiedHashes(document);
  const validIds=new Set(verified.map(item=>item.id));
  const issues=[];let linked=0;
  const existingClaims=new Set(claims.map(claim=>claim.id));
  for(const claim of claims){
    const supports=quotes.filter(quote=>quote.claimId===claim.id);
    const links=claim.sourceRefs??[];
    if(!links.length||!supports.length){
      issues.push({claimId:claim.id,reason:!supports.length?"quote_missing":"source_missing"});
      continue;
    }
    if(!links.every(ref=>validIds.has(ref)) ||
      !supports.every(quote=>links.includes(quote.sourceId)&&validIds.has(quote.sourceId)&&
        validText(quote.quote)&&verified.some(capture=>capture.id===quote.sourceId &&
          capture.text.includes(quote.quote)))){
      const all=supports.flatMap(quote=>matchingCaptures(document,quote.quote));
      const distinct=new Set(all.map(item=>item.id));
      issues.push({claimId:claim.id,reason:distinct.size>1?"ambiguous_capture":"source_mismatch"});
      continue;
    }
    linked++;
  }
  for(const shot of document?.plan?.shots??[]){
    for(const id of shot.claimIds??[]){
      if(!existingClaims.has(id)&&!issues.some(item=>item.claimId===id))
        issues.push({claimId:id,reason:"claim_missing"});
    }
  }
  return {issues,linked,needsReview:issues.length};
}

/** Never change wording: only map old IDs to a uniquely validated capture with the same verbatim quote. */
export async function repairCapturedLinks(input,{suggestCandidates,signal}={}) {
  const document=safeCopy(input);
  const initial=inspectCapturedLinks(document);
  const proposals=[];const unresolved=[];const audit=[];
  let autoFixed=0;
  for(const issue of initial.issues){
    if(signal?.aborted)throw signal.reason??Error("Evidence repair cancelled.");
    const claim=document.dossier.claims.find(item=>item.id===issue.claimId);
    const supports=document.quotes.filter(quote=>quote.claimId===issue.claimId);
    if(!claim||!supports.length){
      unresolved.push(issue);continue;
    }
    const mapped=[];
    let failure=null;
    for(const quote of supports){
      const matches=matchingCaptures(document,quote.quote);
      if(matches.length!==1){
        failure=matches.length>1?"ambiguous_capture":"quote_mismatch";
        break;
      }
      mapped.push({quote,sourceId:matches[0].id});
    }
    if(!failure){
      const nextRefs=[...new Set(mapped.map(item=>item.sourceId))];
      const changed=JSON.stringify(claim.sourceRefs)!==JSON.stringify(nextRefs) ||
        mapped.some(item=>item.quote.sourceId!==item.sourceId);
      claim.sourceRefs=nextRefs;
      for(const mapping of mapped)mapping.quote.sourceId=mapping.sourceId;
      if(changed){
        autoFixed++;
        audit.push({claimId:claim.id,reason:"exact_quote_relink",sourceRefs:nextRefs,
          snapshotSha256:nextRefs.map(id=>document.dossier.evidence.find(item=>item.id===id)?.snapshotSha256)});
      }
      continue;
    }
    if(typeof suggestCandidates==="function"){
      try{
        const candidate=await suggestCandidates({claimId:claim.id,claimText:claim.text,
          existingQuote:supports.map(item=>item.quote),
          allowedSourceIds:capturesWithVerifiedHashes(document).map(item=>item.id),signal});
        if(candidate && typeof candidate.sourceId==="string" &&
          supports.some(quote=>matchingCaptures(document,quote.quote).some(item=>item.id===candidate.sourceId))){
          proposals.push({claimId:claim.id,sourceId:candidate.sourceId,reason:"review_candidate"});
        }
      }catch(error){
        if(signal?.aborted)throw error;
        // Model suggestions are best-effort; provider errors do not destroy grounded work.
      }
    }
    unresolved.push({claimId:claim.id,reason:failure});
  }
  return {document,autoFixed,proposals,unresolved,audit};
}
