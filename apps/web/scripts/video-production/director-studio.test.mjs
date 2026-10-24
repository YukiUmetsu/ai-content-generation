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
  const listeners=new Map();
  const res={writeHead(code,headers){status=code;head=headers;},end(bytes){result+=bytes??"";},
    on(name,fn){listeners.set(name,fn);},emitClose(){listeners.get("close")?.();}};
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
test("YouTube niche query planning is same-origin, optional, and uses the research model",async()=>{
  const p=request("POST","/market-queries",{niche:"House Math",region:"US",language:"en"});
  let called=0;
  await handleDirectorRequest(p.req,p.res,{
    model:async role=>{assert.equal(role,"research");return {model:"local-research"};},
    marketQueries:async(payload,options)=>{
      called++;assert.equal(payload.name,"House Math");assert.equal(options.modelSettings.model,"local-research");
      return ["mortgage closing costs","roof replacement cost","heat pump installation cost","property tax increases"];
    }
  });
  assert.equal(p.result().status,200);
  assert.equal(p.result().data.queries.length,4);
  const blocked=request("POST","/market-queries",{niche:"House Math"},{origin:"https://elsewhere.test"});
  await handleDirectorRequest(blocked.req,blocked.res,{marketQueries:async()=>{called++;}});
  assert.equal(blocked.result().status,403);
  const noModel=request("POST","/market-queries",{niche:"House Math"});
  await handleDirectorRequest(noModel.req,noModel.res,{model:async()=>null,marketQueries:async()=>{called++;}});
  assert.equal(noModel.result().status,422);
  assert.equal(called,1);
});
test("Studio research draft requires deliberate same-origin POST and an installed local model",async()=>{
  const body={title:"Heat pump lifecycle cost",viewerQuestion:"Which parts change the total cost?",audience:"Homeowners",locale:"en-US"};
  let called=0;
  const requestItem=request("POST","/research-draft",body);
  await handleDirectorRequest(requestItem.req,requestItem.res,{
    model:async()=>({model:"installed-local",endpoint:"http://127.0.0.1:11434/v1/chat/completions"}),
    researchDraft:async (payload,settings)=>{
      called++;assert.deepEqual(payload,body);assert.equal(settings.model,"installed-local");
      return {dossier:{id:"research_abc"},plan:{shots:[]},quotes:[],snapshotId:"research_abc"};
    }
  });
  assert.equal(requestItem.result().status,200);
  assert.equal(requestItem.result().data.snapshotId,"research_abc");
  const none=request("POST","/research-draft",body);
  await handleDirectorRequest(none.req,none.res,{model:async()=>null,researchDraft:async()=>{called++;}});
  assert.equal(none.result().status,422);
  const cross=request("POST","/research-draft",body,{origin:"https://evil.example"});
  await handleDirectorRequest(cross.req,cross.res,{researchDraft:async()=>{called++;}});
  assert.equal(cross.result().status,403);
  assert.equal(called,1);
});
test("Studio runs at most one expensive research/model draft at a time",async()=>{
  let release;
  const pause=new Promise(resolve=>{release=resolve;});
  let entered=0;
  const settings={model:"local",endpoint:"http://127.0.0.1:11434/v1/chat/completions"};
  const deps={model:async()=>settings,researchDraft:async()=>{entered++;await pause;return {dossier:{id:"research_one"},plan:{shots:[]},quotes:[]};}};
  const input={title:"Insulation",viewerQuestion:"What changes heat transfer?",audience:"Homeowners",locale:"en-US"};
  const a=request("POST","/research-draft",input),b=request("POST","/research-draft",input);
  const running=handleDirectorRequest(a.req,a.res,deps);
  await new Promise(resolve=>setImmediate(resolve));
  await handleDirectorRequest(b.req,b.res,deps);
  assert.equal(b.result().status,409);
  assert.equal(entered,1);
  release();await running;
  assert.equal(a.result().status,200);
});
test("closing an in-flight research response aborts the public capture and local model signal",async()=>{
  const a=request("POST","/research-draft",{title:"Insulation",viewerQuestion:"How does it work?",audience:"Homeowners",locale:"en-US"});
  let active;
  const running=handleDirectorRequest(a.req,a.res,{
    model:async()=>({model:"local",endpoint:"http://127.0.0.1:11434/v1/chat/completions"}),
    researchDraft:async(_brief,_model,options)=>{
      if(!options?.signal)throw Error("Missing abort signal.");
      active=options.signal;
      await new Promise((_,reject)=>options.signal.addEventListener("abort",()=>reject(Error("Research cancelled.")),{once:true}));
    },
  });
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(active.aborted,false);
  a.res.emitClose();
  await running;
  assert.equal(active.aborted,true);
});
test("cached research drafts can be viewed through a bounded local GET without new provider calls",async()=>{
  const p=request("GET","/research-draft/research_abc-123456789abc");
  await handleDirectorRequest(p.req,p.res,{loadResearch:async id=>{
    assert.equal(id,"research_abc-123456789abc");
    return {snapshotId:"research_abc",artifactId:id,quotes:[]};
  }});
  assert.equal(p.result().status,200);
  assert.equal(p.result().data.snapshotId,"research_abc");
  const invalid=request("GET","/research-draft/../../etc/passwd");
  await handleDirectorRequest(invalid.req,invalid.res,{loadResearch:async()=>{throw Error("bad");}});
  assert.equal(invalid.result().status,404);
});
