/** Opted-in, provider-licensed draft imagery. These are not user-approved
 * media or proof of any claim: human publication review remains necessary.
 * Manual scene pins always take priority over this opportunistic enrichment.
 */
import {createHash,randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {lstat,mkdir,readFile,rename,rm,writeFile} from "node:fs/promises";
import {join,parse,resolve} from "node:path";
import {downloadPexelsDraftPhoto} from "./asset-discovery.mjs";

const exec=promisify(execFile);
const sha=value=>createHash("sha256").update(value).digest("hex");
const ID=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/u;
const DIGEST=/^[a-f0-9]{64}$/u;
const PHOTO_ID=/^[1-9][0-9]{0,15}$/u;
const LIMIT=80*1024*1024;
const MAX_AUTOMATIC=3; // at most 240 MB of downloaded photos per production
const generic=/^(?:image|photo|stock|footage|video|pexels|beautiful|people|happy|nature)(?:\b|$)/iu;

async function probeJpeg(path,{ffprobe="ffprobe",signal}={}){
  const {stdout}=await exec(ffprobe,["-v","error","-select_streams","v:0",
    "-show_entries","stream=codec_name,width,height","-of","json",path],
  {signal,timeout:30000,maxBuffer:32*1024});
  let info;
  try{info=JSON.parse(stdout).streams?.[0];}catch{throw Error("Image probe returned unreadable data.");}
  return {codec:info?.codec_name,width:info?.width,height:info?.height};
}

function eligible(candidate){
  return candidate?.provider==="pexels"&&candidate.assetType==="photo"&&
    PHOTO_ID.test(candidate.assetId??"")&&candidate.match?.grade==="strong"&&
    Number.isFinite(candidate.match.score)&&candidate.match.score>=60&&
    typeof candidate.title==="string"&&candidate.title.length>5&&!generic.test(candidate.title.trim())&&
    candidate.license==="Pexels License"&&candidate.licenseUrl==="https://www.pexels.com/license/"&&
    typeof candidate.sourceUrl==="string"&&/^https:\/\/(?:www\.)?pexels\.com\/photo\//u.test(candidate.sourceUrl);
}

function isJpeg(bytes){
  return bytes instanceof Uint8Array&&bytes.length>=12&&bytes.length<=LIMIT&&
    bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff&&
    bytes[bytes.length-2]===0xff&&bytes[bytes.length-1]===0xd9;
}

async function verifiedFile(path,digest,expectedSize){
  const entry=await lstat(path);
  if(!entry.isFile()||entry.isSymbolicLink()||entry.size!==expectedSize||
    expectedSize<12||expectedSize>LIMIT)throw Error("Cached draft image has invalid size or type.");
  const bytes=await readFile(path);
  if(!isJpeg(bytes)||sha(bytes)!==digest)throw Error("Cached draft image failed integrity verification.");
  return bytes;
}

async function cachedDraft({directory,identity,candidate,outputDir,ffprobe,signal,probePhoto}){
  if(!directory)return null;
  const source=resolve(directory),target=resolve(outputDir);
  if(source===parse(source).root||source===process.cwd()||source===resolve(process.cwd(),".."))
    throw Error("Untrusted draft cache directory.");
  const recordPath=join(source,`${identity}.json`);
  let record;
  try{
    const entry=await lstat(recordPath);
    if(!entry.isFile()||entry.isSymbolicLink()||entry.size>2048)
      throw Error("Cached draft metadata must be an owned small regular file.");
    record=JSON.parse(await readFile(recordPath,"utf8"));
  }catch(error){if(error?.code==="ENOENT")return null;throw error;}
  if(record.identity!==identity||record.assetId!==candidate.assetId||!DIGEST.test(record.sha256??"")||
    !Number.isSafeInteger(record.bytes)||record.bytes>LIMIT||record.bytes<12||
    record.license!=="Pexels License"||record.licenseUrl!=="https://www.pexels.com/license/"||
    !/^https:\/\/(?:www\.)?pexels\.com\/photo\//u.test(record.sourceUrl??""))
    throw Error("Cached draft photo has invalid provenance.");
  const path=join(source,`${record.sha256}.jpg`);
  const bytes=await verifiedFile(path,record.sha256,record.bytes);
  const details=await probePhoto(path,{ffprobe,signal});
  if(details.codec!=="mjpeg"||!Number.isSafeInteger(details.width)||
    !Number.isSafeInteger(details.height)||details.width<720||details.height<720||
    details.width>8192||details.height>8192)
    throw Error("Cached draft photo no longer decodes at an acceptable resolution.");
  if(source!==target){
    await mkdir(target,{recursive:true,mode:0o700});
    const destination=join(target,`${record.sha256}.jpg`);
    try{await verifiedFile(destination,record.sha256,record.bytes);}
    catch(error){
      if(error?.code!=="ENOENT")throw error;
      await writeFile(destination,bytes,{flag:"wx",mode:0o600});
    }
    await writeFile(join(target,`${identity}.json`),JSON.stringify(record),{flag:"wx",mode:0o600})
      .catch(error=>{if(error?.code!=="EEXIST")throw error;});
  }
  return {record,details,path:join(target,`${record.sha256}.jpg`)};
}

/** @returns {{bindings:object,assets:object[],fingerprint:string,prepared:number,warnings:string[]}} */
export async function prepareAutomaticDraftMedia({suggestions,shotMap,existing,outputDir,
  previousOutputDir,pexelsKey,signal,sceneJobs,ffprobe},
{downloadPhoto=downloadPexelsDraftPhoto,probePhoto=probeJpeg}={}){
  if(!Array.isArray(shotMap)||shotMap.length>60||!existing?.bindings||
    typeof outputDir!=="string"||!outputDir.trim()||
    [parse(resolve(outputDir)).root,process.cwd(),resolve(process.cwd(),"..")].includes(resolve(outputDir)))
    throw Error("Automated draft media requires an owned scene folder and scene mapping.");
  const result={bindings:{...existing.bindings},assets:[...(existing.assets??[])],
    fingerprint:existing.fingerprint??sha("empty-media"),prepared:0,warnings:[]};
  if(!pexelsKey||!suggestions||suggestions.kind!=="contentgen-scene-asset-suggestions"||
    !Array.isArray(suggestions.scenes)||suggestions.scenes.length>60)return result;
  const shots=new Map(shotMap.map(item=>[item.shotId,item.beatId]));
  if(shots.size!==shotMap.length||shotMap.some(item=>!ID.test(item.shotId)||!ID.test(item.beatId)))
    throw Error("Automated draft media has invalid scene references.");
  const used=new Set(Object.values(result.bindings).filter(item=>item.provider==="pexels")
    .map(item=>String(item.assetId)));
  for(const scene of suggestions.scenes){
    if(result.prepared>=MAX_AUTOMATIC)break;
    if(signal?.aborted)throw signal.reason??Error("Draft media preparation cancelled.");
    const beatId=shots.get(scene?.shotId);
    if(!beatId||result.bindings[beatId]||!Array.isArray(scene.candidates))continue;
    const candidate=scene.candidates.find(item=>eligible(item)&&!used.has(item.assetId));
    if(!candidate)continue;
    used.add(candidate.assetId);
    const identity=sha(JSON.stringify({provider:"pexels",shotId:scene.shotId,
      assetId:candidate.assetId,license:"Pexels License"}));
    let attempt=null,temporary=null,jobClaimFailed=false;
    try{
      // A verified cache is reusable even if the last worker finished its
      // Jobs attempt before the application was killed.
      let cached=await cachedDraft({directory:outputDir,identity,candidate,outputDir,
        ffprobe,signal,probePhoto});
      if(!cached&&previousOutputDir)cached=await cachedDraft({directory:previousOutputDir,
        identity,candidate,outputDir,ffprobe,signal,probePhoto});
      if(signal?.aborted)throw signal.reason??Error("Draft media preparation cancelled.");
      if(!cached){
        try{attempt=await sceneJobs?.beginScene({kind:"asset-download",sceneId:beatId,fingerprint:identity});}
        catch(error){jobClaimFailed=true;throw error;}
      }
      const downloaded=cached?null:await downloadPhoto(candidate.assetId,{pexelsKey,signal});
      const bytes=downloaded?.bytes,meta=downloaded?.meta;
      let details,digest,destination,source;
      if(cached){
        ({details,path:destination}=cached);
        digest=cached.record.sha256;
        source=cached.record;
      }else{
      if(!isJpeg(bytes)||meta?.provider!=="pexels"||meta.assetType!=="photo"||
        meta.assetId!==candidate.assetId||meta.license!=="Pexels License"||
        meta.licenseUrl!=="https://www.pexels.com/license/"||
        !/^https:\/\/(?:www\.)?pexels\.com\/photo\//u.test(meta.sourceUrl??""))
        throw Error("Pexels original image failed format, source or rights verification.");
      await mkdir(outputDir,{recursive:true,mode:0o700});
      temporary=join(outputDir,`.draft-photo-${randomUUID()}.jpg`);
      await writeFile(temporary,bytes,{flag:"wx",mode:0o600});
      details=await probePhoto(temporary,{ffprobe,signal});
      if(details.codec!=="mjpeg"||!Number.isSafeInteger(details.width)||
        !Number.isSafeInteger(details.height)||details.width<720||details.height<720||
        details.width>8192||details.height>8192)
        throw Error("Pexels original must decode as a suitable JPEG of at least 720 pixels per side.");
      digest=sha(bytes);destination=join(outputDir,`${digest}.jpg`);
      try{
        const saved=await lstat(destination);
        if(!saved.isFile()||saved.isSymbolicLink()||saved.size!==bytes.length||
          sha(await readFile(destination))!==digest)
          throw Error("Previously prepared scene image is damaged and cannot be reused.");
      }catch(error){
        if(error.code!=="ENOENT")throw error;
        await rename(temporary,destination);temporary=null;
      }
      source={identity,assetId:candidate.assetId,sha256:digest,bytes:bytes.length,
        sourceUrl:meta.sourceUrl,license:meta.license,licenseUrl:meta.licenseUrl,
        creator:meta.creator??""};
      const recordPath=join(outputDir,`${identity}.json`);
      const tempRecord=join(outputDir,`.draft-manifest-${randomUUID()}.json`);
      try{
        await writeFile(tempRecord,JSON.stringify(source),{flag:"wx",mode:0o600});
        await rename(tempRecord,recordPath);
      }finally{await rm(tempRecord,{force:true});}
      }
      if(signal?.aborted)throw signal.reason??Error("Draft media preparation cancelled.");
      if(attempt)await sceneJobs.completeScene(attempt,{sha256:digest,reused:false});
      const url=`/__video_media/${digest}.jpg`;
      result.bindings[beatId]={assetType:"photo",url,sha256:digest,provider:"pexels",
        assetId:candidate.assetId,sourceUrl:source.sourceUrl,license:source.license,
        licenseUrl:source.licenseUrl,creator:source.creator??"",width:details.width,
        height:details.height,rightsStatus:"draft-provider-license",automaticallyPrepared:true};
      result.assets.push({url,path:destination,sha256:digest,assetType:"photo"});
      result.prepared++;
    }catch(error){
      if(attempt)await sceneJobs.failScene(attempt,error);
      if(signal?.aborted||jobClaimFailed)throw error;
      // A provider outage must not prevent Kumiki from rendering the scene.
      // Never persist third-party error bodies: they can include secrets.
      result.warnings.push(`Scene ${scene.shotId}: original photo unavailable; using Kumiki visuals.`);
    }finally{if(temporary)await rm(temporary,{force:true});}
  }
  if(result.prepared)result.fingerprint=sha(JSON.stringify({pinned:existing.fingerprint,
    automatic:Object.entries(result.bindings).filter(([,item])=>item.automaticallyPrepared)
      .map(([id,item])=>[id,item.sha256]).sort((a,b)=>a[0].localeCompare(b[0]))}));
  return result;
}
