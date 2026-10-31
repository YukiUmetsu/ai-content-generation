/** Shot-specific stock/3D suggestions and explicitly approved local imports.
 * ContentGen owns provider provenance. These files are optional visual inputs;
 * none is automatically evidence for a claim or an approved Kumiki composition.
 */
import {createHash,randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import {mkdir, mkdtemp, lstat, readFile, readdir, rename, rm, writeFile} from "node:fs/promises";
import {basename, dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {promisify} from "node:util";
import {setTimeout as pause} from "node:timers/promises";
import {rankShotCandidates} from "./asset-matching.mjs";

export const DEFAULT_ROOT=fileURLToPath(new URL("../../../../data/studio-assets",import.meta.url));
const ID=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/u;
const MAX_FILE=80*1024*1024;
const MAX_JSON=18*1024*1024;
const UA="ContentGen-SceneAssets/1.0 (https://github.com/YukiUmetsu/ai-content-generation)";
const ABSTRACT=/\b(chart|graph|table|diagram|timeline|formula|percentage|interest|tax|flowchart|equation|calculation|numbers?|statistics|comparison|slide|text|headline|list)\b/iu;
const STOP=new Set(["the","a","an","of","for","from","to","and","with","on","in","by","how","why","cost","costs","shows","show","visual","asset","scene","actual","real","this","that","into","onto","using","running","their","every","still"]);
const SOFTWARE_TOOL=/(?:^|[^\p{L}\p{N}])([\p{L}\p{N}][\p{L}\p{N}'’-]{2,}(?:\s+[\p{L}\p{N}][\p{L}\p{N}'’-]{2,}){0,2})\s+(software|applications?|apps?|programs?|platforms?)\b/iu;
const DEVICE_WORD=new Set(["computer","laptop","screen","monitor","desktop","icon","logo","smartphone","tablet"]);
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const exec=promisify(execFile);
function ident(value,label){if(typeof value!=="string"||!ID.test(value))throw Error(`Invalid ${label} identifier.`);return value;}
function visible(value,max=170){return String(value??"").replace(/<[^>]*>/gu," ")
  .replace(/[\u0000-\u001f\u007f]/gu," ").replace(/\s+/gu," ").trim().slice(0,max);}
function terms(value){return visible(value).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(x=>x.length>=3&&!STOP.has(x)).slice(0,6);}
function boundedShots(bundle){
  const shots=bundle?.plan?.shots;
  if(!Array.isArray(shots)||shots.length<1||shots.length>60)throw Error("Provide a storyboard with 1–60 scenes.");
  if(shots.some(x=>!x||typeof x!=="object"||!ID.test(x.id)))throw Error("Storyboard has an invalid scene identifier.");
  if(new Set(shots.map(x=>x.id)).size!==shots.length)throw Error("Storyboard scene identifiers must be unique.");
  return shots;
}

function toolWord(value){
  if(/^app/iu.test(value))return "app";
  if(/^program/iu.test(value))return "program";
  if(/^platform/iu.test(value))return "platform";
  return "software";
}

/** A sentence that names software should look for that software on a computer, or its icon. */
export function softwarePicture(narration){
  const text=visible(narration,500);
  const named=/会計ソフト|会計アプリ|簿記ソフト/u.test(text)?
    {words:["accounting","software"]}:null;
  const match=named?null:SOFTWARE_TOOL.exec(text);
  const subject=(match?.[1]??"").split(/\s+/u)
    .filter(word=>word.length>=3&&!STOP.has(word.toLowerCase())).slice(-2)
    .map(word=>word.toLowerCase());
  const words=named?.words??(subject.length?[...subject,toolWord(match[2])]:[]);
  if(words.length<2)return null;
  return {query:`${words.join(" ")} laptop screen`,pictureWords:words,
    reason:"Look for a computer running this software, or its app icon."};
}

/** No LLM and no network. Pure semantic extraction with a meaningful no-stock decision. */
export function planSceneAssetNeeds(bundle){
  const spoken=new Map((Array.isArray(bundle?.plan?.sound)?bundle.plan.sound:[])
    .filter(item=>item&&typeof item.shotId==="string")
    .map(item=>[item.shotId,visible(item.narration,500)]));
  return boundedShots(bundle).map(shot=>{
    const picture=softwarePicture(spoken.get(shot.id));
    if(picture)return {shotId:shot.id,query:picture.query,pictureWords:picture.pictureWords,
      strategy:"search",reason:picture.reason};
    const subjects=Array.isArray(shot.visualElements)?shot.visualElements
      .map(x=>visible(x?.label,80)).filter(Boolean).slice(0,5):[];
    const tangible=subjects.filter(x=>!ABSTRACT.test(x));
    const label=tangible[0]??subjects[0]??visible(shot.purpose,100);
    const intent=visible(shot.visualChange,200);
    const queryTerms=terms(tangible.length?tangible.slice(0,3).join(" "):label);
    const strategy=(!queryTerms.length||ABSTRACT.test(label)||(!subjects.length&&ABSTRACT.test(intent)))?"kumiki":"search";
    return {shotId:shot.id,query:strategy==="search"?queryTerms.slice(0,3).join(" "):"",
      strategy,reason:strategy==="kumiki"?"Use Kumiki diagrams/graphics for abstract explanations; stock imagery would be decorative.":
        "Look for a real-world subject that can support this scene's explanation."};
  });
}

function providerUrl(url,hosts){
  let parsed;try{parsed=new URL(url);}catch{throw Error("Provider returned an invalid asset URL.");}
  if(parsed.protocol!=="https:"||!hosts.includes(parsed.hostname)||parsed.username||parsed.password||parsed.port)
    throw Error("Provider returned an untrusted asset host.");
  return parsed.toString();
}
async function readLimited(response,max){
  if(!response.ok)throw Error(`Asset provider returned HTTP ${response.status}.`);
  const declared=Number(response.headers.get("content-length")||0);
  if(declared>max)throw Error("Provider asset exceeds download limit.");
  const pieces=[];let size=0;
  for await(const chunk of response.body??[]){
    size+=chunk.byteLength;
    if(size>max){await response.body?.cancel?.().catch(()=>{});throw Error("Provider asset exceeds download limit.");}
    pieces.push(Buffer.from(chunk));
  }
  return Buffer.concat(pieces,size);
}
async function getJson(url,{fetchImpl=fetch,headers={},signal}={}){
  // A caller's cancellation signal must not remove the provider timeout.
  // Automatic production supplies a long-lived job signal; each individual
  // provider request is still limited to 15 seconds.
  const deadline=AbortSignal.timeout(15000);
  const r=await fetchImpl(url,{headers,redirect:"error",signal:signal?
    AbortSignal.any([signal,deadline]):deadline});
  try{return JSON.parse((await readLimited(r,MAX_JSON)).toString("utf8"));}
  catch(e){if(e instanceof SyntaxError)throw Error("Asset provider returned invalid JSON.");throw e;}
}
function polyCandidate(id,item,score){
  const assetType=({0:"hdri",1:"texture",2:"model"})[item.type];
  if(!assetType)return null;
  const preview=String(item.thumbnail_url??"");
  if(preview){try{providerUrl(preview,["cdn.polyhaven.com"]);}catch{return null;}}
  return {provider:"polyhaven",assetId:id,assetType,title:visible(item.name)||id,
    previewUrl:preview,sourceUrl:`https://polyhaven.com/a/${encodeURIComponent(id)}`,
    license:"CC0-1.0",licenseUrl:"https://polyhaven.com/license",
    creator:Object.keys(item.authors??{}).map(x=>visible(x,80)).filter(Boolean).join(", "),
    keywords:(Array.isArray(item.tags)?item.tags:[]).slice(0,12).map(x=>visible(x,80)),
    relevance:score,rightsStatus:"needs-human-review"};
}
const catalogCache={at:0,value:null};
async function polyCatalog(opts){
  if(!opts.fetchImpl&&catalogCache.value&&Date.now()-catalogCache.at<15*60*1000)return catalogCache.value;
  const data=await getJson("https://api.polyhaven.com/assets",{...opts,headers:{"User-Agent":UA}});
  if(!data||typeof data!=="object"||Array.isArray(data))throw Error("Poly Haven returned an invalid asset catalog.");
  if(!opts.fetchImpl){catalogCache.at=Date.now();catalogCache.value=data;}
  return data;
}
async function pexelsCandidates(query,opts){
  if(!opts.pexelsKey)return [];
  const url=`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=4&orientation=${opts.destination??"landscape"}`;
  const data=await getJson(url,{...opts,headers:{Authorization:opts.pexelsKey}});
  return (Array.isArray(data.photos)?data.photos:[]).slice(0,4).flatMap(item=>{
    if(!Number.isSafeInteger(item.id)||item.id<1)return [];
    let source,preview;
    try{source=providerUrl(item.url,["www.pexels.com","pexels.com"]);
      preview=providerUrl(item.src?.medium,["images.pexels.com"]);}catch{return [];}
    return [{provider:"pexels",assetId:String(item.id),assetType:"photo",
      title:visible(item.alt,120)||`Pexels photo ${item.id}`,previewUrl:preview,sourceUrl:source,
      license:"Pexels License",licenseUrl:"https://www.pexels.com/license/",
      creator:visible(item.photographer,100),
      ...(Number.isSafeInteger(item.width)&&item.width>0&&Number.isSafeInteger(item.height)&&item.height>0?
        {width:item.width,height:item.height}:{}),
      relevance:1,rightsStatus:"needs-human-review"}];
  });
}
const VIDEO_HOSTS=["videos.pexels.com","player.vimeo.com"];
function validPexelsVideoFiles(item){
  return (Array.isArray(item.video_files)?item.video_files:[]).filter(file=>{
    if(file?.file_type!=="video/mp4"||file.quality!=="hd"||
      !Number.isSafeInteger(file.width)||!Number.isSafeInteger(file.height)||
      Math.min(file.width,file.height)<720||Math.max(file.width,file.height)>1920)return false;
    try{providerUrl(file.link,VIDEO_HOSTS);return true;}catch{return false;}
  }).sort((a,b)=>a.width*a.height-b.width*b.height);
}
function pexelsVideoCandidate(item){
  if(!Number.isSafeInteger(item?.id)||item.id<1||
    !Number.isSafeInteger(item.duration)||item.duration<1||item.duration>90||
    !validPexelsVideoFiles(item).length)return null;
  let source,preview;
  try{source=providerUrl(item.url,["www.pexels.com","pexels.com"]);
    preview=providerUrl(item.image,["images.pexels.com"]);}catch{return null;}
  const slug=new URL(source).pathname.split("/").filter(Boolean).at(-1)??"";
  const title=visible(slug.replace(/-\d+$/u,"").replace(/[-_]/gu," "),120);
  const variant=validPexelsVideoFiles(item)[0];
  return {provider:"pexels",assetId:String(item.id),assetType:"video",
    title:title&&title!=="video"?title:`Pexels footage ${item.id}`,
    width:variant.width,height:variant.height,previewUrl:preview,sourceUrl:source,
    license:"Pexels License",licenseUrl:"https://www.pexels.com/license/",
    creator:visible(item.user?.name,100),durationSeconds:item.duration,
    relevance:1,rightsStatus:"needs-human-review"};
}
async function pexelsVideoCandidates(query,opts){
  if(!opts.pexelsKey)return [];
  const url=`https://api.pexels.com/v1/videos/search?query=${encodeURIComponent(query)}&per_page=4&orientation=${opts.destination??"landscape"}`;
  const data=await getJson(url,{...opts,headers:{Authorization:opts.pexelsKey}});
  return (Array.isArray(data.videos)?data.videos:[]).slice(0,4)
    .map(pexelsVideoCandidate).filter(Boolean);
}

function openverseCandidate(item){
  // Openverse catalogs third-party declarations; a CC0 search result is a
  // lead, never a verified ownership/license grant or an automatic download.
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(item?.id??"")||
    item.license!=="cc0"||!(["jpg","jpeg","png"].includes(String(item.filetype??"").toLowerCase()))||
    item.mature!==false||item.watermarked!==false||
    !Number.isSafeInteger(item.width)||!Number.isSafeInteger(item.height)||
    Math.max(item.width,item.height)<960||Math.min(item.width,item.height)<540)return null;
  let source;
  try{
    const url=new URL(item.foreign_landing_url);
    if(url.protocol!=="https:"||url.username||url.password||url.port||
      ["localhost","127.0.0.1","::1"].includes(url.hostname)||url.hostname.endsWith(".local"))return null;
    source=url.toString();
  }catch{return null;}
  const keywords=(Array.isArray(item.tags)?item.tags:[]).slice(0,12)
    .map(tag=>visible(tag?.name,60)).filter(Boolean);
  return {provider:"openverse",assetId:item.id.toLowerCase(),assetType:"photo",
    title:visible(item.title,120)||"Openverse CC0 photo",previewUrl:
      `https://api.openverse.org/v1/images/${item.id.toLowerCase()}/thumb/`,sourceUrl:source,
    license:"CC0-1.0 (unverified index)",licenseUrl:"https://creativecommons.org/publicdomain/zero/1.0/",
    creator:visible(item.creator,100),originProvider:visible(item.provider,60),keywords,
    width:item.width,height:item.height,relevance:0,rightsStatus:"needs-human-review"};
}
async function openverseCandidates(query,opts){
  const params=new URLSearchParams({q:query,page_size:"4",license:"cc0",mature:"false"});
  const data=await getJson(`https://api.openverse.org/v1/images/?${params}`,{
    ...opts,headers:{"User-Agent":UA,"Accept":"application/json"}});
  if(!data||!Array.isArray(data.results))throw Error("Openverse returned an invalid image catalog.");
  return data.results.slice(0,4).map(openverseCandidate).filter(Boolean);
}

