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
  assert.ok(submission.nodes.every(node=>node.maxAttempts===3),"each stage must support bounded retry after a worker restart");
  assert.deepEqual(submission.nodes[2].dependsOn,[PRODUCTION_NODES[1]]);
  await tracker.advance("asset-search");
  assert.deepEqual(scheduler.nodes.slice(0,2).map(x=>x.state),["SUCCEEDED","SUCCEEDED"]);
  await tracker.advance("asset-preparation",{assetSearch:{status:"partial",candidates:2,warnings:["provider unavailable"]}});
  await tracker.advance("narration",{
    artifactLedger:{kind:"asset-preparation",fingerprint:"a".repeat(64),selected:[
      {beatId:"opening",assetType:"photo",sha256:"b".repeat(64),path:"/private/photo.jpg"}]}});
  assert.equal(scheduler.nodes[3].state,"SUCCEEDED");
  assert.equal(scheduler.calls.find(x=>x.path.endsWith("/node-2/succeed"))?.body.output.assetSearch.status,"partial");
  assert.equal(scheduler.calls.find(x=>x.path.endsWith("/node-3/succeed"))?.body.output.artifactLedger.selected[0].sha256,
    "b".repeat(64));
  assert.ok(!JSON.stringify(scheduler.calls.find(x=>x.path.endsWith("/node-2/succeed"))).includes("/private"));
  assert.equal(scheduler.calls.find(x=>x.path.endsWith("/node-2/succeed"))?.body.output.assetSearch.warnings,undefined,
    "third-party warning strings must not enter the durable Jobs database");
  await tracker.advance("timeline",{artifactLedger:{kind:"narration",beats:[{id:"opening",sha256:"a".repeat(64),samples:48000}]}});
  assert.equal(scheduler.calls.find(x=>x.path.endsWith("/node-4/succeed"))?.body.output.artifactLedger.beats[0].sha256,
    "a".repeat(64));
  await tracker.advance("captions",{artifactLedger:{kind:"sound-mix",masterSha256:"a".repeat(64),samples:48000}});
  await tracker.advance("rendering",{artifactLedger:{kind:"captions",sha256:"a".repeat(64),bytes:180}});
  assert.deepEqual(scheduler.nodes.slice(0,8).map(x=>x.state),Array(8).fill("SUCCEEDED"));
  await tracker.advance("thumbnails",{artifactLedger:{kind:"scene-render",planHash:"b".repeat(64),
    segments:[{sha256:"c".repeat(64),startFrame:0,frameCount:150}]}});
  await tracker.advance("mux",{artifactLedger:{kind:"thumbnails",concepts:[1,2,3].map(i=>({
    id:`thumbnail-${i}`,sha256:"a".repeat(64),sourceSha256:"b".repeat(64)}))}});
  await tracker.advance("qa",{artifactLedger:{kind:"final-mux",artifacts:{video:"d".repeat(64)}}});
  await tracker.advance("review",{artifactLedger:{kind:"technical-qa",technicalPass:true,manifestHash:"e".repeat(64)}});
  await tracker.complete({artifactLedger:{kind:"export-package",manifestHash:"e".repeat(64),
    artifacts:{video:"d".repeat(64)}}});
  assert.equal(scheduler.calls.find(x=>x.path.endsWith("/node-8/succeed"))?.body.output.artifactLedger.segments[0].startFrame,0);
  assert.equal(scheduler.calls.find(x=>x.path.endsWith("/node-12/succeed"))?.body.output.artifactLedger.manifestHash,"e".repeat(64));
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
  const output=scheduler.calls.find(x=>x.path.endsWith("/node-4/succeed")).body.output;
  assert.equal(JSON.stringify(output).includes("private"),false);
  assert.deepEqual(output.artifactLedger.beats[0],{id:"opening",sha256:"c".repeat(64),samples:48000});
  await assert.rejects(tracker.complete({artifactLedger:{kind:"export-package",manifestHash:"/tmp/master"}}),/Jobs artifact hash/);
  assert.equal(scheduler.nodes.at(-1).state,"PENDING","invalid export output must not complete the remaining DAG");
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

