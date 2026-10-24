/** Crash-resumable local Research jobs. Browser connections are not the job lifecycle. */
import {randomBytes,createHash} from "node:crypto";
import {mkdir,readFile,open,rename,stat} from "node:fs/promises";
import {basename,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {validateStudioBrief} from "./studio-research.mjs";
import {loadStudioSearch,validateStudioSearchMatch} from "./studio-search.mjs";
import {captureSavedSources,buildDeterministicDossier} from "./research-job-evidence.mjs";
import {generateOutlineSkeleton,generateOutlineBeat,assembleOutline,generateSceneCore,generateSceneStates,assembleSceneStructure,generateSceneDirection,generateSceneElements,assembleSceneVisual,generateSceneNarration,assembleSceneUnit,assembleResumablePlan} from "./research-job-planner.mjs";
import {validateResearchModelSettings} from "./research-model-settings.mjs";

const DEFAULT_ROOT=fileURLToPath(new URL("../../../../data/studio-research",import.meta.url));
const sha=value=>createHash("sha256").update(value).digest("hex");
const ID=/^job_[a-f0-9]{24}$/u;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const safeName=name=>/^(?:manifest|captures|evidence|outline_\d+|outline_skeleton_\d+|outline_beat_\d+_\d+|scene_\d+_\d+_\d+|structure_\d+_\d+_\d+|structure_(?:core|states)_\d+_\d+_\d+|visual_(?:direction|elements)_\d+_\d+_\d+_[012]|(?:visual|narration)_\d+_\d+_\d+_[012])\.json$/u.test(name);
const safeField=field=>typeof field==="string"&&/^(?:response|pattern|premise|hook|beatCount|question|purpose|payoff|claimIds|beats(?:\[\d\])?(?:\.(?:question|purpose|payoff|claimIds))?|subject|parts(?:\[\d\])?|operator|before|action|after|before\/action\/after|visualAction|learningChange|onScreenText|visualElements|narration|phases(?:\[\d\])?(?:\.(?:visualAction|learningChange|onScreenText|narration|visualElements))?|phases\.(?:visualAction|learningChange))$/u.test(field)?field:null;
const errorInfo=error=>{
  const raw=String(error?.message??error??"Unknown job failure");
  const detailCode=["schema_invalid","json_invalid","output_truncated","output_missing","provider_envelope_invalid"].includes(error?.code)?error.code:null;
  const providerUnavailable=/http (?:429|5\d\d)|fetch failed|ECONN|network/iu.test(raw);
  const code=detailCode?"invalid_output":/memory|out.of.memory|allocat|oom/iu.test(raw)?"model_memory":
    /timeout|timed out|aborted due to timeout/iu.test(raw)?"model_timeout":
    providerUnavailable?"provider_unavailable":
    /storage|ENOSPC|EACCES|EPERM/iu.test(raw)?"storage":
    /json|schema|rejected|invalid|claim|visual|teaching/i.test(raw)?"invalid_output":"stage_failed";
  const providerDetail=code==="provider_unavailable"?
    /http 429/iu.test(raw)?"rate_limited":/http 5\d\d/iu.test(raw)?"http_5xx":
      /ECONNREFUSED/iu.test(raw)?"connection_refused":/ECONNRESET/iu.test(raw)?"connection_reset":"transport_failure":null;
  // Never leak prompts, captured text, request credentials, or network URLs into status/logs.
  const message=({model_memory:"Local model ran out of available memory.",model_timeout:"Local model request timed out.",
    invalid_output:"Local model returned invalid structured data.",storage:"Cannot write local job checkpoints.",
    provider_unavailable:"Local model or network provider is unavailable.",stage_failed:"This job stage failed; review server diagnostics."})[code];
  return {code,message,...(detailCode?{detailCode}:{}),...(providerDetail?{providerDetail}:{}),
    ...(safeField(error?.field)?{field:safeField(error.field)}:{})};
};

async function atomicJson(file,value,limit=512*1024){
  const bytes=JSON.stringify(value);
  if(Buffer.byteLength(bytes)>limit)throw Error("Storage artifact exceeds bounded size.");
  const temp=file+"."+randomBytes(6).toString("hex")+".tmp";
  const handle=await open(temp,"wx",0o600);
  try{await handle.writeFile(bytes);await handle.sync();}
  finally{await handle.close();}
  await rename(temp,file);
}
async function readJson(file,limit=512*1024){
  if((await stat(file)).size>limit)throw Error("Storage artifact exceeds bounded size.");
  return JSON.parse(await readFile(file,"utf8"));
}
async function optionalJson(file,limit){
  try{return await readJson(file,limit);}catch(error){if(error.code==="ENOENT")return null;throw error;}
}
function publicState(job){
  return {jobId:job.id,status:job.status,stage:job.stage,createdAt:job.createdAt,updatedAt:job.updatedAt,
    completedScenes:job.completedScenes??0,totalScenes:job.totalScenes??0,
    ...(job.currentStep?{currentStep:job.currentStep}:{}),
    ...(job.retry?{retry:job.retry}:{}),
    ...(job.error?{error:job.error}:{}),...(job.artifactId?{artifactId:job.artifactId}:{})};
}
async function saveCompleted(root,job,data,plan){
  const {dossier,quotes,captures,warnings}=data;
  const document={schemaVersion:1,kind:"studio-research-snapshot",dossier,captures,plan,quotes,
    provider:"searxng",model:job.models.primary.model,warnings,searchArtifactId:job.searchArtifactId};
  const content=JSON.stringify(document);
  const name=dossier.id+"-"+sha(content).slice(0,12)+".json";
  const file=join(root,name);
  if(Buffer.byteLength(content)>512*1024)throw Error("Research snapshot exceeds 512 KiB limit.");
  try{
    const handle=await open(file,"wx",0o600);
    try{await handle.writeFile(content);await handle.sync();}finally{await handle.close();}
  }catch(error){if(error.code!=="EEXIST"||await readFile(file,"utf8")!==content)throw error;}
  return basename(name,".json");
}

/** Instances allow isolated tests; the real Vite process uses exactly one shared manager. */
export function createResearchJobManager({root=DEFAULT_ROOT,loadSearch=loadStudioSearch,
  capture=captureSavedSources,evidence=buildDeterministicDossier,outline=null,
  outlineSkeleton=generateOutlineSkeleton,outlineBeat=generateOutlineBeat,combineOutline=assembleOutline,
  scene=null,sceneStructure=null,sceneCore=generateSceneCore,sceneStates=generateSceneStates,
  combineStructure=assembleSceneStructure,sceneVisual=null,sceneDirection=generateSceneDirection,
  sceneElements=generateSceneElements,combineVisual=assembleSceneVisual,
  sceneNarration=generateSceneNarration,combineScene=assembleSceneUnit,
  assemble=assembleResumablePlan,persist=saveCompleted,sleep=pause}={}){
  const active=new Map();
  let inferenceTail=Promise.resolve();
  const rootJobs=join(root,"jobs");
  const pathFor=(id,name)=>{
    if(!ID.test(id)||!safeName(name))throw Error("Invalid research job file identifier.");
    return join(rootJobs,id,name);
  };
  const write=async(job,name,data)=>{
    await mkdir(join(rootJobs,job.id),{recursive:true,mode:0o700});
    await atomicJson(pathFor(job.id,name),data,name==="captures.json"?256*1024:512*1024);
  };
  const save=async(job)=>{
    job.updatedAt=new Date().toISOString();await write(job,"manifest.json",job);
  };
  const read=async id=>{
    if(!ID.test(id))throw Error("Invalid job ID.");
    const job=await readJson(pathFor(id,"manifest.json"),32*1024);
    if(job.id!==id||job.version!==1)throw Error("Research job manifest is invalid.");
    return job;
  };
  const stageFile=async(job,name)=>optionalJson(pathFor(job.id,name),name==="captures.json"?256*1024:512*1024);
  const setStage=async(job,stage,currentStep=null)=>{job.status="running";job.stage=stage;
    job.currentStep=currentStep;job.error=null;job.retry=null;await save(job);};
  const guard=signal=>{if(signal.aborted)throw signal.reason??Error("Job cancelled.");};
  const inference=async(action,signal)=>{
    const previous=inferenceTail;
    let release;
    inferenceTail=new Promise(resolve=>{release=resolve;});
    await previous;
    try{guard(signal);return await action();}finally{release();}
  };
  const attempt=async(job,call,signal)=>{
    const models=[job.models.primary,...(job.models.secondary?[job.models.secondary]:[])];
    let last;
    let sawTruncation=false;
    const maxAttempts=3;
    for(let modelIndex=0;modelIndex<models.length;modelIndex++){
      const settings=models[modelIndex];
      // Never use an unauthorized remote endpoint: both settings were locally validated.
      const max=/^(?:localhost|127\.0\.0\.1|\[::1\])$/u;
      if(!max.test(new URL(settings.endpoint).hostname))throw Error("Local model endpoint must use loopback.");
      for(let n=0;n<maxAttempts;n++){
        guard(signal);
        try{
          const failure=last?errorInfo(last):null;
          const compact=sawTruncation?" The previous JSON was cut off at the output limit. Keep all required fields but use shorter text in one complete JSON object.":"";
          const feedback=n>0||sawTruncation?failure?.field&&failure.detailCode==="schema_invalid"?
            `The previous JSON failed validation at ${failure.field}. Correct that field and return the complete JSON without inventing facts.`+compact:
            sawTruncation?compact.trim():
              "Return ONLY a complete JSON object with exactly the required fields and types; correct any malformed fields without inventing facts.":null;
          const result=await inference(()=>call(settings,feedback),signal);
          job.retry=null;
          await save(job);
          return result;
        }
        catch(error){
          if(signal.aborted)throw error;
          last=error;
          const info=errorInfo(error);
          if(info.detailCode==="output_truncated")sawTruncation=true;
          const retryable=["model_timeout","provider_unavailable","invalid_output"].includes(info.code);
          if(retryable&&n<maxAttempts-1){
            job.retry={stage:job.stage,attempt:n+2,maxAttempts,reason:info.code,modelIndex:modelIndex+1,totalModels:models.length,
              ...(info.detailCode?{detailCode:info.detailCode}:{}),...(info.providerDetail?{providerDetail:info.providerDetail}:{}),
              ...(info.field?{field:info.field}:{})};
            await save(job);
            console.warn("[contentgen-research-retry]",JSON.stringify({jobId:job.id,stage:job.stage,
              errorCode:info.code,detailCode:info.detailCode??null,providerDetail:info.providerDetail??null,field:info.field??null,
              nextAttempt:n+2,maxAttempts,modelIndex:modelIndex+1}));
            await sleep(1000*(n+1));
          }else break;
        }
      }
      if(modelIndex<models.length-1){
        job.retry={stage:job.stage,attempt:1,maxAttempts,reason:errorInfo(last).code,
          ...(errorInfo(last).detailCode?{detailCode:errorInfo(last).detailCode}:{}),
          ...(errorInfo(last).providerDetail?{providerDetail:errorInfo(last).providerDetail}:{}),
          ...(errorInfo(last).field?{field:errorInfo(last).field}:{}),
          modelIndex:modelIndex+2,totalModels:models.length};
        await save(job);
        await sleep(2500);
      }
    }
    job.retry=null;
    throw last??Error("No configured local model could complete the job stage.");
  };
  const execute=async(id,controller)=>{
    const signal=controller.signal;
    let job;
    try{
      job=await read(id);
      guard(signal);
      let captures=await stageFile(job,"captures.json");
      if(!captures){
        await setStage(job,"capture");
        const saved=await loadSearch(job.searchArtifactId,{root});
        validateStudioSearchMatch(saved,job.brief);
        captures=await capture(saved,job.brief,{signal});
        guard(signal);await write(job,"captures.json",captures);
      }
      let data=await stageFile(job,"evidence.json");
      if(!data){
        await setStage(job,"evidence");
        data=evidence(job.brief,captures.captures,captures.gaps);
        guard(signal);await write(job,"evidence.json",data);
      }
      let story=await stageFile(job,`outline_${job.generation}.json`);
      if(!story){
        await setStage(job,"outline");
        if(outline){
          // Keep the older injectable full-outline provider for existing integrations.
          story=await attempt(job,(settings,feedback)=>outline(data.dossier,data.quotes,settings,{signal,feedback}),signal);
        }else{
          const outlineStep=async(filename,label,action)=>{
            const saved=await stageFile(job,filename);
            if(saved)return saved;
            await setStage(job,"outline",label);
            const result=await attempt(job,(settings,feedback)=>action(settings,feedback),signal);
            guard(signal);await write(job,filename,result);
            return result;
          };
          const skeleton=await outlineStep(`outline_skeleton_${job.generation}.json`,"skeleton",(settings,feedback)=>
            outlineSkeleton(data.dossier,data.quotes,settings,{signal,feedback}));
          const beats=[];
          for(let index=0;index<skeleton.beatCount;index++){
            const beat=await outlineStep(`outline_beat_${job.generation}_${index}.json`,`beat:${index+1}`,(settings,feedback)=>
              outlineBeat(skeleton,index,beats,data.dossier,data.quotes,settings,{signal,feedback}));
            beats.push(beat);
          }
          story=combineOutline(data.dossier,skeleton,beats);
        }
        guard(signal);await write(job,`outline_${job.generation}.json`,story);
      }
      job.currentStep=null;
      job.totalScenes=story.beats.length;
      job.sceneRevisions??={};
      await save(job);
      const units=[];
      for(let index=0;index<story.beats.length;index++){
        guard(signal);
        const prefix=`${job.generation}_${index}_${job.sceneRevisions[index]??0}`;
        const file=`scene_${prefix}.json`;
        let unit=await stageFile(job,file);
        if(!unit){
          await setStage(job,`scene:${index+1}`);
          if(scene){
            // Preserve the original injectable whole-scene producer for existing integrations/tests.
            unit=await attempt(job,(settings,feedback)=>scene(story,index,data.dossier,data.quotes,settings,{signal,feedback}),signal);
          }else{
            const substep=async(filename,label,action)=>{
              const saved=await stageFile(job,filename);
              if(saved)return saved;
              await setStage(job,`scene:${index+1}`,label);
              const result=await attempt(job,(settings,feedback)=>action(settings,feedback),signal);
              guard(signal);await write(job,filename,result);
              return result;
            };
            let structure=await stageFile(job,`structure_${prefix}.json`);
            if(!structure){
              if(sceneStructure){
                structure=await substep(`structure_${prefix}.json`,"structure",(settings,feedback)=>
                  sceneStructure(story,index,data.dossier,data.quotes,settings,{signal,feedback}));
              }else{
                const core=await substep(`structure_core_${prefix}.json`,"structure:core",(settings,feedback)=>
                  sceneCore(story,index,data.dossier,data.quotes,settings,{signal,feedback}));
                const states=await substep(`structure_states_${prefix}.json`,"structure:states",(settings,feedback)=>
                  sceneStates(story,index,core,data.dossier,data.quotes,settings,{signal,feedback}));
                structure=combineStructure(core,states);
                guard(signal);await write(job,`structure_${prefix}.json`,structure);
              }
            }
            const phases=[];
            for(let phase=0;phase<3;phase++){
              const previous=phases.map(part=>part.visual);
              let visual=await stageFile(job,`visual_${prefix}_${phase}.json`);
              if(!visual){
                if(sceneVisual){
                  visual=await substep(`visual_${prefix}_${phase}.json`,`visual:${phase+1}`,(settings,feedback)=>
                    sceneVisual(story,index,phase,structure,previous,data.dossier,data.quotes,settings,{signal,feedback}));
                }else{
                  const direction=await substep(`visual_direction_${prefix}_${phase}.json`,`visual:${phase+1}:direction`,(settings,feedback)=>
                    sceneDirection(story,index,phase,structure,previous,data.dossier,data.quotes,settings,{signal,feedback}));
                  const elements=await substep(`visual_elements_${prefix}_${phase}.json`,`visual:${phase+1}:elements`,(settings,feedback)=>
                    sceneElements(story,index,phase,structure,direction,data.dossier,data.quotes,settings,{signal,feedback}));
                  visual=combineVisual(direction,elements,previous);
                  guard(signal);await write(job,`visual_${prefix}_${phase}.json`,visual);
                }
              }
              const narration=await substep(`narration_${prefix}_${phase}.json`,`narration:${phase+1}`,(settings,feedback)=>
                sceneNarration(story,index,phase,structure,visual,data.dossier,data.quotes,settings,{signal,feedback}));
              phases.push({visual,narration});
            }
            unit=combineScene(structure,phases);
          }
          guard(signal);await write(job,file,unit);
        }
        units.push(unit);job.completedScenes=index+1;job.currentStep=null;await save(job);
      }
      await setStage(job,"assemble");
      const plan=assemble(data.dossier,story,units);
      guard(signal);
      const artifactId=await persist(root,job,data,plan);
      guard(signal);
      job.artifactId=artifactId;
      job.status="completed";job.stage="completed";job.currentStep=null;job.error=null;await save(job);
    }catch(error){
      if(job){job.status=signal.aborted?"cancelled":"failed";job.retry=null;
        job.error=signal.aborted?null:errorInfo(error);await save(job);
        if(job.error)console.warn("[contentgen-research-job]",JSON.stringify({
          jobId:job.id,stage:job.stage,errorCode:job.error.code,detailCode:job.error.detailCode??null,
          providerDetail:job.error.providerDetail??null,attempt:"stopped",
        }));
      }
    }
  };
  const start=job=>{
    if(active.has(job.id))return;
    const controller=new AbortController();active.set(job.id,controller);
    queueMicrotask(()=>{void execute(job.id,controller).finally(()=>active.delete(job.id));});
  };
  async function create(request,models){
    const {searchArtifactId,...input}=request??{};
    const brief=validateStudioBrief(input);
    if(typeof searchArtifactId!=="string"||!searchArtifactId.startsWith("search_"))throw Error("Choose a saved search before starting a research job.");
    if(!models?.primary)throw Error("Choose an installed local model.");
    const primary=validateResearchModelSettings({...models.primary,version:1});
    const secondary=models.secondary?validateResearchModelSettings({...models.secondary,version:1}):null;
    const saved=await loadSearch(searchArtifactId,{root});
    validateStudioSearchMatch(saved,brief);
    const job={version:1,id:"job_"+randomBytes(12).toString("hex"),brief,searchArtifactId,
      models:{primary,secondary},status:"queued",stage:"queued",generation:0,
      completedScenes:0,totalScenes:0,sceneRevisions:{},currentStep:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
      error:null,retry:null,artifactId:null};
    await save(job);start(job);
    return publicState(job);
  }
  async function get(id){
    let job=await read(id);
    if(["queued","running"].includes(job.status)&&!active.has(id)){
      // The worker may have finished between the disk read and active-map check.
      job=await read(id);
      if(["queued","running"].includes(job.status)&&!active.has(id)){
        job.status="paused";job.error={code:"interrupted",message:"Job was interrupted by a server restart. Resume to continue."};
        await save(job);
      }
    }
    return publicState(job);
  }
  async function resume(id,models){
    const job=await read(id);
    if(active.has(id))return publicState(job);
    if(!["failed","paused","cancelled"].includes(job.status))throw Error("Only stopped jobs can be resumed.");
    if(models?.primary){
      const next={primary:validateResearchModelSettings({...models.primary,version:1}),
        secondary:models.secondary?validateResearchModelSettings({...models.secondary,version:1}):null};
      const identity=group=>JSON.stringify([group.primary.endpoint,group.primary.model,
        group.secondary?.endpoint??null,group.secondary?.model??null]);
      // Generation limits belong to the job snapshot. Editing global defaults must
      // never discard completed checkpoints when resuming the same models.
      if(identity(next)!==identity(job.models)){
        job.models=next;job.generation++;job.sceneRevisions={};job.completedScenes=0;job.totalScenes=0;
      }
    }
    job.status="queued";job.stage="queued";job.currentStep=null;job.error=null;job.retry=null;job.artifactId=null;
    await save(job);start(job);return publicState(job);
  }
  async function cancel(id){
    const job=await read(id);
    if(job.status==="completed")throw Error("Research job already completed; its snapshot cannot be cancelled.");
    active.get(id)?.abort(Error("Job cancelled."));
    job.status="cancelled";job.stage="cancelled";job.currentStep=null;job.error=null;job.retry=null;
    await save(job);return publicState(job);
  }
  async function retryScene(id,sceneId,models){
    const job=await read(id);
    if(active.has(id))throw Error("Pause or cancel the job before retrying a scene.");
    const index=Number(sceneId);
    if(!Number.isInteger(index)||index<0||index>=job.totalScenes)throw Error("Unknown storyboard scene.");
    job.sceneRevisions[index]=(job.sceneRevisions[index]??0)+1;
    job.completedScenes=Math.min(job.completedScenes,index);
    job.status="failed";job.artifactId=null;
    await save(job);return await resume(id,models);
  }
  return {create,get,resume,cancel,retryScene};
}

export const researchJobManager=createResearchJobManager();
