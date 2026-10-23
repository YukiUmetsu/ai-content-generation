/** Local Studio research-to-plan pipeline. User-triggered only, no cloud model fallback. */
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { researchVideoTopic } from "./research-agent.mjs";
import { generatePreproductionPlan } from "./preproduction-generator.mjs";
import { configuredSearchEndpoint } from "./local-search-config.mjs";
import { validateResearchModelSettings } from "./research-model-settings.mjs";

const DEFAULT_ROOT=fileURLToPath(new URL("../../../../data/studio-research",import.meta.url));
const sha=value=>createHash("sha256").update(value).digest("hex");
const safeText=(value,max)=>typeof value==="string"&&value.trim().length>=3&&value.length<=max&&
  !/[\u0000-\u001f]/u.test(value);

export function validateStudioBrief(candidate){
  if(!candidate||typeof candidate!=="object"||Array.isArray(candidate)||
    Object.keys(candidate).some(x=>!["title","viewerQuestion","audience","locale"].includes(x))||
    !safeText(candidate.title,220)||!safeText(candidate.viewerQuestion,240)||
    !safeText(candidate.audience,160)||!["en-US","ja-JP"].includes(candidate.locale))
    throw Error("Provide a topic, audience, viewer question and valid locale to research.");
  return {title:candidate.title.trim(),viewerQuestion:candidate.viewerQuestion.trim(),
    audience:candidate.audience.trim(),locale:candidate.locale};
}

function checkedQuotes(output){
  const claims=new Map(output.dossier.claims.map(x=>[x.id,x]));
  const captures=new Map(output.captures.map(x=>[x.id,x]));
  if(!Array.isArray(output.claimSupport)||!output.claimSupport.length)
    throw Error("Research returned no claim-specific source quotes.");
  for(const source of output.dossier.evidence){
    const capture=captures.get(source.id);
    if(!capture||sha(capture.text)!==source.snapshotSha256||capture.url!==source.sourceUri)
      throw Error("Source capture does not match its immutable citation hash.");
  }
  const quotes=output.claimSupport.map(support=>{
    const claim=claims.get(support.claimId),capture=captures.get(support.sourceId);
    if(!claim||!capture||!claim.sourceRefs.includes(support.sourceId)||
      typeof support.quote!=="string"||support.quote.length<10||support.quote.length>400||
      !capture.text.includes(support.quote))
      throw Error("Research claim has an unsupported or non-verbatim source quote.");
    return {claimId:support.claimId,sourceId:support.sourceId,quote:support.quote};
  });
  for(const claim of claims.values())
    if(!quotes.some(q=>q.claimId===claim.id))throw Error("Research claim lacks a captured supporting quote.");
  return quotes;
}

async function persistSnapshot(output,plan,quotes,root){
  if(!/^research_[a-z0-9_-]{1,78}$/iu.test(output.dossier.id))throw Error("Invalid research snapshot ID.");
  const document={schemaVersion:1,kind:"studio-research-snapshot",dossier:output.dossier,
    captures:output.captures,plan,quotes,provider:output.provider,model:output.model,warnings:output.warnings};
  const bytes=JSON.stringify(document);
  if(Buffer.byteLength(bytes)>512*1024)throw Error("Research snapshot exceeds 512 KiB limit.");
  await mkdir(root,{recursive:true,mode:0o700});
  // A dossier can produce many legitimate creative revisions; preserve each.
  const path=resolve(root,output.dossier.id+"-"+sha(bytes).slice(0,12)+".json");
  try{await writeFile(path,bytes,{flag:"wx",mode:0o600});}
  catch(error){
    if(error.code!=="EEXIST")throw error;
    const existing=await readFile(path,"utf8");
    if(existing!==bytes)throw Error("Immutable research ID already exists with different content. Rerun with refreshed sources.");
  }
  return path;
}

/** Only called after an explicit local Studio POST; capture is an intentional external read. */
export async function createStudioResearchDraft(candidate,modelSettings,deps={}){
  const brief=validateStudioBrief(candidate);
  const settings=validateResearchModelSettings({...modelSettings,version:1});
  const searchEndpoint=(deps.searchEndpoint??configuredSearchEndpoint());
  if(!searchEndpoint)throw Error("Local SearXNG is not configured. Run pnpm research:up and pnpm research:check.");
  const options={provider:"searxng",searchEndpoint,model:settings.model,
    endpoint:settings.endpoint,allowNetwork:true,maxSources:4};
  const output=await (deps.research??researchVideoTopic)(brief,options,{signal:deps.signal});
  const quotes=checkedQuotes(output);
  const storySettings=deps.storyModelSettings
    ? validateResearchModelSettings({...deps.storyModelSettings,version:1}) : settings;
  const plan=await (deps.generate??generatePreproductionPlan)(output.dossier,
    {...options,model:storySettings.model,endpoint:storySettings.endpoint},{signal:deps.signal});
  const saved=await (deps.persist??persistSnapshot)(output,plan,quotes,deps.root??DEFAULT_ROOT);
  return {dossier:output.dossier,plan,quotes,snapshotId:output.dossier.id,
    artifactId:typeof saved==="string"?basename(saved,".json"):undefined,warnings:output.warnings};
}

/** Restores only bounded, internally generated research artifacts. Never returns raw page text to the browser. */
export async function loadStudioResearchDraft(artifactId,{root=DEFAULT_ROOT}={}){
  if(typeof artifactId!=="string"||!/^research_[a-z0-9_-]{1,78}-[a-f0-9]{12}$/iu.test(artifactId))
    throw Error("Invalid research artifact ID.");
  const path=resolve(root,artifactId+".json");
  if((await stat(path)).size>512*1024)throw Error("Research artifact exceeds the storage limit.");
  const raw=await readFile(path,"utf8");
  if(sha(raw).slice(0,12)!==artifactId.slice(-12))throw Error("Research artifact digest mismatch; local snapshot may be tampered.");
  const saved=JSON.parse(raw);
  if(saved.schemaVersion!==1||saved.kind!=="studio-research-snapshot"||
    !artifactId.startsWith(saved.dossier?.id+"-")||
    !saved.dossier?.id||!saved.plan?.shots?.length||!Array.isArray(saved.captures))
    throw Error("Stored research artifact is invalid.");
  const quotes=checkedQuotes({...saved,claimSupport:saved.quotes});
  return {dossier:saved.dossier,plan:saved.plan,quotes,
    warnings:saved.warnings??[],snapshotId:saved.dossier.id,artifactId};
}
