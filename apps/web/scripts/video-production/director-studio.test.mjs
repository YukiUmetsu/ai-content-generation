import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { handleDirectorRequest } from "../director-studio-vite.mjs";

function request(method,path,body,headers={}){
  const data=body===undefined?[]:[Buffer.from(JSON.stringify(body))];
  const req=Readable.from(data);
  Object.assign(req,{method,url:path,headers:{host:"127.0.0.1:5173",...(method==="POST"
    ?{origin:"http://127.0.0.1:5173","x-contentgen-director":"local-only"}:{}),...headers}});
  let status=0,result="",head={};
  const res={writeHead(code,headers){status=code;head=headers;},end(bytes){result+=bytes??"";}};
  return {req,res,result:()=>({status,head,data:JSON.parse(result)})};
}
test("same-origin-only Director API blocks unrelated hosts, origins and silent cross-site prompts",async()=>{
  const blocked=[
    request("POST","/prompts",{version:1,overrides:{}},{origin:"http://evil.example"}),
    request("POST","/prompts",{version:1,overrides:{}},{"x-contentgen-director":"missing"}),
    request("GET","/prompts",undefined,{host:"evil.example:5173"})
  ];
  for(const item of blocked){
    await handleDirectorRequest(item.req,item.res,{save:async()=>{throw Error("must not write");}});
    assert.equal(item.result().status,403);
  }
});
test("defaults and overrides are presented, and only validated saved prompts are accepted",async()=>{
  const g=request("GET","/prompts");
  await handleDirectorRequest(g.req,g.res,{read:async()=>({version:1,overrides:{hooks:"Accurate first minute."}})});
  assert.equal(g.result().status,200);
  assert.ok(g.result().data.defaults.research);
  assert.equal(g.result().data.settings.overrides.hooks,"Accurate first minute.");
  const p=request("POST","/prompts",{version:1,overrides:{hooks:"Opening should directly relate to the viewer."}});
  let saved;
  await handleDirectorRequest(p.req,p.res,{save:async value=>{saved=value;return value;}});
  assert.equal(p.result().status,200);
  assert.deepEqual(saved.overrides,{hooks:"Opening should directly relate to the viewer."});
});
test("generation only happens on explicit POST and calls configured local model adapter",async()=>{
  let invocations=0;
  const body={dossier:{id:"d"},bundle:{researchId:"d"},shotId:"shot-01"};
  const g=request("POST","/variants",body);
  await handleDirectorRequest(g.req,g.res,{
    model:async()=>({model:"already-installed",endpoint:"http://127.0.0.1:11434/v1/chat/completions"}),
    generate:async (payload,options)=>{
      invocations++;
      assert.equal(payload.shotId,"shot-01");
      assert.equal(options.modelSettings.model,"already-installed");
      return {variants:[{strategy:"A"},{strategy:"B"},{strategy:"C"}]};
    }
  });
  assert.equal(g.result().status,200);
  assert.equal(g.result().data.variants.length,3);
  assert.equal(invocations,1);
  const absent=request("POST","/variants",body);
  await handleDirectorRequest(absent.req,absent.res,{model:async()=>null,
    generate:async()=>{throw Error("unauthorized invocation");}});
  assert.equal(absent.result().status,422);
});
test("only explicit edited fields pass to the revision engine",async()=>{
  const p=request("POST","/edit",{dossier:{id:"d"},bundle:{researchId:"d"},shotId:"intro",
    changes:{narration:"Clear personal question",onScreenText:"What is missing?"}});
  await handleDirectorRequest(p.req,p.res,{edit:(d,b,x)=>{
    assert.equal(d.id,"d");assert.equal(b.researchId,"d");assert.equal(x.shotId,"intro");
    assert.equal(Object.keys(x.changes).length,2);
    return {kind:"preproduction-edit/v1",reviewRequired:true};
  }});
  assert.equal(p.result().status,200);assert.equal(p.result().data.reviewRequired,true);
});
test("original brief alternatives require explicit local action and exclude YouTube API metadata",async()=>{
  const authored={topic:"new windows",audience:"homeowners",viewerQuestion:"Will a replacement pay back?",
    payoff:"Compare lifetime costs",reviewNotes:"Verify regional estimates"};
  const p=request("POST","/brief-variants",authored);
  let called=0;
  await handleDirectorRequest(p.req,p.res,{
    model:async()=>({model:"installed-local"}),
    editorial:async(payload,{modelSettings})=>{
      called++;
      assert.deepEqual(payload,authored);
      assert.equal(modelSettings.model,"installed-local");
      return [{id:"direct"},{id:"process"},{id:"comparison"}];
    }
  });
  assert.equal(p.result().status,200);
  assert.equal(p.result().data.editorialStatus,"unverified-draft");
  assert.equal(called,1);
  const rejected=request("POST","/brief-variants",authored,{origin:"https://other.site"});
  await handleDirectorRequest(rejected.req,rejected.res,{editorial:async()=>{called++;}});
  assert.equal(rejected.result().status,403);
  assert.equal(called,1);
});
