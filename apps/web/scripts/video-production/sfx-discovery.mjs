/** CC0 sound-effect discovery and a reusable, rights-reviewed local sound bank.
 * Openverse indexes external metadata; its license claims are not verification.
 * The first actual download always requires a person to check the source.
 */
import {createHash} from "node:crypto";
import {mkdir,mkdtemp,readFile,readdir,rename,rm,writeFile} from "node:fs/promises";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {setTimeout as pause} from "node:timers/promises";

const exec=promisify(execFile);
const DEFAULT_ROOT=fileURLToPath(new URL("../../../../data/studio-sfx",import.meta.url));
const UUID=/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu;
const ID=/^[a-z0-9][a-z0-9_-]{0,95}$/iu;
const MAX_AUDIO=16*1024*1024;
const STOP=new Set(["a","an","and","the","as","for","on","this","that","then","with", "sound","effect","sfx", "soft","subtle","loud","quiet","play","add","background","audio","reveal"]);
const clean=(value,max=180)=>String(value??"").replace(/<[^>]*>/gu," ")
  .replace(/[\u0000-\u001f\u007f]/gu," ").replace(/\s+/gu," ").trim().slice(0,max);
const terms=value=>[...new Set(clean(value).toLowerCase().split(/[^\p{L}\p{N}]+/u)
  .filter(x=>x.length>=3&&!STOP.has(x)))].slice(0,12);
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
function validId(value,label,pattern=ID){if(typeof value!=="string"||!pattern.test(value))throw Error(`Invalid ${label}.`);return value;}
function safeUrl(input,hosts){let url;try{url=new URL(input);}catch{throw Error("Invalid external sound URL.");}
  if(url.protocol!=="https:"||url.port||url.username||url.password||!hosts.includes(url.hostname))
    throw Error("Untrusted sound host or URL.");return url.toString();}
function safeMediaUrl(input){
  const value=safeUrl(input,["upload.wikimedia.org","cdn.freesound.org","freesound.org"]);
  const url=new URL(value);
  if(url.hostname==="freesound.org"&&!/^\/data\/previews\/[\w/.-]+\.(mp3|ogg)$/iu.test(url.pathname))
    throw Error("Untrusted Freesound media path.");
  return value;
}
function boundedShots(bundle){const shots=bundle?.plan?.shots;
  if(!Array.isArray(shots)||shots.length<1||shots.length>160)throw Error("A storyboard with 1–160 shots is required.");
  if(shots.some(x=>!x||!ID.test(x.id??""))||new Set(shots.map(x=>x.id)).size!==shots.length)
    throw Error("Invalid or duplicate shot identifier.");
  return shots;}

