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


test("topic-first path requires public-network opt in, uses installed model, and drafts reviewed sources without TTS",async()=>{
  const calls=[];
  const server=createDirectorProduction({
    readModel:async()=>({model:"local-researcher",endpoint:"http://127.0.0.1:11434/v1/chat/completions"}),
    searchEndpoint:()=>"http://127.0.0.1:49273/search",
    research:async(brief,options)=>{
      calls.push(["research",brief,options]);
      return {dossier:inputs().dossier,warnings:["Review every citation"],
        quotePreviews:[{claimId:"claim_01",sourceId:"source_01",quote:"Verbatim source passage"}]};
    },
    generateStory:async(dossier,options)=>{
      calls.push(["story",dossier.id,options]);
      return fixture("preproduction-plan-smoke.json");
    },
    build:async()=>{throw Error("never build while gathering research");},
    produce:async()=>{throw Error("never produce while planning");}
  });
  const brief={title:"Cost of a home",viewerQuestion:"Why does it cost more?",audience:"Homeowners",locale:"en-US"};
  assert.equal((await invoke(server,"POST","/research",{brief,allowNetwork:false})).status,422);
  assert.equal(calls.length,0);
  const found=await invoke(server,"POST","/research",{brief,allowNetwork:true});
  assert.equal(found.status,200);
  assert.equal(found.data.dossier.kind,"research-dossier");
  assert.deepEqual(found.data.quotePreviews,
    [{claimId:"claim_01",sourceId:"source_01",quote:"Verbatim source passage"}]);
  assert.equal(calls[0][2].model,"local-researcher");
  assert.equal(calls[0][2].searchEndpoint,"http://127.0.0.1:49273/search");
  const story=await invoke(server,"POST","/story",{dossier:found.data.dossier});
  assert.equal(story.status,200);
  assert.equal(story.data.bundle.kind,"preproduction-bundle");
  assert.equal(story.data.bundle.researchId,found.data.dossier.id);
  assert.equal(story.data.bundle.status,"draft-needs-review");
  assert.equal(calls[1][2].model,"local-researcher");
  const bridged=await invoke(server,"POST","/plan",{dossier:found.data.dossier,bundle:story.data.bundle});
  assert.equal(bridged.status,200);
  assert.equal(bridged.data.job.beats.length,3);
});


test("one-click sample works without a configured research model, external network or media tools",async()=>{
  let sideEffects=0;
  const server=createDirectorProduction({readModel:async()=>{sideEffects++;throw Error("not configured");},
    build:async()=>{sideEffects++;},produce:async()=>{sideEffects++;}});
  const response=await invoke(server,"GET","/demo");
  assert.equal(response.status,200);
  assert.equal(response.data.dossier.kind,"research-dossier");
  assert.equal(response.data.bundle.kind,"preproduction-bundle");
  assert.equal(response.data.bundle.status,"draft-needs-review");
  assert.equal(sideEffects,0);
});


test("actual renderer preview is identical to the edit plan and never starts voice/build/video jobs",async()=>{
 let calls=0;
 const server=createDirectorProduction({
   build:async()=>{calls++;throw Error("must not build for frame preview");},
   inspect:async()=>{calls++;throw Error("must not inspect voice for frame preview");},
   produce:async()=>{calls++;throw Error("must not synthesize or render for frame preview");}
 });
 const project=inputs();
 const answer=await invoke(server,"POST","/live-preview",project);
 assert.equal(answer.status,200);
 assert.equal(answer.data.kind,"live-renderer-preview/v1");
 assert.equal(answer.data.plan.kind,"general-explainer-visual-plan");
 assert.equal(answer.data.shotMap.length,project.bundle.plan.shots.length);
 assert.equal(answer.data.timing.measuredNarration,false);
 assert.equal(calls,0);
 const status=await invoke(server,"GET","/status");
 assert.equal(status.data.state,"idle");
 const mismatch=structuredClone(project);
 mismatch.bundle.plan.sound[0].narration="Changed without revalidation";
 const rejected=await invoke(server,"POST","/live-preview",mismatch);
 assert.equal(rejected.status,422);
 assert.equal(calls,0);
});
