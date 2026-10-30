import {characterVoicesKey,validateCharacterVoiceBindings,type CharacterVoiceBindings} from "./character-voice-bindings";

const ROOT=`${(import.meta.env.VITE_API_BASE??"").replace(/\/$/,"")}/api/character-voices`;
export type SavedCharacterVoices={revision:number;registry:CharacterVoiceBindings|null};

function parse(value:unknown,projectId:string):SavedCharacterVoices {
  if(!value||typeof value!=="object"||Array.isArray(value))throw Error("Invalid character voice server response.");
  const obj=value as Record<string,unknown>;
  if(!Number.isSafeInteger(obj.revision)||(obj.revision as number)<0||(obj.revision as number)>2_147_483_647)
    throw Error("Invalid character voice server revision.");
  const revision=obj.revision as number;
  if(revision===0&&obj.registry===null)return {revision,registry:null};
  if(revision===0||obj.registry===null)throw Error("Incomplete character voice server response.");
  return {revision,registry:validateCharacterVoiceBindings(obj.registry,projectId)};
}

async function request(projectId:string,init:RequestInit):Promise<SavedCharacterVoices>{
  characterVoicesKey(projectId);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),12_000);
  try{
    const response=await fetch(`${ROOT}/${encodeURIComponent(projectId)}`,{...init,cache:"no-store",signal:controller.signal});
    if(response.status===409)throw Error("Character voice assignments changed in another editor. Reload before saving.");
    if(!response.ok){
      let detail="";
      try{const data=await response.json() as {error?:{message?:unknown}};
        if(typeof data.error?.message==="string")detail=data.error.message.slice(0,240);}catch{/* use status */}
      throw Error(`Character voice server rejected the request (HTTP ${response.status}).${detail?` ${detail}`:""}`);
    }
    return parse(await response.json() as unknown,projectId);
  }catch(error){
    if(controller.signal.aborted)throw Error("Character voice sync timed out. Check the local Rust server.");
    if(error instanceof TypeError)throw Error("Cannot reach the local Rust server. Browser character assignments remain unchanged.");
    throw error;
  }finally{clearTimeout(timer);}
}

export function loadSavedCharacterVoices(projectId:string):Promise<SavedCharacterVoices>{
  return request(projectId,{method:"GET",headers:{Accept:"application/json"}});
}

export async function writeSavedCharacterVoices(projectId:string,revision:number,registry:CharacterVoiceBindings):Promise<SavedCharacterVoices>{
  const checked=validateCharacterVoiceBindings(registry,projectId);
  if(!Number.isSafeInteger(revision)||revision<0||revision>=2_147_483_647)throw Error("Invalid expected character voice revision.");
  const saved=await request(projectId,{method:"PUT",headers:{"Content-Type":"application/json","X-Contentgen-Character-Voices":"local-only",Accept:"application/json"},
    body:JSON.stringify({revision,registry:checked})});
  if(saved.revision!==revision+1||JSON.stringify(saved.registry)!==JSON.stringify(checked))
    throw Error("Character voice server did not confirm the saved assignments. Reload to reconcile.");
  return saved;
}
