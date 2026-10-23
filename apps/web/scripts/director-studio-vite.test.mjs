import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { handleDirectorRequest } from "./director-studio-vite.mjs";

async function post(path,body,deps){
  const req=Readable.from([Buffer.from(JSON.stringify(body))]);
  Object.assign(req,{method:"POST",url:path,headers:{host:"127.0.0.1:5173",origin:"http://127.0.0.1:5173","x-contentgen-director":"local-only"}});
  let status,result;
  const res={writeHead(value){status=value;},end(value){result=JSON.parse(value);}};
  await handleDirectorRequest(req,res,deps);
  return {status,result};
}
test("variants, brief variants and combined research-to-plan resolve their distinct task models",async()=>{
  const picked=[],calls=[];
  const deps={model:async task=>{picked.push(task);return {endpoint:"http://127.0.0.1:11434/v1/chat/completions",model:task+"-model"};},
    generate:async(_input,opts)=>{calls.push(["variants",opts.modelSettings.model]);return {variants:[]};},
    editorial:async(_input,opts)=>{calls.push(["brief",opts.modelSettings.model]);return [];},
    researchDraft:async(_input,research,opts)=>{calls.push(["research",research.model,"story",opts.storyModelSettings.model]);return {dossier:{id:"a"},plan:{shots:[]}};}};
  assert.equal((await post("/variants",{shotId:"shot-1"},deps)).status,200);
  assert.equal((await post("/brief-variants",{topic:"Roofs"},deps)).status,200);
  assert.equal((await post("/research-draft",{title:"Roofs"},deps)).status,200);
  assert.deepEqual(picked,["hooks","hooks","research","story"]);
  assert.deepEqual(calls,[["variants","hooks-model"],["brief","hooks-model"],["research","research-model","story","story-model"]]);
});
