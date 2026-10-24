import test from "node:test";
import assert from "node:assert/strict";
import {reconcileStoryboardPlan} from "./storyboard-director-sync.mjs";

const artifactId="research_hvac-123456789abc";
const dossier={id:"research_hvac",topic:{title:"HVAC",viewerQuestion:"Why?"},claims:[
  {id:"claim_one",text:"Installation has labor costs.",status:"unverified",sourceRefs:["source_one"]}]};
const plan={researchId:dossier.id,shots:[
  {id:"shot_one",onScreenText:"Labor costs",visualChange:"Reveal parts",claimIds:["claim_one"]}],
  sound:[{shotId:"shot_one",narration:"The system costs more than a unit.",pauseAfterMs:150}],
  teachingSequences:[{phases:[{shotId:"shot_one",visualAction:"Reveal total"}]}],
  story:{question:"Why?"}};
const board=()=>({schemaVersion:1,kind:"contentgen-semantic-storyboard",id:"storyboard-project-demo",
  title:"HVAC",questions:[{id:"research-main-question",text:"Why?"}],
  assumptions:["Research artifact: "+artifactId,"Immutable research snapshot: research_hvac."],
  claims:[{id:"claim_one",note:"Installation has labor costs.",status:"unverified",sourceRefs:["source_one"]}],
  beats:[{id:"shot_one",narration:"The system costs more than a unit.",onScreenText:"Labor costs",
    visualObjective:"Reveal parts; Reveal total",claimRefs:["claim_one"],durationFrames:180}]});
const compile=(_d,updated)=>({kind:"preproduction-bundle",researchId:dossier.id,plan:updated,
  assessment:{ready:true,findings:[]},status:"ready-for-animatic-review"});

test("reconciles changed narration, on-screen text, and visual action without mutating research",()=>{
  const edited=board();edited.beats[0].narration="Labor is part of your final quote.";
  edited.beats[0].onScreenText="Where the money goes";
  edited.beats[0].visualObjective="Reveal installers; Show labor and materials";
  const result=reconcileStoryboardPlan({artifactId,projectId:"project-demo",dossier,plan,storyboard:edited,compile});
  assert.equal(result.bundle.plan.sound[0].narration,"Labor is part of your final quote.");
  assert.equal(result.bundle.plan.shots[0].onScreenText,"Where the money goes");
  assert.equal(result.bundle.plan.shots[0].visualChange,"Reveal installers");
  assert.equal(result.bundle.plan.teachingSequences[0].phases[0].visualAction,"Show labor and materials");
  assert.equal(result.bundle.status,"draft-needs-review");
  assert.equal(result.bundle.assessment.ready,false);
  assert.equal(result.synchronization.applied.length,3);
  assert.ok(result.synchronization.manualReview.some(message=>message.includes("narration timing")));
  assert.ok(result.synchronization.manualReview.some(message=>message.includes("fallback")));

  assert.match(result.synchronization.storyboardSha256,/^[a-f0-9]{64}$/u);
  assert.equal(plan.shots[0].visualChange,"Reveal parts");
  assert.equal(dossier.claims[0].status,"unverified");
});

test("never imports a storyboard with different project, research provenance, or shot order",()=>{
  const wrong=board();wrong.id="storyboard-another-project";
  assert.throws(()=>reconcileStoryboardPlan({artifactId,projectId:"project-demo",dossier,plan,
    storyboard:wrong,compile}),/project/iu);
  wrong.id="storyboard-project-demo";wrong.assumptions=["Immutable research snapshot: research_hvac."];
  assert.throws(()=>reconcileStoryboardPlan({artifactId,projectId:"project-demo",dossier,plan,
    storyboard:wrong,compile}),/research artifact/iu);
  wrong.assumptions=board().assumptions;wrong.beats[0].id="other";
  assert.throws(()=>reconcileStoryboardPlan({artifactId,projectId:"project-demo",dossier,plan,
    storyboard:wrong,compile}),/shot order/iu);
});

test("rejects silently rewriting claim citations, and identifies unsupported semantic edits",()=>{
  const changed=board();changed.beats[0].claimRefs=["some_other_claim"];
  assert.throws(()=>reconcileStoryboardPlan({artifactId,projectId:"project-demo",dossier,plan,
    storyboard:changed,compile}),/claim references/iu);
  const camera=board();camera.beats[0].cameraIntent="Follow the installer";
  const result=reconcileStoryboardPlan({artifactId,projectId:"project-demo",dossier,plan,
    storyboard:camera,compile});
  assert.equal(result.synchronization.applied.length,0);
  assert.ok(result.synchronization.manualReview.some(w=>w.includes("camera")));
});
