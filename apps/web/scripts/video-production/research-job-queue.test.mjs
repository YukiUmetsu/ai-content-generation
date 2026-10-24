import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createResearchJobManager} from "./research-job-queue.mjs";
import {buildDeterministicDossier} from "./research-job-evidence.mjs";
import {assembleResumablePlan} from "./research-job-planner.mjs";
import {loadStudioResearchDraft} from "./studio-research.mjs";

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
  const limits={outlineTokens:1024,sceneTokens:3072,timeoutSeconds:360};
  const manager=fixture(root,{scene:async(_outline,index)=>{
    scenes++;
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
    assert.deepEqual(manifest.models.primary.generation,limits);
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
