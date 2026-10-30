/** Private, bounded handoff for a user-authorized render after the Node process exits.
 * Rust Jobs still owns attempts, retries and artifact completion. */
import {createHash} from "node:crypto";
import {lstat,mkdir,readFile,readdir,writeFile} from "node:fs/promises";
import {join} from "node:path";

const RUN_ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const PRODUCTION_ID=/^production-[a-f0-9]{24}$/u;
const SHA=/^[a-f0-9]{64}$/u;
const MAX_BYTES=1_200_000;
const FILENAME="render-intent.json",MARKER="recovery-claimed";
const digest=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");

function validRevision(value){return value===null||typeof value==="string"&&value.length<=300&&!/[\u0000-\u001f]/u.test(value);}
function validateIntent(runId,intent){
  if(!RUN_ID.test(runId))throw Error("Recovery requires a valid owned run ID identity.");
  if(!PRODUCTION_ID.test(intent?.productionId)||!SHA.test(intent?.revision??""))
    throw Error("Recovery requires a production identity and SHA-256 revision.");
  if(!validRevision(intent.sourceRevision)||intent.request?.productionId!==intent.productionId||
    intent.request?.sourceRevision!==intent.sourceRevision||
    !intent.request?.dossier||!intent.request?.bundle||
    !["fish","local"].includes(intent.request?.settings?.provider))
    throw Error("Recovery request is missing its authorized production revision.");
  // Use a narrow schema, not a spread of unrecognized browser-supplied keys.
  // apiKey and unexpected future settings must never become durable metadata.
  const raw=intent.request.settings;
  const allowedSettings=new Set(["provider","voiceId","providerRevision","modelId",
    "endpoint","localVoiceAuthorized","voiceConsent","transmitText"]);
  const settings=Object.fromEntries(Object.keys(raw).filter(key=>allowedSettings.has(key)).map(key=>[key,raw[key]]));
  const characterProjectId=intent.request.characterProjectId;
  if(characterProjectId!==undefined&&
    (typeof characterProjectId!=="string"||!/^[A-Za-z0-9_-]{1,120}$/.test(characterProjectId)))
    throw Error("Recovery Character Studio project identity is invalid.");
  const draftIds=intent.request.characterDraftIds;
  const draftIdsByScene=intent.request.characterDraftIdsByScene;
  const validPicks=picks=>picks&&typeof picks==="object"&&!Array.isArray(picks)&&
    Object.entries(picks).length<=2&&Object.entries(picks).every(([speaker,id])=>
      ["pip","quill"].includes(speaker)&&typeof id==="string"&&/^character-draft-[a-f0-9]{32}$/u.test(id));
  if(draftIds!==undefined&&!validPicks(draftIds)||draftIdsByScene!==undefined&&
    (!draftIdsByScene||typeof draftIdsByScene!=="object"||Array.isArray(draftIdsByScene)||
      Object.entries(draftIdsByScene).length>64||Object.entries(draftIdsByScene).some(([scene,picks])=>
        !/^[a-z0-9][a-z0-9_-]{0,95}$/iu.test(scene)||!validPicks(picks)||!Object.keys(picks).length)))
    throw Error("Saved Character Studio selections are invalid. Reopen the production editor.");
  const request={productionId:intent.productionId,sourceRevision:intent.sourceRevision,
    ...(characterProjectId===undefined?{}:{characterProjectId}),
    ...(draftIds===undefined?{}:{characterDraftIds:draftIds}),
    ...(draftIdsByScene===undefined?{}:{characterDraftIdsByScene:draftIdsByScene}),
    dossier:intent.request.dossier,bundle:intent.request.bundle,settings,
    // Preserve the exact consent that was included in the checked render identity;
    // dropping it would make an authorized multi-voice draft unrecoverable.
    castVoiceConsent:intent.request.castVoiceConsent===true,
    searchFreeMedia:intent.request.searchFreeMedia===true,
    autoPrepareFreeMedia:intent.request.autoPrepareFreeMedia!==false,
    confirmUpdatedVersion:intent.request.confirmUpdatedVersion===true};
  const identityParts=intent.identityParts;
  if(identityParts!==undefined&&(!identityParts||typeof identityParts!=="object"||Array.isArray(identityParts)||
    Object.keys(identityParts).length!==4||["story","media","characters","voice"].some(key=>!SHA.test(identityParts[key]??""))))
    throw Error("Recovery input fingerprints are invalid. Reopen the production editor.");
  const document={schemaVersion:1,runId,productionId:intent.productionId,
    sourceRevision:intent.sourceRevision,revision:intent.revision,
    createdAt:Date.now(),autoRecover:intent.autoRecover!==false,request,
    ...(identityParts===undefined?{}:{identityParts})};
  document.contentHash=digest(request);
  const bytes=JSON.stringify(document);
  if(Buffer.byteLength(bytes)>MAX_BYTES)throw Error("Recovery snapshot exceeds the size limit.");
  return bytes;
}
async function ownedDirectory(path){
  const info=await lstat(path);
  if(!info.isDirectory()||info.isSymbolicLink())throw Error("Recovery directory is not an owned directory.");
}
export async function writeRecoveryIntent(outputRoot,runId,intent){
  const bytes=validateIntent(runId,intent);
  await mkdir(outputRoot,{recursive:true,mode:0o700});
  await ownedDirectory(outputRoot);
  const folder=join(outputRoot,"draft-"+runId);
  await mkdir(folder,{mode:0o700,recursive:true});
  await ownedDirectory(folder);
  await writeFile(join(folder,FILENAME),bytes,{flag:"wx",mode:0o600});
}
async function load(outputRoot,runId){
  const folder=join(outputRoot,"draft-"+runId);
  await ownedDirectory(folder);
  const path=join(folder,FILENAME),info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink()||info.size<80||info.size>MAX_BYTES)return null;
  const data=JSON.parse(await readFile(path,"utf8"));
  if(data?.schemaVersion!==1||data.runId!==runId||
    !Number.isSafeInteger(data.createdAt)||data.createdAt<=0||
    !validRevision(data.sourceRevision)||
    data.request?.settings?.apiKey!==undefined||
    data.contentHash!==digest(data.request))return null;
  const normalized=JSON.parse(validateIntent(runId,data));
  if(normalized.contentHash!==data.contentHash||normalized.productionId!==data.productionId||
    normalized.sourceRevision!==data.sourceRevision||normalized.revision!==data.revision)
    return null;
  let claimed=false;
  try{const marker=await lstat(join(folder,MARKER));claimed=marker.isFile()&&!marker.isSymbolicLink();
    if(!claimed)return null;
  }catch(error){if(error?.code!=="ENOENT")throw error;}
  return {...data,autoRecover:data.autoRecover===true&&!claimed};
}
export async function listRecoveryIntents(outputRoot){
  let entries;
  try{await ownedDirectory(outputRoot);entries=await readdir(outputRoot,{withFileTypes:true});}
  catch(error){if(error?.code==="ENOENT")return [];throw error;}
  if(entries.length>10000)throw Error("Recovery output directory exceeds the safe scan limit.");
  const result=[];
  for(const entry of entries){
    const runId=entry.name.startsWith("draft-")?entry.name.slice(6):"";
    if(!RUN_ID.test(runId)||!entry.isDirectory()||entry.isSymbolicLink())continue;
    try{const intent=await load(outputRoot,runId);if(intent)result.push(intent);}
    catch{/* Do not execute malformed or externally replaced intent files. */}
  }
  return result.sort((a,b)=>b.createdAt-a.createdAt||b.runId.localeCompare(a.runId)).slice(0,100);
}
export async function reserveRecoveryAttempt(outputRoot,runId){
  if(!RUN_ID.test(runId))throw Error("Recovery requires a valid run ID identity.");
  if(!await load(outputRoot,runId))return false;
  try{
    await writeFile(join(outputRoot,"draft-"+runId,MARKER),String(Date.now()),{flag:"wx",mode:0o600});
    return true;
  }catch(error){if(error?.code==="EEXIST")return false;throw error;}
}
