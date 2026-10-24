import test from "node:test";
import assert from "node:assert/strict";

const debugModule=()=>import("./research-ai-debug.mjs").catch(()=>null);
const context=(overrides={})=>({jobId:"job_"+"a".repeat(24),stage:"scene:2",
  currentStep:"visual:2:elements",model:"qwen3.5-9b:gguf:q4",attempt:2,...overrides});
const schemaError=(field="visualElements")=>Object.assign(Error("private passage must not be logged"),{
  code:"schema_invalid",field});

test("schema-invalid model response is logged as one escaped, correlated entry when enabled",async()=>{
  const debug=await debugModule();assert.ok(debug?.withModelDebugContext);assert.ok(debug?.captureModelOutput);
  const entries=[];
  const raw='{\n  "visualElements": [{"label": "Panel\\u001b[31m"}]\n}';
  await assert.rejects(debug.withModelDebugContext(context(),async()=>{
    debug.captureModelOutput(raw);
    throw schemaError();
  },{enabled:true,log:(...args)=>entries.push(args)}),error=>error.code==="schema_invalid");
  assert.equal(entries.length,1);
  assert.equal(entries[0][0],"[contentgen-ai-schema-error]");
  const payload=JSON.parse(entries[0][1]);
  assert.equal(payload.jobId,"job_"+"a".repeat(24));
  assert.equal(payload.stage,"scene:2");
  assert.equal(payload.currentStep,"visual:2:elements");
  assert.equal(payload.model,"qwen3.5-9b:gguf:q4");
  assert.equal(payload.attempt,2);
  assert.equal(payload.field,"visualElements");
  assert.equal(payload.output,raw);
  assert.equal(payload.truncated,false);
  assert.ok(!entries[0][1].includes("private passage"));
  assert.ok(!entries[0][1].includes("Authorization"));
  assert.equal(entries[0][1].split("\n").length,1);
});

test("disabled mode captures nothing, and success or non-schema errors never log",async()=>{
  const debug=await debugModule();assert.ok(debug?.withModelDebugContext);
  const entries=[];
  for(const scenario of ["disabled", "success", "network"]){
    const action=async()=>{
      debug.captureModelOutput('{"private":"source passage"}');
      if(scenario==="disabled")throw schemaError();
      if(scenario==="network")throw Object.assign(Error("down"),{code:"provider_unavailable"});
      return "ok";
    };
    if(scenario==="success")assert.equal(await debug.withModelDebugContext(context(),action,
      {enabled:true,log:(...args)=>entries.push(args)}),"ok");
    else await assert.rejects(debug.withModelDebugContext(context(),action,
      {enabled:scenario!=="disabled",log:(...args)=>entries.push(args)}));
  }
  assert.deepEqual(entries,[]);
});

test("oversized UTF-8 responses are capped at 16 KiB and marked truncated",async()=>{
  const debug=await debugModule();assert.ok(debug?.withModelDebugContext);
  const entries=[];
  await assert.rejects(debug.withModelDebugContext(context(),async()=>{
    debug.captureModelOutput("💡".repeat(10000));
    throw schemaError();
  },{enabled:true,log:(...args)=>entries.push(args)}));
  const payload=JSON.parse(entries[0][1]);
  assert.equal(payload.truncated,true);
  assert.ok(Buffer.byteLength(payload.output,"utf8")<=16*1024);
});

test("overlapping attempts never mix outputs and both schema failures remain logged",async()=>{
  const debug=await debugModule();assert.ok(debug?.withModelDebugContext);
  const entries=[];
  let firstReady;const ready=new Promise(resolve=>{firstReady=resolve;});
  let resumeFirst;const hold=new Promise(resolve=>{resumeFirst=resolve;});
  const log=(...args)=>entries.push(args);
  const first=debug.withModelDebugContext(context({attempt:1}),async()=>{
    debug.captureModelOutput('"first response"');firstReady();await hold;throw schemaError();
  },{enabled:true,log});
  await ready;
  const second=debug.withModelDebugContext(context({attempt:2}),async()=>{
    debug.captureModelOutput('"second response"');throw schemaError();
  },{enabled:true,log});
  resumeFirst();
  await Promise.allSettled([first,second]);
  assert.equal(entries.length,2);
  const byAttempt=new Map(entries.map(([,json])=>{const value=JSON.parse(json);return [value.attempt,value.output];}));
  assert.equal(byAttempt.get(1),'"first response"');
  assert.equal(byAttempt.get(2),'"second response"');
});
