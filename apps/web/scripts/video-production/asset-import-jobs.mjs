/** Durable, independently claimable website asset import. Rust/SQLite owns
 * retry counts, attempt history and worker leases; this local Node process
 * owns one bounded provider download and an immutable verified media file.
 */
import {createHash} from "node:crypto";

const ID=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/u;
const SHA=/^[a-f0-9]{64}$/u;
const hash=value=>createHash("sha256").update(value).digest("hex");

function validate(input){
  if(!input||!ID.test(input.projectId)||!ID.test(input.shotId)||
    input.confirmRights!==true||!["photo","video"].includes(input.assetType))
    throw Error("Select a scene and review the Pexels license before preparing media.");
  let source;
  try{source=new URL(input.sourceUrl);}catch{throw Error("Enter a Pexels photo or video page.");}
  if(source.protocol!=="https:"||!["www.pexels.com","pexels.com"].includes(source.hostname)||
    source.username||source.password||source.port||source.search||source.hash)
    throw Error("Only a direct Pexels photo or video page is accepted.");
  const match=/^\/(photo|video)\/(?:[a-z0-9-]*-)?([1-9][0-9]{0,15})\/?$/u.exec(source.pathname);
  if(!match||match[1]!==input.assetType)throw Error("The Pexels page must match the selected media type.");
  if(input.contentSha256!==undefined&&!SHA.test(input.contentSha256))
    throw Error("The uploaded file must have a verified SHA-256 identity.");
  return {projectId:input.projectId,shotId:input.shotId,assetId:match[2],
    sourceUrl:source.href,assetType:input.assetType,contentSha256:input.contentSha256??null};
}

/** A download cannot be reused based on a Jobs row alone: the caller's
 * lookup must re-read and verify the local asset manifest and file bytes. */
