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
async function audioResponse(controller,path){
  const req=Readable.from([]);
  Object.assign(req,{method:"GET",url:path,headers:{host:"127.0.0.1:5173"}});
  let status=0,headers={};const bytes=[];
  const res={writeHead(code,h){status=code;headers=h;},end(data){if(data)bytes.push(Buffer.from(data));},destroy(){}};
  await controller.handle(req,res);
  return {status,headers,bytes:Buffer.concat(bytes)};
}
async function waitSample(server){
  for(let i=0;i<40;i++){
    const result=await invoke(server,"GET","/narration-sample/status");
    if(result.data.state!=="generating")return result.data;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  throw Error("Narration sample did not settle");
}

test("voice audition generates only a bounded first-scene excerpt and serves a protected WAV",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-audition-test-"));t.after(()=>rm(dir,{recursive:true,force:true}));
  const calls=[];
  const server=createDirectorProduction({outputRoot:dir,
    synthesizeNarration:async(job,options)=>{
      calls.push({beats:job.beats,settings:options});
      const wavPath=join(options.cacheRoot,"sample.wav");
      await writeFile(wavPath,Buffer.from("RIFFexampleWAVE"));
      return [{wavPath}];
    },build:async()=>{throw Error("audition should never build");},
    produce:async()=>{throw Error("audition should never render");}});
  const p=inputs();
  const start=await invoke(server,"POST","/narration-sample",{...p,settings:config});
  assert.equal(start.status,202);
  const result=await waitSample(server);
  assert.equal(result.state,"done");
  assert.match(result.audioUrl,/\/narration-sample\/[a-f0-9-]+\.wav$/);
  assert.equal(calls.length,1);
  assert.equal(calls[0].beats.length,1);
  assert.ok(calls[0].beats[0].narration.length<=180);
  assert.equal(calls[0].settings.localVoiceAuthorized,true);
  const samplePath=result.audioUrl.replace("/api/contentgen-video","");
  assert.equal((await audioResponse(server,samplePath)).headers["Content-Type"],"audio/wav");
  assert.equal((await audioResponse(server,samplePath)).bytes.toString(),"RIFFexampleWAVE");
  assert.equal((await audioResponse(server,"/narration-sample/unknown.wav")).status,404);
  const newSample=await invoke(server,"POST","/narration-sample",{...p,settings:config});
  assert.equal(newSample.status,202);
  const second=await waitSample(server);
  assert.equal(second.state,"done");
  assert.notEqual(second.audioUrl,result.audioUrl);
  assert.equal((await audioResponse(server,samplePath)).status,404);
});

test("sample audition refuses unauthorized voices and concurrent render/check",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-audition-block-test-"));t.after(()=>rm(dir,{recursive:true,force:true}));
  let resolveSample,synthesis=0;
  const server=createDirectorProduction({outputRoot:dir,
    synthesizeNarration:async()=>{synthesis++;await new Promise(resolve=>{resolveSample=resolve;});
      throw Error("cancelled");},
    inspect:async()=>{throw Error("must not inspect");}});
  const p=inputs();
  assert.equal((await invoke(server,"POST","/narration-sample",{...p,settings:{...config,localVoiceAuthorized:false}})).status,422);
  assert.equal((await invoke(server,"POST","/narration-sample",{...p,settings:{...config,provider:"fish",apiKey:"key",voiceConsent:false,transmitText:true}})).status,422);
  assert.equal(synthesis,0);
  assert.equal((await invoke(server,"POST","/narration-sample",{...p,settings:config})).status,202);
  assert.equal((await invoke(server,"POST","/check",{...p,settings:config})).status,409);
  assert.equal((await invoke(server,"POST","/narration-sample",{...p,settings:config})).status,409);
  assert.equal((await invoke(server,"POST","/narration-sample/cancel",{confirmed:true})).status,202);
  if(resolveSample)resolveSample();
  const ended=await waitSample(server);
  assert.equal(ended.state,"cancelled");
  assert.equal(ended.audioUrl,null);
  assert.ok(synthesis<=1,"cancellation may prevent synthesis from starting at all");
});

