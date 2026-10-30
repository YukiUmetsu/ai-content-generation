/** Revision-checked, nonsecret scene speaker assignments for one immutable
 * compiled source storyboard. Consent and credentials never enter this API. */
export type SceneSpeaker={id:string;role:"narrator"|"character";provider:"fish"|"local";voiceId:string};
export type SceneCast={schemaVersion:1;projectId:string;sourcePlanSha256:string;
  assignments:Array<{shotId:string;speaker:SceneSpeaker}>};
export type SceneCastSnapshot={revision:number;cast:SceneCast|null};

const ROOT=`${(import.meta.env.VITE_API_BASE??"").replace(/\/$/,"")}/api/scene-cast`;
const isRecord=(value:unknown):value is Record<string,unknown>=>
  !!value&&typeof value==="object"&&!Array.isArray(value);
const keys=(value:Record<string,unknown>,allowed:string[])=>
  Object.keys(value).every(key=>allowed.includes(key));
const id=(value:unknown,max=80):value is string=>
  typeof value==="string"&&value.length>0&&value.length<=max&&/^[a-zA-Z0-9_-]+$/u.test(value);
const sha=(value:unknown):value is string=>typeof value==="string"&&/^[a-f0-9]{64}$/u.test(value);

export function validateSceneCast(input:unknown,projectId:string,sourcePlanSha256:string):SceneCast{
  if(!id(projectId,160)||!sha(sourcePlanSha256)||!isRecord(input)||
    !keys(input,["schemaVersion","projectId","sourcePlanSha256","assignments"])||
    input.schemaVersion!==1||input.projectId!==projectId||input.sourcePlanSha256!==sourcePlanSha256||
    !Array.isArray(input.assignments)||input.assignments.length>160)
    throw Error("Saved scene voices have an invalid project, source revision or format.");
  const seenShots=new Set<string>(),seenSpeakers=new Map<string,string>();
  const assignments=input.assignments.map((raw:unknown)=>{
    if(!isRecord(raw)||!keys(raw,["shotId","speaker"])||!id(raw.shotId)||!isRecord(raw.speaker)||
      !keys(raw.speaker,["id","role","provider","voiceId"]))throw Error("Saved scene voice entry is malformed.");
    const voice=raw.speaker;
    if(!id(voice.id)||!["narrator","character"].includes(String(voice.role))||
      (voice.role==="narrator")!==(voice.id==="narrator")||
      !["local","fish"].includes(String(voice.provider))||
      typeof voice.voiceId!=="string"||!voice.voiceId.trim()||voice.voiceId.length>128||
      voice.voiceId!==voice.voiceId.trim()||[...voice.voiceId].some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127)||
      (voice.provider==="fish"&&!/^[a-f0-9]{32}$/u.test(voice.voiceId)))
      throw Error("Saved scene voice has an invalid speaker, provider or voice ID.");
    if(seenShots.has(raw.shotId))throw Error("The same scene has multiple saved speakers.");
    seenShots.add(raw.shotId);
    const speaker={id:voice.id as string,role:voice.role as SceneSpeaker["role"],
      provider:voice.provider as SceneSpeaker["provider"],voiceId:voice.voiceId};
    const fingerprint=JSON.stringify(speaker),prior=seenSpeakers.get(speaker.id);
    if(prior&&prior!==fingerprint)throw Error("A character has inconsistent voices across scenes.");
    seenSpeakers.set(speaker.id,fingerprint);
    return {shotId:raw.shotId as string,speaker};
  });
  return {schemaVersion:1,projectId,sourcePlanSha256,assignments};
}

export function castFromBundle(projectId:string,sourcePlanSha256:string,
  bundle:{plan:{sound:Array<{shotId:string;speaker?:SceneSpeaker}>}}):SceneCast{
  return validateSceneCast({schemaVersion:1,projectId,sourcePlanSha256,
    assignments:bundle.plan.sound.filter(sound=>sound.speaker).map(sound=>({shotId:sound.shotId,speaker:sound.speaker}))},
  projectId,sourcePlanSha256);
}

