/** Same-origin, local-only Studio bridge for third-party CC0 SFX. */
import {approveSfx,discoverSfx,listApprovedSfx,resolveSceneSfxChoices,setSceneSfxChoice}
  from "./video-production/sfx-discovery.mjs";
import {setSoundDesign,resolveSoundDesign} from "./video-production/sound-design.mjs";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";

const ID=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/u;
const mixFields=["assetId","sha256","title","gainDb","fadeInMs","fadeOutMs"];
const editorFields=[...mixFields,"layerId","shotId","trigger","offsetMs"];
const projectEditorFields=(item,fields)=>Object.fromEntries(fields.filter(key=>
  Object.hasOwn(item,key)).map(key=>[key,item[key]]));
function forSoundEditor(design){
  return {layers:design.layers.map(item=>projectEditorFields(item,editorFields)),
    ambience:design.ambience?projectEditorFields(design.ambience,mixFields):null};
}
function send(res,status,value){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"});
  res.end(JSON.stringify(value));}
async function jsonBody(req){const bytes=[];let size=0;
  for await(const chunk of req){size+=chunk.length;
    if(size>1_200_000)throw Error("SFX request is too large.");bytes.push(chunk);}
  try{return JSON.parse(Buffer.concat(bytes).toString("utf8"));}
  catch{throw Error("Invalid SFX request JSON.");}}

export async function handleSfxDiscoveryRequest(req,res,deps={}){
  const host=String(req.headers.host??""),origin=req.headers.origin;
  if(!/^(127\.0\.0\.1|localhost):\d+$/u.test(host)||
    (origin&&origin!=="http://"+host)||req.headers["sec-fetch-site"]==="cross-site"){
    send(res,403,{error:"Sound library is accessible only from local Studio."});return;
  }
  if(req.method==="POST"&&(origin!=="http://"+host||req.headers["x-contentgen-director"]!=="local-only")){
    send(res,403,{error:"An explicit same-origin Studio action is required."});return;
  }
  const pathname=new URL(req.url??"/","http://localhost").pathname;
  try{
    const opts=deps.options??{};
    if(req.method==="POST"&&pathname==="/suggest"){
      const payload=await jsonBody(req);
      if(payload?.allowExternalSearch!==true)throw Error("Explicit SFX search approval required.");
      send(res,200,await (deps.search??discoverSfx)(payload,opts));
    }else if(req.method==="POST"&&pathname==="/approve"){
      const payload=await jsonBody(req);
      if(payload?.confirmRights!==true||payload?.confirmDownload!==true)
        throw Error("Source/license review and download approval required.");
      send(res,200,await (deps.approve??approveSfx)(payload,opts));
    }else if(req.method==="GET"&&pathname==="/library"){
      send(res,200,{assets:await (deps.list??listApprovedSfx)(opts)});
    }else if(req.method==="GET"&&pathname.startsWith("/preview/")){
      const digest=pathname.slice("/preview/".length);
      if(!/^[a-f\d]{64}$/u.test(digest)){send(res,404,{error:"Sound preview not found."});return;}
      const approved=await (deps.list??listApprovedSfx)(opts);
      const match=approved.find(x=>x.sha256===digest);
      if(!match){send(res,404,{error:"Sound preview not found."});return;}
      const bytes=await (deps.readAudio??readFile)(match.localPath);
      if(bytes.length>16*1024*1024||createHash("sha256").update(bytes).digest("hex")!==digest){
        send(res,404,{error:"Sound preview is no longer verified."});return;
      }
      res.writeHead(200,{"Content-Type":"audio/wav","Content-Length":bytes.length,
        "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});res.end(bytes);
    }else if(req.method==="POST"&&pathname==="/choices"){
      const payload=await jsonBody(req);
      if(!ID.test(payload?.projectId??""))throw Error("Invalid project identifier.");
      send(res,200,{scenes:await (deps.resolve??resolveSceneSfxChoices)(payload,opts)});
    }else if(req.method==="POST"&&pathname==="/set-choice"){
      const payload=await jsonBody(req);
      if(!ID.test(payload?.projectId??"")||!ID.test(payload?.shotId??"")||
        !["auto","mute","pin"].includes(payload?.mode))throw Error("Invalid SFX choice.");
      send(res,200,await (deps.choice??setSceneSfxChoice)(payload,opts));
    }else if(req.method==="POST"&&pathname==="/sound-design"){
      const payload=await jsonBody(req),action=payload?.action;
      if(!ID.test(payload?.projectId??"")||!["resolve","upsert","remove","ambience"].includes(action))
        throw Error("Invalid sound-design request.");
      const accepted=new Set(action==="resolve"?["action","projectId","bundle"]:
        action==="upsert"?["action","projectId","layerId","shotId","assetId","sha256","trigger","offsetMs","gainDb","fadeInMs","fadeOutMs"]:
        action==="remove"?["action","projectId","layerId"]:
        ["action","projectId","assetId","sha256","gainDb","fadeInMs","fadeOutMs"]);
      if(Object.keys(payload).some(key=>!accepted.has(key)))throw Error("Unexpected sound-design input field.");
      if(action==="resolve")send(res,200,forSoundEditor(await (deps.soundDesignRead??resolveSoundDesign)(payload,opts)));
      else send(res,200,await (deps.soundDesignWrite??setSoundDesign)(payload,opts));
    }else send(res,404,{error:"Unknown sound library route."});
  }catch(error){send(res,422,{error:String(error?.message??"Sound operation failed.").slice(0,270)});}
}