/** One user-triggered search across scenes, bounded and read-only. */
export async function discoverShotAssets(input,opts={}){
  const needs=planSceneAssetNeeds(input?.bundle);
  if(input?.allowExternalSearch!==true)throw Error("Explicit approval is required before external asset search.");
  const destination=input.destination??"landscape";
  if(!["landscape","portrait"].includes(destination))throw Error("Unknown media matching destination.");
  const durations=input.sceneDurationsSeconds??{};
  if(!durations||typeof durations!=="object"||Array.isArray(durations)||
    Object.entries(durations).some(([shotId,seconds])=>!needs.some(x=>x.shotId===shotId)||
      typeof seconds!=="number"||!Number.isFinite(seconds)||seconds<=0||seconds>600))
    throw Error("Invalid per-scene narration duration override.");
  const providers=input.providers??["openverse"];
  if(!Array.isArray(providers)||providers.length>3||
    new Set(providers).size!==providers.length||providers.some(x=>!["polyhaven","pexels","openverse"].includes(x)))
    throw Error("Unknown asset search provider.");
  const warnings=[],byShot=new Map(needs.map(need=>[need.shotId,[]]));
  const active=needs.filter(x=>x.strategy==="search");
  if(active.length&&providers.includes("polyhaven")){
    warnings.push("Poly Haven search has been retired. Scenes use Openverse photos or Kumiki graphics.");
  }
  if(active.length&&providers.includes("pexels")){
    // Old saved UI search choices must not revive API credential collection
    // or background extraction against a retired provider.
    warnings.push("Pexels API search has been retired. Import an original from its website in Director.");
  }
  if(active.length&&providers.includes("openverse")){
    const cache=new Map(),queries=[...new Set(active.map(x=>x.query))].slice(0,8);
    for(let start=0;start<queries.length;start+=2){
      await Promise.all(queries.slice(start,start+2).map(async query=>{
        try{cache.set(query,await openverseCandidates(query,opts));}
        catch(error){warnings.push(`Openverse ${query}: ${visible(error?.message,120)}`);cache.set(query,[]);}
      }));
    }
    for(const need of active)byShot.get(need.shotId).push(...(cache.get(need.query)??[]));
    if(new Set(active.map(x=>x.query)).size>8)
      warnings.push("Openverse search was capped at eight distinct scene subjects.");
  }
  const sound=new Map((Array.isArray(input.bundle?.plan?.sound)?input.bundle.plan.sound:[])
    .filter(x=>x&&typeof x.shotId==="string").map(x=>[x.shotId,x]));
  const shots=new Map(input.bundle.plan.shots.map(shot=>[shot.id,shot]));
  return {schemaVersion:1,kind:"contentgen-scene-asset-suggestions",destination,
    providerCredit:"Assets via Openverse / Pexels",
    scenes:needs.map(need=>({...need,...rankShotCandidates({shot:shots.get(need.shotId),
      narration:sound.get(need.shotId),query:need.query,pictureWords:need.pictureWords,
      candidates:byShot.get(need.shotId),
      destination,durationSeconds:durations[need.shotId]})})),warnings};
}

