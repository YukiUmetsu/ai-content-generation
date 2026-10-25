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

test("keyword output truncation increases the retry budget and still yields a first useful batch",async()=>{
  const budgets=[],progress=[];
  const transport=async(_url,options)=>{
    const request=JSON.parse(options.body);
    budgets.push(request.max_tokens);
    const enough=request.max_tokens>=1700;
    return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({choices:[{
      finish_reason:enough?"stop":"length",
      message:{content:enough?JSON.stringify({suggestions:[{
        text:"property tax reassessment",kind:"query",rationale:"Understand annual tax bills"
      }]}):'{"suggestions":[{"text":"unfinished'}
    }]})};
  };
  const result=await generateProjectKeywords({name:"House Math",description:"Homeownership expenses",keywords:[]},
    {modelSettings:{endpoint:"http://127.0.0.1:1234/v1/chat/completions",model:"mock"},transport,
      sleep:async()=>{},targetCount:1,onBatch:batch=>progress.push(batch)});
  assert.deepEqual(result.suggestions.map(row=>row.text),["property tax reassessment"]);
  assert.equal(budgets.length,2,"One bounded retry should recover from output truncation");
  assert.ok(budgets[1]>budgets[0],"The retry must allow more complete JSON output");
  assert.equal(progress[0].suggestions.length,1,"A recovered keyword is shown as soon as it is validated");
});

test("Qwen3 structured keyword requests suppress expendable thinking tokens",async()=>{
  const transport=async(_url,options)=>{
    const request=JSON.parse(options.body);
    const supported=request.chat_template_kwargs?.enable_thinking===false;
    return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({choices:[{
      finish_reason:supported?"stop":"length",
      message:{content:supported?JSON.stringify({suggestions:[{
        text:"insurance premium renewals",kind:"topic",rationale:"Explain premium changes"
      }]}):""}
    }]})};
  };
  const result=await generateProjectKeywords({name:"House Math",description:"The cost of insuring a home",keywords:[]},
    {modelSettings:{endpoint:"http://127.0.0.1:1234/v1/chat/completions",model:"Qwen3.5-35B-A3B"},transport,
      sleep:async()=>{},targetCount:1});
  assert.equal(result.suggestions[0].text,"insurance premium renewals");
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
          {text:"roof replacement costs",kind:"query",rationale:"Addresses maintenance decisions"}]})}
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

test("quality screening rejects reported long or contrived search terms without relying on a model verdict",()=>{
  const reported=[
    "mortgage interest vs property tax",
    "rent versus buy decision",
    "fixed vs adjustable mortgage rates",
    "hidden maintenance reserve funds",
    "lifecycle maintenance timing",
    "closing costs impact on monthly budget",
    "property tax rate changes over time",
    "property insurance deductible impact on premiums",
    "timing to refinance",
  ];
  const natural=[
    "mortgage interest", "rent vs buy", "fixed vs ARM", "home repair budget",
    "maintenance costs", "refinance timing", "property tax increases", "insurance deductibles",
    "heat pump installation cost",
  ];
  const result=qualityKeywordSuggestions([...reported,...natural].map(text=>item(text)),
    {name:"Homeownership",existing:[]});
  assert.deepEqual(result.suggestions.map(row=>row.text),natural);
  assert.equal(result.rejected,reported.length);
});

test("VS Code is a product name, not a three-word comparison",async()=>{
  const quality=qualityKeywordSuggestions([item("VS Code"),item("VS Code extensions")],
    {name:"Programming tools"});
  assert.deepEqual(quality.suggestions.map(row=>row.text),["VS Code","VS Code extensions"]);
  let calls=0;
  const transport=async()=>{calls++;return reply([item("VS Code extensions")]);};
  const result=await generateProjectKeywords({name:"Developer Tools",description:"Visual Studio Code plugins",keywords:[]},
    {modelSettings:{endpoint:"http://127.0.0.1:1234/v1/chat/completions",model:"mock"},
      transport,sleep:async()=>{},targetCount:1});
  assert.equal(result.suggestions[0].text,"VS Code extensions");
  assert.equal(calls,1,"Do not spend a semantic comparison request on a product name");
});

test("technical product names and established four-word terms remain searchable",()=>{
  const terms=[
    "Node.js vs Bun", "Next.js vs Nuxt", "ASP.NET vs Django", "Vue.js vs React.js",
    "cost of living adjustment", "return on invested capital", "heating and cooling costs",
  ];
  const result=qualityKeywordSuggestions(terms.map(text=>item(text)),{name:"Technical explainers"});
  assert.deepEqual(result.suggestions.map(row=>row.text),terms);
  assert.equal(result.rejected,0);
});

