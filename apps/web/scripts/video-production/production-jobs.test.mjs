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
  await tracker.advance("narration",{assetSearch:{status:"partial",candidates:2,warnings:["provider unavailable"]}});
  assert.equal(scheduler.nodes[2].state,"SUCCEEDED");
  assert.equal(scheduler.calls.find(x=>x.path.endsWith("/node-2/succeed"))?.body.output.assetSearch.status,"partial");
  await tracker.advance("rendering");
  assert.deepEqual(scheduler.nodes.slice(0,6).map(x=>x.state),Array(6).fill("SUCCEEDED"));
  await tracker.complete();
  assert.ok(scheduler.nodes.every(x=>x.state==="SUCCEEDED"));
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