function leaf(value){return value&&typeof value==="object"&&typeof value.url==="string"&&Number.isSafeInteger(value.size);}
function leaves(value,path=[],acc=[]){
  if(leaf(value)){acc.push({path,record:value});return acc;}
  if(!value||typeof value!=="object"||path.length>7)return acc;
  for(const [key,node] of Object.entries(value).slice(0,80))leaves(node,[...path,key],acc);
  return acc;
}
function polyFilesTree(tree,assetType){
  const all=leaves(tree);
  const suffix=assetType==="model"?/\.gltf(?:\?|$)/iu:assetType==="hdri"?/\.hdr(?:\?|$)/iu:/\.(?:jpe?g|png)(?:\?|$)/iu;
  const chosen=all.filter(x=>suffix.test(x.record.url)&&x.path.includes("1k")&&
    (assetType!=="texture"||x.path.some(p=>/diffuse|color|albedo/iu.test(p))));
  if(!chosen.length)throw Error(`Poly Haven has no small compatible ${assetType} format for automatic import. Open its asset page for a manual download.`);
  chosen.sort((a,b)=>a.record.size-b.record.size);
  const primary=chosen[0];
  const includes=primary.record.include??{};
  if(includes===null||typeof includes!=="object"||Array.isArray(includes))throw Error("Invalid Poly Haven file dependencies.");
  const files=[{name:assetType==="model"?"model.gltf":assetType==="hdri"?"environment.hdr":
    (primary.record.url.split("?")[0].toLowerCase().endsWith(".png")?"texture.png":"texture.jpg"),...primary.record}];
  for(const [name,record] of Object.entries(includes)){
    if(name.length>240||name.split("/").some(part=>!part||part==="."||part===".."||
      !/^[A-Za-z0-9_.-]{1,120}$/u.test(part))||!leaf(record))
      throw Error("Unsafe model dependency path.");
    files.push({name,...record});
  }
  if(files.length>32||new Set(files.map(x=>x.name)).size!==files.length)
    throw Error("Model contains too many or duplicate dependent files.");
  const total=files.reduce((n,x)=>n+x.size,0);
  if(!Number.isSafeInteger(total)||total>MAX_FILE)throw Error("Poly Haven asset exceeds the 80 MB import limit.");
  return files;
}
async function downloadFile(file,{fetchImpl=fetch,signal,provider}={}){
  const hosts=provider==="polyhaven"?["dl.polyhaven.org"]:
    provider==="pexels"?(file.name==="video.mp4"?VIDEO_HOSTS:["images.pexels.com"]):[];
  const url=providerUrl(file.url,hosts);
  if(!Number.isSafeInteger(file.size)||file.size<0||file.size>MAX_FILE)throw Error("Provider asset exceeds download limit.");
  // Provider GETs are idempotent. Retry *only* transient transport/server
  // failures, before any artifact is committed. Never retry malformed media,
  // untrusted hosts, rights denials, 429 or oversized responses.
  for(let attempt=0;attempt<3;attempt++){
    if(signal?.aborted)throw signal.reason??Error("Asset download cancelled.");
    const deadline=AbortSignal.timeout(60000);
    const requestSignal=signal?AbortSignal.any([signal,deadline]):deadline;
    try{
      const response=await fetchImpl(url,{redirect:"error",signal:requestSignal,headers:{"User-Agent":UA}});
      if(response.status===429)throw Error("Asset provider rate-limited downloads. Retry later.");
      if([408,500,502,503,504].includes(response.status)){
        await response.body?.cancel?.().catch(()=>{});
        const error=Error(`Asset provider temporarily unavailable (HTTP ${response.status}).`);
        error.retryable=true;throw error;
      }
      const contentType=(response.headers.get("content-type")??"").split(";")[0].trim().toLowerCase();
      if(provider==="pexels"&&file.name==="photo.jpg"&&contentType!=="image/jpeg")
        throw Error("Pexels photograph did not return JPEG media type.");
      if(provider==="pexels"&&file.name==="video.mp4"&&contentType!=="video/mp4")
        throw Error("Pexels footage did not return MP4 media type.");
      const bytes=await readLimited(response,MAX_FILE);
      if(provider==="pexels"&&file.name==="photo.jpg"&&
        (bytes.length<12||bytes[0]!==0xff||bytes[1]!==0xd8||bytes[2]!==0xff||
          bytes[bytes.length-2]!==0xff||bytes[bytes.length-1]!==0xd9))
        throw Error("Pexels photograph is not valid JPEG media.");
      if(file.name==="video.mp4"&&(bytes.length<12||bytes.toString("ascii",4,8)!=="ftyp"))
        throw Error("Provider did not return a compatible MP4 video file.");
      if(file.size&&bytes.length!==file.size){
        const error=Error("Incomplete provider download.");error.retryable=true;throw error;
      }
      if(file.md5&&createHash("md5").update(bytes).digest("hex")!==file.md5)
        throw Error("Downloaded asset failed provider integrity check.");
      return bytes;
    }catch(error){
      if(signal?.aborted)throw signal.reason??error;
      if(!(error.retryable||error instanceof TypeError||deadline.aborted))throw error;
      if(attempt===2)throw Error("Asset download failed after three attempts. Check your connection and retry the import.",{cause:error});
      await pause(250*2**attempt,undefined,{signal});
    }
  }
}
async function resolveAssetFiles(input,opts){
  if(input.provider==="polyhaven"){
    const catalog=await polyCatalog(opts);
    const info=catalog[input.assetId];
    if(!info||({0:"hdri",1:"texture",2:"model"})[info.type]!==input.assetType)
      throw Error("Selected asset is no longer available with the requested type.");
    const tree=await getJson(`https://api.polyhaven.com/files/${encodeURIComponent(input.assetId)}`,
      {...opts,headers:{"User-Agent":UA}});
    return {files:polyFilesTree(tree,input.assetType),meta:polyCandidate(input.assetId,info,0)};
  }
  if(input.provider==="pexels"&&input.assetType==="photo"){
    if(!opts.pexelsKey)throw Error("Set PEXELS_API_KEY locally before approving Pexels media.");
    const item=await getJson(`https://api.pexels.com/v1/photos/${encodeURIComponent(input.assetId)}`,
      {...opts,headers:{Authorization:opts.pexelsKey}});
    if(String(item?.id)!==input.assetId)throw Error("Pexels returned a different photograph identifier.");
    const url=providerUrl(item.src?.large??item.src?.original,["images.pexels.com"]);
    return {files:[{name:"photo.jpg",url,size:0}],meta:{provider:"pexels",assetId:input.assetId,
      assetType:"photo",title:visible(item.alt,120)||`Pexels photo ${input.assetId}`,
      sourceUrl:providerUrl(item.url,["www.pexels.com","pexels.com"]),
      license:"Pexels License",licenseUrl:"https://www.pexels.com/license/",
      creator:visible(item.photographer,100),
      ...(Number.isSafeInteger(item.width)&&item.width>0&&Number.isSafeInteger(item.height)&&item.height>0?
        {width:item.width,height:item.height}:{})}};
  }
  if(input.provider==="pexels"&&input.assetType==="video"){
    if(!opts.pexelsKey)throw Error("Set PEXELS_API_KEY locally before approving Pexels media.");
    const item=await getJson(`https://api.pexels.com/v1/videos/videos/${encodeURIComponent(input.assetId)}`,
      {...opts,headers:{Authorization:opts.pexelsKey}});
    if(String(item.id)!==input.assetId)throw Error("Pexels returned a different video identifier.");
    const candidate=pexelsVideoCandidate(item);
    if(!candidate)throw Error("Pexels video has no compatible short HD MP4 variant.");
    const variant=validPexelsVideoFiles(item)[0];
    const url=providerUrl(variant.link,VIDEO_HOSTS);
    return {files:[{name:"video.mp4",url,size:0}],meta:candidate};
  }
  throw Error("Unsupported asset type or provider.");
}

