/** Project-local, explicitly edited sound layers. Filenames and approved audio
 * paths are always resolved on the server; browser submissions contain IDs only.
 */
import {randomUUID} from "node:crypto";
import {mkdir,mkdtemp,readFile,rename,rm,writeFile} from "node:fs/promises";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {listApprovedSfx} from "./sfx-discovery.mjs";

const DEFAULT_ROOT=fileURLToPath(new URL("../../../../data/studio-sfx",import.meta.url));
const ID=/^[a-z\d][a-z\d_-]{0,95}$/iu;
const UUID=/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu;
const HASH=/^[a-f\d]{64}$/iu;
const fail=m=>{throw Error(`Invalid sound design: ${m}`);};
const valid=(v,regexp,label)=>typeof v==="string"&&regexp.test(v)?v:fail(label);
const integer=(v,min,max,label)=>Number.isSafeInteger(v)&&v>=min&&v<=max?v:fail(label);
const number=(v,min,max,label)=>typeof v==="number"&&Number.isFinite(v)&&v>=min&&v<=max?v:fail(label);
const file=(root,id)=>join(resolve(root),"projects",valid(id,ID,"project identifier"),"sound-design.json");

function config(input,{ambience=false}={}){
  const assetId=valid(input.assetId,UUID,"approved asset ID"),sha256=valid(input.sha256,HASH,"approved asset hash");
  const gainDb=number(input.gainDb,ambience?-48:-48,ambience?-12:0,"bounded gain"),
    fadeInMs=integer(input.fadeInMs,0,ambience?5000:2000,"fade-in range"),
    fadeOutMs=integer(input.fadeOutMs,0,ambience?5000:2000,"fade-out range");
  if(ambience)return {assetId,sha256,gainDb,fadeInMs,fadeOutMs};
  const shotId=valid(input.shotId,ID,"shot identifier");
  if(!["shot-start","first-visual-reveal"].includes(input.trigger))fail("unsupported timing trigger");
  const offsetMs=integer(input.offsetMs,0,10000,"offset range");
  return {shotId,assetId,sha256,trigger:input.trigger,offsetMs,gainDb,fadeInMs,fadeOutMs};
}

async function read(root,projectId){
  let value;
  try{value=JSON.parse(await readFile(file(root,projectId),"utf8"));}
  catch(error){if(error.code==="ENOENT")return {schemaVersion:1,kind:"contentgen-sound-design",layers:[],ambience:null,ambienceMode:"auto"};
    fail("saved sound design is unreadable or invalid");}
  if(value?.schemaVersion!==1||value.kind!=="contentgen-sound-design"||!Array.isArray(value.layers)||
    value.layers.length>80||!(value.ambience===null||typeof value.ambience==="object"))fail("saved format");
  // Existing projects with no saved mode preserve their historical editor
  // intent: null meant off, and a selected ambience meant pinned.
  if(value.ambienceMode===undefined)value.ambienceMode=value.ambience?"pin":"off";
  if(!["auto","pin","off"].includes(value.ambienceMode)||
    (value.ambienceMode==="pin")!==Boolean(value.ambience))fail("saved music mode");
  return value;
}

