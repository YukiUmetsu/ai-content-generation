import test from "node:test";
import assert from "node:assert/strict";
import {generateDiscoveryCandidates} from "./discovery-candidates.mjs";

const sample={projectName:"House Math",description:"The economics of owning and maintaining a house",
  keywords:[{kind:"topic",text:"Home insurance costs"}],content:[],graph:{nodes:[],signals:[],sources:[{
    id:"source-home",provider:"youtube-data-api",title:"Insurance costs explained",publishedAt:"2026-09-01",evidenceState:"lead_only",
    url:"https://www.youtube.com/watch?v=abcABC12345"}]}};
const candidate={title:"Why Home Insurance Costs Rise",hook:"How insurance premiums are determined",
  premise:"Explain the costs and risk factors affecting homeowner insurance premiums",whyNow:"Evergreen housing cost question",
  angleKey:"home-insurance-premium-factors",sourceIds:["source-home"],confidence:"low"};
const success=()=>({ok:true,text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify({candidates:[candidate]})}}]})});
const modelSettings={endpoint:"http://127.0.0.1:11434/v1/chat/completions",model:"mock"};

test("discovery candidate generation retries transient local HTTP failures",async()=>{
  let attempts=0;
  const rows=await generateDiscoveryCandidates(sample,{modelSettings,sleep:async()=>{},transport:async()=>{
    attempts++;
    return attempts===1?{ok:false,status:503}:success();
  }});
  assert.equal(attempts,2);
  assert.equal(rows[0].angleKey,"home-insurance-premium-factors");
});

test("discovery candidate generation retries temporary local transport failure",async()=>{
  let attempts=0;
  const rows=await generateDiscoveryCandidates(sample,{modelSettings,sleep:async()=>{},transport:async()=>{
    attempts++;
    if(attempts===1)throw new TypeError("fetch failed");
    return success();
  }});
  assert.equal(attempts,2);
  assert.equal(rows.length,1);
});

test("discovery candidate generation changes to a configured second local model after invalid output",async()=>{
  const models=[];
  const rows=await generateDiscoveryCandidates(sample,{modelSettings:{primary:{...modelSettings,model:"primary"},
    secondary:{...modelSettings,model:"backup"}},sleep:async()=>{},transport:async(_url,request)=>{
    models.push(JSON.parse(request.body).model);
    return models.length===1?{ok:true,text:async()=>JSON.stringify({choices:[{message:{content:"{"}}]})}:success();
  }});
  assert.deepEqual(models,["primary","backup"]);
  assert.equal(rows.length,1);
});

test("discovery candidate generation does not retry authentication or malformed endpoint failure",async()=>{
  let attempts=0;
  await assert.rejects(generateDiscoveryCandidates(sample,{modelSettings,sleep:async()=>{},transport:async()=>{
    attempts++;
    return {ok:false,status:401};
  }}),/401/);
  assert.equal(attempts,1);
});

test("discovery divides many sources into short candidate batches and honors local inference settings",async()=>{
  const calls=[];
  const big={...sample,graph:{...sample.graph,sources:Array.from({length:11},(_,i)=>({
    ...sample.graph.sources[0],id:`source-${i}`,title:`Public report about house costs ${i}`,
  }))}};
  const results=await generateDiscoveryCandidates(big,{modelSettings:{...modelSettings,
    generation:{outlineTokens:1024,timeoutSeconds:75}},sleep:async()=>{},transport:async(_url,options)=>{
    const body=JSON.parse(options.body),user=JSON.parse(body.messages[1].content);
    calls.push({body,user});
    return {ok:true,text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify({candidates:[{
      ...candidate,title:`Home Insurance Tradeoffs ${calls.length}`,angleKey:`different-insurance-angle-${calls.length}`,
      sourceIds:[user.sources[0].id],
    }]})}}]})};
  }});
  assert.equal(calls.length,3);
  assert.equal(results.length,3);
  assert.ok(calls.every(call=>call.user.sources.length<=4));
  assert.ok(calls.every(call=>call.body.max_tokens===1024));
  assert.ok(calls.every(call=>call.body.messages[0].content.includes("Maximum 3")));
  assert.ok(calls.every(call=>call.body.temperature>=0&&call.body.temperature<=1));
  assert.ok(calls.every(call=>call.user.knownContent.length<=35));
});

test("repeated temporary model HTTP errors remain identifiable after all retries",async()=>{
  await assert.rejects(generateDiscoveryCandidates(sample,{modelSettings,sleep:async()=>{},
    transport:async()=>({ok:false,status:503})}),/503/);
});

test("candidate jobs checkpoint each four-source batch and resume only the missing local AI work",async()=>{
  const input={...sample,graph:{...sample.graph,sources:Array.from({length:7},(_,index)=>({
    ...sample.graph.sources[0],id:`source-${index}`}))}};
  const saved=new Map(),calls=[];
  let failing=true;
  const options={modelSettings,sleep:async()=>{},readBatch:async index=>saved.get(index),
    saveBatch:async(index,rows)=>{saved.set(index,rows);return rows;},
    transport:async(_endpoint,request)=>{
      const sourceId=JSON.parse(JSON.parse(request.body).messages[1].content).sources[0].id;
      calls.push(sourceId);
      if(failing&&sourceId==="source-4")return {ok:false,status:503};
      return {ok:true,text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify({candidates:[{
        ...candidate,title:`Costs explained using ${sourceId}`,angleKey:`insurance-cost-angle-${sourceId}`,
        sourceIds:[sourceId],
      }]})}}]})};
    }};
  await assert.rejects(generateDiscoveryCandidates(input,options),/503/);
  assert.deepEqual([...saved.keys()],[0]);
  failing=false;
  const result=await generateDiscoveryCandidates(input,options);
  assert.equal(result.length,2);
  assert.equal(calls.filter(source=>source==="source-0").length,1,"Previously completed batch must not rerun");
  assert.equal(saved.size,2);
});