/** Intentional sound only. Silence is not an error or an unfilled placeholder. */
export function planSfxNeeds(bundle){
  const shots=boundedShots(bundle),sounds=Array.isArray(bundle?.plan?.sound)?bundle.plan.sound:[];
  const byShot=new Map(sounds.filter(x=>x&&typeof x.shotId==="string").map(x=>[x.shotId,x]));
  return shots.flatMap(shot=>{
    const intent=clean(byShot.get(shot.id)?.sfxIntent,220);
    const subject=terms(intent).slice(0,5).join(" ");
    return subject?[{shotId:shot.id,intent,query:subject}]:[];
  });
}
function soundMeta(data,{assetType="sfx"}={}){
  const category=assetType==="music"?"music":"sound_effect";
  if(!data||typeof data!=="object"||!UUID.test(data.id??"")||String(data.license??"").toLowerCase()!=="cc0"||
    data.category!==category)return null;
  let sourceUrl,previewUrl;
  try{sourceUrl=safeUrl(data.foreign_landing_url,["commons.wikimedia.org","freesound.org","www.freesound.org"]);
    previewUrl=safeMediaUrl(data.url);}catch{return null;}
  // Openverse returns milliseconds, whereas Studio shows seconds.
  // Existing reviewed-audio bank is capped at 16 MiB after PCM conversion.
  if(!Number.isFinite(data.duration)||data.duration<=0||data.duration>(assetType==="music"?150_000:90_000))return null;
  return {provider:"openverse",assetId:data.id,assetType,title:clean(data.title,140)||"Untitled audio",
    creator:clean(data.creator,120),durationSeconds:data.duration/1000,sourceUrl,previewUrl,
    license:"cc0",licenseUrl:"https://creativecommons.org/publicdomain/zero/1.0/",
    source:clean(data.source,40),tags:(Array.isArray(data.tags)?data.tags:[]).slice(0,16)
      .map(x=>clean(typeof x==="string"?x:x?.name,40)).filter(Boolean),rightsStatus:"needs-human-review"};
}
async function readJson(response){if(!response.ok)throw Error(`Openverse returned HTTP ${response.status}.`);
  const chunks=[];let size=0;
  for await(const chunk of response.body??[]){size+=chunk.length;if(size>800_000)throw Error("Openverse response too large.");chunks.push(chunk);}
  let value;try{value=JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{throw Error("Invalid Openverse response.");}
  if(!value||typeof value!=="object")throw Error("Invalid Openverse response.");return value;}
function similarity(intent,asset){const sought=terms(intent),words=new Set(terms(`${asset.title} ${(asset.tags??[]).join(" ")}`));
  return sought.filter(x=>words.has(x)).length;}

/** Metadata-only suggestions. No download and no local AI. */
export async function discoverSfx(input,{fetchImpl=fetch}={}){
  const needs=planSfxNeeds(input?.bundle);
  if(input?.allowExternalSearch!==true)throw Error("Explicit approval required for public SFX search.");
  const queryCache=new Map(),warningByQuery=new Map();
  const queries=[...new Set(needs.map(x=>x.query))].slice(0,12);
  // Three concurrent searches keep local Studio responsive without overwhelming Openverse.
  async function search(query){
    const params=new URLSearchParams({q:query,license:"cc0",category:"sound_effect",length:"shortest,short",page_size:"8"});
    try{
      const response=await fetchImpl(`https://api.openverse.org/v1/audio/?${params}`,{
        headers:{Accept:"application/json","User-Agent":"ContentGen-SFX/1.0"},redirect:"error",signal:AbortSignal.timeout(12_000)});
      const json=await readJson(response);
      queryCache.set(query,(Array.isArray(json.results)?json.results:[]).slice(0,8).map(soundMeta)
        .filter(Boolean));
    }catch(error){warningByQuery.set(query,`Openverse ${query}: ${clean(error?.message,110)}`);queryCache.set(query,[]);}
  }
  for(let i=0;i<queries.length;i+=3)await Promise.all(queries.slice(i,i+3).map(search));
  const warnings=queries.flatMap(query=>warningByQuery.has(query)?[warningByQuery.get(query)]:[]);
  if(new Set(needs.map(x=>x.query)).size>12)warnings.push("Sound search capped at twelve unique cues.");
  return {schemaVersion:1,kind:"contentgen-sfx-suggestions",scenes:needs.map(x=>({...x,
    candidates:(queryCache.get(x.query)??[]).map(item=>({...item,matchCount:similarity(x.query,item)}))
      .sort((a,b)=>b.matchCount-a.matchCount||a.assetId.localeCompare(b.assetId))})),warnings};
}

/** Explicit, one-query metadata-only search for a quiet music bed. No media is downloaded. */
export async function discoverMusic(input,{fetchImpl=fetch}={}){
  if(input?.allowExternalSearch!==true)throw Error("Explicit approval required for public music search.");
  const query=clean(input.query,90);
  if(query.length<3||!terms(query).length)throw Error("Enter a meaningful music mood or instrument to search.");
  const params=new URLSearchParams({q:query,license:"cc0",category:"music",page_size:"12"});
  const response=await fetchImpl(`https://api.openverse.org/v1/audio/?${params}`,{
    headers:{Accept:"application/json","User-Agent":"ContentGen-Music/1.0"},redirect:"error",signal:AbortSignal.timeout(12_000)});
  const json=await readJson(response);
  const candidates=(Array.isArray(json.results)?json.results:[]).slice(0,12)
    .map(item=>soundMeta(item,{assetType:"music"})).filter(Boolean)
    .map(item=>({...item,matchCount:similarity(query,item)}))
    .sort((a,b)=>b.matchCount-a.matchCount||a.assetId.localeCompare(b.assetId));
  return {schemaVersion:1,kind:"contentgen-cc0-music-suggestions",query,candidates};
}

/** Candidate bank items must come from hash-verified listApprovedSfx, not provider responses. */
export function recommendApprovedSfx(bundle,library){
  return planSfxNeeds(bundle).map(need=>{
    const ranked=(Array.isArray(library)?library:[]).filter(x=>x?.rightsStatus==="user-reviewed"&&
      (x.assetType===undefined||x.assetType==="sfx")&&
      x.license==="cc0"&&/^[a-f\d]{64}$/iu.test(x.sha256??"")&&typeof x.localPath==="string")
      .map(x=>({...x,matchCount:similarity(need.query,x)}))
      .filter(x=>x.matchCount>0).sort((a,b)=>b.matchCount-a.matchCount||a.assetId.localeCompare(b.assetId));
    const top=ranked[0];
    const threshold=Math.min(2,terms(need.query).length);
    return {shotId:need.shotId,intent:need.intent,assetId:top&&top.matchCount>=threshold?top.assetId:null,
      reason:top&&top.matchCount>=threshold?"Approved local sound matches intent metadata":"No confident approved local match; silence"};
  });
}

function wavVerified(bytes){
  const invalid=()=>{throw Error("SFX normalization did not produce valid 48k mono PCM WAV.");};
  if(bytes.length<46||bytes.toString("ascii",0,4)!=="RIFF"||bytes.toString("ascii",8,12)!=="WAVE")invalid();
  const end=bytes.readUInt32LE(4)+8;
  if(end>bytes.length||end<44)invalid();
  let format=false,data=false;
  for(let at=12;at+8<=end;){
    const length=bytes.readUInt32LE(at+4),start=at+8;
    if(start+length>end)invalid();
    const kind=bytes.toString("ascii",at,at+4);
    if(kind==="fmt "){
      if(length<16||bytes.readUInt16LE(start)!==1||bytes.readUInt16LE(start+2)!==1||
        bytes.readUInt32LE(start+4)!==48000||bytes.readUInt16LE(start+12)!==2||
        bytes.readUInt16LE(start+14)!==16)invalid();
      format=true;
    }
    if(kind==="data"){
      if(length<2||length%2)invalid();data=true;
    }
    at=start+length+(length%2);
  }
  if(!format||!data)invalid();
}
async function transcodeWav(input,output,{ffmpeg="ffmpeg"}={}){
  try{await exec(ffmpeg,["-hide_banner","-loglevel","error","-nostdin","-n",
    "-protocol_whitelist","file,pipe","-i",input,"-vn","-sn","-dn",
    "-ar","48000","-ac","1","-c:a","pcm_s16le",output],{timeout:60_000,maxBuffer:400_000});}
  catch{throw Error("FFmpeg could not decode the selected sound effect.");}
}
async function downloadAudio(response){
  if(!response.ok)throw Error(`SFX download returned HTTP ${response.status}.`);
  const rawLength=response.headers.get("content-length");
  if(rawLength!==null&&(!/^\d+$/u.test(rawLength)||!Number.isSafeInteger(Number(rawLength))))
    throw Error("Audio provider returned an invalid file length.");
  const declared=Number(rawLength??"0");
  if(declared>MAX_AUDIO)throw Error("SFX file exceeds 16 MB limit.");
  const chunks=[];let size=0;
  for await(const chunk of response.body??[]){size+=chunk.length;
    if(size>MAX_AUDIO)throw Error("SFX file exceeds 16 MB limit.");chunks.push(chunk);}
  if(size<16)throw Error("Incomplete SFX download.");
  return Buffer.concat(chunks,size);
}

/** A reviewed media URL is retried only for transient, idempotent GET failures.
 * All attempts share a deadline, and no file is committed before validation.
 */
async function downloadReviewedAudio(url,{fetchImpl=fetch,signal}={}){
  const deadline=AbortSignal.timeout(45_000);
  const combined=signal?AbortSignal.any([signal,deadline]):deadline;
  for(let attempt=0;attempt<3;attempt++){
    if(combined.aborted)throw Error("Audio download cancelled or timed out.");
    try{
      const response=await fetchImpl(url,{redirect:"error",signal:combined});
      if(response.status===429){
        try{await response.body?.cancel?.();}catch{/* The error below is authoritative. */}
        throw Error("Audio provider rate limit reached. Retry later.");
      }
      if([408,500,502,503,504].includes(response.status)){
        try{await response.body?.cancel?.();}catch{/* The server failure below is authoritative. */}
        const error=Error("Audio provider temporarily unavailable.");error.retryable=true;throw error;
      }
      if(!response.ok){
        try{await response.body?.cancel?.();}catch{/* Preserve the original HTTP rejection. */}
        throw Error(`SFX download returned HTTP ${response.status}.`);
      }
      const bytes=await downloadAudio(response);
      const declared=Number(response.headers.get("content-length")??"0");
      if(declared&&declared!==bytes.length){
        const error=Error("Incomplete audio download.");error.retryable=true;throw error;
      }
      return bytes;
    }catch(error){
      if(combined.aborted)throw Error("Audio download cancelled or timed out.",{cause:error});
      if(!(error.retryable||error instanceof TypeError))throw error;
      if(attempt===2)throw Error("Audio download failed after three attempts. Check the source and retry import.",{cause:error});
      await pause(250*2**attempt,undefined,{signal:combined});
    }
  }
}

/** First-time, explicit human approval; client cannot submit download URL or file path. */
export async function approveSfx(input,{fetchImpl=fetch,root=DEFAULT_ROOT,transcode=transcodeWav,now=()=>new Date(),ffmpeg,signal}={}){
  if(input?.confirmDownload!==true||input?.confirmRights!==true)
    throw Error("SFX license review and download approval required.");
  const assetId=validId(input.assetId,"sound identifier",UUID);
  const assetType=input.assetType??"sfx";
  if(!["sfx","music"].includes(assetType))throw Error("Unsupported approved audio kind.");
  const detailUrl=`https://api.openverse.org/v1/audio/${assetId}/`;
  const item=soundMeta(await readJson(await fetchImpl(detailUrl,{redirect:"error",
    headers:{Accept:"application/json","User-Agent":"ContentGen-SFX/1.0"},signal:AbortSignal.timeout(12_000)})),{assetType});
  if(!item)throw Error("Sound license is not acceptable CC0 or URL host is untrusted.");
  const mediaUrl=safeMediaUrl(item.previewUrl);
  const bytes=await downloadReviewedAudio(mediaUrl,{fetchImpl,signal});
  const base=resolve(root),bank=join(base,"bank");
  await mkdir(bank,{recursive:true,mode:0o700});
  const temp=await mkdtemp(join(bank,".sfx-import-"));
  try{
    const inputPath=join(temp,"source.bin"),outputPath=join(temp,"sfx.wav");
    await writeFile(inputPath,bytes,{mode:0o600,flag:"wx"});
    await transcode(inputPath,outputPath,{ffmpeg});
    const normalized=await readFile(outputPath);
    if(normalized.length>MAX_AUDIO)throw Error("Normalized SFX exceeds 16 MB limit.");
    wavVerified(normalized);
    const soundSha=sha(normalized),originalSha=sha(bytes);
    const digest=sha(JSON.stringify({provider:"openverse",assetId,assetType,soundSha,originalSha}));
    const folder=join(bank,`asset_${digest.slice(0,24)}`);
    const manifest={schemaVersion:1,kind:"contentgen-approved-sfx",provider:"openverse",assetId,assetType,
      title:item.title,creator:item.creator,source:item.source,sourceUrl:item.sourceUrl,
      license:"cc0",licenseUrl:item.licenseUrl,rightsStatus:"user-reviewed",
      tags:item.tags,durationSeconds:item.durationSeconds,approvedAt:now().toISOString(),
      originalSha256:originalSha,sha256:soundSha,sizeBytes:normalized.length};
    await writeFile(join(temp,"manifest.json"),JSON.stringify(manifest,null,2)+"\n",{flag:"wx",mode:0o600});
    await rm(inputPath);
    try{await rename(temp,folder);}catch(error){
      if(error.code!=="EEXIST"&&error.code!=="ENOTEMPTY")throw error;
      const existing=JSON.parse(await readFile(join(folder,"manifest.json"),"utf8"));
      if(existing.sha256!==soundSha||existing.assetId!==assetId)throw Error("Approved sound conflicts with existing import.");
      const current=await readFile(join(folder,"sfx.wav"));
      if(current.length!==existing.sizeBytes||sha(current)!==soundSha)
        throw Error("Existing approved sound is damaged or tampered; cannot reuse this import.");
    }
    return {...manifest,localPath:join(folder,"sfx.wav")};
  }finally{await rm(temp,{recursive:true,force:true});}
}

/** Every returned path is derived from a fixed directory and re-checked against its hash. */
export async function listApprovedSfx({root=DEFAULT_ROOT}={}){
  const bank=join(resolve(root),"bank"),result=[];
  const directories=await readdir(bank,{withFileTypes:true}).catch(e=>e.code==="ENOENT"?[]:Promise.reject(e));
  for(const folder of directories.slice(0,500)){
    if(!folder.isDirectory()||!/^asset_[a-f\d]{24}$/u.test(folder.name))continue;
    try{
      const dir=join(bank,folder.name),item=JSON.parse(await readFile(join(dir,"manifest.json"),"utf8"));
      if(item?.schemaVersion!==1||item.kind!=="contentgen-approved-sfx"||item.provider!=="openverse"||
        item.license!=="cc0"||item.rightsStatus!=="user-reviewed"||!UUID.test(item.assetId)||
        (item.assetType!==undefined&&!["sfx","music"].includes(item.assetType))||
        !/^[a-f\d]{64}$/iu.test(item.sha256)||!Number.isSafeInteger(item.sizeBytes)||item.sizeBytes>MAX_AUDIO)continue;
      const localPath=join(dir,"sfx.wav"),bytes=await readFile(localPath);
      if(bytes.length!==item.sizeBytes||sha(bytes)!==item.sha256)continue;
      wavVerified(bytes);result.push({...item,localPath});
    }catch{/* Invalid, incomplete or tampered files are never auto-reused. */}
  }
  return result;
}

const choicesFile=(root,projectId)=>join(resolve(root),"projects",validId(projectId,"project identifier"),"choices.json");
async function readChoices(root,projectId){
  const path=choicesFile(root,projectId);
  try{const saved=JSON.parse(await readFile(path,"utf8"));
    return saved?.kind==="contentgen-sfx-choices"&&saved.schemaVersion===1&&
      saved.choices&&typeof saved.choices==="object"&&!Array.isArray(saved.choices)?saved.choices:{};
  }catch(e){if(e.code==="ENOENT")return {};throw Error("Unable to read saved sound choices.");}
}

/** Explicit pin / mute / back-to-auto; no deletion of approved library assets. */
export async function setSceneSfxChoice(input,{root=DEFAULT_ROOT}={}){
  const projectId=validId(input?.projectId,"project identifier"),shotId=validId(input?.shotId,"shot identifier");
  if(!["pin","mute","auto"].includes(input?.mode))throw Error("Invalid SFX choice mode.");
  const trigger=input.trigger??"shot-start";
  if(!["shot-start","first-visual-reveal"].includes(trigger))throw Error("Invalid SFX timing trigger.");
  const choice=input.mode==="pin"?(()=>{
    validId(input.assetId,"sound identifier",UUID);
    if(!/^[a-f\d]{64}$/iu.test(input.sha256??""))throw Error("Invalid approved sound hash.");
    return {mode:"pin",assetId:input.assetId,sha256:input.sha256,trigger};})():{mode:input.mode,trigger};
  if(choice.mode==="pin"){
    const approved=await listApprovedSfx({root});
    if(!approved.some(x=>x.assetId===choice.assetId&&x.sha256===choice.sha256&&x.assetType!=="music"))
      throw Error("Cannot pin a sound absent from the approved and hash-verified library.");
  }
  const saved=await readChoices(root,projectId);
  if(choice.mode==="auto"&&trigger==="shot-start")delete saved[shotId];else saved[shotId]=choice;
  const path=choicesFile(root,projectId),dir=dirname(path);
  await mkdir(dir,{recursive:true,mode:0o700});
  const temp=await mkdtemp(join(dir,".choices-"));
  try{const staged=join(temp,"choices.json");await writeFile(staged,
    JSON.stringify({schemaVersion:1,kind:"contentgen-sfx-choices",choices:saved},null,2)+"\n",{flag:"wx",mode:0o600});
    await rename(staged,path);
  }finally{await rm(temp,{recursive:true,force:true});}
  return {projectId,shotId,mode:choice.mode,trigger};
}

export async function resolveSceneSfxChoices({projectId,bundle},{root=DEFAULT_ROOT}={}){
  validId(projectId,"project identifier");
  const approved=(await listApprovedSfx({root})).filter(x=>x.assetType!=="music"),
    byId=new Map(approved.map(x=>[x.assetId,x]));
  const saved=await readChoices(root,projectId),automatic=recommendApprovedSfx(bundle,approved);
  return automatic.map(suggestion=>{
    const override=saved[suggestion.shotId],mode=override?.mode==="mute"?"mute":override?.mode==="pin"?"pin":"auto";
    const asset=mode==="mute"?null:mode==="pin"?
      approved.find(x=>x.assetId===override.assetId&&x.sha256===override.sha256):byId.get(suggestion.assetId);
    const trigger=override?.trigger==="first-visual-reveal"?"first-visual-reveal":"shot-start";
    return {shotId:suggestion.shotId,intent:suggestion.intent,mode,trigger,assetId:asset?.assetId??null,
      title:asset?.title??null,sha256:asset?.sha256??null,localPath:asset?.localPath??null,
      license:asset?.license??null,rightsStatus:asset?.rightsStatus??null,
      reason:mode==="mute"?"Silenced by editor":mode==="pin"&&!asset?"Pinned sound missing or damaged":
        asset?(mode==="pin"?"Editor-pinned local sound":"Approved local bank match"):suggestion.reason};
  });
}

/** A caller supplies the real event clock. Never invent an event for a shot. */
export function exportSfxForTimeline({sceneChoices,eventIdByShot,timeline}){
  const events=timeline?.eventSamples??{};
  if(!events||typeof events!=="object"||!eventIdByShot||typeof eventIdByShot!=="object")return [];
  return (Array.isArray(sceneChoices)?sceneChoices:[]).flatMap(item=>{
    const eventId=eventIdByShot[item.shotId];
    if(!ID.test(item.shotId??"")||typeof eventId!=="string"||!Object.hasOwn(events,eventId)||
      !Number.isSafeInteger(events[eventId])||events[eventId]<0||item.rightsStatus!=="user-reviewed"||
      item.license!=="cc0"||!item.assetId||!/^[a-f\d]{64}$/iu.test(item.sha256??"")||
      typeof item.localPath!=="string")return [];
    return [{id:`sfx-${item.shotId}`,eventId,assetRef:item.localPath,assetPath:item.localPath,
      licenseStatus:"verified",sha256:item.sha256}];
  });
}
