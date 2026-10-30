import test from "node:test";
import assert from "node:assert/strict";
import {withPexelsAssetImportJob} from "./asset-import-jobs.mjs";

function fakeScheduler(){
  const jobs=new Map(),calls=[];
  const fetcher=async(input,init)=>{
    const path=new URL(String(input)).pathname;calls.push({path,body:init.body?JSON.parse(init.body):null});
    const reply=(body,status=200)=>Response.json(body,{status});
    if(path==="/api/jobs"){
      const spec=JSON.parse(init.body),key=spec.idempotencyKey;
      let saved=jobs.get(key),created=false;
      if(!saved){created=true;saved={job:{id:`job-${jobs.size+1}`,state:"RUNNING"},
        nodes:[{id:`node-${jobs.size+1}`,nodeKey:"asset-download",state:"READY"}],spec,attempts:0};
        jobs.set(key,saved);}
      return reply({created,job:saved.job,nodes:saved.nodes});
    }
    const job=[...jobs.values()].find(value=>path.includes(`/${value.job.id}/`));
    if(!job)return reply({error:"not found"},404);
    const node=job.nodes[0];
    if(path.endsWith("/recover-stale"))return reply({job:job.job,nodes:job.nodes});
    if(path.endsWith("/retry")){
      job.job.state="RUNNING";node.state="READY";return reply({job:job.job,nodes:job.nodes});
    }
    if(path.endsWith("/cancel")){
      job.job.state="CANCELLED";node.state="CANCELLED";
      return reply({job:job.job,nodes:job.nodes});
    }
    if(path.endsWith("/start")){
      if(node.state!=="READY")return reply({error:"Node is not ready"},409);
      node.state="RUNNING";job.attempts++;
      return reply({attempt:{id:`attempt-${job.attempts}`}},201);
    }
    if(path.endsWith("/heartbeat"))return reply({alive:node.state==="RUNNING"});
    if(path.endsWith("/succeed")){
      node.state="SUCCEEDED";job.job.state="SUCCEEDED";return reply({job:job.job,nodes:job.nodes});
    }
    if(path.endsWith("/fail")){
      node.state=job.attempts<3?"READY":"FAILED";
      if(node.state==="FAILED")job.job.state="FAILED";
      return reply({job:job.job,nodes:job.nodes});
    }
    return reply({error:"unexpected route"},404);
  };
  return {fetcher,jobs,calls};
}

const input={projectId:"project-1",shotId:"scene-1",assetType:"photo",
  sourceUrl:"https://www.pexels.com/photo/forest-123456/",confirmRights:true};
const imported={provider:"pexels",assetId:"123456",shotId:input.shotId,assetType:"photo",sourceUrl:input.sourceUrl,
  sha256:"a".repeat(64),sizeBytes:2048};

test("a website import claims an independent durable Jobs attempt and verifies reuse",async()=>{
  const scheduler=fakeScheduler();let imports=0,approved=[];
  const opts={fetcher:scheduler.fetcher,lookup:async()=>approved,
    importer:async()=>{imports++;approved=[imported];return imported;}};
  const first=await withPexelsAssetImportJob(input,opts);
  assert.equal(first.jobId,"job-1");assert.equal(first.reused,false);
  assert.equal(scheduler.calls.filter(x=>x.path.endsWith("/start")).length,1);
  assert.equal(scheduler.calls.filter(x=>x.path.endsWith("/succeed")).length,1);
  assert.equal(scheduler.jobs.size,1);
  const second=await withPexelsAssetImportJob(input,opts);
  assert.equal(second.reused,true);assert.equal(second.sha256,imported.sha256);
  assert.equal(imports,1,"a successful verified media file is never downloaded again");
  assert.equal(scheduler.jobs.size,1);
});