test("keyword quality requires searchable words instead of punctuation or broad one-word topics",()=>{
  const result=qualityKeywordSuggestions([
    item("---"),item("???"),item("mortgage"),item("home"),item("property tax"),item("home insurance"),
  ],{name:"Homeownership"});
  assert.deepEqual(result.suggestions.map(row=>row.text),["property tax","home insurance"]);
  assert.equal(result.rejected,4);
});

test("previously accepted verbose keywords are preserved for dedup but excluded from generation prompts",async()=>{
  const prompts=[];
  const oldAccepted="mortgage interest vs property tax";
  const transport=async(_url,options)=>{
    const request=JSON.parse(options.body);
    prompts.push(JSON.parse(request.messages.at(-1).content).existingKeywords);
    return reply([item("mortgage interest"),item("home insurance")]);
  };
  const result=await generateProjectKeywords({
    name:"Homeownership",description:"Budgeting and financing home ownership",
    keywords:[oldAccepted,"property tax increases"],
  },{modelSettings:{endpoint:"http://127.0.0.1:1234/v1/chat/completions",model:"mock"},
    transport,sleep:async()=>{},targetCount:2});
  assert.deepEqual(prompts[0],["property tax increases"]);
  assert.ok(prompts.every(words=>!words.includes(oldAccepted)));
  assert.deepEqual(result.suggestions.map(row=>row.text),["mortgage interest","home insurance"]);
});

test("later keyword prompts never repeat bad or rejected literal suggestions",async()=>{
  const prompts=[];let batches=0;
  const rejected="maintenance reserve planning matters enormously to every homeowner budget";
  const transport=async(_url,options)=>{
    const request=JSON.parse(options.body);
    prompts.push(request.messages.map(message=>message.content).join("\n"));
    batches++;
    return reply(batches===1?[item(rejected),item("roof replacement costs")]:
      [item("property tax reassessment")]);
  };
  const result=await generateProjectKeywords({name:"Homeownership",description:"House purchase and maintenance costs",keywords:[]},
    {modelSettings:{endpoint:"http://127.0.0.1:1234/v1/chat/completions",model:"mock"},
      transport,sleep:async()=>{},targetCount:2});
  assert.deepEqual(result.suggestions.map(row=>row.text),["roof replacement costs","property tax reassessment"]);
  assert.equal(prompts.length,2);
  for(const prompt of prompts){
    assert.doesNotMatch(prompt,/mortgage interest vs property tax|hidden maintenance reserve funds/iu);
    assert.doesNotMatch(prompt,new RegExp(rejected,"iu"));
  }
});

test("quality gate rejects vague topics, prompt-echo reasons, unsupported trends and duplicate intent",()=>{
  const result=qualityKeywordSuggestions([
    item("homeownership economics"),
    item("calculate total cost of ownership","query"),
    item("House Math"),
    item("Why homeowners insurance premiums increase","query","Aligns with project description authority"),
    item("Rising home prices","topic","Popular search trend with high search volume"),
    item("Roof replacement costs"),
    item("Cost of replacing a roof"),
    item("home insurance premiums","query","Shows factors affecting renewal bills"),
    item("property tax reassessment","query","Explains reassessment after a purchase"),
  ],{name:"House Math",existing:["Roof replacement cost"]});
  assert.deepEqual(result.suggestions.map(row=>row.text),[
    "home insurance premiums","property tax reassessment"
  ]);
  assert.equal(result.rejected,7);
});

test("quality gate does not let exclusion suggestions crowd out useful topics",()=>{
  const result=qualityKeywordSuggestions([
    item("house tour videos","exclusion"),item("real estate agent listings","exclusion"),
    item("luxury mansion walkthroughs","exclusion"),item("property tax reassessment"),
  ],{name:"House Math",existing:[]});
  assert.deepEqual(result.suggestions.map(row=>row.text),[
    "house tour videos","real estate agent listings","property tax reassessment"
  ]);
  assert.equal(result.rejected,1);
});

