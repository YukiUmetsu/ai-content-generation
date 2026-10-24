import test from "node:test";
import assert from "node:assert/strict";
import { probeModel, summarizeProbe } from "./local-model-probe.mjs";

const sample={subject:"Roof repair",parts:["Materials","Labor"],operator:"compare"};
const reply=(finish,answer,usage={prompt_tokens:58,completion_tokens:71})=>({
  choices:[{finish_reason:finish,message:{content:answer}}],usage
});

test("one-shot probe disables Qwen3.5 thinking through the request body",async()=>{
  let seen;
  const transport=async(url,options)=>{
    seen={url,body:JSON.parse(options.body)};
    return {ok:true,text:async()=>JSON.stringify(reply("stop",JSON.stringify(sample)))};
  };
  const result=await probeModel({endpoint:"http://127.0.0.1:10100/inference/v1/chat/completions",
    model:"qwen3.5:9b",transport,maxTokens:384});
  assert.equal(seen.url,"http://127.0.0.1:10100/inference/v1/chat/completions");
  assert.deepEqual(seen.body.chat_template_kwargs,{enable_thinking:false});
  assert.equal(seen.body.max_tokens,384);
  assert.equal(seen.body.stream,false);
  assert.equal(result.validJson,true);
  assert.equal(result.validShape,true);
  assert.equal(result.finishReason,"stop");
  assert.equal(result.completionTokens,71);
});

test("complete JSON on provider length is identifiable without printing its contents",async()=>{
  const privateResponse=JSON.stringify({subject:"Personal secret",parts:["X","Y"],operator:"compare"});
  const result=summarizeProbe(reply("length",privateResponse,{prompt_tokens:12,completion_tokens:1024,
    completion_tokens_details:{reasoning_tokens:950}}));
  assert.equal(result.validJson,true);
  assert.equal(result.validShape,true);
  assert.equal(result.finishReason,"length");
  assert.equal(result.reasoningTokens,950);
  assert.equal(JSON.stringify(result).includes("Personal secret"),false);
});

test("truncated incomplete JSON reports failure without leaking answer text",()=>{
  const result=summarizeProbe(reply("length",'{"subject":"private information'));
  assert.equal(result.validJson,false);
  assert.equal(result.validShape,false);
  assert.equal(JSON.stringify(result).includes("private information"),false);
});

test("refuses non-loopback model endpoints",async()=>{
  await assert.rejects(()=>probeModel({endpoint:"https://example.com/v1/chat/completions",
    model:"qwen3.5:9b",transport:async()=>{throw Error("Should never be called.");}}));
});
