/** Project-owned narration configuration. Voice IDs and engine names are local
 * preferences; credentials and per-request authorization never enter storage. */
import {projectNarratorSettingsKey,readProjectVoices} from "./project-voice-favorites";

export type AudioSettings={provider:"local"|"fish";voiceId:string;providerRevision:string;modelId:string;endpoint:string};
export const DEFAULT_FISH_ENGINE_REVISION="fish-api-v1";
export const AUDIO_PROFILE_KEY="contentgen:production-voice-profile:v1";
const legacyOwnerKey="contentgen:production-voice-profile:legacy-owner:v1";
export const DEFAULT_AUDIO_SETTINGS:AudioSettings={provider:"local",voiceId:"",providerRevision:"",modelId:"",
  endpoint:"http://127.0.0.1:8765"};

function fromRecord(value:unknown):AudioSettings|null{
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const saved=value as Record<string,unknown>;
  if(saved.provider!=="fish"&&saved.provider!=="local")return null;
  const profile:AudioSettings={...DEFAULT_AUDIO_SETTINGS,provider:saved.provider};
  for(const key of ["voiceId","providerRevision","modelId","endpoint"] as const){
    if(typeof saved[key]==="string"&&saved[key].length<=256)profile[key]=saved[key];
  }
  if(profile.provider==="fish"&&!profile.providerRevision.trim())
    profile.providerRevision=DEFAULT_FISH_ENGINE_REVISION;
  return profile;
}

export function readAudioSettings(projectId?:string,storage:Pick<Storage,"getItem"|"setItem">=localStorage):AudioSettings{
  const key=projectId?projectNarratorSettingsKey(projectId):AUDIO_PROFILE_KEY;
  try{
    const stored=storage.getItem(key);
    if(stored!==null){
      try{
        const parsed=fromRecord(JSON.parse(stored) as unknown);
        if(parsed)return parsed;
      }catch{/* Keep the corrupt value intact; use a valid project default. */}
    }
    if(projectId){
      const legacy=storage.getItem(AUDIO_PROFILE_KEY),owner=storage.getItem(legacyOwnerKey);
      if(legacy&&(!owner||owner===projectId)){
        try{
          const prior=fromRecord(JSON.parse(legacy) as unknown);
          if(prior?.voiceId.trim()){
            if(!owner)storage.setItem(legacyOwnerKey,projectId);
            return prior;
          }
        }catch{/* Use the project's own voice instead of a broken legacy value. */}
      }
      const favorite=readProjectVoices(projectId,storage as Storage).voices[0];
      if(favorite)return {...DEFAULT_AUDIO_SETTINGS,provider:favorite.provider,voiceId:favorite.voiceId,
        providerRevision:favorite.provider==="fish"?DEFAULT_FISH_ENGINE_REVISION:""};
    }
  }catch{/* Invalid/blocked local storage must not crash the production workflow. */}
  return {...DEFAULT_AUDIO_SETTINGS};
}

export function saveAudioSettings(settings:AudioSettings,projectId?:string,
  storage:Pick<Storage,"setItem">=localStorage):void{
  const parsed=fromRecord(settings);
  if(!parsed)throw Error("Choose a valid audio provider before saving.");
  storage.setItem(projectId?projectNarratorSettingsKey(projectId):AUDIO_PROFILE_KEY,JSON.stringify(parsed));
}
