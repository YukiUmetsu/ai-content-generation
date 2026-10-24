import test from "node:test";
import assert from "node:assert/strict";
import { discoverResearchModels, modelsEndpoint } from "./research-model-settings.mjs";

test("Magnitude model discovery preserves /inference/v1 and never contacts a different host", async () => {
  const endpoint = "http://127.0.0.1:10100/inference/v1/chat/completions";
  assert.equal(modelsEndpoint(endpoint), "http://127.0.0.1:10100/inference/v1/models");
  const calls=[];
  const models=await discoverResearchModels(endpoint,{transport: async (url,init)=> {
    calls.push({url,init});
    return {ok:true,headers:new Headers(),text:async()=>JSON.stringify({data:[{id:"qwen3.6-35b-a3b"}]})};
  }});
  assert.deepEqual(models,["qwen3.6-35b-a3b"]);
  assert.equal(calls[0].url,"http://127.0.0.1:10100/inference/v1/models");
  assert.equal(calls[0].init.redirect,"error");
  assert.throws(()=>modelsEndpoint("https://magnitude.example/v1/chat/completions"));
});
