import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {DEFAULT_SCENE_MOTION,isSceneMotion,motionRevealState,entryFadeOpacity} from "./scene-motion.mjs";
import {compilePreproductionBundle} from "./preproduction.mjs";
import {editPreproductionShot} from "./video-revisions.mjs";
import {compilePreproductionRenderJob} from "./preproduction-render-bridge.mjs";
import {parseVideoProductionJob} from "./job.mjs";
import {compileLiveVisualPreview} from "./live-visual-preview.mjs";
import {getGeneralFrame} from "./general-visual-plan.mjs";
const fixture=name=>JSON.parse(readFileSync(new URL("../../../../examples/"+name,import.meta.url),"utf8"));
function sample(){
  const dossier=fixture("preproduction-research-smoke.json");
  return {dossier,bundle:compilePreproductionBundle(dossier,fixture("preproduction-plan-smoke.json"))};
}
test("saved motion survives editor → dossier-validated bundle → job → real preview",()=>{
 const {dossier,bundle}=sample();
 const motion={revealDelayPercent:20,revealPace:"deliberate",camera:"locked",transition:"fade"};
 const shotId=bundle.plan.shots[1].id;
 const edit=editPreproductionShot(dossier,bundle,{shotId,changes:{motion}});
 assert.equal(edit.reviewRequired,true);
 assert.deepEqual(edit.bundle.plan.shots[1].motion,motion);
 assert.ok(edit.impacts.visualRerender.includes(shotId));
 assert.deepEqual(edit.impacts.speechRegenerate,[]);
 assert.equal(edit.impacts.timelineRecalculate,false);
 assert.deepEqual(edit.bundle.plan.shots[0],bundle.plan.shots[0]);
 assert.deepEqual(edit.bundle.plan.sound,bundle.plan.sound);
 const job=compilePreproductionRenderJob(dossier,edit.bundle).job;
 assert.equal(parseVideoProductionJob(job).ok,true);
 assert.deepEqual(job.beats[1].visual.motion,motion);
 const original=compileLiveVisualPreview(dossier,bundle);
 const after=compileLiveVisualPreview(dossier,edit.bundle);
 assert.notEqual(after.renderPlanSha256,original.renderPlanSha256);
 assert.deepEqual(after.plan.chapters[1].visual.motion,motion);
 assert.deepEqual(after.plan.chapters[0],original.plan.chapters[0]);
 assert.deepEqual(after.plan.chapters[2],original.plan.chapters[2]);
 const chapter=after.plan.chapters[1];
 const early=getGeneralFrame(after.plan,chapter.startFrame);
 assert.equal(early.visibleItems,0);
 const later=getGeneralFrame(after.plan,chapter.endFrame-1);
 assert.equal(later.visibleItems,chapter.visual.items.length);
 assert.equal(entryFadeOpacity(0,chapter.endFrame-chapter.startFrame,motion),1);
 assert.equal(entryFadeOpacity(20,chapter.endFrame-chapter.startFrame,motion),0);
});
test("timing is bounded, deterministic and payoff cannot be spoiled by editor settings",()=>{
 for(const pace of ["snappy","balanced","deliberate"]){
   const motion={...DEFAULT_SCENE_MOTION,revealPace:pace,revealDelayPercent:30};
   const states=Array.from({length:90},(_,frame)=>motionRevealState({
     frame,frames:90,intent:"general-payoff",itemCount:5,motion
   }).visibleItems);
   assert.equal(states[0],0);
   assert.ok(states.slice(1,30).every(n=>n===0));
   assert.equal(states.at(-1),5);
   assert.ok(states.every((n,i)=>i===0||n>=states[i-1]));
   assert.deepEqual(states,Array.from({length:90},(_,frame)=>motionRevealState({
     frame,frames:90,intent:"general-payoff",itemCount:5,motion
   }).visibleItems));
 }
 assert.equal(entryFadeOpacity(0,120,{...DEFAULT_SCENE_MOTION,transition:"cut"}),0);
 assert.ok(entryFadeOpacity(4,120,{...DEFAULT_SCENE_MOTION,transition:"fade"})>0);
 assert.equal(entryFadeOpacity(25,120,{...DEFAULT_SCENE_MOTION,transition:"fade"}),0);
});
test("invalid controls and attempted extra fields fail closed before updating source",()=>{
 const {dossier,bundle}=sample(),id=bundle.plan.shots[1].id;
 for(const motion of [
  {revealDelayPercent:101,revealPace:"snappy",camera:"subtle",transition:"cut"},
  {revealDelayPercent:-1,revealPace:"balanced",camera:"locked",transition:"fade"},
  {revealDelayPercent:0,revealPace:"unsafe",camera:"subtle",transition:"cut"},
  {...DEFAULT_SCENE_MOTION,script:"alert(1)"},
  {...DEFAULT_SCENE_MOTION,camera:"execute-arbitrary-css"}
 ]){
   assert.equal(isSceneMotion(motion),false);
   assert.throws(()=>editPreproductionShot(dossier,bundle,{shotId:id,changes:{motion}}),/Editable fields/);
 }
 assert.equal(bundle.plan.shots[1].motion,undefined);
});
