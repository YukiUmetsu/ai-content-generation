/** Thin worker adapter over Rust's persisted Jobs DAG. This module owns no
 * scheduler, queue, or database: SQLite remains the source of truth. */
import {createHash} from "node:crypto";

const LEGACY_NODES=["scene-plan","visual-planning","asset-search","narration","timeline",
  "sound-mix","scene-render","final-mux","technical-qa","export-package"];
export const PRODUCTION_NODES=["scene-plan","visual-planning","asset-search","asset-preparation",
  "narration","timeline","sound-mix","captions","scene-render","thumbnails","final-mux",
  "technical-qa","export-package"];
const phases={"browser-preflight":"visual-planning","asset-search":"asset-search",
  "asset-preparation":"asset-preparation",narration:"narration",timeline:"timeline",
  audio:"sound-mix",captions:"captions",rendering:"scene-render",thumbnails:"thumbnails",
  mux:"final-mux",qa:"technical-qa",review:"export-package"};
const RUN_ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const SHA256=/^[a-f0-9]{64}$/u;
const BEAT_ID=/^[a-z0-9][a-z0-9._:-]{0,127}$/iu;
const LEDGER_KINDS={"asset-search":"asset-search","asset-preparation":"asset-preparation",narration:"narration",
  "sound-mix":"sound-mix",captions:"captions","scene-render":"scene-render",thumbnails:"thumbnails",
  "final-mux":"final-mux","technical-qa":"technical-qa","export-package":"export-package"};
function hash(value){if(typeof value!=="string"||!SHA256.test(value))throw Error("Jobs artifact hash must be a SHA-256 digest.");return value;}
function integer(value,{positive=false}={}){
  if(!Number.isSafeInteger(value)||value<(positive?1:0))throw Error("Jobs artifact count must be a valid nonnegative integer.");
  return value;
}
function hashes(value){
  if(!value||typeof value!=="object"||Array.isArray(value))throw Error("Jobs artifact hashes must be an object.");
  const result={};
  for(const key of ["video","captions","master","coverStill"]){if(value[key]!==undefined)result[key]=hash(value[key]);}
  if(!result.video)throw Error("Jobs export must identify the video SHA-256 digest.");
  return result;
}
/** Persist fixed-schema content identities, never unbounded event payloads or filesystem paths. */
function validatedLedger(ledger,nodeKey){
  if(!ledger||typeof ledger!=="object"||Array.isArray(ledger)||ledger.kind!==LEDGER_KINDS[nodeKey])
    throw Error(`Jobs artifact ledger does not match the completed ${nodeKey} step.`);
  switch(nodeKey){
    case "asset-search":
    case "asset-preparation":{
      if(!Array.isArray(ledger.selected)||!ledger.selected.length||ledger.selected.length>60)
        throw Error("Jobs selected scene media must be a bounded nonempty list.");
      const selected=ledger.selected.map(asset=>{
        if(typeof asset?.beatId!=="string"||!BEAT_ID.test(asset.beatId)||
          !["photo","video"].includes(asset.assetType))throw Error("Jobs selected scene media has an invalid identity.");
        return {beatId:asset.beatId,assetType:asset.assetType,sha256:hash(asset.sha256)};
      });
      if(new Set(selected.map(asset=>asset.beatId)).size!==selected.length)
        throw Error("Jobs selected scene media must be unique per scene.");
      return {kind:nodeKey,fingerprint:hash(ledger.fingerprint),selected};
    }
    case "narration":{
      if(!Array.isArray(ledger.beats)||!ledger.beats.length||ledger.beats.length>512)
        throw Error("Jobs narration artifact list must be bounded and nonempty.");
      const beats=ledger.beats.map(beat=>{
        if(typeof beat?.id!=="string"||!BEAT_ID.test(beat.id))throw Error("Jobs narration ID is invalid.");
        return {id:beat.id,sha256:hash(beat.sha256),samples:integer(beat.samples,{positive:true})};
      });
      if(new Set(beats.map(beat=>beat.id)).size!==beats.length)throw Error("Jobs narration IDs must be unique.");
      return {kind:nodeKey,beats};
    }
    case "sound-mix":return {kind:nodeKey,masterSha256:hash(ledger.masterSha256),samples:integer(ledger.samples,{positive:true})};
    case "captions":return {kind:nodeKey,sha256:hash(ledger.sha256),bytes:integer(ledger.bytes,{positive:true})};
    case "scene-render":{
      if(!Array.isArray(ledger.segments)||!ledger.segments.length||ledger.segments.length>4096)
        throw Error("Jobs video segment list must be bounded and nonempty.");
      const segments=ledger.segments.map(segment=>({sha256:hash(segment.sha256),
        startFrame:integer(segment.startFrame),frameCount:integer(segment.frameCount,{positive:true})}));
      let next=0;
      for(const segment of segments){if(segment.startFrame!==next)throw Error("Jobs video segments must cover contiguous frames.");next+=segment.frameCount;}
      return {kind:nodeKey,planHash:hash(ledger.planHash),
        ...(ledger.buildHash===undefined?{}:{buildHash:hash(ledger.buildHash)}),segments};
    }
    case "final-mux":return {kind:nodeKey,artifacts:hashes(ledger.artifacts)};
    case "thumbnails":{
      if(!Array.isArray(ledger.concepts)||ledger.concepts.length!==3)
        throw Error("Jobs thumbnails must contain exactly three concepts.");
      return {kind:nodeKey,concepts:ledger.concepts.map((item,index)=>{
        if(item?.id!==`thumbnail-${index+1}`)throw Error("Jobs thumbnails must use fixed concept identities.");
        return {id:item.id,sha256:hash(item.sha256),sourceSha256:hash(item.sourceSha256)};
      })};
    }
    case "technical-qa":{
      if(typeof ledger.technicalPass!=="boolean")throw Error("Jobs technical QA status must be a boolean.");
      return {kind:nodeKey,technicalPass:ledger.technicalPass,manifestHash:hash(ledger.manifestHash)};
    }
    case "export-package":return {kind:nodeKey,manifestHash:hash(ledger.manifestHash),
      artifacts:hashes(ledger.artifacts)};
    default:throw Error(`Jobs step ${nodeKey} does not produce an artifact ledger.`);
  }
}
function validatedOutput(nodeKey,payload){
  if(!payload)return {completed:true};
  const output={completed:true};
  if(payload.assetSearch!==undefined){
    if(nodeKey!=="asset-search")throw Error("Jobs asset-search output belongs to the asset-search step.");
    const source=payload.assetSearch;
    if(!["skipped","completed","partial","fallback"].includes(source?.status))
      throw Error("Jobs asset-search status is invalid.");
    output.assetSearch={status:source.status};
    for(const key of ["scenes","candidates"]){
      if(source[key]!==undefined)output.assetSearch[key]=integer(source[key]);
    }
    if(source.reused!==undefined)output.assetSearch.reused=source.reused===true;
    // Third-party errors sometimes embed machine paths or credentials. Leave
    // detailed warnings in the private scene catalog, not the durable Jobs DB.
  }
  if(payload.artifactLedger!==undefined)
    output.artifactLedger=validatedLedger(payload.artifactLedger,nodeKey);
  return output;
}

