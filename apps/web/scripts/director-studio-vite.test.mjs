import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { handleDirectorRequest } from "./director-studio-vite.mjs";

async function post(path,body,deps){
  const req=Readable.from([Buffer.from(JSON.stringify(body))]);
  Object.assign(req,{method:"POST",url:path,headers:{host:"127.0.0.1:5173",origin:"http://127.0.0.1:5173","x-contentgen-director":"local-only"}});
  let status,result;
  const res={writeHead(value){status=value;},end(value){result=JSON.parse(value);}};
  await handleDirectorRequest(req,res,deps);
  return {status,result};
}
async function get(path,deps){
  const req=Readable.from([]);
  Object.assign(req,{method:"GET",url:path,headers:{host:"127.0.0.1:5173"}});
  let status,result;
  const res={writeHead(value){status=value;},end(value){result=JSON.parse(value);}};
  await handleDirectorRequest(req,res,deps);
  return {status,result};
}
test("variants, brief variants and combined research-to-plan resolve their distinct task models",async()=>{
  const picked=[],calls=[];
  const deps={model:async task=>{picked.push(task);return {endpoint:"http://127.0.0.1:11434/v1/chat/completions",model:task+"-model"};},
    generate:async(_input,opts)=>{calls.push(["variants",opts.modelSettings.model]);return {variants:[]};},
    editorial:async(_input,opts)=>{calls.push(["brief",opts.modelSettings.model]);return [];},
    researchDraft:async(_input,research,opts)=>{calls.push(["research",research.model,"story",opts.storyModelSettings.model]);return {dossier:{id:"a"},plan:{shots:[]}};}};
  assert.equal((await post("/variants",{shotId:"shot-1"},deps)).status,200);
  assert.equal((await post("/brief-variants",{topic:"Roofs"},deps)).status,200);
  assert.equal((await post("/research-draft",{title:"Roofs"},deps)).status,200);
  assert.deepEqual(picked,["hooks","hooks","research","story"]);
  assert.deepEqual(calls,[["variants","hooks-model"],["brief","hooks-model"],["research","research-model","story","story-model"]]);
});

test("search-only Studio API saves and retrieves leads without consulting local models",async()=>{
  const brief={title:"Heat pumps",viewerQuestion:"Why expensive?",audience:"Homeowners",locale:"en-US"};
  const snapshot={artifactId:"search_20261024T015250000Z-aaaaaaaaaaaa",kind:"studio-search-snapshot",
    topic:brief.title,query:brief.viewerQuestion,results:[{title:"DOE",url:"https://www.energy.gov/"}]};
  let searches=0;
  const deps={model:async()=>{throw Error("Model must not load for search-only");},
    searchSources:async request=>{searches++;assert.deepEqual(request,brief);return snapshot;},
    listSearch:async()=>[{artifactId:snapshot.artifactId,topic:brief.title,resultCount:1}],
    loadSearch:async id=>{assert.equal(id,snapshot.artifactId);return snapshot;}};
  assert.deepEqual((await post("/research-search",brief,deps)),{status:200,result:snapshot});
  assert.equal(searches,1);
  assert.equal((await get("/research-search",deps)).result.items.length,1);
  assert.deepEqual((await get("/research-search/"+snapshot.artifactId,deps)).result,snapshot);
});

test("storyboard route forwards saved search artifact ID without altering separate model selection",async()=>{
  const request={title:"Heat pumps",viewerQuestion:"Why expensive?",audience:"Homeowners",
    locale:"en-US",searchArtifactId:"search_20261024T015250000Z-aaaaaaaaaaaa"};
  let forwarded;
  const result=await post("/research-draft",request,{
    model:async task=>({model:task+"-model",endpoint:"http://127.0.0.1:11434/v1/chat/completions"}),
    researchDraft:async input=>{forwarded=input;return {dossier:{id:"research_test"},plan:{shots:[{id:"1"}]}};}});
  assert.equal(result.status,200);
  assert.equal(forwarded.searchArtifactId,request.searchArtifactId);
});

test("research job routes start immediately and support durable progress, resume and targeted retry",async()=>{
  const calls=[];
  const jobId="job_"+"a".repeat(24);
  const snapshot={jobId,status:"queued",stage:"queued",completedScenes:0,totalScenes:3};
  const manager={
    create:async (brief,models)=>{calls.push(["create",brief.searchArtifactId,models.primary.model]);return snapshot;},
    get:async id=>{calls.push(["get",id]);return {...snapshot,status:"failed",stage:"scene:2"};},
    resume:async(id)=>{calls.push(["resume",id]);return snapshot;},
    retryScene:async(id,sceneId)=>{calls.push(["retry",id,sceneId]);return snapshot;},
    cancel:async id=>{calls.push(["cancel",id]);return {...snapshot,status:"cancelled"};},
  };
  const deps={jobs:manager,model:async task=>({model:task+"-model",endpoint:"http://127.0.0.1:11434/v1/chat/completions"})};
  assert.equal((await post("/research-jobs",{title:"Heat pumps",viewerQuestion:"Why costly?",audience:"Homeowners",locale:"en-US",searchArtifactId:"search_test"},deps)).status,202);
  assert.equal((await get("/research-jobs/"+jobId,deps)).result.status,"failed");
  assert.equal((await post("/research-jobs/"+jobId+"/resume",{},deps)).status,202);
  assert.equal((await post("/research-jobs/"+jobId+"/scenes/1/retry",{},deps)).status,202);
  assert.equal((await post("/research-jobs/"+jobId+"/cancel",{},deps)).result.status,"cancelled");
  assert.deepEqual(calls,[
    ["create","search_test","story-model"],["get",jobId],["resume",jobId],["retry",jobId,"1"],["cancel",jobId],
  ]);
});

