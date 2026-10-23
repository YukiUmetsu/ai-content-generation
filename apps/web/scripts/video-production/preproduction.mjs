/**
 * Research-first cinematic preproduction. No provider calls, animation clock or
 * fact-checking claims. Documents remain editable until a separate approval.
 */
import { createHash } from "node:crypto";
import { validateTeachingSequences, compileTeachingStoryboard } from "./visual-pedagogy.mjs";

const text = (v, max=800) => typeof v === "string" && !!v.trim() && v.length <= max && !/[\u0000-\u001f]/u.test(v);
const id = (v) => typeof v === "string" && /^[a-z][a-z0-9_-]{0,80}$/iu.test(v);
const obj = (v) => v && typeof v === "object" && !Array.isArray(v);
const arr = (v, max) => Array.isArray(v) && v.length <= max;
const enums = {
  pattern: ["investigation","misconception","mechanism","cost-dissection","decision","failure","scale"],
  family: ["question","process","comparison","cost-breakdown","mechanism","evidence","summary"],
  purpose: ["hook","reveal","explain","compare","prove","answer"],
  transition: ["cut","match-cut","shared-element","morph","camera-follow","sound-bridge","dissolve"],
  delivery: ["curious","conversational","measured","surprised","confident","reflective"]
};
const validDate = v => typeof v === "string" && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v;
const validSha = v => typeof v === "string" && /^[a-f0-9]{64}$/iu.test(v);
function report() {
  const findings=[];
  const add=(code,path,message,severity="error") => findings.push({code,path,message,severity});
  const fields=(v,path,keys) => {
    if(!obj(v)){add("invalid-object",path,"Expected an object."); return false;}
    for(const key of Object.keys(v)) if(!keys.includes(key)) add("unknown-field",path+"."+key,"Unexpected field.");
    return true;
  };
  const requireText=(v,path,max=800)=>{if(!text(v,max))add("invalid-text",path,"Nonempty bounded text required.");};
  const requireId=(v,path)=>{if(!id(v))add("invalid-id",path,"Stable identifier required.");};
  const items=(v,path,max,fn)=>{
    if(!arr(v,max)){add("invalid-list",path,"Bounded array required.");return [];}
    v.forEach((x,i)=>fn(x,path+"["+i+"]",i));return v;
  };
  const unique=(v,path)=>{
    const ids=v.filter(obj).map(x=>x.id).filter(id);
    if(new Set(ids).size!==ids.length)add("duplicate-id",path,"IDs must be unique.");
  };
  const refs=(v,path,known)=>items(v,path,40,(x,p)=>{
    requireId(x,p);if(id(x)&&!known.has(x))add("missing-reference",p,"Unknown ID "+x);
  });
  return {findings,add,fields,requireText,requireId,items,unique,refs};
}
export function parseResearchDossier(dossier){
  const v=report();
  if(!v.fields(dossier,"$",["schemaVersion","kind","id","topic","evidence","claims","assets","gaps","review"]))return {ok:false,findings:v.findings};
  if(dossier.schemaVersion!==1||dossier.kind!=="research-dossier")v.add("schema","$","Expected research-dossier/v1.");
  v.requireId(dossier.id,"id");
  if(v.fields(dossier.topic,"topic",["title","viewerQuestion","audience","locale"])){
    for(const key of ["title","viewerQuestion","audience"])v.requireText(dossier.topic[key],"topic."+key,240);
    if(!["en-US","ja-JP"].includes(dossier.topic.locale))v.add("locale","topic.locale","Unsupported locale.");
  }
  const sources=v.items(dossier.evidence,"evidence",40,(s,p)=>{
    if(!v.fields(s,p,["id","title","sourceUri","retrievedAt","passageLocator","snapshotSha256"]))return;
    v.requireId(s.id,p+".id");v.requireText(s.title,p+".title",240);
    try{
      const url=new URL(s.sourceUri);
      if(url.protocol!=="https:"||!url.hostname||url.username||url.password)throw Error();
    }catch{v.add("unsafe-source",p+".sourceUri","A credential-free HTTPS citation is required.");}
    if(!validDate(s.retrievedAt))v.add("source-date",p+".retrievedAt","Use an ISO UTC snapshot timestamp.");
    v.requireText(s.passageLocator,p+".passageLocator",240);
    if(!validSha(s.snapshotSha256))v.add("source-hash",p+".snapshotSha256","Actual captured SHA-256 is required.");
  });
  v.unique(sources,"evidence");
  if(!sources.length)v.add("research-required","evidence","Every new cinematic video requires captured research.");
  const sourceIds=new Set(sources.filter(obj).map(x=>x.id));
  const claims=v.items(dossier.claims,"claims",80,(c,p)=>{
    if(!v.fields(c,p,["id","text","status","sourceRefs"]))return;
    v.requireId(c.id,p+".id");v.requireText(c.text,p+".text",1200);
    if(!["verified","unverified","disputed","illustrative"].includes(c.status))v.add("claim-status",p+".status","Invalid status.");
    const refs=v.refs(c.sourceRefs,p+".sourceRefs",sourceIds);
    if(c.status==="verified"&&!refs.length)v.add("source-required",p+".sourceRefs","A verified claim needs a captured source.");
  });
  v.unique(claims,"claims");
  const assets=v.items(dossier.assets ?? [],"assets",64,(asset,p)=>{
    if(!v.fields(asset,p,["id","kind","ref","licenseStatus"]))return;
    v.requireId(asset.id,p+".id");v.requireText(asset.ref,p+".ref",500);
    if(!["illustration","photo","video","three-model","audio"].includes(asset.kind))v.add("asset-kind",p+".kind","Unsupported asset type.");
    if(!["verified","unverified","test-only"].includes(asset.licenseStatus))v.add("asset-license",p+".licenseStatus","Asset rights need explicit status.");
  });
  v.unique(assets,"assets");
  if(!claims.length)v.add("claims-required","claims","Research requires recorded claims.");
  v.items(dossier.gaps,"gaps",30,(x,p)=>v.requireText(x,p,400));
  if(v.fields(dossier.review,"review",["status","reviewer"])){
    if(!["draft","human-reviewed"].includes(dossier.review.status))v.add("review-status","review.status","Invalid status.");
    if(dossier.review.status==="human-reviewed")v.requireText(dossier.review.reviewer,"review.reviewer",100);
  }
  return {ok:!v.findings.some(x=>x.severity==="error"),findings:v.findings};
}
/** Validate all five director plans against a captured dossier. */
export function parsePreproductionPlan(plan,dossier){
  const research=parseResearchDossier(dossier);
  if(!research.ok)return {ok:false,findings:research.findings.map(x=>({...x,path:"research."+x.path}))};
  const v=report();
  if(!v.fields(plan,"$",["schemaVersion","kind","researchId","styleId","story","explanation","shots","continuity","sound","teachingSequences"]))return {ok:false,findings:v.findings};
  if(plan.schemaVersion!==1||plan.kind!=="preproduction-plan")v.add("schema","$","Expected preproduction-plan/v1.");
  if(plan.researchId!==dossier.id)v.add("dossier-mismatch","researchId","The plan must pin the research dossier.");
  if(plan.styleId!=="cinematic-explainer-v1")v.add("style","styleId","Unknown visual direction.");
  const claimIds=new Set(dossier.claims.map(x=>x.id));
  const assetsById=new Map((dossier.assets ?? []).map(x=>[x.id,x]));
  if(v.fields(plan.story,"story",["pattern","premise","hook","question","answerExplanationId","acts"])){
    if(!enums.pattern.includes(plan.story.pattern))v.add("pattern","story.pattern","Unsupported story structure.");
    v.requireText(plan.story.premise,"story.premise",600);
    v.requireText(plan.story.hook,"story.hook",320);
    v.requireText(plan.story.question,"story.question",320);
    v.requireId(plan.story.answerExplanationId,"story.answerExplanationId");
  }
  const acts=v.items(plan.story?.acts,"story.acts",20,(a,p)=>{
    if(!v.fields(a,p,["id","question","purpose","payoff"]))return;
    v.requireId(a.id,p+".id");v.requireText(a.question,p+".question",300);
    v.requireText(a.purpose,p+".purpose",400);v.requireText(a.payoff,p+".payoff",400);
  }).filter(obj);
  v.unique(acts,"story.acts");
  if(acts.length<2)v.add("story-incomplete","story.acts","A story needs setup and resolution.");
  const actIds=new Set(acts.filter(obj).map(x=>x.id));
  const explanation=v.items(plan.explanation,"explanation",80,(e,p)=>{
    if(!v.fields(e,p,["id","actId","claimIds","before","demonstration","after"]))return;
    v.requireId(e.id,p+".id");if(!actIds.has(e.actId))v.add("missing-act",p+".actId","Unknown act.");
    v.refs(e.claimIds,p+".claimIds",claimIds);
    if(!Array.isArray(e.claimIds)||!e.claimIds.length)v.add("ungrounded-explanation",p+".claimIds","Each learning step needs a researched or explicitly illustrative claim.");
    for(const key of ["before","demonstration","after"])v.requireText(e[key],p+"."+key,700);
  }).filter(obj);
  v.unique(explanation,"explanation");
  if(explanation.length<2)v.add("explanation-incomplete","explanation","At least two learning changes required.");
  const explanationIds=new Set(explanation.filter(obj).map(x=>x.id));
  if(!explanationIds.has(plan.story?.answerExplanationId))v.add("unanswered-question","story.answerExplanationId","Every central question needs a planned answer.");
  for(const act of acts)if(!explanation.some(e=>e.actId===act.id))v.add("act-unexplained","explanation","No explanation for act "+act.id);
  const shots=v.items(plan.shots,"shots",160,(s,p)=>{
    if(!v.fields(s,p,["id","explanationId","family","purpose","subjectIds","visualChange","onScreenText","claimIds","assetRefs"]))return;
    v.requireId(s.id,p+".id");if(!explanationIds.has(s.explanationId))v.add("missing-explanation",p+".explanationId","Unknown learning step.");
    if(!enums.family.includes(s.family))v.add("shot-family",p+".family","Unsupported family.");
    if(!enums.purpose.includes(s.purpose))v.add("shot-purpose",p+".purpose","Motion needs a purpose.");
    const subjectIds=v.items(s.subjectIds,p+".subjectIds",16,(x,at)=>v.requireId(x,at));
    if(!subjectIds.length)v.add("no-subject",p+".subjectIds","Visible subject required.");
    v.requireText(s.visualChange,p+".visualChange",650);v.requireText(s.onScreenText,p+".onScreenText",240);
    v.refs(s.claimIds,p+".claimIds",claimIds);
    const owner=explanation.find(e=>e.id===s.explanationId);
    for(const claimId of (Array.isArray(s.claimIds)?s.claimIds:[]))
      if(owner&&!owner.claimIds?.includes(claimId))
        v.add("claim-leak",p+".claimIds","A shot may only use claims declared by its explanation: "+claimId);
    v.items(s.assetRefs,p+".assetRefs",12,(x,at)=>{
      v.requireId(x,at);
      const asset=assetsById.get(x);
      if(!asset)v.add("missing-asset-reference",at,"Unknown asset; do not invent one.");
      else if(asset.licenseStatus!=="verified"&&asset.licenseStatus!=="test-only")
        v.add("asset-rights-unresolved",at,"Asset rights require review before preproduction can be ready.");
    });
    if(s.family==="mechanism"&&!s.assetRefs?.length)v.add("missing-asset",p+".assetRefs","A mechanism requires an actual approved asset, not an invented object.");
  }).filter(obj);
  v.unique(shots,"shots");
  if(!shots.length)v.add("no-shots","shots","A production needs planned shots.");
  for(const e of explanation){
    const itsShots=shots.filter(s=>s.explanationId===e.id);
    if(!itsShots.length)v.add("unvisualized-explanation","shots","No visual treatment for "+e.id);
    for(const claimId of (Array.isArray(e.claimIds)?e.claimIds:[]))
      if(!itsShots.some(s=>s.claimIds?.includes(claimId)))
        v.add("unvisualized-claim","shots","Learning-step claim has no corresponding visual: "+claimId);
  }
  if(shots.length){
    if(shots[0].family!=="question"||shots[0].purpose!=="hook")
      v.add("hook-not-visible","shots[0]","Open with an on-screen question shot, not a generic title slide.");
    const last=shots.at(-1);
    if(last.explanationId!==plan.story?.answerExplanationId||last.purpose!=="answer")
      v.add("payoff-not-visible","shots","The ending must visually answer the central question.");
  }
  const shotIds=new Set(shots.filter(obj).map(x=>x.id));
  const boundaries=new Set(shots.slice(1).map((s,i)=>shots[i].id+">"+s.id)), seen=new Set();
  v.items(plan.continuity,"continuity",160,(c,p)=>{
    if(!v.fields(c,p,["fromShotId","toShotId","technique","subjectIds","reason"]))return;
    const key=c.fromShotId+">"+c.toShotId;
    if(!boundaries.has(key)||seen.has(key))v.add("bad-transition",p,"One transition per adjacent pair required.");
    seen.add(key);
    if(!enums.transition.includes(c.technique))v.add("transition-technique",p+".technique","Unsupported transition.");
    v.requireText(c.reason,p+".reason",400);
    const from=shots.find(s=>s.id===c.fromShotId),to=shots.find(s=>s.id===c.toShotId);
    v.items(c.subjectIds,p+".subjectIds",16,(x,at)=>{
      v.requireId(x,at);
      if(!from?.subjectIds?.includes(x)||!to?.subjectIds?.includes(x))v.add("lost-subject",at,"Continuity subject missing from either shot.");
    });
  });
  for(const pair of boundaries)if(!seen.has(pair))v.add("missing-transition","continuity","Missing boundary "+pair);
  const sounded=new Set();
  v.items(plan.sound,"sound",160,(s,p)=>{
    if(!v.fields(s,p,["shotId","narration","delivery","energy","pauseAfterMs","sfxIntent"]))return;
    if(!shotIds.has(s.shotId))v.add("missing-shot",p+".shotId","Unknown shot.");
    if(sounded.has(s.shotId))v.add("duplicate-audio",p+".shotId","Only one base performance plan per shot.");
    sounded.add(s.shotId);
    v.requireText(s.narration,p+".narration",2000);
    if(!enums.delivery.includes(s.delivery))v.add("delivery",p+".delivery","Unsupported direction.");
    if(!["calm","focused","energetic"].includes(s.energy))v.add("energy",p+".energy","Unsupported energy.");
    if(!Number.isSafeInteger(s.pauseAfterMs)||s.pauseAfterMs<0||s.pauseAfterMs>3000)v.add("pause",p+".pauseAfterMs","Pause must be 0–3000ms.");
    if(s.sfxIntent!==null&&s.sfxIntent!==undefined)v.requireText(s.sfxIntent,p+".sfxIntent",250);
  });
  for(const shot of shots)if(!sounded.has(shot.id))v.add("silent-shot","sound","Missing narration for "+shot.id);
  const normalizedCopy=x=>typeof x==="string"?x.trim().toLowerCase():"";
  for(let i=2;i<shots.length;i++){
    const current=normalizedCopy(shots[i].onScreenText);
    if(current && current===normalizedCopy(shots[i-1].onScreenText) &&
      current===normalizedCopy(shots[i-2].onScreenText))
      v.add("repeated-copy","shots["+i+"]","Three consecutive shots display identical copy; review new information.","warning");
  }
  const performance=Array.isArray(plan.sound)?plan.sound.filter(obj):[];
  for(let i=3;i<performance.length;i++){
    const four=performance.slice(i-3,i+1);
    if(four.every(x=>x.delivery===four[0].delivery&&x.energy===four[0].energy))
      v.add("monotone-performance","sound["+i+"]","Four consecutive shots have identical vocal direction; audition for natural variety.","warning");
  }
  for(let i=2;i<shots.length;i++)if(shots[i].family===shots[i-1].family&&shots[i].family===shots[i-2].family)
    v.add("family-repetition","shots["+i+"]","Three consecutive shots reuse one family; review whether meaning actually changes.","warning");
  // Additive, opt-in v1 teaching sequences. Existing human-authored plans remain valid.
  v.findings.push(...validateTeachingSequences(plan,dossier).findings);
  return {ok:!v.findings.some(x=>x.severity==="error"),findings:v.findings};
}
/** Readiness is editorial only, never commercial/publishing approval. */
export function inspectPreproduction(dossier,plan){
  const parsed=parsePreproductionPlan(plan,dossier);
  const findings=[...parsed.findings];
  if(!parsed.ok)return {ready:false,findings};
  if(dossier.review.status!=="human-reviewed")findings.push({severity:"error",code:"research-unreviewed",path:"research.review",message:"An editor must review the dossier."});
  const used=new Set(plan.explanation.flatMap(e=>e.claimIds));
  for(const claimId of used){
    const claim=dossier.claims.find(c=>c.id===claimId);
    if(!["verified","illustrative"].includes(claim?.status))findings.push({severity:"error",code:"claim-unreviewed",path:"research.claims",message:"Used claim needs verification: "+claimId});
  }
  for(const shot of plan.shots)for(const assetId of shot.assetRefs){
    if(dossier.assets?.find(a=>a.id===assetId)?.licenseStatus==="test-only")
      findings.push({severity:"error",code:"test-asset-not-approved",path:"research.assets",message:"A test-only asset is not production ready: "+assetId});
  }
  if(dossier.gaps.length)findings.push({severity:"warning",code:"research-gaps",path:"research.gaps",message:"Open research gaps require editorial assessment."});
  return {ready:!findings.some(x=>x.severity==="error"),findings};
}
export function compilePreproductionBundle(dossier,plan){
  const parsed=parsePreproductionPlan(plan,dossier);
  if(!parsed.ok)throw Error("Preproduction contract rejected: "+parsed.findings.filter(f=>f.severity==="error").map(f=>f.code).join(", "));
  const digest=o=>createHash("sha256").update(JSON.stringify(o)).digest("hex");
  const assessment=inspectPreproduction(dossier,plan);
  return {schemaVersion:1,kind:"preproduction-bundle",styleId:plan.styleId,
    researchId:dossier.id,researchSha256:digest(dossier),planSha256:digest(plan),plan,assessment,
    teachingStoryboard:compileTeachingStoryboard(plan,dossier),
    status:assessment.ready?"ready-for-animatic-review":"draft-needs-review",
    caveat:"No provider call, source fact-checking, rights clearance, render, approval, or publication was performed."};
}