export function createProductionJobTracker({origin=process.env.CONTENTGEN_JOBS_ORIGIN??"http://127.0.0.1:8787",
  fetcher=globalThis.fetch}={}){
  const server=new URL(origin);
  if(!["localhost","127.0.0.1"].includes(server.hostname)||server.protocol!=="http:"||
    server.username||server.password||server.pathname!=="/"||server.search||server.hash)
    throw Error("Production jobs require the local Rust server. Set CONTENTGEN_JOBS_ORIGIN to a loopback address.");
  let jobId=null,nodes=[],keys=PRODUCTION_NODES,active=-1,attemptId=null,terminal=null,priorRunId=null;
  let sceneScope=null;
  const sceneAttempts=new Map();
  const priorLedgers=new Map();
  async function request(path,body){
    let response;
    try{
      response=await fetcher(new URL(path,server),{method:body===undefined?"GET":"POST",
        ...(body===undefined?{}:{body:JSON.stringify(body)}),
        headers:{"Content-Type":"application/json","X-Contentgen-Worker":"local-only"},
        signal:AbortSignal.timeout(15_000)});
    }catch(error){throw Error("Jobs service unavailable. Start the local Rust ContentGen server and retry. "+String(error?.message??""));}
    let data;
    try{data=await response.json();}catch{throw Error("Jobs service returned an unreadable response.");}
    if(!response.ok)throw Error(typeof data.error==="string"?data.error:
      data.error?.message??`Jobs service returned HTTP ${response.status}.`);
    return data;
  }
  async function begin(index){
    const node=nodes[index];
    if(!node)throw Error(`Missing production step ${PRODUCTION_NODES[index]}.`);
    const data=await request(`/api/jobs/${jobId}/nodes/${node.id}/start`,{});
    if(typeof data.attempt?.id!=="string")throw Error("Jobs service did not reserve a step attempt.");
    active=index;attemptId=data.attempt.id;
  }
  async function succeed(output={completed:true}){
    const node=nodes[active];
    if(!node||!attemptId)throw Error("No production step is reserved.");
    await request(`/api/jobs/${jobId}/nodes/${node.id}/succeed`,{attemptId,output});
    attemptId=null;
  }
  return {
    get jobId(){return jobId;},
    get priorRunId(){return priorRunId;},
    async start({productionId,revision,runId}){
      if(jobId)throw Error("Production job already started.");
      if(!/^production-[a-f0-9]{24}$/u.test(productionId)||!revision||!RUN_ID.test(runId))
        throw Error("Production job requires a saved production, revision and run identity.");
      const key="video-production:"+createHash("sha256").update(JSON.stringify({productionId,revision})).digest("hex");
      let data=await request("/api/jobs",{jobKind:"video-production",idempotencyKey:key,
        nodes:PRODUCTION_NODES.map((nodeKey,index)=>({nodeKey,nodeKind:`video.${nodeKey}`,
          // A restarted worker reclaims a READY attempt; committed work and
          // immutable content-addressed media can be reused after recovery.
          maxAttempts:3,input:{productionId,revision,runId},
          dependsOn:index?[PRODUCTION_NODES[index-1]]:[]}))});
      if(data.created!==true){
        if(["FAILED","CANCELLED"].includes(data.job?.state)&&typeof data.job.id==="string"){
          // Explicit retry is one SQLite transaction. Only one worker can
          // re-arm a terminal job; successful nodes remain intact.
          data=await request(`/api/jobs/${data.job.id}/retry`,{});
        }else if(data.job?.state!=="RUNNING"||
          data.nodes?.some(node=>node.state==="RUNNING")||
          data.nodes?.filter(node=>node.state==="READY").length!==1){
          throw Error(data.job?.state==="SUCCEEDED"?
            "A video for this revision already exists. Review its saved MP4 or edit the script to regenerate.":
            "This video is already running or waiting in Jobs. Open Jobs to review or cancel it.");
        }
      }
      const returnedKeys=data.nodes?.map(node=>node.nodeKey);
      keys=JSON.stringify(returnedKeys?.slice().sort())===JSON.stringify(PRODUCTION_NODES.slice().sort())?
        PRODUCTION_NODES:LEGACY_NODES;
      if(typeof data.job?.id!=="string"||!Array.isArray(data.nodes)||data.nodes.length!==keys.length)
        throw Error("Jobs service did not return the expected production steps.");
      const byKey=new Map(data.nodes.map(node=>[node.nodeKey,node]));
      if(byKey.size!==keys.length||keys.some(key=>typeof byKey.get(key)?.id!=="string"))
        throw Error("Jobs service returned incomplete or duplicate production steps.");
      const firstInput=byKey.get(keys[0])?.input;
      if(data.created!==true&&firstInput?.productionId===productionId&&firstInput.revision===revision&&
        typeof firstInput.runId==="string"&&RUN_ID.test(firstInput.runId)&&firstInput.runId!==runId)
        priorRunId=firstInput.runId;
      jobId=data.job.id;nodes=keys.map(key=>byKey.get(key));
      sceneScope={productionId,revision,runId};
      const firstReady=nodes.findIndex(node=>node.state==="READY");
      if(firstReady<0||nodes.slice(0,firstReady).some(node=>node.state!=="SUCCEEDED"))
        throw Error("Jobs service did not return a resumable production step.");
      await begin(firstReady);
      return jobId;
    },
    async advance(phase,completedStepOutput){
      if(terminal)throw Error(`Production job has ${terminal}.`);
      // Older releases have a ten-step DAG. Keep that immutable history
      // resumable even though the new runner splits out additional milestones.
      if(keys===LEGACY_NODES&&completedStepOutput?.artifactLedger){
        priorLedgers.set(completedStepOutput.artifactLedger.kind,completedStepOutput.artifactLedger);
        if(phase==="narration"&&completedStepOutput.artifactLedger.kind==="asset-preparation")
          completedStepOutput={...completedStepOutput,artifactLedger:{
            ...completedStepOutput.artifactLedger,kind:"asset-search"}};
        if(phase==="rendering"&&priorLedgers.has("sound-mix"))
          completedStepOutput={...completedStepOutput,artifactLedger:priorLedgers.get("sound-mix")};
        if(phase==="mux"&&priorLedgers.has("scene-render"))
          completedStepOutput={...completedStepOutput,artifactLedger:priorLedgers.get("scene-render")};
      }
      const target=keys.indexOf(phases[phase]);
      if(target<0||target<=active)return;
      if(active<0)throw Error("Production job was not started.");
      // Validate before completing any earlier step, so a malformed last-stage
      // hash never leaves a partially advanced sequence marked successful.
      const finalOutput=validatedOutput(keys[target-1],completedStepOutput);
      while(active<target){await succeed(active===target-1?finalOutput:{completed:true});await begin(active+1);}
    },
    async complete(finalStepOutput){
      if(terminal)throw Error(`Production job has ${terminal}.`);
      if(active<0)throw Error("Production job was not started.");
      if(sceneAttempts.size)throw Error("Production cannot finish while scene work is still claimed.");
      const finalOutput=validatedOutput(keys.at(-1),finalStepOutput);
      while(active<keys.length-1){await succeed();await begin(active+1);}
      await succeed(finalOutput);terminal="completed";
    },
    async fail(code="render_failed",detail="Video rendering failed"){
      if(terminal||!attemptId)return;
      terminal="failed";
      await request(`/api/jobs/${jobId}/nodes/${nodes[active].id}/fail`,{
        attemptId,errorCode:code.slice(0,80),errorDetail:detail.slice(0,240)});
    },
    /** Each narration beat and encoded render chunk has a separately claimed,
     * persisted attempt. An interrupted worker cannot complete another
     * worker's attempt; Rust atomically verifies every transition. */
    async beginScene({kind,sceneId,fingerprint}){
      if(terminal||!sceneScope||!jobId)throw Error("A production must be running before scene work starts.");
      if(!["narration-scene","render-segment"].includes(kind)||!BEAT_ID.test(sceneId))
        throw Error("Scene Jobs require a valid scene and operation.");
      hash(fingerprint);
      const identity=JSON.stringify({...sceneScope,kind,sceneId,fingerprint});
      const key="video-scene:"+createHash("sha256").update(identity).digest("hex");
      if(sceneAttempts.has(key))throw Error("This scene is already claimed by this worker.");
      const input={...sceneScope,kind,sceneId,fingerprint};
      const jobKind=kind==="narration-scene"?"video-narration-scene":"video-render-segment";
      let data=await request("/api/jobs",{jobKind,idempotencyKey:key,
        nodes:[{nodeKey:kind,nodeKind:`video.${kind}`,maxAttempts:3,input,dependsOn:[]}]});
      if(data.created!==true&&["FAILED","CANCELLED"].includes(data.job?.state)){
        data=await request(`/api/jobs/${data.job.id}/retry`,{});
      }
      // SUCCEEDED work is only reused via separately SHA/probe-verified caches
      // in speech.mjs/render.mjs, never by treating this Jobs row as media.
      // A second worker cannot issue a fresh claim for a running node.
      if(typeof data.job?.id!=="string"||data.nodes?.length!==1||
        data.nodes[0]?.nodeKey!==kind||data.nodes[0]?.state!=="READY")
        throw Error("This scene is already being produced or has completed in Jobs.");
      const node=data.nodes[0];
      const reservation=await request(`/api/jobs/${data.job.id}/nodes/${node.id}/start`,{});
      if(typeof reservation.attempt?.id!=="string")throw Error("Jobs did not reserve the scene attempt.");
      sceneAttempts.set(key,{jobId:data.job.id,nodeId:node.id,attemptId:reservation.attempt.id});
      return key;
    },
    async completeScene(key,{sha256,samples,frameCount,reused=false}){
      const attempt=sceneAttempts.get(key);
      if(!attempt||terminal)throw Error("No active scene attempt can be completed.");
      const output={sha256:hash(sha256),reused:reused===true};
      if(samples!==undefined)output.samples=integer(samples,{positive:true});
      if(frameCount!==undefined)output.frameCount=integer(frameCount,{positive:true});
      await request(`/api/jobs/${attempt.jobId}/nodes/${attempt.nodeId}/succeed`,
        {attemptId:attempt.attemptId,output});
      sceneAttempts.delete(key);
    },
    async failScene(key,error){
      const attempt=sceneAttempts.get(key);
      if(!attempt)return;
      // Provider failures may contain account tokens, voice text, or machine
      // paths. Jobs stores the safe failure category, not raw vendor output.
      const detail=error?.name==="AbortError"?
        "Scene work was interrupted. Retry to reuse verified completed media.":
        "Scene processing failed. Retry this draft to reuse completed scene media.";
      await request(`/api/jobs/${attempt.jobId}/nodes/${attempt.nodeId}/fail`,{
        attemptId:attempt.attemptId,errorCode:"scene_failed",errorDetail:detail});
      sceneAttempts.delete(key);
    },
    async cancel(){
      if(terminal||!jobId)return;
      terminal="cancelled";
      const sceneResults=await Promise.allSettled([...sceneAttempts.values()].map(attempt=>
        request(`/api/jobs/${attempt.jobId}/cancel`,{})));
      sceneAttempts.clear();
      await request(`/api/jobs/${jobId}/cancel`,{});
      if(sceneResults.some(result=>result.status==="rejected"))
        throw Error("Cancellation was saved for the video, but an individual scene job could not be confirmed.");
    },
  };
}