/** Draft-only automated Pexels acquisition. The official per-ID API response,
 * not a search result or caller-provided URL, determines the media bytes and
 * their source/creator/license metadata. It does not approve publication. */
export async function downloadPexelsDraftPhoto(assetId,opts={}){
  ident(assetId,"Pexels asset");
  if(!/^[1-9][0-9]{0,15}$/u.test(assetId))throw Error("Pexels photo ID is invalid.");
  const {files,meta}=await resolveAssetFiles({provider:"pexels",assetId,assetType:"photo"},opts);
  if(meta?.assetId!==assetId||meta?.assetType!=="photo"||
    meta.license!=="Pexels License"||meta.licenseUrl!=="https://www.pexels.com/license/")
    throw Error("Pexels did not verify the requested photograph and license.");
  const bytes=await downloadFile(files[0],{...opts,provider:"pexels"});
  return {bytes,meta};
}

/** Original, per-ID API-verified Pexels footage for an opted-in draft. The
 * caller must separately probe the downloaded MP4 codec and dimensions; this
 * endpoint never grants publication approval. */
export async function downloadPexelsDraftVideo(assetId,opts={}){
  ident(assetId,"Pexels asset");
  if(!/^[1-9][0-9]{0,15}$/u.test(assetId))throw Error("Pexels video ID is invalid.");
  const {files,meta}=await resolveAssetFiles({provider:"pexels",assetId,assetType:"video"},opts);
  if(meta?.assetId!==assetId||meta?.assetType!=="video"||
    meta.license!=="Pexels License"||meta.licenseUrl!=="https://www.pexels.com/license/"||
    !Number.isSafeInteger(meta.durationSeconds)||meta.durationSeconds<1||meta.durationSeconds>90)
    throw Error("Pexels did not verify the requested footage, duration or license.");
  const bytes=await downloadFile(files[0],{...opts,provider:"pexels"});
  return {bytes,meta};
}

