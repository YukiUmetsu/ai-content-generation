/** A selected-scene MP4 is independently claimed in the existing Rust Jobs
 * system. A crashed worker leaves a recoverable attempt, never a fake success.
 */
import {createHash} from "node:crypto";

const SHA=/^[a-f0-9]{64}$/u;
const ID=/^[a-z0-9][a-z0-9_-]{0,95}$/iu;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const hash=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function withSceneClipJob({projectId="unsaved-project",shotId,sourceHash,runId,signal},render,{
  origin=process.env.CONTENTGEN_JOBS_ORIGIN??"http://127.0.0.1:8787",
  fetcher=globalThis.fetch,heartbeatMs=20_000}={}){
  if(!ID.test(projectId??"")||!ID.test(shotId??"")||!SHA.test(sourceHash??"")||!UUID.test(runId??"")||
    typeof render!=="function")throw Error("Scene preview Jobs need a stable storyboard scene and render plan.");
  const server=new URL(origin);
  if(server.protocol!=="http:"||!["127.0.0.1","localhost"].includes(server.hostname)||
    server.username||server.password||server.pathname!=="/"||server.search||server.hash||
    !Number.isSafeInteger(heartbeatMs)||heartbeatMs<10||heartbeatMs>120_000)
    throw Error("Scene preview Jobs must use the local Rust Jobs server.");
  async function request(path,body){
    let response;
    try{response=await fetcher(new URL(path,server),{method:"POST",
      headers:{"Content-Type":"application/json","X-Contentgen-Worker":"local-only"},
      body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});}
    catch{throw Error("Scene preview Jobs unavailable. Start the local Rust server and retry.");}
    let data;try{data=await response.json();}catch{throw Error("Scene preview Jobs returned an unreadable result.");}
    if(!response.ok)throw Error(typeof data.error==="string"?data.error:
      data.error?.message??`Scene preview Jobs returned HTTP ${response.status}.`);
    return data;
  }
  if(signal?.aborted)throw signal.reason??Error("Scene preview cancelled.");
  const scope={projectId,shotId,sourceHash,runId};
  let saved=await request("/api/jobs",{jobKind:"video-render-segment",
    idempotencyKey:"video-scene-preview:"+hash(scope),nodes:[{nodeKey:"scene-preview",
      nodeKind:"video.scene-preview",maxAttempts:3,input:scope,dependsOn:[]}]});
  const jobId=saved.job?.id,nodeId=saved.nodes?.[0]?.id;
  if(typeof jobId!=="string"||typeof nodeId!=="string"||saved.nodes?.[0]?.nodeKey!=="scene-preview")
    throw Error("Rust Jobs did not create the scene preview attempt.");
  if(saved.created!==true&&saved.nodes[0].state==="RUNNING")
    saved=await request(`/api/jobs/${jobId}/recover-stale`,{});
  if(["FAILED","CANCELLED"].includes(saved.job?.state))
    saved=await request(`/api/jobs/${jobId}/retry`,{});
  if(saved.job?.state!=="RUNNING"||saved.nodes?.[0]?.state!=="READY")
    throw Error("This scene preview is already running or completed in Jobs.");
  const attempt=await request(`/api/jobs/${jobId}/nodes/${nodeId}/start`,{});
  const attemptId=attempt.attempt?.id;
  if(typeof attemptId!=="string")throw Error("Jobs did not confirm the scene worker claim.");
  const abort=new AbortController();
  const combined=signal?AbortSignal.any([signal,abort.signal]):abort.signal;
  let stopped=false,busy=false,leaseError=null;
  const timer=setInterval(async()=>{
    if(stopped||busy)return;busy=true;
    try{const reply=await request(`/api/jobs/${jobId}/nodes/${nodeId}/heartbeat`,{attemptId});
      if(reply.alive!==true)throw Error("Scene preview worker ownership expired.");}
    catch{
      if(!stopped&&!leaseError){leaseError=Error("Scene preview worker lost its Jobs claim. Retry to resume safely.");
        abort.abort(leaseError);}
    }finally{busy=false;}
  },heartbeatMs);
  timer.unref?.();
  try{
    if(combined.aborted)throw combined.reason??Error("Scene preview cancelled.");
    const artifact=await render({signal:combined,jobId});
    if(leaseError)throw leaseError;
    if(combined.aborted)throw combined.reason??Error("Scene preview cancelled.");
    if(artifact?.shotId!==shotId||!SHA.test(artifact.sha256??"")||
      !Number.isSafeInteger(artifact.sizeBytes)||artifact.sizeBytes<100)
      throw Error("The scene worker did not return a verified MP4.");
    stopped=true;clearInterval(timer);
    await request(`/api/jobs/${jobId}/nodes/${nodeId}/succeed`,{attemptId,
      output:{shotId,sha256:artifact.sha256,sizeBytes:artifact.sizeBytes}});
    return {...artifact,jobId};
  }catch(error){
    stopped=true;clearInterval(timer);
    if(leaseError)throw leaseError;
    if(signal?.aborted){
      await request(`/api/jobs/${jobId}/cancel`,{});
      throw error;
    }
    await request(`/api/jobs/${jobId}/nodes/${nodeId}/fail`,{attemptId,
      errorCode:"scene_preview_failed",
      errorDetail:"Scene preview rendering stopped. Check Chromium and FFmpeg, then retry."});
    throw error;
  }finally{stopped=true;clearInterval(timer);}
}
