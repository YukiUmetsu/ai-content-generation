/** Loopback-only, explicit-action bridge for per-scene asset search and approval. */
import {approveAsset, clearSelectedSceneAsset, discoverShotAssets, listApprovedAssets,
  listSelectedSceneAssets, selectApprovedSceneAsset} from "./video-production/asset-discovery.mjs";

const PREFIX="/api/contentgen-assets";
function send(res,status,payload){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"});
  res.end(JSON.stringify(payload));}
async function body(req){
  let size=0;const bytes=[];
  for await(const chunk of req){size+=chunk.length;
    if(size>1_200_000)throw Error("Asset request exceeds the 1.2 MB limit.");bytes.push(chunk);}
  try{return JSON.parse(Buffer.concat(bytes).toString("utf8"));}
  catch{throw Error("Invalid asset request JSON.");}
}
export async function handleAssetDiscoveryRequest(req,res,deps={}){
  const host=String(req.headers.host??""),origin=req.headers.origin;
  if(!/^(127\.0\.0\.1|localhost):\d+$/u.test(host)||
    (origin&&origin!=="http://"+host)||req.headers["sec-fetch-site"]==="cross-site"){
    send(res,403,{error:"Only local Studio may access scene assets."});return;
  }
  if(req.method==="POST"&&(origin!=="http://"+host||
    req.headers["x-contentgen-director"]!=="local-only")){
    send(res,403,{error:"Explicit same-origin Studio action required."});return;
  }
  const url=new URL(req.url??"/","http://localhost");
  try{
    const opts={pexelsKey:deps.pexelsKey??process.env.PEXELS_API_KEY,...(deps.options??{})};
    if(req.method==="POST"&&url.pathname==="/suggest"){
      const data=await body(req);
      if(data?.allowExternalSearch!==true)throw Error("Explicit external search permission required.");
      send(res,200,await (deps.search??discoverShotAssets)(data,opts));
    }else if(req.method==="POST"&&url.pathname==="/approve"){
      const data=await body(req);
      if(data?.confirmDownload!==true||data?.confirmRights!==true)
        throw Error("Review the provider license and approve each download first.");
      send(res,200,await (deps.approve??approveAsset)(data,opts));
    }else if(req.method==="POST"&&url.pathname==="/select"){
      send(res,200,await (deps.select??selectApprovedSceneAsset)(await body(req),opts));
    }else if(req.method==="POST"&&url.pathname==="/clear"){
      send(res,200,await (deps.clear??clearSelectedSceneAsset)(await body(req),opts));
    }else if(req.method==="GET"&&(url.pathname==="/approved"||url.pathname==="/selected")){
      const projectId=url.searchParams.get("projectId");
      if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/u.test(projectId??""))
        throw Error("Invalid project identifier.");
      if(url.pathname==="/approved")send(res,200,{assets:await (deps.list??listApprovedAssets)({projectId},opts)});
      else send(res,200,await (deps.selected??listSelectedSceneAssets)({projectId},opts));
    }else send(res,404,{error:"Unknown asset route."});
  }catch(error){
    send(res,422,{error:String(error?.message??"Asset operation failed.").slice(0,270)});
  }
}
export function assetDiscoveryPlugin(){return {name:"contentgen-scene-asset-discovery",
  configureServer(server){server.middlewares.use(PREFIX,(req,res)=>{void handleAssetDiscoveryRequest(req,res);});},
  configurePreviewServer(server){server.middlewares.use(PREFIX,(req,res)=>{void handleAssetDiscoveryRequest(req,res);});}};}