/** User-approved import. No arbitrary user-supplied download URL is ever trusted. */
export async function approveAsset(input,opts={}){
  if(input?.confirmDownload!==true||input?.confirmRights!==true)
    throw Error("Explicit human approval of the asset, license and download is required.");
  const projectId=ident(input.projectId,"project"),shotId=ident(input.shotId,"scene"),
    assetId=ident(input.assetId,"asset");
  if(!["polyhaven","pexels"].includes(input.provider)||
    !["texture","hdri","model","photo","video"].includes(input.assetType))throw Error("Unknown asset provider/type.");
  const {files,meta}=await resolveAssetFiles({...input,assetId},opts);
  if(!meta)throw Error("Provider asset metadata could not be verified.");
  const root=resolve(opts.root??DEFAULT_ROOT);
  const sceneDir=join(root,projectId,shotId);
  await mkdir(sceneDir,{recursive:true,mode:0o700});
  const temp=await mkdtemp(join(sceneDir,".asset-import-"));
  try{
    const entries=[];
    for(const file of files){
      const bytes=await downloadFile(file,{...opts,provider:input.provider});
      await mkdir(dirname(join(temp,file.name)),{recursive:true,mode:0o700});
      await writeFile(join(temp,file.name),bytes,{flag:"wx",mode:0o600});
      entries.push({name:file.name,sha256:sha(bytes),sizeBytes:bytes.length});
    }
    const digest=sha(JSON.stringify({provider:input.provider,assetId,entries}));
    const finalDir=join(sceneDir,"asset_"+digest.slice(0,24));
    const primary=entries[0];
    const manifest={schemaVersion:1,kind:"contentgen-approved-asset",projectId,shotId,
      provider:input.provider,assetId,assetType:input.assetType,
      title:meta.title,sourceUrl:meta.sourceUrl,license:meta.license,licenseUrl:meta.licenseUrl,
      creator:meta.creator,...(Number.isSafeInteger(meta.durationSeconds)?{durationSeconds:meta.durationSeconds}:{}),
      ...(Number.isSafeInteger(meta.width)&&meta.width>0&&Number.isSafeInteger(meta.height)&&meta.height>0?
        {width:meta.width,height:meta.height}:{}),
      rightsStatus:"user-reviewed",approvedAt:(opts.now??(()=>new Date()))().toISOString(),
      sha256:primary.sha256,sizeBytes:entries.reduce((n,e)=>n+e.sizeBytes,0),files:entries};
    await writeFile(join(temp,"manifest.json"),JSON.stringify(manifest,null,2)+"\n",{flag:"wx",mode:0o600});
    try{await rename(temp,finalDir);}catch(error){
      if(error.code!=="EEXIST"&&error.code!=="ENOTEMPTY")throw error;
      const stored=JSON.parse(await readFile(join(finalDir,"manifest.json"),"utf8"));
      if(stored.sha256!==manifest.sha256)throw Error("Existing imported asset conflicts with a new download.");
    }
    return {...manifest,localPath:join(finalDir,primary.name),manifestPath:join(finalDir,"manifest.json")};
  }finally{await rm(temp,{recursive:true,force:true});}
}

