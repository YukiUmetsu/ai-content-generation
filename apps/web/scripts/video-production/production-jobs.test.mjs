import test from "node:test";
import assert from "node:assert/strict";
import {createProductionJobTracker,PRODUCTION_NODES} from "./production-jobs.mjs";
const FIRST_RUN="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",RETRY_RUN="aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff";

function fakeScheduler(){
  const calls=[];
  let active=0;
  const nodes=PRODUCTION_NODES.map((key,i)=>({id:`node-${i}`,nodeKey:key,state:i===0?"READY":"PENDING"}));
  const fetcher=async (url,init)=>{
    const path=new URL(url).pathname;
    calls.push({path,method:init?.method,body:init?.body?JSON.parse(init.body):null});
    if(path==="/api/jobs")return Response.json({created:true,job:{id:"job-test",state:"RUNNING"},nodes:[...nodes].reverse()});
    if(path.endsWith("/start"))return Response.json({attempt:{id:`attempt-${active}`}});
    if(path.endsWith("/succeed")){
      nodes[active].state="SUCCEEDED";
      active++;
      if(nodes[active])nodes[active].state="READY";
      return Response.json({job:{id:"job-test",state:active===nodes.length?"SUCCEEDED":"RUNNING"},nodes});
    }
    if(path.endsWith("/fail"))return Response.json({job:{id:"job-test",state:"FAILED"},nodes});
    if(path.endsWith("/cancel"))return Response.json({job:{id:"job-test",state:"CANCELLED"},nodes});
    throw Error(`Unexpected ${path}`);
  };
  return {fetcher,calls,nodes};
}

test("video production submits a real dependent DAG and advances stages in order",async()=>{
  const scheduler=fakeScheduler();
  const tracker=createProductionJobTracker({fetcher:scheduler.fetcher,origin:"http://127.0.0.1:8787"});
  const jobId=await tracker.start({productionId:"production-"+"a".repeat(24),revision:"revision-1",runId:FIRST_RUN});
  assert.equal(jobId,"job-test");
  assert.equal(scheduler.calls[1].path,"/api/jobs/job-test/nodes/node-0/start");
  const submission=scheduler.calls[0].body;
  assert.equal(submission.jobKind,"video-production");
  assert.ok(!JSON.stringify(submission).includes("apiKey"));
  assert.deepEqual(submission.nodes.map(x=>x.nodeKey),PRODUCTION_NODES);
  assert.ok(submission.nodes.every(node=>node.input.runId===FIRST_RUN),"original attempt must be recoverable after restart");
  assert.ok(submission.nodes.every(node=>node.maxAttempts===1),"a failed monolithic render must not leave an unclaimed automatic retry");
  assert.deepEqual(submission.nodes[2].dependsOn,[PRODUCTION_NODES[1]]);
  await tracker.advance("asset-search");
  assert.deepEqual(scheduler.nodes.slice(0,2).map(x=>x.state),["SUCCEEDED","SUCCEEDED"]);
  await tracker.advance("narration",{assetSearch:{status:"partial",candidates:2,warnings:["provider unavailable"]},
    artifactLedger:{kind:"asset-search",fingerprint:"a".repeat(64),selected:[
      {beatId:"opening",assetType:"photo",sha256:"b".repeat(64),path:"/private/photo.jpg"}]}});
  assert.equal(scheduler.nodes[2].state,"SUCCEEDED");
  assert.equal(scheduler.calls.find(x=>x.path.endsWith("/node-2/succeed"))?.body.output.assetSearch.status,"partial");
  assert.equal(scheduler.calls.find(x=>x.path.endsWith("/node-2/succeed"))?.body.output.artifactLedger.selected[0].sha256,
    "b".repeat(64));
  assert.ok(!JSON.stringify(scheduler.calls.find(x=>x.path.endsWith("/node-2/succeed"))).includes("/private"));
  assert.equal(scheduler.calls.find(x=>x.path.endsWith("/node-2/succeed"))?.body.output.assetSearch.warnings,undefined,
    "third-party warning strings must not enter the durable Jobs database");
  await tracker.advance("timeline",{artifactLedger:{kind:"narration",beats:[{id:"opening",sha256:"a".repeat(64),samples:48000}]}});
  assert.equal(scheduler.calls.find(x=>x.path.endsWith("/node-3/succeed"))?.body.output.artifactLedger.beats[0].sha256,
    "a".repeat(64));
  await tracker.advance("rendering");
  assert.deepEqual(scheduler.nodes.slice(0,6).map(x=>x.state),Array(6).fill("SUCCEEDED"));
  await tracker.advance("mux",{artifactLedger:{kind:"scene-render",planHash:"b".repeat(64),
    segments:[{sha256:"c".repeat(64),startFrame:0,frameCount:150}]}});
  await tracker.advance("qa",{artifactLedger:{kind:"final-mux",artifacts:{video:"d".repeat(64)}}});
  await tracker.advance("review",{artifactLedger:{kind:"technical-qa",technicalPass:true,manifestHash:"e".repeat(64)}});
  await tracker.complete({artifactLedger:{kind:"export-package",manifestHash:"e".repeat(64),
    artifacts:{video:"d".repeat(64)}}});
  assert.equal(scheduler.calls.find(x=>x.path.endsWith("/node-6/succeed"))?.body.output.artifactLedger.segments[0].startFrame,0);
  assert.equal(scheduler.calls.find(x=>x.path.endsWith("/node-9/succeed"))?.body.output.artifactLedger.manifestHash,"e".repeat(64));
  assert.ok(scheduler.nodes.every(x=>x.state==="SUCCEEDED"));
});

