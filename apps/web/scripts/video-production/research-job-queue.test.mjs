import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,writeFile,rename,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createResearchJobManager} from "./research-job-queue.mjs";
import {buildDeterministicDossier} from "./research-job-evidence.mjs";
import {assembleResumablePlan} from "./research-job-planner.mjs";
import {loadStudioResearchDraft} from "./studio-research.mjs";
import {captureModelOutput} from "./research-ai-debug.mjs";

const brief={title:"Heat pump costs",viewerQuestion:"Why are installations expensive?",audience:"Homeowners",locale:"en-US",searchArtifactId:"search_20261023T000000000Z-123456789abc"};
const model={model:"local-small",endpoint:"http://127.0.0.1:11434/v1/chat/completions"};
const capture={captures:[{id:"source_01",url:"https://energy.example.org/guide",title:"Energy",text:"Installation includes the equipment purchase and skilled labor performed at the house.",retrievedAt:"2026-10-23T00:00:00.000Z"}],gaps:[]};
const dossier={dossier:{id:"research_test",claims:[{id:"claim_01"}]},quotes:[{claimId:"claim_01",sourceId:"source_01",quote:"Installation includes the equipment purchase"}],captures:capture.captures,warnings:[]};
const outline={beats:[{claimIds:["claim_01"]},{claimIds:["claim_01"]}]};
const later=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const fixture=(root,overrides={})=>createResearchJobManager({root,
  loadSearch:async()=>({topic:brief.title,query:brief.viewerQuestion,audience:brief.audience,locale:brief.locale,results:[{url:"https://energy.example.org/guide",title:"Energy"}]}),
  capture:async()=>capture,evidence:()=>dossier,outline:async()=>outline,
  scene:async (_outline,index)=>({index}),assemble:()=>({shots:[{id:"shot_1"}]}),
  persist:async()=>"research_test-0123456789ab",sleep:async()=>{},...overrides});
async function settled(manager,id){for(let n=0;n<200;n++){
  const state=await manager.get(id);
  if(["completed","failed","cancelled","paused"].includes(state.status))return state;
  await later(5);
}throw Error("Job did not settle in time.");}

test("evidence repair is checkpointed before outlining and visible in job status",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-repair-checkpoint-"));
  let repairs=0;
  const manager=fixture(root,{repair:async input=>{
    repairs++;
    return {document:input,autoFixed:1,unresolved:[],proposals:[],audit:[{claimId:"claim_01",reason:"exact_quote_relink"}]};
  }});
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    const complete=await settled(manager,jobId);
    assert.equal(complete.status,"completed");
    assert.equal(complete.evidenceRepair.autoFixed,1);
    assert.equal(complete.evidenceRepair.needsReview,0);
    const checkpoint=JSON.parse(await readFile(join(root,"jobs",jobId,"evidence_repair_0.json"),"utf8"));
    assert.equal(checkpoint.autoFixed,1);
    assert.equal(repairs,1);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("unresolved evidence pauses the job without discarding saved work",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-repair-review-"));
  const manager=fixture(root,{repair:async input=>({
    document:input,autoFixed:0,unresolved:[{claimId:"claim_01",reason:"quote_mismatch"}],
    proposals:[],audit:[],
  })});
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    const paused=await settled(manager,jobId);
    assert.equal(paused.status,"paused");
    assert.equal(paused.stage,"evidence-repair");
    assert.equal(paused.evidenceRepair.needsReview,1);
    assert.equal(paused.artifactId,undefined);
    assert.equal((await manager.get(jobId)).evidenceRepair.issues[0].reason,"quote_mismatch");
  }finally{await rm(root,{recursive:true,force:true});}
});

test("retry resumes from completed scene, not source capture or outline",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-jobs-"));
  let captures=0,outlines=0,sceneOne=0,sceneTwo=0;
  const manager=fixture(root,{capture:async()=>{captures++;return capture;},outline:async()=>{outlines++;return outline;},
    scene:async (_,index)=>{if(index===0)sceneOne++;else if(++sceneTwo<=3)throw Error("Model invalid JSON");return {index};}});
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    assert.equal((await settled(manager,jobId)).status,"failed");
    const next=await manager.resume(jobId,{primary:model});
    assert.ok(["queued","running"].includes(next.status));
    const done=await settled(manager,jobId);
    assert.equal(done.status,"completed");
    assert.equal(done.completedScenes,2);
    assert.equal(done.artifactId,"research_test-0123456789ab");
    assert.equal(captures,1);assert.equal(outlines,1);assert.equal(sceneOne,1);assert.equal(sceneTwo,4);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("opt-in diagnostics retain raw answers from all failed retries without exposing them in job state",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-jobs-"));
  const previous=process.env.CONTENTGEN_DEBUG_AI_OUTPUT;
  const originalWarn=console.warn;
  const entries=[];
  let calls=0;
  process.env.CONTENTGEN_DEBUG_AI_OUTPUT="1";
  console.warn=(...args)=>entries.push(args);
  const manager=fixture(root,{scene:async(_outline,index)=>{
    if(index===1&&++calls<=2){
      captureModelOutput(JSON.stringify({visualElements:[{label:`invalid ${calls}`}]}));
      throw Object.assign(Error("private schema text"),{code:"schema_invalid",field:"visualElements"});
    }
    return {index};
  }});
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    const state=await settled(manager,jobId);
    assert.equal(state.status,"completed");
    const debug=entries.filter(parts=>parts[0]==="[contentgen-ai-schema-error]").map(parts=>JSON.parse(parts[1]));
    assert.equal(debug.length,2);
    assert.deepEqual(debug.map(entry=>entry.attempt),[1,2]);
    assert.deepEqual(debug.map(entry=>entry.output).map(output=>JSON.parse(output).visualElements[0].label),
      ["invalid 1","invalid 2"]);
    assert.ok(debug.every(entry=>entry.jobId===jobId&&entry.model===model.model&&entry.field==="visualElements"));
    assert.doesNotMatch(JSON.stringify(state),/invalid [12]|private schema text/);
  }finally{
    if(previous===undefined)delete process.env.CONTENTGEN_DEBUG_AI_OUTPUT;
    else process.env.CONTENTGEN_DEBUG_AI_OUTPUT=previous;
    console.warn=originalWarn;
    await rm(root,{recursive:true,force:true});
  }
});