/** Deterministic, local-only matching; never pulls unreviewed Openverse media. */
export function recommendReviewedMusic(bundle,library){
  const sound=Array.isArray(bundle?.plan?.sound)?bundle.plan.sound:[];
  const shots=Array.isArray(bundle?.plan?.shots)?bundle.plan.shots:[];
  const narrative=[bundle?.plan?.story?.question,...sound.map(x=>x?.narration),
    ...shots.map(x=>x?.onScreenText)].filter(x=>typeof x==="string").join(" ").toLowerCase();
  const exploration=/\b(travel|journey|explor|adventur|world|geograph|planet|country|countries)\w*\b/u.test(narrative);
  const serious=/\b(cost|tax|debt|risk|mortgage|expense|insurance|repair|budget|finance|money)\w*\b/u.test(narrative);
  const hints=exploration?["gentle","ambient","uplifting","journey","hopeful","instrumental","background"]:
    serious?["subtle","minimal","ambient","calm","gentle","instrumental","background"]:
      ["calm","gentle","ambient","soft","minimal","instrumental","background"];
  const candidates=library.filter(x=>x.assetType==="music"&&x.license==="cc0"&&
    x.rightsStatus==="user-reviewed"&&typeof x.localPath==="string"&&
    /^[a-f\d]{64}$/iu.test(x.sha256??""));
  const ranking=candidates.map(asset=>{
    const words=[asset.title,...(Array.isArray(asset.tags)?asset.tags:[])].filter(x=>typeof x==="string")
      .join(" ").toLowerCase();
    const count=hints.filter(keyword=>new RegExp(`\\b${keyword}\\b`,"u").test(words)).length;
    const intrusive=/\b(heavy|aggressive|loud|epic|horror|metal|drums|hardcore)\b/u.test(words);
    return {asset,score:count*3-(intrusive?9:0)};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||
    String(a.asset.assetId).localeCompare(String(b.asset.assetId)));
  return ranking[0]?.asset??null;
}

async function approved(root,assetId,sha256,{ambience=false}={}){
  const bank=await listApprovedSfx({root});
  const asset=bank.find(x=>x.assetId===assetId&&x.sha256===sha256&&
    (ambience||x.assetType!=="music")&&x.rightsStatus==="user-reviewed"&&x.license==="cc0");
  if(!asset)fail("approved audio is missing, damaged or revoked; reselect a CC0 sound");
  return asset;
}

/** Bounded mutation: add/edit/remove an extra cue or enable/disable ambience. */
export async function setSoundDesign(input,{root=DEFAULT_ROOT}={}){
  const projectId=valid(input?.projectId,ID,"project identifier"),saved=await read(root,projectId);
  let result={projectId};
  if(input.action==="upsert"){
    const layer=config(input);
    await approved(root,layer.assetId,layer.sha256);
    const layerId=input.layerId===undefined?`layer_${randomUUID().replaceAll("-","")}`:
      valid(input.layerId,ID,"layer identifier");
    const index=saved.layers.findIndex(x=>x.layerId===layerId);
    if(input.layerId!==undefined&&index<0)fail("unknown layer identifier");
    if(index<0){if(saved.layers.filter(x=>x.shotId===layer.shotId).length>=4||saved.layers.length>=80)
      fail("maximum four layers per shot or 80 total layers reached");
      saved.layers.push({layerId,...layer});}
    else saved.layers[index]={layerId,...layer};
    if(saved.layers.filter(x=>x.shotId===layer.shotId).length>4)fail("maximum four layers per shot");
    result={...result,layerId};
  }else if(input.action==="remove"){
    const layerId=valid(input.layerId,ID,"layer identifier");
    const index=saved.layers.findIndex(x=>x.layerId===layerId);
    if(index<0)fail("unknown layer identifier");
    saved.layers.splice(index,1);result={...result,layerId};
  }else if(input.action==="ambience"){
    if(input.assetId===null){saved.ambience=null;saved.ambienceMode="off";}
    else{const item=config(input,{ambience:true});await approved(root,item.assetId,item.sha256,{ambience:true});
      saved.ambience=item;saved.ambienceMode="pin";}
    result={...result,ambienceEnabled:saved.ambience!==null};
  }else if(input.action==="auto-ambience"){
    saved.ambience=null;saved.ambienceMode="auto";
    result={...result,ambienceMode:"auto"};
  }else fail("unsupported sound action");
  const path=file(root,projectId),parent=dirname(path);
  await mkdir(parent,{recursive:true,mode:0o700});
  const temp=await mkdtemp(join(parent,".audio-design-"));
  try{const staged=join(temp,"design.json");await writeFile(staged,JSON.stringify(saved,null,2)+"\n",
    {mode:0o600,flag:"wx"});await rename(staged,path);
  }finally{await rm(temp,{recursive:true,force:true});}
  return result;
}

/** Strict resolution for both Check and Start, never trust stored file paths. */
export async function resolveSoundDesign({projectId,bundle},{root=DEFAULT_ROOT}={}){
  const saved=await read(root,projectId);
  if(!saved.layers.length&&saved.ambienceMode==="off")return {layers:[],ambience:null,ambienceMode:"off"};
  const shots=bundle?.plan?.shots;
  if(!Array.isArray(shots)||shots.length<1||shots.length>160||
    shots.some(x=>!ID.test(x?.id??""))||new Set(shots.map(x=>x.id)).size!==shots.length)
    fail("unknown storyboard shots");
  const known=new Set(shots.map(x=>x.id)),seen=new Set(),counts=new Map(),library=await listApprovedSfx({root});
  function resolveAsset(item,{ambience=false}={}){const asset=library.find(x=>x.assetId===item.assetId&&x.sha256===item.sha256&&
    (ambience||x.assetType!=="music")&&x.license==="cc0"&&x.rightsStatus==="user-reviewed");
    if(!asset)fail("approved audio is missing, damaged or revoked; reselect a CC0 sound");
    return {title:asset.title,license:asset.license,rightsStatus:asset.rightsStatus,localPath:asset.localPath};}
  const layers=saved.layers.map(item=>{
    const layerId=valid(item.layerId,ID,"saved layer identifier");
    if(seen.has(layerId))fail("duplicate layer identifier");seen.add(layerId);
    const clip=config(item);
    if(!known.has(clip.shotId))fail(`unknown shot ${clip.shotId} in saved sound design`);
    counts.set(clip.shotId,(counts.get(clip.shotId)??0)+1);
    if(counts.get(clip.shotId)>4)fail("maximum four layers per shot");
    return {layerId,...clip,...resolveAsset(clip)};
  });
  const ambience=saved.ambienceMode==="auto"?(()=>{
    const music=recommendReviewedMusic(bundle,library);
    return music?{assetId:music.assetId,sha256:music.sha256,gainDb:-34,fadeInMs:1200,
      fadeOutMs:1500,title:music.title,license:music.license,rightsStatus:music.rightsStatus,
      localPath:music.localPath}:null;
  })():saved.ambience?(()=>{const setting=config(saved.ambience,{ambience:true});
    return {...setting,...resolveAsset(setting,{ambience:true})};})():null;
  return {layers,ambience,ambienceMode:saved.ambienceMode};
}
