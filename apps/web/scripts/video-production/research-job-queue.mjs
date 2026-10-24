/** Crash-resumable local Research jobs. Browser connections are not the job lifecycle. */
import {randomBytes,createHash} from "node:crypto";
import {mkdir,readFile,open,rename,stat} from "node:fs/promises";
import {basename,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {validateStudioBrief} from "./studio-research.mjs";
import {loadStudioSearch,validateStudioSearchMatch} from "./studio-search.mjs";
import {captureSavedSources,buildDeterministicDossier} from "./research-job-evidence.mjs";
import {generateOutline,generateSceneUnit,assembleResumablePlan} from "./research-job-planner.mjs";
import {validateResearchModelSettings} from "./research-model-settings.mjs";

const DEFAULT_ROOT=fileURLToPath(new URL("../../../../data/studio-research",import.meta.url));
const sha=value=>createHash("sha256").update(value).digest("hex");
const ID=/^job_[a-f0-9]{24}$/u;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const safeName=name=>/^(?:manifest|captures|evidence|outline_\d+|scene_\d+_\d+_\d+)\.json$/u.test(name);
const errorInfo=error=>{
  const raw=String(error?.message??error??"Unknown job failure");
  const code=/memory|out.of.memory|allocat|oom/iu.test(raw)?"model_memory":
    /timeout|timed out|aborted due to timeout/iu.test(raw)?"model_timeout":
    /json|schema|rejected|invalid|claim|visual|teaching/i.test(raw)?"invalid_output":
    /storage|ENOSPC|EACCES|EPERM/iu.test(raw)?"storage":
    /http 429|http 5\d\d|fetch failed|ECONN|network/iu.test(raw)?"provider_unavailable":"stage_failed";
  // Never leak prompts, captured text, request credentials, or network URLs into status/logs.
  const message=({model_memory:"Local model ran out of available memory.",model_timeout:"Local model request timed out.",
    invalid_output:"Local model returned invalid structured data.",storage:"Cannot write local job checkpoints.",
    provider_unavailable:"Local model or network provider is unavailable.",stage_failed:"This job stage failed; review server diagnostics."})[code];
  return {code,message};
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
  capture=captureSavedSources,evidence=buildDeterministicDossier,outline=generateOutline,
  scene=generateSceneUnit,assemble=assembleResumablePlan,persist=saveCompleted,sleep=pause}={}){
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
  const setStage=async(job,stage)=>{job.status="running";job.stage=stage;job.error=null;await save(job);};
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
    for(const settings of models){
      // Never use an unauthorized remote endpoint: both settings were locally validated.
      const max=/^(?:localhost|127\.0\.0\.1|\[::1\])$/u;
      if(!max.test(new URL(settings.endpoint).hostname))throw Error("Local model endpoint must use loopback.");
      for(let n=0;n<2;n++){
        guard(signal);
        try{return await inference(()=>call(settings,n===1?
          "The previous response failed schema or provider validation. Return only the required valid JSON fields.":null),signal);}
        catch(error){
          if(signal.aborted)throw error;
          last=error;
          const info=errorInfo(error);
          if(!["model_timeout","provider_unavailable","invalid_output"].includes(info.code)||n===1)break;
          await sleep(2500);
        }
      }
      if(settings!==models.at(-1))await sleep(2500);
    }
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
        story=await attempt(job,(settings,feedback)=>outline(data.dossier,data.quotes,settings,{signal,feedback}),signal);
        guard(signal);await write(job,`outline_${job.generation}.json`,story);
      }
      job.totalScenes=story.beats.length;
      job.sceneRevisions??={};
      await save(job);
      const units=[];
      for(let index=0;index<story.beats.length;index++){
        guard(signal);
        const file=`scene_${job.generation}_${index}_${job.sceneRevisions[index]??0}.json`;
        let unit=await stageFile(job,file);
        if(!unit){
          await setStage(job,`scene:${index+1}`);
          unit=await attempt(job,(settings,feedback)=>scene(story,index,data.dossier,data.quotes,settings,{signal,feedback}),signal);
          guard(signal);await write(job,file,unit);
        }
        units.push(unit);job.completedScenes=index+1;await save(job);
      }
      await setStage(job,"assemble");
      const plan=assemble(data.dossier,story,units);
      guard(signal);
      const artifactId=await persist(root,job,data,plan);
      guard(signal);
      job.artifactId=artifactId;
      job.status="completed";job.stage="completed";job.error=null;await save(job);
    }catch(error){
      if(job){job.status=signal.aborted?"cancelled":"failed";
        job.error=signal.aborted?null:errorInfo(error);await save(job);
        if(job.error)console.warn("[contentgen-research-job]",JSON.stringify({
          jobId:job.id,stage:job.stage,errorCode:job.error.code,attempt:"stopped",
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
      completedScenes:0,totalScenes:0,sceneRevisions:{},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
      error:null,artifactId:null};
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
      if(JSON.stringify(next)!==JSON.stringify(job.models)){
        job.models=next;job.generation++;job.sceneRevisions={};job.completedScenes=0;job.totalScenes=0;
      }
    }
    job.status="queued";job.stage="queued";job.error=null;job.artifactId=null;
    await save(job);start(job);return publicState(job);
  }
  async function cancel(id){
    const job=await read(id);
    if(job.status==="completed")throw Error("Research job already completed; its snapshot cannot be cancelled.");
    active.get(id)?.abort(Error("Job cancelled."));
    job.status="cancelled";job.stage="cancelled";job.error=null;
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
