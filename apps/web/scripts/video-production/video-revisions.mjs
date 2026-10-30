/**
 * Surgical edits of existing preproduction plans. Never mutates an original,
 * implicitly reuses old approval, deletes media or silently regenerates.
 */
import { createHash } from "node:crypto";
import { compilePreproductionBundle, isProductionSpeaker } from "./preproduction.mjs";
import { isSceneMotion } from "./scene-motion.mjs";
import { isVisualElements } from "./visual-elements.mjs";
const sha=v=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
// Animation names change only the Kumiki visual track, never voice text,
// timing, provider identity or permissions. Preserve expensive TTS caches.
const speechOnly=turns=>Array.isArray(turns)?turns.map(turn=>({id:turn.id,narration:turn.narration,
  pauseAfterMs:turn.pauseAfterMs,speaker:turn.speaker})):null;
const text=(v,max=2000)=>typeof v==="string"&&v.trim()&&v.length<=max&&!/[\u0000-\u0008\u000e-\u001f]/u.test(v);
const allowed=["narration","onScreenText","visualChange","visualAction","sfxIntent","motion","visualElements","family","pauseAfterMs","speaker","speechTurns"];
const families=new Set(["question","process","comparison","cost-breakdown","mechanism","evidence","summary"]);
export function editPreproductionShot(dossier,original,edit){
  if(!original || original.kind!=="preproduction-bundle" || original.researchId!==dossier?.id ||
     original.researchSha256!==sha(dossier) || original.planSha256!==sha(original.plan))
    throw Error("Use an untampered preproduction bundle and its exact original research dossier.");
  if(!edit || typeof edit!=="object"||!edit.shotId||
     Object.keys(edit).some(k=>!["shotId","changes"].includes(k)) ||
     !edit.changes||typeof edit.changes!=="object"||Array.isArray(edit.changes))
    throw Error("Select one shot and explicit editable fields.");
  const changes=Object.entries(edit.changes);
  if(!changes.length||changes.length>allowed.length||
      changes.some(([k,v])=>!allowed.includes(k)||(k==="pauseAfterMs"?
        !Number.isSafeInteger(v)||v<0||v>3000 : k==="family"? !families.has(v) :
        k==="visualElements"? !isVisualElements(v) : k==="motion"? !isSceneMotion(v) :
        k==="speaker"? v!==null&&!isProductionSpeaker(v) :
        k==="speechTurns"? v!==null&&(!Array.isArray(v)||v.length<2||v.length>16) :
        k==="sfxIntent"&&v===null?false:!text(v,k==="narration"?2000:k==="onScreenText"?240:650))))
    throw Error("Editable fields include narration, speaker voice, scene timing, visible text, layout, motion, visual elements and sound effects.");
  const plan=structuredClone(original.plan);
  const shot=plan.shots.find(x=>x.id===edit.shotId);
  const voice=plan.sound.find(x=>x.shotId===edit.shotId);
  const phase=(plan.teachingSequences??[]).flatMap(x=>x.phases).find(x=>x.shotId===edit.shotId);
  if(!shot||!voice||!phase)throw Error("Shot must exist in a narrated teaching sequence.");
  if(voice.speechTurns!==undefined&&changes.some(([key])=>key==="narration"&&!changes.some(([other])=>other==="speechTurns")))
    throw Error("Edit the individual dialogue turns so narration and each speaker stay synchronized.");
  if(changes.some(([key,value])=>key==="speaker"&&value!==null)&&
    (voice.speechTurns!==undefined&&!changes.some(([key,value])=>key==="speechTurns"&&value===null)||
      changes.some(([key,value])=>key==="speechTurns"&&value!==null)))
    throw Error("Choose speakers for individual dialogue turns, or clear the dialogue before assigning one scene speaker.");
  if(changes.some(([key])=>key==="family") && (plan.shots[0].id===shot.id||plan.shots.at(-1).id===shot.id||shot.sceneRecipe))
    throw Error("The opening, closing and bespoke recipe scenes have dedicated layouts; choose a middle general scene to change its family.");
  const revised=new Set(),audio=new Set(),visual=new Set(),sfx=new Set();
  for(const [key,value] of changes){
    const target=key==="narration"||key==="sfxIntent"||key==="pauseAfterMs"||key==="speaker"||key==="speechTurns"?voice:key==="visualAction"?phase:shot;
    if(key==="visualAction"&&!phase)throw Error("Selected shot has no editable teaching phase.");
    if(JSON.stringify(target[key]??null)===JSON.stringify(value))continue;
    const visualActionOnly=key==="speechTurns"&&value!==null&&
      JSON.stringify(speechOnly(target.speechTurns))===JSON.stringify(speechOnly(value));
    if(key==="speaker"&&value===null)delete target.speaker;
    else if(key==="speechTurns"){
      if(value===null)delete target.speechTurns;
      else {
        target.speechTurns=structuredClone(value);
        target.narration=value.map(turn=>typeof turn?.narration==="string"?turn.narration.trim():"").join(" ");
        delete target.speaker;
        if(!visualActionOnly)revised.add("narration");
      }
    }
    else target[key]=typeof value==="string"?value.trim():structuredClone(value);
    revised.add(key);
    if(key==="narration"||key==="speaker"||key==="speechTurns"&&!visualActionOnly)audio.add(shot.id);
    else if(key==="sfxIntent")sfx.add(shot.id);
    else if(key==="pauseAfterMs")visual.add(shot.id);
    else visual.add(shot.id);
  }
  if(!revised.size)throw Error("Nothing changed; original artifact remains untouched.");
  const bundle=compilePreproductionBundle(dossier,plan);
  // Edits are NOT automatically editorially approved, even when research was reviewed.
  bundle.status="draft-needs-review";
  bundle.assessment.ready=false;
  bundle.assessment.findings.push({severity:"error",code:"edited-shot-needs-review",path:"shots",
    message:"Edited narration/visuals must be reviewed before rendering."});
  const sourceIdx=plan.shots.findIndex(x=>x.id===shot.id);
  const later=plan.shots.slice(sourceIdx).map(x=>x.id);
  const impacts={
    editedShotId:shot.id,changedFields:[...revised],
    speechRegenerate:[...audio],
    sfxRemix:[...sfx],
    visualRerender:[...visual],
    timelineRecalculate:audio.size>0||revised.has("pauseAfterMs"),
    downstreamRetiming:audio.size>0||revised.has("pauseAfterMs")?later:[],
    muxRequired:true,
    reusableSpeech:plan.sound.map(x=>x.shotId).filter(id=>!audio.has(id)),
    externalActionsPerformed:[],
  };
  return {
    schemaVersion:1,kind:"preproduction-edit/v1",sourcePlanSha256:original.planSha256,
    revisedPlanSha256:bundle.planSha256,createdFromShotId:shot.id,reviewRequired:true,
    bundle,impacts,
    note:"Content-addressed speech caching can reuse unchanged beats. This is an invalidation plan, not regenerated WAV/MP4 media."
  };
}