test("an interrupted RUNNING production reclaims only the READY stage after recovery",async()=>{
  const productionId="production-"+"a".repeat(24),revision="restart-1",calls=[];
  const nodes=PRODUCTION_NODES.map((nodeKey,index)=>({id:`node-${index}`,nodeKey,
    input:{productionId,revision,runId:FIRST_RUN},state:index<4?"SUCCEEDED":index===4?"READY":"PENDING"}));
  const fetcher=async(url,init)=>{
    const path=new URL(url).pathname;calls.push({path,body:init?.body?JSON.parse(init.body):null});
    if(path==="/api/jobs")return Response.json({created:false,job:{id:"restarted",state:"RUNNING"},nodes});
    if(path==="/api/jobs/restarted/nodes/node-4/start"){
      nodes[4].state="RUNNING";return Response.json({attempt:{id:"new-attempt"}});
    }
    if(path==="/api/jobs/restarted/nodes/node-4/succeed"){
      nodes[4].state="SUCCEEDED";nodes[5].state="READY";
      return Response.json({job:{id:"restarted",state:"RUNNING"},nodes});
    }
    if(path==="/api/jobs/restarted/nodes/node-5/start")return Response.json({attempt:{id:"next-attempt"}});
    throw Error(`Unexpected ${path}`);
  };
  const tracker=createProductionJobTracker({fetcher});
  assert.equal(await tracker.start({productionId,revision,runId:RETRY_RUN}),"restarted");
  assert.equal(tracker.priorRunId,FIRST_RUN);
  await tracker.advance("timeline",{artifactLedger:{kind:"narration",beats:[{
    id:"opening",sha256:"a".repeat(64),samples:48000}]}});
  assert.deepEqual(calls.map(item=>item.path),["/api/jobs",
    "/api/jobs/restarted/nodes/node-4/start", "/api/jobs/restarted/nodes/node-4/succeed",
    "/api/jobs/restarted/nodes/node-5/start"]);
  assert.deepEqual(nodes.slice(0,5).map(node=>node.state),Array(5).fill("SUCCEEDED"));
});

test("only one competing worker can claim a recovered stage",async()=>{
  const productionId="production-"+"a".repeat(24),revision="race-1";
  const nodes=PRODUCTION_NODES.map((nodeKey,index)=>({id:`node-${index}`,nodeKey,
    input:{productionId,revision,runId:FIRST_RUN},state:index===0?"READY":"PENDING"}));
  let claims=0;
  const fetcher=async(url)=>{
    if(new URL(url).pathname==="/api/jobs")return Response.json({created:false,job:{id:"claimed",state:"RUNNING"},nodes});
    if(++claims===1){nodes[0].state="RUNNING";return Response.json({attempt:{id:"worker-one"}});}
    return Response.json({error:{message:"Node is already claimed"}},{status:409});
  };
  const a=createProductionJobTracker({fetcher}),b=createProductionJobTracker({fetcher});
  const outcomes=await Promise.allSettled([a.start({productionId,revision,runId:RETRY_RUN}),
    b.start({productionId,revision,runId:RETRY_RUN})]);
  assert.deepEqual(outcomes.map(item=>item.status).sort(),["fulfilled","rejected"]);
  assert.equal(claims,2,"both workers may attempt to claim, but the scheduler permits only one");
});

test("cancelled Jobs cannot later claim a successful video export",async()=>{
  const fake=fakeScheduler(),tracker=createProductionJobTracker({fetcher:fake.fetcher});
  await tracker.start({productionId:"production-"+"a".repeat(24),revision:"cancel-1",runId:FIRST_RUN});
  await tracker.cancel();
  await assert.rejects(tracker.complete(),/cancelled/u);
  assert.equal(fake.calls.filter(call=>call.path.endsWith("/succeed")).length,0);
});

test("individual scene Jobs reserve attempts, persist hashes, retry and cancel independently",async()=>{
  const base=fakeScheduler(),records=new Map(),calls=base.calls;
  const fetcher=async(url,init)=>{
    const path=new URL(url).pathname,body=init?.body?JSON.parse(init.body):null;
    if(path==="/api/jobs"&&body?.idempotencyKey?.startsWith("video-scene:")){
      calls.push({path,body});
      let row=records.get(body.idempotencyKey);
      if(!row){row={jobId:`scene-job-${records.size}`,nodeId:`scene-node-${records.size}`,
        state:"READY",attempts:0,output:null,request:body};records.set(body.idempotencyKey,row);
        return Response.json({created:true,job:{id:row.jobId,state:"RUNNING"},
          nodes:[{id:row.nodeId,nodeKey:body.nodes[0].nodeKey,state:row.state}]});}
      return Response.json({created:false,job:{id:row.jobId,state:row.state==="FAILED"?"FAILED":"RUNNING"},
        nodes:[{id:row.nodeId,nodeKey:row.request.nodes[0].nodeKey,state:row.state}]});
    }
    const row=[...records.values()].find(r=>path.startsWith(`/api/jobs/${r.jobId}/`));
    if(!row)return base.fetcher(url,init);
    calls.push({path,body});
    if(path.endsWith("/start")){
      if(row.state!=="READY")return Response.json({error:"already claimed"},{status:409});
      row.state="RUNNING";row.attempts++;
      return Response.json({attempt:{id:`attempt-${row.jobId}-${row.attempts}`}});
    }
    if(path.endsWith("/succeed")){
      assert.equal(body.attemptId,`attempt-${row.jobId}-${row.attempts}`);
      row.state="SUCCEEDED";row.output=body.output;
      return Response.json({job:{state:"SUCCEEDED"}});
    }
    if(path.endsWith("/fail")){
      row.state="FAILED";return Response.json({job:{state:"FAILED"}});
    }
    if(path.endsWith("/retry")){
      row.state="READY";return Response.json({job:{id:row.jobId,state:"RUNNING"},
        nodes:[{id:row.nodeId,nodeKey:row.request.nodes[0].nodeKey,state:"READY"}]});
    }
    if(path.endsWith("/cancel")){
      row.state="CANCELLED";return Response.json({job:{state:"CANCELLED"}});
    }
    throw Error(`unexpected ${path}`);
  };
  const tracker=createProductionJobTracker({fetcher});
  await tracker.start({productionId:"production-"+"a".repeat(24),revision:"revision-1",runId:FIRST_RUN});
  const a={kind:"narration-scene",sceneId:"intro",fingerprint:"a".repeat(64)};
  const b={kind:"render-segment",sceneId:"segment-00000",fingerprint:"b".repeat(64)};
  const photo={kind:"asset-download",sceneId:"intro",fingerprint:"e".repeat(64)};
  const token=await tracker.beginScene(a);
  await assert.rejects(tracker.beginScene(a),/already claimed/i);
  await tracker.completeScene(token,{sha256:"c".repeat(64),samples:48000,reused:false});
  const first=[...records.values()][0];
  assert.deepEqual(first.output,{sha256:"c".repeat(64),samples:48000,reused:false});
  assert.equal(first.request.nodes[0].input.runId,FIRST_RUN);
  assert.ok(!JSON.stringify(first.request).includes("/tmp/"));
  const failedToken=await tracker.beginScene(b);
  await tracker.failScene(failedToken,new Error("worker exited"));
  const retried=await tracker.beginScene(b);
  assert.equal([...records.values()][1].attempts,2);
  await tracker.completeScene(retried,{sha256:"d".repeat(64),frameCount:150});
  const photoToken=await tracker.beginScene(photo);
  assert.equal([...records.values()][2].request.jobKind,"video-asset-download");
  await tracker.completeScene(photoToken,{sha256:"e".repeat(64)});
  const orphan=await tracker.beginScene({...b,sceneId:"segment-00001"});
  await assert.rejects(tracker.complete(),/scene work is still claimed/i);
  await tracker.cancel();
  assert.ok(records.size===4&&[...records.values()][3].state==="CANCELLED");
  await assert.rejects(tracker.completeScene(orphan,{sha256:"d".repeat(64)}),/active scene/i);
  assert.equal(base.calls.filter(item=>item.path==="/api/jobs/job-test/cancel").length,1);
});