export async function withPexelsAssetImportJob(input,{
  importer,lookup,fetcher=globalThis.fetch,
  origin=process.env.CONTENTGEN_JOBS_ORIGIN??"http://127.0.0.1:8787",
  heartbeatMs=20_000,signal:externalSignal,
}={}){
  const metadata=validate(input);
  if(externalSignal?.aborted)throw externalSignal.reason??Error("Media import was cancelled.");
  if(typeof importer!=="function"||typeof lookup!=="function")
    throw Error("Scene asset importer and integrity verifier are required.");
  const server=new URL(origin);
  if(server.protocol!=="http:"||!["localhost","127.0.0.1"].includes(server.hostname)||
    !server.port||server.username||server.password||server.pathname!=="/"||server.search||server.hash)
    throw Error("Media Jobs require a local Rust server on loopback.");
  if(!Number.isSafeInteger(heartbeatMs)||heartbeatMs<10||heartbeatMs>120_000)
    throw Error("Media Jobs heartbeat interval is invalid.");
  const key="video-site-asset:"+hash(JSON.stringify(metadata));
  async function request(path,body){
    let response;
    try{response=await fetcher(new URL(path,server),{method:"POST",body:JSON.stringify(body),
      headers:{"Content-Type":"application/json","X-Contentgen-Worker":"local-only"},
      signal:AbortSignal.timeout(15_000)});}
    catch{throw Error("Media Jobs service is unavailable. Restart the local Rust server and retry.");}
    let reply;
    try{reply=await response.json();}catch{throw Error("Media Jobs service returned an unreadable response.");}
    if(!response.ok)throw Error(typeof reply.error==="string"?reply.error:
      reply.error?.message??`Media Jobs failed (HTTP ${response.status}).`);
    return reply;
  }
  const verified=async()=>{
    const candidates=await lookup(metadata);
    if(!Array.isArray(candidates))throw Error("Approved media catalog is unavailable.");
    return candidates.find(item=>item?.provider==="pexels"&&item.shotId===metadata.shotId&&
      item.assetId===metadata.assetId&&item.assetType===metadata.assetType&&
      item.sourceUrl===metadata.sourceUrl&&SHA.test(item.sha256)&&
      (metadata.contentSha256===null||item.sha256===metadata.contentSha256));
  };
  let saved=null;
  for(let repair=0;repair<3;repair++){
    const spec={jobKind:"video-asset-download",idempotencyKey:repair===0?key:`${key}:repair-${repair}`,
      nodes:[{nodeKey:"asset-download",nodeKind:"video.asset-download",maxAttempts:3,
        input:{...metadata,repairGeneration:repair},dependsOn:[]}]};
    saved=await request("/api/jobs",spec);
    if(typeof saved.job?.id!=="string"||saved.nodes?.length!==1||
      saved.nodes[0]?.nodeKey!=="asset-download"||typeof saved.nodes[0].id!=="string")
      throw Error("Media Jobs did not return a valid import attempt.");
    if(saved.job.state!=="SUCCEEDED")break;
    const found=await verified();
    if(found)return {...found,jobId:saved.job.id,reused:true};
  }
  if(saved?.job?.state==="SUCCEEDED")
    throw Error("This asset has exhausted its verified-cache repair attempts. Inspect its saved files in Jobs.");
  const jobId=saved.job.id,nodeId=saved.nodes[0].id;
  if(saved.created!==true&&saved.nodes[0].state==="RUNNING")
    saved=await request(`/api/jobs/${jobId}/recover-stale`,{});
  if(["FAILED","CANCELLED"].includes(saved.job?.state))
    saved=await request(`/api/jobs/${jobId}/retry`,{});
  if(saved.job?.state!=="RUNNING"||saved.nodes?.[0]?.state!=="READY")
    throw Error("This scene asset is already being prepared in Jobs. Wait for it to finish or retry after recovery.");
  const claim=await request(`/api/jobs/${jobId}/nodes/${nodeId}/start`,{});
  const attemptId=claim.attempt?.id;
  if(typeof attemptId!=="string")throw Error("Media Jobs did not confirm the worker claim.");
  const controller=new AbortController();
  const signal=externalSignal?AbortSignal.any([controller.signal,externalSignal]):controller.signal;
  let stopped=false,heartbeating=false,leaseError=null;
  const timer=setInterval(async()=>{
    if(stopped||heartbeating)return;
    heartbeating=true;
    try{
      const response=await request(`/api/jobs/${jobId}/nodes/${nodeId}/heartbeat`,{attemptId});
      if(response.alive!==true)throw Error("Media Jobs worker claim ended.");
    }catch{
      if(!stopped&&!leaseError){
        leaseError=Error("The media worker lost its Jobs claim. Retry after the current attempt is recovered.");
        controller.abort(leaseError);
      }
    }finally{heartbeating=false;}
  },heartbeatMs);
  timer.unref?.();
  try{
    if(signal.aborted)throw signal.reason??Error("Asset download was cancelled.");
    const existing=await verified();
    const asset=existing??await importer(input,{signal});
    if(leaseError)throw leaseError;
    if(signal.aborted)throw signal.reason??Error("Asset download was cancelled.");
    if(!asset||!SHA.test(asset.sha256)||!Number.isSafeInteger(asset.sizeBytes)||asset.sizeBytes<1)
      throw Error("Asset importer did not return a verified media artifact.");
    stopped=true;clearInterval(timer);
    await request(`/api/jobs/${jobId}/nodes/${nodeId}/succeed`,{attemptId,
      output:{provider:"pexels",assetId:metadata.assetId,sha256:asset.sha256,
        sizeBytes:asset.sizeBytes,reused:!!existing}});
    return {...asset,jobId,reused:!!existing};
  }catch(error){
    stopped=true;clearInterval(timer);
    // A revoked lease belongs to Rust recovery, not this process. Another
    // worker may already own the next attempt; never overwrite its state.
    if(leaseError)throw leaseError;
    if(externalSignal?.aborted){
      try{await request(`/api/jobs/${jobId}/cancel`,{});}
      catch{throw Error("Media import was cancelled but Jobs could not confirm cancellation.");}
      throw error;
    }
    try{await request(`/api/jobs/${jobId}/nodes/${nodeId}/fail`,{attemptId,
      errorCode:signal.aborted?"asset_download_interrupted":"asset_download_failed",
      errorDetail:"Scene media preparation failed. Retry to reuse valid downloaded files."});}
    catch{throw Error("Media import stopped and its Jobs failure could not be recorded. Restart the server and inspect Jobs.");}
    throw error;
  }finally{stopped=true;clearInterval(timer);}
}
