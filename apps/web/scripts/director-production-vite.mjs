/** Local, single-flight production for the React Studio; no service credentials persisted. */
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createReadStream, readFileSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compilePreproductionRenderJob } from "./video-production/preproduction-render-bridge.mjs";
import { resolveAndBindApprovedSfx } from "./video-production/sfx-render-bindings.mjs";
import { compileLiveVisualPreview } from "./video-production/live-visual-preview.mjs";
import { compileAnimatic } from "./video-production/animatic.mjs";
import { renderAnimaticHtml } from "./video-production/animatic-player.mjs";
import { inspectProduction } from "./video-production/cli.mjs";
import { produceVideo } from "./video-production/produce.mjs";
import { findChromium } from "./video-production/try.mjs";
import { localSpeechEndpoint } from "./video-production/local.mjs";
import { researchVideoTopic } from "./video-production/research-agent.mjs";
import { generatePreproductionPlan } from "./video-production/preproduction-generator.mjs";
import { compilePreproductionBundle } from "./video-production/preproduction.mjs";
import { resolveModelForTask } from "./video-production/model-profiles.mjs";
import { configuredSearchEndpoint } from "./video-production/local-search-config.mjs";

const run=promisify(execFile),root=fileURLToPath(new URL("../",import.meta.url));
const sha=o=>createHash("sha256").update(JSON.stringify(o)).digest("hex");
const headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
const respond=(res,status,payload)=>{
  res.writeHead(status,{...headers,"Content-Type":"application/json; charset=utf-8"});
  res.end(JSON.stringify(payload));
};
function validateSettings(x){
  if(!x||typeof x!=="object"||Array.isArray(x)||!["fish","local"].includes(x.provider)||
    typeof x.voiceId!=="string"||!x.voiceId.trim()||x.voiceId.length>180||
    typeof x.providerRevision!=="string"||!x.providerRevision.trim()||x.providerRevision.length>120)
    throw Error("Choose a voice provider, authorized voice ID and pinned engine revision.");
  if(x.provider==="local"){
    if(x.localVoiceAuthorized!==true||typeof x.modelId!=="string"||!x.modelId.trim()||
      x.modelId.length>180)throw Error("Choose your installed local TTS model and authorize this voice.");
    localSpeechEndpoint(x.endpoint);
  }else if(x.voiceConsent!==true||x.transmitText!==true||
      typeof x.apiKey!=="string"||!x.apiKey.trim())
    throw Error("Fish requires an API key plus explicit voice and text-transmission consent.");
  return {...x,voiceId:x.voiceId.trim(),providerRevision:x.providerRevision.trim()};
}
export function configureRenderJob(job,settings){
  const cfg=validateSettings(settings),result=structuredClone(job);
  result.voice=cfg.provider==="local"?{
    profileId:result.voice.profileId,provider:"local",modelId:cfg.modelId.trim(),
    voiceId:cfg.voiceId,locale:result.locale,licenseStatus:"unknown",endpoint:cfg.endpoint
  }:{
    profileId:result.voice.profileId,provider:"fish",modelId:"s2.1-pro-free",
    voiceId:cfg.voiceId,locale:result.locale,licenseStatus:"unknown"
  };
  result.approval="test-only";
  result.policy={commercialRightsVerified:false,reviewerApproved:false,maxCostUsd:0};
  return result;
}
function authorize(req,res){
  const host=String(req.headers.host??""),origin=req.headers.origin;
  if(!/^(127\.0\.0\.1|localhost):\d+$/u.test(host)||
    (origin&&origin!=="http://"+host)||req.headers["sec-fetch-site"]==="cross-site"||
    req.method==="POST"&&(origin!=="http://"+host||req.headers["x-contentgen-director"]!=="local-only")){
    respond(res,403,{error:"Available only to the same-origin local Studio."});return false;
  }
  return true;
}
async function readBody(req){
  const parts=[];let size=0;
  for await(const part of req){
    size+=part.length;
    if(size>1_200_000)throw Error("Production request exceeds the 1.2 MB limit.");
    parts.push(part);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}
async function deliverVideo(req,res,releaseDir){
  const path=join(releaseDir,"video.mp4"),info=await stat(path);
  if(!info.isFile()||info.size===0)throw Error("Video output is missing.");
  let start=0,end=info.size-1,code=200;
  if(req.headers.range){
    const match=/^bytes=(\d+)-(\d*)$/u.exec(req.headers.range);
    if(!match){respond(res,416,{error:"Unsupported video byte range."});return;}
    start=Number(match[1]);end=match[2]?Number(match[2]):end;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||end>=info.size){
      respond(res,416,{error:"Video byte range outside file."});return;
    }
    code=206;
  }
  res.writeHead(code,{...headers,"Content-Type":"video/mp4","Accept-Ranges":"bytes",
    "Content-Length":end-start+1,...(code===206?{"Content-Range":"bytes "+start+"-"+end+"/"+info.size}:{})});
  createReadStream(path,{start,end}).on("error",()=>res.destroy()).pipe(res);
}
export function createDirectorProduction(deps={}){
  const execute=deps.produce??produceVideo,inspect=deps.inspect??inspectProduction;
  const compile=deps.compile??compilePreproductionRenderJob;
  const bindSfx=async (compiled,input)=>resolveAndBindApprovedSfx(compiled,input,
    deps.resolveSfx?{resolve:deps.resolveSfx}:{});
  const compileLive=deps.compileLive??compileLiveVisualPreview;
  const research=deps.research??researchVideoTopic;
  const generateStory=deps.generateStory??generatePreproductionPlan;
  const loadModel=deps.readModel??resolveModelForTask;
  const searchEndpoint=deps.searchEndpoint??configuredSearchEndpoint;
  const build=deps.build??(()=>run("pnpm",["build"],{cwd:root,timeout:300000,maxBuffer:1024*1024}));
  const browser=deps.findBrowser??findChromium;
  const outputRoot=deps.outputRoot??join(homedir(),"Movies","ContentGen","Studio");
  const env=deps.env??process.env;
  let busy=false,checked=null,controller=null,lastOutput=null,preview=null;
  const results=new Map();
  let status={state:"idle",phase:"idle",message:"Review the renderable storyboard before creating media.",
    progress:null,report:null,runId:null,mediaUrl:null,regeneration:null};
  const progress=event=>{
    status={...status,phase:event.phase,progress:event,
      message:event.message||event.phase.replaceAll("-"," ")};
  };
  async function handle(req,res){
    if(!authorize(req,res))return;
    const route=(req.url||"/").split("?")[0];
    try{
      if(req.method==="GET"&&route==="/demo"){
        const dossier=JSON.parse(readFileSync(new URL("../../../examples/preproduction-research-smoke.json",import.meta.url),"utf8"));
        const plan=JSON.parse(readFileSync(new URL("../../../examples/preproduction-plan-smoke.json",import.meta.url),"utf8"));
        respond(res,200,{dossier,bundle:compilePreproductionBundle(dossier,plan),
          note:"Synthetic example only. No factual claims are verified."});return;
      }
      if(req.method==="GET"&&route==="/status"){respond(res,200,status);return;}
      if(req.method==="GET"&&route.startsWith("/preview/")){
        if(!preview||route!=="/preview/"+preview.id){respond(res,404,{error:"Preview expired."});return;}
        res.writeHead(200,{...headers,"Content-Type":"text/html; charset=utf-8",
          "Content-Security-Policy":"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; frame-ancestors 'none'"});
        res.end(preview.html);return;
      }
      if(req.method==="GET"&&route.startsWith("/media/")){
        const id=/^\/media\/([a-f0-9-]+)\/video\.mp4$/u.exec(route)?.[1];
        if(!id||!results.has(id)){respond(res,404,{error:"Video is unavailable."});return;}
        await deliverVideo(req,res,results.get(id));return;
      }
      if(req.method!=="POST"){respond(res,404,{error:"Unknown production action."});return;}
      if(route==="/cancel"){
        if(!busy||!controller){respond(res,409,{error:"No active render."});return;}
        controller.abort(Error("Cancelled by editor."));
        respond(res,202,{cancelRequested:true});return;
      }
      if(busy){respond(res,409,{error:"Complete or cancel the current operation first."});return;}
      if(route==="/research"){
        const input=await readBody(req);
        if(input.allowNetwork!==true)throw Error("Approve public web research explicitly before searching.");
        const brief=input.brief;
        for(const name of ["title","viewerQuestion","audience"]){
          if(typeof brief?.[name]!=="string"||!brief[name].trim()||brief[name].length>240)
            throw Error("Research requires a topic, question and audience.");
        }
        const saved=await loadModel("research");
        if(!saved?.model)throw Error("Configure an installed local research model in Settings first.");
        const endpoint=searchEndpoint();
        if(!endpoint)throw Error("Local SearXNG is not set up. Run pnpm research:up once in apps/web.");
        busy=true;
        status={...status,state:"researching",phase:"research",message:"Searching and extracting candidate evidence locally."};
        try{
          const result=await research(brief,{provider:"searxng",searchEndpoint:endpoint,
            model:saved.model,endpoint:saved.endpoint,allowNetwork:true,maxSources:4});
          status={...status,state:"idle",phase:"research",message:"Research draft captured. Review sources; claims remain unverified."};
          respond(res,200,{dossier:result.dossier,quotePreviews:result.quotePreviews??[],
            warnings:result.warnings});
        }finally{busy=false;}
        return;
      }
      if(route==="/story"){
        const input=await readBody(req);
        const saved=await loadModel("story");
        if(!saved?.model)throw Error("Configure an installed local research model in Settings first.");
        busy=true;
        status={...status,state:"planning",phase:"story",message:"Drafting a research-linked visual teaching storyboard."};
        try{
          const plan=await generateStory(input.dossier,{model:saved.model,endpoint:saved.endpoint});
          const bundle=compilePreproductionBundle(input.dossier,plan);
          status={...status,state:"idle",phase:"story",message:"Storyboard draft ready for human editing and review."};
          respond(res,200,{bundle});
        }finally{busy=false;}
        return;
      }
      if(route==="/live-preview"){
        const input=await readBody(req);
        const compiled=compileLive(input.dossier,input.bundle,{spokenWpm:input.spokenWpm??145});
        respond(res,200,compiled);return;
      }
      if(route==="/plan"){
        const input=await readBody(req);
        respond(res,200,compile(input.dossier,input.bundle,{platform:"youtube"}));return;
      }
      if(route==="/preview"){
        const input=await readBody(req);
        compile(input.dossier,input.bundle,{platform:"youtube"});
        const animatic=compileAnimatic(input.bundle);
        preview={id:randomUUID(),html:renderAnimaticHtml(animatic)};
        respond(res,200,{url:"/api/contentgen-video/preview/"+preview.id,
          durationSeconds:Number((animatic.totalFrames/animatic.fps).toFixed(1)),
          status:"unreviewed-rough-cut"});return;
      }
      if(route==="/check"){
        const input=await readBody(req),compiled=compile(input.dossier,input.bundle,{platform:"youtube"});
        const settings=validateSettings(input.settings);
        const approvedSfx=await bindSfx(compiled,input),job=configureRenderJob(approvedSfx.job,settings);
        const identity=sha({source:compiled.sourcePlanSha256,job,settings:{
          ...settings,apiKeyHash:settings.apiKey?sha(settings.apiKey):"",apiKey:undefined}});
        busy=true;status={state:"checking",phase:"build",message:"Building and checking local tools…",
          progress:null,report:null,runId:null,mediaUrl:null,regeneration:null};
        try{
          await build();
          const executable=await browser(env);
          const options={
            out:join(outputRoot,"owned-preflight"),provider:settings.provider,
            providerRevision:settings.providerRevision,allowTestAssets:true,budgetUsd:0,
            browserExecutable:executable,localVoiceAuthorized:settings.localVoiceAuthorized===true,
            localEndpoint:settings.endpoint,allowNetwork:settings.provider==="fish",
            voiceReferenceConsent:settings.voiceConsent===true,
            textTransmissionApproved:settings.transmitText===true,
            env:{...env,FISH_AUDIO_API_KEY:settings.apiKey||env.FISH_AUDIO_API_KEY||""}
          };
          const report=await inspect(job,options);
          checked=report.ready?{identity}:null;
          status={...status,state:report.ready?"ready":"blocked",phase:"preflight",
            message:report.ready?"Ready to render an unverified test draft.":"Resolve the readiness findings below.",report};
          respond(res,200,{ready:report.ready,report,warnings:compiled.warnings,
            sfxSummary:approvedSfx.sfxSummary});
        }finally{busy=false;}
        return;
      }
      if(route==="/start"){
        const input=await readBody(req),compiled=compile(input.dossier,input.bundle,{platform:"youtube"});
        const settings=validateSettings(input.settings);
        const approvedSfx=await bindSfx(compiled,input),job=configureRenderJob(approvedSfx.job,settings);
        const identity=sha({source:compiled.sourcePlanSha256,job,settings:{
          ...settings,apiKeyHash:settings.apiKey?sha(settings.apiKey):"",apiKey:undefined}});
        if(input.confirmRender!==true||checked?.identity!==identity||status.state!=="ready"){
          respond(res,409,{error:"Check readiness with the exact current settings before rendering."});return;
        }
        checked=null;
        const runId=randomUUID(),out=join(outputRoot,"draft-"+runId),abort=new AbortController();
        controller=abort;busy=true;
        status={state:"rendering",phase:"starting",message:"Producing the local draft…",
          progress:null,report:status.report,runId,mediaUrl:null,regeneration:null};
        respond(res,202,{started:true,runId});
        void (async()=>{
          try{
            await mkdir(out,{recursive:true,mode:0o700});
            await writeFile(join(out,"render-job.json"),JSON.stringify(job,null,2)+"\n",{flag:"wx",mode:0o600});
            const executable=await browser(env);
            const result=await execute(job,{
              out,provider:settings.provider,providerRevision:settings.providerRevision,
              localEndpoint:settings.endpoint,localVoiceAuthorized:settings.localVoiceAuthorized===true,
              allowNetwork:settings.provider==="fish",voiceReferenceConsent:settings.voiceConsent===true,
              textTransmissionApproved:settings.transmitText===true,
              apiKey:settings.apiKey||env.FISH_AUDIO_API_KEY,
              budgetUsd:0,allowTestAssets:true,browserExecutable:executable,signal:abort.signal,
              ...(lastOutput?{reuseFrom:lastOutput}:{}),onProgress:progress
            });
            if(abort.signal.aborted)throw Error("Cancelled by editor.");
            results.set(runId,result.releaseDir);
            if(results.size>5)results.delete(results.keys().next().value);
            lastOutput=out;
            status={...status,state:"done",phase:"review",
              message:"Draft MP4 rendered. Watch/listen and review claims and rights.",
              mediaUrl:"/api/contentgen-video/media/"+runId+"/video.mp4",
              regeneration:result.regeneration??null};
          }catch(error){
            const cancelled=abort.signal.aborted;
            status={...status,state:cancelled?"cancelled":"failed",phase:"production",
              message:cancelled?"Render cancelled; no completed release published.":
                "Render failed: "+String(error?.message||error).slice(0,240)};
          }finally{busy=false;controller=null;}
        })();
        return;
      }
      respond(res,404,{error:"Unknown production action."});
    }catch(error){
      if(route==="/check"){checked=null;status={...status,state:"failed",phase:"preflight",
        message:"Readiness failed. Check Chrome, FFmpeg and pnpm."};busy=false;}
      respond(res,422,{error:String(error?.message||"Production request failed").slice(0,280)});
    }
  }
  return {handle,status:()=>status};
}
export function directorProductionPlugin(){
  const worker=createDirectorProduction();
  return {name:"contentgen-director-video-production",
    configureServer(server){server.middlewares.use("/api/contentgen-video",(req,res)=>{void worker.handle(req,res);});},
    configurePreviewServer(server){server.middlewares.use("/api/contentgen-video",(req,res)=>{void worker.handle(req,res);});}
  };
}
