/** Local-only Studio bridge for prompt templates and selected-shot variation/editing. */
import { PROMPT_DEFAULTS, readPromptOverrides, savePromptOverrides } from "./video-production/prompt-profiles.mjs";
import { readResearchModelSettings } from "./video-production/research-model-settings.mjs";
import { generateHookVariants } from "./video-production/hook-variants.mjs";
import { editPreproductionShot } from "./video-production/video-revisions.mjs";
import { generateEditorialVariants } from "./video-production/editorial-variants.mjs";
import { createStudioResearchDraft, loadStudioResearchDraft } from "./video-production/studio-research.mjs";

const PREFIX="/api/contentgen-director";
const cap=1_200_000;
let researchDraftRunning=false;
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
      const settings=await (deps.model??readResearchModelSettings)();
      if(!settings?.model)throw Error("Choose your installed local model in Studio Settings.");
      const result=await (deps.generate??generateHookVariants)({
        dossier:request.dossier,bundle:request.bundle,shotId:request.shotId
      },{modelSettings:settings});
      send(res,200,result);
    }else if(req.method==="POST"&&route==="/brief-variants"){
      const request=await readBody(req);
      const settings=await (deps.model??readResearchModelSettings)();
      const approaches=await (deps.editorial??generateEditorialVariants)(request,{modelSettings:settings});
      send(res,200,{approaches,editorialStatus:"unverified-draft"});
    }else if(req.method==="POST"&&route==="/research-draft"){
      if(researchDraftRunning){send(res,409,{error:"Research is already running. Wait for the current draft or cancel it."});return;}
      researchDraftRunning=true;
      const controller=new AbortController();
      let responded=false;
      req.on?.("aborted",()=>controller.abort());
      res.on?.("close",()=>{if(!responded)controller.abort();});
      try{
        const request=await readBody(req);
        const settings=await (deps.model??readResearchModelSettings)();
        if(!settings?.model)throw Error("Choose an installed local model in Studio Settings.");
        const result=await (deps.researchDraft??createStudioResearchDraft)(request,settings,{signal:controller.signal});
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
