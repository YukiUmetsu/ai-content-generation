import test from "node:test";
import assert from "node:assert/strict";
import {withLocalInference,createLocalInferenceGate} from "./local-inference-gate.mjs";
import {generateProjectKeywords} from "./project-keyword-generator.mjs";

test("cancelled queued task never releases the active producer's model slot",async()=>{
  let finishA;
  let beganA=false,beganC=false;
  const a=withLocalInference(()=>{beganA=true;return new Promise(resolve=>{finishA=resolve;});});
  const bController=new AbortController();
  const b=withLocalInference(async()=>"B",bController.signal);
  const c=withLocalInference(async()=>{beganC=true;return "C";});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(beganA,true);
  bController.abort(Error("cancelled B"));
  await assert.rejects(b,/cancelled B/);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(beganC,false,"C must remain queued until A really completes");
  finishA("A");
  assert.equal(await a,"A");
  assert.equal(await c,"C");
});

test("aborting an unresponsive active producer rejects the caller but retains the model slot",async()=>{
  const controller=new AbortController();
  let began=false,finishProducer,ranNext=false;
  const waiting=withLocalInference(async()=>{began=true;return new Promise(resolve=>{finishProducer=resolve;});},controller.signal);
  for(let attempt=0;!began&&attempt<20;attempt++)await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(began,true);
  const next=withLocalInference(async()=>{ranNext=true;return "next job completed";});
  controller.abort(Error("cancelled"));
  await assert.rejects(waiting,/cancelled/);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(ranNext,false,"abort is not proof the provider stopped using resources");
  finishProducer("provider finally stopped");
  assert.equal(await next,"next job completed");
});

test("the shared inference slot stays locked until the first model response body finishes",async()=>{
  const modelSettings={endpoint:"http://127.0.0.1:1234/v1/chat/completions",model:"test-local"};
  const input={name:"House Math",description:"Cost of maintaining and insuring a home",keywords:[]};
  const response=JSON.stringify({choices:[{message:{content:JSON.stringify({suggestions:[
    {text:"How roof replacement estimates change with materials",kind:"topic",rationale:"Home maintenance cost"}
  ]})}}]});
  let releaseBody,secondStarted=false;
  const first=generateProjectKeywords(input,{modelSettings,targetCount:1,transport:async()=>({ok:true,
    headers:{get:()=>null},text:()=>new Promise(resolve=>{releaseBody=resolve;})})});
  for(let i=0;i<20&&!releaseBody;i++)await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(typeof releaseBody,"function","first producer must have started reading the response");
  const second=generateProjectKeywords(input,{modelSettings,targetCount:1,transport:async()=>{
    secondStarted=true;return {ok:true,headers:{get:()=>null},text:async()=>response};
  }});
  await new Promise(resolve=>setTimeout(resolve,5));
  const startedBeforeBody=secondStarted;
  releaseBody(response);
  assert.equal((await first).suggestions.length,1);
  assert.equal((await second).suggestions.length,1);
  assert.equal(secondStarted,true);
  assert.equal(startedBeforeBody,false,"headers are not proof that inference has finished");
});

test("isolated test workers cannot retain the production inference slot",async()=>{
  const blocked=createLocalInferenceGate();
  const other=createLocalInferenceGate();
  let release;
  const first=blocked(()=>new Promise(resolve=>{release=resolve;}));
  while(!release)await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(await other(async()=>"independent"),"independent");
  release("done");
  assert.equal(await first,"done");
});
