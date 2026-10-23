import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {isVisualElements} from "./visual-elements.mjs";
import {compilePreproductionBundle,parsePreproductionPlan} from "./preproduction.mjs";
import {compilePreproductionRenderJob} from "./preproduction-render-bridge.mjs";
import {compileLiveVisualPreview} from "./live-visual-preview.mjs";
import {editPreproductionShot} from "./video-revisions.mjs";
import {parseVideoProductionJob} from "./job.mjs";
const fixture=name=>JSON.parse(readFileSync(new URL("../../../../examples/"+name,import.meta.url),"utf8"));
const named=[
  {label:"Mortgage interest",detail:"Financing adds the cost of borrowing"},
  {label:"Property tax",detail:"Recurring local tax on the property"},
  {label:"Home insurance",detail:"Recurring protection premium"},
  {label:"Maintenance",detail:"Repairs and upkeep arrive over time"}
];
test("specific viewer-readable teaching elements survive dossier→job→actual renderer plan",()=>{
 const dossier=fixture("preproduction-research-smoke.json");
 const plan=fixture("preproduction-plan-smoke.json");
 plan.shots[1].visualElements=structuredClone(named);
 const result=parsePreproductionPlan(plan,dossier);
 assert.equal(result.ok,true,result.findings.map(x=>x.code).join(","));
 const bundle=compilePreproductionBundle(dossier,plan);
 const bridge=compilePreproductionRenderJob(dossier,bundle);
 assert.equal(parseVideoProductionJob(bridge.job).ok,true);
 assert.deepEqual(bridge.job.beats[1].visual.items,named.map(x=>x.label));
 assert.deepEqual(bridge.job.beats[1].visual.itemNotes,named.map(x=>x.detail));
 assert.equal(bridge.job.beats[1].visual.sceneRecipe,"home-cost-story-v1");
 const live=compileLiveVisualPreview(dossier,bundle);
 assert.deepEqual(live.plan.chapters[1].visual.itemNotes,named.map(x=>x.detail));
 assert.deepEqual(live.plan.chapters[1].visual.items,named.map(x=>x.label));
 assert.equal(live.timing.measuredNarration,false);
});
test("selected-shot visible elements are editable, visual-only, and changed scene is fingerprinted",()=>{
 const dossier=fixture("preproduction-research-smoke.json");
 const plan=fixture("preproduction-plan-smoke.json");
 plan.shots[1].visualElements=structuredClone(named);
 const bundle=compilePreproductionBundle(dossier,plan);
 const edited=[...named.slice(0,3),{label:"Unexpected repairs",detail:"A burst pipe may need urgent work"}];
 const update=editPreproductionShot(dossier,bundle,{shotId:plan.shots[1].id,changes:{visualElements:edited}});
 assert.deepEqual(update.bundle.plan.shots[1].visualElements,edited);
 assert.equal(update.impacts.timelineRecalculate,false);
 assert.deepEqual(update.impacts.speechRegenerate,[]);
 assert.deepEqual(update.impacts.visualRerender,[plan.shots[1].id]);
 assert.deepEqual(update.bundle.plan.sound,bundle.plan.sound);
 const before=compilePreproductionRenderJob(dossier,bundle).job;
 const after=compilePreproductionRenderJob(dossier,update.bundle).job;
 assert.deepEqual(after.beats[0],before.beats[0]);
 assert.deepEqual(after.beats[2],before.beats[2]);
 assert.notDeepEqual(after.beats[1].visual,before.beats[1].visual);
 assert.equal(after.beats[1].narration,before.beats[1].narration);
});
test("unapproved claims and placeholder visual elements cannot be smuggled into a rendered scene",()=>{
 for(const bad of [
   [{label:"House",detail:"This is a house"},{label:"Categories",detail:"This is a category"}],
   [{label:"Net value",detail:"Net value"},{label:"Maintenance",detail:"Repairs recur"}],
   [{label:"Fees",detail:"General fees"},{label:"fees",detail:"Something different"}],
   [{label:"Cost <script>",detail:"A scripting payload"},{label:"Price",detail:"A second step"}],
   [{label:"Only one",detail:"A single step"}],
 ]){
   assert.equal(isVisualElements(bad),false);
 }
 const dossier=fixture("preproduction-research-smoke.json");
 const plan=fixture("preproduction-plan-smoke.json");
 const bundle=compilePreproductionBundle(dossier,plan);
 assert.throws(()=>editPreproductionShot(dossier,bundle,{shotId:plan.shots[1].id,changes:{
   visualElements:[{label:"House",detail:"Generic label"},{label:"Categories",detail:"Generic label"}]
 }}),/Editable fields/);
 const invalid=structuredClone(plan);invalid.shots[0].visualElements=[{label:"Fake",detail:"A"}];
 const check=parsePreproductionPlan(invalid,dossier);
 assert.equal(check.ok,false);
 assert.ok(check.findings.some(x=>x.code==="invalid-visual-elements"));
 const job=compilePreproductionRenderJob(dossier,bundle).job;
 job.beats[1].visual.itemNotes=["too few"];
 assert.equal(parseVideoProductionJob(job).ok,false);
});
test("older storyboards still render but reveal quality warning instead of claiming designed scenes",()=>{
 const dossier=fixture("preproduction-research-smoke.json");
 const plan=fixture("preproduction-plan-smoke.json");
 const bridge=compilePreproductionRenderJob(dossier,compilePreproductionBundle(dossier,plan));
 assert.ok(bridge.warnings.every(x=>typeof x==="string"));
});