/** Explicitly uploaded Pexels website download. Never contacts the Pexels API,
 * scrapes their website, or trusts caller-supplied filesystem paths. */
export async function importDownloadedPexelsAsset(input,bytes,opts={}){
  const projectId=ident(input?.projectId,"project"),shotId=ident(input?.shotId,"scene");
  if(input?.confirmRights!==true)throw Error("Review the Pexels page and license before importing.");
  if(!["photo","video"].includes(input.assetType))throw Error("Choose a JPEG photo or MP4 video.");
  let source;
  try{source=new URL(input.sourceUrl);}catch{throw Error("Paste the original Pexels photo or video page link.");}
  if(source.protocol!=="https:"||!["www.pexels.com","pexels.com"].includes(source.hostname)||
    source.username||source.password||source.port||source.search||source.hash)
    throw Error("Only a direct Pexels source page is accepted.");
  const match=/^\/(photo|video)\/(?:[a-z0-9-]*-)?([1-9][0-9]{0,15})\/?$/u.exec(source.pathname);
  if(!match||match[1]!==input.assetType)throw Error("The Pexels page must match your selected photo or video.");
  if(!Buffer.isBuffer(bytes)||bytes.length<128||bytes.length>MAX_FILE)
    throw Error("The downloaded file must be between 128 bytes and 80 MB.");
  if(input.assetType==="photo"&&!(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff))
    throw Error("This is not a JPEG photo. Download the JPG from Pexels.");
  if(input.assetType==="video"&&bytes.toString("ascii",4,8)!=="ftyp")
    throw Error("This is not an MP4 file. Download an MP4 from Pexels.");
  const root=resolve(opts.root??DEFAULT_ROOT),projectDir=join(root,projectId),sceneDir=join(projectDir,shotId);
  // Validate each parent before writing beneath it: mkdir(recursive) would
  // follow an existing per-project symlink before a later lstat could reject it.
  await mkdir(root,{recursive:true,mode:0o700});
  for(const path of [root,projectDir,sceneDir]){
    if(path!==root){
      try{await mkdir(path,{mode:0o700});}
      catch(error){if(error.code!=="EEXIST")throw error;}
    }
    const info=await lstat(path);
    if(!info.isDirectory()||info.isSymbolicLink())throw Error("Scene media folder must be a real local directory.");
  }
  const temp=await mkdtemp(join(sceneDir,".site-import-"));
  const filename=input.assetType==="photo"?"photo.jpg":"video.mp4";
  try{
    const path=join(temp,filename);
    await writeFile(path,bytes,{flag:"wx",mode:0o600});
    let probe;
    try{
      const result=opts.probe?await opts.probe(path):await exec("ffprobe",[
        "-v","error","-show_entries","stream=codec_name,width,height:format=duration","-of","json",path],
      {timeout:15000,maxBuffer:128*1024,windowsHide:true});
      probe=JSON.parse(result.stdout);
    }catch{throw Error("FFprobe could not verify the downloaded media. Install FFmpeg or choose another file.");}
    const stream=probe?.streams?.find(item=>item.codec_name===(input.assetType==="photo"?"mjpeg":"h264"));
    const width=stream?.width,height=stream?.height;
    if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||
      width<640||height<360||width>8192||height>8192)
      throw Error("Downloaded media has an unsupported codec or resolution.");
    const duration=input.assetType==="video"?Number(probe.format?.duration):null;
    if(input.assetType==="video"&&(!Number.isFinite(duration)||duration<0.1||duration>90||
      Math.min(width,height)<720))
      throw Error("Choose an H.264 MP4 no longer than 90 seconds with at least HD resolution.");
    const assetId=match[2],digest=sha(JSON.stringify({provider:"pexels",assetId,
      fileHash:sha(bytes),sourceUrl:source.href})),finalDir=join(sceneDir,"asset_"+digest.slice(0,24));
    const title=visible(source.pathname.split("/")[2].replace(/-[0-9]+$/u,"").replaceAll("-"," "),140)||`Pexels ${input.assetType}`;
    const manifest={schemaVersion:1,kind:"contentgen-approved-asset",projectId,shotId,
      provider:"pexels",assetId,assetType:input.assetType,title,sourceUrl:source.href,
      license:"Pexels License",licenseUrl:"https://www.pexels.com/license/",
      creator:visible(input.creator,100),width,height,
      ...(duration===null?{}:{durationSeconds:duration}),
      acquisition:opts.acquisition==="website-page-download"?"website-page-download":"user-downloaded-from-website",
      rightsStatus:"user-reviewed",
      approvedAt:(opts.now??(()=>new Date()))().toISOString(),
      sha256:sha(bytes),sizeBytes:bytes.length,
      files:[{name:filename,sha256:sha(bytes),sizeBytes:bytes.length}]};
    await writeFile(join(temp,"manifest.json"),JSON.stringify(manifest,null,2)+"\n",{flag:"wx",mode:0o600});
    try{await rename(temp,finalDir);}
    catch(error){
      if(error.code!=="EEXIST"&&error.code!=="ENOTEMPTY")throw error;
      const info=await lstat(finalDir);
      if(!info.isDirectory()||info.isSymbolicLink())throw Error("An invalid asset folder already exists.");
      const manifestFile=join(finalDir,"manifest.json"),manifestInfo=await lstat(manifestFile);
      if(!manifestInfo.isFile()||manifestInfo.isSymbolicLink()||manifestInfo.size>12_000)
        throw Error("An invalid asset manifest already exists.");
      const existing=JSON.parse(await readFile(manifestFile,"utf8"));
      if(existing.sha256!==manifest.sha256||existing.sourceUrl!==manifest.sourceUrl)
        throw Error("Existing asset conflicts with the uploaded file.");
      const existingMedia=join(finalDir,filename);
      let healthy=false;
      try{
        const mediaInfo=await lstat(existingMedia);
        healthy=mediaInfo.isFile()&&!mediaInfo.isSymbolicLink()&&
          mediaInfo.size===bytes.length&&sha(await readFile(existingMedia))===manifest.sha256;
      }catch(error){if(error.code!=="ENOENT")throw error;}
      if(!healthy){
        // The new bytes have already passed FFprobe and digest verification.
        // Preserve modified/missing originals in quarantine instead of
        // replacing user data in place or silently accepting a bad cache.
        const quarantine=join(sceneDir,".damaged-"+randomUUID());
        await rename(finalDir,quarantine);
        try{await rename(temp,finalDir);}
        catch(error){
          // A failed replacement must not strand the original directory when
          // it can still be restored. Never delete the quarantined bytes.
          try{await rename(quarantine,finalDir);}
          catch{throw Error("The replacement failed; the original asset is preserved in a damaged-media quarantine.",{cause:error});}
          throw error;
        }
      }
    }
    return {...manifest,localPath:join(finalDir,filename),manifestPath:join(finalDir,"manifest.json")};
  }finally{await rm(temp,{recursive:true,force:true});}
}

