import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
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

test("script section route selects dedicated installed script model and returns a candidate only",async()=>{
  const chosen=[],supplied={sectionId:"hook",mode:"regenerate",extraInstructions:"Make the first sentence specific"};
  const result=await post("/script-regenerate-section",supplied,{
    model:async task=>{chosen.push(task);return {model:"local-script",endpoint:"http://127.0.0.1:11434/v1/chat/completions"};},
    script:async (input,options)=>{
      assert.deepEqual(input,supplied);
      assert.equal(options.modelSettings.model,"local-script");
      return {narration:"A better hook",claimRefs:[],sourceRefs:[]};
    },
  });
  assert.equal(result.status,200);
  assert.deepEqual(chosen,["script"]);
  assert.equal(result.result.narration,"A better hook");
  assert.equal(result.result.status,"candidate-needs-acceptance");
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

test("project discovery routes load saved history without starting discovery until explicit POST",async()=>{
  const runId="discover_"+"a".repeat(24);
  const snapshot={id:runId,projectId:"project-house",status:"queued",candidates:[]};
  let starts=0,cancels=0;
  const deps={model:async()=>({model:"local-research",endpoint:"http://127.0.0.1:11434/v1/chat/completions"}),
    discovery:{list:async id=>{assert.equal(id,"project-house");return [snapshot];},
      get:async()=>snapshot,
      create:async()=>{starts++;return snapshot;},resume:async()=>snapshot,
      cancel:async(projectId,id)=>{assert.equal(projectId,"project-house");assert.equal(id,runId);
        cancels++;return {...snapshot,status:"cancelled"};}}};
  const saved=await get("/project-discovery/project-house/runs",deps);
  assert.equal(saved.status,200);
  assert.deepEqual(saved.result,{runs:[snapshot]});
  assert.equal(starts,0);
  assert.equal((await get(`/project-discovery/project-house/runs/${runId}`,deps)).result.id,runId);
  assert.equal((await post("/project-discovery",{projectId:"project-house",projectName:"Home Costs",description:""},deps)).status,202);
  assert.equal(starts,1);
  assert.equal((await post(`/project-discovery/${runId}/resume`,{projectId:"project-house",projectName:"Home Costs",description:""},deps)).status,202);
  const cancelled=await post(`/project-discovery/${runId}/cancel`,{projectId:"project-house"},deps);
  assert.equal(cancelled.status,200);
  assert.equal(cancelled.result.status,"cancelled");
  assert.equal(cancels,1);
});

test("project discovery route preserves session identity for the existing Node discovery worker",async()=>{
  const payload={projectId:"project-house",projectName:"Home Costs",description:"Household finances",sessionId:"session-abc123"};
  let forwarded;
  const result=await post("/project-discovery",payload,{
    model:async()=>({model:"local",endpoint:"http://127.0.0.1:11434/v1/chat/completions"}),
    discovery:{create:async(input)=>{forwarded=input;return {id:"discover_"+"a".repeat(24),sessionId:payload.sessionId,status:"queued"};}},
  });
  assert.equal(result.status,202);
  assert.deepEqual(forwarded,payload);
  assert.equal(result.result.sessionId,payload.sessionId);
});

test("project discovery forwards an explicitly configured secondary research profile for create and resume",async()=>{
  const runId="discover_"+"a".repeat(24);
  const selected=[];
  const deps={model:async task=>({model:`${task}-primary`,endpoint:"http://127.0.0.1:11434/v1/chat/completions"}),
    discoveryFallback:async()=>({model:"research-backup",endpoint:"http://127.0.0.1:1234/v1/chat/completions"}),
    discovery:{create:async(_body,models)=>{selected.push(models);return {id:runId,status:"queued"};},
      resume:async(_body,_run,models)=>{selected.push(models);return {id:runId,status:"queued"};}}};
  assert.equal((await post("/project-discovery",{projectId:"project-house",projectName:"Home Costs",description:""},deps)).status,202);
  assert.equal((await post(`/project-discovery/${runId}/resume`,{projectId:"project-house",projectName:"Home Costs",description:""},deps)).status,202);
  assert.equal(selected.length,2);
  assert.ok(selected.every(settings=>settings.primary.model==="research-primary"&&settings.secondary.model==="research-backup"));
});

test("keyword stream sends accepted suggestions before all local AI batches finish",async()=>{
  const req=Readable.from([Buffer.from(JSON.stringify({name:"House Math",description:"Homeowner costs",keywords:[]}))]);
  Object.assign(req,{method:"POST",url:"/project-keyword-suggestions/stream",
    headers:{host:"127.0.0.1:5173",origin:"http://127.0.0.1:5173","x-contentgen-director":"local-only"}});
  const writes=[];let status=0,contentType="",ended=false,wakeFirst;
  const first=new Promise(resolve=>{wakeFirst=resolve;});
  const res=Object.assign(new EventEmitter(),{
    writableEnded:false,
    writeHead(code,headers){status=code;contentType=headers["Content-Type"];},
    write(chunk){writes.push(String(chunk));wakeFirst();return true;},
    end(chunk){if(chunk)writes.push(String(chunk));ended=true;this.writableEnded=true;},
  });
  let releaseSecond;const gate=new Promise(resolve=>{releaseSecond=resolve;});
  const quality={modelRequests:1,batches:1,proposed:2,rejected:0,partial:true,evidence:"unverified"};
  const pending=handleDirectorRequest(req,res,{model:async()=>({model:"local",endpoint:"http://127.0.0.1:1234/v1/chat/completions"}),
    projectKeywords:async(_input,{onBatch})=>{
      await onBatch({suggestions:[{text:"Home insurance renewal costs",kind:"topic",rationale:"Explains premiums"}],quality,step:1,totalSteps:6});
      await gate;
      return {suggestions:[{text:"Home insurance renewal costs",kind:"topic",rationale:"Explains premiums"}],quality:{...quality,partial:true}};
    }});
  try{
    await Promise.race([first,new Promise((_,reject)=>setTimeout(()=>reject(Error("No progressive response")),250))]);
    assert.equal(status,200);
    assert.match(contentType,/x-ndjson/i);
    assert.equal(ended,false);
    assert.equal(JSON.parse(writes.join("").split("\n")[0]).type,"batch");
  }finally{releaseSecond();}
  await pending;
  const events=writes.join("").trim().split("\n").map(line=>JSON.parse(line));
  assert.deepEqual(events.map(event=>event.type),["batch","done"]);
  assert.equal(ended,true);
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
  assert.deepEqual(received.storyboard,storyboard);
  assert.equal(result.result.synchronization.applied[0],"shot_one:narration");
});

test("closing a keyword stream aborts its own running generator",async()=>{
  const req=Readable.from([Buffer.from(JSON.stringify({name:"House Math",description:"Homeowner costs",keywords:[]}))]);
  Object.assign(req,{method:"POST",url:"/project-keyword-suggestions/stream",
    headers:{host:"127.0.0.1:5173",origin:"http://127.0.0.1:5173","x-contentgen-director":"local-only"}});
  let releaseFirst,signalSeen,wasAborted=false;
  const first=new Promise(resolve=>{releaseFirst=resolve;});
  const res=Object.assign(new EventEmitter(),{writableEnded:false,writeHead(){},write(){releaseFirst();return true;},
    end(){this.writableEnded=true;}});
  const pending=handleDirectorRequest(req,res,{model:async()=>({model:"local",endpoint:"http://127.0.0.1:1234/v1/chat/completions"}),
    projectKeywords:async(_input,{onBatch,signal})=>{
      signalSeen=signal;
      await onBatch({suggestions:[],quality:{modelRequests:1,batches:0,proposed:0,rejected:2,partial:true,evidence:"unverified"},step:1,totalSteps:6});
      await new Promise((_,reject)=>signal.addEventListener("abort",()=>{wasAborted=true;reject(signal.reason);},{once:true}));
    }});
  await Promise.race([first,new Promise((_,reject)=>setTimeout(()=>reject(Error("No first batch")),250))]);
  res.emit("close");
  await pending;
  assert.equal(signalSeen.aborted,true);
  assert.equal(wasAborted,true);
});

