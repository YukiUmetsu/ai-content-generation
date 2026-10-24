/** Shot-specific stock/3D suggestions and explicitly approved local imports.
 * ContentGen owns provider provenance. These files are optional visual inputs;
 * none is automatically evidence for a claim or an approved Kumiki composition.
 */
import {createHash} from "node:crypto";
import {mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile} from "node:fs/promises";
import {basename, dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const DEFAULT_ROOT=fileURLToPath(new URL("../../../../data/studio-assets",import.meta.url));
const ID=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/u;
const MAX_FILE=80*1024*1024;
const MAX_JSON=18*1024*1024;
const UA="ContentGen-SceneAssets/1.0 (https://github.com/YukiUmetsu/ai-content-generation)";
const ABSTRACT=/\b(chart|graph|table|diagram|timeline|formula|percentage|interest|tax|flowchart|equation|calculation|numbers?|statistics|comparison|slide|text|headline|list)\b/iu;
const STOP=new Set(["the","a","an","of","for","from","to","and","with","on","in","by","how","why","cost","costs","shows","show","visual","asset","scene","actual","real","this","that"]);
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
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

/** No LLM and no network. Pure semantic extraction with a meaningful no-stock decision. */
export function planSceneAssetNeeds(bundle){
  return boundedShots(bundle).map(shot=>{
    const subjects=Array.isArray(shot.visualElements)?shot.visualElements
      .map(x=>visible(x?.label,80)).filter(Boolean).slice(0,5):[];
    const label=subjects.find(x=>!ABSTRACT.test(x))??subjects[0]??visible(shot.purpose,100);
    const intent=visible(shot.visualChange,200);
    const queryTerms=terms(label);
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
  const r=await fetchImpl(url,{headers,redirect:"error",signal:signal??AbortSignal.timeout(15000)});
  try{return JSON.parse((await readLimited(r,MAX_JSON)).toString("utf8"));}
  catch(e){if(e instanceof SyntaxError)throw Error("Asset provider returned invalid JSON.");throw e;}
}
function scoreMetadata(x,query){
  const words=terms(query);
  const title=visible(x.name,150).toLowerCase();
  const tags=Array.isArray(x.tags)?x.tags.map(t=>visible(t,60).toLowerCase()).join(" "):"";
  const category=visible(x.category,120).toLowerCase();
  return words.reduce((score,term)=>score+(title.includes(term)?5:0)+(tags.includes(term)?3:0)+(category.includes(term)?1:0),0);
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
  const url=`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=4`;
  const data=await getJson(url,{...opts,headers:{Authorization:opts.pexelsKey}});
  return (Array.isArray(data.photos)?data.photos:[]).slice(0,4).flatMap(item=>{
    if(!Number.isSafeInteger(item.id)||item.id<1)return [];
    let source,preview;
    try{source=providerUrl(item.url,["www.pexels.com","pexels.com"]);
      preview=providerUrl(item.src?.medium,["images.pexels.com"]);}catch{return [];}
    return [{provider:"pexels",assetId:String(item.id),assetType:"photo",
      title:visible(item.alt,120)||`Pexels photo ${item.id}`,previewUrl:preview,sourceUrl:source,
      license:"Pexels License",licenseUrl:"https://www.pexels.com/license/",
      creator:visible(item.photographer,100),relevance:1,rightsStatus:"needs-human-review"}];
  });
}

/** One user-triggered search across scenes, bounded and read-only. */
export async function discoverShotAssets(input,opts={}){
  const needs=planSceneAssetNeeds(input?.bundle);
  if(input?.allowExternalSearch!==true)throw Error("Explicit approval is required before external asset search.");
  const providers=input.providers??["polyhaven","pexels"];
  if(!Array.isArray(providers)||providers.length>2||providers.some(x=>!["polyhaven","pexels"].includes(x)))
    throw Error("Unknown asset search provider.");
  const warnings=[],byShot=new Map(needs.map(need=>[need.shotId,[]]));
  const active=needs.filter(x=>x.strategy==="search");
  if(active.length&&providers.includes("polyhaven")){
    try{
      const all=Object.entries(await polyCatalog(opts));
      for(const need of active){
        const ranked=all.map(([id,item])=>({id,item,score:scoreMetadata(item,need.query)}))
          .filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,4);
        byShot.get(need.shotId).push(...ranked.map(x=>polyCandidate(x.id,x.item,x.score)).filter(Boolean));
      }
    }catch(error){warnings.push("Poly Haven: "+visible(error.message,150));}
  }
  if(active.length&&providers.includes("pexels")){
    if(!opts.pexelsKey)warnings.push("Pexels is disabled until PEXELS_API_KEY is configured locally.");
    else{
      const cache=new Map();
      const queries=[...new Set(active.map(x=>x.query))].slice(0,12);
      for(let start=0;start<queries.length;start+=3){
        await Promise.all(queries.slice(start,start+3).map(async query=>{
          try{cache.set(query,await pexelsCandidates(query,opts));}
          catch(error){warnings.push(`Pexels ${query}: ${visible(error.message,120)}`);cache.set(query,[]);}
        }));
      }
      for(const need of active)byShot.get(need.shotId).push(...(cache.get(need.query)??[]));
      if(new Set(active.map(x=>x.query)).size>12)
        warnings.push("Pexels requests were capped at 12 distinct subjects; use Poly Haven for remaining scenes.");
    }
  }
  return {schemaVersion:1,kind:"contentgen-scene-asset-suggestions",providerCredit:"Assets via Poly Haven / Pexels",
    scenes:needs.map(need=>({...need,candidates:byShot.get(need.shotId)})),warnings};
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
async function downloadFile(file,{fetchImpl=fetch,signal}={}){
  const url=providerUrl(file.url,["dl.polyhaven.org","images.pexels.com"]);
  if(!Number.isSafeInteger(file.size)||file.size<0||file.size>MAX_FILE)throw Error("Provider asset exceeds download limit.");
  const response=await fetchImpl(url,{redirect:"error",signal:signal??AbortSignal.timeout(60000),headers:{"User-Agent":UA}});
  const bytes=await readLimited(response,MAX_FILE);
  if(file.size&&bytes.length!==file.size)throw Error("Incomplete or modified provider download.");
  if(file.md5&&createHash("md5").update(bytes).digest("hex")!==file.md5)
    throw Error("Downloaded asset failed provider integrity check.");
  return bytes;
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
    const url=providerUrl(item.src?.large??item.src?.original,["images.pexels.com"]);
    return {files:[{name:"photo.jpg",url,size:0}],meta:{provider:"pexels",assetId:input.assetId,
      assetType:"photo",title:visible(item.alt,120)||`Pexels photo ${input.assetId}`,
      sourceUrl:providerUrl(item.url,["www.pexels.com","pexels.com"]),
      license:"Pexels License",licenseUrl:"https://www.pexels.com/license/",
      creator:visible(item.photographer,100)}};
  }
  throw Error("Unsupported asset type or provider.");
}

/** User-approved import. No arbitrary user-supplied download URL is ever trusted. */
export async function approveAsset(input,opts={}){
  if(input?.confirmDownload!==true||input?.confirmRights!==true)
    throw Error("Explicit human approval of the asset, license and download is required.");
  const projectId=ident(input.projectId,"project"),shotId=ident(input.shotId,"scene"),
    assetId=ident(input.assetId,"asset");
  if(!["polyhaven","pexels"].includes(input.provider)||
    !["texture","hdri","model","photo"].includes(input.assetType))throw Error("Unknown asset provider/type.");
  const {files,meta}=await resolveAssetFiles({...input,assetId},opts);
  if(!meta)throw Error("Provider asset metadata could not be verified.");
  const root=resolve(opts.root??DEFAULT_ROOT);
  const sceneDir=join(root,projectId,shotId);
  await mkdir(sceneDir,{recursive:true,mode:0o700});
  const temp=await mkdtemp(join(sceneDir,".asset-import-"));
  try{
    const entries=[];
    for(const file of files){
      const bytes=await downloadFile(file,opts);
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
      creator:meta.creator,rightsStatus:"user-reviewed",approvedAt:(opts.now??(()=>new Date()))().toISOString(),
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
          meta.rightsStatus!=="user-reviewed"||!Array.isArray(meta.files)||!meta.files.length)continue;
        const name=meta.files[0].name;
        if(typeof name!=="string"||name.includes("/")||name.includes("\\")||!ID.test(meta.assetId)||
          !/^[a-f0-9]{64}$/u.test(meta.sha256))continue;
        const localPath=join(path,basename(name));
        if(sha(await readFile(localPath))!==meta.sha256)continue;
        result.push({...meta,localPath,manifestPath:join(path,"manifest.json")});
      }catch{ /* An invalid/partial imported asset cannot appear as approved. */ }
    }
  }
  return result.slice(0,1000);
}