export function castEqual(a:SceneCast,b:SceneCast):boolean{
  if(a.projectId!==b.projectId||a.sourcePlanSha256!==b.sourcePlanSha256||a.assignments.length!==b.assignments.length)return false;
  const fingerprint=(cast:SceneCast)=>JSON.stringify([...cast.assignments]
    .sort((left,right)=>left.shotId.localeCompare(right.shotId)));
  return fingerprint(a)===fingerprint(b);
}

export function castEdits(bundle:{plan:{sound:Array<{shotId:string;speaker?:SceneSpeaker}>}},saved:SceneCast):
  Array<{shotId:string;speaker:SceneSpeaker|null}>{
  const shots=new Set(bundle.plan.sound.map(sound=>sound.shotId));
  if(saved.assignments.some(entry=>!shots.has(entry.shotId)))
    throw Error("Saved cast refers to a scene that is absent from this source revision. Review the older storyboard before syncing.");
  const byShot=new Map(saved.assignments.map(entry=>[entry.shotId,entry.speaker]));
  return bundle.plan.sound.flatMap(sound=>{
    const expected=byShot.get(sound.shotId)??null;
    return JSON.stringify(expected)===JSON.stringify(sound.speaker??null)?[]:[{shotId:sound.shotId,speaker:expected}];
  });
}

function url(projectId:string,sourcePlanSha256:string):string{
  if(!id(projectId,160)||!sha(sourcePlanSha256))throw Error("Invalid scene cast project or source revision.");
  return `${ROOT}/${encodeURIComponent(projectId)}/${sourcePlanSha256}`;
}

async function call(path:string,body?:unknown):Promise<SceneCastSnapshot>{
  let response:Response;
  try{response=await fetch(path,{method:body===undefined?"GET":"PUT",cache:"no-store",
    headers:body===undefined?undefined:{"Content-Type":"application/json","X-Contentgen-Scene-Cast":"local-only"},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});}
  catch{throw Error("Could not reach saved scene voices. Start the local Rust server, then retry sync.");}
  let payload:unknown;
  try{payload=await response.json();}
  catch{throw Error(`Scene voice storage returned an unreadable response (HTTP ${response.status}).`);}
  if(!response.ok){
    const detail=isRecord(payload)?(typeof payload.error==="string"?payload.error:
      isRecord(payload.error)&&typeof payload.error.message==="string"?payload.error.message:
      typeof payload.message==="string"?payload.message:""):"";
    throw Error(detail?`Scene voices: ${detail.slice(0,240)}`:`Could not save scene voices (HTTP ${response.status}).`);
  }
  if(!isRecord(payload)||!Number.isSafeInteger(payload.revision)||
    (payload.revision as number)<0||(payload.revision as number)>2147483647||
    (payload.cast!==null&&!isRecord(payload.cast))||
    ((payload.revision as number)===0)!==(payload.cast===null))
    throw Error("Saved scene voice revision is invalid.");
  return payload as SceneCastSnapshot;
}

export async function loadSceneCast(projectId:string,sourcePlanSha256:string):Promise<SceneCastSnapshot>{
  const response=await call(url(projectId,sourcePlanSha256));
  return {revision:response.revision,cast:response.cast===null?null:
    validateSceneCast(response.cast,projectId,sourcePlanSha256)};
}

export async function writeSceneCast(projectId:string,sourcePlanSha256:string,revision:number,cast:SceneCast):Promise<SceneCastSnapshot>{
  if(!Number.isSafeInteger(revision)||revision<0||revision>=2147483647)throw Error("Invalid scene cast revision.");
  const valid=validateSceneCast(cast,projectId,sourcePlanSha256);
  const response=await call(url(projectId,sourcePlanSha256),{revision,cast:valid});
  if(response.revision!==revision+1||!response.cast)throw Error("Scene voice storage returned a mismatched revision. Reload before editing.");
  const saved=validateSceneCast(response.cast,projectId,sourcePlanSha256);
  if(!castEqual(saved,valid))throw Error("Saved scene voices changed unexpectedly. Reload before editing.");
  return {revision:response.revision,cast:saved};
}
