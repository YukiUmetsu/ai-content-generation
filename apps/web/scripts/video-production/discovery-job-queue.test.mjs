import { test } from "node:test";
import assert from "node:assert/strict";
import { createDiscoveryJobManager } from "./discovery-job-queue.mjs";

test("no five-idea job exists before click; rapid duplicate clicks share run and result survives refresh", async () => {
  const runs = new Map(); let sequence = 0; let calls=0;
  const backend=async (_id,route,method,body)=>{
    if(route==="discover"&&method==="POST"){
      const active=[...runs.values()].find(x=>["queued","running"].includes(x.status));
      if(active)return structuredClone(active);
      const run={id:`discover_${String(++sequence).padStart(24,"0")}`,projectId:"house",status:"queued",stage:"queued",candidates:[],createdAt:1};runs.set(run.id,run);return structuredClone(run);
    }
    if(route==="keywords")return {keywords:[{text:"roof repair costs",active:true,kind:"topic"}]};
    if(route==="graph")return {nodes:[{id:"node1",kind:"topic",label:"roof repair costs"}],
      sources:[{id:"source1",title:"Roof material prices",url:"https://example.com/roof",provider:"search",evidenceState:"lead_only"}]};
    if(route==="graph/import-market")return {imported:0};
    if(route==="graph/batches")return {imported:body.nodes.length};
    const id=route.split("/")[1];const run=runs.get(id);
    if(route.endsWith("checkpoint")){run.stage=body.stage;run.status="running";return structuredClone(run);}
    if(route.endsWith("finish")){run.status=body.status;run.candidates=body.candidates;return structuredClone(run);}
    if(method==="GET")return structuredClone(run);
    throw Error(`unexpected ${route}`);
  };
  const manager=createDiscoveryJobManager({backend,generate:async()=>{calls++;return [{title:"How Much Does a New Roof Really Cost?",
    hook:"Where does the bill come from?",premise:"Materials, labor and lifespan",whyNow:"Public cost discussion",
    angleKey:"roof installation labor expenses",sourceIds:["source1"],confidence:"medium"}];}});
  assert.equal(runs.size,0);
  const settings={model:"local",endpoint:"http://localhost:1234/v1/chat/completions"};
  const first=await manager.create({projectId:"house",projectName:"House Math",description:"Home ownership economics"},settings);
  const second=await manager.create({projectId:"house",projectName:"House Math",description:"Home ownership economics"},settings);
  assert.equal(first.id,second.id);
  for(let i=0;i<30&&runs.get(first.id).status!=="completed";i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(runs.get(first.id).status,"completed");
  assert.equal(calls,1);
  assert.equal((await manager.get("house",first.id)).candidates.length,1);
});

test("no evidence means an explicit insufficient_evidence outcome, no invented five cards", async () => {
  let run={id:"discover_zero",status:"queued",stage:"queued",candidates:[]};let modelCalls=0;
  const backend=async(_id,route,_method,body)=>{
    if(route==="discover")return {...run};
    if(route==="keywords")return {keywords:[]};
    if(route==="graph")return {nodes:[],sources:[]};
    if(route==="graph/import-market")return {imported:0};
    if(route.endsWith("checkpoint")){run={...run,status:"running",stage:body.stage};return run;}
    if(route.endsWith("finish")){run={...run,status:body.status,candidates:body.candidates};return run;}
  };
  const manager=createDiscoveryJobManager({backend,generate:async()=>{modelCalls++;return []}});
  await manager.create({projectId:"house",projectName:"House Math",description:"Costs of maintaining a home"},
    {model:"local",endpoint:"http://localhost:1234/v1/chat/completions"});
  for(let i=0;i<30&&run.status!=="insufficient_evidence";i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(run.status,"insufficient_evidence"); assert.equal(modelCalls,0); assert.deepEqual(run.candidates,[]);
});
