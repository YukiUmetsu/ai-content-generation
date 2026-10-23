import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parsePreproductionPlan, compilePreproductionBundle } from "./preproduction.mjs";
import { validateTeachingSequences, compileTeachingStoryboard } from "./visual-pedagogy.mjs";

const fixture = file => JSON.parse(readFileSync(new URL("../../../../examples/" + file,import.meta.url),"utf8"));
const dossier = () => fixture("preproduction-research-smoke.json");
const direct = () => fixture("preproduction-plan-smoke.json");
const codes = outcome => outcome.findings.map(x=>x.code);

function analogy() {
  const p = direct();
  p.shots.splice(1,0,{id:"shot_analogy",explanationId:"explain_categories",family:"process",purpose:"explain",
    subjectIds:["checkout"],visualChange:"Visualize a checkout with one visible ticket and separate outgoing costs.",
    onScreenText:"One ticket, several costs",claimIds:["claim_illustrative"],assetRefs:[]});
  p.continuity=[
    {fromShotId:"shot_question",toShotId:"shot_analogy",technique:"cut",subjectIds:[],
      reason:"Translate the unexplained cost gap into familiar checkout behavior."},
    {fromShotId:"shot_analogy",toShotId:"shot_categories",technique:"match-cut",subjectIds:[],
      reason:"Match each checkout line to a distinct illustrative home expense category."},
    {fromShotId:"shot_categories",toShotId:"shot_answer",technique:"shared-element",subjectIds:["categories"],
      reason:"Preserve the costs as they combine into the takeaway."}
  ];
  p.sound.splice(1,0,{shotId:"shot_analogy",
    narration:"Imagine a checkout receipt that lists not only the sticker price but several later expenses.",
    delivery:"conversational",energy:"focused",pauseAfterMs:120,sfxIntent:"checkout items reveal"});
  p.teachingSequences[0]={
    id:"teach_home_cost",mode:"analogy",question:"Why isn't the listing price the whole story?",
    technicalSubjectId:"house",claimIds:["claim_illustrative"],
    analogy:{familiarSystem:"Checkout receipt",technicalSystem:"Home ownership budget",
      analogySubjectId:"checkout",mappings:[
        {familiar:"displayed sticker price",technical:"initial purchase price"},
        {familiar:"additional receipt line",technical:"additional ownership-cost category"}],
      breaksAt:"Unlike one checkout receipt, ownership expenses occur at different times; this is an illustrative comparison."},
    phases:[
      {kind:"problem",shotId:"shot_question",visualAction:"Hold on the hypothetical house and obscure additional categories.",
        learningChange:"The listing price may omit ongoing categories."},
      {kind:"analogy",shotId:"shot_analogy",visualAction:"Expand a single checkout price into separate hypothetical receipt lines.",
        learningChange:"One familiar total can include distinct items."},
      {kind:"mechanism",shotId:"shot_categories",visualAction:"Match the receipt lines to distinct home cost categories while keeping the house visible.",
        learningChange:"Several different ownership costs can accumulate."},
      {kind:"payoff",shotId:"shot_answer",visualAction:"Recombine the house and illustrated categories under visible assumptions.",
        learningChange:"The total depends on the assumptions, not a universal number."}
    ]
  };
  return p;
}
test("new synthetic sequence compiles a chronological visual teaching handoff, not fake frames",()=>{
  const p=analogy(),d=dossier();
  assert.equal(parsePreproductionPlan(p,d).ok,true);
  const s=compileTeachingStoryboard(p,d);
  assert.equal(s.kind,"visual-teaching-storyboard");
  assert.equal(s.storyQuestion,p.story.question);
  assert.deepEqual(s.beats.map(b=>b.phase),["problem","analogy","mechanism","payoff"]);
  assert.deepEqual(s.beats.map(b=>b.shotId),p.shots.map(b=>b.id));
  assert.deepEqual(s.beats.map(b=>b.claimIds),p.shots.map(b=>b.claimIds));
  assert.equal(s.beats[1].narration,p.sound[1].narration);
  assert.equal(s.beats[2].entryTransition.technique,"match-cut");
  assert.equal(s.teachingSequences[0].analogy.breaksAt,p.teachingSequences[0].analogy.breaksAt);
  assert.equal(Object.hasOwn(s.beats[0],"startFrame"),false);
  assert.equal(Object.hasOwn(s.beats[0],"animation"),false);
  const b=compilePreproductionBundle(d,p);
  assert.equal(b.teachingStoryboard.beats.length,4);
  assert.equal(b.status,"draft-needs-review");
});
test("simple explanation legitimately uses direct teaching rather than a forced analogy",()=>{
  const p=direct(),d=dossier();
  assert.equal(parsePreproductionPlan(p,d).ok,true);
  assert.deepEqual(compileTeachingStoryboard(p,d).beats.map(b=>b.phase),["problem","mechanism","payoff"]);
});
test("previously saved v1 plans without teachingSequences remain readable",()=>{
  const p=direct();delete p.teachingSequences;
  assert.equal(parsePreproductionPlan(p,dossier()).ok,true);
  assert.equal(validateTeachingSequences(p,dossier()).legacy,true);
  assert.deepEqual(compileTeachingStoryboard(p,dossier()).beats,[]);
});
test("missing analogy limitation and invented mappings fail closed",()=>{
  const p=analogy();
  p.teachingSequences[0].analogy.breaksAt="";
  assert.ok(codes(validateTeachingSequences(p,dossier())).includes("teaching-text"));
  const x=analogy();x.teachingSequences[0].analogy.mappings[1].technical =
    x.teachingSequences[0].analogy.mappings[0].technical;
  assert.ok(codes(validateTeachingSequences(x,dossier())).includes("teaching-mapping-repeat"));
});
test("reordered phases, repeated actions and future-to-past shots are rejected",()=>{
  const x=analogy();
  [x.teachingSequences[0].phases[1],x.teachingSequences[0].phases[2]] =
    [x.teachingSequences[0].phases[2],x.teachingSequences[0].phases[1]];
  assert.ok(codes(validateTeachingSequences(x,dossier())).includes("teaching-phase-order"));
  assert.ok(codes(validateTeachingSequences(x,dossier())).includes("teaching-shot-order"));
  const y=analogy();
  y.teachingSequences[0].phases[1].visualAction=y.teachingSequences[0].phases[0].visualAction;
  assert.ok(codes(validateTeachingSequences(y,dossier())).includes("teaching-repeated-action"));
});
test("analogy may not invent facts, skip source refs, or hide a non-narrated stage",()=>{
  const x=analogy();x.teachingSequences[0].claimIds=["imaginary_savings"];
  assert.ok(codes(validateTeachingSequences(x,dossier())).includes("teaching-claims"));
  const y=analogy();y.teachingSequences[0].phases[1].visualAction=y.shots[1].onScreenText;
  assert.ok(codes(validateTeachingSequences(y,dossier())).includes("teaching-decorative"));
  const z=analogy();z.sound=z.sound.filter(s=>s.shotId!=="shot_analogy");
  assert.ok(codes(validateTeachingSequences(z,dossier())).includes("teaching-voice-missing"));
  const u=analogy();u.teachingSequences[0].analogy.analogySubjectId="not_in_shot";
  assert.ok(codes(validateTeachingSequences(u,dossier())).includes("teaching-subject-missing"));
});
test("technical subject persists, final teaching resolves the actual story, no shot reuse",()=>{
  const a=analogy();a.shots[2].subjectIds=["categories"];
  assert.ok(codes(validateTeachingSequences(a,dossier())).includes("teaching-subject-missing"));
  const b=analogy();b.teachingSequences[0].phases[3].shotId="shot_analogy";
  assert.ok(codes(validateTeachingSequences(b,dossier())).includes("teaching-no-final-payoff"));
  assert.ok(codes(validateTeachingSequences(b,dossier())).includes("teaching-shot-reuse"));
  const c=analogy();c.teachingSequences[0].phases[0].shotId="no_such_shot";
  assert.ok(codes(validateTeachingSequences(c,dossier())).includes("teaching-shot"));
});
test("malformed and extra fields become findings rather than exceptions",()=>{
  const p=direct();p.teachingSequences=[{id:"bad",mode:"analogy",phases:[null,null,null,null]}];
  const result=validateTeachingSequences(p,dossier());
  assert.equal(result.ok,false);
  assert.ok(result.findings.length>0);
  const extra=analogy();extra.teachingSequences[0].unverifiedAuthority=true;
  assert.ok(codes(validateTeachingSequences(extra,dossier())).includes("teaching-unknown-field"));
  assert.throws(()=>compileTeachingStoryboard(extra,dossier()),/rejected/);
});
