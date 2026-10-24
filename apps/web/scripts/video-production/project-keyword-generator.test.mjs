import { test } from "node:test";
import assert from "node:assert/strict";
import * as generator from "./project-keyword-generator.mjs";
const {generateProjectKeywords,qualityKeywordSuggestions,validateKeywordSuggestions}=generator;

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
    {modelSettings:{endpoint:"http://127.0.0.1:1234/v1/chat/completions",model:"mock"},transport,sleep:async()=>{},targetCount:2});
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
    {modelSettings:{endpoint:"http://127.0.0.1:11434/v1/chat/completions",model:"mock"},transport,sleep:async()=>{},targetCount:1});
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
    {modelSettings:{endpoint:"http://127.0.0.1:1234/v1/chat/completions",model:"mock"},transport,sleep:async()=>{},targetCount:3});
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
    {modelSettings:{endpoint:"http://127.0.0.1:1234/v1/chat/completions",model:"mock"},transport,sleep:async()=>{},targetCount:1});
  assert.equal(calls,1);
  assert.equal(result.suggestions[0].text,"Home maintenance budgeting");
});

const item=(text,kind="topic",rationale="Addresses an actual decision facing the viewer")=>({text,kind,rationale});
const reply=suggestions=>({ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({choices:[{
  finish_reason:"stop",message:{content:JSON.stringify({suggestions})}
}]})});

test("quality gate rejects vague topics, prompt-echo reasons, unsupported trends and duplicate intent",()=>{
  const result=qualityKeywordSuggestions([
    item("homeownership economics"),
    item("calculate total cost of ownership","query"),
    item("House Math"),
    item("Why homeowners insurance premiums increase","query","Aligns with project description authority"),
    item("Rising home prices","topic","Popular search trend with high search volume"),
    item("Roof replacement costs"),
    item("Cost of replacing a roof"),
    item("Why home insurance premiums rise","query","Shows factors affecting renewal bills"),
    item("How property taxes change after buying a home","query","Explains reassessment after a purchase"),
  ],{name:"House Math",existing:["Roof replacement cost"]});
  assert.deepEqual(result.suggestions.map(row=>row.text),[
    "Why home insurance premiums rise","How property taxes change after buying a home"
  ]);
  assert.equal(result.rejected,7);
});

test("quality gate does not let exclusion suggestions crowd out useful topics",()=>{
  const result=qualityKeywordSuggestions([
    item("house tour videos","exclusion"),item("real estate agent listings","exclusion"),
    item("luxury mansion walkthroughs","exclusion"),item("Property tax reassessment rules after closing"),
  ],{name:"House Math",existing:[]});
  assert.deepEqual(result.suggestions.map(row=>row.text),[
    "house tour videos","real estate agent listings","Property tax reassessment rules after closing"
  ]);
  assert.equal(result.rejected,1);
});

test("local keyword expansion accumulates 12 distinct specific ideas across topic lenses",async()=>{
  const batches=[
    ["Why homeowner insurance premiums increase","What changes a property tax assessment"],
    ["What determines an HVAC replacement quote","How much should a home emergency fund contain"],
    ["What causes roof replacement estimates to differ","Why foundation repair prices vary"],
    ["Rent versus buy closing costs compared","Gas furnace versus heat pump lifetime expenses"],
    ["New windows versus attic insulation payback","Unexpected fees when refinancing a mortgage"],
    ["Avoiding hidden costs of an older house","What a home inspection cannot reveal"],
  ];
  const facets=[];
  const transport=async(_url,options)=>{
    const request=JSON.parse(options.body);
    const instructions=request.messages[0].content;
    facets.push(instructions);
    assert.match(instructions,/Propose 2 distinct suggestions/i);
    assert.match(request.messages[1].content,/owning and maintaining a home/i);
    const suggestions=batches[facets.length-1]??[];
    return reply(suggestions.map(text=>item(text,text.startsWith("What")||text.startsWith("Why")?"query":"topic")));
  };
  const result=await generateProjectKeywords({name:"House Math",description:"The economics of owning and maintaining a home",keywords:[]},
    {modelSettings:{endpoint:"http://127.0.0.1:1234/v1/chat/completions",model:"mock"},transport,sleep:async()=>{}});
  assert.equal(result.suggestions.length,12);
  assert.equal(facets.length,6);
  assert.equal(new Set(facets).size,6,"each request should explore a distinct intent lens");
  assert.equal(result.quality.partial,false);
  assert.equal(result.quality.evidence,"unverified");
});

