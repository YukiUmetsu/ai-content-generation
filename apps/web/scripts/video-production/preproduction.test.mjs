import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseResearchDossier, parsePreproductionPlan, inspectPreproduction, compilePreproductionBundle } from "./preproduction.mjs";
import { generatePreproductionPlan } from "./preproduction-generator.mjs";
import { parsePreproductionArgs, runPreproductionCli } from "./preproduction-cli.mjs";

function dossier() {
  return {
    schemaVersion:1,kind:"research-dossier",id:"research_home_cost",
    topic:{title:"The hidden lifetime cost of a home",viewerQuestion:"What is the lifetime cost?",audience:"First-time homeowners",locale:"en-US"},
    evidence:[{id:"evidence_home",title:"Synthetic local research fixture",sourceUri:"https://example.org/fictional-fixture",
      retrievedAt:"2026-10-23T10:00:00.000Z",passageLocator:"fixture paragraph 1",
      snapshotSha256:createHash("sha256").update("synthetic fixture paragraph 1").digest("hex")}],
    claims:[{id:"claim_illustration",text:"Illustrative ownership costs have multiple components.",status:"illustrative",sourceRefs:[]},
      {id:"claim_cost",text:"This is a synthetic example for testing, not a market estimate.",status:"verified",sourceRefs:["evidence_home"]}],
    assets:[],gaps:[],review:{status:"human-reviewed",reviewer:"fixture"}
  };
}
function plan(){
  return {schemaVersion:1,kind:"preproduction-plan",researchId:"research_home_cost",styleId:"cinematic-explainer-v1",
    story:{pattern:"cost-dissection",premise:"Separate a quoted price into changing total costs.",
      hook:"A price looks smaller than the eventual total.",question:"What costs accumulate over time?",
      answerExplanationId:"explain_total",acts:[
        {id:"act_question",question:"What are you paying for?",purpose:"Challenge one-price assumption.",payoff:"Reveal distinct cost categories."},
        {id:"act_answer",question:"How does the total change?",purpose:"Show illustrative accumulation.",payoff:"Explain total and limits."}]},
    explanation:[
      {id:"explain_parts",actId:"act_question",claimIds:["claim_illustration"],before:"Price seems complete.",
        demonstration:"Show three recurring categories.",after:"Costs have separate components."},
      {id:"explain_total",actId:"act_answer",claimIds:["claim_cost"],before:"Components feel disconnected.",
        demonstration:"Accumulate illustrated components.",after:"The total depends on assumptions."}],
    shots:[
      {id:"shot_question",explanationId:"explain_parts",family:"question",purpose:"hook",subjectIds:["house"],
        visualChange:"Reveal the house with an unanswered cost question.",onScreenText:"Just the purchase price?",claimIds:["claim_illustration"],assetRefs:[]},
      {id:"shot_process",explanationId:"explain_parts",family:"process",purpose:"explain",subjectIds:["house","costs"],
        visualChange:"Expand from the same house into cost categories.",onScreenText:"Several ongoing costs",claimIds:["claim_illustration"],assetRefs:[]},
      {id:"shot_answer",explanationId:"explain_total",family:"summary",purpose:"answer",subjectIds:["costs"],
        visualChange:"Resolve the cost categories into a conditional total.",onScreenText:"It depends on your assumptions",claimIds:["claim_cost"],assetRefs:[]}],
    continuity:[
      {fromShotId:"shot_question",toShotId:"shot_process",technique:"shared-element",subjectIds:["house"],reason:"Preserve the house as costs appear."},
      {fromShotId:"shot_process",toShotId:"shot_answer",technique:"match-cut",subjectIds:["costs"],reason:"Transform categories into the takeaway."}],
    sound:[
      {shotId:"shot_question",narration:"Is the price on the listing really all you will pay?",delivery:"curious",energy:"focused",pauseAfterMs:200,sfxIntent:null},
      {shotId:"shot_process",narration:"An illustrative ownership budget includes several categories over time.",delivery:"conversational",energy:"calm",pauseAfterMs:120,sfxIntent:"cost category reveals"},
      {shotId:"shot_answer",narration:"The total depends on your assumptions, and these figures are only an example.",delivery:"confident",energy:"focused",pauseAfterMs:0,sfxIntent:null}]
  };
}
const codes = findings => findings.map(x=>x.code);
test("research and all five plans compile to an editable review-ready bundle",()=>{
  const d=dossier(),p=plan();
  assert.equal(parseResearchDossier(d).ok,true);
  assert.equal(parsePreproductionPlan(p,d).ok,true);
  assert.equal(inspectPreproduction(d,p).ready,true);
  const b=compilePreproductionBundle(d,p);
  assert.equal(b.status,"ready-for-animatic-review");
  assert.match(b.researchSha256,/^[a-f0-9]{64}$/);
  assert.equal(b.plan.shots.length,3);
});
test("research must have captured sources with locators and hashes",()=>{
  const d=dossier();d.evidence=[];
  assert.ok(codes(parseResearchDossier(d).findings).includes("research-required"));
  const bad=dossier();bad.evidence[0].sourceUri="http://127.0.0.1/private";
  bad.evidence[0].snapshotSha256="fake";
  assert.ok(codes(parseResearchDossier(bad).findings).includes("unsafe-source"));
  assert.ok(codes(parseResearchDossier(bad).findings).includes("source-hash"));
});
test("editorial readiness blocks disputed claims and review gaps without hiding drafts",()=>{
  const d=dossier(),p=plan();d.review={status:"draft"};d.claims[1].status="disputed";
  assert.equal(parsePreproductionPlan(p,d).ok,true);
  assert.equal(inspectPreproduction(d,p).ready,false);
  assert.equal(compilePreproductionBundle(d,p).status,"draft-needs-review");
  assert.ok(codes(inspectPreproduction(d,p).findings).includes("claim-unreviewed"));
});
test("a missing answer or an explanation without a shot is rejected",()=>{
  const d=dossier(),p=plan();p.story.answerExplanationId="missing";
  assert.ok(codes(parsePreproductionPlan(p,d).findings).includes("unanswered-question"));
  const broken=plan();broken.shots[2].explanationId="explain_parts";
  assert.ok(codes(parsePreproductionPlan(broken,d).findings).includes("unvisualized-explanation"));
});
test("transition identity, unknown citation, missing narration and undeclared assets fail closed",()=>{
  const d=dossier(),p=plan();
  p.continuity[0].subjectIds=["costs"];
  assert.ok(codes(parsePreproductionPlan(p,d).findings).includes("lost-subject"));
  const mismatch=plan();mismatch.shots[1].claimIds=["fabricated"];
  assert.ok(codes(parsePreproductionPlan(mismatch,d).findings).includes("missing-reference"));
  const silent=plan();silent.sound.pop();
  assert.ok(codes(parsePreproductionPlan(silent,d).findings).includes("silent-shot"));
  const asset=plan();asset.shots[1].family="mechanism";
  assert.ok(codes(parsePreproductionPlan(asset,d).findings).includes("missing-asset"));
});
test("local planner never invents source IDs or retries rejected model output",async()=>{
  const d=dossier(), valid=plan();let calls=0;
  const transport=async(url,request)=>{calls++;
    assert.match(url,/127\.0\.0\.1/);
    assert.match(request.body,/research_home_cost/);
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(valid)}}]}),{status:200});
  };
  const generated=await generatePreproductionPlan(d,{model:"qwen-local",endpoint:"http://127.0.0.1:11434/v1/chat/completions"},{transport});
  assert.equal(generated.shots.length,3);assert.equal(calls,1);
  valid.shots[0].claimIds=["invented"];
  await assert.rejects(generatePreproductionPlan(d,{model:"qwen-local",endpoint:"http://127.0.0.1:11434/v1/chat/completions"},{transport}),/rejected/);
  assert.equal(calls,2);
  await assert.rejects(generatePreproductionPlan(d,{model:"qwen-local",endpoint:"https://third-party.example/v1/chat/completions"},{transport}),/loopback/);
  assert.equal(calls,2);
});
test("CLI writes a non-overwriting, local-only review bundle",async(t)=>{
  const dir=await mkdtemp(join(tmpdir(),"contentgen-preproduction-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const source=join(dir,"research.json"), authored=join(dir,"plan.json"), out=join(dir,"bundle.json");
  await writeFile(source,JSON.stringify(dossier()));await writeFile(authored,JSON.stringify(plan()));
  assert.equal(parsePreproductionArgs(["--research",source,"--plan",authored,"--out",out]).model,undefined);
  let calls=0;
  const a=await runPreproductionCli(["--research",source,"--plan",authored,"--out",out],{
    generate:async()=>{calls++;throw Error("should not call model");},log:()=>{}});
  assert.equal(a.assessment.ready,true);assert.equal(JSON.parse(await readFile(out,"utf8")).plan.story.pattern,"cost-dissection");
  await assert.rejects(runPreproductionCli(["--research",source,"--plan",authored,"--out",out],{log:()=>{}}),/EEXIST/);
  assert.equal(calls,0);
});

test("unknown assets, test-only assets and missing publication evidence cannot be hidden",()=>{
  const d=dossier(), p=plan();
  p.shots[1].assetRefs=["phantom"];
  assert.ok(codes(parsePreproductionPlan(p,d).findings).includes("missing-asset-reference"));
  d.assets=[{id:"phantom",kind:"illustration",ref:"synthetic-local-fixture",licenseStatus:"test-only"}];
  assert.equal(parsePreproductionPlan(p,d).ok,true);
  assert.ok(codes(inspectPreproduction(d,p).findings).includes("test-asset-not-approved"));
});
test("malformed model plan is rejected with findings, not a runtime null dereference",()=>{
  const p=plan();p.shots=[null,{bad:"shape"}];
  const result=parsePreproductionPlan(p,dossier());
  assert.equal(result.ok,false);
  assert.ok(result.findings.length>0);
});
test("the opening must show the question and the ending must show its answer",()=>{
  const p=plan();p.shots[0].family="evidence";p.shots[2].purpose="explain";
  const found=codes(parsePreproductionPlan(p,dossier()).findings);
  assert.ok(found.includes("hook-not-visible"));
  assert.ok(found.includes("payoff-not-visible"));
});

test("shot claim must belong to its explanation and each explanation claim must be visualized",()=>{
  const d=dossier(),p=plan();
  p.shots[1].claimIds=["claim_cost"];
  assert.ok(codes(parsePreproductionPlan(p,d).findings).includes("claim-leak"));
  const missing=plan();missing.shots[2].claimIds=[];
  assert.ok(codes(parsePreproductionPlan(missing,d).findings).includes("unvisualized-claim"));
});
test("checked-in synthetic fixtures run completely offline but remain unreviewed",async()=>{
  const d=JSON.parse(await readFile(new URL("../../../../examples/preproduction-research-smoke.json",import.meta.url),"utf8"));
  const p=JSON.parse(await readFile(new URL("../../../../examples/preproduction-plan-smoke.json",import.meta.url),"utf8"));
  assert.equal(parseResearchDossier(d).ok,true);
  assert.equal(parsePreproductionPlan(p,d).ok,true);
  assert.equal(compilePreproductionBundle(d,p).status,"draft-needs-review");
});