export function validateHookCandidates(payload,context){
  if(!payload||typeof payload!=="object"||!Array.isArray(payload.variants)||
      payload.variants.length<2||payload.variants.length>5)
    throw Error("Provide 2–5 independently meaningful hook candidates.");
  const distinct=new Set();
  const variants=payload.variants.map((v,i)=>{
    if(!v||typeof v!=="object"||Object.keys(v).some(k=>!["strategy","audienceSignal","curiosityQuestion","narration","firstVisual","onScreenText","payoffConnection","sfxIntent"].includes(k)))
      throw Error("Hook candidate has unsupported fields.");
    for(const [key,max] of [["strategy",80],["audienceSignal",200],["curiosityQuestion",260],["narration",900],
      ["firstVisual",650],["onScreenText",200],["payoffConnection",300]])
      if(!text(v[key],max))throw Error("Hook "+(i+1)+" needs concrete "+key+".");
    if(v.sfxIntent!==null&&v.sfxIntent!==undefined&&!text(v.sfxIntent,180))
      throw Error("Invalid optional hook sound intent.");
    const strategy=v.strategy.trim().toLowerCase();
    if(distinct.has(strategy))throw Error("Hook strategies must be genuinely distinct.");
    distinct.add(strategy);
    if(!/[?？]/u.test(v.curiosityQuestion))throw Error("Each hook must introduce one unanswered question.");
    if(v.narration.trim().split(/\s+/).length<7)throw Error("Hook needs a substantive spoken opening.");
    if(context?.audience && !text(context.audience,160))throw Error("Invalid target audience.");
    return {id:"hook-"+(i+1),...v,sfxIntent:v.sfxIntent??null};
  });
  return {schemaVersion:1,kind:"hook-variants",variants,
    caution:"Audience relevance and curiosity are editorial hypotheses. Variants are not measured retention winners or verified facts."};
}
