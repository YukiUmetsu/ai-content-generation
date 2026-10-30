import {validateProjectVoices,voiceFavoritesKey,type ProjectVoiceFavorites} from "./project-voice-favorites";

const ROOT = `${(import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "")}/api/project-voices`;
export type SavedProjectVoices = {revision:number;library:ProjectVoiceFavorites|null};

function parseSnapshot(value:unknown,projectId:string):SavedProjectVoices {
  if(!value||typeof value!=="object"||Array.isArray(value))throw Error("Invalid project voice server response.");
  const data=value as Record<string,unknown>;
  if(!Number.isSafeInteger(data.revision)||(data.revision as number)<0||(data.revision as number)>2_147_483_647)
    throw Error("Invalid project voice revision from the server.");
  const revision=data.revision as number;
  if(data.library===null&&revision===0)return {revision,library:null};
  if(data.library===null||revision===0)throw Error("Incomplete project voice server response.");
  return {revision,library:validateProjectVoices(data.library,projectId)};
}

async function request(projectId:string,init:RequestInit):Promise<SavedProjectVoices>{
  voiceFavoritesKey(projectId);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),12_000);
  try{
    const response=await fetch(`${ROOT}/${encodeURIComponent(projectId)}`,{...init,cache:"no-store",signal:controller.signal});
    if(response.status===409)throw Error("Project voices changed in another editor. Reload before saving.");
    if(!response.ok){
      let detail="";
      try{const body=await response.json() as {error?:{message?:unknown}};
        if(typeof body.error?.message==="string")detail=body.error.message.slice(0,240);}catch{ /* show HTTP status */ }
      throw Error(`Project voice server rejected the request (HTTP ${response.status}).${detail?` ${detail}`:""}`);
    }
    return parseSnapshot(await response.json() as unknown,projectId);
  }catch(error){
    if(controller.signal.aborted)throw Error("Project voice server timed out. Check the local Rust service.");
    if(error instanceof TypeError)throw Error("Cannot reach the local Rust service. Saved project voices are still on this device.");
    throw error;
  }finally{clearTimeout(timer);}
}

export function loadSavedProjectVoices(projectId:string):Promise<SavedProjectVoices>{
  return request(projectId,{method:"GET",headers:{Accept:"application/json"}});
}

export async function writeSavedProjectVoices(projectId:string,revision:number,library:ProjectVoiceFavorites):Promise<SavedProjectVoices>{
  const checked=validateProjectVoices(library,projectId);
  if(!Number.isSafeInteger(revision)||revision<0||revision>=2_147_483_647)throw Error("Invalid expected project voice revision.");
  const snapshot=await request(projectId,{method:"PUT",headers:{"Content-Type":"application/json","X-Contentgen-Voices":"local-only",Accept:"application/json"},
    body:JSON.stringify({revision,library:checked})});
  if(snapshot.revision!==revision+1||JSON.stringify(snapshot.library)!==JSON.stringify(checked))
    throw Error("Project voice server did not confirm the saved data. Reload to reconcile.");
  return snapshot;
}
