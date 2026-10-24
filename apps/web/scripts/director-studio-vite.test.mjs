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

test("project discovery routes load saved history without starting discovery until explicit POST",async()=>{
  const runId="discover_"+"a".repeat(24);
  const snapshot={id:runId,projectId:"project-house",status:"queued",candidates:[]};
  let starts=0;
  const deps={model:async()=>({model:"local-research",endpoint:"http://127.0.0.1:11434/v1/chat/completions"}),
    discovery:{list:async id=>{assert.equal(id,"project-house");return [snapshot];},
      get:async()=>snapshot,
      create:async()=>{starts++;return snapshot;},resume:async()=>snapshot}};
  const saved=await get("/project-discovery/project-house/runs",deps);
  assert.equal(saved.status,200);
  assert.deepEqual(saved.result,{runs:[snapshot]});
  assert.equal(starts,0);
  assert.equal((await get(`/project-discovery/project-house/runs/${runId}`,deps)).result.id,runId);
  assert.equal((await post("/project-discovery",{projectId:"project-house",projectName:"Home Costs",description:""},deps)).status,202);
  assert.equal(starts,1);
  assert.equal((await post(`/project-discovery/${runId}/resume`,{projectId:"project-house",projectName:"Home Costs",description:""},deps)).status,202);
});

