import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { compilePreproductionBundle } from "./video-production/preproduction.mjs";
import { createDirectorProduction, configureRenderJob } from "./director-production-vite.mjs";

const fixture=name=>JSON.parse(readFileSync(new URL("../../../examples/"+name,import.meta.url),"utf8"));
const inputs=()=>{
  const dossier=fixture("preproduction-research-smoke.json");
  return {dossier,bundle:compilePreproductionBundle(dossier,fixture("preproduction-plan-smoke.json"))};
};
const config={provider:"local",voiceId:"licensed-local-voice",providerRevision:"test-engine-v1",
  modelId:"installed-model",endpoint:"http://127.0.0.1:8765",localVoiceAuthorized:true};
function request(method,path,payload,headers={}){
  const req=Readable.from(payload===undefined?[]:[Buffer.from(JSON.stringify(payload))]);
  Object.assign(req,{method,url:path,headers:{host:"127.0.0.1:5173",
    ...(method==="POST"?{origin:"http://127.0.0.1:5173",
      "x-contentgen-director":"local-only"}:{}),...headers}});
  let status=0,result="",head={};
  const res={writeHead(code,h){status=code;head=h;},end(value){result+=value??"";},destroy(){}};
  return {req,res,result:()=>({status,head,data:JSON.parse(result)})};
}
async function invoke(controller,method,path,payload,headers){
  const r=request(method,path,payload,headers);
  await controller.handle(r.req,r.res);
  return r.result();
}
test("editor bridge is viewable without generating audio, and preview creates an offline rough cut",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-server-test-"));t.after(()=>rm(dir,{recursive:true,force:true}));
  let toolCalls=0;
  const server=createDirectorProduction({outputRoot:dir,
    build:async()=>{toolCalls++;},inspect:async()=>{toolCalls++;},
    produce:async()=>{toolCalls++;}});
  const preview=await invoke(server,"POST","/plan",inputs());
  assert.equal(preview.status,200);
  assert.equal(preview.data.job.beats.length,3);
  const rough=await invoke(server,"POST","/preview",inputs());
  assert.equal(rough.status,200);
  assert.match(rough.data.url,/\/preview\/[a-f0-9-]+/);
  assert.equal(toolCalls,0,"opening either preview must not trigger model, build, or render");
  const idle=await invoke(server,"GET","/status");
  assert.equal(idle.data.state,"idle");
});
test("same-origin and explicit action gates block background production",async()=>{
  const server=createDirectorProduction();
  for(const headers of [{origin:"http://evil.example"},{host:"evil.example:5173"},
    {"x-contentgen-director":"nope"}]){
    assert.equal((await invoke(server,"POST","/plan",inputs(),headers)).status,403);
  }
  const run=await invoke(server,"POST","/start",{...inputs(),settings:config,confirmRender:true});
  assert.equal(run.status,409);
  const missing=await invoke(server,"POST","/check",{...inputs(),settings:{...config,localVoiceAuthorized:false}});
  assert.equal(missing.status,422);
});
test("a normal UI sequence checks tools, renders a new MP4, reuses previous output and shows progress",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-render-test-"));t.after(()=>rm(dir,{recursive:true,force:true}));
  const observed=[],performed=[];
  const server=createDirectorProduction({outputRoot:dir,findBrowser:async()=>"/mock/chromium",
    build:async()=>{observed.push("build");},
    inspect:async (job,opts)=>{
      observed.push("inspect");
      assert.equal(job.voice.provider,"local");
      assert.equal(job.policy.maxCostUsd,0);
      assert.equal(opts.browserExecutable,"/mock/chromium");
      return {ready:true,findings:[],tools:{}};
    },
    produce:async (job,opts)=>{
      observed.push("render");
      performed.push(opts);
      const releaseDir=join(opts.out,"release");
      await mkdir(releaseDir,{recursive:true});
      await writeFile(join(releaseDir,"video.mp4"),"mock video media");
      opts.onProgress({phase:"rendering",completedFrames:10,totalFrames:20});
      return {releaseDir,regeneration:{reusedSpeechBeatIds:performed.length>1?["beat-01"]:[],
        reusedVideoSegments:performed.length>1?1:0,newlyEncodedVideoSegments:1}};
    }});
  const project=inputs();
  const checked=await invoke(server,"POST","/check",{...project,settings:config});
  assert.equal(checked.status,200);assert.equal(checked.data.ready,true);
  assert.deepEqual(observed,["build","inspect"]);
  const begin=await invoke(server,"POST","/start",{...project,settings:config,confirmRender:true});
  assert.equal(begin.status,202);
  assert.equal(begin.data.started,true);
  for(let i=0;i<30&&server.status().state==="rendering";i++)
    await new Promise(r=>setTimeout(r,5));
  const completed=await invoke(server,"GET","/status");
  assert.equal(completed.data.state,"done");
  assert.match(completed.data.mediaUrl,/\.mp4$/);
  assert.equal(completed.data.regeneration.newlyEncodedVideoSegments,1);
  assert.equal((await readFile(join(performed[0].out,"release","video.mp4"),"utf8")),"mock video media");
  assert.equal((await invoke(server,"POST","/start",{...project,settings:config,confirmRender:true})).status,409);
  const check2=await invoke(server,"POST","/check",{...project,settings:config});
  assert.equal(check2.data.ready,true);
  await invoke(server,"POST","/start",{...project,settings:config,confirmRender:true});
  for(let i=0;i<30&&server.status().state==="rendering";i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(performed.length,2);
  assert.equal(performed[1].reuseFrom,performed[0].out);
  assert.equal(server.status().state,"done");
});
test("changing a checked setting demands a fresh preflight; revoked local voice is never rendered",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-mismatch-test-"));t.after(()=>rm(dir,{recursive:true,force:true}));
  let calls=0;
  const server=createDirectorProduction({outputRoot:dir,findBrowser:async()=>"/mock/chromium",
    build:async()=>{},inspect:async()=>({ready:true,findings:[],tools:{}}),
    produce:async()=>{calls++;throw Error("should not run");}});
  const p=inputs();
  await invoke(server,"POST","/check",{...p,settings:config});
  const changed={...config,voiceId:"other-voice"};
  assert.equal((await invoke(server,"POST","/start",{...p,settings:changed,confirmRender:true})).status,409);
  assert.equal((await invoke(server,"POST","/start",{...p,settings:{...config,localVoiceAuthorized:false},confirmRender:true})).status,422);
  assert.equal(calls,0);
});
test("model authorization only configures the test-only free model; never raises rights",()=>{
  const base={voice:{profileId:"test"},locale:"en-US",approval:"test-only",policy:{}};
  const local=configureRenderJob(base,config);
  assert.equal(local.voice.provider,"local");
  assert.equal(local.approval,"test-only");
  assert.equal(local.policy.reviewerApproved,false);
  assert.equal(local.policy.commercialRightsVerified,false);
  const fish=configureRenderJob(base,{provider:"fish",voiceId:"approved-fish-voice",
    providerRevision:"fish-api-v1",apiKey:"private-key",voiceConsent:true,transmitText:true});
  assert.equal(fish.voice.modelId,"s2.1-pro-free");
  assert.equal(fish.policy.maxCostUsd,0);
});