test("cancelling an active voice sample retires its playback without interrupting a later render",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-audition-active-test-"));t.after(()=>rm(dir,{recursive:true,force:true}));
  let began,started=new Promise(resolve=>{began=resolve;});
  const server=createDirectorProduction({outputRoot:dir,synthesizeNarration:async(_job,options)=>{
    began();await new Promise((resolve,reject)=>{
      options.signal.addEventListener("abort",()=>reject(Error("Cancelled by editor.")),{once:true});
    });
    return [];
  }});
  assert.equal((await invoke(server,"POST","/narration-sample",{...inputs(),settings:config})).status,202);
  await started;
  assert.equal((await invoke(server,"POST","/narration-sample/cancel",{confirmed:true})).status,202);
  const settled=await waitSample(server);
  assert.equal(settled.state,"cancelled");assert.equal(settled.audioUrl,null);
  assert.equal((await invoke(server,"POST","/plan",inputs())).status,200);
});

test("a provider failure never repeats the API key in voice audition status",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-audition-secret-test-"));t.after(()=>rm(dir,{recursive:true,force:true}));
  const secret="sensitive-voice-key-123";
  const server=createDirectorProduction({outputRoot:dir,synthesizeNarration:async()=>{
    throw Error("Provider refused token "+secret);
  }});
  const settings={provider:"fish",voiceId:"licensed-fish-voice",providerRevision:"fish-v1",
    apiKey:secret,voiceConsent:true,transmitText:true};
  assert.equal((await invoke(server,"POST","/narration-sample",{...inputs(),settings})).status,202);
  const result=await waitSample(server);
  assert.equal(result.state,"failed");
  assert.equal(result.message.includes(secret),false);
  assert.match(result.message,/Voice sample failed/);
});
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
test("Research and Story endpoints ask for independent model tasks",async()=>{
  const seen=[];
  const server=createDirectorProduction({readModel:async task=>{seen.push(task);return {model:"local",endpoint:"http://127.0.0.1:11434/v1/chat/completions"};},
    searchEndpoint:()=>"http://127.0.0.1:58023/search",
    research:async()=>({dossier:inputs().dossier,quotePreviews:[],warnings:[]}),
    generateStory:async()=>fixture("preproduction-plan-smoke.json")});
  assert.equal((await invoke(server,"POST","/research",{allowNetwork:true,brief:{title:"Costs",viewerQuestion:"Why?",audience:"Owners"}})).status,200);
  assert.equal((await invoke(server,"POST","/story",{dossier:inputs().dossier})).status,200);
  assert.deepEqual(seen,["research","story"]);
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

test("completed renders are discoverable by production across server restarts, never by another production",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-assets-test-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const productionId="production-"+"a".repeat(24),otherId="production-"+"b".repeat(24);
  const server=createDirectorProduction({outputRoot:dir,findBrowser:async()=>"/mock/chromium",
    build:async()=>{},inspect:async()=>({ready:true,findings:[],tools:{}}),
    produce:async(_job,opts)=>{
      const releaseDir=join(opts.out,"release");
      await mkdir(releaseDir,{recursive:true});
      await writeFile(join(releaseDir,"video.mp4"),"mock video media");
      await writeFile(join(releaseDir,"captions.srt"),"1\n00:00:00,000 --> 00:00:01,000\nTest");
      return {releaseDir};
    }});
  const params={...inputs(),settings:config,productionId,sourceRevision:"approved-script:revision-one:board-one:plan-one"};
  assert.equal((await invoke(server,"POST","/check",params)).status,200);
  assert.equal((await invoke(server,"POST","/start",{...params,confirmRender:true})).status,202);
  for(let i=0;i<40&&server.status().state==="rendering";i++)
    await new Promise(r=>setTimeout(r,5));
  assert.equal(server.status().state,"done");
  const restarted=createDirectorProduction({outputRoot:dir});
  const own=await invoke(restarted,"GET",`/assets/${productionId}`);
  assert.equal(own.status,200);
  assert.deepEqual(own.data.assets.map(asset=>asset.kind).sort(),["captions","video"]);
  assert.ok(own.data.assets.every(asset=>asset.platform==="youtube"));
  assert.ok(own.data.assets.every(asset=>asset.sourceRevision===params.sourceRevision));
  assert.match(own.data.assets[0].downloadUrl,/^\/api\/contentgen-video\/media\//);
  assert.deepEqual((await invoke(restarted,"GET",`/assets/${otherId}`)).data.assets,[]);
  assert.equal((await invoke(restarted,"GET","/assets/../production-other")).status,404);
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
test("readiness and export bind reviewed SFX to the same measured beat events, and recheck after changes",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-reviewed-sfx-test-"));t.after(()=>rm(dir,{recursive:true,force:true}));
  const project=inputs();
  let soundHash="a".repeat(64),renders=0,inspected=null;
  const bankChoice=()=>project.bundle.plan.shots.map((shot,index)=>({shotId:shot.id,
    mode:index===0?"pin":"mute",assetId:index===0?"11111111-2222-3333-4444-555555555555":null,
    localPath:index===0?"/reviewed/bank/sfx.wav":null,sha256:index===0?soundHash:null,
    license:index===0?"cc0":null,rightsStatus:index===0?"user-reviewed":null}));
  const server=createDirectorProduction({outputRoot:dir,findBrowser:async()=>"/mock/chromium",
    resolveSfx:async ({projectId,bundle})=>{
      assert.equal(projectId,project.dossier.id);assert.equal(bundle.researchId,projectId);
      return bankChoice();
    },build:async()=>{},inspect:async job=>{inspected=job;return {ready:true,findings:[],tools:{}};},
    produce:async (job,opts)=>{
      renders++;assert.deepEqual(job.sounds,inspected.sounds);
      const releaseDir=join(opts.out,"release");await mkdir(releaseDir,{recursive:true});
      await writeFile(join(releaseDir,"video.mp4"),"mock mp4");return {releaseDir};
    }});
  const checked=await invoke(server,"POST","/check",{...project,settings:config});
  assert.equal(checked.status,200);assert.equal(checked.data.ready,true);
  assert.equal(checked.data.sfxSummary.approved,1);
  assert.equal(checked.data.sfxSummary.muted,project.bundle.plan.shots.length-1);
  assert.equal(inspected.sounds.length,1);
  assert.equal(inspected.sounds[0].assetSha256,soundHash);
  assert.equal(inspected.sounds[0].assetRef,"/reviewed/bank/sfx.wav");
  assert.equal(inspected.events.find(e=>e.id===inspected.sounds[0].eventId).beatId,inspected.beats[0].id);
  assert.ok(inspected.beats[0].eventIds.includes(inspected.sounds[0].eventId));
  assert.ok(inspected.sounds.every(s=>s.licenseStatus==="verified"));
  soundHash="b".repeat(64);
  const stale=await invoke(server,"POST","/start",{...project,settings:config,confirmRender:true});
  assert.equal(stale.status,409);assert.equal(renders,0);
  const refreshed=await invoke(server,"POST","/check",{...project,settings:config});
  assert.equal(refreshed.data.ready,true);
  assert.equal((await invoke(server,"POST","/start",{...project,settings:config,confirmRender:true})).status,202);
  for(let i=0;i<30&&server.status().state==="rendering";i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(renders,1);assert.equal(server.status().state,"done");
  assert.equal(inspected.sounds[0].assetSha256,"b".repeat(64));
});
test("changing a checked supplemental sound layer invalidates readiness without rendering",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-extra-sfx-test-"));t.after(()=>rm(dir,{recursive:true,force:true}));
  const project=inputs();let gainDb=-25,renderCount=0,checkedSound;
  const extra={layerId:"layer_sample",shotId:project.bundle.plan.shots[0].id,
    assetId:"11111111-2222-3333-4444-555555555555",sha256:"c".repeat(64),
    localPath:"/trusted/approved.wav",license:"cc0",rightsStatus:"user-reviewed",
    trigger:"shot-start",offsetMs:300,fadeInMs:30,fadeOutMs:70};
  const server=createDirectorProduction({outputRoot:dir,findBrowser:async()=>"/mock/chromium",
    resolveSfx:async()=>[],resolveSoundDesign:async()=>({layers:[{...extra,gainDb}],ambience:null}),
    build:async()=>{},inspect:async job=>{checkedSound=job.sounds.at(-1);return {ready:true,findings:[],tools:{}};},
    produce:async()=>{renderCount++;throw Error("render should not start with changed sound settings");}});
  const prior=await invoke(server,"POST","/check",{...project,settings:config});
  assert.equal(prior.data.ready,true);
  assert.equal(checkedSound.gainDb,-25);
  assert.equal(prior.data.sfxSummary.extraLayers,1);
  gainDb=-32;
  const stale=await invoke(server,"POST","/start",{...project,settings:config,confirmRender:true});
  assert.equal(stale.status,409);
  assert.equal(renderCount,0);
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

