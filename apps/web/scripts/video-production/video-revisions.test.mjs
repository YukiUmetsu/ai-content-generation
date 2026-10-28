import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { compilePreproductionBundle } from "./preproduction.mjs";
import { PROMPT_DEFAULTS,validatePromptOverrides,readPromptOverrides,
  readPromptOverridesSync,savePromptOverrides,resolveStagePrompt,fingerprintStagePrompt } from "./prompt-profiles.mjs";
import { editPreproductionShot,validateHookCandidates } from "./video-revisions.mjs";
import { compilePreproductionRenderJob } from "./preproduction-render-bridge.mjs";
import { generateHookVariants } from "./hook-variants.mjs";
const fixture=name=>JSON.parse(readFileSync(new URL("../../../../examples/"+name,import.meta.url),"utf8"));
const source=()=>fixture("preproduction-research-smoke.json");
const bundle=()=>compilePreproductionBundle(source(),fixture("preproduction-plan-smoke.json"));
const candidates=()=>({variants:[
  {strategy:"Specific viewer pain",audienceSignal:"You see a house price and want a real budget",
    curiosityQuestion:"What costs remain invisible on the listing?",
    narration:"That listing price isn't the whole budget. What else do you pay?",
    firstVisual:"Open a home-price tag to reveal hidden labeled cost categories.",
    onScreenText:"What is missing?",payoffConnection:"Show the assumed categories and conditional total.",sfxIntent:"small category click"},
  {strategy:"Visual contradiction",audienceSignal:"Homeowners comparing a sticker price with real expenses",
    curiosityQuestion:"Why can the final cost differ so dramatically?",
    narration:"Two buyers see the same price tag, but why might their actual costs differ?",
    firstVisual:"Split the same illustrated home into two cost allocation scenarios.",
    onScreenText:"Same house, different costs",payoffConnection:"Reveal that assumptions determine totals.",sfxIntent:null},
  {strategy:"Mini demonstration",audienceSignal:"First-time homebuyers planning their finances",
    curiosityQuestion:"What happens when you add expenses beyond the mortgage?",
    narration:"Watch this fictional home's expenses appear one by one. Where does the number end?",
    firstVisual:"Build one illustrated cost list in three staggered stages.",
    onScreenText:"A price is only the start",payoffConnection:"Show a conditional cost estimate, not a fixed universal total.",sfxIntent:"subtle staged reveal"}
]});
test("all creative stage prompts have bundled defaults and bounded persisted overrides",async t=>{
  assert.ok(Object.keys(PROMPT_DEFAULTS).length>=8);
  assert.ok(PROMPT_DEFAULTS.hooks.includes("audience")||PROMPT_DEFAULTS.hooks.includes("relevance"));
  const dir=await mkdtemp(join(tmpdir(),"contentgen-prompt-"));t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,"prompts.json");
  assert.deepEqual(await readPromptOverrides(path),{version:1,overrides:{}});
  const custom={version:1,overrides:{hooks:"Begin with the viewer's concrete pain. Ask one honest question."}};
  await savePromptOverrides(custom,path);
  assert.deepEqual(await readPromptOverrides(path),custom);
  assert.deepEqual(readPromptOverridesSync(path),custom);
  const compiled=resolveStagePrompt("hooks","Never invent a number.",custom);
  assert.ok(compiled.includes("concrete pain"));
  assert.ok(compiled.indexOf("Never invent a number.")>compiled.indexOf("concrete pain"));
  assert.match(fingerprintStagePrompt("hooks","Never invent a number.",custom),/^[a-f0-9]{64}$/);
  assert.notEqual(fingerprintStagePrompt("hooks","Guard",custom),fingerprintStagePrompt("hooks","Guard"));
  await savePromptOverrides({version:1,overrides:{}},path);
  assert.equal(readPromptOverridesSync(path).overrides.hooks,undefined);
});
test("unknown stages, secret-shaped fields and huge prompt overrides are rejected",()=>{
  assert.throws(()=>validatePromptOverrides({version:1,overrides:{voiceProvider:"bad"}}),/Invalid/);
  assert.throws(()=>validatePromptOverrides({version:1,overrides:{hooks:"x".repeat(9000)}}),/Invalid/);
  assert.throws(()=>validatePromptOverrides({version:1,overrides:{hooks:"hello"},apiKey:"secret"}),/must be/);
  assert.throws(()=>resolveStagePrompt("unknown"),/Unknown/);
});
test("surgical narration change invalidates one speech beat, retimes downstream, keeps other shots",()=>{
  const d=source(),b=bundle();
  const first=b.plan.shots[0].id;
  const result=editPreproductionShot(d,b,{shotId:first,changes:{narration:"Is the sticker price the whole price of a house, or is it just the beginning?"}});
  assert.equal(result.reviewRequired,true);
  assert.equal(result.bundle.status,"draft-needs-review");
  assert.equal(result.impacts.speechRegenerate.length,1);
  assert.deepEqual(result.impacts.speechRegenerate,[first]);
  assert.equal(result.impacts.visualRerender.length,0);
  assert.deepEqual(result.impacts.downstreamRetiming,b.plan.shots.map(s=>s.id));
  assert.equal(result.impacts.reusableSpeech.length,b.plan.shots.length-1);
  assert.equal(result.impacts.externalActionsPerformed.length,0);
  assert.deepEqual(b.plan.sound[0].narration,fixture("preproduction-plan-smoke.json").sound[0].narration);
});
test("scene-cast edit is saved in the versioned preproduction bundle and rendered with the pinned voice",()=>{
  const d=source(),before=bundle(),id=before.plan.shots[1].id;
  const speaker={id:"pip",role:"character",provider:"fish",voiceId:"b".repeat(32)};
  const changed=editPreproductionShot(d,before,{shotId:id,changes:{speaker}});
  assert.deepEqual(changed.bundle.plan.sound[1].speaker,speaker);
  assert.equal(changed.impacts.speechRegenerate.includes(id),true);
  assert.deepEqual(changed.impacts.downstreamRetiming,before.plan.shots.slice(1).map(s=>s.id));
  assert.deepEqual(compilePreproductionRenderJob(d,changed.bundle).job.beats[1].speaker,
    {id:"pip",role:"character",voiceId:speaker.voiceId});
  assert.equal(before.plan.sound[1].speaker,undefined,"original plan is immutable");
  const restored=editPreproductionShot(d,changed.bundle,{shotId:id,changes:{speaker:null}});
  assert.equal(restored.bundle.plan.sound[1].speaker,undefined);
  assert.equal(compilePreproductionRenderJob(d,restored.bundle).job.beats[1].speaker,undefined);
  for(const invalid of [
    {id:"pip",role:"character",provider:"fish",voiceId:"unsafe"},
    {id:"../quill",role:"character",provider:"local",voiceId:"voice"},
    {id:"narrator",role:"character",provider:"local",voiceId:"voice"},
    {id:"pip",role:"character",provider:"local",voiceId:"voice",apiKey:"untrusted"},
  ])assert.throws(()=>editPreproductionShot(d,before,{shotId:id,changes:{speaker:invalid}}),/Editable fields/);
  const mismatch=structuredClone(changed.bundle.plan);
  mismatch.sound[2].speaker={...speaker,voiceId:"a".repeat(32)};
  assert.throws(()=>compilePreproductionBundle(d,mismatch),/speaker-identity-changed/);
});
test("visual-only edits avoid TTS calls and keep other scenes byte-for-byte",()=>{
  const d=source(),b=bundle(),id=b.plan.shots[1].id;
  const edited=editPreproductionShot(d,b,{shotId:id,changes:{
    visualAction:"Move the same home from a single sticker cost into a three-part illustrated expense stack.",
    onScreenText:"The total has parts"}});
  assert.deepEqual(edited.impacts.speechRegenerate,[]);
  assert.deepEqual(edited.impacts.downstreamRetiming,[]);
  assert.deepEqual(edited.impacts.visualRerender,[id]);
  assert.deepEqual(edited.bundle.plan.shots[0],b.plan.shots[0]);
  assert.deepEqual(edited.bundle.plan.sound,b.plan.sound);
  const again=editPreproductionShot(d,edited.bundle,{shotId:id,changes:{sfxIntent:null}});
  assert.deepEqual(again.impacts.sfxRemix,[id]);
  assert.deepEqual(again.impacts.speechRegenerate,[]);
  assert.throws(()=>editPreproductionShot(d,b,{shotId:id,changes:{visualChange:""}}),/Editable fields/);
  assert.throws(()=>editPreproductionShot(d,b,{shotId:id,changes:{claimIds:["fabricated"]}}),/Editable fields/);
  const mutated=structuredClone(b);mutated.plan.sound[0].narration="tampered";
  assert.throws(()=>editPreproductionShot(d,mutated,{shotId:id,changes:{onScreenText:"Approved"}}),/untampered/);
});
test("pacing edits change rendered beat duration and retime later scenes without TTS",()=>{
  const dossier=source(),before=bundle(),id=before.plan.shots[1].id;
  const oldPause=before.plan.sound[1].pauseAfterMs;
  const changed=oldPause===900?800:900;
  const revised=editPreproductionShot(dossier,before,{shotId:id,changes:{pauseAfterMs:changed}});
  const beforeJob=compilePreproductionRenderJob(dossier,before).job;
  const afterJob=compilePreproductionRenderJob(dossier,revised.bundle).job;
  assert.equal(beforeJob.beats[1].pauseAfterMs,oldPause);
  assert.equal(afterJob.beats[1].pauseAfterMs,changed);
  assert.deepEqual(revised.impacts.speechRegenerate,[]);
  assert.equal(revised.impacts.timelineRecalculate,true);
  assert.deepEqual(revised.impacts.downstreamRetiming,before.plan.shots.slice(1).map(shot=>shot.id));
  assert.deepEqual(afterJob.beats[0],beforeJob.beats[0]);
  assert.throws(()=>editPreproductionShot(dossier,before,{shotId:id,changes:{pauseAfterMs:3001}}),/Editable/);
  assert.throws(()=>editPreproductionShot(dossier,before,{shotId:id,changes:{pauseAfterMs:-1}}),/Editable/);
});
test("changing a middle-shot scene layout changes actual renderer structure without regenerating speech",()=>{
  const d=source(),plan=fixture("preproduction-plan-smoke.json");
  plan.shots.forEach(shot=>delete shot.sceneRecipe);
  const before=compilePreproductionBundle(d,plan),id=plan.shots[1].id;
  const updated=editPreproductionShot(d,before,{shotId:id,changes:{family:"comparison"}});
  const rendered=compilePreproductionRenderJob(d,updated.bundle);
  assert.equal(updated.bundle.plan.shots[1].family,"comparison");
  assert.equal(rendered.job.beats[1].visualIntent,"general-comparison");
  assert.equal(rendered.job.beats[0].visualIntent,"general-intro");
  assert.equal(rendered.job.beats[2].visualIntent,"general-payoff");
  assert.deepEqual(updated.impacts.speechRegenerate,[]);
  assert.deepEqual(updated.impacts.visualRerender,[id]);
  assert.deepEqual(before.plan.shots,plan.shots);
  assert.throws(()=>editPreproductionShot(d,before,{shotId:id,changes:{family:"imaginary-scene"}}),/Editable fields|family/);
  assert.throws(()=>editPreproductionShot(d,before,{shotId:plan.shots[0].id,changes:{family:"comparison"}}),/opening|closing/i);
});
test("hook alternatives require audience clarity, suspense question, distinct strategies and honest payoff",()=>{
  const out=validateHookCandidates(candidates(),{audience:"Homeowners"});
  assert.equal(out.variants.length,3);
  assert.deepEqual(out.variants.map(v=>v.id),["hook-1","hook-2","hook-3"]);
  assert.match(out.caution,/not measured retention winners/);
  const duplicate=candidates();duplicate.variants[1].strategy=duplicate.variants[0].strategy;
  assert.throws(()=>validateHookCandidates(duplicate),/distinct/);
  const vague=candidates();vague.variants[0].curiosityQuestion="You'll never believe this";
  assert.throws(()=>validateHookCandidates(vague),/unanswered question/);
  const empty=candidates();empty.variants[0].audienceSignal="";
  assert.throws(()=>validateHookCandidates(empty),/concrete audienceSignal/);
});
test("local model generates exactly three variants; no external endpoint or fabricated claims accepted",async()=>{
  let called=0;
  const testTransport=async (url,request)=>{
    called++;
    assert.equal(url,"http://127.0.0.1:11434/v1/chat/completions");
    const body=JSON.parse(request.body);
    assert.equal(body.messages[0].content,"Care about relevance, not fake numerical certainty.");
    assert.equal(body.messages[1].content.includes("claim_illustrative"),true);
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(candidates())}}]}),{status:200});
  };
  const result=await generateHookVariants({dossier:source(),bundle:bundle()},{
    modelSettings:{version:1,model:"qwen-local",endpoint:"http://127.0.0.1:11434/v1/chat/completions"},
    transport:testTransport,stagePrompt:"Care about relevance, not fake numerical certainty."});
  assert.equal(called,1);assert.equal(result.variants.length,3);
  assert.equal(result.opening,true);assert.equal(result.model,"qwen-local");
  assert.equal(result.selectedShotId,bundle().plan.shots[0].id);
  assert.match(result.generatedWithPromptHash,/^[a-f0-9]{64}$/);
  await assert.rejects(generateHookVariants({dossier:source(),bundle:bundle()},{
    modelSettings:{version:1,model:"cloud",endpoint:"https://api.example.com/v1/chat/completions"},
    transport:()=>{throw Error("should not send");}}),/loopback/);
  assert.equal(called,1);
});

test("default hook prompt explicitly prioritizes audience relevance",async()=>{
  const result=await generateHookVariants({dossier:source(),bundle:bundle()},{
    modelSettings:{version:1,model:"qwen-local",endpoint:"http://127.0.0.1:11434/v1/chat/completions"},
    transport:async (_url,request)=>{
      const body=JSON.parse(request.body);
      assert.match(body.messages[0].content,/audience relevance/i);
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(candidates())}}]}),{status:200});
    }
  });
  assert.equal(result.variants.length,3);
});
