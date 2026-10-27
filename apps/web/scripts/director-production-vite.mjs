/** Local, single-flight production for the React Studio; no service credentials persisted. */
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createReadStream, readFileSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
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
import { synthesizeNarration } from "./video-production/speech.mjs";
import { createProductionJobTracker } from "./video-production/production-jobs.mjs";
import { discoverShotAssets, listSelectedSceneAssets } from "./video-production/asset-discovery.mjs";
import { selectedMediaFingerprint } from "./video-production/render-scene-media.mjs";

const run=promisify(execFile),root=fileURLToPath(new URL("../",import.meta.url));
const sha=o=>createHash("sha256").update(JSON.stringify(o)).digest("hex");
const headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
const productionIdPattern=/^[a-z0-9][a-z0-9_-]{1,79}$/iu;
const runIdPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const MAX_SUGGESTIONS_BYTES=900_000;
const failureRecovery={
  "browser-preflight":["renderer_unavailable","Renderer setup failed. Check Chromium and the local build, then retry."],
  "asset-search":["asset_search_failed","Media discovery stopped unexpectedly. Disable online search or retry the draft."],
  narration:["narration_failed","Narration failed. Check the authorized voice provider and retry; verified completed speech can be reused."],
  timeline:["timeline_failed","Scene timing failed. Reopen the visual editor, check the affected scenes and retry."],
  audio:["audio_mix_failed","Audio mixing failed. Review selected sounds and FFmpeg, then retry."],
  rendering:["scene_render_failed","Scene rendering failed. Check Chromium and visual assets, then retry the draft."],
  mux:["video_mux_failed","MP4 assembly failed. Check FFmpeg and available disk space, then retry."],
  qa:["technical_qa_failed","Video quality checks failed. Review the media and audio requirements, then retry."],
  review:["export_failed","Final export failed. Check the local output directory and retry."],
};
function renderFailure(phase){
  const [code,message]=failureRecovery[phase]??["render_failed","Draft production failed. Open Jobs for the failed step, check local tools and retry."];
  return{code,message};
}
function mediaSearchChoice(input){
  if(input.searchFreeMedia!==undefined&&typeof input.searchFreeMedia!=="boolean")
    throw Error("Free media search preference must be true or false.");
  return input.searchFreeMedia===true;
}
const sampleExcerpt=text=>{
  const compact=String(text??"").replace(/\s+/gu," ").trim();
  if(!compact)throw Error("The first scene has no narration to audition.");
  if(compact.length<=180)return compact;
  const fragment=compact.slice(0,180),stop=fragment.lastIndexOf(" ");
  return fragment.slice(0,stop>=60?stop:180).trim();
};
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
  const synthesizeSample=deps.synthesizeNarration??synthesizeNarration;
  const compile=deps.compile??compilePreproductionRenderJob;
  const bindSfx=async (compiled,input)=>resolveAndBindApprovedSfx(compiled,input,{
    ...(deps.resolveSfx?{resolve:deps.resolveSfx}:{}),
    ...(deps.resolveSoundDesign?{resolveDesign:deps.resolveSoundDesign}:{})});
  const compileLive=deps.compileLive??compileLiveVisualPreview;
  const research=deps.research??researchVideoTopic;
  const generateStory=deps.generateStory??generatePreproductionPlan;
  const loadModel=deps.readModel??resolveModelForTask;
  const searchEndpoint=deps.searchEndpoint??configuredSearchEndpoint;
  const searchAssets=deps.searchAssets??discoverShotAssets;
  const listSelections=deps.listSelections??listSelectedSceneAssets;
  async function sceneMediaIdentity(compiled,dossier){
    const selected=await listSelections({projectId:dossier.id});
    const relevant=new Set(compiled.shotMap.map(shot=>shot.shotId));
    const fingerprint=selectedMediaFingerprint(selected,compiled.shotMap);
    return {fingerprint,identityFingerprint:selected.selections.some(asset=>relevant.has(asset.shotId))?
      fingerprint:undefined};
  }
  const build=deps.build??(()=>run("pnpm",["build"],{cwd:root,timeout:300000,maxBuffer:1024*1024}));
  const browser=deps.findBrowser??findChromium;
  const outputRoot=deps.outputRoot??join(homedir(),"Movies","ContentGen","Studio");
  const mediaIndexPath=join(outputRoot,"production-media-index-v1.json");
  async function readMediaIndex(){
    let raw;
    try{raw=await readFile(mediaIndexPath,"utf8");}
    catch(error){if(error?.code==="ENOENT")return [];throw error;}
    if(raw.length>30000)throw Error("Saved media index exceeds its size limit.");
    let data;
    try{data=JSON.parse(raw);}catch{throw Error("Saved media index is invalid; no entries were overwritten.");}
    if(data?.version!==1||!Array.isArray(data.records)||data.records.length>100||
      data.records.some(item=>!runIdPattern.test(item.runId)||
        (item.productionId!==null&&!productionIdPattern.test(item.productionId))||
        !Number.isSafeInteger(item.createdAt)))
      throw Error("Saved media index is invalid; no entries were overwritten.");
    return data.records;
  }
  async function recordMedia(runId,productionId,sourceRevision){
    const previous=await readMediaIndex();
    const records=[...previous.filter(item=>item.runId!==runId),
      {runId,productionId,sourceRevision,createdAt:Date.now()}].slice(-100);
    await mkdir(outputRoot,{recursive:true,mode:0o700});
    const temporary=join(outputRoot,".production-media-index-"+randomUUID()+".json");
    try{
      await writeFile(temporary,JSON.stringify({version:1,records})+"\n",{flag:"wx",mode:0o600});
      await rename(temporary,mediaIndexPath);
    }catch(error){await rm(temporary,{force:true}).catch(()=>{});throw error;}
  }
  async function releaseForRun(runId){
    if(results.has(runId))return results.get(runId);
    const records=await readMediaIndex();
    if(!records.some(item=>item.runId===runId))return null;
    // Never trust a path from persisted JSON; every target is derived from the
    // validated UUID within the application's owned output directory.
    return join(outputRoot,"draft-"+runId,"release");
  }
  async function productionAssets(productionId){
    const records=(await readMediaIndex()).filter(item=>item.productionId===productionId);
    const assets=[];
    for(const {runId,sourceRevision} of records){
      const releaseDir=join(outputRoot,"draft-"+runId,"release");
      for(const [file,kind] of [["video.mp4","video"],["captions.srt","captions"],["cover-still.png","thumbnail"]]){
        try{
          const info=await stat(join(releaseDir,file));
          if(!info.isFile()||info.size===0)continue;
        }catch(error){if(error?.code==="ENOENT")continue;throw error;}
        assets.push({id:kind+"-"+runId,kind,platform:"youtube",filename:file,sourceRevision,
          downloadUrl:"/api/contentgen-video/media/"+runId+"/"+file});
      }
    }
    return assets;
  }
  async function runMediaSuggestions(runId,productionId){
      if(!runIdPattern.test(runId))return {found:false};
      // An interrupted render has no release/index entry, but its successfully
      // collected catalog remains in the UUID-owned run directory. Reject
      // symlinks and cross-production manifests before considering reuse.
      const runDir=join(outputRoot,"draft-"+runId),path=join(runDir,"asset-suggestions.json");
      let dirInfo,info;
      try{[dirInfo,info]=await Promise.all([lstat(runDir),lstat(path)]);}
      catch(error){if(error?.code==="ENOENT")return {found:false};throw error;}
      if(!dirInfo.isDirectory()||dirInfo.isSymbolicLink()||!info.isFile()||info.isSymbolicLink()||
        info.size<2||info.size>MAX_SUGGESTIONS_BYTES)
        throw Error("Saved asset suggestions have an invalid size or file type. Search again in Video Director.");
      let data;
      try{data=JSON.parse(await readFile(path,"utf8"));}
      catch{throw Error("Saved asset suggestions are unreadable. Search again in Video Director.");}
      if(data?.schemaVersion!==1||data.productionId!==productionId||
        !Array.isArray(data.sourceShots)||data.sourceShots.length>60||
        !Array.isArray(data.sourceSound)||data.sourceSound.length>60||
        data.suggestions?.kind!=="contentgen-scene-asset-suggestions"||data.suggestions?.schemaVersion!==1||
        !Array.isArray(data.suggestions?.scenes)||data.suggestions.scenes.length>60||
        !Array.isArray(data.suggestions?.warnings)||data.suggestions.warnings.length>24||
        data.suggestions.warnings.some(value=>typeof value!=="string"||value.length>240)||
        data.suggestions.scenes.some(scene=>typeof scene?.shotId!=="string"||
          !Array.isArray(scene.candidates)||scene.candidates.length>12||
          scene.candidates.some(candidate=>!(["pexels","polyhaven"].includes(candidate?.provider))||
            typeof candidate.title!=="string"||typeof candidate.sourceUrl!=="string"||
            typeof candidate.licenseUrl!=="string"||typeof candidate.previewUrl!=="string"||
            !/^https:\/\//u.test(candidate.sourceUrl)||!/^https:\/\//u.test(candidate.licenseUrl)||
            (candidate.previewUrl!==""&&!/^https:\/\//u.test(candidate.previewUrl)))))
        throw Error("Saved asset suggestions are invalid. Search again in Video Director.");
      return {found:true,...data};
  }
  async function latestMediaSuggestions(productionId){
    const latest=(await readMediaIndex()).filter(item=>item.productionId===productionId).at(-1);
    if(latest)return runMediaSuggestions(latest.runId,productionId);
    return {found:false};
  }
  const env=deps.env??process.env;
  const newJobTracker=deps.jobTracker??(()=>createProductionJobTracker());
  let busy=false,checked=null,controller=null,lastOutput=null,preview=null;
  let activeJobTracker=null;
  let sample=null,sampleController=null;
  let sampleStatus={state:"idle",message:"No voice sample generated.",audioUrl:null};
  const results=new Map();
  let status={state:"idle",phase:"idle",message:"Review the renderable storyboard before creating media.",
    progress:null,report:null,runId:null,jobId:null,mediaUrl:null,regeneration:null};
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
      if(req.method==="GET"&&route==="/narration-sample/status"){
        respond(res,200,sampleStatus);return;
      }
      if(req.method==="GET"&&route.startsWith("/narration-sample/")){
        const id=/^\/narration-sample\/([a-f0-9-]+)\.wav$/u.exec(route)?.[1];
        if(!id||!sample||id!==sample.id||sampleStatus.state!=="done"){
          respond(res,404,{error:"Narration audition expired. Generate a new sample."});return;
        }
        const bytes=await readFile(sample.wavPath);
        res.writeHead(200,{...headers,"Content-Type":"audio/wav","Content-Length":bytes.length});
        res.end(bytes);return;
      }
      if(req.method==="GET"&&route.startsWith("/preview/")){
        if(!preview||route!=="/preview/"+preview.id){respond(res,404,{error:"Preview expired."});return;}
        res.writeHead(200,{...headers,"Content-Type":"text/html; charset=utf-8",
          "Content-Security-Policy":"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; frame-ancestors 'none'"});
        res.end(preview.html);return;
      }
      if(req.method==="GET"&&route.startsWith("/media/")){
        const match=/^\/media\/([a-f0-9-]+)\/(video\.mp4|captions\.srt|cover-still\.png)$/u.exec(route);
        if(!match||!runIdPattern.test(match[1])){respond(res,404,{error:"Media is unavailable."});return;}
        const releaseDir=await releaseForRun(match[1]);
        if(!releaseDir){respond(res,404,{error:"Media is unavailable."});return;}
        if(match[2]==="video.mp4")await deliverVideo(req,res,releaseDir);
        else {
          const bytes=await readFile(join(releaseDir,match[2]));
          res.writeHead(200,{...headers,"Content-Type":match[2]==="cover-still.png"?"image/png":"text/plain; charset=utf-8",
            "Content-Length":bytes.length,"Content-Disposition":`attachment; filename="${match[2]}"`});
          res.end(bytes);
        }
        return;
      }
      if(req.method==="GET"&&route.startsWith("/assets/")){
        const id=route.slice("/assets/".length);
        if(!productionIdPattern.test(id)){respond(res,404,{error:"Unknown production."});return;}
        respond(res,200,{assets:await productionAssets(id)});return;
      }
      if(req.method==="GET"&&route.startsWith("/suggestions/")){
        const id=route.slice("/suggestions/".length);
        if(!/^production-[a-f0-9]{24}$/u.test(id)){respond(res,404,{error:"Unknown production."});return;}
        respond(res,200,await latestMediaSuggestions(id));return;
      }
      if(req.method!=="POST"){respond(res,404,{error:"Unknown production action."});return;}
      if(route==="/narration-sample/cancel"){
        if(!sampleController||sampleStatus.state!=="generating"){
          respond(res,409,{error:"No narration audition is running."});return;
        }
        const input=await readBody(req);
        if(input.confirmed!==true){respond(res,422,{error:"Explicit cancellation required."});return;}
        sampleController.abort(Error("Cancelled by editor."));
        respond(res,202,{cancelRequested:true});return;
      }
      if(route==="/cancel"){
        if(!busy||!controller){respond(res,409,{error:"No active render."});return;}
        controller.abort(Error("Cancelled by editor."));
        if(activeJobTracker){
          try{await activeJobTracker.cancel();}
          catch(error){respond(res,503,{error:"Render cancellation requested, but Jobs could not confirm it. "+String(error?.message??"").slice(0,160)});return;}
        }
        respond(res,202,{cancelRequested:true});return;
      }
      if(busy){respond(res,409,{error:"Complete or cancel the current operation first."});return;}
      if(route==="/narration-sample"){
        const input=await readBody(req),settings=validateSettings(input.settings);
        const compiled=compile(input.dossier,input.bundle,{platform:"youtube"});
        const job=configureRenderJob(compiled.job,settings);
        if(!job.beats?.length)throw Error("Add a narrated scene before auditioning a voice.");
        job.beats=[{...job.beats[0],narration:sampleExcerpt(job.beats[0].narration)}];
        const id=randomUUID(),abort=new AbortController();
        sampleController=abort;busy=true;
        sampleStatus={state:"generating",message:"Synthesizing a short, first-scene voice sample…",audioUrl:null};
        respond(res,202,{started:true});
        void (async()=>{
          let ownedRoot=null,nextStatus=null;
          try{
            const parent=join(outputRoot,"narration-samples");
            await mkdir(parent,{recursive:true,mode:0o700});
            ownedRoot=await mkdtemp(join(parent,"sample-"));
            if(abort.signal.aborted)throw Error("Cancelled by editor.");
            const [beat]=await synthesizeSample(job,{
              provider:settings.provider,providerRevision:settings.providerRevision,
              cacheRoot:ownedRoot,signal:abort.signal,localVoiceAuthorized:settings.localVoiceAuthorized===true,
              allowNetwork:settings.provider==="fish",voiceReferenceConsent:settings.voiceConsent===true,
              textTransmissionApproved:settings.transmitText===true,apiKey:settings.apiKey,
              budgetUsd:0,paidUsageApproved:false
            });
            if(abort.signal.aborted)throw Error("Cancelled by editor.");
            if(typeof beat?.wavPath!=="string"||!beat.wavPath.startsWith(ownedRoot+"/"))
              throw Error("Narration service returned audio outside its owned sample folder.");
            const info=await stat(beat.wavPath);
            if(!info.isFile()||info.size<12||info.size>16*1024*1024)
              throw Error("Voice provider returned an invalid or oversized sample.");
            const previous=sample;sample={id,wavPath:beat.wavPath,root:ownedRoot};ownedRoot=null;
            nextStatus={state:"done",message:"Voice sample ready. Listen below before rendering.",
              audioUrl:"/api/contentgen-video/narration-sample/"+id+".wav"};
            if(previous)await rm(previous.root,{recursive:true,force:true}).catch(()=>{});
          }catch(error){
            const detail=[settings.apiKey,settings.voiceId,job.beats[0].narration]
              .filter(value=>typeof value==="string"&&value.length>0)
              .reduce((message,secret)=>message.replaceAll(secret,"[redacted]"),
                String(error?.message??"Speech service unavailable.")).slice(0,180);
            nextStatus={state:abort.signal.aborted?"cancelled":"failed",audioUrl:null,
              message:abort.signal.aborted?"Voice sample cancelled.":
                "Voice sample failed: "+detail};
          }finally{
            try{if(ownedRoot)await rm(ownedRoot,{recursive:true,force:true});}
            finally{sampleController=null;busy=false;
              sampleStatus=nextStatus??{state:"failed",audioUrl:null,message:"Could not clean up the voice sample."};}
          }
        })();
        return;
      }
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
        const input=await readBody(req);
        const searchFreeMedia=mediaSearchChoice(input)&&Boolean(input.productionId);
        if(input.productionId!==undefined&&!productionIdPattern.test(input.productionId))
          throw Error("Invalid production identity.");
        if(input.sourceRevision!==undefined&&(typeof input.sourceRevision!=="string"||input.sourceRevision.length>300||/[\u0000-\u001f]/u.test(input.sourceRevision)))
          throw Error("Invalid source revision.");
        const compiled=compile(input.dossier,input.bundle,{platform:"youtube"});
        const settings=validateSettings(input.settings);
        const approvedSfx=await bindSfx(compiled,input),job=configureRenderJob(approvedSfx.job,settings);
        const sceneMedia=await sceneMediaIdentity(compiled,input.dossier);
        const identity=sha({source:compiled.sourcePlanSha256,job,productionId:input.productionId??null,sourceRevision:input.sourceRevision??null,searchFreeMedia,sceneMediaFingerprint:sceneMedia.identityFingerprint,settings:{
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
        const input=await readBody(req);
        const searchFreeMedia=mediaSearchChoice(input)&&Boolean(input.productionId);
        if(input.productionId!==undefined&&!productionIdPattern.test(input.productionId))
          throw Error("Invalid production identity.");
        if(input.sourceRevision!==undefined&&(typeof input.sourceRevision!=="string"||input.sourceRevision.length>300||/[\u0000-\u001f]/u.test(input.sourceRevision)))
          throw Error("Invalid source revision.");
        const compiled=compile(input.dossier,input.bundle,{platform:"youtube"});
        const settings=validateSettings(input.settings);
        const approvedSfx=await bindSfx(compiled,input),job=configureRenderJob(approvedSfx.job,settings);
        const sceneMedia=await sceneMediaIdentity(compiled,input.dossier);
        const identity=sha({source:compiled.sourcePlanSha256,job,productionId:input.productionId??null,sourceRevision:input.sourceRevision??null,searchFreeMedia,sceneMediaFingerprint:sceneMedia.identityFingerprint,settings:{
          ...settings,apiKeyHash:settings.apiKey?sha(settings.apiKey):"",apiKey:undefined}});
        if(busy){respond(res,409,{error:"Complete or cancel the current operation first."});return;}
        if(input.confirmRender!==true||checked?.identity!==identity||status.state!=="ready"){
          respond(res,409,{error:"Check readiness with the exact current settings before rendering."});return;
        }
        // Reserve the local slot before the first asynchronous Jobs request.
        // Otherwise two rapid clicks can both create/claim a persistent run.
        busy=true;
        const runId=randomUUID(),out=join(outputRoot,"draft-"+runId),abort=new AbortController();
        // Real productions must acquire a persisted DAG before doing paid/network
        // work. Demo fixtures without a production ID retain their isolated mode.
        const tracker=input.productionId?newJobTracker():null;
        let trackedJobId=null;
        // Cancellation must remain possible while the persistent Jobs DAG is
        // being reserved; this operation may wait on the local Rust service.
        controller=abort;
        activeJobTracker=tracker;
        try {
          if(tracker){
            trackedJobId=await tracker.start({productionId:input.productionId,
              revision:identity,runId});
          }
          if(abort.signal.aborted){
            // /cancel may have arrived before tracker.start acquired its ID.
            // Re-issue cancellation now that the persisted job is addressable.
            await tracker?.cancel();
            status={...status,state:"cancelled",phase:"cancelled",
              message:"Video draft cancelled before rendering.",jobId:trackedJobId};
            checked=null;
            controller=null;
            activeJobTracker=null;
            busy=false;
            respond(res,409,{error:"Video draft cancelled before rendering."});
            return;
          }
        } catch(error){
          busy=false;
          checked=null;
          controller=null;
          activeJobTracker=null;
          throw error;
        }
        // The original run UUID lives in Rust's immutable Jobs node input.
        // After restart, a re-armed failed job can still find its verified
        // speech cache without adding a parallel retry database or worker.
        const interruptedRunId=tracker?.priorRunId;
        const reuseSpeechCacheFrom=interruptedRunId&&runIdPattern.test(interruptedRunId)?
          join(outputRoot,"draft-"+interruptedRunId):null;
        checked=null;
        status={state:"rendering",phase:"starting",message:"Producing the local draft…",
          progress:null,report:status.report,runId,jobId:trackedJobId,
          productionId:input.productionId??null,mediaUrl:null,regeneration:null};
        respond(res,202,{started:true,runId,jobId:trackedJobId});
        void (async()=>{
          let journal=Promise.resolve(),journalError=null;
          let assetSearchSummary=null;
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
              sceneAssetProjectId:input.dossier.id,sceneShotMap:compiled.shotMap,
              expectedSceneMediaFingerprint:sceneMedia.fingerprint,
              ...(reuseSpeechCacheFrom?{reuseSpeechCacheFrom}:{}),
              ...(searchFreeMedia?{prepareAssetSuggestions:async({signal})=>{
                try{
                  if(signal?.aborted)throw Error("Media search cancelled.");
                  if(interruptedRunId&&input.productionId){
                    // Completed asset-search work can survive failed narration,
                    // rendering, or app restart. Reuse only if the exact plan
                    // still matches and the owned saved catalog passes review.
                    let prior=null;
                    try{prior=await runMediaSuggestions(interruptedRunId,input.productionId);}catch{/* Search afresh if the old catalog is damaged. */}
                    if(prior?.found&&sha(prior.sourceShots)===sha(input.bundle.plan.shots)&&
                      sha(prior.sourceSound)===sha(input.bundle.plan.sound??[])){
                      if(signal?.aborted)throw Error("Media search cancelled.");
                      await writeFile(join(out,"asset-suggestions.json"),JSON.stringify({
                        schemaVersion:1,productionId:input.productionId,sourceShots:prior.sourceShots,
                        sourceSound:prior.sourceSound,suggestions:prior.suggestions}),{flag:"wx",mode:0o600});
                      assetSearchSummary={status:prior.suggestions.warnings.length?"partial":"completed",
                        reused:true,scenes:prior.suggestions.scenes.length,
                        candidates:prior.suggestions.scenes.reduce((sum,scene)=>sum+scene.candidates.length,0),
                        warnings:prior.suggestions.warnings.slice(0,8)};
                      return assetSearchSummary;
                    }
                  }
                  // The search is optional. A slow provider must not delay
                  // voice and Kumiki rendering indefinitely, regardless of
                  // how many distinct scene queries the plan contains.
                  const deadline=AbortSignal.timeout(35000);
                  const searchSignal=signal?AbortSignal.any([signal,deadline]):deadline;
                  const suggestions=await searchAssets({bundle:input.bundle,destination:"landscape",
                    providers:["polyhaven","pexels"],allowExternalSearch:true},
                  {pexelsKey:env.PEXELS_API_KEY,signal:searchSignal});
                  if(signal?.aborted)throw Error("Media search cancelled.");
                  if(deadline.aborted)throw Error("Media search timed out; use scene search to retry.");
                  if(suggestions?.kind!=="contentgen-scene-asset-suggestions"||
                    !Array.isArray(suggestions.scenes)||!Array.isArray(suggestions.warnings))
                    throw Error("Media search returned an invalid scene catalog.");
                  const saved={schemaVersion:1,productionId:input.productionId??null,
                    sourceShots:input.bundle.plan.shots,sourceSound:input.bundle.plan.sound??[],suggestions};
                  const bytes=JSON.stringify(saved);
                  if(Buffer.byteLength(bytes)>MAX_SUGGESTIONS_BYTES)
                    throw Error("Media suggestions exceeded the local catalog size limit.");
                  await writeFile(join(out,"asset-suggestions.json"),bytes,{flag:"wx",mode:0o600});
                  assetSearchSummary={status:suggestions.warnings.length?"partial":"completed",
                    scenes:suggestions.scenes.length,candidates:suggestions.scenes.reduce((sum,scene)=>sum+(scene.candidates?.length??0),0),
                    warnings:suggestions.warnings.slice(0,8).map(item=>String(item).slice(0,160))};
                }catch(error){
                  if(signal?.aborted)throw error;
                  assetSearchSummary={status:"fallback",scenes:0,candidates:0,
                    warnings:[String(error?.message??"Media search unavailable.").slice(0,160)]};
                }
                return assetSearchSummary;
              }}:{}),
              ...(lastOutput?{reuseFrom:lastOutput}:{}),onProgress:event=>{
                progress(event);
                if(tracker)journal=journal.then(()=>tracker.advance(event.phase,
                  event.phase==="narration"&&event.assetSearchSummary?{assetSearch:event.assetSearchSummary}:undefined)).catch(error=>{
                  journalError=error;
                  abort.abort(error);
                });
              }
            });
            await journal;
            if(journalError)throw journalError;
            if(abort.signal.aborted)throw Error("Cancelled by editor.");
            if(tracker)await tracker.complete();
            results.set(runId,result.releaseDir);
            if(results.size>5)results.delete(results.keys().next().value);
            let mediaWarning="";
            try{await recordMedia(runId,input.productionId??null,input.sourceRevision??null);}
            catch(error){mediaWarning=" Media index was not saved; keep your local release folder. "+
              String(error?.message??"Index error").slice(0,140);}
            lastOutput=out;
            status={...status,state:"done",phase:"review",
              message:"Draft MP4 rendered. Watch/listen and review claims and rights."+
                (assetSearchSummary?.reused?` Reused ${assetSearchSummary.candidates} saved media suggestions.`:
                  assetSearchSummary?.candidates?` ${assetSearchSummary.candidates} media suggestions saved for scene review.`:"")+
                (assetSearchSummary?.status==="fallback"?" Optional media search unavailable; use scene search to retry.":"")+mediaWarning,
              mediaUrl:"/api/contentgen-video/media/"+runId+"/video.mp4",
              regeneration:result.regeneration??null};
          }catch{
            await journal;
            // Journal failures also abort the renderer, but they are not user
            // cancellations. Try to persist a terminal failure if Jobs came
            // back before returning control to the editor.
            // A deliberate cancellation can race a pending Jobs transition.
            // The scheduler may then reject that transition because the job
            // is already CANCELLED; that is not a new renderer failure.
            const cancelled=abort.signal.aborted&&(!journalError||
              abort.signal.reason?.message==="Cancelled by editor.");
            const failure=journalError?{code:"jobs_unavailable",
              message:"Jobs tracking stopped responding. Restart the local Rust server, then retry the draft."}:
              renderFailure(status.phase);
            if(tracker&&!cancelled){
              try{await tracker.fail(failure.code,failure.message);}
              catch(journalFailure){status={...status,message:"Jobs failed to record the renderer error: "+String(journalFailure?.message??"unknown")};}
            }
            status={...status,state:cancelled?"cancelled":"failed",phase:"production",
              message:cancelled?"Render cancelled; no completed release published.":
                failure.message};
          }finally{busy=false;controller=null;activeJobTracker=null;}
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

