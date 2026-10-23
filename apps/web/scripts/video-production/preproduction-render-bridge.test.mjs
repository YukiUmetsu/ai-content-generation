import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { compilePreproductionBundle } from "./preproduction.mjs";
import { compilePreproductionRenderJob } from "./preproduction-render-bridge.mjs";
import { parseVideoProductionJob } from "./job.mjs";

const f=name=>JSON.parse(readFileSync(new URL("../../../../examples/"+name,import.meta.url),"utf8"));
const dossier=()=>f("preproduction-research-smoke.json");
const plan=()=>f("preproduction-plan-smoke.json");
const bundle=()=>compilePreproductionBundle(dossier(),plan());
const mechanic=()=>({version:1,operator:"accumulate",subjectId:"house",actors:[
  {id:"house",label:"Home budget",role:"subject",claimIds:["claim_illustrative"]},
  {id:"tax",label:"Property tax",role:"part",claimIds:["claim_illustrative"]},
  {id:"insurance",label:"Insurance",role:"part",claimIds:["claim_illustrative"]},
  {id:"total",label:"Total cost",role:"result",claimIds:["claim_illustrative"]}],
  operands:["tax","insurance"],outcomeId:"total"});

test("semantic research mechanic projects unchanged into the three technical phases",()=>{
  const d=dossier(),p=plan();p.shots.forEach(s=>delete s.sceneRecipe);
  p.teachingSequences[0].visualMechanic=mechanic();
  const rendered=compilePreproductionRenderJob(d,compilePreproductionBundle(d,p));
  assert.deepEqual(rendered.job.beats.map(b=>b.visual.direction.visualMechanic),Array(3).fill(p.teachingSequences[0].visualMechanic));
  assert.equal(parseVideoProductionJob(rendered.job).ok,true);
  const wrong=structuredClone(p);wrong.teachingSequences[0].visualMechanic.subjectId="elsewhere";
  assert.throws(()=>compilePreproductionBundle(d,wrong),/mechanic-subject/);
});
test("bespoke recipe and legacy research plan do not silently acquire semantic animation",()=>{
  const d=dossier(),p=plan();p.teachingSequences[0].visualMechanic=mechanic();
  const custom=compilePreproductionRenderJob(d,compilePreproductionBundle(d,p));
  assert.equal(custom.job.beats.every(b=>b.visual.direction.visualMechanic===undefined),true);
  const legacy=plan();legacy.shots.forEach(s=>delete s.sceneRecipe);
  const existing=compilePreproductionRenderJob(d,compilePreproductionBundle(d,legacy));
  assert.equal(existing.job.beats.every(b=>b.visual.direction.visualMechanic===undefined),true);
});

