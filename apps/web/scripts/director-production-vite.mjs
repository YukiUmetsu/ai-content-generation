/** Local, single-flight production for the React Studio; no service credentials persisted. */
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { constants, createReadStream, readFileSync } from "node:fs";
import { link, lstat, mkdir, mkdtemp, open, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { compilePreproductionRenderJob } from "./video-production/preproduction-render-bridge.mjs";
import { resolveAndBindApprovedSfx } from "./video-production/sfx-render-bindings.mjs";
import { compileLiveVisualPreview } from "./video-production/live-visual-preview.mjs";
import { compileAnimatic } from "./video-production/animatic.mjs";
import { renderAnimaticHtml } from "./video-production/animatic-player.mjs";
import { inspectProduction } from "./video-production/cli.mjs";
import { produceVideo } from "./video-production/produce.mjs";
import { loadProjectCharacterRigs } from "./video-production/character-rig-render.mjs";
import { findChromium } from "./video-production/try.mjs";
import { localSpeechEndpoint } from "./video-production/local.mjs";
import { researchVideoTopic } from "./video-production/research-agent.mjs";
import { generatePreproductionPlan } from "./video-production/preproduction-generator.mjs";
import { compilePreproductionBundle } from "./video-production/preproduction.mjs";
import { createConversationNarrationTemplate } from "./video-production/conversation-template.mjs";
import { resolveModelForTask } from "./video-production/model-profiles.mjs";
import { configuredSearchEndpoint } from "./video-production/local-search-config.mjs";
import { synthesizeNarration } from "./video-production/speech.mjs";
import { createProductionJobTracker } from "./video-production/production-jobs.mjs";
import { discoverShotAssets, listApprovedAssets, listSelectedSceneAssets } from "./video-production/asset-discovery.mjs";
import { selectedMediaFingerprint } from "./video-production/render-scene-media.mjs";
import { withAutomaticApprovedMedia } from "./video-production/automatic-approved-assets.mjs";
import { productionProviderKey } from "./video-production/provider-keychain.mjs";
import { renderSelectedSceneClip } from "./video-production/scene-clip.mjs";
import { withSceneClipJob } from "./video-production/scene-clip-jobs.mjs";
import {listRecoveryIntents,reserveRecoveryAttempt,writeRecoveryIntent} from "./video-production/recovery-intent.mjs";

const run=promisify(execFile),root=fileURLToPath(new URL("../",import.meta.url));
function capturedText(value){
  if(typeof value==="string")return value;
  if(value&&typeof value==="object"&&typeof value.toString==="function"&&value.constructor?.name==="Buffer")return value.toString("utf8");
  return "";
}
/** pnpm prints `$ tsc -b && vite build` before a failed script. That line is a log, not a command to copy. */
export function exportPageBuildMessage(error){
  const raw=[capturedText(error?.stderr),capturedText(error?.stdout),capturedText(error?.message)].join("\n");
  const typescript=/error (TS\d+): ([^\n]{1,240})/u.exec(raw);
  if(typescript){
    const detail=typescript[2].replace(/(?:\/[\w.+~-]+){2,}/gu,"a local file").replace(/\s+/gu," ").trim().slice(0,180);
    return `The video page failed to build (${typescript[1]}: ${detail}). Fix that type error, then select Generate draft video again. Studio runs the build itself.`;
  }
  return "The video page failed to build before the draft could start. Select Generate draft video again. Studio runs the build itself; a log line that starts with $ is not a command to copy.";
}
async function buildExportPage(){
  try{await run("pnpm",["build"],{cwd:root,timeout:300000,maxBuffer:1024*1024});}
  catch(error){throw Error(exportPageBuildMessage(error));}
}
const sha=o=>createHash("sha256").update(JSON.stringify(o)).digest("hex");
function identityParts(input){
  const voiceSettings=Object.fromEntries(Object.entries(input.settings).filter(([key])=>key!=="apiKeyHash"));
  const {voice: jobVoice,...storyJob}=input.job;
  return {
    story:sha({source:input.source,job:storyJob,productionId:input.productionId,sourceRevision:input.sourceRevision}),
    media:sha({sceneMediaFingerprint:input.sceneMediaFingerprint,searchFreeMedia:input.searchFreeMedia,autoPrepareFreeMedia:input.autoPrepareFreeMedia}),
    characters:sha({characterRigs:input.characterRigs,authorizedVoiceIds:input.authorizedVoiceIds,castVoiceConsent:input.castVoiceConsent}),
    voice:sha({voiceSettings,jobVoice}),
  };
}

const headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
const productionIdPattern=/^[a-z0-9][a-z0-9_-]{1,79}$/iu;
const sceneIdPattern=/^[a-z0-9][a-z0-9_-]{0,95}$/iu;
const runIdPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const MAX_SUGGESTIONS_BYTES=900_000;
const failureRecovery={
  "browser-preflight":["renderer_unavailable","Renderer setup failed. Check Chromium and the local build, then retry."],
  "asset-search":["asset_search_failed","Media discovery stopped unexpectedly. Disable online search or retry the draft."],
  "asset-preparation":["asset_preparation_failed","Selected scene media could not be verified. Open Find the right visuals, replace or remove the affected asset, then retry."],
  "asset-prepared":["asset_preparation_failed","Selected scene media could not be verified. Open Find the right visuals, replace or remove the affected asset, then retry."],
  narration:["narration_failed","Narration failed. Check the authorized voice provider and retry; verified completed speech can be reused."],
  "speech-reused":["narration_failed","Narration failed. Check the authorized voice provider and retry; verified completed speech can be reused."],
  timeline:["timeline_failed","The renderer stopped while preparing scene timing. The specific cause and affected scene were not captured. Retry to check again; no script or audio has been changed."],
  audio:["audio_mix_failed","Audio mixing failed. Review selected sounds and FFmpeg, then retry."],
  captions:["caption_failed","Caption export failed. Retry the draft. Completed speech and scenes can be reused."],
  rendering:["scene_render_failed","Scene rendering failed. Check Chromium and visual assets, then retry the draft."],
  "segment-reused":["scene_render_failed","Scene rendering failed. Check Chromium and visual assets, then retry the draft."],
  starting:["startup_failed","The draft stopped before rendering started. Check the storyboard, voice settings and local tools, then retry."],
  thumbnails:["thumbnail_failed","Thumbnail export failed. Check the local browser and retry. Completed scenes can be reused."],
  mux:["video_mux_failed","MP4 assembly failed. Check FFmpeg and available disk space, then retry."],
  qa:["technical_qa_failed","Video quality checks failed. Review the media and audio requirements, then retry."],
  review:["export_failed","Final export failed. Check the local output directory and retry."],
};
const mediaToolJobs={
  media_tool_missing:"FFmpeg or FFprobe is not installed. Install the local media tools, then retry. Completed speech and scenes can be reused.",
  media_permission:"FFmpeg could not read or write local media. Check folder permissions, then retry. Completed scenes can be reused.",
  media_invalid:"FFmpeg rejected a local media file as invalid. Retry the draft. Verified speech and scenes can be reused.",
  media_timeout:"A local media tool stopped because the step took too long. Retry the draft. Verified scenes can be reused.",
};
function recognizedMediaToolFailure(error){
  const text=String(error?.message??"");
  if(/\bis not installed\b/u.test(text))return{code:"media_tool_missing",message:mediaToolJobs.media_tool_missing};
  if(/cannot access a local media file/u.test(text))return{code:"media_permission",message:mediaToolJobs.media_permission};
  const decoder=/no decoder found for:\s*([a-z0-9_]{1,32})/iu.exec(text);
  if(decoder)return{code:"media_decoder_missing",message:`This FFmpeg build cannot decode ${decoder[1].toLowerCase()}. Install a build with that decoder, then retry. Completed scenes can be reused.`};
  const encoder=/unknown encoder ([a-z0-9_]{1,32})/iu.exec(text);
  if(encoder)return{code:"media_encoder_missing",message:`This FFmpeg build cannot encode ${encoder[1].toLowerCase()}. Install that encoder, then retry. Completed scenes can be reused.`};
  if(/rejected a local media file/u.test(text))return{code:"media_invalid",message:mediaToolJobs.media_invalid};
  if(/\b(?:ffmpeg|ffprobe|media tool) timed out\b/u.test(text))return{code:"media_timeout",message:mediaToolJobs.media_timeout};
  return null;
}
function mediaToolMessage(code,detail){
  if(code==="media_decoder_missing"||code==="media_encoder_missing"){
    const text=String(detail??"");
    const pattern=code==="media_decoder_missing"
      ?/^This FFmpeg build cannot decode [a-z0-9_]{1,32}\. Install a build with that decoder, then retry\. Completed scenes can be reused\.$/u
      :/^This FFmpeg build cannot encode [a-z0-9_]{1,32}\. Install that encoder, then retry\. Completed scenes can be reused\.$/u;
    if(pattern.test(text))return text;
    return code==="media_decoder_missing"
      ?"This FFmpeg build is missing a required decoder. Install that decoder, then retry. Completed scenes can be reused."
      :"This FFmpeg build is missing a required encoder. Install that encoder, then retry. Completed scenes can be reused.";
  }
  return mediaToolJobs[code]??null;
}
/** Keep a short cause from our own errors and tool failures. Drop paths, secrets, stacks, and narration. */
function safeFailureReason(error){
  const raw=[capturedText(error?.message),capturedText(error?.stderr)].join("\n");
  let text=raw.split(/\r?\n/u).filter(line=>line.trim()&&!/^\s*at\s+/u.test(line)&&!/^\$\s/u.test(line)).join(" ");
  text=text
    .replace(/https?:\/\/\S+/giu,"")
    .replace(/(?:[A-Za-z]:\\[\w\\ .-]+|(?:\/[\w.+~@-]+){2,})/gu,"")
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gu,"")
    .replace(/\b(?:sk-|rk-|api[_-]?key|bearer|token|secret|password)\S*/giu,"")
    .replace(/\b[a-f0-9]{32,}\b/giu,"")
    .replace(/Command failed:\s*/giu,"")
    .replace(/"[^"]{40,}"|'[^']{40,}'/gu,"")
    .replace(/\s+/gu," ")
    .trim();
  const embedded=/(?:TypeError|RangeError|ReferenceError|SyntaxError|Error):\s+(.{8,180}?)(?:\.|$)/u.exec(text);
  let reason=(embedded?.[1]??text).replace(/^[:\s-]+/u,"").trim().split(/[.!?]/u)[0].trim();
  reason=reason.replace(/[^\p{L}\p{N}\p{P}\p{Zs}+#:_-]/gu,"").trim().slice(0,160);
  if(reason.length<12||reason.split(/\s+/u).length>22)return "";
  if(/[\\/]|\.\.|https?:|secret|api[_-]?key|bearer|\bpassword\b|\btoken\b/iu.test(reason))return "";
  const namesCause=/\b(?:fail(?:ed|ure|s)?|invalid|timeout|timed out|exceeded|closed|crashed|unavailable|decoder|encoder|chromium|ffmpeg|diagram|layout|frame|asset|caption|narration|thumbnail|export|render|scene|permission|disk|locked|refused|reset|denied|unsupported|not found|does not exist|doesn't exist|too short|too long|enospc|eacces|econn)\b/iu.test(reason);
  return namesCause?reason:"";
}
function acceptedStoredDetail(detail){
  if(typeof detail!=="string")return "";
  const text=detail.replace(/\s+/gu," ").trim();
  if(text.length<12||text.length>240)return "";
  if(/[\\/]|\.\.|https?:|secret|api[_-]?key|bearer|\bpassword\b|\btoken\b/iu.test(text))return "";
  return text;
}
function stageFailure(phase,error){
  const [code,generic]=failureRecovery[phase]??["render_failed","Draft production failed. Open Jobs for the failed step, check local tools and retry."];
  const reason=safeFailureReason(error);
  if(!reason)return{code,message:generic};
  return{code,message:`${generic.split(".")[0]}: ${reason}.`.slice(0,240)};
}
export function renderFailure(phase,error,context={}){
  // Diagnostic strings can contain provider responses, script text, local
  // paths or credentials. Recognized causes are kept; everything else is stripped.
  if(/\bENOSPC\b|no space left on device/iu.test(String(error?.message??"")))
    return{code:"disk_full",message:"Local disk space is exhausted. Free disk space, then retry the draft; verified scenes can be reused."};
  if(/^Scene review coverage invalid: review still storage exceeds the 256 MiB budget/u.test(String(error?.message??"")))
    return{code:"review_still_storage_limit",message:"Scene review captures exceeded the 256 MiB safety budget. Shorten the storyboard, then retry; verified segments can be reused."};
  if(/^Scene review coverage invalid: .*64.*scene|^Scene review coverage invalid: .*64.*still/iu.test(String(error?.message??"")))
    return{code:"scene_review_limit",message:"This draft exceeds the 64-scene review evidence limit. Split the storyboard before generating narration."};
  if(error?.message==="QA_REPORT_INTEGRITY_FAILED")
    return{code:"qa_integrity_failed",message:"The QA report was missing or changed during export. No completed Jobs release was recorded. Check local storage, then retry the draft."};
  if(phase==="timeline"){
    const text=String(error?.message??"");
    const cases=[
      [/^Visual SFX timing unavailable: Shot ([A-Za-z0-9_-]+) has no measurable visible-element reveal after its opening frame\.$/u,
        "The visual reveal cannot be found within the measured narration. Add a visible reveal or remove its sound cue."],
      [/^Visual SFX timing unavailable: Shot ([A-Za-z0-9_-]+) has an unsupported dynamic visual presentation without authoritative element-reveal cues\.$/u,
        "The selected visual does not provide a measurable reveal for its sound cue. Choose another cue or visual."],
      [/^Visual SFX timing unavailable: Shot ([A-Za-z0-9_-]+) visual cue is outside its measured audio beat\.$/u,
        "The visual sound cue falls outside the measured narration. Review the scene timing and cue."],
      [/^General explainer visual plan invalid: beat ([A-Za-z0-9_-]+) is too short to render$/u,
        "The measured narration is too short for a video frame. Check the scene audio and retry."],
      [/^General explainer visual plan invalid: beat ([A-Za-z0-9_-]+) (?:timeline mismatch|has mismatched measured dialogue|measured turns do not fill the scene speech range|character speech differs from measured narration)$/u,
        "The scene's measured narration does not match its visual or dialogue timing. Review its narration and retry."],
      [/^General explainer visual plan invalid: beat ([A-Za-z0-9_-]+) turn [A-Za-z0-9_-]+ differs from measured voice identity or timing$/u,
        "A dialogue turn does not match its measured voice or timing. Review the scene's speaker and narration."],
      [/^Invalid sample timeline: (?:invalid measured scene |beat )([A-Za-z0-9_-]+)(?: must have positive measured samples| has an invalid pause)?$/u,
        "The measured scene audio or pause is invalid. Check its narration and retry."],
    ];
    if(text==="General explainer visual plan invalid: unexpected-endpoint")
      return {code:"timeline_failed",message:"Fish narration received a local speech address. Generate the draft again; speech stays on Fish and completed audio can be reused."};
    const eventMismatch=/^Visual SFX timing unavailable: Shot for event ([A-Za-z0-9_-]+) is not matched to its measured beat\.$/u.exec(text);
    const eventBeat=eventMismatch&&context.job?.events?.find(event=>event.id===eventMismatch[1])?.beatId;
    if(typeof eventBeat==="string"&&/^[A-Za-z0-9_-]{1,96}$/u.test(eventBeat)){
      const index=(context.shotMap??[]).findIndex(shot=>shot.beatId===eventBeat);
      const shot=index>=0?context.shotMap[index].shotId:null;
      const label=typeof shot==="string"&&/^[A-Za-z0-9_-]{1,96}$/u.test(shot)?`Scene ${index+1} (${shot})`:`Scene ${eventBeat}`;
      return {code:"timeline_failed",message:`${label}: A visual sound cue is not linked to the measured narration. Review the scene cue and retry.`.slice(0,240)};
    }
    for(const [pattern,explanation] of cases){
      const match=pattern.exec(text);if(!match)continue;
      const index=(context.shotMap??[]).findIndex(shot=>shot.beatId===match[1]);
      const shot=index>=0?context.shotMap[index].shotId:null;
      const label=typeof shot==="string"&&/^[A-Za-z0-9_-]{1,96}$/u.test(shot)?`Scene ${index+1} (${shot})`:`Scene ${match[1]}`;
      return {code:"timeline_failed",message:`${label}: ${explanation}`.slice(0,240)};
    }
  }
  if(phase==="thumbnails"){
    const text=`${error?.stderr??""}\n${error?.message??""}`;
    if(/no decoder found for:\s*svg/iu.test(text)||/^Thumbnail export needs a local Chromium/u.test(String(error?.message??"")))
      return{code:"thumbnail_failed",message:"This FFmpeg build cannot read SVG thumbnails. Check the local browser and retry. Completed scenes can be reused."};
    if(/not a valid 1280×720 PNG/u.test(String(error?.message??"")))
      return{code:"thumbnail_failed",message:"A title card was not a valid 1280×720 image. Retry the draft. Finished title cards can be reused."};
    if(/unsafe or incomplete thumbnail composition/u.test(String(error?.message??"")))
      return{code:"thumbnail_failed",message:"A title card composition was incomplete. Retry the draft. Finished title cards can be reused."};
    if(/already being produced or has completed/u.test(String(error?.message??"")))
      return{code:"thumbnail_failed",message:"A previous title card is still claimed. Wait two minutes, then retry. Finished title cards can be reused."};
    if(/Jobs service unavailable|database is locked/iu.test(String(error?.message??"")))
      return{code:"thumbnail_failed",message:"Thumbnail tracking was busy. Retry the draft. Finished title cards can be reused."};
  }
  const mediaTool=recognizedMediaToolFailure(error);
  if(mediaTool)return mediaTool;
  return stageFailure(phase,error);
}
export function persistedFailure(job){
  const failing=job?.nodes?.find(node=>["FAILED","READY"].includes(node.state)&&
    typeof node.errorCode==="string");
  if(failing?.errorCode==="disk_full")return renderFailure("",Error("ENOSPC"));
  if(failing?.errorCode==="review_still_storage_limit")return renderFailure("",Error("Scene review coverage invalid: review still storage exceeds the 256 MiB budget"));
  if(failing?.errorCode==="scene_review_limit")return renderFailure("",Error("Scene review coverage invalid: the 64-still limit supports at most 64 narrated scenes"));
  if(failing?.errorCode==="qa_integrity_failed")return renderFailure("",Error("QA_REPORT_INTEGRITY_FAILED"));
  const storedDetail=failing?.errorDetail??job?.attempts?.find(attempt=>
    attempt.nodeId===failing?.id&&attempt.errorCode===failing?.errorCode)?.errorDetail;
  const safeDetail=acceptedStoredDetail(storedDetail);
  if(safeDetail)return{code:failing.errorCode,message:safeDetail};
  for(const [phase,[code,message]] of Object.entries(failureRecovery)){
    if(failing?.errorCode===code)return{code,message,phase};
  }
  const reloadedMediaTool=mediaToolMessage(failing?.errorCode,storedDetail);
  if(reloadedMediaTool)return{code:failing.errorCode,message:reloadedMediaTool};
  if(failing?.errorCode==="jobs_unavailable")return{code:"jobs_unavailable",
    message:"Jobs tracking stopped responding. Restart the local Rust server, then retry the draft."};
  return{code:"render_failed",message:"The draft stopped before completion. Inspect the failed step in Jobs and retry."};
}
function mediaSearchChoice(input){
  if(input.searchFreeMedia!==undefined&&typeof input.searchFreeMedia!=="boolean")
    throw Error("Free media search preference must be true or false.");
  return input.searchFreeMedia===true;
}
function autoMediaChoice(input){
  if(input.autoPrepareFreeMedia!==undefined&&typeof input.autoPrepareFreeMedia!=="boolean")
    throw Error("Automatic draft media preference must be true or false.");
  // Searching is already a per-draft privacy choice. With search enabled,
  // safely prepare only authoritative CC0 Commons originals; never revive
  // the retired Pexels API workflow or trust Openverse index licenses.
  return input.autoPrepareFreeMedia!==false;
}
const sampleExcerpt=text=>{
  const compact=String(text??"").replace(/\s+/gu," ").trim();
  if(!compact)throw Error("The selected scene has no narration to audition.");
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
      (x.apiKey!==undefined&&typeof x.apiKey!=="string"))
    throw Error("Fish Audio requires voice permission and explicit text-transmission consent.");
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
/** Resolve only cast voices already present in the validated storyboard.
 * User-supplied ID lists are never accepted as independent authorization.
 */
function resolveCastVoiceIds(compiled,bundle,settings,consent,selectedBeatIds=null){
  if(consent!==undefined&&typeof consent!=="boolean")throw Error("Cast voice permission must be explicitly checked or unchecked.");
  const byShot=new Map(bundle.plan.sound.map(sound=>[sound.shotId,sound]));
  const additional=new Set();
  for(const shot of compiled.shotMap){
    if(selectedBeatIds&&!selectedBeatIds.has(shot.beatId))continue;
    const sound=byShot.get(shot.shotId);
    const beat=compiled.job.beats.find(item=>item.id===shot.beatId);
    const sourceSpeakers=sound?.speechTurns? sound.speechTurns.map(turn=>turn.speaker):[sound?.speaker];
    const renderedSpeakers=beat?.speechTurns?beat.speechTurns.map(turn=>turn.speaker):[beat?.speaker];
    if(sourceSpeakers.length!==renderedSpeakers.length)
      throw Error("Scene dialogue changed during compilation. Reopen the storyboard before generating speech.");
    for(let i=0;i<sourceSpeakers.length;i++){
      const speaker=sourceSpeakers[i],rendered=renderedSpeakers[i];
      if(!speaker){
        if(rendered)throw Error("Scene speaker changed during compilation.");
        continue;
      }
      if(speaker.provider!==settings.provider)
        throw Error(`Scene ${shot.shotId} uses ${speaker.provider} for ${speaker.id}. Choose the same provider as the main narrator, or change the scene voice.`);
      if(!rendered||rendered.id!==speaker.id||rendered.role!==speaker.role||rendered.voiceId!==speaker.voiceId)
        throw Error("Scene cast changed during compilation. Reopen the storyboard before generating speech.");
      if(speaker.voiceId!==settings.voiceId)additional.add(speaker.voiceId);
    }
  }
  if(additional.size>16)throw Error("The video exceeds the 16-voice cast authorization limit.");
  if(additional.size&&consent!==true)
    throw Error(`Authorize the ${additional.size} additional cast voice(s) in Narration before generating speech. Your saved scene choices are intact.`);
  return [...additional];
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
  const path=join(releaseDir,"video.mp4"),info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink()||info.size===0)throw Error("Video output is missing.");
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
/** Serve only the exact verified preview inode. A media range request cannot
 * swap the file between its checksum and streaming to the user. */
async function deliverSceneVideo(req,res,file,expectedHash,expectedSize,digestCache){
  const descriptor=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  let released=false;
  const release=()=>{if(!released){released=true;void descriptor.close().catch(()=>{});}};
  try{
    const before=await descriptor.stat();
    if(!before.isFile()||before.size!==expectedSize||before.size<100){
      release();respond(res,404,{error:"Scene preview failed its media integrity check."});return;
    }
    const signature=["scene-clip",file,before.ino,before.size,before.mtimeMs,before.ctimeMs,expectedHash].join(":");
    if(digestCache.get(signature)!==true){
      const digest=createHash("sha256");
      for await(const part of descriptor.createReadStream({autoClose:false}))digest.update(part);
      const after=await descriptor.stat();
      if(after.ino!==before.ino||after.size!==before.size||after.mtimeMs!==before.mtimeMs||
        after.ctimeMs!==before.ctimeMs||digest.digest("hex")!==expectedHash){
        release();respond(res,404,{error:"Scene preview bytes have changed. Render the scene again."});return;
      }
      if(digestCache.size>128)digestCache.clear();
      digestCache.set(signature,true);
    }
    let start=0,end=before.size-1,code=200;
    if(req.headers.range){
      const match=/^bytes=(\d+)-(\d*)$/u.exec(req.headers.range);
      if(!match){release();respond(res,416,{error:"Unsupported video byte range."});return;}
      start=Number(match[1]);end=match[2]?Number(match[2]):end;
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||end>=before.size){
        release();respond(res,416,{error:"Video byte range outside file."});return;
      }
      code=206;
    }
    res.writeHead(code,{...headers,"Content-Type":"video/mp4","Accept-Ranges":"bytes",
      "Content-Length":end-start+1,...(code===206?{"Content-Range":`bytes ${start}-${end}/${before.size}`}:{})});
    const stream=descriptor.createReadStream({start,end,autoClose:false});
    stream.once("end",release);
    stream.once("error",()=>{release();res.destroy();});
    res.once?.("close",release);
    stream.pipe(res);
  }catch(error){release();throw error;}
}
export function createDirectorProduction(deps={}){
  const execute=deps.produce??produceVideo,inspect=deps.inspect??inspectProduction;
  const resolveRigs=deps.loadCharacterRigs??loadProjectCharacterRigs;
  async function characterRigSelection(input,job,shotMap){
    const actionRequests=job.beats.flatMap(beat=>(beat.speechTurns??[])
      .filter(turn=>turn.animationAction).map(turn=>({beatId:beat.id,speakerId:turn.speaker?.id,action:turn.animationAction})));
    const speakers=[...new Set(job.beats.flatMap(beat=>
      (beat.speechTurns??[beat]).map(turn=>turn.speaker?.role==="character"?turn.speaker.id:null)).filter(id=>id==="pip"||id==="quill"))];
    const selectedDraftIds=input.characterDraftIds??{};
    if(!selectedDraftIds||typeof selectedDraftIds!=="object"||Array.isArray(selectedDraftIds)||
      Object.entries(selectedDraftIds).some(([speaker,id])=>
        !speakers.includes(speaker)||typeof id!=="string"||
        !/^character-draft-[a-f0-9]{32}$/.test(id)))
      throw Error("Select valid saved Character Studio revisions for characters speaking in this video.");
    const requestedScenes=input.characterDraftIdsByScene??{};
    const sceneSpeakers=new Map(shotMap.map(shot=>{
      const beat=job.beats.find(item=>item.id===shot.beatId);
      return [shot.shotId,new Set((beat?.speechTurns??[beat])
        .filter(turn=>turn?.speaker?.role==="character")
        .map(turn=>turn.speaker.id))];
    }));
    if(!requestedScenes||typeof requestedScenes!=="object"||Array.isArray(requestedScenes)||
      Object.entries(requestedScenes).some(([shotId,picks])=>
        !sceneSpeakers.has(shotId)||!picks||typeof picks!=="object"||Array.isArray(picks)||
        !Object.keys(picks).length||Object.entries(picks).some(([speaker,id])=>
          !sceneSpeakers.get(shotId).has(speaker)||!["pip","quill"].includes(speaker)||
          typeof id!=="string"||!/^character-draft-[a-f0-9]{32}$/.test(id))))
      throw Error("Scene rig revisions must identify a saved draft for a character speaking in that exact scene.");
    if((Object.keys(selectedDraftIds).length||Object.keys(requestedScenes).length)&&!input.characterProjectId)
      throw Error("Select the Character Studio project before pinning a saved rig revision.");
    const selectedDraftIdsByScene=Object.create(null);
    for(const shot of shotMap)if(requestedScenes[shot.shotId])
      selectedDraftIdsByScene[shot.beatId]={...selectedDraftIdsByScene[shot.beatId],...requestedScenes[shot.shotId]};
    if(!speakers.length||input.characterProjectId===undefined){
      if(actionRequests.some(({speakerId,action})=>!(["pip","quill"].includes(speakerId)&&action===`${speakerId}-explain`)))
        throw Error("A named walk or gesture requires a selected Character Studio rig containing that action.");
      return {rigs:{},assets:[],identity:[]};
    }
    if(typeof input.characterProjectId!=="string"||
      !/^[A-Za-z0-9_-]{1,120}$/.test(input.characterProjectId))
      throw Error("Invalid Character Studio project identity.");
    const resolved=await resolveRigs({projectId:input.characterProjectId,speakers,selectedDraftIds,selectedDraftIdsByScene});
    for(const {beatId,speakerId,action} of actionRequests){
      const available=(resolved.rigsByScene?.[beatId]?.[speakerId]??resolved.rigs?.[speakerId])?.definition?.actions;
      if(available ? !Object.hasOwn(available,action) : action!==`${speakerId}-explain`)
        throw Error(`Character action "${action}" is not declared by the selected ${speakerId} Character Studio revision. Choose an action from that rig or clear it.`);
    }
    return resolved;
  }
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
  const providerKey=deps.providerKey??productionProviderKey;
  const listSelections=deps.listSelections??listSelectedSceneAssets;
  const listApproved=deps.listApproved??listApprovedAssets;
  async function sceneMediaIdentity(compiled,dossier,bundle){
    const pinned=await listSelections({projectId:dossier.id});
    const selected=withAutomaticApprovedMedia(pinned,await listApproved({projectId:dossier.id}),
      compiled.shotMap,bundle);
    const relevant=new Set(compiled.shotMap.map(shot=>shot.shotId));
    const fingerprint=selectedMediaFingerprint(selected,compiled.shotMap);
    return {fingerprint,identityFingerprint:selected.selections.some(asset=>relevant.has(asset.shotId))?
      fingerprint:undefined};
  }
  const build=deps.build??buildExportPage;
  const browser=deps.findBrowser??findChromium;
  const outputRoot=deps.outputRoot??join(homedir(),"Movies","ContentGen","Studio");
  const mediaIndexPath=join(outputRoot,"production-media-index-v1.json");
  const mediaRecordsRoot=join(outputRoot,"production-media-records-v1");
  const mediaDigests=new Map();
  const releasedArtifactKeys={"video.mp4":"video","captions.srt":"captions",
    "qa-report.json":"qaReport",
    "cover-still.png":"coverStill","thumbnail-1.png":"thumbnail-1",
    "thumbnail-2.png":"thumbnail-2","thumbnail-3.png":"thumbnail-3",
    "thumbnail-1.svg":"thumbnail-1.svg","thumbnail-2.svg":"thumbnail-2.svg",
    "thumbnail-3.svg":"thumbnail-3.svg"};
  async function verifiedReleaseFile(releaseDir,filename,manifestHash=null){
    const path=join(releaseDir,filename),artifactKey=releasedArtifactKeys[filename];
    if(!artifactKey)return false;
    let file,manifestInfo;
    try{file=await lstat(path);}catch(error){if(error?.code==="ENOENT")return false;throw error;}
    if(!file.isFile()||file.isSymbolicLink()||file.size===0)return false;
    try{manifestInfo=await lstat(join(releaseDir,"render-manifest.json"));}
    catch(error){if(error?.code==="ENOENT")return !manifestHash;throw error;} // historical releases
    if(!manifestInfo.isFile()||manifestInfo.isSymbolicLink()||
      manifestInfo.size<40||manifestInfo.size>8*1024*1024)return false;
    let manifest;
    try{
      const bytes=await readFile(join(releaseDir,"render-manifest.json"));
      if(manifestHash&&createHash("sha256").update(bytes).digest("hex")!==manifestHash)return false;
      manifest=JSON.parse(bytes.toString("utf8"));
    }
    catch{return false;}
    const expected=manifest?.schemaVersion!==1?null:filename.endsWith(".svg")?
      manifest.thumbnails?.find(item=>item.source===filename)?.sourceSha256:
      manifest.artifacts?.[artifactKey];
    if(typeof expected!=="string"||!/^[a-f0-9]{64}$/u.test(expected))return false;
    const signature=[path,file.ino,file.size,file.mtimeMs,file.ctimeMs,manifestInfo.ino,
      manifestInfo.size,manifestInfo.mtimeMs,manifestInfo.ctimeMs,manifestHash,expected].join(":");
    if(mediaDigests.has(signature))return mediaDigests.get(signature);
    let valid=false,descriptor;
    try{
      descriptor=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
      const before=await descriptor.stat();
      if(before.ino!==file.ino||before.size!==file.size||before.mtimeMs!==file.mtimeMs||
        before.ctimeMs!==file.ctimeMs)return false;
      const digest=createHash("sha256");
      for await(const chunk of descriptor.createReadStream({autoClose:false}))digest.update(chunk);
      const after=await descriptor.stat();
      valid=after.ino===file.ino&&after.size===file.size&&after.mtimeMs===file.mtimeMs&&
        after.ctimeMs===file.ctimeMs&&
        digest.digest("hex")===expected;
    }catch{/* Corrupt or replaced releases must not be advertised or served. */}
    finally{await descriptor?.close().catch(()=>{});}
    if(mediaDigests.size>128)mediaDigests.clear();
    mediaDigests.set(signature,valid);
    return valid;
  }
  async function readLocalJob(path){
    const origin=new URL((deps.env??process.env).CONTENTGEN_JOBS_ORIGIN??"http://127.0.0.1:8787");
    if(origin.protocol!=="http:"||!["localhost","127.0.0.1"].includes(origin.hostname)||
      origin.username||origin.password||origin.pathname!=="/"||origin.search||origin.hash)
      throw Error("Jobs requires a local server address.");
    let response;
    try{response=await fetch(new URL(path,origin),{
      signal:AbortSignal.timeout(4000),redirect:"error",headers:{"Accept":"application/json"}});}
    catch{throw Error("Cannot reach the local Jobs service. Start it and retry the production.");}
    if(!response.ok)throw Error("Jobs could not load the production. Check the local Jobs service and retry.");
    try{return await response.json();}
    catch{throw Error("The local Jobs service returned invalid data. Restart it and retry.");}
  }
  const latestProductionJob=deps.latestProductionJob??(productionId=>
    readLocalJob(`/api/jobs/production/${productionId}/latest`));
  const productionJobById=deps.productionJobById??(jobId=>readLocalJob(`/api/jobs/${jobId}`));
  async function readMediaIndex(){
    let raw;
    try{raw=await readFile(mediaIndexPath,"utf8");}
    catch(error){if(error?.code!=="ENOENT")throw error;}
    let previous=[];
    if(raw!==undefined){
      if(raw.length>30000)throw Error("Saved media index exceeds its size limit.");
      let data;
      try{data=JSON.parse(raw);}catch{throw Error("Saved media index is invalid; no entries were overwritten.");}
      if(data?.version!==1||!Array.isArray(data.records)||data.records.length>100||
        data.records.some(item=>!runIdPattern.test(item.runId)||
          (item.productionId!==null&&!productionIdPattern.test(item.productionId))||
          !Number.isSafeInteger(item.createdAt)))
        throw Error("Saved media index is invalid; no entries were overwritten.");
      previous=data.records;
    }
    // New releases use independent, immutable UUID records. Two workers can
    // commit different releases simultaneously without either rewriting a
    // shared JSON document or losing the other's finished output.
    let recordDirectory;
    try{recordDirectory=await lstat(mediaRecordsRoot);}
    catch(error){if(error?.code==="ENOENT")return previous;throw error;}
    if(!recordDirectory.isDirectory()||recordDirectory.isSymbolicLink())
      throw Error("Saved media record directory is not an owned directory.");
    let entries;
    try{entries=await readdir(mediaRecordsRoot,{withFileTypes:true});}
    catch(error){if(error?.code==="ENOENT")return previous;throw error;}
    if(entries.length>10000)throw Error("Saved media record directory exceeds its size limit.");
    const records=[];
    for(const entry of entries){
      const match=/^([a-f0-9-]{36})\.json$/u.exec(entry.name);
      if(!match||!runIdPattern.test(match[1]))continue;
      if(!entry.isFile()||entry.isSymbolicLink())
        throw Error("Saved media record is not an ordinary file.");
      const path=join(mediaRecordsRoot,entry.name),info=await lstat(path);
      if(!info.isFile()||info.isSymbolicLink()||info.size<40||info.size>1200)
        throw Error("Saved media record is malformed.");
      let document;
      try{document=JSON.parse(await readFile(path,"utf8"));}
      catch{throw Error("Saved media record is unreadable; original output was not overwritten.");}
      const record=document?.record;
      if(document?.version!==1||record?.runId!==match[1]||
        (record.productionId!==null&&!productionIdPattern.test(record.productionId))||
        !Number.isSafeInteger(record.createdAt)||
        (record.manifestHash!==undefined&&record.manifestHash!==null&&
          (typeof record.manifestHash!=="string"||!/^[a-f0-9]{64}$/u.test(record.manifestHash)))||
        (record.sourceRevision!==null&&(typeof record.sourceRevision!=="string"||
          record.sourceRevision.length>300||/[\u0000-\u001f]/u.test(record.sourceRevision))))
        throw Error("Saved media record is invalid; original output was not overwritten.");
      records.push(record);
    }
    const byRun=new Map(previous.map(item=>[item.runId,item]));
    for(const item of records)byRun.set(item.runId,item);
    // The legacy monolithic index is capped at 100, but immutable per-release
    // records must not disappear globally after 100 unrelated exports: they
    // authorize second-version confirmation and make old media discoverable.
    return [...byRun.values()].sort((a,b)=>a.createdAt-b.createdAt||a.runId.localeCompare(b.runId));
  }
  async function recordMedia(runId,productionId,sourceRevision,manifestHash){
    await readMediaIndex(); // Preserve invalid historical data; never overwrite it.
    await mkdir(outputRoot,{recursive:true,mode:0o700});
    await mkdir(mediaRecordsRoot,{recursive:true,mode:0o700});
    const info=await lstat(mediaRecordsRoot);
    if(!info.isDirectory()||info.isSymbolicLink())
      throw Error("Production media records must be stored in an owned directory.");
    const temporary=join(mediaRecordsRoot,"."+randomUUID()+".tmp");
    try{
      if(manifestHash!==undefined&&manifestHash!==null&&
        (typeof manifestHash!=="string"||!/^[a-f0-9]{64}$/u.test(manifestHash)))
        throw Error("The finished video manifest has an invalid content hash.");
      const record={runId,productionId,sourceRevision,createdAt:Date.now(),manifestHash:manifestHash??null};
      await writeFile(temporary,JSON.stringify({version:1,record})+"\n",{flag:"wx",mode:0o600});
      // Hard-link creation is atomic and refuses to overwrite an existing
      // UUID record, unlike rename. A crash leaves only an ignorable temp.
      await link(temporary,join(mediaRecordsRoot,runId+".json"));
    }finally{await rm(temporary,{force:true}).catch(()=>{});}
  }
  async function releaseForRun(runId){
    if(!results.has(runId)){
      const records=await readMediaIndex();
      if(!records.some(item=>item.runId===runId))return null;
    }
    // Never trust a path from persisted JSON; every target is derived from the
    // validated UUID within the application's owned output directory.
    const owned=join(outputRoot,"draft-"+runId),release=join(owned,"release");
    try{
      const [directory,releaseInfo]=await Promise.all([lstat(owned),lstat(release)]);
      return directory.isDirectory()&&!directory.isSymbolicLink()&&
        releaseInfo.isDirectory()&&!releaseInfo.isSymbolicLink()?release:null;
    }catch(error){if(error?.code==="ENOENT")return null;throw error;}
  }
  async function previousProductionRoot(productionId){
    if(!productionId)return null;
    const records=(await readMediaIndex()).filter(item=>item.productionId===productionId);
    for(const {runId} of records.reverse()){
      const owned=join(outputRoot,"draft-"+runId);
      try{
        const [parent,release,manifest]=await Promise.all([
          lstat(owned),lstat(join(owned,"release")),lstat(join(owned,"release","render-manifest.json"))]);
        if(parent.isDirectory()&&!parent.isSymbolicLink()&&release.isDirectory()&&!release.isSymbolicLink()&&
          manifest.isFile()&&!manifest.isSymbolicLink()&&manifest.size>80&&manifest.size<8*1024*1024)
          return owned;
      }catch(error){if(error?.code!=="ENOENT")throw error;}
    }
    return null;
  }
  async function productionAssets(productionId){
    const records=(await readMediaIndex()).filter(item=>item.productionId===productionId);
    const assets=[];
    for(const {runId,sourceRevision,manifestHash} of records){
      const releaseDir=await releaseForRun(runId);
      if(!releaseDir)continue;
      for(const [file,kind] of [["video.mp4","video"],["captions.srt","captions"],
        ["thumbnail-1.png","thumbnail"],["thumbnail-2.png","thumbnail"],
        ["thumbnail-3.png","thumbnail"],["cover-still.png","thumbnail"]]){
        if(!await verifiedReleaseFile(releaseDir,file,manifestHash))continue;
        assets.push({id:kind+"-"+runId+(file==="cover-still.png"||kind!=="thumbnail"?"":"-"+file),kind,platform:"youtube",filename:file,sourceRevision,
          downloadUrl:"/api/contentgen-video/media/"+runId+"/"+file});
      }
    }
    return assets;
  }
  async function versionPolicy(productionId){
    // Immutable release records are written only after a complete export.
    // Even if a historical file is later damaged, it was still a completed
    // version and must not silently waive confirmation for new voice usage.
    const completedVersions=(await readMediaIndex())
      .filter(item=>item.productionId===productionId).length;
    return{requiresConfirmation:completedVersions>0,completedVersions};
  }
  function missingFootageShotIds(coverage){
    if(!Array.isArray(coverage?.scenes)||coverage.scenes.length!==coverage.sceneCount)return undefined;
    const missing=coverage.scenes.filter(scene=>scene?.sourceType!=="stock-video");
    return missing.every(scene=>typeof scene?.shotId==="string"&&scene.shotId.length>0)?
      missing.map(scene=>scene.shotId):undefined;
  }
  async function verifiedSavedSceneCoverage(record,releaseDir){
    const file=join(releaseDir,"qa-report.json");
    let qaExpected=false;
    try{
      const manifest=JSON.parse(await readFile(join(releaseDir,"render-manifest.json"),"utf8"));
      qaExpected=Object.hasOwn(manifest?.artifacts??{},"qaReport");
      if(!qaExpected)return{visualCoverage:null,qaIntegrityFailure:false}; // Pre-evidence historical release.
      const info=await lstat(file);
      if(!info.isFile()||info.isSymbolicLink()||info.size<40||info.size>256_000||
        !await verifiedReleaseFile(releaseDir,"qa-report.json",record.manifestHash))
        return{visualCoverage:null,qaIntegrityFailure:true};
      const coverage=JSON.parse(await readFile(file,"utf8"))?.visualCoverage;
      const counts=coverage?.mediaDeclarationCounts;
      const integer=value=>Number.isSafeInteger(value)&&value>=0&&value<=64;
      const missingShotIds=missingFootageShotIds(coverage);
      if(!integer(coverage?.sceneCount)||coverage.sceneCount===0||
        !integer(coverage.reviewStillCount)||coverage.reviewStillCount<coverage.sceneCount||
        !integer(counts?.stockVideo)||!integer(counts?.stockPhoto)||!integer(counts?.kumikiOnly)||
        counts.stockVideo+counts.stockPhoto+counts.kumikiOnly!==coverage.sceneCount||
        !Array.isArray(coverage.scenesWithoutStockVideo)||
        coverage.scenesWithoutStockVideo.length!==counts.stockPhoto+counts.kumikiOnly||
        coverage.scenesWithoutStockVideo.some(id=>typeof id!=="string"||id.length>160)||
        !Array.isArray(coverage.scenes)||coverage.scenes.length!==coverage.sceneCount||
        coverage.scenes.some((scene,index)=>typeof scene?.id!=="string"||scene.id.length>160||
          !["stock-video","stock-photo","kumiki"].includes(scene.sourceType)||
          (scene.shotId!==undefined&&(typeof scene.shotId!=="string"||!scene.shotId||
            scene.shotId.length>160||/[\u0000-\u001f]/u.test(scene.shotId)))||
          (scene.sourceType!=="stock-video")!==coverage.scenesWithoutStockVideo.includes(scene.id)||
          coverage.scenes.findIndex(other=>other.id===scene.id)!==index||
          (scene.shotId!==undefined&&coverage.scenes.findIndex(other=>other.shotId===scene.shotId)!==index))||
        counts.stockVideo!==coverage.scenes.filter(scene=>scene.sourceType==="stock-video").length||
        counts.stockPhoto!==coverage.scenes.filter(scene=>scene.sourceType==="stock-photo").length)
        return{visualCoverage:null,qaIntegrityFailure:true};
      return{visualCoverage:{sceneCount:coverage.sceneCount,reviewStillCount:coverage.reviewStillCount,
        mediaDeclarationCounts:{stockVideo:counts.stockVideo,stockPhoto:counts.stockPhoto,kumikiOnly:counts.kumikiOnly},
        scenesWithoutStockVideo:coverage.scenesWithoutStockVideo,
        ...(missingShotIds?{missingStockVideoShotIds:missingShotIds}:{})},qaIntegrityFailure:false};
    }catch{return{visualCoverage:null,qaIntegrityFailure:qaExpected};}
  }
  async function savedReleaseForProduction(productionId,sourceRevision){
    const records=(await readMediaIndex()).filter(item=>item.productionId===productionId&&
      item.sourceRevision===sourceRevision);
    let integrityFailure=false;
    for(const record of records.reverse()){
      const base=join(outputRoot,"draft-"+record.runId);
      try{
        const [owned,release,video]=await Promise.all([
          lstat(base),lstat(join(base,"release")),lstat(join(base,"release","video.mp4"))]);
        if(owned.isDirectory()&&!owned.isSymbolicLink()&&release.isDirectory()&&
          !release.isSymbolicLink()&&video.isFile()&&!video.isSymbolicLink()&&video.size>0){
          if(await verifiedReleaseFile(join(base,"release"),"video.mp4",record.manifestHash))
            return{...record,...await verifiedSavedSceneCoverage(record,join(base,"release"))};
          if(record.manifestHash)integrityFailure=true;
        }
      }catch(error){if(error?.code!=="ENOENT")throw error;}
    }
    return integrityFailure?{integrityFailure:true}:null;
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
          scene.candidates.some(candidate=>!(["pexels","polyhaven","openverse"].includes(candidate?.provider))||
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
  async function resolvedVoiceSettings(input,remember=()=>{}){
    const settings=validateSettings(input);
    if(settings.provider!=="fish")return settings;
    // Never require the browser to read a Keychain secret. Inline keys from
    // older Studio sessions remain usable only for their current request.
    const key=await providerKey("fish",{env})||settings.apiKey||"";
    if(!key)throw Error("Fish Audio API key is missing. Save it in Settings → Connections, then retry.");
    remember(key);
    if(settings.apiKey)remember(settings.apiKey);
    return {...settings,apiKey:key};
  }
  const newJobTracker=deps.jobTracker??(()=>createProductionJobTracker());
  let busy=false,checked=null,controller=null,lastOutput=null,preview=null;
  let activeJobTracker=null,retryTimer=null,retryPresentation=null;
  let sample=null,sampleController=null;
  let sampleStatus={state:"idle",message:"No voice sample generated.",audioUrl:null};
  let sceneClipController=null;
  let sceneClip={state:"idle",id:null,shotId:null,message:"Select a scene to render a short video preview.",videoUrl:null};
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
    const secrets=[];
    const remember=key=>{if(typeof key==="string"&&key.length>=8)secrets.push(key);};
    const redact=value=>secrets.reduce((message,secret)=>message.replaceAll(secret,"[redacted]"),String(value));
    try{
      if(req.method==="GET"&&(route==="/demo"||route==="/demo-conversation")){
        const dossier=JSON.parse(readFileSync(new URL("../../../examples/preproduction-research-smoke.json",import.meta.url),"utf8"));
        const plan=JSON.parse(readFileSync(new URL("../../../examples/preproduction-plan-smoke.json",import.meta.url),"utf8"));
        const source=compilePreproductionBundle(dossier,plan);
        const bundle=route==="/demo-conversation"?createConversationNarrationTemplate(dossier,source):source;
        respond(res,200,{dossier,bundle,
          note:"Synthetic example only. No factual claims are verified. Character voice IDs in the conversation demo are starter placeholders and must be reviewed."});return;
      }
      if(req.method==="GET"&&route==="/status"){respond(res,200,retryPresentation??status);return;}
      if(req.method==="GET"&&route.startsWith("/version-policy/")){
        const productionId=route.slice("/version-policy/".length);
        if(!/^production-[a-f0-9]{24}$/u.test(productionId)){
          respond(res,404,{error:"Unknown production."});return;
        }
        respond(res,200,await versionPolicy(productionId));return;
      }
      if(req.method==="GET"&&route.startsWith("/status/")){
        const productionId=route.slice("/status/".length);
        if(!/^production-[a-f0-9]{24}$/u.test(productionId)){
          respond(res,404,{error:"Unknown production."});return;
        }
        const params=new URL(req.url,"http://localhost").searchParams;
        const sourceRevision=params.get("sourceRevision");
        if(sourceRevision!==null&&(sourceRevision.length>300||/[\u0000-\u001f]/u.test(sourceRevision))){
          respond(res,422,{error:"Invalid source revision."});return;
        }
        if(retryPresentation?.productionId===productionId&&retryPresentation.sourceRevision===sourceRevision){
          respond(res,200,retryPresentation);return;
        }
        if(status.productionId===productionId&&status.sourceRevision===sourceRevision&&
          status.state!=="idle"){
          respond(res,200,status);return;
        }
        const saved=await savedReleaseForProduction(productionId,sourceRevision);
        if(saved?.integrityFailure){
          respond(res,200,{state:"failed",phase:"review",progress:null,report:null,mediaUrl:null,
            regeneration:null,message:"The saved video no longer matches its verified export. Generate the draft again; usable scenes and assets will be checked for reuse."});return;
        }
        if(saved){
          respond(res,200,{state:"done",phase:"review",
            message:saved.qaIntegrityFailure?
              "Saved MP4 is playable, but the QA report is missing or changed. Generate an updated draft to restore verifiable scene evidence; do not publish this version.":
              "Your saved draft is ready to review. Reopen it or export the publishing assets.",
            progress:null,report:null,visualCoverage:saved.visualCoverage,runId:saved.runId,mediaUrl:
              `/api/contentgen-video/media/${saved.runId}/video.mp4`,regeneration:null});return;
        }
        // The Rust DAG is authoritative for interrupted work. This endpoint
        // never reclaims a live attempt, calls a provider, or stores credentials.
        let persisted=null;
        try{persisted=await latestProductionJob(productionId);}catch{/* Jobs may still be starting. */}
        const scenePlan=persisted?.nodes?.find(node=>node.nodeKey==="scene-plan");
        if(persisted?.job?.jobKind!=="video-production"||
          scenePlan?.input?.sourceRevision!==sourceRevision){
          respond(res,200,{...status,state:"idle"});return;
        }
        const state=persisted.job.state;
        const liveClaim=persisted.nodes?.some(node=>node.state==="RUNNING")===true;
        const interrupted=persisted.nodes?.some(node=>node.state==="READY"&&
          ["worker_lease_expired","orphaned_after_restart"].includes(node.errorCode))===true;
        // A RUNNING *job* is not evidence of a RUNNING *worker*: ordinary
        // failed attempts can leave their node READY for explicit retry.
        const waitingForRecovery=state==="RUNNING"&&(liveClaim||interrupted);
        const recovery=state==="CANCELLED"?{
          state:"cancelled",message:"The previous draft was cancelled. Generate a new draft to continue."}:
          state==="SUCCEEDED"?{
            state:"failed",message:"The last draft finished, but its saved video could not be found. Check your local output folder in Jobs."}:
          waitingForRecovery?{
            state:"rendering",message:"A previous draft is tracked in Jobs and recovering after interruption. Check Jobs for the current stage."}:
          {state:"failed",message:persistedFailure(persisted).message};
        respond(res,200,{...recovery,phase:waitingForRecovery?"recovering":"production",progress:null,report:null,
          jobId:persisted.job.id,mediaUrl:null,regeneration:null});return;
      }
      if(req.method==="GET"&&route==="/narration-sample/status"){
        respond(res,200,sampleStatus);return;
      }
      if(req.method==="GET"&&route==="/scene-clip/status"){
        respond(res,200,sceneClip);return;
      }
      if(req.method==="GET"&&route.startsWith("/scene-clip/media/")){
        const id=/^\/scene-clip\/media\/([a-f0-9-]+)\/video\.mp4$/u.exec(route)?.[1];
        if(!id||!runIdPattern.test(id)||sceneClip.id!==id||sceneClip.state!=="done"){
          respond(res,404,{error:"Scene preview is no longer available."});return;
        }
        const folder=join(outputRoot,"scene-preview-"+id),file=join(folder,"video.mp4");
        const [directory,info]=await Promise.all([lstat(folder),lstat(file)]);
        if(!directory.isDirectory()||directory.isSymbolicLink()||
          !info.isFile()||info.isSymbolicLink()||info.size!==sceneClip.sizeBytes){
          respond(res,404,{error:"Scene preview did not pass its media checks."});return;
        }
        await deliverSceneVideo(req,res,file,sceneClip.sha256,sceneClip.sizeBytes,mediaDigests);return;
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
        const match=/^\/media\/([a-f0-9-]+)\/(video\.mp4|captions\.srt|qa-report\.json|cover-still\.png|thumbnail-[123]\.png|thumbnail-[123]\.svg)$/u.exec(route);
        if(!match||!runIdPattern.test(match[1])){respond(res,404,{error:"Media is unavailable."});return;}
        const releaseDir=await releaseForRun(match[1]);
        if(!releaseDir){respond(res,404,{error:"Media is unavailable."});return;}
        const record=(await readMediaIndex()).find(item=>item.runId===match[1]);
        if(match[2] in releasedArtifactKeys&&
          !await verifiedReleaseFile(releaseDir,match[2],record?.manifestHash)){
          respond(res,404,{error:"Media is missing or did not pass the saved export integrity check."});return;
        }
        if(match[2]==="video.mp4")await deliverVideo(req,res,releaseDir);
        else {
          const mediaPath=join(releaseDir,match[2]);
          const info=await lstat(mediaPath);
          if(!info.isFile()||info.isSymbolicLink()||info.size===0){
            respond(res,404,{error:"Media is unavailable."});return;
          }
          const bytes=await readFile(mediaPath);
          res.writeHead(200,{...headers,"Content-Type":match[2].endsWith(".png")?"image/png":
            match[2].endsWith(".svg")?"image/svg+xml":match[2].endsWith(".json")?"application/json; charset=utf-8":"text/plain; charset=utf-8",
            ...(match[2].endsWith(".svg")||match[2].endsWith(".json")?{"Content-Security-Policy":"default-src 'none'; sandbox"}:{}),
            "Content-Length":bytes.length,"Content-Disposition":`${match[2].endsWith(".json")?"inline":"attachment"}; filename="${match[2]}"`});
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
        if((!busy&&!retryTimer)||!controller){respond(res,409,{error:"No active render."});return;}
        if(retryTimer){clearTimeout(retryTimer);retryTimer=null;}
        controller.abort(Error("Cancelled by editor."));
        if(activeJobTracker){
          try{await activeJobTracker.cancel();}
          catch(error){
            if(!busy)status={...status,state:"failed",message:"Cancellation could not be confirmed. Open Jobs to check the draft."};
            respond(res,503,{error:"Render cancellation requested, but Jobs could not confirm it. "+String(error?.message??"").slice(0,160)});return;}
        }
        if(!busy){status={...status,state:"cancelled",message:"Render cancelled; no completed release published."};
          controller=null;activeJobTracker=null;}
        respond(res,202,{cancelRequested:true});return;
      }
      if(route==="/jobs/retry"){
        const input=await readBody(req);
        if(!input||Object.keys(input).some(key=>key!=="jobId")||
          typeof input.jobId!=="string"||!/^[A-Za-z0-9_-]{1,128}$/u.test(input.jobId))
          throw Error("Choose a valid production job to retry.");
        if(busy||retryTimer){respond(res,409,{error:"A production is already running or preparing to retry. Wait or cancel it before retrying."});return;}
        const persisted=await productionJobById(input.jobId);
        const source=persisted?.nodes?.find(node=>node.nodeKey==="scene-plan")?.input;
        const readyFailure=persisted?.job?.state==="RUNNING"&&persisted.nodes?.some(node=>
          node.state==="READY"&&typeof node.errorCode==="string")&&
          !persisted.nodes?.some(node=>node.state==="RUNNING");
        if(persisted?.job?.id!==input.jobId||persisted.job.jobKind!=="video-production"||
          !(persisted.job.state==="FAILED"||readyFailure)){
          respond(res,409,{error:"This production cannot be retried: it is already running, completed, or has no failed step."});return;
        }
        const intent=(await listRecoveryIntents(outputRoot)).find(item=>item.productionId===source?.productionId&&
          item.revision===source?.revision&&item.sourceRevision===source?.sourceRevision);
        if(!intent){respond(res,409,{error:"The saved production request is unavailable. Open the production editor and generate the draft again."});return;}
        const payload={...intent.request};
        if(payload.sourceRevision===null)delete payload.sourceRevision;
        const preflight=await checkSavedRetry(payload,intent);
        if(preflight.code!==200){
          respond(res,409,{error:typeof preflight.data?.error==="string"?preflight.data.error:
            "Readiness checks could not run. Check the local Studio service and retry."});return;
        }
        if(preflight.data?.report?.ready!==true){
          const findings=Array.isArray(preflight.data?.report?.findings)?preflight.data.report.findings
            .filter(item=>item?.severity==="error"&&typeof item.message==="string")
            .slice(0,12).map(item=>({code:typeof item.code==="string"?item.code.slice(0,80):"readiness_failed",
              message:item.message.slice(0,300)})):[];
          respond(res,409,{error:findings.length?"The draft did not pass readiness checks. Resolve the items below and retry.":
            "The draft did not pass readiness checks, but no details were provided. Open the production editor and run the readiness check.",findings});return;
        }
        if(checked?.identity!==intent.revision){
          const labels={story:"scene plan or render settings",media:"selected scene media or media search settings",
            characters:"character revisions or cast authorization",voice:"voice settings or provider credentials"};
          const changed=intent.identityParts?Object.keys(labels).filter(key=>intent.identityParts[key]!==checked.components[key]).map(key=>labels[key]):[];
          if(intent.identityParts&&!changed.length)changed.push("voice settings or provider credentials");
          respond(res,409,{error:intent.identityParts?
            "The saved draft passed readiness checks, but inputs differ from the original job. Review the listed inputs in the production editor and generate a new draft.":
            "The saved draft passed readiness checks, but its production inputs no longer match the original job. This older job did not record which input changed. Check the scene plan, selected media, character revisions, voice settings and provider credentials in the production editor, then generate a new draft.",changedInputs:changed});return;
        }
        const started=await localAction("/start",{...payload,confirmRender:true,
          confirmUpdatedVersion:intent.request.confirmUpdatedVersion===true},true,input.jobId);
        if(started.code!==202){respond(res,409,{error:typeof started.data?.error==="string"?started.data.error:
          "The production worker could not start the retry. Check Jobs and retry."});return;}
        respond(res,202,{started:true,jobId:started.data.jobId});return;
      }
      if(route==="/scene-clip/cancel"){
        if(!sceneClipController||sceneClip.state!=="rendering"){
          respond(res,409,{error:"No scene preview is rendering."});return;
        }
        sceneClipController.abort(Error("Scene preview cancelled by editor."));
        respond(res,202,{cancelRequested:true});return;
      }
      if(busy){respond(res,409,{error:"Complete or cancel the current operation first."});return;}
      if(route==="/scene-clip/start"){
        const input=await readBody(req);
        if(typeof input.shotId!=="string"||!sceneIdPattern.test(input.shotId))
          throw Error("Choose a valid scene to render.");
        // Validate the exact editorial input before allocating a renderer or
        // returning a successful start response.
        const compiled=compileLive(input.dossier,input.bundle);
        const selected=compiled.shotMap?.find(item=>item.shotId===input.shotId);
        const chapter=compiled.plan?.chapters?.find(item=>item.id===selected?.beatId);
        if(!selected||!chapter)
          throw Error("The selected scene no longer matches this storyboard.");
        if(chapter.endFrame-chapter.startFrame>1800)
          throw Error("This scene exceeds a one-minute preview. Use the complete draft export instead.");
        busy=true;
        const id=randomUUID(),outDir=join(outputRoot,"scene-preview-"+id),abort=new AbortController();
        sceneClipController=abort;
        sceneClip={state:"rendering",id,shotId:input.shotId,
          message:"Preparing a silent video preview of this scene…",videoUrl:null};
        respond(res,202,{started:true,id});
        void(async()=>{
          try{
            await mkdir(outputRoot,{recursive:true,mode:0o700});
            const rootInfo=await lstat(outputRoot);
            if(!rootInfo.isDirectory()||rootInfo.isSymbolicLink())
              throw Error("Scene previews require a real local output folder, not a linked directory.");
            await mkdir(outDir,{mode:0o700});
            await build();
            if(abort.signal.aborted)throw abort.signal.reason;
            const browserExecutable=await browser(env);
            const sceneSignal=AbortSignal.any([abort.signal,AbortSignal.timeout(12*60_000)]);
            const result=await (deps.trackSceneClip??withSceneClipJob)({
              projectId:productionIdPattern.test(input.projectId??"")?
                input.projectId:input.dossier.id,
              shotId:input.shotId,sourceHash:compiled.renderPlanSha256,runId:id,
              signal:sceneSignal},async({signal,jobId})=>{
              sceneClip={...sceneClip,jobId};
              return (deps.renderSceneClip??renderSelectedSceneClip)({
                dossier:input.dossier,bundle:input.bundle,shotId:input.shotId,outDir,
                browserExecutable,signal,onProgress:event=>{
                  if(!abort.signal.aborted&&typeof event.message==="string")
                    sceneClip={...sceneClip,message:event.message.slice(0,180)};
                }});
            });
            if(abort.signal.aborted)throw abort.signal.reason;
            if(result.shotId!==input.shotId||!/^[a-f0-9]{64}$/u.test(result.sha256??"")||
              !Number.isSafeInteger(result.sizeBytes)||result.sizeBytes<100||result.sizeBytes>256*1024*1024)
              throw Error("The selected scene did not produce a verified video preview.");
            const previewPath=join(outDir,"video.mp4"),info=await lstat(previewPath);
            if(!info.isFile()||info.isSymbolicLink()||info.size!==result.sizeBytes)
              throw Error("Scene preview output is missing or was replaced.");
            const checksum=createHash("sha256");
            for await(const part of createReadStream(previewPath))checksum.update(part);
            if(checksum.digest("hex")!==result.sha256)
              throw Error("Scene preview output did not pass its integrity check.");
            sceneClip={state:"done",id,shotId:input.shotId,
              message:"This scene's silent MP4 is ready. The full draft adds narration and sound.",
              videoUrl:`/api/contentgen-video/scene-clip/media/${id}/video.mp4`,
              sha256:result.sha256,sizeBytes:result.sizeBytes,jobId:result.jobId};
          }catch(error){
            sceneClip={state:abort.signal.aborted?"cancelled":"failed",id,shotId:input.shotId,
              message:abort.signal.aborted?"Scene preview cancelled. Other scenes were not changed.":
                "Could not render this scene. Check Chromium, FFmpeg and the local build, then retry. "+
                String(error?.message??"").slice(0,130),videoUrl:null};
          }finally{busy=false;sceneClipController=null;}
        })();
        return;
      }
      if(route==="/narration-sample"){
        const input=await readBody(req),settings=await resolvedVoiceSettings(input.settings,remember);
        const compiled=compile(input.dossier,input.bundle,{platform:"youtube"});
        const job=configureRenderJob(compiled.job,settings);
        if(!job.beats?.length)throw Error("Add a narrated scene before auditioning a voice.");
        if(input.sceneShotId!==undefined&&
          (typeof input.sceneShotId!=="string"||!sceneIdPattern.test(input.sceneShotId)))
          throw Error("Choose a valid storyboard scene to preview its narration.");
        const scene=input.sceneShotId===undefined?undefined:
          compiled.shotMap.find(item=>item.shotId===input.sceneShotId);
        if(input.sceneShotId!==undefined&&!scene)
          throw Error("The chosen scene is no longer part of this storyboard.");
        const selectedBeat=scene?job.beats.find(item=>item.id===scene.beatId):job.beats[0];
        if(!selectedBeat)throw Error("The chosen scene has no narration to preview.");
        const authorizedVoiceIds=resolveCastVoiceIds(compiled,input.bundle,settings,input.castVoiceConsent,new Set([selectedBeat.id]));
        const firstTurn=selectedBeat.speechTurns?.[0];
        job.beats=[firstTurn?{...selectedBeat,speechTurns:undefined,
          narration:sampleExcerpt(firstTurn.narration),speaker:firstTurn.speaker,pauseAfterMs:0}:
          {...selectedBeat,narration:sampleExcerpt(selectedBeat.narration)}];
        const id=randomUUID(),abort=new AbortController();
        sampleController=abort;busy=true;
        sampleStatus={state:"generating",message:scene?
          "Synthesizing a short voice sample for the selected scene…":
          "Synthesizing a short, first-scene voice sample…",audioUrl:null};
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
              authorizedVoiceIds,
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
            const detail=[settings.apiKey,input.settings?.apiKey,settings.voiceId,job.beats[0].narration]
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
        const autoPrepareFreeMedia=autoMediaChoice(input)&&searchFreeMedia;
        if(input.productionId!==undefined&&!productionIdPattern.test(input.productionId))
          throw Error("Invalid production identity.");
        if(input.sourceRevision!==undefined&&(typeof input.sourceRevision!=="string"||input.sourceRevision.length>300||/[\u0000-\u001f]/u.test(input.sourceRevision)))
          throw Error("Invalid source revision.");
        const compiled=compile(input.dossier,input.bundle,{platform:"youtube"});
        const settings=await resolvedVoiceSettings(input.settings,remember);
        const approvedSfx=await bindSfx(compiled,input),job=configureRenderJob(approvedSfx.job,settings);
        const authorizedVoiceIds=resolveCastVoiceIds(compiled,input.bundle,settings,input.castVoiceConsent);
        const sceneMedia=await sceneMediaIdentity(compiled,input.dossier,input.bundle);
        const characterRigPacks=await characterRigSelection(input,job,compiled.shotMap);
        const identityInput={characterRigs:characterRigPacks.identity,source:compiled.sourcePlanSha256,job,productionId:input.productionId??null,sourceRevision:input.sourceRevision??null,searchFreeMedia,autoPrepareFreeMedia,authorizedVoiceIds,castVoiceConsent:input.castVoiceConsent===true,sceneMediaFingerprint:sceneMedia.identityFingerprint,settings:{
          ...settings,apiKeyHash:settings.apiKey?sha(settings.apiKey):"",apiKey:undefined}};
        const identity=sha(identityInput),components=identityParts(identityInput);
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
          const inspected=await inspect(job,options);
          // Provider diagnostics are untrusted and may embed the submitted key.
          const report=JSON.parse(JSON.stringify(inspected,(_field,value)=>
            typeof value==="string"?redact(value):value));
          checked=report.ready?{identity,components}:null;
          status={...status,state:report.ready?"ready":"blocked",phase:"preflight",
            message:report.ready?"Ready to render an unverified test draft.":"Resolve the readiness findings below.",report};
          respond(res,200,{ready:report.ready,report,warnings:compiled.warnings,
            sfxSummary:approvedSfx.sfxSummary,characterRigs:characterRigPacks.identity});
        }finally{busy=false;}
        return;
      }
      if(route==="/start"){
        const input=await readBody(req);
        const searchFreeMedia=mediaSearchChoice(input)&&Boolean(input.productionId);
        const autoPrepareFreeMedia=autoMediaChoice(input)&&searchFreeMedia;
        if(input.productionId!==undefined&&!productionIdPattern.test(input.productionId))
          throw Error("Invalid production identity.");
        if(input.sourceRevision!==undefined&&(typeof input.sourceRevision!=="string"||input.sourceRevision.length>300||/[\u0000-\u001f]/u.test(input.sourceRevision)))
          throw Error("Invalid source revision.");
        const compiled=compile(input.dossier,input.bundle,{platform:"youtube"});
        const settings=await resolvedVoiceSettings(input.settings,remember);
        const approvedSfx=await bindSfx(compiled,input),job=configureRenderJob(approvedSfx.job,settings);
        const authorizedVoiceIds=resolveCastVoiceIds(compiled,input.bundle,settings,input.castVoiceConsent);
        const sceneMedia=await sceneMediaIdentity(compiled,input.dossier,input.bundle);
        const characterRigPacks=await characterRigSelection(input,job,compiled.shotMap);
        const identityInput={characterRigs:characterRigPacks.identity,source:compiled.sourcePlanSha256,job,productionId:input.productionId??null,sourceRevision:input.sourceRevision??null,searchFreeMedia,autoPrepareFreeMedia,authorizedVoiceIds,castVoiceConsent:input.castVoiceConsent===true,sceneMediaFingerprint:sceneMedia.identityFingerprint,settings:{
          ...settings,apiKeyHash:settings.apiKey?sha(settings.apiKey):"",apiKey:undefined}};
        const identity=sha(identityInput),components=identityParts(identityInput);
        if(busy){respond(res,409,{error:"Complete or cancel the current operation first."});return;}
        if(input.confirmRender!==true||checked?.identity!==identity||status.state!=="ready"){
          respond(res,409,{error:"Check readiness with the exact current settings before rendering."});return;
        }
        // Reserve the local slot before reading the release index: otherwise
        // concurrent Start requests can both pass the initial busy check.
        busy=true;
        let requiresConfirmation=false;
        try{requiresConfirmation=Boolean(input.productionId&&
          (await versionPolicy(input.productionId)).requiresConfirmation);}
        catch(error){busy=false;throw error;}
        if(requiresConfirmation&&input.confirmUpdatedVersion!==true){
          busy=false;
          respond(res,409,{error:"Confirm generation of the updated video version before rendering."});return;
        }
        // Reserve the local slot before the first asynchronous Jobs request.
        // Otherwise two rapid clicks can both create/claim a persistent run.
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
          if(input.productionId){
            // Persist the exact, nonsecret authorized intent before claiming
            // Jobs or launching any provider/media work.
            await writeRecoveryIntent(outputRoot,runId,{productionId:input.productionId,
              sourceRevision:input.sourceRevision??null,revision:identity,identityParts:components,
              autoRecover:req.__contentgenRecovery!==true||req.__contentgenRetry===true,
              request:{...input,sourceRevision:input.sourceRevision??null}});
          }
          if(tracker){
            trackedJobId=await tracker.start({productionId:input.productionId,
              revision:identity,runId,sourceRevision:input.sourceRevision??null,
              workerAbortController:abort,expectedJobId:req.__contentgenExpectedJobId});
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
        // A broken optional cache index must never strand a claimed job.
        const previousReleaseRoot=await previousProductionRoot(input.productionId).catch(()=>null);
        checked=null;
        status={state:"rendering",phase:"starting",message:"Producing the local draft…",
          progress:null,report:status.report,runId,jobId:trackedJobId,
          productionId:input.productionId??null,sourceRevision:input.sourceRevision??null,
          mediaUrl:null,regeneration:null};
        respond(res,202,{started:true,runId,jobId:trackedJobId});
        void (async()=>{
          let journal=Promise.resolve(),journalError=null,retryQueued=false;
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
              authorizedVoiceIds,
              apiKey:settings.apiKey||env.FISH_AUDIO_API_KEY,
              budgetUsd:0,allowTestAssets:true,browserExecutable:executable,signal:abort.signal,
              autoPrepareFreeMedia,
              ...(tracker?{sceneJobs:tracker}:{}),
              sceneAssetProjectId:input.dossier.id,sceneShotMap:compiled.shotMap,
              sceneAssetBundle:input.bundle,
              expectedSceneMediaFingerprint:sceneMedia.fingerprint,
              characterRigPacks,
              ...(reuseSpeechCacheFrom?{reuseSpeechCacheFrom,
                reuseRenderSegmentsFrom:reuseSpeechCacheFrom}:{}),
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
                    providers:["openverse"],allowExternalSearch:true},
                  {signal:searchSignal});
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
              ...(previousReleaseRoot||!input.productionId&&lastOutput?{
                reuseFrom:previousReleaseRoot??lastOutput,reuseFromOptional:!!input.productionId}:{}),onProgress:event=>{
                progress(event);
                if(tracker)journal=journal.then(()=>tracker.advance(event.phase,
                  event.artifactLedger||event.timingAdjustments||event.phase==="asset-preparation"&&event.assetSearchSummary?
                    {...(event.phase==="asset-preparation"&&event.assetSearchSummary?{assetSearch:event.assetSearchSummary}:{}),
                      ...(event.artifactLedger?{artifactLedger:event.artifactLedger}:{}),
                      ...(event.timingAdjustments?{timingAdjustments:event.timingAdjustments}:{})}:undefined)).catch(error=>{
                  journalError=error;
                  abort.abort(error);
                });
                // A stage must be durably claimed before narration, downloads,
                // browser capture, or FFmpeg performs the corresponding work.
                // Frame-level progress may remain fire-and-forget; each stage
                // boundary is awaited by the producer.
                const checkpoint=journal.then(()=>{if(journalError)throw journalError;});
                // Older renderer adapters and per-frame progress do not await
                // diagnostic callbacks. Do not leak an unhandled rejection in
                // that case; the stage-boundary producer still observes it.
                void checkpoint.catch(()=>{});
                return checkpoint;
              }
            });
            await journal;
            if(journalError)throw journalError;
            if(abort.signal.aborted)throw Error("Cancelled by editor.");
            let mediaWarning="",qaIntegrityFailed=false;
            try{
              if(typeof result.releaseDir!=="string"||resolve(result.releaseDir)!==resolve(join(out,"release")))
                throw Error("The renderer returned a release directory outside this production.");
              const [runInfo,releaseInfo]=await Promise.all([lstat(out),lstat(result.releaseDir)]);
              if(!runInfo.isDirectory()||runInfo.isSymbolicLink()||
                !releaseInfo.isDirectory()||releaseInfo.isSymbolicLink())
                throw Error("The renderer release directory is not an owned directory.");
              if(result.manifestHash){
                for(const file of ["video.mp4","captions.srt","qa-report.json","cover-still.png",
                  "thumbnail-1.png","thumbnail-2.png","thumbnail-3.png"]){
                  if(!await verifiedReleaseFile(result.releaseDir,file,result.manifestHash))
                    throw Error("The exported "+file+" no longer matches its verified manifest.");
                }
              }
              await recordMedia(runId,input.productionId??null,input.sourceRevision??null,result.manifestHash);
            }
            catch(error){qaIntegrityFailed=String(error?.message??"")==="The exported qa-report.json no longer matches its verified manifest.";
              mediaWarning=" Export integrity or media registration failed; keep your local release folder. "+
              String(error?.message??"Index error").slice(0,140);}
            // Publish the recoverable release pointer before committing the
            // durable Jobs success. A process exit between these two writes
            // must not produce a SUCCEEDED job whose media cannot be found.
            if(tracker&&mediaWarning)throw Error(qaIntegrityFailed?"QA_REPORT_INTEGRITY_FAILED":"Could not persist the media index before completing Jobs.");
            if(tracker)await tracker.complete(result.manifestHash&&result.artifactHashes?.video?
              {artifactLedger:{kind:"export-package",manifestHash:result.manifestHash,
                artifacts:{video:result.artifactHashes.video,
                  ...(result.artifactHashes.captions?{captions:result.artifactHashes.captions}:{}),
                  ...(result.artifactHashes.coverStill?{coverStill:result.artifactHashes.coverStill}:{})}}}:undefined);
            results.set(runId,result.releaseDir);
            if(results.size>5)results.delete(results.keys().next().value);
            lastOutput=out;
            status={...status,state:"done",phase:"review",
              message:"Draft MP4 rendered. Watch/listen and review claims and rights."+
                (assetSearchSummary?.reused?` Reused ${assetSearchSummary.candidates} saved media suggestions.`:
                  assetSearchSummary?.candidates?` ${assetSearchSummary.candidates} media suggestions saved for scene review.`:"")+
                (assetSearchSummary?.status==="fallback"?" Optional media search unavailable; use scene search to retry.":"")+mediaWarning,
              mediaUrl:"/api/contentgen-video/media/"+runId+"/video.mp4",
              visualCoverage:result.qa?.visualCoverage?{
                sceneCount:result.qa.visualCoverage.sceneCount,
                reviewStillCount:result.qa.visualCoverage.reviewStillCount,
                mediaDeclarationCounts:result.qa.visualCoverage.mediaDeclarationCounts,
                scenesWithoutStockVideo:result.qa.visualCoverage.scenesWithoutStockVideo,
                missingStockVideoShotIds:missingFootageShotIds(result.qa.visualCoverage)}:null,
              regeneration:result.regeneration??null};
          }catch(error){
            await journal;
            // Journal failures also abort the renderer, but they are not user
            // cancellations. Try to persist a terminal failure if Jobs came
            // back before returning control to the editor.
            // A deliberate cancellation can race a pending Jobs transition.
            // The scheduler may then reject that transition because the job
            // is already CANCELLED; that is not a new renderer failure.
            const cancelled=abort.signal.aborted&&
              abort.signal.reason?.message==="Cancelled by editor.";
            const leaseLost=abort.signal.reason?.message?.startsWith("This worker lost its Jobs claim.");
            const failure=leaseLost?{code:"jobs_lease_lost",
              message:"Video generation was interrupted. Retry the draft; completed media will be checked and reused."}:
              journalError?{code:"jobs_unavailable",
              message:"Jobs tracking stopped responding. Restart the local Rust server, then retry the draft."}:
              renderFailure(status.phase,error,{shotMap:compiled.shotMap,job});
            if(tracker&&!cancelled){
              try{const failed=await tracker.fail(failure.code,failure.message);
                retryQueued=failed?.job?.state==="RUNNING"&&failed.nodes?.some(node=>node.state==="READY"&&node.errorCode===failure.code);}
              catch(journalFailure){status={...status,message:"Jobs failed to record the renderer error: "+String(journalFailure?.message??"unknown")};}
            }
            status={...status,state:cancelled?"cancelled":retryQueued?"rendering":"failed",phase:"production",
              message:cancelled?"Render cancelled; no completed release published.":
                failure.message+(retryQueued?" Retrying the failed step automatically.":"")};
          }finally{busy=false;
            if(retryQueued){
              retryTimer=setTimeout(()=>{retryTimer=null;controller=null;activeJobTracker=null;
                void recover().then(started=>{if(!started&&status.state==="rendering")status={...status,state:"failed",
                  message:"Automatic retry could not start. Open Jobs and retry the draft."};});},1000);
              retryTimer.unref?.();
            }else{controller=null;activeJobTracker=null;}}
        })();
        return;
      }
      respond(res,404,{error:"Unknown production action."});
    }catch(error){
      if(route==="/check"){checked=null;status={...status,state:"failed",phase:"preflight",
        message:"Readiness failed. Check Chrome, FFmpeg and pnpm."};busy=false;}
      respond(res,422,{error:redact(error?.message||"Production request failed").slice(0,280)});
    }
  }
  async function localAction(route,payload,retry=false,expectedJobId){
    // Drive the same validated check/start paths as a browser click. This
    // private request marker is never accepted from network-supplied headers.
    const req=Readable.from([Buffer.from(JSON.stringify(payload))]);
    Object.assign(req,{method:"POST",url:route,__contentgenRecovery:true,__contentgenRetry:retry,__contentgenExpectedJobId:expectedJobId,headers:{
      host:"127.0.0.1:5173",origin:"http://127.0.0.1:5173",
      "x-contentgen-director":"local-only"}});
    let code=0,body="";
    const res={writeHead(statusCode){code=statusCode;},end(data){body+=String(data??"");},destroy(){}};
    await handle(req,res);
    let data;
    try{data=JSON.parse(body);}catch{data={error:"Recovery response was unreadable."};}
    return{code,data};
  }
  // Earlier snapshots reordered these settings while saving them. Try the
  // original Studio field order only for such snapshots, and accept it only
  // if the complete production identity matches the persisted job exactly.
  async function checkSavedRetry(payload,intent){
    let result=await localAction("/check",payload);
    if(!intent.identityParts&&result.code===200&&result.data?.report?.ready===true&&checked?.identity!==intent.revision){
      const saved=payload.settings;
      const keys=["provider","voiceId","providerRevision","modelId","endpoint","voiceConsent","transmitText","localVoiceAuthorized"];
      const reordered=Object.fromEntries(keys.filter(key=>Object.hasOwn(saved,key)).map(key=>[key,saved[key]]));
      if(JSON.stringify(saved)!==JSON.stringify(reordered)){
        const alternate={...payload,settings:reordered};
        const checkedAlternate=await localAction("/check",alternate);
        if(checkedAlternate.code===200&&checkedAlternate.data?.report?.ready===true&&checked?.identity===intent.revision){
          payload.settings=reordered;
          return checkedAlternate;
        }
        result=checkedAlternate;
      }
    }
    return result;
  }
  async function recoverEligible(){
    if(busy)return 0;
    let intents;
    try{intents=await listRecoveryIntents(outputRoot);}
    catch{status={...status,state:"failed",phase:"recovery",
      message:"Stored draft recovery information is unavailable. Inspect the output folder and Jobs."};return 0;}
    const seen=new Set();
    for(const intent of intents){
      const key=intent.productionId+":"+intent.revision;
      if(seen.has(key))continue;
      seen.add(key); // Never restart an older attempt over its continuation.
      if(!intent.autoRecover)continue;
      let persisted;
      try{persisted=await latestProductionJob(intent.productionId);}
      catch{continue;} // Rust might still be starting; the startup loop retries.
      const source=persisted?.nodes?.find(node=>node.nodeKey==="scene-plan")?.input;
      // Historical attempts can include an earlier lease loss followed by a
      // genuinely failed manual retry. Only the *current* recoverable node
      // authorizes unattended replay; attempt history is not a replay token.
      const retryReady=persisted?.job?.state==="RUNNING"&&persisted?.nodes?.some(node=>
        node.state==="READY"&&node.errorCode&&!["worker_lease_expired","orphaned_after_restart"].includes(node.errorCode)&&persisted.attempts?.some(attempt=>
          attempt.nodeId===node.id&&attempt.state==="FAILED"&&attempt.errorCode===node.errorCode));
      const interrupted=persisted?.nodes?.some(node=>
        ["READY","FAILED"].includes(node.state)&&
        ["worker_lease_expired","orphaned_after_restart"].includes(node.errorCode));
      if(persisted?.job?.jobKind!=="video-production"||
        source?.sourceRevision!==intent.sourceRevision||source?.revision!==intent.revision||
        !(interrupted||retryReady)||
        ["SUCCEEDED","CANCELLED"].includes(persisted.job.state)||
        persisted.job.state==="RUNNING"&&persisted.nodes?.some(node=>node.state==="RUNNING"))
        continue;
      const settings=intent.request.settings;
      if(settings.provider==="fish"){
        let key="";
        try{key=await providerKey("fish",{env});}catch{/* Missing Keychain is actionable. */}
        if(!key||settings.voiceConsent!==true||settings.transmitText!==true){
          status={state:"failed",phase:"recovery",productionId:intent.productionId,
            sourceRevision:intent.sourceRevision,jobId:persisted.job.id,progress:null,report:null,
            message:"Fish Audio API key or script/voice authorization is missing. Save the key in Settings → Connections, then retry the draft."};
          continue;
        }
      }else if(settings.localVoiceAuthorized!==true){
        status={state:"failed",phase:"recovery",productionId:intent.productionId,
          sourceRevision:intent.sourceRevision,jobId:persisted.job.id,progress:null,report:null,
          message:"Local voice authorization is missing. Reauthorize the narrator and retry the draft."};
        continue;
      }
      const payload={...intent.request};
      if(payload.sourceRevision===null)delete payload.sourceRevision;
      retryPresentation={...status,state:"rendering",phase:"retrying",productionId:intent.productionId,
        sourceRevision:intent.sourceRevision,jobId:persisted.job.id,
        message:retryReady?"A production step failed. Checking the draft before retrying automatically.":
          "Checking the interrupted draft before resuming."};
      const preflight=await checkSavedRetry(payload,intent);
      if(preflight.code!==200||preflight.data?.report?.ready!==true||
        checked?.identity!==intent.revision){
        retryPresentation=null;
        status={state:"failed",phase:"recovery",productionId:intent.productionId,
          sourceRevision:intent.sourceRevision,jobId:persisted.job.id,progress:null,report:null,
          message:preflight.code!==200?"Draft recovery preflight failed. Check voice setup, Chromium and FFmpeg, then retry in Jobs.":
            "Draft recovery input changed or local tools are unavailable. Review the saved scene and retry."};
        continue;
      }
      // A temporary browser/FFmpeg outage has performed no production work;
      // do not spend the one automatic replay on a failed readiness check.
      // Once ready, reserve atomically *before* the Jobs/producer claim.
      if(!await reserveRecoveryAttempt(outputRoot,intent.runId)){retryPresentation=null;continue;}
      const started=await localAction("/start",{...payload,confirmRender:true,
        confirmUpdatedVersion:intent.request.confirmUpdatedVersion===true},!!retryReady);
      retryPresentation=null;
      if(started.code!==202){
        status={state:"failed",phase:"recovery",productionId:intent.productionId,
          sourceRevision:intent.sourceRevision,jobId:persisted.job.id,progress:null,report:null,
          message:"The persisted draft could not reclaim its Jobs attempt. Inspect Jobs and retry safely."};
        continue;
      }
      return 1;
    }
    return 0;
  }
  async function recover(){
    try{return await recoverEligible();}
    catch{
      retryPresentation=null;
      status={...status,state:"failed",phase:"recovery",
        message:"Draft recovery could not read or reserve its saved attempt. Review Jobs and retry the draft."};
      return 0;
    }
  }
  return {handle,status:()=>status,recover};
}
export function directorProductionPlugin(){
  const worker=createDirectorProduction();
  function mountRecovery(server){
    void worker.recover();
    const timer=setInterval(()=>void worker.recover(),30_000);timer.unref?.();
    (server.httpServer??server.previewServer)?.once("close",()=>clearInterval(timer));
  }
  return {name:"contentgen-director-video-production",
    configureServer(server){server.middlewares.use("/api/contentgen-video",(req,res)=>{void worker.handle(req,res);});
      mountRecovery(server);},
    configurePreviewServer(server){server.middlewares.use("/api/contentgen-video",(req,res)=>{void worker.handle(req,res);});
      mountRecovery(server);}
  };
}

