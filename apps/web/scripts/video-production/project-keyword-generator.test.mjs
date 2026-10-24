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
