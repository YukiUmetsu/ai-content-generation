import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { handleResearchSettings } from "./research-model-vite.mjs";

const config={version:1,profiles:[{id:"local",name:"Magnitude local",provider:"magnitude",endpoint:"http://127.0.0.1:10100/inference/v1/chat/completions",model:"qwen3.6"}],defaultProfileId:"local",assignments:{research:"local"}};
async function call(method,path,payload,deps={},headers={}){
  const req=Readable.from(payload===undefined?[]:[Buffer.from(JSON.stringify(payload))]);
  Object.assign(req,{method,url:path,headers:{host:"127.0.0.1:5173",...(method==="POST"?{origin:"http://127.0.0.1:5173","x-contentgen-settings":"local-only"}:{}),...headers}});
  let status,body;
  const res={writeHead(code){status=code;},end(content){body=JSON.parse(content);}};
  await handleResearchSettings(req,res,deps);
  return {status,body};
}
test("profile API returns saved assignments and accepts explicit profile saves",async()=>{
  let stored=config;
  const deps={readProfiles:async()=>stored,saveProfiles:async input=>{stored=input;return stored;},searchEndpoint:()=>null};
  assert.equal((await call("GET","/profiles",undefined,deps)).body.profiles.assignments.research,"local");
  const next={...config,profiles:[{...config.profiles[0],provider:"custom"}]};
  assert.equal((await call("POST","/profiles/save",next,deps)).status,200);
  assert.equal((await call("GET","/profiles",undefined,deps)).body.profiles.profiles[0].provider,"custom");
  assert.equal((await call("POST","/profiles/save",next,deps,{origin:"http://evil.example"})).status,403);
});

test("readiness checks local services immediately without issuing a public search or inference",async()=>{
  const calls=[];
  const deps={readProfiles:async()=>config,searchEndpoint:()=>"http://127.0.0.1:20000/search",
    selectModel:()=>({endpoint:config.profiles[0].endpoint,model:"qwen3.6"}),
    probeSearch:async options=>{calls.push(options);return {ok:true};},
    models:async()=>["qwen3.6"]};
  const result=await call("GET","/readiness",undefined,deps);
  assert.equal(result.status,200);
  assert.equal(result.body.ready,true);
  assert.equal(result.body.search.state,"ready");
  assert.deepEqual(calls,[{endpoint:"http://127.0.0.1:20000/search",search:false}]);
  assert.equal((await call("GET","/readiness",undefined,deps,{host:"example.com"})).status,403);
  assert.equal((await call("GET","/readiness",undefined,deps,{origin:"https://other.local"})).status,403);
});
