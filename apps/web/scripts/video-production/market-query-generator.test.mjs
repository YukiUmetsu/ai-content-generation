import test from "node:test";
import assert from "node:assert/strict";
import {generateMarketQueries, validateMarketQueryPlan} from "./market-query-generator.mjs";

const modelSettings={model:"installed-local",endpoint:"http://127.0.0.1:11434/v1/chat/completions"};
const choices=["roof replacement costs","mortgage total interest","home insurance annual premiums","heat pump versus furnace cost"];
const fakeTransport=async (url,init)=>{
  assert.equal(url,"http://127.0.0.1:11434/v1/chat/completions");
  const body=JSON.parse(init.body);
  assert.equal(body.model,"installed-local");
  assert.match(JSON.stringify(body.messages),/House Math/);
  assert.doesNotMatch(JSON.stringify(body.messages),/youtube_api_key|x-goog-api-key/iu);
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({queries:choices})}}]}),{status:200});
};

test("a local model proposes four distinct editable searches for a niche without sending keys",async()=>{
  const actual=await generateMarketQueries({name:"House Math"},{modelSettings,transport:fakeTransport});
  assert.deepEqual(actual,choices);
});

test("missing configured model makes no network request",async()=>{
  let calls=0;
  await assert.rejects(generateMarketQueries({name:"House Math"},{modelSettings:null,transport:async()=>{calls++;}}),/local model/iu);
  assert.equal(calls,0);
});

test("a suggested search plan must be nonempty, distinct, bounded and free of URLs",()=>{
  assert.deepEqual(validateMarketQueryPlan(choices),choices);
  assert.throws(()=>validateMarketQueryPlan(["heat pump", "Heat Pump", "roof costs", "mortgage"]),/distinct|duplicate/iu);
  assert.throws(()=>validateMarketQueryPlan(["https://example.com", ...choices.slice(1)]),/search phrase|URL/iu);
  assert.throws(()=>validateMarketQueryPlan(["a".repeat(161),...choices.slice(1)]),/160/iu);
  assert.throws(()=>validateMarketQueryPlan(["a",...choices.slice(1)]),/3/iu);
});

test("rejects a cloud model endpoint before transmitting the niche",async()=>{
  let calls=0;
  await assert.rejects(generateMarketQueries({name:"House Math"},{modelSettings:{model:"x",endpoint:"https://api.example.com/v1/chat/completions"},transport:async()=>{calls++;}}),/loopback|local/iu);
  assert.equal(calls,0);
});
