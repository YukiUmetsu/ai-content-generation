/** Bind source-reviewed SFX to the actual shot/beat contract of a compiled Studio job.
 * Caller must pass results from the trusted local SFX resolver, never browser-provided paths.
 * This layer only names beat-start events; the measured timeline fixes their sample clocks.
 */
import {isAbsolute} from "node:path";
import {resolveSceneSfxChoices} from "./sfx-discovery.mjs";

const HASH=/^[a-f\d]{64}$/iu;
const ID=/^[a-z\d][a-z\d_-]{0,95}$/iu;
const UUID=/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu;

export function bindApprovedSfxToRenderJob(compiled,sceneChoices){
  if(!compiled?.job||!Array.isArray(compiled.job.beats)||!Array.isArray(compiled.shotMap)||
    !Array.isArray(sceneChoices)||compiled.shotMap.length!==compiled.job.beats.length)
    throw Error("Invalid shot-to-beat mapping for reviewed SFX.");
  const job=structuredClone(compiled.job);
  const seenShot=new Set(),beatIds=new Set();
  for(let i=0;i<compiled.shotMap.length;i++){
    const shot=compiled.shotMap[i];
    if(!ID.test(shot?.shotId??"")||seenShot.has(shot.shotId)||
      shot.beatId!==job.beats[i]?.id||beatIds.has(shot.beatId))
      throw Error("Inconsistent shot-to-beat mapping; refusing to place SFX.");
    seenShot.add(shot.shotId);beatIds.add(shot.beatId);
  }
  // Remove old illustrative sound effects. Otherwise mute/no-match would still
  // produce audible test chimes, contradicting Video Director's explicit intent.
  job.sounds=job.sounds.filter(sound=>sound.licenseStatus!=="test-only");
  const byShot=new Map(),summary={approved:0,muted:0,unmatched:0};
  for(const choice of sceneChoices){
    if(!seenShot.has(choice?.shotId))throw Error("Reviewed SFX references an unknown shot.");
    if(byShot.has(choice.shotId))throw Error("Duplicate reviewed SFX shot selection.");
    if(!["auto","pin","mute"].includes(choice.mode))throw Error("Invalid reviewed SFX choice mode.");
    byShot.set(choice.shotId,choice);
  }
  const eventIds=new Set(job.events.map(x=>x.id)),soundIds=new Set(job.sounds.map(x=>x.id));
  for(const [index,mapped] of compiled.shotMap.entries()){
    const choice=byShot.get(mapped.shotId);
    if(!choice)continue;
    if(choice.mode==="mute"){summary.muted++;continue;}
    if(!choice.assetId){
      if(choice.mode==="pin")throw Error(`Pinned sound missing or damaged for shot ${mapped.shotId}.`);
      summary.unmatched++;continue;
    }
    if(!UUID.test(choice.assetId)||choice.license!=="cc0"||choice.rightsStatus!=="user-reviewed"||
      !HASH.test(choice.sha256??"")||typeof choice.localPath!=="string"||!isAbsolute(choice.localPath))
      throw Error(`Selected sound lacks approved rights, verified hash or safe path for shot ${mapped.shotId}.`);
    let event=job.events.find(x=>x.beatId===mapped.beatId&&x.id===job.topic.payoffEventId)??
      job.events.find(x=>x.beatId===mapped.beatId&&!job.sounds.some(s=>s.eventId===x.id));
    if(!event){
      let eventId=`contentgen-sfx-${index+1}`;
      while(eventIds.has(eventId))eventId+="-new";
      event={id:eventId,beatId:mapped.beatId};job.events.push(event);
      job.beats[index].eventIds.push(eventId);eventIds.add(eventId);
    }
    if(job.sounds.some(x=>x.eventId===event.id))throw Error("A beat already has an authored sound on the selected SFX event.");
    let soundId=`reviewed-sfx-${index+1}`;
    while(soundIds.has(soundId))soundId+="-new";
    job.sounds.push({id:soundId,eventId:event.id,category:"editor.reviewed-sfx",
      assetRef:choice.localPath,assetSha256:choice.sha256,licenseStatus:"verified"});
    soundIds.add(soundId);summary.approved++;
  }
  return {job,sfxSummary:summary};
}

/** Shared by readiness and render-start to keep the checked audio identity exact. */
export async function resolveAndBindApprovedSfx(compiled,{dossier,bundle},{resolve=resolveSceneSfxChoices}={}){
  if(typeof dossier?.id!=="string"||!ID.test(dossier.id)||bundle?.researchId!==dossier.id)
    throw Error("SFX project must match the selected research dossier and bundle.");
  const choices=await resolve({projectId:dossier.id,bundle});
  return bindApprovedSfxToRenderJob(compiled,choices);
}
