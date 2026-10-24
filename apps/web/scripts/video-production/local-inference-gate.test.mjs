import test from "node:test";
import assert from "node:assert/strict";
import {withLocalInference} from "./local-inference-gate.mjs";

test("an aborted unresponsive producer cannot starve the next queued local model task",async()=>{
  const controller=new AbortController();
  let began=false;
  const waiting=withLocalInference(async()=>{began=true;return new Promise(()=>{});},controller.signal);
  for(let attempt=0;!began&&attempt<20;attempt++)await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(began,true);
  const next=withLocalInference(async()=>"next job completed");
  controller.abort(Error("cancelled"));
  await assert.rejects(waiting,/cancelled/);
  assert.equal(await next,"next job completed");
});