test("qualitative House Math split, ownership accumulation, and network transfer all cross research-to-job trust boundary",()=>{
  const scenarios=[
    {domain:"HVAC",operator:"split",operands:["equipment","labor","ductwork","permits"],outcome:"quote",subject:"quote",
      names:["Installed quote","Equipment","Installation labor","Ductwork","Permit fees","Finished quote"],
      roles:["subject","part","part","part","part","result"]},
    {domain:"Homeownership",operator:"accumulate",operands:["tax","insurance","maintenance","finance"],outcome:"all_costs",subject:"house",
      names:["Ownership budget","Property tax","Insurance","Maintenance","Financing","Ownership costs"],
      roles:["subject","part","part","part","part","result"]},
    {domain:"Network",operator:"transfer",operands:["sender","receiver"],outcome:"packet",subject:"packet",
      names:["Data packet","Sending router","Receiving router"],roles:["subject","source","destination"]}
  ];
  for(const entry of scenarios){
    const d=dossier(),p=plan(),claim="claim_illustrative";
    d.topic.title=`Synthetic ${entry.domain} mechanism`;
    d.topic.viewerQuestion=`How does the ${entry.domain} demonstration work?`;
    d.claims[0].text=`An illustrative, qualitative ${entry.domain} mechanism; no numeric values are asserted.`;
    p.story.premise=`Demonstrate a qualitative ${entry.domain} operation on a persistent subject.`;
    p.story.hook=`See a familiar ${entry.domain} system change on screen.`;
    p.story.question=d.topic.viewerQuestion;
    p.explanation.forEach(e=>{e.before="A visible system starts intact";e.demonstration=`Show the ${entry.domain} operation`;
      e.after="The audience can see the mechanism's resulting relationship";});
    p.shots.forEach(s=>{
      delete s.sceneRecipe;
      s.subjectIds=[entry.subject];
      s.onScreenText=`${entry.domain} illustrated mechanism`;
      s.visualChange=`Show a sourced illustrative ${entry.domain} visual progression`;
    });
    p.continuity.forEach(c=>{c.subjectIds=[entry.subject];});
    p.sound.forEach(s=>{s.narration=`This is a qualitative ${entry.domain} example. Observe the same subject through its changing parts and connections.`;});
    p.teachingSequences[0].technicalSubjectId=entry.subject;
    const ids=[entry.subject,...entry.operands,...(entry.outcome===entry.subject?[]:[entry.outcome])];
    p.teachingSequences[0].visualMechanic={version:1,operator:entry.operator,
      subjectId:entry.subject,actors:ids.map((id,index)=>({id,label:entry.names[index],
        role:entry.roles[index],claimIds:[claim]})),
      operands:entry.operands,outcomeId:entry.outcome};
    const bridge=compilePreproductionRenderJob(d,compilePreproductionBundle(d,p));
    assert.equal(parseVideoProductionJob(bridge.job).ok,true,entry.domain);
    assert.deepEqual(bridge.job.beats.map(x=>x.visual.direction.visualMechanic?.operator),
      Array(3).fill(entry.operator),entry.domain);
    assert.equal(bridge.job.beats[0].visual.direction.visualMechanic?.subjectId,entry.subject);
    assert.equal(bridge.job.approval,"test-only");
  }
});

test("researched teaching states become real renderer direction on the same technical subject",()=>{
  const d=dossier(),p=plan();
  p.shots.forEach(s=>{delete s.sceneRecipe;});
  p.teachingSequences[0].visualStates={before:"Only the home listing price is shown",
    action:"Reveal financing and recurring expense categories",
    after:"The ownership budget includes additional costs"};
  const compiled=compilePreproductionRenderJob(d,compilePreproductionBundle(d,p));
  for(const beat of compiled.job.beats){
    assert.deepEqual(beat.visual.direction.transformation,{
      subjectId:"house",...p.teachingSequences[0].visualStates
    });
  }
  assert.equal(compiled.job.approval,"test-only");
  assert.equal(parseVideoProductionJob(compiled.job).ok,true);
});
test("legacy plans and bespoke authored recipes do not gain a fabricated transformation",()=>{
  const d=dossier(),p=plan();
  const legacy=compilePreproductionRenderJob(d,compilePreproductionBundle(d,p));
  assert.equal(legacy.job.beats[0].visual.direction.transformation,undefined);
  const withStates=plan();withStates.teachingSequences[0].visualStates={
    before:"The displayed asking price stands alone",action:"Reveal added ownership costs",
    after:"Budget includes ongoing expense categories"};
  const special=compilePreproductionRenderJob(d,compilePreproductionBundle(d,withStates));
  assert.equal(special.job.beats[0].visual.direction.transformation,undefined);
});