test("quality gate keeps compact searchable phrases but rejects verbose video-topic sentences",()=>{
  const result=qualityKeywordSuggestions([
    item("comparing fixed-rate vs adjustable-rate mortgage economics","query"),
    item("fixed vs ARM","query"),
    item("effects of inflation on the real cost of fixed mortgage payments","topic"),
    item("inflation mortgage costs","topic"),
    item("home inspection costs","topic"),
    item("roof installation labor","topic"),
  ],{name:"Homeownership",existing:[]});
  assert.deepEqual(result.suggestions.map(row=>row.text),[
    "fixed vs ARM",
    "inflation mortgage costs",
    "home inspection costs",
    "roof installation labor",
  ]);
  assert.equal(result.rejected,2);
});

test("opportunity-cost variants count as one search intent, but unrelated cost topics remain",()=>{
  const result=qualityKeywordSuggestions([
    item("down payment opportunity cost"),
    item("home equity opportunity cost"),
    item("property tax reassessment"),
    item("roof replacement costs"),
  ],{name:"Homeownership",existing:[]});
  assert.deepEqual(result.suggestions.map(row=>row.text),[
    "down payment opportunity cost","property tax reassessment","roof replacement costs",
  ]);
  assert.equal(result.rejected,1);
});

test("keyword generator requests short replacements after a verbose batch while showing accepted results",async()=>{
  const requests=[],updates=[];
  const transport=async(_url,options)=>{
    const req=JSON.parse(options.body);
    requests.push(req.messages[0].content);
    return reply(requests.length===1?[
      item("comparing fixed-rate vs adjustable-rate mortgage economics","query"),
      item("roof replacement costs"),
    ]:[item("adjustable mortgage risks","query")]);
  };
  const result=await generateProjectKeywords({name:"Homeownership",description:"Practical economics and maintenance of owning a home",keywords:[]},
    {modelSettings:{endpoint:"http://127.0.0.1:1234/v1/chat/completions",model:"mock"},
      transport,sleep:async()=>{},targetCount:2,onBatch:batch=>updates.push(batch)});
  assert.deepEqual(result.suggestions.map(row=>row.text),["roof replacement costs","adjustable mortgage risks"]);
  assert.deepEqual(updates.map(batch=>batch.suggestions.length),[1,1],"The initial useful keyword appears before any replacement request");
  assert.match(requests[0],/2.{0,3}3 meaningful words/u);
  assert.match(requests[0],/FOUR words/u);
  assert.match(requests[1],/previous.*verbose/iu);
});

test("short X vs Y keywords require a small judgment of whether they are actual alternatives",async()=>{
  const requests=[],updates=[];
  const transport=async(_url,options)=>{
    const req=JSON.parse(options.body);
    requests.push(req);
    if(requests.length===1)return reply([
      item("fixed vs ARM","topic","Choose a rate structure"),
      item("tax vs roof","topic","Unrelated topics"),
    ]);
    if(req.messages[0].content.includes("comparison suitability"))return replyVerdict([
      {text:"fixed vs ARM",suitable:true},
      {text:"tax vs roof",suitable:false},
    ]);
    return reply([item("property tax reassessment","topic","Predict annual bill changes")]);
  };
  const result=await generateProjectKeywords({name:"Homeownership",description:"The long-term cost of buying and maintaining a home",keywords:[]},
    {modelSettings:{endpoint:"http://127.0.0.1:1234/v1/chat/completions",model:"mock"},transport,sleep:async()=>{},
      targetCount:2,onBatch:batch=>updates.push(batch)});
  assert.deepEqual(result.suggestions.map(row=>row.text),[
    "fixed vs ARM","property tax reassessment",
  ]);
  assert.deepEqual(updates.map(b=>b.suggestions.length),[1,1]);
  assert.equal(requests.length,3);
  assert.ok(requests[1].max_tokens<=350,"Semantic check must remain a small local inference request");
  assert.equal(result.quality.modelRequests,3,"All generation and judgment requests count toward the shared budget");
});

test("punctuated vs. comparisons also receive the meaning check",async()=>{
  let calls=0;
  const transport=async(_url,options)=>{
    calls++;
    const request=JSON.parse(options.body);
    if(request.messages[0].content.includes("comparison suitability")){
      return replyVerdict([{text:"rent vs. buy",suitable:true}]);
    }
    return reply([item("rent vs. buy","query","Compare the two housing choices")]);
  };
  const result=await generateProjectKeywords({name:"Homeownership",description:"Renting versus purchasing a home",keywords:[]},
    {modelSettings:{endpoint:"http://127.0.0.1:1234/v1/chat/completions",model:"mock"},
      transport,sleep:async()=>{},targetCount:1});
  assert.deepEqual(result.suggestions.map(row=>row.text),["rent vs. buy"]);
  assert.equal(calls,2);
});