test("a user can retry only an existing evidence repair job through the local route",async()=>{
  const jobId="job_"+"a".repeat(24);
  let called=0;
  const response=await post("/research-jobs/"+jobId+"/repair",{},{
    jobs:{retryEvidence:async id=>{called++;assert.equal(id,jobId);return {jobId,status:"queued",stage:"queued"};}},
  });
  assert.equal(response.status,202);
  assert.equal(response.result.jobId,jobId);
  assert.equal(called,1);
});
test("research job only receives a secondary local model when fallback was explicitly configured",async()=>{
  let seen;
  const deps={model:async()=>({model:"primary",endpoint:"http://127.0.0.1:11434/v1/chat/completions"}),
    fallback:async()=>({model:"backup",endpoint:"http://127.0.0.1:10100/inference/v1/chat/completions"}),
    jobs:{create:async (_input,models)=>{seen=models;return {jobId:"job_"+"a".repeat(24),status:"queued"};}}};
  const result=await post("/research-jobs",{title:"Heat pumps",viewerQuestion:"Why costly?",audience:"Homeowners",locale:"en-US",searchArtifactId:"search_test"},deps);
  assert.equal(result.status,202);
  assert.equal(seen.primary.model,"primary");
  assert.equal(seen.secondary.model,"backup");
});


test("compile saved research opens an immutable snapshot without running any model or search",async()=>{
  const artifactId="research_hvac-123456789abc";
  const dossier={kind:"research-dossier",id:"research_hvac",topic:{title:"HVAC"}};
  const plan={kind:"preproduction-plan",researchId:dossier.id,shots:[{id:"shot_1"}]};
  let loaded=0,compiled=0;
  const deps={
    model:async()=>{throw Error("Saved project loading must not start a model.");},
    loadResearch:async id=>{loaded++;assert.equal(id,artifactId);return {artifactId,snapshotId:dossier.id,dossier,plan};},
    compileBundle:(d,p)=>{
      compiled++;assert.equal(d,dossier);assert.equal(p,plan);
      return {kind:"preproduction-bundle",researchId:d.id,plan:p,planSha256:"a".repeat(64)};
    },
  };
  const result=await post("/compile-saved-research",{artifactId},deps);
  assert.equal(result.status,200);
  assert.equal(result.result.artifactId,artifactId);
  assert.equal(result.result.bundle.researchId,dossier.id);
  assert.deepEqual([loaded,compiled],[1,1]);
});
test("compile saved research rejects malformed IDs and mismatched saved plans",async()=>{
  let loads=0;
  const bad=await post("/compile-saved-research",{artifactId:"../../elsewhere"},{
    loadResearch:async()=>{loads++;throw Error("Must not read path");},
  });
  assert.equal(bad.status,422);assert.equal(loads,0);
  const cross=await post("/compile-saved-research",{artifactId:"research_hvac-123456789abc"},{
    loadResearch:async()=>({artifactId:"research_hvac-123456789abc",snapshotId:"research_hvac",
      dossier:{kind:"research-dossier",id:"research_hvac"},plan:{researchId:"research_other"}}),
    compileBundle:()=>{throw Error("Must reject cross-research bundles");},
  });
  assert.equal(cross.status,422);
});

test("rejects a null storyboard instead of silently compiling without synchronization",async()=>{
  let loaded=0;
  const result=await post("/compile-saved-research",{
    artifactId:"research_hvac-123456789abc",projectId:"project-demo",storyboard:null,
  },{loadResearch:async()=>{loaded++;throw Error("Should reject before loading source.");}});
  assert.equal(result.status,422);
  assert.equal(loaded,0);
});

test("passes an explicitly saved storyboard through the deterministic Director synchronizer",async()=>{
  const artifactId="research_hvac-123456789abc";
  const dossier={id:"research_hvac"},plan={researchId:"research_hvac",shots:[{id:"shot_one"}]};
  const storyboard={kind:"contentgen-semantic-storyboard",id:"storyboard-project-demo",beats:[{id:"shot_one"}]};
  let received;
  const result=await post("/compile-saved-research",{artifactId,projectId:"project-demo",storyboard},{
    model:async()=>{throw Error("No AI allowed in storyboard handoff");},
    loadResearch:async()=>({artifactId,snapshotId:dossier.id,dossier,plan}),
    compileBundle:()=>{throw Error("Must apply changes through synchronizer");},
    syncStoryboard:input=>{received=input;return {
      bundle:{kind:"preproduction-bundle",researchId:dossier.id,plan:{...plan,updated:true}},
      synchronization:{storyboardSha256:"b".repeat(64),applied:["shot_one:narration"],manualReview:[]},
    };},
  });
  assert.equal(result.status,200);
  assert.equal(received.projectId,"project-demo");
  assert.equal(received.artifactId,artifactId);
  assert.equal(received.storyboard,storyboard);
  assert.equal(result.result.synchronization.applied[0],"shot_one:narration");
});