test("invalid local keyword batch retries without discarding earlier accepted suggestions",async()=>{
  let calls=0;
  const transport=async()=>{
    calls++;
    if(calls===1)return reply([item("Property tax increases after a home purchase"),
      item("Real cost of maintaining a roof"),item("Home insurance renewal cost drivers")]);
    if(calls===2)return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({choices:[{
      finish_reason:"length",message:{content:'{"suggestions":[{"text":"unfinished'}
    }]})};
    return reply([item("Heat pump versus gas furnace operating costs"),item("How mortgage closing fees add up")]);
  };
  const result=await generateProjectKeywords({name:"House Math",description:"Household ownership costs",keywords:[]},
    {modelSettings:{endpoint:"http://127.0.0.1:1234/v1/chat/completions",model:"mock"},transport,sleep:async()=>{},targetCount:5});
  assert.equal(calls,3);
  assert.equal(result.suggestions.length,5);
  assert.equal(result.suggestions[0].text,"Property tax increases after a home purchase");
  assert.equal(result.quality.modelRequests,3);
});

test("local keyword generator publishes two useful entries before the next inference finishes",async()=>{
  let releaseSecond, calls=0;
  const gate=new Promise(resolve=>{releaseSecond=resolve;});
  const updates=[];
  const transport=async(_url,options)=>{
    const request=JSON.parse(options.body);
    calls++;
    assert.match(request.messages[0].content,/Propose 2 distinct suggestions/i);
    if(calls===2)await gate;
    return reply(calls===1?[
      item("Why homeowner insurance premiums rise"),item("How property tax reassessment changes annual bills")
    ]:[item("Heat pump versus gas furnace lifetime costs"),item("How roof material choices affect installation quotes")]);
  };
  const pending=generateProjectKeywords({name:"House Math",description:"Costs of maintaining and insuring a home",keywords:[]},
    {modelSettings:{endpoint:"http://127.0.0.1:1234/v1/chat/completions",model:"mock"},transport,
      targetCount:4,sleep:async()=>{},onBatch:batch=>updates.push(batch)});
  try{
    for(let i=0;i<25&&calls<2;i++)await new Promise(resolve=>setTimeout(resolve,1));
    assert.equal(calls,2,"The second model call should be pending");
    assert.equal(updates.length,1,"The first verified batch must be delivered before the second response");
    assert.deepEqual(updates[0].suggestions.map(row=>row.text),[
      "Why homeowner insurance premiums rise","How property tax reassessment changes annual bills"]);
    assert.equal(updates[0].quality.modelRequests,1);
  }finally{releaseSecond();}
  const result=await pending;
  assert.equal(result.suggestions.length,4);
  assert.equal(updates.at(-1).quality.modelRequests,2);
});

test("keyword batches never fabricate fillers when all local responses are generic",async()=>{
  let calls=0;
  const transport=async()=>{calls++;return reply([item("homeownership economics","topic","Aligns with project description authority")]);};
  await assert.rejects(generateProjectKeywords({name:"House Math",description:"Homeownership costs",keywords:[]},
    {modelSettings:{endpoint:"http://127.0.0.1:1234/v1/chat/completions",model:"mock"},transport,sleep:async()=>{}}),/specific|quality|valid/i);
  assert.ok(calls<=12,`Expected a bounded number of model requests, got ${calls}`);
});

test("cancelling keyword expansion stops later model requests",async()=>{
  const controller=new AbortController();let calls=0;
  const transport=async()=>{calls++;controller.abort(Error("Cancelled by creator"));return reply([item("Property tax increases after home purchase")]);};
  await assert.rejects(generateProjectKeywords({name:"House Math",description:"Homeowner costs",keywords:[]},
    {modelSettings:{endpoint:"http://127.0.0.1:1234/v1/chat/completions",model:"mock"},transport,signal:controller.signal,sleep:async()=>{}}),/cancelled/i);
  assert.equal(calls,1);
});

test("local keyword expansion never exceeds its global inference budget after a partial success",async()=>{
  let calls=0;
  const transport=async()=>{
    calls++;
    return calls===1?reply([item("How property taxes change after a home purchase")]):
      {ok:false,status:503,headers:{get:()=>null}};
  };
  const result=await generateProjectKeywords({name:"House Math",description:"Household ownership expenses",keywords:[]},
    {modelSettings:{endpoint:"http://127.0.0.1:1234/v1/chat/completions",model:"mock"},transport,sleep:async()=>{}});
  assert.equal(result.suggestions.length,1);
  assert.equal(result.quality.partial,true);
  assert.ok(calls<=12,`Overran bounded model budget with ${calls} calls`);
});
