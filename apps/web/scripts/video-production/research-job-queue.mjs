/** Crash-resumable local Research jobs. Browser connections are not the job lifecycle. */
import {randomBytes,createHash} from "node:crypto";
import {mkdir,readFile,open,rename,stat,unlink} from "node:fs/promises";
import {basename,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {validateStudioBrief} from "./studio-research.mjs";
import {loadStudioSearch,validateStudioSearchMatch} from "./studio-search.mjs";
import {captureSavedSources,buildDeterministicDossier} from "./research-job-evidence.mjs";
import {repairCapturedLinks} from "./evidence-link-repair.mjs";
import {generateOutlineSkeleton,generateOutlineBeat,assembleOutline,generateSceneCore,generateSceneStates,assembleSceneStructure,generateSceneDirection,generateSceneElements,assembleSceneVisual,generateSceneNarration,assembleSceneUnit,assembleResumablePlan,validateSavedOutline,validateSavedOutlineSkeleton,validateSavedOutlineBeat,validateSavedSceneStructure,validateSavedSceneVisual,validateSavedSceneUnit,validateSavedSceneCore,validateSavedSceneStates,validateSavedSceneDirection,validateSavedSceneElements,validateSavedSceneNarration} from "./research-job-planner.mjs";
import {validateResearchModelSettings} from "./research-model-settings.mjs";
import {withModelDebugContext} from "./research-ai-debug.mjs";

const DEFAULT_ROOT=fileURLToPath(new URL("../../../../data/studio-research",import.meta.url));
const sha=value=>createHash("sha256").update(value).digest("hex");
const ID=/^job_[a-f0-9]{24}$/u;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const safeName=name=>/^(?:manifest|captures|evidence|evidence_repair_\d+|outline_\d+|outline_skeleton_\d+|outline_beat_\d+_\d+|scene_\d+_\d+_\d+|structure_\d+_\d+_\d+|structure_(?:core|states)_\d+_\d+_\d+|visual_(?:direction|elements)_\d+_\d+_\d+_[012]|(?:visual|narration)_\d+_\d+_\d+_[012])\.json$/u.test(name);
const safeField=field=>typeof field==="string"&&/^(?:response|pattern|premise|hook|beatCount|question|purpose|payoff|claimIds|beats(?:\[\d\])?(?:\.(?:question|purpose|payoff|claimIds))?|subject|parts(?:\[\d\])?|operator|before|action|after|before\/action\/after|visualAction|learningChange|onScreenText|visualElements|narration|phases(?:\[\d\])?(?:\.(?:visualAction|learningChange|onScreenText|narration|visualElements))?|phases\.(?:visualAction|learningChange))$/u.test(field)?field:null;
const safeSchemaIssue=issue=>["missing","wrong_type","too_short","too_long","placeholder","control_char",
  "wrong_shape","invalid_element","duplicate_previous"].includes(issue)?issue:null;
const sceneStateRepairHint=field=>field==="before"||field==="after"?
  ` The ${field} field must be a string of 8–48 characters describing a concrete ${field==="before"?"starting":"ending"} visible state, not a generic label.`:
  field==="action"?" The action field must be a string of 8–90 characters describing a concrete visible change.":"";
const phaseRepairHint=step=>{
  const phase=/^visual:([123]):direction$/u.exec(step??"")?.[1];
  return ({"1":"Problem phase: expose the unresolved viewer question without giving away the answer.",
    "2":"Mechanism phase: demonstrate cause and effect with a new visual transformation, not another setup.",
    "3":"Payoff phase: resolve the beat's question with a new synthesis or reveal, not another comparison or repetition."})[phase]??
      "Show a genuinely different teaching operation for this phase.";
};
const repairHint=(failure,step)=>{
  if(failure.schemaIssue==="duplicate_previous"&&["visualAction","learningChange"].includes(failure.field))
    return ` ${phaseRepairHint(step)} The ${failure.field} exactly repeated an accepted previousVisuals value. `+
      `Do not paraphrase or rename a prior action or insight. Choose a different ${failure.field==="visualAction"?
        "physical on-screen operation":"learning outcome that advances the explanation"} supported by the provided evidence.`;
  if(failure.field==="visualElements")return " Return exactly two distinct visible objects as "+
    "{visualElements:[{label,detail},{label,detail}]}. Use concrete short labels and useful visual descriptions, not generic names.";
  if(failure.schemaIssue==="too_long")return " Shorten the failing field substantially while retaining its concrete meaning.";
  if(["missing","wrong_type","wrong_shape","invalid_element"].includes(failure.schemaIssue))
    return " Restore the required field name, JSON type, and structure; do not omit other required fields.";
  return sceneStateRepairHint(failure.field);
};
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
  const field=safeField(error?.field);
  const schemaIssue=detailCode==="schema_invalid"?safeSchemaIssue(error?.schemaIssue):null;
  const safeMessage=schemaIssue&&field?`${message} ${field}: ${schemaIssue}.`:message;
  return {code,message:safeMessage,...(detailCode?{detailCode}:{}),...(providerDetail?{providerDetail}:{}),
    ...(field?{field}:{}),...(schemaIssue?{schemaIssue}:{})};
};