test("failed website imports persist errors and retry without a duplicate Jobs row",async()=>{
  const scheduler=fakeScheduler();let attempts=0;
  const opts={fetcher:scheduler.fetcher,lookup:async()=>[],importer:async()=>{
    if(++attempts===1)throw Error("external provider contained a secret");return imported;
  }};
  await assert.rejects(withPexelsAssetImportJob(input,opts),/external provider/);
  const failed=scheduler.calls.find(x=>x.path.endsWith("/fail"));
  assert.equal(failed.body.errorCode,"asset_download_failed");
  assert.doesNotMatch(failed.body.errorDetail,/secret/);
  assert.equal((await withPexelsAssetImportJob(input,opts)).reused,false);
  assert.equal(attempts,2);assert.equal(scheduler.jobs.size,1);
});

test("a successful Job with damaged cache uses a bounded, separate repair attempt",async()=>{
  const scheduler=fakeScheduler();let imports=0,healthy=false;
  const opts={fetcher:scheduler.fetcher,lookup:async()=>healthy?[imported]:[],
    importer:async()=>{imports++;return imported;}};
  await withPexelsAssetImportJob(input,opts);
  assert.equal(imports,1);
  assert.equal(scheduler.jobs.size,1);
  const repaired=await withPexelsAssetImportJob(input,opts);
  assert.equal(repaired.jobId,"job-2","damage must not mutate the completed Jobs attempt");
  assert.equal(imports,2);
  healthy=true;
  assert.equal((await withPexelsAssetImportJob(input,opts)).reused,true);
  assert.equal(imports,2);
  assert.equal(scheduler.jobs.size,2);
});

test("simultaneous website requests cannot steal a live claim or download twice",async()=>{
  const scheduler=fakeScheduler();let startDownload=()=>{},downloads=0;
  const block=new Promise(resolve=>{startDownload=resolve;});
  const opts={fetcher:scheduler.fetcher,lookup:async()=>[],importer:async()=>{
    downloads++;await block;return imported;
  }};
  const first=withPexelsAssetImportJob(input,opts);
  for(let attempt=0;attempt<300&&downloads===0;attempt++)await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(downloads,1,"the first request must claim the worker before the duplicate submission");
  await assert.rejects(withPexelsAssetImportJob(input,opts),/already being prepared/i);
  startDownload();await first;
  assert.equal(downloads,1);assert.equal(scheduler.jobs.size,1);
});

test("client cancellation stops the import and persists a cancelled Jobs state",async()=>{
  const scheduler=fakeScheduler(),stop=new AbortController();let importing=false;
  const task=withPexelsAssetImportJob(input,{fetcher:scheduler.fetcher,signal:stop.signal,
    lookup:async()=>[],importer:async(_input,{signal})=>{
      importing=true;
      return new Promise((resolve,reject)=>signal.addEventListener("abort",()=>
        reject(signal.reason??Error("cancelled")),{once:true}));
    }});
  for(let attempt=0;attempt<300&&!importing;attempt++)await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(importing,true,"the worker must start before cancellation");
  stop.abort(Error("Editor closed the download"));
  await assert.rejects(task,/Editor closed/);
  assert.equal([...scheduler.jobs.values()][0].job.state,"CANCELLED");
  assert.equal(scheduler.calls.filter(x=>x.path.endsWith("/cancel")).length,1);
  assert.equal(scheduler.calls.filter(x=>x.path.endsWith("/succeed")).length,0);
});

test("invalid paths, licenses and media types cause no Jobs requests",async()=>{
  const scheduler=fakeScheduler();
  const opts={fetcher:scheduler.fetcher,lookup:async()=>[],importer:async()=>imported};
  for(const invalid of [{...input,projectId:"../secret"},{...input,sourceUrl:"https://evil.invalid/photo/123/"},
    {...input,assetType:"video",sourceUrl:input.sourceUrl},{...input,confirmRights:false}])
    await assert.rejects(withPexelsAssetImportJob(invalid,opts));
  assert.equal(scheduler.calls.length,0);
});