const replyVerdict=assessments=>({ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({choices:[{
  finish_reason:"stop",message:{content:JSON.stringify({assessments})}
}]})});

test("malformed comparison judgment drops only uncertain comparisons and retains other keywords",async()=>{
  let calls=0;
  const transport=async(_url,options)=>{
    calls++;
    const req=JSON.parse(options.body);
    if(req.messages[0].content.includes("comparison suitability"))return replyVerdict([{text:"wrong",suitable:true}]);
    return calls===1?reply([
      item("mortgage interest vs property tax","topic","Compare two housing payments"),
      item("roof replacement costs","topic","Plan repair expenses"),
    ]):reply([item("home insurance premiums","topic","Budget for insurance renewals")]);
  };
  const result=await generateProjectKeywords({name:"Homeownership",description:"Costs of owning and maintaining houses",keywords:[]},
    {modelSettings:{endpoint:"http://127.0.0.1:1234/v1/chat/completions",model:"mock"},transport,sleep:async()=>{},targetCount:2});
  assert.deepEqual(result.suggestions.map(x=>x.text),["roof replacement costs","home insurance premiums"]);
  assert.ok(result.quality.rejected>=1);
});

test("ambiguous financial jargon gets semantic review instead of passing on keyword length alone",async()=>{
  let calls=0;
  const transport=async(_url,options)=>{
    calls++;
    const req=JSON.parse(options.body);
    if(req.messages[0].content.includes("comparison suitability"))return replyVerdict([
      {text:"equity yield strategy",suitable:false},
    ]);
    if(calls===1)return reply([
      item("equity yield strategy","topic","Unclear financial jargon"),
      item("property tax reassessment","topic","Understand changing bills"),
    ]);
    return reply([item("home maintenance budget","topic","Budget for future repairs")]);
  };
  const result=await generateProjectKeywords({name:"Homeownership",description:"Homeowner costs including upkeep and property taxes",keywords:[]},
    {modelSettings:{endpoint:"http://127.0.0.1:1234/v1/chat/completions",model:"mock"},transport,sleep:async()=>{},targetCount:2});
  assert.deepEqual(result.suggestions.map(x=>x.text),["property tax reassessment","home maintenance budget"]);
  assert.equal(calls,3);
});

test("noncomparison suggestions require no additional judgment inference",async()=>{
  let calls=0;
  const transport=async()=>{calls++;return reply([
    item("property tax reassessment"),item("roof replacement costs"),
  ]);};
  const result=await generateProjectKeywords({name:"Homeownership",description:"Homeownership costs",keywords:[]},
    {modelSettings:{endpoint:"http://127.0.0.1:1234/v1/chat/completions",model:"mock"},transport,sleep:async()=>{},targetCount:2});
  assert.equal(calls,1);
  assert.equal(result.suggestions.length,2);
});

test("cancelling during semantic review prevents later keyword calls and progress events",async()=>{
  const controller=new AbortController();let calls=0;const updates=[];
  const transport=async(_url,options)=>{
    calls++;
    if(calls===1)return reply([item("rent vs buy","query","Choose between homes and leases")]);
    controller.abort(Error("Stopped while reviewing"));
    return replyVerdict([{text:"rent vs buy",suitable:true}]);
  };
  await assert.rejects(generateProjectKeywords({name:"Homeownership",description:"Lifetime homeowner costs",keywords:[]},
    {modelSettings:{endpoint:"http://127.0.0.1:1234/v1/chat/completions",model:"mock"},transport,
      signal:controller.signal,sleep:async()=>{},targetCount:2,onBatch:batch=>updates.push(batch)}),/stopped/i);
  assert.equal(calls,2);
  assert.equal(updates.length,0);
});

test("rejected batches are refilled after six topic lenses while useful early results remain visible",async()=>{
  let calls=0;const updates=[];
  const transport=async()=>{
    calls++;
    if(calls===1)return reply([item("roof replacement costs"),item("homeownership economics")]);
    if(calls<=6)return reply([item("roof replacement costs")]);
    if(calls===7)return reply([item("property tax reassessment"),item("home maintenance budgets")]);
    return reply([item("home insurance renewals")]);
  };
  const result=await generateProjectKeywords({name:"Homeownership",description:"The cost of buying, insuring and maintaining a home",keywords:[]},
    {modelSettings:{endpoint:"http://127.0.0.1:1234/v1/chat/completions",model:"mock"},transport,sleep:async()=>{},
      targetCount:4,onBatch:batch=>updates.push(batch)});
  assert.deepEqual(result.suggestions.map(x=>x.text),[
    "roof replacement costs","property tax reassessment","home maintenance budgets","home insurance renewals",
  ]);
  assert.equal(calls,8);
  assert.equal(updates[0].suggestions[0].text,"roof replacement costs");
  assert.equal(updates.at(-1).step,8);
  assert.equal(result.quality.partial,false);
});

