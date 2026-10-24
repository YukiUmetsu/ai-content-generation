/** Narrow, source-bound bridge from an edited semantic storyboard to a Director plan.
 * It never overwrites research, upgrades evidence, or silently changes claim citations.
 */
import {createHash} from "node:crypto";
import {compilePreproductionBundle} from "./preproduction.mjs";

const digest=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const bounded=(value,max)=>typeof value==="string"&&!!value.trim()&&value.length<=max&&
  !/[\u0000-\u001f]/u.test(value);
const readable=(value,max=64)=>{
  const chars=Array.from(String(value??"").trim());
  return chars.length>max?chars.slice(0,max-1).join("")+"…":chars.join("");
};
const equivalent=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const originalDuration=voice=>{
  const words=voice.narration.trim().split(/\s+/u).length;
  return Math.min(900,Math.max(150,Math.ceil(words/2.2)*30+Math.ceil((voice.pauseAfterMs||0)*0.03)));
};
function reject(message){throw Error("Storyboard sync: "+message);}

export function reconcileStoryboardPlan({artifactId,projectId,dossier,plan,storyboard,compile=compilePreproductionBundle}){
  if(!/^[a-z0-9][a-z0-9-]{1,79}$/iu.test(projectId??"")||
    storyboard?.schemaVersion!==1||storyboard?.kind!=="contentgen-semantic-storyboard"||
    storyboard.id!=="storyboard-"+projectId)
    reject("storyboard must belong to the selected project.");
  if(!Array.isArray(storyboard.assumptions)||
    !storyboard.assumptions.includes("Research artifact: "+artifactId)||
    !storyboard.assumptions.some(value=>typeof value==="string"&&value.startsWith("Immutable research snapshot: "+dossier.id+".")))
    reject("storyboard lacks the matching immutable research artifact.");
  if(!Array.isArray(storyboard.beats)||!Array.isArray(plan.shots)||
    storyboard.beats.length!==plan.shots.length||storyboard.beats.length===0||
    storyboard.beats.length>160)
    reject("shot order and count must match the saved research plan.");
  const updated=structuredClone(plan),applied=[],manualReview=new Set();
  const sounds=new Map(updated.sound.map(v=>[v.shotId,v]));
  const phases=new Map(updated.teachingSequences.flatMap(sequence=>
    sequence.phases.map(phase=>[phase.shotId,{phase,sequence}])));
  for(let i=0;i<updated.shots.length;i++){
    const shot=updated.shots[i],beat=storyboard.beats[i];
    if(!beat||beat.id!==shot.id)reject("shot order and IDs must match the saved research plan.");
    if(!equivalent(beat.claimRefs,shot.claimIds))
      reject("claim references were edited; review evidence in Storyboard Planner before syncing.");
    const sound=sounds.get(shot.id),linked=phases.get(shot.id);
    if(!sound||!linked)reject("saved plan is missing narration or a teaching phase for "+shot.id+".");
    if(beat.narration!==sound.narration){
      if(!bounded(beat.narration,2000))reject("narration for "+shot.id+" is empty, too long, or contains control characters.");
      sound.narration=beat.narration.trim();applied.push(shot.id+":narration");
    }
    if(beat.onScreenText!==readable(shot.onScreenText)){
      if(!bounded(beat.onScreenText,240))reject("on-screen copy for "+shot.id+" must be nonempty and at most 240 characters.");
      shot.onScreenText=beat.onScreenText.trim();applied.push(shot.id+":onScreenText");
    }
    const originalVisual=[shot.visualChange,linked.phase.visualAction].filter(Boolean).join("; ");
    if(beat.visualObjective!==originalVisual){
      if(!bounded(beat.visualObjective,1300))reject("visual objective for "+shot.id+" is invalid or too long.");
      const value=beat.visualObjective.trim(),at=value.indexOf("; ");
      const description=at<0?value:value.slice(0,at);
      const action=at<0?value:value.slice(at+2);
      if(!bounded(description,650)||!bounded(action,650))
        reject("visual objective for "+shot.id+" must fit 'shot description; visible action' (650 characters each).");
      shot.visualChange=description;linked.phase.visualAction=action;
      applied.push(shot.id+":visualObjective");
      if(at<0)manualReview.add("A single visual objective was applied to both shot and motion descriptions; inspect this movement.");
    }
    if(beat.cameraIntent)manualReview.add("Storyboard camera edits are not yet imported into Director.");
    if(Number.isInteger(beat.durationFrames)&&beat.durationFrames!==originalDuration(plan.sound.find(v=>v.shotId===shot.id)))
      manualReview.add("Storyboard timing edits are not yet imported into Director.");
    if(beat.teachingState&&!equivalent(
      {before:beat.teachingState.before,action:beat.teachingState.action,after:beat.teachingState.after},
      linked.sequence.visualStates))
      manualReview.add("Storyboard teaching-state edits are not yet imported into Director.");
    if(beat.teachingMechanic&&!equivalent(beat.teachingMechanic.mechanic,linked.sequence.visualMechanic))
      manualReview.add("Storyboard semantic-mechanic edits are not yet imported into Director.");
    if(Array.isArray(beat.semanticObjects)&&!equivalent(beat.semanticObjects,shot.subjectIds))
      manualReview.add("Storyboard semantic-object edits are not yet imported into Director.");
    if(beat.focusTarget&&beat.focusTarget!==shot.subjectIds?.[0])
      manualReview.add("Storyboard focus changes are not yet imported into Director.");
    if(beat.staticFallback&&beat.staticFallback!==readable(plan.shots[i].onScreenText)+" — "+plan.shots[i].visualChange)
      manualReview.add("Storyboard fallback-card edits are not yet imported into Director.");
  }
  if(storyboard.title!==undefined&&storyboard.title!==readable(dossier.topic.title,120))
    manualReview.add("Edited storyboard titles are not yet imported into Director.");
  if(Array.isArray(storyboard.questions)&&
    storyboard.questions.some(q=>q.id==="research-main-question"&&q.text!==plan.story.question))
    manualReview.add("Edited viewer questions are not yet imported into Director.");
  if(Array.isArray(storyboard.claims)&&storyboard.claims.some(c=>{
    const claim=dossier.claims?.find(x=>x.id===c.id);
    return !claim||c.note!==claim.text||c.status!=="unverified"||!equivalent(c.sourceRefs,claim.sourceRefs);
  }))manualReview.add("Storyboard claim notes, statuses, or source edits are not applied to immutable research.");
  const bundle=compile(dossier,updated);
  if(bundle.kind!=="preproduction-bundle"||bundle.researchId!==dossier.id)
    reject("preproduction compiler returned mismatched research.");
  if(applied.length){
    bundle.status="draft-needs-review";
    if(bundle.assessment){
      bundle.assessment.ready=false;
      bundle.assessment.findings.push({severity:"error",code:"storyboard-sync-needs-review",path:"shots",
        message:"Edits transferred from Storyboard Planner need human review before rendering."});
    }
  }
  return {bundle,synchronization:{storyboardSha256:digest(storyboard),
    applied,manualReview:[...manualReview]}};
}
