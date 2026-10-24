/** Local-only Studio bridge for prompt templates and selected-shot variation/editing. */
import { PROMPT_DEFAULTS, readPromptOverrides, savePromptOverrides } from "./video-production/prompt-profiles.mjs";
import { resolveModelForTask, readModelProfiles } from "./video-production/model-profiles.mjs";
import { generateHookVariants } from "./video-production/hook-variants.mjs";
import { editPreproductionShot } from "./video-production/video-revisions.mjs";
import { generateEditorialVariants } from "./video-production/editorial-variants.mjs";
import { createStudioResearchDraft, loadStudioResearchDraft } from "./video-production/studio-research.mjs";
import { compilePreproductionBundle } from "./video-production/preproduction.mjs";
import { reconcileStoryboardPlan } from "./video-production/storyboard-director-sync.mjs";
import { searchStudioSources, loadStudioSearch, listStudioSearches } from "./video-production/studio-search.mjs";
import { generateMarketQueries } from "./video-production/market-query-generator.mjs";
import { generateProjectKeywords } from "./video-production/project-keyword-generator.mjs";
import { researchJobManager } from "./video-production/research-job-queue.mjs";
import { discoveryJobManager } from "./video-production/discovery-job-queue.mjs";

const PREFIX="/api/contentgen-director";
const cap=1_200_000;
let researchDraftRunning=false;
async function configuredLocalFallback(variable){
  const id=process.env[variable];
  if(!id)return null;
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/u.test(id))throw Error("Invalid local fallback profile ID.");
  const profiles=await readModelProfiles();
  const selected=profiles.profiles.find(profile=>profile.id===id);
  if(!selected?.model)throw Error("Configured local fallback model profile is missing or has no model.");
  return {endpoint:selected.endpoint,model:selected.model,generation:profiles.generation};
}
const configuredStoryFallback=()=>configuredLocalFallback("CONTENTGEN_STORY_FALLBACK_PROFILE_ID");
async function storyJobModels(deps){
  const primary=await (deps.model??resolveModelForTask)("story");
  if(!primary?.model)throw Error("Choose an installed local story model in Studio Settings.");
  const secondary=await (deps.fallback??configuredStoryFallback)();
  return {primary,...(secondary?.model&&
    (secondary.model!==primary.model||secondary.endpoint!==primary.endpoint)?
      {secondary:{...secondary,generation:primary.generation??secondary.generation}}:{})};
}
async function discoveryJobModels(deps){
  const primary=await (deps.model??resolveModelForTask)("research");
  if(!primary?.model)throw Error("Choose an installed local research model in Studio Settings.");
  const secondary=await (deps.discoveryFallback??(()=>configuredLocalFallback("CONTENTGEN_DISCOVERY_FALLBACK_PROFILE_ID")))();
  return {primary,...(secondary?.model&&
    (secondary.model!==primary.model||secondary.endpoint!==primary.endpoint)?
      {secondary:{...secondary,generation:primary.generation??secondary.generation}}:{})};
}
function send(res,status,body){
  const data=JSON.stringify(body);
  res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",
    "X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"});
  res.end(data);
}
async function readBody(req){
  const buffers=[];let size=0;
  for await(const chunk of req){size+=chunk.length;
    if(size>cap)throw Error("Studio request exceeds the 1.2 MB planning limit.");
    buffers.push(chunk);}
  return JSON.parse(Buffer.concat(buffers).toString("utf8"));
}
export async function handleDirectorRequest(req,res,deps={}){
  const host=String(req.headers.host??""),origin=req.headers.origin;
  if(!/^(127\.0\.0\.1|localhost):\d+$/u.test(host) ||
    (origin&&origin!=="http://"+host) ||
    req.headers["sec-fetch-site"]==="cross-site"){
    send(res,403,{error:"Local Studio access only."});return;
  }
  if(req.method==="POST"&&(origin!=="http://"+host||
     req.headers["x-contentgen-director"]!=="local-only")){
    send(res,403,{error:"Same-origin, explicit Studio action required."});return;
  }
  const route=(req.url??"/").split("?")[0];
  try{
    if(req.method==="GET"&&route==="/prompts"){
      send(res,200,{defaults:PROMPT_DEFAULTS,settings:await (deps.read??readPromptOverrides)()});
    }else if(req.method==="POST"&&route==="/prompts"){
      send(res,200,{settings:await (deps.save??savePromptOverrides)(await readBody(req)),saved:true});
    }else if(req.method==="POST"&&route==="/variants"){
      const request=await readBody(req);
      const settings=await (deps.model??resolveModelForTask)("hooks");
      if(!settings?.model)throw Error("Choose your installed local model in Studio Settings.");
      const result=await (deps.generate??generateHookVariants)({
        dossier:request.dossier,bundle:request.bundle,shotId:request.shotId
      },{modelSettings:settings});
      send(res,200,result);
    }else if(req.method==="POST"&&route==="/brief-variants"){
      const request=await readBody(req);
      const settings=await (deps.model??resolveModelForTask)("hooks");
      const approaches=await (deps.editorial??generateEditorialVariants)(request,{modelSettings:settings});
      send(res,200,{approaches,editorialStatus:"unverified-draft"});
    }else if(req.method==="POST"&&route==="/market-queries"){
      const request=await readBody(req);
      if(!request || typeof request!=="object" || Array.isArray(request) ||
         Object.keys(request).some(key=>!["niche","description","region","language"].includes(key)))
        throw Error("Only niche, description, region and language are accepted.");
      const settings=await (deps.model??resolveModelForTask)("research");
      if(!settings?.model)throw Error("Choose an installed local research model in Studio Settings.");
      const queries=await (deps.marketQueries??generateMarketQueries)({name:request.niche,description:request.description},
        {modelSettings:settings});
      send(res,200,{queries,source:"local-model-generated"});
    }else if(req.method==="POST"&&route==="/project-keyword-suggestions"){
      const input=await readBody(req);
      const model=await (deps.model??resolveModelForTask)("research");
      const generated=await (deps.projectKeywords??generateProjectKeywords)(input,{modelSettings:model});
      send(res,200,generated);
    }else if(req.method==="POST"&&route==="/project-discovery"){
      const input=await readBody(req);
      const model=await discoveryJobModels(deps);
      const run=await (deps.discovery??discoveryJobManager).create(input,model);
      send(res,202,run);
    }else if(req.method==="GET"&&/^\/project-discovery\/[a-z0-9-]{2,80}\/runs$/iu.test(route)){
      send(res,200,{runs:await (deps.discovery??discoveryJobManager).list(route.split("/")[2])});
    }else if(req.method==="GET"&&/^\/project-discovery\/[a-z0-9-]{2,80}\/runs\/discover_[a-f0-9]{24}$/iu.test(route)){
      const parts=route.split("/");
      send(res,200,await (deps.discovery??discoveryJobManager).get(parts[2],parts[4]));
    }else if(req.method==="POST"&&/^\/project-discovery\/discover_[a-f0-9]{24}\/resume$/iu.test(route)){
      const input=await readBody(req);
      const model=await discoveryJobModels(deps);
      send(res,202,await (deps.discovery??discoveryJobManager).resume(input,route.split("/")[2],model));
    }else if(req.method==="POST"&&/^\/project-discovery\/discover_[a-f0-9]{24}\/cancel$/iu.test(route)){
      const input=await readBody(req);
      if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).some(key=>key!=="projectId")||
        !/^[a-z0-9][a-z0-9-]{1,79}$/iu.test(input.projectId))throw Error("Invalid discovery cancellation target.");
      send(res,200,await (deps.discovery??discoveryJobManager).cancel(input.projectId,route.split("/")[2]));
    }else if(req.method==="GET"&&route==="/research-search"){
      send(res,200,{items:await (deps.listSearch??listStudioSearches)()});
    }else if(req.method==="GET"&&/^\/research-search\/[^/]+$/u.test(route)){
      send(res,200,await (deps.loadSearch??loadStudioSearch)(route.slice("/research-search/".length)));
    }else if(req.method==="POST"&&route==="/research-search"){
      const controller=new AbortController();
      let responded=false;
      req.on?.("aborted",()=>controller.abort());
      res.on?.("close",()=>{if(!responded)controller.abort();});
      const request=await readBody(req);
      const result=await (deps.searchSources??searchStudioSources)(request,{signal:controller.signal});
      responded=true;
      send(res,200,result);
    }else if(req.method==="POST"&&route==="/research-jobs"){
      const request=await readBody(req);
      const result=await (deps.jobs??researchJobManager).create(request,await storyJobModels(deps));
      send(res,202,result);
    }else if(req.method==="GET"&&/^\/research-jobs\/job_[a-f0-9]{24}$/u.test(route)){
      send(res,200,await (deps.jobs??researchJobManager).get(route.slice("/research-jobs/".length)));
    }else if(req.method==="POST"&&/^\/research-jobs\/job_[a-f0-9]{24}\/resume$/u.test(route)){
      await readBody(req);
      const id=route.split("/")[2];
      send(res,202,await (deps.jobs??researchJobManager).resume(id,await storyJobModels(deps)));
    }else if(req.method==="POST"&&/^\/research-jobs\/job_[a-f0-9]{24}\/cancel$/u.test(route)){
      await readBody(req);
      send(res,200,await (deps.jobs??researchJobManager).cancel(route.split("/")[2]));
    }else if(req.method==="POST"&&/^\/research-jobs\/job_[a-f0-9]{24}\/repair$/u.test(route)){
      await readBody(req);
      send(res,202,await (deps.jobs??researchJobManager).retryEvidence(route.split("/")[2]));
    }else if(req.method==="POST"&&/^\/research-jobs\/job_[a-f0-9]{24}\/scenes\/[0-9]+\/retry$/u.test(route)){
      await readBody(req);
      const parts=route.split("/");
      send(res,202,await (deps.jobs??researchJobManager).retryScene(parts[2],parts[4],await storyJobModels(deps)));
    }else if(req.method==="POST"&&route==="/compile-saved-research"){
      const input=await readBody(req);
      if(!input||typeof input!=="object"||Array.isArray(input)||
         Object.keys(input).some(key=>!["artifactId","projectId","storyboard"].includes(key))||
         typeof input.artifactId!=="string"||
         !/^research_[a-z0-9_-]{1,78}-[a-f0-9]{12}$/iu.test(input.artifactId)||
         ((input.projectId===undefined)!==(input.storyboard===undefined))||
         (input.projectId!==undefined&&(
           typeof input.projectId!=="string"||
           !/^[a-z0-9][a-z0-9-]{1,79}$/iu.test(input.projectId)||
           !input.storyboard||typeof input.storyboard!=="object"||
           Array.isArray(input.storyboard))))
        throw Error("Select one saved research artifact and an optional matching project storyboard.");
      const saved=await (deps.loadResearch??loadStudioResearchDraft)(input.artifactId);
      if(saved.artifactId!==input.artifactId||saved.snapshotId!==saved.dossier?.id||
         saved.plan?.researchId!==saved.dossier?.id)
        throw Error("Saved research and preproduction plan must have identical immutable lineage.");
      // Compile and fingerprint on the local server; never regenerate a storyboard or use a model.
      const result=input.storyboard
        ?(deps.syncStoryboard??reconcileStoryboardPlan)({artifactId:input.artifactId,
          projectId:input.projectId,dossier:saved.dossier,plan:saved.plan,storyboard:input.storyboard})
        :{bundle:(deps.compileBundle??compilePreproductionBundle)(saved.dossier,saved.plan),
          synchronization:null};
      if(result.bundle.kind!=="preproduction-bundle"||result.bundle.researchId!==saved.dossier.id)
        throw Error("The saved research compiled into a mismatched bundle.");
      send(res,200,{artifactId:input.artifactId,dossier:saved.dossier,
        bundle:result.bundle,synchronization:result.synchronization});
    }else if(req.method==="POST"&&route==="/research-draft"){
      if(researchDraftRunning){send(res,409,{error:"Research is already running. Wait for the current draft or cancel it."});return;}
      researchDraftRunning=true;
      const controller=new AbortController();
      let responded=false;
      req.on?.("aborted",()=>controller.abort());
      res.on?.("close",()=>{if(!responded)controller.abort();});
      try{
        const request=await readBody(req);
        const readModel=deps.model??resolveModelForTask;
        const settings=await readModel("research");
        if(!settings?.model)throw Error("Choose an installed local model in Studio Settings.");
        const storyModelSettings=await readModel("story");
        if(!storyModelSettings?.model)throw Error("Choose an installed story-planning model in Studio Settings.");
        const result=await (deps.researchDraft??createStudioResearchDraft)(request,settings,{signal:controller.signal,storyModelSettings});
        responded=true;
        send(res,200,result);
      }finally{researchDraftRunning=false;}
    }else if(req.method==="GET"&&/^\/research-draft\/[^/]+$/u.test(route)){
      send(res,200,await (deps.loadResearch??loadStudioResearchDraft)(route.slice("/research-draft/".length)));
    }else if(req.method==="POST"&&route==="/edit"){
      const request=await readBody(req);
      const result=(deps.edit??editPreproductionShot)(request.dossier,request.bundle,
        {shotId:request.shotId,changes:request.changes});
      send(res,200,result);
    }else send(res,404,{error:"Unknown director route."});
  }catch(error){send(res,422,{error:String(error?.message??"Director request failed").slice(0,330)});}
}
export function directorStudioPlugin(){
  return {name:"contentgen-director-workbench",
    configureServer(server){server.middlewares.use(PREFIX,(req,res)=>{void handleDirectorRequest(req,res);});},
    configurePreviewServer(server){server.middlewares.use(PREFIX,(req,res)=>{void handleDirectorRequest(req,res);});}
  };
}