/** Single explicit, user-selected website photo download. This is not a
 * search crawler: one public source page, one image from Pexels' image CDN,
 * no credentials or retries around a denial/challenge. */
export async function importPexelsPhotoPage(input,opts={}){
  if(input?.assetType!=="photo"||input?.confirmRights!==true)
    throw Error("Choose a Pexels photo page and confirm its license review.");
  let page;
  try{page=new URL(input.sourceUrl);}catch{throw Error("Paste a Pexels photo page URL.");}
  if(page.protocol!=="https:"||!["www.pexels.com","pexels.com"].includes(page.hostname)||
    page.username||page.password||page.port||page.search||page.hash)
    throw Error("Only a direct Pexels photo page is accepted.");
  const match=/^\/photo\/(?:[a-z0-9-]*-)?([1-9][0-9]{0,15})\/?$/u.exec(page.pathname);
  if(!match)throw Error("Paste the original Pexels photo page, not a search or download URL.");
  const fetchImpl=opts.fetchImpl??fetch;
  const signal=opts.signal?AbortSignal.any([opts.signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000);
  const get=async(url,max,type)=>{
    const response=await fetchImpl(url,{redirect:"error",signal,
      headers:{"Accept":type==="html"?"text/html":"image/jpeg"}});
    if(!response.ok)throw Error("Pexels did not allow this website download. Use a manually downloaded JPG instead.");
    const contentType=response.headers.get("content-type")??"";
    if(type==="html"&&!contentType.includes("text/html")||
      type==="image"&&!contentType.includes("image/jpeg"))
      throw Error("Pexels returned an unexpected page or file type. Download the JPG manually.");
    const declared=Number(response.headers.get("content-length")??0);
    if(declared>max)throw Error("Pexels file exceeds the safe download limit.");
    const parts=[];let size=0;
    for await(const chunk of response.body??[]){
      size+=chunk.length;
      if(size>max)throw Error("Pexels file exceeds the safe download limit.");
      parts.push(Buffer.from(chunk));
    }
    return Buffer.concat(parts,size);
  };
  let html;
  try{html=(await get(page.href,1_000_000,"html")).toString("utf8");}
  catch(error){if(error?.name==="TimeoutError")throw Error("Pexels website download timed out. Download the JPG manually.");throw error;}
  // Only parse a bounded public og:image URL; HTML is never executed.
  const tags=html.match(/<meta\b[^>]{0,1500}>/giu)??[];
  let cdnUrl=null;
  for(const tag of tags.slice(0,250)){
    if(!/\b(?:property|name)\s*=\s*(["'])og:image\1/iu.test(tag))continue;
    const content=/\bcontent\s*=\s*(["'])([^"']{1,1200})\1/iu.exec(tag)?.[2];
    if(!content)continue;
    try{
      const parsed=new URL(content.replaceAll("&amp;","&"));
      if(parsed.protocol==="https:"&&parsed.hostname==="images.pexels.com"&&
        !parsed.username&&!parsed.password&&!parsed.port&&
        parsed.pathname.startsWith(`/photos/${match[1]}/`)&&
        /\.(?:jpe?g)$/iu.test(parsed.pathname))cdnUrl=parsed.href;
    }catch{/* A third-party image host must never be fetched. */}
    if(cdnUrl)break;
  }
  if(!cdnUrl)throw Error("Pexels photo download is not available from the public page. Download the JPG manually.");
  const bytes=await get(cdnUrl,MAX_FILE,"image");
  return importDownloadedPexelsAsset(input,bytes,{...opts,acquisition:"website-page-download"});
}

/** Scene-linked immutable local approvals are discoverable by the renderer adapter. */
export async function listApprovedAssets({projectId},{root=DEFAULT_ROOT}={}){
  const base=join(resolve(root),ident(projectId,"project"));
  const result=[];
  for(const shot of (await readdir(base,{withFileTypes:true}).catch(e=>e.code==="ENOENT"?[]:Promise.reject(e)))){
    if(!shot.isDirectory()||!ID.test(shot.name))continue;
    const dir=join(base,shot.name);
    for(const asset of await readdir(dir,{withFileTypes:true})){
      if(!asset.isDirectory()||!/^asset_[a-f0-9]{24}$/u.test(asset.name))continue;
      try{
        const path=join(dir,asset.name),raw=await readFile(join(path,"manifest.json"),"utf8");
        const meta=JSON.parse(raw);
        if(meta.kind!=="contentgen-approved-asset"||meta.projectId!==projectId||meta.shotId!==shot.name||
          meta.rightsStatus!=="user-reviewed"||!Array.isArray(meta.files)||
          !meta.files.length||meta.files.length>32||!ID.test(meta.assetId)||
          !/^[a-f0-9]{64}$/u.test(meta.sha256)||meta.files[0].sha256!==meta.sha256)continue;
        let size=0,integrity=true;
        for(const file of meta.files){
          if(typeof file.name!=="string"||file.name.length>240||file.name.split("/").some(part=>
            !/^[A-Za-z0-9_.-]{1,120}$/u.test(part)||part==="."||part==="..")||
            file.name.includes("\\")||!/^[a-f0-9]{64}$/u.test(file.sha256)||
            !Number.isSafeInteger(file.sizeBytes)||file.sizeBytes<0){integrity=false;break;}
          const bytes=await readFile(join(path,file.name));
          size+=bytes.length;
          if(bytes.length!==file.sizeBytes||sha(bytes)!==file.sha256){integrity=false;break;}
        }
        if(!integrity||size!==meta.sizeBytes||size>MAX_FILE)continue;
        const localPath=join(path,basename(meta.files[0].name));
        result.push({...meta,localPath,manifestPath:join(path,"manifest.json")});
      }catch{ /* An invalid/partial imported asset cannot appear as approved. */ }
    }
  }
  return result.slice(0,1000);
}

const SELECTION_FILE="scene-media-selection.json";
export function isMediaFocalPoint(value){
  return value!==null&&typeof value==="object"&&!Array.isArray(value)&&
    Object.keys(value).length===2&&Object.keys(value).every(key=>["x","y"].includes(key))&&
    [value.x,value.y].every(number=>typeof number==="number"&&Number.isFinite(number)&&
      number>=0&&number<=1&&Math.abs(number*1000-Math.round(number*1000))<1e-9);
}
/** Pin an approved content hash, never a client URL or filesystem path. */
export async function selectApprovedSceneAsset(input,opts={}){
  const projectId=ident(input?.projectId,"project"),shotId=ident(input?.shotId,"scene"),
    assetId=ident(input?.assetId,"asset");
  if(!/^[a-f0-9]{64}$/u.test(input?.sha256??"")||
    !["pexels","polyhaven"].includes(input?.provider))throw Error("Invalid selected asset reference.");
  const approved=(await listApprovedAssets({projectId},opts)).find(x=>x.shotId===shotId&&
    x.provider===input.provider&&x.assetId===assetId&&x.sha256===input.sha256);
  if(!approved)throw Error("Cannot select an asset that is not currently approved and hash-verified for this scene.");
  if(input.focalPoint!==undefined&&(!isMediaFocalPoint(input.focalPoint)||
    !["photo","video"].includes(approved.assetType)))
    throw Error("Media framing must be an exact 0–100% horizontal and vertical focal position for a photo or video.");
  const root=resolve(opts.root??DEFAULT_ROOT),sceneDir=join(root,projectId,shotId);
  const selection={schemaVersion:1,kind:"contentgen-scene-media-selection",
    projectId,shotId,provider:approved.provider,assetId,assetType:approved.assetType,
    sha256:approved.sha256,selectedAt:(opts.now??(()=>new Date()))().toISOString(),
    ...(input.focalPoint===undefined?{}:{focalPoint:input.focalPoint})};
  const temp=await mkdtemp(join(sceneDir,".selection-"));
  try{
    const stage=join(temp,SELECTION_FILE);
    await writeFile(stage,JSON.stringify(selection,null,2)+"\n",{flag:"wx",mode:0o600});
    await rename(stage,join(sceneDir,SELECTION_FILE));
  }finally{await rm(temp,{recursive:true,force:true});}
  return {...approved,selectedAt:selection.selectedAt,
    ...(selection.focalPoint?{focalPoint:selection.focalPoint}:{})};
}

/** Invalidated selections remain visible as review-required, never accepted as media. */
export async function listSelectedSceneAssets({projectId},{root=DEFAULT_ROOT}={}){
  ident(projectId,"project");
  const base=join(resolve(root),projectId);
  const approved=await listApprovedAssets({projectId},{root});
  const selections=[],invalidShots=[];
  const shots=await readdir(base,{withFileTypes:true}).catch(e=>e.code==="ENOENT"?[]:Promise.reject(e));
  for(const shot of shots){
    if(!shot.isDirectory()||!ID.test(shot.name))continue;
    let record;
    try{record=JSON.parse(await readFile(join(base,shot.name,SELECTION_FILE),"utf8"));}
    catch(e){if(e.code==="ENOENT")continue;invalidShots.push(shot.name);continue;}
    if(record?.kind!=="contentgen-scene-media-selection"||record.schemaVersion!==1||
      record.projectId!==projectId||record.shotId!==shot.name||
      record.focalPoint!==undefined&&!isMediaFocalPoint(record.focalPoint)){
      invalidShots.push(shot.name);continue;}
    const valid=approved.find(x=>x.shotId===shot.name&&x.provider===record.provider&&
      x.assetId===record.assetId&&x.assetType===record.assetType&&x.sha256===record.sha256);
    if(!valid){invalidShots.push(shot.name);continue;}
    selections.push({...valid,selectedAt:record.selectedAt,
      ...(record.focalPoint===undefined?{}:{focalPoint:record.focalPoint})});
  }
  return {schemaVersion:1,kind:"contentgen-scene-media-selections",selections,invalidShots};
}

export async function clearSelectedSceneAsset({projectId,shotId},{root=DEFAULT_ROOT}={}){
  const path=join(resolve(root),ident(projectId,"project"),ident(shotId,"scene"),SELECTION_FILE);
  await rm(path,{force:true});
  return {projectId,shotId,cleared:true};
}