test("cancelling during scene submission leaves no unclaimed child job running",async()=>{
  const base=fakeScheduler(),events=[];
  let releaseSubmission,submitted;
  const waiting=new Promise(resolve=>submitted=resolve);
  const fetcher=async(url,init)=>{
    const path=new URL(url).pathname,body=init?.body?JSON.parse(init.body):null;
    if(path==="/api/jobs"&&body?.jobKind==="video-narration-scene"){
      submitted();
      return new Promise(resolve=>{releaseSubmission=()=>resolve(Response.json({created:true,
        job:{id:"late-child",state:"RUNNING"},nodes:[{id:"late-node",nodeKey:"narration-scene",state:"READY"}]}));});
    }
    if(path==="/api/jobs/late-child/cancel"){
      events.push("child-cancelled");return Response.json({job:{state:"CANCELLED"}});
    }
    if(path.includes("late-child")&&path.endsWith("/start"))throw Error("cancelled scene must not claim a worker");
    return base.fetcher(url,init);
  };
  const tracker=createProductionJobTracker({fetcher});
  await tracker.start({productionId:"production-"+"a".repeat(24),revision:"r1",runId:FIRST_RUN});
  const pending=tracker.beginScene({kind:"narration-scene",sceneId:"opening",fingerprint:"c".repeat(64)});
  await waiting;
  await tracker.cancel();
  releaseSubmission();
  await assert.rejects(pending,/cancelled/u);
  assert.deepEqual(events,["child-cancelled"]);
});

test("cancelling after the server reserved a scene aborts before media generation",async()=>{
  const base=fakeScheduler(),events=[];
  let releaseStart,startRequested;
  const waiting=new Promise(resolve=>startRequested=resolve);
  const fetcher=async(url,init)=>{
    const path=new URL(url).pathname,body=init?.body?JSON.parse(init.body):null;
    if(path==="/api/jobs"&&body?.jobKind==="video-render-segment")return Response.json({created:true,
      job:{id:"late-child",state:"RUNNING"},nodes:[{id:"late-node",nodeKey:"render-segment",state:"READY"}]});
    if(path.endsWith("late-node/start")){
      startRequested();return new Promise(resolve=>{releaseStart=()=>resolve(Response.json({attempt:{id:"reserved"}}));});
    }
    if(path==="/api/jobs/late-child/cancel"){
      events.push("child-cancelled");return Response.json({job:{state:"CANCELLED"}});
    }
    return base.fetcher(url,init);
  };
  const tracker=createProductionJobTracker({fetcher});
  await tracker.start({productionId:"production-"+"a".repeat(24),revision:"r2",runId:FIRST_RUN});
  const pending=tracker.beginScene({kind:"render-segment",sceneId:"segment-00000",fingerprint:"d".repeat(64)});
  await waiting;
  await tracker.cancel();
  releaseStart();
  await assert.rejects(pending,/cancelled/u);
  assert.deepEqual(events,["child-cancelled"]);
});
