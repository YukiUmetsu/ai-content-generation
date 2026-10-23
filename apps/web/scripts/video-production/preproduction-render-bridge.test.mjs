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