test("Jobs refuses malformed or wrong-stage ledgers before marking steps successful",async()=>{
  const scheduler=fakeScheduler();
  const tracker=createProductionJobTracker({fetcher:scheduler.fetcher});
  await tracker.start({productionId:"production-"+"a".repeat(24),revision:"revision-1",runId:FIRST_RUN});
  const count=()=>scheduler.calls.filter(x=>x.path.endsWith("/succeed")).length;
  const attempts=[
    {kind:"narration",beats:[{id:"scene",sha256:"/home/user/key.json",samples:48000}]},
    {kind:"scene-render",planHash:"a".repeat(64),segments:[]},
    {kind:"narration",beats:[{id:"../../secret",sha256:"b".repeat(64),samples:48000}]},
  ];
  for(const ledger of attempts){
    await assert.rejects(tracker.advance("timeline",{artifactLedger:ledger}),/Jobs (artifact|narration|video)/);
    assert.equal(count(),0,"invalid result cannot mark even preceding steps as completed");
  }
  await tracker.advance("timeline",{artifactLedger:{kind:"narration",beats:[{
    id:"opening",sha256:"c".repeat(64),samples:48000,localPath:"/home/private.mp3"}],
    absolutePath:"/home/private.mp3"},internalSecret:"private-key"});
  const output=scheduler.calls.find(x=>x.path.endsWith("/node-3/succeed")).body.output;
  assert.equal(JSON.stringify(output).includes("private"),false);
  assert.deepEqual(output.artifactLedger.beats[0],{id:"opening",sha256:"c".repeat(64),samples:48000});
  await assert.rejects(tracker.complete({artifactLedger:{kind:"export-package",manifestHash:"/tmp/master"}}),/Jobs artifact hash/);
  assert.equal(scheduler.nodes[9].state,"PENDING","invalid export output must not complete the remaining DAG");
});

test("durable job update errors fail closed before a renderer can claim success",async()=>{
  const scheduler=fakeScheduler();
  const tracker=createProductionJobTracker({fetcher:scheduler.fetcher,origin:"http://127.0.0.1:8787"});
  await tracker.start({productionId:"production-"+"a".repeat(24),revision:"revision-1",runId:FIRST_RUN});
  await tracker.advance("narration");
  await tracker.fail("voice_unavailable","Authorized voice endpoint unavailable");
  assert.ok(scheduler.calls.some(x=>x.path.endsWith("/fail")&&x.body.errorCode==="voice_unavailable"));
  await assert.rejects(tracker.complete(),/failed|cancelled/i);
});

test("duplicate active production jobs do not execute twice",async()=>{
  const fetcher=async()=>Response.json({created:false,job:{id:"existing",state:"RUNNING"},nodes:[]});
  const tracker=createProductionJobTracker({fetcher,origin:"http://127.0.0.1:8787"});
  await assert.rejects(tracker.start({productionId:"production-"+"a".repeat(24),revision:"a",runId:RETRY_RUN}),/already running/i);
});

test("a failed production explicitly retries its failed node while retaining successful work",async()=>{
  const productionId="production-"+"a".repeat(24),revision="revision-1";
  const nodes=PRODUCTION_NODES.map((nodeKey,i)=>({id:`node-${i}`,nodeKey,
    input:{productionId,revision,runId:FIRST_RUN},
    state:i<2?"SUCCEEDED":i===2?"FAILED":"CANCELLED"}));
  const calls=[];
  const fetcher=async (url)=>{
    const path=new URL(url).pathname;calls.push(path);
    if(path==="/api/jobs")return Response.json({created:false,job:{id:"existing",state:"FAILED"},nodes});
    if(path.endsWith("/retry")){nodes[2].state="READY";return Response.json({job:{id:"existing",state:"RUNNING"},nodes:[...nodes].reverse()});}
    if(path.endsWith("/start"))return Response.json({attempt:{id:"attempt-2"}});
    throw Error(`Unexpected ${path}`);
  };
  const tracker=createProductionJobTracker({fetcher});
  assert.equal(await tracker.start({productionId,revision,runId:RETRY_RUN}),"existing");
  assert.equal(tracker.priorRunId,FIRST_RUN);
  assert.deepEqual(calls,["/api/jobs","/api/jobs/existing/retry","/api/jobs/existing/nodes/node-2/start"]);
});