test("real synthetic research dossier maps to a valid test-only, source-linked render job",()=>{
  const d=dossier(),b=bundle();
  const bridge=compilePreproductionRenderJob(d,b);
  assert.equal(bridge.kind,"research-to-render-job/v1");
  assert.equal(bridge.job.visualFamily,"general-explainer-v1");
  assert.equal(bridge.job.destination.presetId,"youtube");
  assert.equal(bridge.job.mode,"smoke");
  assert.equal(bridge.job.approval,"test-only");
  assert.deepEqual(bridge.job.policy,{commercialRightsVerified:false,reviewerApproved:false,maxCostUsd:0});
  assert.equal(bridge.job.beats.length,b.plan.shots.length);
  assert.deepEqual(bridge.job.beats.map(x=>x.narration),b.plan.sound.map(x=>x.narration));
  assert.deepEqual(bridge.job.claims,d.claims);
  assert.deepEqual(bridge.job.evidence,d.evidence);
  assert.deepEqual(bridge.job.beats.map(x=>x.claimRefs),b.plan.shots.map(x=>x.claimIds));
  assert.deepEqual(bridge.shotMap.map(x=>x.shotId),b.plan.shots.map(x=>x.id));
  assert.equal(parseVideoProductionJob(bridge.job).ok,true);
  assert.ok(bridge.warnings.some(x=>x.includes("schematic")));
  assert.ok(bridge.warnings.some(x=>x.includes("not been human-reviewed")));
});

test("editing only one shot changes only the corresponding render beat with stable job identity",()=>{
  const d=dossier(),b=bundle();
  const original=compilePreproductionRenderJob(d,b);
  const revised=structuredClone(b.plan);
  revised.sound[1].narration="This revised narration now clarifies the hypothetical categories without making a numeric prediction.";
  revised.shots[1].onScreenText="Different ongoing costs";
  const next=compilePreproductionRenderJob(d,compilePreproductionBundle(d,revised));
  assert.equal(next.job.id,original.job.id);
  assert.equal(next.job.references.storyboard.id,original.job.references.storyboard.id);
  assert.deepEqual(next.job.beats[0],original.job.beats[0]);
  assert.deepEqual(next.job.beats.at(-1),original.job.beats.at(-1));
  assert.notDeepEqual(next.job.beats[1],original.job.beats[1]);
  assert.equal(parseVideoProductionJob(next.job).ok,true);
});

test("source hash mismatch, plan tamper and missing research are rejected",()=>{
  const d=dossier(),b=bundle();
  const altered=structuredClone(d);altered.topic.audience="Other viewers";
  assert.throws(()=>compilePreproductionRenderJob(altered,b),/untampered/);
  const changed=structuredClone(b);changed.plan.sound[0].narration="An unapproved text edit";
  assert.throws(()=>compilePreproductionRenderJob(d,changed),/untampered/);
  const empty=structuredClone(d);empty.evidence=[];
  assert.throws(()=>compilePreproductionRenderJob(empty,compilePreproductionBundle(d,plan())),/untampered/);
  assert.throws(()=>compilePreproductionRenderJob(d,b,{platform:"tiktok"}),/YouTube/);
});

test("visual storyboard limitation is visible and never silently invents 3D or licensed SFX",()=>{
  const d=dossier(),b=bundle();
  const result=compilePreproductionRenderJob(d,b);
  assert.ok(result.warnings.some(x=>x.includes("not rendered automatically")));
  assert.equal(result.job.sounds.every(x=>x.licenseStatus==="test-only"),true);
  assert.equal(result.job.voice.voiceId,"configure-a-licensed-reference");
  assert.equal(result.job.voice.modelId,"s2.1-pro-free");
  assert.ok(result.shotMap[1].visualAction.includes("house"));
});


test("one sparse local transition cue accompanies the first mechanism without external audio rights",()=>{
  const bridge=compilePreproductionRenderJob(dossier(),bundle());
  const effect=bridge.job.sounds.find(x=>x.assetRef==="self-authored-test-soft-tick");
  assert.ok(effect);
  assert.equal(effect.licenseStatus,"test-only");
  assert.equal(effect.category,"visual.reveal");
  const event=bridge.job.events.find(e=>e.id===effect.eventId);
  assert.ok(event);
  assert.equal(event.beatId,bridge.job.beats[1].id);
  assert.equal(bridge.job.beats[1].eventIds.includes(event.id),true);
  assert.equal(bridge.job.beats[0].eventIds.includes(event.id),false);
  assert.equal(bridge.job.sounds.filter(x=>x.assetRef==="self-authored-test-soft-tick").length,1);
  assert.equal(parseVideoProductionJob(bridge.job).ok,true);
});
