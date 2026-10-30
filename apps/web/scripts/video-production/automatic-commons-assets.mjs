/** No-key, bounded, license-verified Wikimedia Commons CC0 stills.
 * Openverse search results are *leads*, never licenses. Only the authoritative
 * Commons imageinfo API can authorize a draft download. Unlicensed, malformed,
 * unavailable, corrupt or oversized media falls back to Kumiki graphics.
 */
import {createHash,randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {link,lstat,mkdir,readFile,realpath,rm,writeFile} from "node:fs/promises";
import {join,parse,resolve,sep} from "node:path";
import {homedir} from "node:os";

const exec=promisify(execFile);
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const sha1=bytes=>createHash("sha1").update(bytes).digest("hex");
const DIGEST=/^[a-f0-9]{64}$/u;
const COMMONS="https://commons.wikimedia.org/w/api.php";
const CC0="https://creativecommons.org/publicdomain/zero/1.0/";
const MAX_MEDIA=20*1024*1024,MAX_PREPARED=3,MAX_ATTEMPTS=6;
const UA="ContentGen/0.1 (local video editor; https://github.com/YukiUmetsu/ai-content-generation)";
const text=(value,limit)=>String(value??"").replace(/<[^>]*>/gu,"")
  .replace(/[\u0000-\u001f\u007f]/gu," ").replace(/\s+/gu," ").trim().slice(0,limit);

async function ownedDirectory(path,{create=false}={}){
  const absolute=resolve(path),root=parse(absolute).root;
  if([root,homedir(),process.cwd(),resolve(process.cwd(),".."),"/tmp","/workspace"].includes(absolute))
    throw Error("Scene media needs a narrow owned directory.");
  let current=root;
  for(const part of absolute.slice(root.length).split(sep).filter(Boolean)){
    current=join(current,part);
    if(create){
      try{await mkdir(current,{mode:0o700});}
      catch(error){if(error.code!=="EEXIST")throw error;}
    }
    const info=await lstat(current);
    // Apple's /var and /tmp are OS-owned aliases for /private counterparts.
    // Local, user-controlled symlink parents remain forbidden.
    if(info.isSymbolicLink()&&process.platform==="darwin"&&
      ((current==="/var"&&await realpath(current)==="/private/var")||
       (current==="/tmp"&&await realpath(current)==="/private/tmp")))continue;
    if(!info.isDirectory()||info.isSymbolicLink())throw Error("A scene media parent folder is not a real directory.");
  }
  return absolute;
}

function commonsPage(url){
  let link;
  try{link=new URL(url);}catch{return null;}
  if(link.protocol!=="https:"||link.hostname!=="commons.wikimedia.org"||
    link.username||link.password||link.port||link.search||link.hash||
    !link.pathname.startsWith("/wiki/")||link.pathname.length>320)return null;
  let title;
  try{title=decodeURIComponent(link.pathname.slice("/wiki/".length)).replaceAll("_"," ");}
  catch{return null;}
  if(/[\u0000-\u001f\u007f?#\\/]/u.test(title)||!/^File:.{3,175}\.jpe?g$/iu.test(title))return null;
  return {url:link.href,title};
}
function candidateAllowed(candidate){
  return candidate?.provider==="openverse"&&candidate.assetType==="photo"&&
    candidate.match?.grade==="strong"&&Number(candidate.match?.score)>=60&&
    candidate.licenseUrl===CC0&&candidate.license==="CC0-1.0 (unverified index)"&&
    /^[a-f0-9-]{32,36}$/u.test(candidate.assetId??"")&&commonsPage(candidate.sourceUrl);
}
function urlForOriginal(value){
  let url;
  try{url=new URL(value);}catch{return null;}
  if(url.protocol!=="https:"||url.hostname!=="upload.wikimedia.org"||
    url.username||url.password||url.port||url.search||url.hash||
    !/^\/wikipedia\/commons\/(?:[^?#\\]+\/){1,4}[^/?#\\]+\.jpe?g$/iu.test(url.pathname))return null;
  return url.href;
}
async function fetchLimited(url,{fetcher,signal,limit=MAX_MEDIA,media=false}){
  const deadline=AbortSignal.timeout(20_000);
  const combined=signal?AbortSignal.any([signal,deadline]):deadline;
  const response=await fetcher(url,{signal:combined,redirect:"error",
    headers:{"User-Agent":UA,"Accept":media?"image/jpeg":"application/json"}});
  if(!response.ok||response.redirected)throw Error("The original provider did not return an approved resource.");
  const contentType=response.headers.get("content-type")??"";
  if(media?!/^image\/jpeg(?:;|$)/iu.test(contentType):
    !/^application\/json(?:;|$)/iu.test(contentType))throw Error("The source returned the wrong media format.");
  const size=Number(response.headers.get("content-length"));
  if(response.headers.get("content-length")!==null&&(!Number.isSafeInteger(size)||size<1||size>limit))
    throw Error("The source media exceeds the download size limit.");
  const reader=response.body?.getReader();
  if(!reader)throw Error("The source did not provide a readable response body.");
  const chunks=[];let total=0;
  try{
    while(true){
      const part=await reader.read();
      if(part.done)break;
      total+=part.value.length;
      if(total>limit)throw Error("The source media exceeds the download size limit.");
      chunks.push(part.value);
    }
  }catch(error){await reader.cancel().catch(()=>{});throw error;}
  if(total<12)throw Error("The downloaded source was empty or incomplete.");
  return Buffer.concat(chunks,total);
}

export async function downloadVerifiedCommonsPhoto(candidate,{fetcher=globalThis.fetch,signal}={}){
  if(!candidateAllowed(candidate))throw Error("This Commons lead is not a strong, plausible CC0 still image.");
  const page=commonsPage(candidate.sourceUrl);
  const api=new URL(COMMONS);
  for(const [key,value] of Object.entries({action:"query",format:"json",prop:"imageinfo",
    iiprop:"url|size|sha1|mime|extmetadata",titles:page.title}))api.searchParams.set(key,value);
  const document=JSON.parse((await fetchLimited(api,{fetcher,signal,limit:128*1024})).toString("utf8"));
  const pages=Object.values(document?.query?.pages??{});
  if(pages.length!==1||pages[0]?.missing!==undefined||
    text(pages[0]?.title,220).toLocaleLowerCase()!==page.title.toLocaleLowerCase())
    throw Error("Commons did not confirm the selected original file.");
  const item=pages[0]?.imageinfo?.[0];
  const license=item?.extmetadata;
  if(license?.LicenseUrl?.value!==CC0||
    !/^CC0(?:\s*1\.0)?$/iu.test(license?.LicenseShortName?.value??"")||
    item?.mime!=="image/jpeg"||!Number.isSafeInteger(item.size)||item.size<128||
    item.size>MAX_MEDIA||!Number.isSafeInteger(item.width)||item.width<720||item.width>8192||
    !Number.isSafeInteger(item.height)||item.height<720||item.height>8192||
    !/^[a-f0-9]{40}$/iu.test(item.sha1??""))
    throw Error("Commons did not verify CC0 rights and a suitable JPEG original.");
  const original=urlForOriginal(item.url);
  if(!original)throw Error("Commons returned an untrusted original media address.");
  const bytes=await fetchLimited(original,{fetcher,signal,media:true});
  if(bytes.length!==item.size||bytes[0]!==0xff||bytes[1]!==0xd8||bytes[2]!==0xff||
    bytes.at(-2)!==0xff||bytes.at(-1)!==0xd9||sha1(bytes)!==item.sha1.toLowerCase())
    throw Error("Commons original media failed its authoritative SHA-1 or JPEG checks.");
  return {bytes,meta:{provider:"wikimedia-commons",assetId:candidate.assetId,
    sourceUrl:page.url,originalUrl:original,license:"CC0-1.0",licenseUrl:CC0,
    creator:text(license?.Artist?.value,120),width:item.width,height:item.height}};
}

async function probeJpeg(path,{ffprobe="ffprobe",signal}={}){
  const {stdout}=await exec(ffprobe,["-v","error","-select_streams","v:0",
    "-show_entries","stream=codec_name,width,height","-of","json",path],
  {signal,timeout:30000,maxBuffer:32768});
  const stream=JSON.parse(stdout).streams?.[0];
  if(stream?.codec_name!=="mjpeg"||!Number.isSafeInteger(stream.width)||stream.width<720||
    stream.width>8192||!Number.isSafeInteger(stream.height)||stream.height<720||stream.height>8192)
    throw Error("The CC0 media is not an appropriate HD JPEG.");
  return {width:stream.width,height:stream.height};
}

async function verifiedCache(directory,identity,candidate,{probe,ffprobe,signal}){
  if(!directory)return null;
  let record;
  try{
    await ownedDirectory(directory);
    const path=join(directory,identity+".json"),file=await lstat(path);
    if(!file.isFile()||file.isSymbolicLink()||file.size<60||file.size>1500)
      throw Error("Untrusted scene-media cache metadata.");
    record=JSON.parse(await readFile(path,"utf8"));
  }catch(error){if(error?.code==="ENOENT")return null;throw error;}
  if(record.identity!==identity||record.assetId!==candidate.assetId||
    record.sourceUrl!==candidate.sourceUrl||record.licenseUrl!==CC0||
    !DIGEST.test(record.sha256)||!Number.isSafeInteger(record.sizeBytes)||
    record.sizeBytes<128||record.sizeBytes>MAX_MEDIA)
    throw Error("Cached Commons media has inconsistent rights or content identity.");
  const path=join(directory,record.sha256+".jpg"),info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink()||info.size!==record.sizeBytes)
    throw Error("Cached Commons media was changed or damaged.");
  const bytes=await readFile(path);
  if(sha(bytes)!==record.sha256)throw Error("Cached Commons media failed SHA-256 verification.");
  const measured=await probe(path,{ffprobe,signal});
  if(measured.width!==record.width||measured.height!==record.height)
    throw Error("Cached Commons media no longer decodes as recorded.");
  return {record,bytes};
}

export async function prepareAutomaticCommonsMedia({suggestions,shotMap,existing,outputDir,
  previousOutputDir,signal,sceneJobs,ffprobe},
{download=downloadVerifiedCommonsPhoto,probe=probeJpeg}={}){
  if(!Array.isArray(shotMap)||shotMap.length>60||!existing?.bindings||
    typeof outputDir!=="string"||!outputDir.trim())throw Error("Scene-media preparation needs a valid owned output folder.");
  const result={bindings:{...existing.bindings},assets:[...(existing.assets??[])],
    fingerprint:existing.fingerprint??sha("empty"),prepared:0,warnings:[]};
  if(suggestions?.kind!=="contentgen-scene-asset-suggestions"||
    !Array.isArray(suggestions.scenes)||suggestions.scenes.length>60)return result;
  const mapped=new Map(shotMap.map(item=>[item.shotId,item.beatId]));
  if(mapped.size!==shotMap.length||shotMap.some(item=>
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/u.test(item.shotId)||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(item.beatId)))
    throw Error("Automated Commons media references an invalid storyboard scene.");
  const selected=[],used=new Set(Object.values(result.bindings).map(item=>item.sourceUrl));
  for(const scene of suggestions.scenes){
    if(selected.length>=MAX_PREPARED)break;
    const beatId=mapped.get(scene?.shotId);
    if(!beatId||result.bindings[beatId]||!Array.isArray(scene.candidates))continue;
    const options=scene.candidates.filter(candidate=>candidateAllowed(candidate)&&
      !used.has(candidate.sourceUrl)).slice(0,2);
    if(!options.length)continue;
    for(const candidate of options)used.add(candidate.sourceUrl);
    selected.push({scene,beatId,options});
  }
  await ownedDirectory(outputDir,{create:true});
  // Outbound enrichment is optional. A sequence of slow-but-not-failing
  // providers must not stall voice and the Kumiki draft indefinitely.
  const deadline=AbortSignal.timeout(70_000);
  const networkSignal=signal?AbortSignal.any([signal,deadline]):deadline;
  let attempts=0;
  scenes:for(const {scene,beatId,options} of selected){
    if(signal?.aborted)throw signal.reason??Error("Scene media preparation cancelled.");
    if(deadline.aborted){result.warnings.push("Commons media preparation timed out; remaining scenes use Kumiki.");break;}
    for(const candidate of options){
      if(signal?.aborted)throw signal.reason??Error("Scene media preparation cancelled.");
      if(deadline.aborted){result.warnings.push("Commons media preparation timed out; remaining scenes use Kumiki.");break scenes;}
      const identity=sha(JSON.stringify({provider:"wikimedia-commons",shotId:scene.shotId,
        sourceUrl:candidate.sourceUrl,license:CC0}));
      let cached=null;
      try{cached=await verifiedCache(outputDir,identity,candidate,{probe,ffprobe,signal:networkSignal});}
      catch(error){if(signal?.aborted)throw error;result.warnings.push(`Scene ${scene.shotId}: damaged Commons cache was not reused.`);}
      if(!cached&&previousOutputDir){
        try{cached=await verifiedCache(previousOutputDir,identity,candidate,{probe,ffprobe,signal:networkSignal});}
        catch(error){if(signal?.aborted)throw error;result.warnings.push(`Scene ${scene.shotId}: earlier Commons media did not verify.`);}
      }
      if(deadline.aborted){result.warnings.push("Commons media preparation timed out; remaining scenes use Kumiki.");break scenes;}
      let claim=null,temp=null,jobTransitionFailed=false;
      try{
        let record,bytes;
        if(cached){({record,bytes}=cached);}
        else{
          if(attempts>=MAX_ATTEMPTS)break;
          attempts++;
          try{claim=await sceneJobs?.beginScene({kind:"asset-download",sceneId:beatId,fingerprint:identity});}
          catch(error){jobTransitionFailed=true;throw error;}
          const source=await download(candidate,{signal:networkSignal});
          bytes=source.bytes;
          if(!Buffer.isBuffer(bytes)||bytes.length<128||bytes.length>MAX_MEDIA||
            source.meta?.provider!=="wikimedia-commons"||source.meta.sourceUrl!==candidate.sourceUrl||
            source.meta.licenseUrl!==CC0||source.meta.assetId!==candidate.assetId)
            throw Error("The Commons download did not match its verified rights metadata.");
          record={schemaVersion:1,identity,assetId:candidate.assetId,sourceUrl:candidate.sourceUrl,
            originalUrl:source.meta.originalUrl,creator:source.meta.creator,license:"CC0-1.0",
            licenseUrl:CC0,sha256:sha(bytes),sizeBytes:bytes.length,
            width:source.meta.width,height:source.meta.height};
        }
        const destination=join(outputDir,record.sha256+".jpg");
        let have=false;
        try{
          const onDisk=await lstat(destination);
          have=onDisk.isFile()&&!onDisk.isSymbolicLink()&&onDisk.size===bytes.length&&
            sha(await readFile(destination))===record.sha256;
        }catch(error){if(error.code!=="ENOENT")throw error;}
        if(!have){
          temp=join(outputDir,".commons-"+randomUUID()+".jpg");
          await writeFile(temp,bytes,{flag:"wx",mode:0o600});
          const measured=await probe(temp,{ffprobe,signal:networkSignal});
          if(measured.width!==record.width||measured.height!==record.height)
            throw Error("Commons image dimensions differ from the verified original.");
          // Hard-link publication is an atomic no-clobber commit. A second
          // process can only win by writing identical content-addressed bytes;
          // neither a damaged file nor another worker's media is overwritten.
          try{await link(temp,destination);}
          catch(error){
            if(error.code!=="EEXIST")throw error;
            const onDisk=await lstat(destination);
            if(!onDisk.isFile()||onDisk.isSymbolicLink()||onDisk.size!==bytes.length||
              sha(await readFile(destination))!==record.sha256)
              throw Error("A damaged prepared image is preserved and cannot be overwritten.");
          }
          await rm(temp);temp=null;
        }else{
          const measured=await probe(destination,{ffprobe,signal:networkSignal});
          if(measured.width!==record.width||measured.height!==record.height)
            throw Error("A cached Commons image no longer decodes correctly.");
        }
        const marker=join(outputDir,".commons-"+randomUUID()+".json");
        try{await writeFile(marker,JSON.stringify(record),{flag:"wx",mode:0o600});
          const recordPath=join(outputDir,identity+".json");
          try{await link(marker,recordPath);}
          catch(error){
            if(error.code!=="EEXIST")throw error;
            const saved=await readFile(recordPath);
            if(saved.toString("utf8")!==JSON.stringify(record))
              throw Error("Existing Commons provenance is different and was not overwritten.");
          }
        }
        finally{await rm(marker,{force:true});}
        if(networkSignal.aborted)throw networkSignal.reason??Error("Scene media preparation cancelled.");
        if(claim){
          try{await sceneJobs.completeScene(claim,{sha256:record.sha256});}
          catch(error){jobTransitionFailed=true;throw error;}
          claim=null;
        }
        const url=`/__video_media/${record.sha256}.jpg`;
        result.bindings[beatId]={assetType:"photo",url,sha256:record.sha256,
          provider:"wikimedia-commons",assetId:candidate.assetId,sourceUrl:record.sourceUrl,
          license:record.license,licenseUrl:CC0,creator:record.creator,width:record.width,
          height:record.height,rightsStatus:"draft-provider-license",automaticallyPrepared:true};
        result.assets.push({url,path:destination,sha256:record.sha256,assetType:"photo"});
        result.prepared++;
        break;
      }catch(error){
        if(claim){
          try{await sceneJobs.failScene(claim,error);}
          catch(failed){jobTransitionFailed=true;throw failed;}
        }
        if(signal?.aborted||jobTransitionFailed)throw error;
        if(deadline.aborted){result.warnings.push("Commons media preparation timed out; remaining scenes use Kumiki.");break scenes;}
        result.warnings.push(`Scene ${scene.shotId}: Commons could not verify or prepare the original; trying Kumiki or the next image.`);
      }finally{if(temp)await rm(temp,{force:true});}
    }
  }
  if(result.prepared)result.fingerprint=sha(JSON.stringify({pinned:existing.fingerprint,
    automatic:Object.entries(result.bindings).filter(([,item])=>item.automaticallyPrepared)
      .map(([id,item])=>[id,item.sha256]).sort((a,b)=>a[0].localeCompare(b[0]))}));
  return result;
}
