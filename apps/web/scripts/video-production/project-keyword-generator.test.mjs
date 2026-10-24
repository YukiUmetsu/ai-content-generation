import { test } from "node:test";
import assert from "node:assert/strict";
import { generateProjectKeywords, validateKeywordSuggestions } from "./project-keyword-generator.mjs";

test("project keywords reject duplicate, oversized, unrelated and unsafe candidates", () => {
  assert.throws(() => validateKeywordSuggestions([{text:"roof replacement costs",kind:"topic",rationale:"Cost breakdown"},
    {text:" ROOF  REPLACEMENT COSTS ",kind:"topic",rationale:"Same"}]), /duplicate/i);
  assert.throws(() => validateKeywordSuggestions([{text:"A".repeat(180),kind:"topic",rationale:"nope"}]), /keyword/i);
  assert.throws(() => validateKeywordSuggestions([{text:"generic",kind:"other",rationale:"nope"}]), /kind/i);
});

test("blank description and no seed keywords require context", async () => {
  await assert.rejects(generateProjectKeywords({name:"House Math",description:"",keywords:[]},{modelSettings:{endpoint:"http://localhost:1234/v1",model:"mock"},transport:()=>{throw Error("should not call model");}}),/description|context/i);
});

test("local model retries incomplete JSON, accepts distinct home-cost phrases without activating them", async () => {
  let calls=0;
  const transport=async (_url,opts) => {
    calls++;
    const body=JSON.parse(opts.body);
    assert.match(body.messages[0].content,/homeownership|project/i);
    return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({choices:[{message:{content:calls===1?"{bad":
      JSON.stringify({suggestions:[{text:"Home insurance premium increases",kind:"topic",rationale:"Core household expense"},
        {text:"Roof replacement cost factors",kind:"query",rationale:"Home maintenance decision"}]})}}]})};
  };
  const result=await generateProjectKeywords({name:"House Math",description:"The economics of owning and maintaining a home",keywords:["Property tax costs"]},
    {modelSettings:{endpoint:"http://127.0.0.1:1234/v1/chat/completions",model:"mock"},transport,sleep:async()=>{}});
  assert.equal(calls,2);
  assert.equal(result.suggestions.length,2);
  assert.equal(result.suggestions[0].kind,"topic");
});

test("keyword generation retries temporary local model transport and 503 errors",async()=>{
  let calls=0;
  const transport=async()=>{
    calls++;
    if(calls===1)throw new TypeError("fetch failed");
    if(calls===2)return {ok:false,status:503,headers:{get:()=>null}};
    return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify({
      suggestions:[{text:"Home insurance coverage costs",kind:"topic",rationale:"Core insurance question"}]
    })}}]})};
  };
  const response=await generateProjectKeywords({name:"House Math",description:"Homeowner costs",keywords:[]},
    {modelSettings:{endpoint:"http://127.0.0.1:11434/v1/chat/completions",model:"mock"},transport,sleep:async()=>{}});
  assert.equal(calls,3);
  assert.equal(response.suggestions.length,1);
});

test("truncated local replies retry with a smaller keyword request",async()=>{
  const requested=[];
  const transport=async (_url,options)=>{
    const body=JSON.parse(options.body);
    const instruction=body.messages.map(message=>message.content).join("\n");
    const match=instruction.match(/Propose (\d+) distinct/u);
    requested.push(Number(match?.[1]??(instruction.includes("Propose 5–12 distinct")?5:NaN)));
    return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({choices:[{
      finish_reason:requested.at(-1)>2?"length":"stop",
      message:{content:requested.at(-1)>2?' {"suggestions":[{"text":"Home cost':
        JSON.stringify({suggestions:[{text:"Homeowners insurance renewal costs",kind:"topic",rationale:"Answers a focused cost question"},
          {text:"Roof repair or replacement cost",kind:"query",rationale:"Addresses maintenance decisions"}]})}
    }]})};
  };
  const result=await generateProjectKeywords({name:"House Math",description:"The economics of owning and maintaining a home",keywords:[]},
    {modelSettings:{endpoint:"http://127.0.0.1:1234/v1/chat/completions",model:"mock"},transport,sleep:async()=>{}});
  assert.equal(result.suggestions.length,2);
  assert.ok(requested[0]>requested.at(-1),`Expected smaller retry, got ${requested.join(", ")}`);
});

test("local model JSON wrapped in a markdown fence still validates normally",async()=>{
  let calls=0;
  const transport=async()=>{
    calls++;
    return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({choices:[{message:{content:
      '```json\n{"suggestions":[{"text":"Home maintenance budgeting","kind":"topic","rationale":"A recurring homeowner concern"}]}\n```'}}]})};
  };
  const result=await generateProjectKeywords({name:"House Math",description:"Household ownership expenses",keywords:[]},
    {modelSettings:{endpoint:"http://127.0.0.1:1234/v1/chat/completions",model:"mock"},transport,sleep:async()=>{}});
  assert.equal(calls,1);
  assert.equal(result.suggestions[0].text,"Home maintenance budgeting");
});