async function atomicText(file,bytes,limit=512*1024){
  if(Buffer.byteLength(bytes)>limit)throw Error("Storage artifact exceeds bounded size.");
  const temp=file+"."+randomBytes(6).toString("hex")+".tmp";
  try{
    const handle=await open(temp,"wx",0o600);
    try{await handle.writeFile(bytes);await handle.sync();}
    finally{await handle.close();}
    await rename(temp,file);
  }catch(error){await unlink(temp).catch(()=>{});throw error;}
}
const atomicJson=(file,value,limit)=>atomicText(file,JSON.stringify(value),limit);
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
    ...(job.error?{error:job.error}:{}),...(job.artifactId?{artifactId:job.artifactId}:{}),
    ...(job.evidenceRepair?{evidenceRepair:job.evidenceRepair}:{})};
}
async function saveCompleted(root,job,data,plan){
  const {dossier,quotes,captures,warnings}=data;
  const modelsUsed=job.modelsUsed??[];
  const document={schemaVersion:1,kind:"studio-research-snapshot",dossier,captures,plan,quotes,
    provider:"searxng",model:modelsUsed.length===1?modelsUsed[0]:modelsUsed.length>1?"multiple local models":"unknown local model",
    modelsUsed,warnings,searchArtifactId:job.searchArtifactId};
  const content=JSON.stringify(document);
  const name=dossier.id+"-"+sha(content).slice(0,12)+".json";
  const file=join(root,name);
  if(Buffer.byteLength(content)>512*1024)throw Error("Research snapshot exceeds 512 KiB limit.");
  // A crash during an older non-atomic write may leave an incomplete file.
  // Its name is content-addressed, so restoring precisely these bytes is safe.
  const existing=await optionalText(file);
  if(existing!==content)await atomicText(file,content);
  return basename(name,".json");
}
async function optionalText(file){
  try{
    if((await stat(file)).size>512*1024)throw Error("Research snapshot exceeds 512 KiB limit.");
    return await readFile(file,"utf8");
  }catch(error){if(error.code==="ENOENT")return null;throw error;}
}

