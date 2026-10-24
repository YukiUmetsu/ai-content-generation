/** Bind source-reviewed SFX to the actual shot/beat contract of a compiled Studio job.
 * Caller must pass results from the trusted local SFX resolver, never browser-provided paths.
 * This layer only names beat-start events; the measured timeline fixes their sample clocks.
 */
import {isAbsolute} from "node:path";
import {resolveSceneSfxChoices} from "./sfx-discovery.mjs";
import {resolveSoundDesign} from "./sound-design.mjs";

const HASH=/^[a-f\d]{64}$/iu;
const ID=/^[a-z\d][a-z\d_-]{0,95}$/iu;
const UUID=/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu;

const assertVisualCue=(job,index,shotId)=>{
  const beat=job.beats[index],visualState=beat.visual;
  const unknownReveal=beat.visualIntent==="general-flow"||visualState?.sceneRecipe||visualState?.chart||
    visualState?.direction?.visualMechanic||visualState?.direction?.transformation||
    (beat.visualIntent==="general-intro"&&visualState?.hookStrategy==="unexpected-reveal");
  if(job.visualFamily!=="general-explainer-v1"||unknownReveal)
    throw Error(`First-visual-reveal SFX timing is unsupported for this visual presentation in shot ${shotId}; use shot-start timing.`);
};
const assertReviewed=choice=>{
  if(!UUID.test(choice?.assetId??"")||choice.license!=="cc0"||choice.rightsStatus!=="user-reviewed"||
    !HASH.test(choice.sha256??"")||typeof choice.localPath!=="string"||!isAbsolute(choice.localPath))
    throw Error("Selected sound lacks approved rights, verified hash or safe path.");
};

export function bindApprovedSfxToRenderJob(compiled,sceneChoices,design={layers:[],ambience:null}){
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
    if(!["shot-start","first-visual-reveal"].includes(choice.trigger??"shot-start"))
      throw Error("Invalid reviewed SFX timing trigger.");
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
    assertReviewed(choice);
    const visual=choice.trigger==="first-visual-reveal";
    if(visual)assertVisualCue(job,index,mapped.shotId);
    let event=visual?undefined:(job.events.find(x=>x.beatId===mapped.beatId&&x.id===job.topic.payoffEventId)??
      job.events.find(x=>x.beatId===mapped.beatId&&!x.anchor&&!job.sounds.some(s=>s.eventId===x.id)));
    if(!event){
      let eventId=`contentgen-sfx-${index+1}`;
      while(eventIds.has(eventId))eventId+="-new";
      event={id:eventId,beatId:mapped.beatId,...(visual?{anchor:"first-visual-reveal"}:{})};job.events.push(event);
      job.beats[index].eventIds.push(eventId);eventIds.add(eventId);
    }
    if(job.sounds.some(x=>x.eventId===event.id))throw Error("A beat already has an authored sound on the selected SFX event.");
    let soundId=`reviewed-sfx-${index+1}`;
    while(soundIds.has(soundId))soundId+="-new";
    job.sounds.push({id:soundId,eventId:event.id,category:"editor.reviewed-sfx",
      assetRef:choice.localPath,assetSha256:choice.sha256,licenseStatus:"verified"});
    soundIds.add(soundId);summary.approved++;
  }
  if(!design||!Array.isArray(design.layers)||design.layers.length>80||
    !(design.ambience===null||design.ambience===undefined||typeof design.ambience==="object"))
    throw Error("Invalid supplementary sound design.");
  const indexByShot=new Map(compiled.shotMap.map((shot,i)=>[shot.shotId,i]));
  const counts=new Map(),seenLayers=new Set();
  const addLayer=(layer,index,{ambience=false}={})=>{
    assertReviewed(layer);
    if(!Number.isFinite(layer.gainDb)||layer.gainDb< -48||layer.gainDb>(ambience?-12:0)||
      !Number.isSafeInteger(layer.fadeInMs)||layer.fadeInMs<0||layer.fadeInMs>(ambience?5000:2000)||
      !Number.isSafeInteger(layer.fadeOutMs)||layer.fadeOutMs<0||layer.fadeOutMs>(ambience?5000:2000)||
      !Number.isSafeInteger(layer.offsetMs??0)||(layer.offsetMs??0)<0||
      (layer.offsetMs??0)>(ambience?0:10000))throw Error("Invalid supplementary sound gain, offset or fade range.");
    const visual=!ambience&&layer.trigger==="first-visual-reveal";
    if(!ambience&&!(["shot-start","first-visual-reveal"].includes(layer.trigger)))
      throw Error("Invalid supplementary sound timing trigger.");
    if(visual)assertVisualCue(job,index,layer.shotId);
    const suffix=ambience?"ambience":layer.layerId;
    let eventId=`contentgen-layer-${suffix}`;
    while(eventIds.has(eventId))eventId+="-new";
    job.events.push({id:eventId,beatId:job.beats[index].id,...(visual?{anchor:"first-visual-reveal"}:{})});
    job.beats[index].eventIds.push(eventId);eventIds.add(eventId);
    let soundId=`reviewed-layer-${suffix}`;
    while(soundIds.has(soundId))soundId+="-new";
    job.sounds.push({id:soundId,eventId,kind:ambience?"ambience":"effect",
      category:ambience?"editor.ambience":"editor.supplementary-sfx",assetRef:layer.localPath,
      assetSha256:layer.sha256,licenseStatus:"verified",offsetMs:layer.offsetMs??0,
      gainDb:layer.gainDb,fadeInMs:layer.fadeInMs,fadeOutMs:layer.fadeOutMs});soundIds.add(soundId);
  };
  for(const layer of design.layers){
    if(!ID.test(layer?.layerId??"")||seenLayers.has(layer.layerId))throw Error("Invalid or duplicate supplementary layer identifier.");
    seenLayers.add(layer.layerId);
    const index=indexByShot.get(layer.shotId);
    if(index===undefined)throw Error("Supplementary SFX references an unknown shot.");
    counts.set(layer.shotId,(counts.get(layer.shotId)??0)+1);
    if(counts.get(layer.shotId)>4)throw Error("Maximum four supplementary sound layers per shot.");
    addLayer(layer,index);
  }
  if(design.ambience)addLayer(design.ambience,0,{ambience:true});
  if(design.layers.length||design.ambience){summary.extraLayers=design.layers.length;
    summary.ambience=design.ambience?1:0;}
  return {job,sfxSummary:summary};
}

/** Shared by readiness and render-start to keep the checked audio identity exact. */
export async function resolveAndBindApprovedSfx(compiled,{dossier,bundle},
  {resolve=resolveSceneSfxChoices,resolveDesign=resolveSoundDesign}={}){
  if(typeof dossier?.id!=="string"||!ID.test(dossier.id)||bundle?.researchId!==dossier.id)
    throw Error("SFX project must match the selected research dossier and bundle.");
  const selection={projectId:dossier.id,bundle};
  const [choices,design]=await Promise.all([resolve(selection),resolveDesign(selection)]);
  return bindApprovedSfxToRenderJob(compiled,choices,design);
}
