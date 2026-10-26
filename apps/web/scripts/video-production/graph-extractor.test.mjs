import test from "node:test";
import assert from "node:assert/strict";
import {extractGraphBatch,validateGraphExtraction} from "./graph-extractor.mjs";

const source={id:"kg_source_1",title:"Insurance cost research",url:"https://insurer.example.org/research",
  passage:"Home insurance premiums vary with insured replacement cost and local severe weather exposure. Homeowners should compare coverage terms."};
const edge={fromKind:"topic",fromLabel:"Home insurance premiums",toKind:"topic",toLabel:"Replacement cost",
  relation:"related_to",status:"supported",sourceId:source.id,quote:"Home insurance premiums vary with insured replacement cost and local severe weather exposure."};

test("captured text supports a referenced fact-like graph relationship",()=>{
  const batch=validateGraphExtraction({nodes:[{kind:"topic",label:"Replacement cost"}],edges:[edge]},[source]);
  assert.deepEqual(batch.edges,[edge]);
});

test("unsupported or unrelated passages never become supported relationships",()=>{
  assert.throws(()=>validateGraphExtraction({nodes:[],edges:[{...edge,quote:"Fake research says all insurance premiums tripled this year."}]},[source]),/verbatim|passage/i);
  assert.throws(()=>validateGraphExtraction({nodes:[],edges:[{...edge,sourceId:"foreign-source"}]},[source]),/source/i);
  assert.throws(()=>validateGraphExtraction({nodes:[],edges:[{...edge,relation:"affects"}]},[source]),/causal|affects/i);
  assert.throws(()=>validateGraphExtraction({nodes:[],edges:[{...edge,relation:"raises_question",toKind:"entity"}]},[source]),/relationship|direction/i);
});

test("lead-only source results cannot create asserted graph facts",()=>{
  assert.throws(()=>validateGraphExtraction({nodes:[],edges:[edge]},[{...source,passage:null}]),/captured|passage/i);
});

test("extractor keeps each local model request bounded and retries a malformed response",async()=>{
  let attempts=0;
  const transport=async(_url,opts)=>{
    attempts++;
    const body=JSON.parse(opts.body);
    assert.ok(body.max_tokens<=1800,"Small graph tasks must not overrun a 9B model's response window");
    assert.equal(body.messages[1].content.length<4000,true);
    return {ok:true,text:async()=>JSON.stringify({choices:[{message:{content:attempts===1?"{broken":JSON.stringify({nodes:[],edges:[edge]})}}]})};
  };
  const result=await extractGraphBatch({projectName:"House Math",description:"Economics of home ownership",sources:[source]},
    {modelSettings:{endpoint:"http://127.0.0.1:11434/v1/chat/completions",model:"mock"},transport,sleep:async()=>{}});
  assert.equal(attempts,2);
  assert.equal(result.edges.length,1);
});

test("graph extraction tries a configured secondary local model when the primary returns malformed output",async()=>{
  const attempts=[];
  const result=await extractGraphBatch({projectName:"House Math",description:"Home insurance expenses",sources:[source]},
    {modelSettings:{primary:{endpoint:"http://127.0.0.1:11434/v1/chat/completions",model:"primary"},
      secondary:{endpoint:"http://127.0.0.1:11434/v1/chat/completions",model:"backup"}},sleep:async()=>{},
    transport:async(_url,request)=>{
      const model=JSON.parse(request.body).model;attempts.push(model);
      return {ok:true,text:async()=>JSON.stringify({choices:[{message:{content:model==="primary"?"{":
        JSON.stringify({nodes:[],edges:[edge]})}}]})};
    }});
  assert.deepEqual(attempts,["primary","backup"]);
  assert.equal(result.edges.length,1);
});

test("graph extraction uses the configured local response-token limit",async()=>{
  let seenLimit=0;
  await extractGraphBatch({projectName:"Home Costs",description:"Insurance cost components",sources:[source]},
    {modelSettings:{endpoint:"http://127.0.0.1:11434/v1/chat/completions",model:"local",
      generation:{outlineTokens:2400,sceneTokens:4096,timeoutSeconds:180}},
    transport:async(_url,options)=>{
      seenLimit=JSON.parse(options.body).max_tokens;
      return {ok:true,text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify({nodes:[],edges:[]})}}]})};
    }});
  assert.equal(seenLimit,2400);
});