test("one invalid local scene response gets a bounded repair attempt",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-jobs-"));
  let retries=0;
  const manager=fixture(root,{scene:async (_outline,index)=>{
    if(index===1&&++retries===1)throw Error("Scene unit lacks meaningful visible teaching elements");
    return {index};
  }});
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    assert.equal((await settled(manager,jobId)).status,"completed");
    assert.equal(retries,2);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("malformed output is retried twice with repair feedback before completing the scene",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-jobs-"));
  const feedback=[];
  const manager=fixture(root,{scene:async (_outline,index,_d,_q,_settings,opts)=>{
    if(index===1){feedback.push(opts.feedback);if(feedback.length<3)throw Error("Local model returned invalid structured JSON.");}
    return {index};
  }});
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    assert.equal((await settled(manager,jobId)).status,"completed");
    assert.equal(feedback.length,3);
    assert.equal(feedback[0],null);
    assert.match(feedback[1],/JSON/i);
    assert.match(feedback[2],/JSON/i);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("retry uses the validated field path and reports it without private model output",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-jobs-"));
  const feedback=[];
  const manager=fixture(root,{scene:async(_outline,index,_d,_q,_settings,options)=>{
    if(index===1){
      feedback.push(options.feedback);
      if(feedback.length===1)throw Object.assign(Error("Private text should not be forwarded"),
        {code:"schema_invalid",field:"phases[1].visualElements"});
    }
    return {index};
  }});
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    assert.equal((await settled(manager,jobId)).status,"completed");
    assert.match(feedback[1],/phases\[1\]\.visualElements/);
    assert.doesNotMatch(feedback[1],/Private text/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("duplicate payoff learningChange retries with a different phase-specific learning goal",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-duplicate-payoff-"));
  const feedback=[];
  const structure={subject:"Heat pump",parts:["Equipment","Labor"],operator:"split",
    before:"Only equipment visible",action:"Add installation work",after:"Complete cost visible"};
  const manager=fixture(root,{scene:null,sceneStructure:async()=>structure,sceneVisual:null,
    sceneDirection:async(_outline,index,phase,_s,_prev,_d,_q,_model,options)=>{
      if(index===0&&phase===2){
        feedback.push(options.feedback);
        if(feedback.length===1)throw Object.assign(Error("Do not log source context"),{
          code:"schema_invalid",field:"learningChange",schemaIssue:"duplicate_previous"});
      }
      return {visualAction:`Different action for scene ${index} phase ${phase}`,
        learningChange:`New insight for scene ${index} phase ${phase}`,onScreenText:"Cost breakdown"};
    },
    sceneElements:async()=>({visualElements:[{label:"Hardware",detail:"Physical heat pump"},
      {label:"Installation",detail:"Labor needed to install"}]}),
    combineVisual:(direction,elements)=>({...direction,...elements}),
    sceneNarration:async()=>({narration:"Equipment and labor contribute to installation cost."}),
    combineScene:()=>({})});
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    assert.equal((await settled(manager,jobId)).status,"completed");
    assert.equal(feedback.length,2);
    assert.equal(feedback[0],null);
    assert.match(feedback[1],/payoff/i);
    assert.match(feedback[1],/different|new|distinct/i);
    assert.match(feedback[1],/not paraphrase|do not paraphrase/i);
    assert.doesNotMatch(feedback[1],/Do not log source context/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("visualElements shape error gives a two-object repair instruction",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-elements-repair-"));
  const feedback=[];
  const manager=fixture(root,{scene:async(_outline,index,_d,_q,_model,options)=>{
    if(index===0){
      feedback.push(options.feedback);
      if(feedback.length===1)throw Object.assign(Error("Untrusted source should stay private"),{
        code:"schema_invalid",field:"visualElements",schemaIssue:"wrong_shape"});
    }
    return {index};
  }});
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    assert.equal((await settled(manager,jobId)).status,"completed");
    assert.match(feedback[1],/exactly two|exactly 2/i);
    assert.match(feedback[1],/label.*detail/i);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("provider 5xx retry keeps the original input instead of adding schema repair hints",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-provider-retry-"));
  const feedback=[];
  const manager=fixture(root,{scene:async(_outline,index,_d,_q,_model,options)=>{
    if(index===0){
      feedback.push(options.feedback);
      if(feedback.length===1)throw Error("Local model HTTP 503");
    }
    return {index};
  }});
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    assert.equal((await settled(manager,jobId)).status,"completed");
    assert.deepEqual(feedback,[null,null]);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("invalid before receives field-specific state constraints on retry",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-jobs-"));
  const feedback=[];
  const manager=fixture(root,{scene:async(_outline,index,_d,_q,_settings,options)=>{
    if(index===1){
      feedback.push(options.feedback);
      if(feedback.length===1)throw Object.assign(Error("Private draft content"),{
        code:"schema_invalid",field:"before",schemaIssue:"too_short"});
    }
    return {index};
  }});
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    assert.equal((await settled(manager,jobId)).status,"completed");
    assert.equal(feedback[0],null);
    assert.match(feedback[1],/before/i);
    assert.match(feedback[1],/8[–-]48/iu);
    assert.match(feedback[1],/visible|starting|initial/iu);
    assert.doesNotMatch(feedback[1],/Private draft content/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("exhausted before errors expose safe failure classification only",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-jobs-"));
  const manager=fixture(root,{scene:async(_outline,index)=>{
    if(index===1)throw Object.assign(Error("private model field value"),{
      code:"schema_invalid",field:"before",schemaIssue:"placeholder"});
    return {index};
  }});
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    const state=await settled(manager,jobId);
    assert.equal(state.status,"failed");
    assert.equal(state.error.schemaIssue,"placeholder");
    assert.match(state.error.message,/before.*placeholder|placeholder.*before/i);
    assert.doesNotMatch(JSON.stringify(state),/private model field value/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("exhausted schema retries retain safe failure detail for Studio",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-jobs-"));
  const manager=fixture(root,{scene:async(_outline,index)=>{
    if(index===1)throw Object.assign(Error("private passage: do not disclose"),
      {code:"schema_invalid",field:"phases[2].narration"});
    return {index};
  }});
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    const state=await settled(manager,jobId);
    assert.equal(state.status,"failed");
    assert.equal(state.error.detailCode,"schema_invalid");
    assert.equal(state.error.field,"phases[2].narration");
    assert.doesNotMatch(JSON.stringify(state),/private passage/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("retry progress is public, checkpointed, and cleared after final failure",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-jobs-"));
  let release=()=>{};
  const waiting=new Promise(resolve=>{release=resolve;});
  const manager=fixture(root,{sleep:async()=>waiting,scene:async(_outline,index)=>{
    if(index===1)throw Error("Scene invalid schema");
    return {index};
  }});
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    let status;
    for(let n=0;n<200;n++){
      status=await manager.get(jobId);
      if(status.retry?.attempt===2)break;
      await later(5);
    }
    assert.equal(status.retry?.stage,"scene:2");
    assert.equal(status.retry?.attempt,2);
    assert.equal(status.retry?.maxAttempts,3);
    assert.equal(status.retry?.reason,"invalid_output");
    const persisted=JSON.parse(await readFile(join(root,"jobs",jobId,"manifest.json"),"utf8"));
    assert.equal(persisted.retry.attempt,2);
    release();
    assert.equal((await settled(manager,jobId)).status,"failed");
    assert.equal((await manager.get(jobId)).retry,undefined);
  }finally{release();await rm(root,{recursive:true,force:true});}
});

test("two research jobs never overlap local inference",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-jobs-"));
  let active=0,max=0;
  const infer=async result=>{max=Math.max(max,++active);await later(12);active--;return result;};
  const manager=fixture(root,{outline:async()=>infer(outline),scene:async(_,index)=>infer({index})});
  try{
    const one=await manager.create(brief,{primary:model}),two=await manager.create(brief,{primary:model});
    assert.equal((await settled(manager,one.jobId)).status,"completed");
    assert.equal((await settled(manager,two.jobId)).status,"completed");
    assert.equal(max,1);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("restart recovers running job as paused without automatically executing AI",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-jobs-"));
  let count=0;
  const manager=fixture(root,{outline:async()=>{count++;return await new Promise(()=>{});}});
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    for(let n=0;n<100;n++){
      const status=JSON.parse(await readFile(join(root,"jobs",jobId,"manifest.json"),"utf8"));
      if(status.stage==="outline")break;
      await later(5);
    }
    const recovered=fixture(root,{outline:async()=>{throw Error("Unexpected auto inference");}});
    const state=await recovered.get(jobId);
    assert.equal(state.status,"paused");
    assert.equal(count,1);
    await manager.cancel(jobId);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("restart recovers a queued job as paused instead of displaying queued forever",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-jobs-"));
  const manager=fixture(root);
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    assert.equal((await settled(manager,jobId)).status,"completed");
    // Simulate a crash just after committing a queued manifest, before the worker starts.
    const file=join(root,"jobs",jobId,"manifest.json");
    const job=JSON.parse(await readFile(file,"utf8"));
    job.status="queued";job.stage="queued";job.artifactId=null;
    await writeFile(file,JSON.stringify(job));
    const recovered=fixture(root,{outline:async()=>{throw Error("Unexpected auto inference");}});
    const state=await recovered.get(jobId);
    assert.equal(state.status,"paused");
    assert.equal(state.error.code,"interrupted");
  }finally{await rm(root,{recursive:true,force:true});}
});

test("changing saved generation limits does not invalidate a resumable job's completed scenes",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-jobs-"));
  let scenes=0;
  const observedLimits=[];
  const limits={outlineTokens:1024,sceneTokens:3072,timeoutSeconds:360};
  const manager=fixture(root,{scene:async(_outline,index,_d,_q,settings)=>{
    scenes++;
    observedLimits.push(settings.generation.sceneTokens);
    if(index===1&&scenes<=4)throw Error("Invalid scene JSON");
    return {index};
  }});
  try{
    const {jobId}=await manager.create(brief,{primary:{...model,generation:limits}});
    assert.equal((await settled(manager,jobId)).status,"failed");
    assert.equal(scenes,4);
    await manager.resume(jobId,{primary:{...model,generation:{...limits,sceneTokens:6144}}});
    assert.equal((await settled(manager,jobId)).status,"completed");
    assert.equal(scenes,5);
    const manifest=JSON.parse(await readFile(join(root,"jobs",jobId,"manifest.json"),"utf8"));
    assert.deepEqual(manifest.models.primary.generation,{...limits,sceneTokens:6144});
    assert.deepEqual(observedLimits,[3072,3072,3072,3072,6144]);
    assert.equal(manifest.generation,0);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("manual resume starts the failed truncated fragment with compact feedback",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-resume-feedback-"));
  const feedback=[];
  const manager=fixture(root,{scene:async(_story,index,_d,_q,_settings,options)=>{
    if(index===0){
      feedback.push(options.feedback);
      if(feedback.length<=3)throw Object.assign(Error("private incomplete answer"),{code:"output_truncated",field:"response"});
    }
    return {index};
  }});
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    assert.equal((await settled(manager,jobId)).status,"failed");
    await manager.resume(jobId,{primary:model});
    assert.equal((await settled(manager,jobId)).status,"completed");
    assert.equal(feedback.length,4);
    assert.match(feedback[3],/shorter|compact|cut off|truncat/i);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("switching models does not reuse truncated-fragment feedback from the old generation",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-model-new-generation-"));
  const feedback=[];
  const manager=fixture(root,{outline:null,
    outlineSkeleton:async(_d,_q,settings,options)=>{
      if(settings.model==="local-small")throw Object.assign(Error("private truncated answer"),{code:"output_truncated",field:"response"});
      feedback.push(options.feedback);return {beatCount:2};
    },outlineBeat:async(_s,index)=>({index}),combineOutline:()=>outline});
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    assert.equal((await settled(manager,jobId)).status,"failed");
    await manager.resume(jobId,{primary:{...model,model:"local-replacement"}});
    assert.equal((await settled(manager,jobId)).status,"completed");
    assert.deepEqual(feedback,[null]);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("truncation hint survives a later provider error and terminal resume",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-sticky-truncation-"));
  const feedback=[];
  let resumed=false;
  const manager=fixture(root,{outline:null,
    outlineSkeleton:async(_d,_q,settings,options)=>{
      if(!resumed){
        if(settings.model==="local-small")throw Object.assign(Error("partial private JSON"),{code:"output_truncated",field:"response"});
        throw Error("Local model returned HTTP 503");
      }
      feedback.push(options.feedback);return {beatCount:2};
    },outlineBeat:async(_s,index)=>({index}),combineOutline:()=>outline});
  try{
    const models={primary:model,secondary:{...model,model:"local-backup"}};
    const {jobId}=await manager.create(brief,models);
    const failed=await settled(manager,jobId);
    assert.equal(failed.error.code,"provider_unavailable");
    resumed=true;
    await manager.resume(jobId,models);
    assert.equal((await settled(manager,jobId)).status,"completed");
    assert.match(feedback[0],/shorter|compact|cut off|truncat/i);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("assemble failure for a saved invalid scene marks only that scene for regeneration",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-assemble-repair-"));
  const attempts=[0,0];
  const manager=fixture(root,{scene:async(_story,index)=>{
    attempts[index]++;
    return {index,invalid:index===0&&attempts[index]===1};
  },assemble:(_d,_o,units)=>{
    if(units[0].invalid)throw Object.assign(Error("Assembled storyboard rejected"),{sceneIndex:0});
    return {shots:[{id:"shot_1"}]};
  }});
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    const failed=await settled(manager,jobId);
    assert.equal(failed.status,"failed");
    assert.equal(failed.stage,"scene:1");
    assert.equal(failed.completedScenes,0);
    await manager.resume(jobId,{primary:model});
    assert.equal((await settled(manager,jobId)).status,"completed");
    assert.deepEqual(attempts,[2,1]);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("invalid persisted micro-fragments are rebuilt instead of failing every resume",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-stale-fragment-"));
  let firstCore=0;
  const manager=fixture(root,{scene:null,sceneStructure:null,
    sceneCore:async()=>({invalid:++firstCore===1}),
    sceneStates:async()=>({before:"Equipment is hidden",action:"Reveal the required labor",after:"Complete estimate is visible"}),
    combineStructure:(core,states)=>{
      if(core.invalid)throw Object.assign(Error("Saved fragment rejected"),{code:"schema_invalid",field:"subject"});
      return {...core,...states};
    },
    sceneVisual:async()=>({visualAction:"Split visible components"}),
    sceneNarration:async()=>({narration:"A visible explanation"}),combineScene:()=>({})});
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    const failed=await settled(manager,jobId);
    assert.equal(failed.status,"failed");
    assert.equal(failed.stage,"scene:1");
    assert.equal(failed.currentStep,"regenerate");
    await manager.resume(jobId,{primary:model});
    assert.equal((await settled(manager,jobId)).status,"completed");
    assert.equal(firstCore,3);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("legacy complete structure checkpoint is invalidated before prompting another scene fragment",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-old-structure-"));
  const first=fixture(root,{scene:null,sceneStructure:null,
    sceneCore:async()=>{throw Error("Model failed before structure saved");}});
  try{
    const {jobId}=await first.create(brief,{primary:model});
    assert.equal((await settled(first,jobId)).status,"failed");
    await writeFile(join(root,"jobs",jobId,"structure_0_0_0.json"),JSON.stringify({
      subject:" Heat pump ",parts:["Equipment","Labor"],operator:"split",
      before:"Equipment hidden",action:"Show both cost categories",after:"Both categories visible",
    }));
    const resumed=fixture(root,{scene:null,sceneStructure:null,sceneVisual:null,
      sceneDirection:async()=>({visualAction:"Show equipment"}),
      sceneElements:async()=>({visualElements:[]}),combineVisual:()=>({}),
      sceneNarration:async()=>({narration:"Visible detail"}),combineScene:()=>({})});
    await resumed.resume(jobId,{primary:model});
    const failed=await settled(resumed,jobId);
    assert.equal(failed.stage,"scene:1");
    assert.equal(failed.currentStep,"regenerate");
    const manifest=JSON.parse(await readFile(join(root,"jobs",jobId,"manifest.json"),"utf8"));
    assert.equal(manifest.sceneRevisions[0],1);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("legacy complete visual checkpoint is invalidated before narration retries",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-old-visual-"));
  const structure={subject:"Installation",parts:["Equipment","Labor"],operator:"split",
    before:"Equipment hidden",action:"Show both cost categories",after:"Both categories visible"};
  const first=fixture(root,{scene:null,sceneStructure:async()=>structure,
    sceneVisual:null,sceneDirection:async()=>{throw Error("Direction model failed");}});
  try{
    const {jobId}=await first.create(brief,{primary:model});
    assert.equal((await settled(first,jobId)).status,"failed");
    await writeFile(join(root,"jobs",jobId,"visual_0_0_0_0.json"),JSON.stringify({visualAction:"Show equipment"}));
    const resumed=fixture(root,{scene:null,sceneStructure:async()=>structure,sceneVisual:null,
      sceneNarration:async()=>({narration:"Visible detail"}),combineScene:()=>({})});
    await resumed.resume(jobId,{primary:model});
    const failed=await settled(resumed,jobId);
    assert.equal(failed.stage,"scene:1");
    assert.equal(failed.currentStep,"regenerate");
  }finally{await rm(root,{recursive:true,force:true});}
});

test("old partial core checkpoint is invalidated before the dependent states AI request",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-old-core-"));
  const first=fixture(root,{scene:null,sceneStructure:null,sceneCore:async()=>{throw Error("Core unavailable");}});
  try{
    const {jobId}=await first.create(brief,{primary:model});
    assert.equal((await settled(first,jobId)).status,"failed");
    await writeFile(join(root,"jobs",jobId,"structure_core_0_0_0.json"),JSON.stringify({
      subject:" https://example.com ",parts:["Equipment","Labor"],operator:"split",
    }));
    const resumed=fixture(root,{scene:null,sceneStructure:null,
      sceneStates:async()=>({before:"Equipment hidden",action:"Reveal cost",after:"Labor visible"}),
      combineStructure:(core,states)=>({...core,...states}),sceneVisual:async()=>({}),
      sceneNarration:async()=>({}),combineScene:()=>({})});
    await resumed.resume(jobId,{primary:model});
    const stopped=await settled(resumed,jobId);
    assert.equal(stopped.currentStep,"regenerate");
    assert.equal(stopped.stage,"scene:1");
  }finally{await rm(root,{recursive:true,force:true});}
});

test("old partial direction checkpoint is invalidated before the visual elements request",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-old-direction-"));
  const structure={subject:"Installation",parts:["Equipment","Labor"],operator:"split",
    before:"Equipment hidden",action:"Show both cost categories",after:"Both categories visible"};
  const first=fixture(root,{scene:null,sceneStructure:async()=>structure,sceneVisual:null,
    sceneDirection:async()=>{throw Error("Direction unavailable");}});
  try{
    const {jobId}=await first.create(brief,{primary:model});
    assert.equal((await settled(first,jobId)).status,"failed");
    await writeFile(join(root,"jobs",jobId,"visual_direction_0_0_0_0.json"),JSON.stringify({
      visualAction:"No",learningChange:"Show cost",onScreenText:"Cost",
    }));
    const resumed=fixture(root,{scene:null,sceneStructure:async()=>structure,sceneVisual:null,
      sceneElements:async()=>({visualElements:[]}),combineVisual:()=>({}),
      sceneNarration:async()=>({}),combineScene:()=>({})});
    await resumed.resume(jobId,{primary:model});
    const stopped=await settled(resumed,jobId);
    assert.equal(stopped.currentStep,"regenerate");
    assert.equal(stopped.stage,"scene:1");
  }finally{await rm(root,{recursive:true,force:true});}
});

test("invalid cached outline skeleton starts a fresh outline generation on resume",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-old-outline-"));
  const first=fixture(root,{outline:null,outlineSkeleton:async()=>{throw Error("Outline model unavailable");}});
  try{
    const {jobId}=await first.create(brief,{primary:model});
    assert.equal((await settled(first,jobId)).status,"failed");
    await writeFile(join(root,"jobs",jobId,"outline_skeleton_0.json"),JSON.stringify({
      pattern:"mechanism",premise:"Explain one topic",hook:"A useful video hook",beatCount:900,
    }));
    const resumed=fixture(root,{outline:null,outlineBeat:async()=>({}),combineOutline:()=>outline});
    await resumed.resume(jobId,{primary:model});
    const stopped=await settled(resumed,jobId);
    assert.equal(stopped.stage,"outline");
    assert.equal(stopped.currentStep,"regenerate");
    const manifest=JSON.parse(await readFile(join(root,"jobs",jobId,"manifest.json"),"utf8"));
    assert.equal(manifest.generation,1);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("explicit secondary local model is used only after primary inference failure",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-jobs-"));
  const used=[];
  const manager=fixture(root,{outline:async(_d,_q,settings)=>{
    used.push(settings.model);
    if(settings.model==="local-small")throw Error("Model memory exhausted");
    return outline;
  }});
  try{
    const {jobId}=await manager.create(brief,{primary:model,secondary:{...model,model:"local-fallback"}});
    assert.equal((await settled(manager,jobId)).status,"completed");
    assert.deepEqual(used,["local-small","local-fallback"]);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("completed research cannot be accidentally cancelled",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-jobs-"));
  const manager=fixture(root);
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    assert.equal((await settled(manager,jobId)).status,"completed");
    await assert.rejects(manager.cancel(jobId),/already completed/i);
    assert.equal((await manager.get(jobId)).status,"completed");
  }finally{await rm(root,{recursive:true,force:true});}
});

test("explicit cancellation during final persistence never reports a completed job",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-jobs-"));
  let finishPersist=()=>{};
  const blocking=new Promise(resolve=>{finishPersist=()=>resolve("research_test-0123456789ab");});
  const manager=fixture(root,{persist:async()=>await blocking});
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    for(let n=0;n<200;n++){
      const state=await manager.get(jobId);
      if(state.stage==="assemble")break;
      await later(3);
    }
    assert.equal((await manager.cancel(jobId)).status,"cancelled");
    finishPersist();await later(20);
    assert.equal((await manager.get(jobId)).status,"cancelled");
  }finally{finishPersist();await rm(root,{recursive:true,force:true});}
});

test("cancellation acknowledged during an in-flight completed checkpoint stays cancelled",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-complete-cancel-race-"));
  let releaseWrite=()=>{},startedWrite=()=>{};
  const blocked=new Promise(resolve=>{releaseWrite=resolve;});
  const entered=new Promise(resolve=>{startedWrite=resolve;});
  const manager=fixture(root,{writeCheckpoint:async(file,value)=>{
    if(file.endsWith("manifest.json")&&value.status==="completed"){
      startedWrite();await blocked;
    }
    const temp=file+"."+Math.random().toString(16).slice(2)+".test.tmp";
    await writeFile(temp,JSON.stringify(value));await rename(temp,file);
  }});
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    await entered;
    const cancellation=manager.cancel(jobId);
    await later(10);
    releaseWrite();
    assert.equal((await cancellation).status,"cancelled");
    await later(25);
    assert.equal((await manager.get(jobId)).status,"cancelled");
  }finally{releaseWrite();await rm(root,{recursive:true,force:true});}
});

test("completed job writes an artifact readable by the existing Studio research loader",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-jobs-"));
  const text="Installations require a physical heat pump and skilled labor. Installations can be expensive when ductwork needs repair or the house needs electrical upgrades. The unit price alone does not include every part of the installation service.";
  const source={...capture.captures[0],text};
  const unit={subject:"Heat pump installation",before:"Only the unit cost is displayed",action:"Reveal the hardware and labor components",after:"Both hardware and labor are visible",parts:["Equipment","Skilled labor"],operator:"split",phases:[
    {visualAction:"Cover additional components behind the price label",learningChange:"The quoted unit price excludes some work",onScreenText:"Unit price",narration:"The equipment price does not tell the whole story.",visualElements:[{label:"Heat pump",detail:"Hardware included in a quote"},{label:"Hidden services",detail:"Work not shown by unit price"}]},
    {visualAction:"Split the final bill into hardware and labor",learningChange:"The viewer sees distinct cost categories",onScreenText:"Installation components",narration:"Skilled work is required alongside equipment.",visualElements:[{label:"Equipment",detail:"Hardware purchased"},{label:"Skilled labor",detail:"Work required at the house"}]},
    {visualAction:"Bring equipment and labor together for the final bill",learningChange:"Both categories belong in the total",onScreenText:"Complete cost",narration:"The full installation includes more than hardware.",visualElements:[{label:"Equipment total",detail:"Hardware share of the cost"},{label:"Labor total",detail:"Service share of the cost"}]},
  ]};
  const manager=createResearchJobManager({root,loadSearch:async()=>({topic:brief.title,query:brief.viewerQuestion,audience:brief.audience,locale:brief.locale,results:[{url:source.url,title:source.title}]}),
    capture:async()=>({captures:[source],gaps:[]}),evidence:buildDeterministicDossier,
    outline:async dossier=>({pattern:"cost-dissection",premise:"Installation is more than equipment",hook:"Where do installation costs come from?",beats:[
      {question:"What contributes to installation?",claimIds:[dossier.claims[0].id],purpose:"Reveal two contributions",payoff:"The bill includes hardware and labor"},
      {question:"Why do different homes vary?",claimIds:[dossier.claims[0].id],purpose:"Explain installation complexity",payoff:"Work beyond the unit changes costs"},
    ]}),scene:async()=>unit,assemble:assembleResumablePlan});
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    const status=await settled(manager,jobId);
    assert.equal(status.status,"completed");
    const restored=await loadStudioResearchDraft(status.artifactId,{root});
    assert.equal(restored.plan.shots.length,6);
    assert.ok(restored.quotes.every(quote=>source.text.includes(quote.quote)));
    assert.equal(restored.searchArtifactId,brief.searchArtifactId);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("truncated visual phase leaves smaller checkpoints and resume does not repeat accepted inference",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-chunks-"));
  const called={structure:[],visual:[],narration:[]};
  let failures=0;
  const manager=fixture(root,{
    scene:null,
    sceneStructure:async(_story,index)=>{called.structure.push(index);return {subject:"Heat pump"};},
    sceneVisual:async(_story,index,phase,_structure,_previous,_d,_q,_settings,options)=>{
      called.visual.push([index,phase,options.feedback]);
      if(index===0&&phase===1&&failures++<3)throw Object.assign(Error("secret source passage"),
        {code:"output_truncated",field:"response"});
      return {visualAction:`action ${index} ${phase}`};
    },
    sceneNarration:async(_story,index,phase)=>{called.narration.push([index,phase]);return {narration:`narration ${phase}`};},
    combineScene:(structure,phases)=>({structure,phases}),
  });
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    const failed=await settled(manager,jobId);
    assert.equal(failed.status,"failed");
    assert.equal(failed.error.detailCode,"output_truncated");
    assert.equal(failed.currentStep,"visual:2");
    assert.equal(failed.completedScenes,0);
    const saved=join(root,"jobs",jobId);
    assert.deepEqual(JSON.parse(await readFile(join(saved,"structure_0_0_0.json"),"utf8")),{subject:"Heat pump"});
    assert.deepEqual(JSON.parse(await readFile(join(saved,"visual_0_0_0_0.json"),"utf8")),{visualAction:"action 0 0"});
    assert.deepEqual(JSON.parse(await readFile(join(saved,"narration_0_0_0_0.json"),"utf8")),{narration:"narration 0"});
    assert.ok(called.visual.filter(([,phase])=>phase===1).slice(1).every(([,phase,feedback])=>phase===1&&/shorter|compact/i.test(feedback)));
    await manager.resume(jobId,{primary:model});
    assert.equal((await settled(manager,jobId)).status,"completed");
    assert.equal(called.structure.filter(index=>index===0).length,1);
    assert.equal(called.visual.filter(([index,phase])=>index===0&&phase===0).length,1);
    assert.equal(called.narration.filter(([index,phase])=>index===0&&phase===0).length,1);
    assert.equal(called.visual.filter(([index,phase])=>index===0&&phase===1).length,4);
    assert.equal((await manager.get(jobId)).completedScenes,2);
    assert.doesNotMatch(JSON.stringify(await manager.get(jobId)),/secret source passage/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("older completed scene checkpoints bypass the new split scene generator",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-chunks-old-"));
  let structureCalls=0;
  const manager=fixture(root,{scene:null,sceneStructure:async()=>{structureCalls++;return {};},
    sceneVisual:async(_story,index)=>{if(index===0)throw Error("Old scene must be reused");return {};},
    sceneNarration:async()=>({narration:"safe"}),combineScene:()=>({})});
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    const stopped=await settled(manager,jobId);
    assert.equal(stopped.status,"failed");
    const file=join(root,"jobs",jobId,"scene_0_0_0.json");
    await writeFile(file,JSON.stringify({legacyScene:true}));
    await manager.resume(jobId,{primary:model});
    const done=await settled(manager,jobId);
    assert.equal(done.status,"completed");
    assert.equal(structureCalls,2);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("manually regenerating one scene invalidates its partial pieces without rerunning a different scene",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-chunks-revision-"));
  const seen=[];
  const manager=fixture(root,{scene:null,
    sceneStructure:async(_story,index)=>{seen.push(["structure",index]);return {};},
    sceneVisual:async(_story,index,phase)=>{seen.push(["visual",index,phase]);return {};},
    sceneNarration:async(_story,index,phase)=>{seen.push(["narration",index,phase]);return {};},
    combineScene:()=>({})});
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    assert.equal((await settled(manager,jobId)).status,"completed");
    assert.equal(seen.filter(([,index])=>index===0).length,7);
    assert.equal(seen.filter(([,index])=>index===1).length,7);
    await manager.retryScene(jobId,0,{primary:model});
    assert.equal((await settled(manager,jobId)).status,"completed");
    assert.equal(seen.filter(([,index])=>index===0).length,14);
    assert.equal(seen.filter(([,index])=>index===1).length,7);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("a truncated second outline beat resumes from saved skeleton and first beat",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-outline-pieces-"));
  let skeletonCalls=0,firstCalls=0,secondCalls=0;
  const chunks={outline:null,
    outlineSkeleton:async()=>{skeletonCalls++;return {beatCount:2};},
    outlineBeat:async(_skeleton,index)=>{
      if(index===0){firstCalls++;return {index};}
      secondCalls++;
      if(secondCalls<=3)throw Object.assign(Error("private raw answer"),{code:"output_truncated",field:"response"});
      return {index};
    },combineOutline:(_d,_skeleton,beats)=>({...outline,beats:beats.map((_beat,index)=>outline.beats[index])})};
  const manager=fixture(root,chunks);
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    const failed=await settled(manager,jobId);
    assert.equal(failed.status,"failed");
    assert.equal(failed.stage,"outline");
    assert.equal(failed.currentStep,"beat:2");
    assert.equal(failed.error.detailCode,"output_truncated");
    const folder=join(root,"jobs",jobId);
    assert.deepEqual(JSON.parse(await readFile(join(folder,"outline_skeleton_0.json"),"utf8")),{beatCount:2});
    assert.deepEqual(JSON.parse(await readFile(join(folder,"outline_beat_0_0.json"),"utf8")),{index:0});
    // A newly constructed manager simulates a server restart; only missing work should run.
    const restarted=fixture(root,chunks);
    await restarted.resume(jobId,{primary:model});
    assert.equal((await settled(restarted,jobId)).status,"completed");
    assert.equal(skeletonCalls,1);
    assert.equal(firstCalls,1);
    assert.equal(secondCalls,4);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("provider failure after truncation does not erase the compact retry instruction",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-outline-retry-"));
  const feedback=[];
  const manager=fixture(root,{outline:null,
    outlineSkeleton:async(_d,_q,_settings,opts)=>{
      feedback.push(opts.feedback);
      if(feedback.length===1)throw Object.assign(Error("partial private response"),{code:"output_truncated",field:"response"});
      if(feedback.length===2)throw Error("fetch failed");
      return {beatCount:2};
    },outlineBeat:async(_skeleton,index)=>({index}),combineOutline:()=>outline});
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    assert.equal((await settled(manager,jobId)).status,"completed");
    assert.equal(feedback.length,3);
    assert.equal(feedback[0],null);
    assert.match(feedback[1],/cut off|truncat/i);
    assert.match(feedback[2],/cut off|truncat/i);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("safe provider error categories identify unavailable HTTP service without leaking URLs",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-outline-provider-"));
  const manager=fixture(root,{outline:async()=>{throw Error("Local model returned HTTP 503 at https://private.invalid/token=secret");}});
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    const state=await settled(manager,jobId);
    assert.equal(state.status,"failed");
    assert.equal(state.error.code,"provider_unavailable");
    assert.equal(state.error.providerDetail,"http_5xx");
    assert.doesNotMatch(JSON.stringify(state),/secret|private\.invalid/i);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("truncation is remembered when switching to the configured secondary local model",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-outline-fallback-"));
  const fallbackFeedback=[];
  const manager=fixture(root,{outline:null,
    outlineSkeleton:async(_d,_q,settings,options)=>{
      if(settings.model==="local-small")throw Object.assign(Error("truncated private data"),{code:"output_truncated",field:"response"});
      fallbackFeedback.push(options.feedback);
      return {beatCount:2};
    },outlineBeat:async(_skeleton,index)=>({index}),combineOutline:()=>outline});
  try{
    const {jobId}=await manager.create(brief,{primary:model,secondary:{...model,model:"local-backup"}});
    assert.equal((await settled(manager,jobId)).status,"completed");
    assert.equal(fallbackFeedback.length,1);
    assert.match(fallbackFeedback[0],/truncat|cut off/i);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("existing whole outline artifact skips the new skeleton and beat jobs",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-outline-legacy-"));
  let calls=0;
  const manager=fixture(root,{outline:null,
    outlineSkeleton:async()=>{calls++;throw Error("new outline path must be bypassed");},
    outlineBeat:async()=>{throw Error("must not generate a beat");}});
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    assert.equal((await settled(manager,jobId)).status,"failed");
    await writeFile(join(root,"jobs",jobId,"outline_0.json"),JSON.stringify({
      pattern:"mechanism",premise:"Installation cost includes multiple components",hook:"Why does installation cost so much?",
      beats:[
        {question:"What materials are involved?",claimIds:["claim_01"],purpose:"Reveal the equipment and labor",payoff:"Installation needs more than equipment"},
        {question:"Why does labor matter?",claimIds:["claim_01"],purpose:"Explain the skilled work involved",payoff:"Skilled labor changes the total cost"},
      ],
    }));
    await manager.resume(jobId,{primary:model});
    assert.equal((await settled(manager,jobId)).status,"completed");
    assert.equal(calls,1);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("changing model identity rebuilds partial outline using a new checkpoint generation",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-outline-model-"));
  const calls=[];
  const manager=fixture(root,{outline:null,
    outlineSkeleton:async(_d,_q,settings,options)=>{calls.push(["skeleton",settings.model,options.feedback]);return {beatCount:2};},
    outlineBeat:async(_skeleton,index,_previous,_d,_q,settings)=>{
      calls.push([`beat:${index}`,settings.model]);
      if(index===1&&settings.model==="local-small")throw Object.assign(Error("model cut off"),{code:"output_truncated",field:"response"});
      return {index};
    },combineOutline:()=>outline});
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    assert.equal((await settled(manager,jobId)).status,"failed");
    await manager.resume(jobId,{primary:{...model,model:"new-local-model"}});
    assert.equal((await settled(manager,jobId)).status,"completed");
    assert.deepEqual(calls.filter(([step])=>step==="skeleton"),[["skeleton","local-small",null],["skeleton","new-local-model",null]]);
    assert.deepEqual(calls.filter(([step])=>step==="beat:0"),[["beat:0","local-small"],["beat:0","new-local-model"]]);
    const manifest=JSON.parse(await readFile(join(root,"jobs",jobId,"manifest.json"),"utf8"));
    assert.equal(manifest.generation,1);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("structure states truncation preserves the accepted core across restart and resume",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-scene-core-"));
  let coreCalls=0,stateCalls=0;
  const pieces={scene:null,sceneStructure:null,
    sceneCore:async(_story,index)=>{coreCalls++;return {index,subject:"Installation"};},
    sceneStates:async(_story,index)=>{
      if(index===0&&++stateCalls<=3)throw Object.assign(Error("private model text"),{code:"output_truncated",field:"response"});
      return {before:"Hidden costs",action:"Split parts",after:"Full cost"};
    },combineStructure:(core,states)=>({...core,...states}),
    sceneVisual:async(_story,index,phase)=>({index,phase}),
    sceneNarration:async()=>({narration:"Narration"}),combineScene:()=>({})};
  const manager=fixture(root,pieces);
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    const stopped=await settled(manager,jobId);
    assert.equal(stopped.status,"failed");
    assert.equal(stopped.stage,"scene:1");
    assert.equal(stopped.currentStep,"structure:states");
    assert.equal(stopped.error.detailCode,"output_truncated");
    const folder=join(root,"jobs",jobId);
    assert.deepEqual(JSON.parse(await readFile(join(folder,"structure_core_0_0_0.json"),"utf8")),
      {index:0,subject:"Installation"});
    const recovered=fixture(root,pieces);
    await recovered.resume(jobId,{primary:model});
    assert.equal((await settled(recovered,jobId)).status,"completed");
    assert.equal(coreCalls,2);
    assert.equal(stateCalls,4);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("visual elements truncation resumes from direction and saved completed phases",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-scene-elements-"));
  const calls={direction:[],elements:[],narration:[]};
  let failures=0;
  const manager=fixture(root,{scene:null,sceneStructure:async()=>({subject:"Installation"}),
    sceneVisual:null,
    sceneDirection:async(_story,index,phase)=>{calls.direction.push([index,phase]);return {visualAction:`Action ${index} ${phase}`};},
    sceneElements:async(_story,index,phase)=>{
      calls.elements.push([index,phase]);
      if(index===0&&phase===1&&failures++<3)throw Object.assign(Error("private details"),{code:"output_truncated",field:"response"});
      return {visualElements:[{label:"Equipment",detail:"Shown"},{label:"Labor",detail:"Shown"}]};
    },combineVisual:(direction,elements)=>({...direction,...elements}),
    sceneNarration:async(_story,index,phase)=>{calls.narration.push([index,phase]);return {narration:"Narration"};},
    combineScene:()=>({})});
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    const stopped=await settled(manager,jobId);
    assert.equal(stopped.status,"failed");
    assert.equal(stopped.currentStep,"visual:2:elements");
    const folder=join(root,"jobs",jobId);
    assert.deepEqual(JSON.parse(await readFile(join(folder,"visual_direction_0_0_0_1.json"),"utf8")),
      {visualAction:"Action 0 1"});
    assert.ok(JSON.parse(await readFile(join(folder,"visual_0_0_0_0.json"),"utf8")));
    assert.ok(JSON.parse(await readFile(join(folder,"narration_0_0_0_0.json"),"utf8")));
    await manager.resume(jobId,{primary:model});
    assert.equal((await settled(manager,jobId)).status,"completed");
    assert.equal(calls.direction.filter(([index,phase])=>index===0&&phase===0).length,1);
    assert.equal(calls.direction.filter(([index,phase])=>index===0&&phase===1).length,1);
    assert.equal(calls.elements.filter(([index,phase])=>index===0&&phase===1).length,4);
    assert.equal(calls.narration.filter(([index,phase])=>index===0&&phase===0).length,1);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("an existing complete structure or visual checkpoint bypasses the new fragments",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-scene-compat-"));
  let coreCalls=0,directionCalls=0;
  const manager=fixture(root,{scene:null,sceneStructure:null,sceneVisual:null,
    sceneCore:async()=>{coreCalls++;throw Error("new structure path must not run");},
    sceneDirection:async()=>{directionCalls++;throw Error("existing phase must be reused");},
    sceneNarration:async()=>({narration:"Narration"}),combineScene:()=>({})});
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    assert.equal((await settled(manager,jobId)).status,"failed");
    const folder=join(root,"jobs",jobId);
    await writeFile(join(folder,"structure_0_0_0.json"),JSON.stringify({subject:"Saved"}));
    await writeFile(join(folder,"visual_0_0_0_0.json"),JSON.stringify({visualAction:"Saved"}));
    await manager.resume(jobId,{primary:model});
    const state=await settled(manager,jobId);
    assert.equal(state.currentStep,"visual:2:direction");
    assert.equal(coreCalls,1);
    assert.equal(directionCalls,1);
    assert.equal(state.status,"failed");
  }finally{await rm(root,{recursive:true,force:true});}
});

test("terminal checkpoint disk failure does not leave an unhandled worker rejection",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-terminal-storage-"));
  let failTerminal=true;
  const manager=fixture(root,{
    scene:async()=>{throw Error("Invalid scene JSON");},
    writeCheckpoint:async(file,value)=>{
      if(failTerminal&&file.endsWith("manifest.json")&&value.status==="failed"){
        failTerminal=false;
        throw Object.assign(Error("ENOSPC"),{code:"ENOSPC"});
      }
      const temp=file+".test.tmp";
      await writeFile(temp,JSON.stringify(value));
      await rename(temp,file);
    },
  });
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    const recovered=await settled(manager,jobId);
    assert.equal(recovered.status,"paused");
    assert.equal(recovered.error.code,"interrupted");
  }finally{await rm(root,{recursive:true,force:true});}
});

test("an interrupted prior final snapshot write can be recovered without restarting AI",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-atomic-final-"));
  let inferenceCalls=0;
  const manager=fixture(root,{persist:undefined,scene:async(_,index)=>{inferenceCalls++;return {index};}});
  try{
    const {jobId}=await manager.create(brief,{primary:model});
    const done=await settled(manager,jobId);
    assert.equal(done.status,"completed");
    const path=join(root,done.artifactId+".json");
    const full=await readFile(path,"utf8");
    await writeFile(path,"{\"incomplete\":true}");
    const manifestPath=join(root,"jobs",jobId,"manifest.json");
    const manifest=JSON.parse(await readFile(manifestPath,"utf8"));
    manifest.status="failed";manifest.stage="assemble";manifest.artifactId=null;
    await writeFile(manifestPath,JSON.stringify(manifest));
    const restarted=fixture(root,{persist:undefined,scene:async()=>{throw Error("AI must not rerun");}});
    await restarted.resume(jobId,{primary:model});
    const recovered=await settled(restarted,jobId);
    assert.equal(recovered.status,"completed");
    assert.equal(recovered.artifactId,done.artifactId);
    assert.equal(await readFile(path,"utf8"),full);
    assert.equal(inferenceCalls,2);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("saved snapshot accurately records local models that produced accepted fragments",async()=>{
  const root=await mkdtemp(join(tmpdir(),"research-provenance-"));
  const manager=fixture(root,{persist:undefined,
    outline:async(_d,_q,settings)=>{
      if(settings.model==="local-small")throw Error("Model memory exhausted");
      return outline;
    },
  });
  try{
    const {jobId}=await manager.create(brief,{primary:model,secondary:{...model,model:"local-backup"}});
    const done=await settled(manager,jobId);
    assert.equal(done.status,"completed");
    const snapshot=JSON.parse(await readFile(join(root,done.artifactId+".json"),"utf8"));
    assert.deepEqual(snapshot.modelsUsed,["local-backup","local-small"]);
    assert.equal(snapshot.model,"multiple local models");
  }finally{await rm(root,{recursive:true,force:true});}
});