/** Instances allow isolated tests; the real Vite process uses exactly one shared manager. */
export function createResearchJobManager({root=DEFAULT_ROOT,loadSearch=loadStudioSearch,
  capture=captureSavedSources,evidence=buildDeterministicDossier,repair=null,outline=null,
  outlineSkeleton=generateOutlineSkeleton,outlineBeat=generateOutlineBeat,combineOutline=assembleOutline,
  scene=null,sceneStructure=null,sceneCore=generateSceneCore,sceneStates=generateSceneStates,
  combineStructure=assembleSceneStructure,sceneVisual=null,sceneDirection=generateSceneDirection,
  sceneElements=generateSceneElements,combineVisual=assembleSceneVisual,
  sceneNarration=generateSceneNarration,combineScene=assembleSceneUnit,
  assemble=assembleResumablePlan,persist=saveCompleted,sleep=pause,writeCheckpoint=atomicJson}={}){
  const active=new Map();
  const manifestWrites=new Map();
  let inferenceTail=Promise.resolve();
  const rootJobs=join(root,"jobs");
  const pathFor=(id,name)=>{
    if(!ID.test(id)||!safeName(name))throw Error("Invalid research job file identifier.");
    return join(rootJobs,id,name);
  };
  const write=async(job,name,data)=>{
    await mkdir(join(rootJobs,job.id),{recursive:true,mode:0o700});
    await writeCheckpoint(pathFor(job.id,name),data,name==="captures.json"?256*1024:512*1024);
  };
  const save=job=>{
    const previous=manifestWrites.get(job.id)??Promise.resolve();
    const next=previous.catch(()=>{}).then(async()=>{
      // Cancellation has precedence even if completion was queued just before
      // the abort. Serializing saves means an acknowledged cancellation wins.
      if(job.status==="completed"&&active.get(job.id)?.signal.aborted)
        throw Error("Job cancelled.");
      job.updatedAt=new Date().toISOString();
      await write(job,"manifest.json",job);
    });
    manifestWrites.set(job.id,next);
    void next.then(()=>{if(manifestWrites.get(job.id)===next)manifestWrites.delete(job.id);},
      ()=>{if(manifestWrites.get(job.id)===next)manifestWrites.delete(job.id);});
    return next;
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
    let sawTruncation=job.repairHint?.stage===job.stage&&job.repairHint?.currentStep===job.currentStep&&
      job.repairHint.reason==="output_truncated";
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
          const feedback=n>0||sawTruncation?failure?.code==="provider_unavailable"?
            (sawTruncation?compact.trim():null):
            failure?.field&&failure.detailCode==="schema_invalid"?
            `The previous JSON failed validation at ${failure.field}${failure.schemaIssue?` (${failure.schemaIssue})`:""}. `+
              `Correct that field and return the complete JSON without inventing facts.`+repairHint(failure,job.currentStep)+compact:
            sawTruncation?compact.trim():
              "Return ONLY a complete JSON object with exactly the required fields and types; correct any malformed fields without inventing facts.":null;
          const result=await inference(()=>withModelDebugContext({
            jobId:job.id,stage:job.stage,currentStep:job.currentStep,model:settings.model,attempt:n+1,
          },()=>call(settings,feedback)),signal);
          job.retry=null;
          job.repairHint=null;
          job.modelsUsed??=[];
          if(!job.modelsUsed.includes(settings.model))job.modelsUsed.push(settings.model);
          await save(job);
          return result;
        }
        catch(error){
          if(signal.aborted)throw error;
          last=error;
          const info=errorInfo(error);
          if(info.detailCode==="output_truncated"){
            sawTruncation=true;
            job.repairHint={stage:job.stage,currentStep:job.currentStep,reason:"output_truncated"};
          }
          const retryable=["model_timeout","provider_unavailable","invalid_output"].includes(info.code);
          if(retryable&&n<maxAttempts-1){
            job.retry={stage:job.stage,attempt:n+2,maxAttempts,reason:info.code,modelIndex:modelIndex+1,totalModels:models.length,
              ...(info.detailCode?{detailCode:info.detailCode}:{}),...(info.providerDetail?{providerDetail:info.providerDetail}:{}),
              ...(info.field?{field:info.field}:{}),...(info.schemaIssue?{schemaIssue:info.schemaIssue}:{})};
            await save(job);
            console.warn("[contentgen-research-retry]",JSON.stringify({jobId:job.id,stage:job.stage,
              errorCode:info.code,detailCode:info.detailCode??null,providerDetail:info.providerDetail??null,field:info.field??null,
              schemaIssue:info.schemaIssue??null,nextAttempt:n+2,maxAttempts,modelIndex:modelIndex+1}));
            await sleep(1000*(n+1));
          }else break;
        }
      }
      if(modelIndex<models.length-1){
        job.retry={stage:job.stage,attempt:1,maxAttempts,reason:errorInfo(last).code,
          ...(errorInfo(last).detailCode?{detailCode:errorInfo(last).detailCode}:{}),
          ...(errorInfo(last).providerDetail?{providerDetail:errorInfo(last).providerDetail}:{}),
          ...(errorInfo(last).field?{field:errorInfo(last).field}:{}),
          ...(errorInfo(last).schemaIssue?{schemaIssue:errorInfo(last).schemaIssue}:{}),
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
      // Repair only existing captured source IDs and verbatim passages.
      // Injected legacy evidence producers remain unchanged unless they opt in.
      const repairStep=repair??(evidence===buildDeterministicDossier?repairCapturedLinks:null);
      if(repairStep){
        const filename=`evidence_repair_${job.evidenceRepairRevision??0}.json`;
        let checkpoint=await stageFile(job,filename);
        if(!checkpoint){
          await setStage(job,"evidence-repair");
          const repaired=await repairStep({dossier:data.dossier,quotes:data.quotes,
            captures:data.captures,plan:null},{signal});
          guard(signal);
          checkpoint={dossier:repaired.document.dossier,quotes:repaired.document.quotes,
            autoFixed:repaired.autoFixed,unresolved:repaired.unresolved,
            proposals:repaired.proposals,audit:repaired.audit};
          await write(job,filename,checkpoint);
        }
        data={...data,dossier:checkpoint.dossier,quotes:checkpoint.quotes};
        job.evidenceRepair={status:checkpoint.unresolved.length?"needs_review":"complete",
          autoFixed:checkpoint.autoFixed,needsReview:checkpoint.unresolved.length,
          issues:checkpoint.unresolved.slice(0,16).map(item=>({
            claimId:String(item.claimId).slice(0,80),reason:String(item.reason).slice(0,40)}))};
        await save(job);
        if(checkpoint.unresolved.length){
          job.status="paused";job.stage="evidence-repair";job.currentStep=null;
          job.error=null;await save(job);return;
        }
      }
      let story=await stageFile(job,`outline_${job.generation}.json`);
      const checkOutline=(validator)=>{
        try{return validator();}catch(error){
          // Keep source captures/evidence; incompatible old outline fragments
          // must not poison future resumes or trigger unbounded beat loops.
          job.generation++;job.sceneRevisions={};job.completedScenes=0;job.totalScenes=0;
          job.stage="outline";job.currentStep="regenerate";
          throw error;
        }
      };
      if(story&&!outline)checkOutline(()=>validateSavedOutline(story,data.dossier));
      if(!story){
        await setStage(job,"outline");
        if(outline){
          // Keep the older injectable full-outline provider for existing integrations.
          story=await attempt(job,(settings,feedback)=>outline(data.dossier,data.quotes,settings,{signal,feedback}),signal);
        }else{
          const outlineStep=async(filename,label,action,validator)=>{
            const saved=await stageFile(job,filename);
            if(saved){if(validator)checkOutline(()=>validator(saved));return saved;}
            await setStage(job,"outline",label);
            const result=await attempt(job,(settings,feedback)=>action(settings,feedback),signal);
            guard(signal);await write(job,filename,result);
            return result;
          };
          const skeleton=await outlineStep(`outline_skeleton_${job.generation}.json`,"skeleton",(settings,feedback)=>
            outlineSkeleton(data.dossier,data.quotes,settings,{signal,feedback}),
            outlineSkeleton===generateOutlineSkeleton?validateSavedOutlineSkeleton:null);
          const beats=[];
          for(let index=0;index<skeleton.beatCount;index++){
            const beat=await outlineStep(`outline_beat_${job.generation}_${index}.json`,`beat:${index+1}`,(settings,feedback)=>
              outlineBeat(skeleton,index,beats,data.dossier,data.quotes,settings,{signal,feedback}),
              outlineBeat===generateOutlineBeat?value=>validateSavedOutlineBeat(value,data.dossier,beats):null);
            beats.push(beat);
          }
          story=checkOutline(()=>combineOutline(data.dossier,skeleton,beats));
        }
        guard(signal);await write(job,`outline_${job.generation}.json`,story);
      }
      job.currentStep=null;
      job.totalScenes=story.beats.length;
      job.sceneRevisions??={};
      await save(job);
      const units=[];
      const rebuildInvalidScene=(index,error)=>{
        if(!signal.aborted){
          job.sceneRevisions[index]=(job.sceneRevisions[index]??0)+1;
          job.completedScenes=Math.min(job.completedScenes??0,index);
          job.stage=`scene:${index+1}`;
          job.currentStep="regenerate";
        }
        throw error;
      };
      const compose=(index,action)=>{
        try{return action();}catch(error){rebuildInvalidScene(index,error);}
      };
      for(let index=0;index<story.beats.length;index++){
        guard(signal);
        const prefix=`${job.generation}_${index}_${job.sceneRevisions[index]??0}`;
        const file=`scene_${prefix}.json`;
        let unit=await stageFile(job,file);
        if(unit&&!scene&&combineScene===assembleSceneUnit)
          compose(index,()=>validateSavedSceneUnit(unit));
        if(!unit){
          await setStage(job,`scene:${index+1}`);
          if(scene){
            // Preserve the original injectable whole-scene producer for existing integrations/tests.
            unit=await attempt(job,(settings,feedback)=>scene(story,index,data.dossier,data.quotes,settings,{signal,feedback}),signal);
          }else{
            const substep=async(filename,label,action,validator)=>{
              const saved=await stageFile(job,filename);
              if(saved){if(validator)compose(index,()=>validator(saved));return saved;}
              await setStage(job,`scene:${index+1}`,label);
              const result=await attempt(job,(settings,feedback)=>action(settings,feedback),signal);
              guard(signal);await write(job,filename,result);
              return result;
            };
            let structure=await stageFile(job,`structure_${prefix}.json`);
            if(structure&&!sceneStructure&&sceneCore===generateSceneCore&&sceneStates===generateSceneStates)
              compose(index,()=>validateSavedSceneStructure(structure));
            if(!structure){
              if(sceneStructure){
                structure=await substep(`structure_${prefix}.json`,"structure",(settings,feedback)=>
                  sceneStructure(story,index,data.dossier,data.quotes,settings,{signal,feedback}));
              }else{
                const core=await substep(`structure_core_${prefix}.json`,"structure:core",(settings,feedback)=>
                  sceneCore(story,index,data.dossier,data.quotes,settings,{signal,feedback}),
                  sceneCore===generateSceneCore?validateSavedSceneCore:null);
                const states=await substep(`structure_states_${prefix}.json`,"structure:states",(settings,feedback)=>
                  sceneStates(story,index,core,data.dossier,data.quotes,settings,{signal,feedback}),
                  sceneStates===generateSceneStates?validateSavedSceneStates:null);
                structure=compose(index,()=>combineStructure(core,states));
                guard(signal);await write(job,`structure_${prefix}.json`,structure);
              }
            }
            const phases=[];
            for(let phase=0;phase<3;phase++){
              const previous=phases.map(part=>part.visual);
              let visual=await stageFile(job,`visual_${prefix}_${phase}.json`);
              if(visual&&!sceneVisual&&sceneDirection===generateSceneDirection&&sceneElements===generateSceneElements)
                compose(index,()=>validateSavedSceneVisual(visual,previous));
              if(!visual){
                if(sceneVisual){
                  visual=await substep(`visual_${prefix}_${phase}.json`,`visual:${phase+1}`,(settings,feedback)=>
                    sceneVisual(story,index,phase,structure,previous,data.dossier,data.quotes,settings,{signal,feedback}));
                }else{
                  const direction=await substep(`visual_direction_${prefix}_${phase}.json`,`visual:${phase+1}:direction`,(settings,feedback)=>
                    sceneDirection(story,index,phase,structure,previous,data.dossier,data.quotes,settings,{signal,feedback}),
                    sceneDirection===generateSceneDirection?value=>validateSavedSceneDirection(value,previous):null);
                  const elements=await substep(`visual_elements_${prefix}_${phase}.json`,`visual:${phase+1}:elements`,(settings,feedback)=>
                    sceneElements(story,index,phase,structure,direction,data.dossier,data.quotes,settings,{signal,feedback}),
                    sceneElements===generateSceneElements?validateSavedSceneElements:null);
                  visual=compose(index,()=>combineVisual(direction,elements,previous));
                  guard(signal);await write(job,`visual_${prefix}_${phase}.json`,visual);
                }
              }
              const narration=await substep(`narration_${prefix}_${phase}.json`,`narration:${phase+1}`,(settings,feedback)=>
                sceneNarration(story,index,phase,structure,visual,data.dossier,data.quotes,settings,{signal,feedback}),
                sceneNarration===generateSceneNarration?validateSavedSceneNarration:null);
              phases.push({visual,narration});
            }
            unit=compose(index,()=>combineScene(structure,phases));
          }
          guard(signal);await write(job,file,unit);
        }
        units.push(unit);job.completedScenes=index+1;job.currentStep=null;await save(job);
      }
      await setStage(job,"assemble");
      let plan;
      try{plan=assemble(data.dossier,story,units);}
      catch(error){
        // A legacy cached scene may pass its old fragment checks but violate
        // the current final plan schema. Keep other scenes and rebuild only it.
        if(Number.isInteger(error.sceneIndex)&&error.sceneIndex>=0&&error.sceneIndex<units.length){
          rebuildInvalidScene(error.sceneIndex,error);
        }
        throw error;
      }
      guard(signal);
      const artifactId=await persist(root,job,data,plan);
      guard(signal);
      job.artifactId=artifactId;
      job.status="completed";job.stage="completed";job.currentStep=null;job.error=null;await save(job);
    }catch(error){
      if(job){job.status=signal.aborted?"cancelled":"failed";job.retry=null;
        job.error=signal.aborted?null:errorInfo(error);
        try{await save(job);}catch(storageError){
          // Do not reject the detached worker promise if the disk is full.
          console.warn("[contentgen-research-storage]",JSON.stringify({jobId:job.id,errorCode:errorInfo(storageError).code}));
        }
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
    queueMicrotask(()=>{void execute(job.id,controller).catch(error=>{
      console.warn("[contentgen-research-worker]",JSON.stringify({jobId:job.id,errorCode:errorInfo(error).code}));
    }).finally(()=>active.delete(job.id));});
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
      modelsUsed:[],repairHint:null,
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
    let modelIdentityChanged=false;
    if(models?.primary){
      const next={primary:validateResearchModelSettings({...models.primary,version:1}),
        secondary:models.secondary?validateResearchModelSettings({...models.secondary,version:1}):null};
      const identity=group=>JSON.stringify([group.primary.endpoint,group.primary.model,
        group.secondary?.endpoint??null,group.secondary?.model??null]);
      // Generation limits belong to the job snapshot. Editing global defaults must
      // never discard completed checkpoints when resuming the same models.
      if(identity(next)!==identity(job.models)){
        modelIdentityChanged=true;
        job.models=next;job.generation++;job.sceneRevisions={};job.completedScenes=0;job.totalScenes=0;
        job.repairHint=null;job.modelsUsed=[];
      }else job.models=next; // New per-request limits affect only unfinished checkpoints.
    }
    if(!modelIdentityChanged&&job.error?.detailCode==="output_truncated"&&!job.repairHint){
      job.repairHint={stage:job.stage,currentStep:job.currentStep,reason:"output_truncated"};
    }
    job.status="queued";job.stage="queued";job.currentStep=null;job.error=null;job.retry=null;job.artifactId=null;
    await save(job);start(job);return publicState(job);
  }
  async function retryEvidence(id){
    const job=await read(id);
    if(active.has(id))throw Error("Evidence repair is already active.");
    if(job.status!=="paused"||job.stage!=="evidence-repair")
      throw Error("Only a paused evidence-repair job can be retried.");
    job.evidenceRepairRevision=(job.evidenceRepairRevision??0)+1;
    job.status="queued";job.stage="queued";job.evidenceRepair=null;job.error=null;
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
  return {create,get,resume,cancel,retryScene,retryEvidence};
}

export const researchJobManager=createResearchJobManager();
