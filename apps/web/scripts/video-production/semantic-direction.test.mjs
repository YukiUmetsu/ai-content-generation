
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseVideoProductionJob } from "./job.mjs";
import { compileGeneralVisuals } from "./general-visual-plan.mjs";
import { buildSampleTimeline } from "./timeline.mjs";
import { compilePreproductionBundle } from "./preproduction.mjs";
import { compilePreproductionRenderJob } from "./preproduction-render-bridge.mjs";
const fixture=name=>JSON.parse(readFileSync(new URL("../../../../examples/"+name,import.meta.url),"utf8"));

test("semantic direction survives the full source→job→visual render-plan pipeline",()=>{
  const dossier=fixture("preproduction-research-smoke.json");
  const original=fixture("preproduction-plan-smoke.json");
  const bundle=compilePreproductionBundle(dossier,original);
  const bridged=compilePreproductionRenderJob(dossier,bundle);
  const first=bridged.job.beats[0].visual.direction;
  assert.equal(first.phase,"problem");
  assert.deepEqual(first.subjectIds,["house"]);
  assert.match(first.visualAction,/house/);
  assert.match(first.learningChange,/purchase price/i);
  assert.equal(parseVideoProductionJob(bridged.job).ok,true);
  const timeline=buildSampleTimeline(bridged.job.beats.map(b=>({
    id:b.id,samples:48000*5,pauseAfterMs:b.pauseAfterMs,eventIds:b.eventIds
  })),{fps:bridged.job.destination.fps,events:bridged.job.events});
  const framePlan=compileGeneralVisuals(bridged.job,timeline);
  assert.deepEqual(framePlan.chapters[0].visual.direction,first);
});

test("an edited semantic action produces a changed scene fingerprint, leaving unrelated beats untouched",()=>{
  const dossier=fixture("preproduction-research-smoke.json");
  const original=fixture("preproduction-plan-smoke.json");
  const before=compilePreproductionRenderJob(dossier,compilePreproductionBundle(dossier,original));
  const edited=structuredClone(original);
  edited.teachingSequences[0].phases[1].visualAction=
    "Split the same house into four categorical panels, one by one.";
  const after=compilePreproductionRenderJob(dossier,compilePreproductionBundle(dossier,edited));
  assert.deepEqual(after.job.beats[0],before.job.beats[0]);
  assert.deepEqual(after.job.beats[2],before.job.beats[2]);
  assert.notDeepEqual(after.job.beats[1].visual.direction,before.job.beats[1].visual.direction);
  assert.equal(after.job.beats[1].narration,before.job.beats[1].narration);
  assert.equal(parseVideoProductionJob(after.job).ok,true);
});

test("unsupported scripted direction and forged subjects are rejected without executing instructions",()=>{
  const job=fixture("video-production-general-smoke.json");
  job.beats[0].visual.direction={
    phase:"mechanism",subjectIds:["phone"],visualAction:"Follow the signal through nodes.",
    learningChange:"A network path is a teaching model."
  };
  assert.equal(parseVideoProductionJob(job).ok,true);
  const forged=structuredClone(job);
  forged.beats[0].visual.direction.subjectIds=["../../private"];
  assert.equal(parseVideoProductionJob(forged).ok,false);
  const invalid=structuredClone(job);
  invalid.beats[0].visual.direction.phase="run-shell-command";
  assert.equal(parseVideoProductionJob(invalid).ok,false);
  const smuggled=structuredClone(job);
  smuggled.beats[0].visual.direction.executable="function(){return 1}";
  assert.equal(parseVideoProductionJob(smuggled).ok,false);
});
