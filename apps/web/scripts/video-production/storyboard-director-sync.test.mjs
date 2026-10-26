import test from "node:test";
import assert from "node:assert/strict";
import {reconcileStoryboardPlan} from "./storyboard-director-sync.mjs";
import {readFile} from "node:fs/promises";
import {compilePreproductionBundle} from "./preproduction.mjs";

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

test("reports unsupported narrative and semantic edits explicitly without mutating the saved plan",()=>{
  const edited=board();
  edited.locale="ja";edited.fps={num:24,den:1};edited.illustrativeData=true;
  edited.beats[0].role="reveal";edited.beats[0].visualIntent="comparison";
  edited.beats[0].namedEvents=["custom-reveal"];edited.beats[0].opensQuestion="custom-question";
  edited.semanticObjects=[{id:"new-subject",label:"A different object"}];
  edited.semanticEvents=[];
  const result=reconcileStoryboardPlan({artifactId,projectId:"project-demo",
    dossier,plan,storyboard:edited,compile});
  assert.equal(result.synchronization.applied.length,0);
  for(const subject of ["narrative-role","visual-intent","semantic-event","question-open",
    "frame-rate","locale","illustrative-data","semantic-object catalog"]){
    assert.ok(result.synchronization.manualReview.some(w=>w.includes(subject)),subject);
  }
  assert.deepEqual(result.bundle.plan,plan);
  assert.equal(plan.shots[0].visualChange,"Reveal parts");
});

test("preserves semicolons inside authored visuals instead of moving text between fields",()=>{
  const source=structuredClone(plan);
  source.shots[0].visualChange="Reveal parts; hold the camera";
  source.teachingSequences[0].phases[0].visualAction="Show labor; fade the totals";
  const edited=board();
  edited.beats[0].visualObjective="Reveal parts; hold the camera; Show labor; fade the totals faster";
  const result=reconcileStoryboardPlan({artifactId,projectId:"project-demo",dossier,
    plan:source,storyboard:edited,compile});
  assert.equal(result.bundle.plan.shots[0].visualChange,"Reveal parts; hold the camera");
  assert.equal(result.bundle.plan.teachingSequences[0].phases[0].visualAction,
    "Show labor; fade the totals faster");
  assert.equal(source.teachingSequences[0].phases[0].visualAction,"Show labor; fade the totals");
});

test("rejects multi-delimiter visual edits when both original fields changed ambiguously",()=>{
  const source=structuredClone(plan);
  source.shots[0].visualChange="Reveal parts; hold the camera";
  source.teachingSequences[0].phases[0].visualAction="Show labor; fade the totals";
  const edited=board();
  edited.beats[0].visualObjective="Reveal machine; rotate slowly; Show labor; fade to black";
  assert.throws(()=>reconcileStoryboardPlan({artifactId,projectId:"project-demo",
    dossier,plan:source,storyboard:edited,compile}),/ambiguous visual objective/iu);
});

test("the real preproduction compiler accepts a source-bound visual and narration edit",async()=>{
  const dossier=JSON.parse(await readFile(
    new URL("../../../../examples/preproduction-research-smoke.json",import.meta.url),"utf8"));
  const plan=JSON.parse(await readFile(
    new URL("../../../../examples/preproduction-plan-smoke.json",import.meta.url),"utf8"));
  const artifactId="research_synthetic_home-123456789abc",projectId="project-demo";
  const baseline=compilePreproductionBundle(dossier,plan);
  const board={schemaVersion:1,kind:"contentgen-semantic-storyboard",id:"storyboard-"+projectId,
    assumptions:["Immutable research snapshot: "+dossier.id+". Human review required.",
      "Research artifact: "+artifactId],
    beats:plan.shots.map(shot=>{
      const sound=plan.sound.find(s=>s.shotId===shot.id);
      const phase=plan.teachingSequences.flatMap(s=>s.phases).find(p=>p.shotId===shot.id);
      return {id:shot.id,claimRefs:[...shot.claimIds],narration:sound.narration,
        onScreenText:shot.onScreenText,visualObjective:shot.visualChange+"; "+phase.visualAction};
    }),
  };
  board.beats[1].narration="Loan interest, property taxes, insurance, and repairs are separate costs.";
  board.beats[1].visualObjective=plan.shots[1].visualChange+
    "; Animate cost cards alongside the same house in a clear sequence.";
  const result=reconcileStoryboardPlan({artifactId,projectId,dossier,plan,storyboard:board});
  assert.equal(result.bundle.kind,"preproduction-bundle");
  assert.equal(result.bundle.status,"draft-needs-review");
  assert.equal(result.bundle.assessment.ready,false);
  assert.equal(result.bundle.researchSha256,baseline.researchSha256);
  assert.notEqual(result.bundle.planSha256,baseline.planSha256);
  assert.equal(result.bundle.plan.sound[1].narration,
    "Loan interest, property taxes, insurance, and repairs are separate costs.");
  assert.equal(result.bundle.plan.teachingSequences[0].phases[1].visualAction,
    "Animate cost cards alongside the same house in a clear sequence.");
  assert.equal(plan.sound[1].narration,
    "If you borrow to buy it, mortgage interest adds to the purchase price. Property tax and insurance recur, and repairs and maintenance happen over time. These are different costs, not another price tag.");
});

test("flags deleted fallback, focus, and source-linked teaching plans instead of silently discarding them",()=>{
  const source=structuredClone(plan);
  source.shots[0].subjectIds=["house"];
  source.teachingSequences[0].technicalSubjectId="house";
  source.teachingSequences[0].phases[0].kind="problem";
  source.teachingSequences[0].visualStates={before:"Cost unknown",action:"Reveal bill",after:"Cost visible"};
  source.teachingSequences[0].visualMechanic={kind:"visual-mechanic-v1",subjectId:"house"};
  const edited=board();
  edited.beats[0].focusTarget="";
  edited.beats[0].staticFallback="";
  const result=reconcileStoryboardPlan({artifactId,projectId:"project-demo",
    dossier,plan:source,storyboard:edited,compile});
  for(const subject of ["focus","fallback","teaching-state","semantic-mechanic"]){
    assert.ok(result.synchronization.manualReview.some(w=>w.includes(subject)),subject);
  }
  assert.deepEqual(result.bundle.plan,source);
});