test("refill with no useful keywords stops after bounded attempts and preserves partial success",async()=>{
  let calls=0;
  const transport=async()=>{calls++;return reply(calls===1?[item("property tax reassessment")]:[
    item("property tax reassessment")]);};
  const result=await generateProjectKeywords({name:"Homeownership",description:"Home costs",keywords:[]},
    {modelSettings:{endpoint:"http://127.0.0.1:1234/v1/chat/completions",model:"mock"},transport,sleep:async()=>{},targetCount:12});
  assert.equal(result.suggestions.length,1);
  assert.ok(calls>6,"Should spend a few additional requests filling gaps");
  assert.ok(calls<=9,"Three consecutive empty refill batches should stop wasting local inference");
  assert.ok(calls<=12,"Never exceed the shared local-model budget");
  assert.equal(result.quality.modelRequests,calls);
  assert.equal(result.quality.partial,true);
});

test("local keyword expansion accumulates 12 distinct specific ideas across topic lenses",async()=>{
  const batches=[
    ["home insurance premiums","property tax reassessment"],
    ["HVAC replacement costs","home emergency fund"],
    ["roof replacement estimates","foundation repair costs"],
    ["home closing costs","gas furnace expenses"],
    ["insulation payback period","mortgage refinancing fees"],
    ["older home repairs","home inspection limits"],
  ];
  const facets=[];
  const transport=async(_url,options)=>{
    const request=JSON.parse(options.body);
    const instructions=request.messages[0].content;
    facets.push(instructions);
    assert.match(instructions,/Propose 2 distinct suggestions/i);
    assert.match(request.messages[1].content,/owning and maintaining a home/i);
    const suggestions=batches[facets.length-1]??[];
    return reply(suggestions.map(text=>item(text)));
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
    if(calls===1)return reply([item("property tax increases"),
      item("roof maintenance costs"),item("insurance renewal costs")]);
    if(calls===2)return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({choices:[{
      finish_reason:"length",message:{content:'{"suggestions":[{"text":"unfinished'}
    }]})};
    return reply([item("heat pump operating costs"),item("mortgage closing fees")]);
  };
  const result=await generateProjectKeywords({name:"House Math",description:"Household ownership costs",keywords:[]},
    {modelSettings:{endpoint:"http://127.0.0.1:1234/v1/chat/completions",model:"mock"},transport,sleep:async()=>{},targetCount:5});
  assert.equal(calls,3);
  assert.equal(result.suggestions.length,5);
  assert.equal(result.suggestions[0].text,"property tax increases");
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
      item("home insurance premiums"),item("property tax reassessment")
    ]:[item("heat pump lifetime costs"),item("roof material prices")]);
  };
  const pending=generateProjectKeywords({name:"House Math",description:"Costs of maintaining and insuring a home",keywords:[]},
    {modelSettings:{endpoint:"http://127.0.0.1:1234/v1/chat/completions",model:"mock"},transport,
      targetCount:4,sleep:async()=>{},onBatch:batch=>updates.push(batch)});
  try{
    for(let i=0;i<25&&calls<2;i++)await new Promise(resolve=>setTimeout(resolve,1));
    assert.equal(calls,2,"The second model call should be pending");
    assert.equal(updates.length,1,"The first verified batch must be delivered before the second response");
    assert.deepEqual(updates[0].suggestions.map(row=>row.text),[
      "home insurance premiums","property tax reassessment"]);
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
    return calls===1?reply([item("property tax reassessment")]):
      {ok:false,status:503,headers:{get:()=>null}};
  };
  const result=await generateProjectKeywords({name:"House Math",description:"Household ownership expenses",keywords:[]},
    {modelSettings:{endpoint:"http://127.0.0.1:1234/v1/chat/completions",model:"mock"},transport,sleep:async()=>{}});
  assert.equal(result.suggestions.length,1);
  assert.equal(result.quality.partial,true);
  assert.ok(calls<=12,`Overran bounded model budget with ${calls} calls`);
});
