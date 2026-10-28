import test from "node:test";
import assert from "node:assert/strict";
import { createHash,randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { Readable, Writable } from "node:stream";
import { once } from "node:events";
import { compilePreproductionBundle } from "./video-production/preproduction.mjs";
import { createDirectorProduction, configureRenderJob } from "./director-production-vite.mjs";
import {listRecoveryIntents} from "./video-production/recovery-intent.mjs";

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
async function videoResponse(controller,path,range){
  const req=Readable.from([]);
  Object.assign(req,{method:"GET",url:path,headers:{host:"127.0.0.1:5173",
    ...(range?{range}:{})}});
  let status=0,headers={};const bytes=[];
  const res=new Writable({write(chunk,_encoding,callback){bytes.push(Buffer.from(chunk));callback();}});
  res.writeHead=(code,value)=>{status=code;headers=value;};
  const finished=once(res,"finish");
  await controller.handle(req,res);
  await finished;
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
async function waitSceneClip(server){
  for(let i=0;i<100;i++){
    const result=await invoke(server,"GET","/scene-clip/status");
    if(result.data.state!=="rendering")return result.data;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  throw Error("Scene preview did not settle");
}

test("Video Director renders only the selected scene and advertises a hash-verified MP4",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-selected-scene-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const p=inputs(),calls=[];
  const server=createDirectorProduction({outputRoot:dir,build:async()=>{},
    findBrowser:async()=>"/local/chrome",produce:async()=>{throw Error("No full production permitted");},
    trackSceneClip:async(meta,render)=>({...await render({signal:meta.signal,jobId:"job-scene"}),jobId:"job-scene"}),
    renderSceneClip:async options=>{
      calls.push(options);
      const bytes=Buffer.alloc(256,0x45);
      await writeFile(join(options.outDir,"video.mp4"),bytes);
      return {shotId:options.shotId,sizeBytes:bytes.length,
        sha256:createHash("sha256").update(bytes).digest("hex")};
    }});
  const planned=await invoke(server,"POST","/plan",p);
  const shotId=planned.data.shotMap[1].shotId;
  assert.equal((await invoke(server,"POST","/scene-clip/start",{...p,shotId:"../unsafe"})).status,422);
  assert.equal((await invoke(server,"POST","/scene-clip/start",{...p,shotId:"unrelated-scene"})).status,422);
  const response=await invoke(server,"POST","/scene-clip/start",{...p,shotId});
  assert.equal(response.status,202);
  const result=await waitSceneClip(server);
  assert.equal(result.state,"done");
  assert.equal(result.shotId,shotId);
  assert.match(result.videoUrl,/\/scene-clip\/media\/[a-f0-9-]+\/video\.mp4$/u);
  assert.equal(calls.length,1);
  assert.equal(calls[0].shotId,shotId);
  assert.equal(calls[0].browserExecutable,"/local/chrome");
  assert.equal((await invoke(server,"GET","/scene-clip/media/invalid/video.mp4")).status,404);
  const path=result.videoUrl.replace("/api/contentgen-video","");
  const full=await videoResponse(server,path);
  assert.equal(full.status,200);
  assert.equal(full.bytes.length,256);
  const slice=await videoResponse(server,path,"bytes=20-39");
  assert.equal(slice.status,206);
  assert.equal(slice.bytes.length,20);
  assert.equal(slice.headers["Content-Range"],"bytes 20-39/256");
  await writeFile(join(calls[0].outDir,"video.mp4"),Buffer.alloc(256,0x46));
  assert.equal((await invoke(server,"GET",result.videoUrl.replace("/api/contentgen-video",""))).status,404,
    "a damaged scene clip is never served or presented as verified");
});

test("scene clip cancellation stops only that selected preview and reports a clear retry",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-scene-cancel-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const p=inputs(),planned=await invoke(createDirectorProduction({outputRoot:dir}),"POST","/plan",p);
  const shotId=planned.data.shotMap[0].shotId;
  let calls=0;
  const server=createDirectorProduction({outputRoot:dir,build:async()=>{},findBrowser:async()=>"/local/chrome",
    trackSceneClip:async(meta,render)=>render({signal:meta.signal,jobId:"job-scene"}),
    renderSceneClip:async options=>{
      calls++;
      await new Promise((_resolve,reject)=>{
        options.signal.addEventListener("abort",()=>reject(options.signal.reason),{once:true});
      });
    }});
  assert.equal((await invoke(server,"POST","/scene-clip/start",{...p,shotId})).status,202);
  assert.equal((await invoke(server,"POST","/scene-clip/start",{...p,shotId})).status,409);
  assert.equal((await invoke(server,"POST","/scene-clip/cancel",{confirmed:true})).status,202);
  const final=await waitSceneClip(server);
  assert.equal(final.state,"cancelled");
  assert.match(final.message,/cancelled/i);
  assert.equal(final.videoUrl,null);
  assert.ok(calls<=1);
});

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

test("editor can audition the narration of one selected storyboard scene without synthesizing another scene",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-scene-audition-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const jobs=[];
  const server=createDirectorProduction({outputRoot:dir,synthesizeNarration:async(job,options)=>{
    jobs.push(job.beats.map(beat=>({id:beat.id,narration:beat.narration})));
    const wavPath=join(options.cacheRoot,"voice.wav");
    await writeFile(wavPath,Buffer.from("RIFFvoice-sampleWAVE"));
    return [{wavPath}];
  }});
  const p=inputs(),planned=await invoke(server,"POST","/plan",p);
  assert.equal(planned.status,200);
  const shot=planned.data.shotMap[1],original=planned.data.job.beats.find(beat=>beat.id===shot.beatId);
  assert.ok(shot&&original);
  assert.equal((await invoke(server,"POST","/narration-sample",{...p,settings:config,sceneShotId:"../../invalid"})).status,422);
  assert.equal((await invoke(server,"POST","/narration-sample",{...p,settings:config,sceneShotId:"not-a-scene"})).status,422);
  assert.equal((await invoke(server,"POST","/narration-sample",{...p,settings:config,sceneShotId:shot.shotId})).status,202);
  assert.equal((await waitSample(server)).state,"done");
  assert.equal(jobs.length,1);
  assert.equal(jobs[0].length,1);
  assert.equal(jobs[0][0].id,shot.beatId);
  assert.ok(original.narration.replace(/\s+/gu," ").includes(jobs[0][0].narration));
  assert.ok(jobs[0][0].narration.length<=180);
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

test("a saved Fish key powers a draft without a browser key or Pexels API access",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-settings-keys-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const fishSecret="fish-native-secret-123";
  const requested=[],observed=[];
  const server=createDirectorProduction({outputRoot:dir,findBrowser:async()=>"/mock/chromium",build:async()=>{},
    providerKey:async provider=>{requested.push(provider);return fishSecret;},
    jobTracker:()=>({start:async()=>"saved-job",advance:async()=>{},complete:async()=>{},fail:async()=>{}}),
    inspect:async(_job,opts)=>{
      assert.equal(opts.env.FISH_AUDIO_API_KEY,fishSecret);
      return {ready:true,findings:[]};
    },
    produce:async(_job,opts)=>{
      observed.push({fish:opts.apiKey,pexels:opts.pexelsKey,autoPrepareFreeMedia:opts.autoPrepareFreeMedia});
      const releaseDir=join(opts.out,"release");await mkdir(releaseDir,{recursive:true});
      await writeFile(join(releaseDir,"video.mp4"),"mock video media");
      return {releaseDir};
    },
    searchAssets:async()=>({kind:"contentgen-scene-asset-suggestions",scenes:[],warnings:[]})});
  const input={...inputs(),productionId:"production-"+"a".repeat(24),settings:{provider:"fish",voiceId:"licensed-voice",providerRevision:"v1",
    apiKey:"",voiceConsent:true,transmitText:true},searchFreeMedia:true,autoPrepareFreeMedia:true};
  const check=await invoke(server,"POST","/check",input);
  assert.equal(check.status,200,JSON.stringify(check.data));
  const start=await invoke(server,"POST","/start",{...input,confirmRender:true});
  assert.equal(start.status,202,JSON.stringify(start.data));
  for(let i=0;i<50&&server.status().state==="rendering";i++)await new Promise(r=>setTimeout(r,5));
  assert.deepEqual(observed,[{fish:fishSecret,pexels:undefined,autoPrepareFreeMedia:true}]);
  assert.deepEqual(requested,["fish","fish"]);
  assert.ok(!JSON.stringify(check.data).includes(fishSecret));
  assert.ok(!JSON.stringify(start.data).includes(fishSecret));
});

test("missing stored Fish key returns a safe, actionable Settings instruction",async()=>{
  const server=createDirectorProduction({providerKey:async()=>"",build:async()=>{throw Error("build must not run");}});
  const result=await invoke(server,"POST","/check",{...inputs(),settings:{provider:"fish",
    voiceId:"licensed-voice",providerRevision:"v1",voiceConsent:true,transmitText:true,apiKey:""}});
  assert.equal(result.status,422);
  assert.match(result.data.error,/Settings → Connections/);
});

test("provider diagnostics never expose a stored Fish key in preflight errors or findings",async()=>{
  const secret="native-fish-secret-diagnostic";
  const settings={provider:"fish",voiceId:"licensed-voice",providerRevision:"v1",voiceConsent:true,
    transmitText:true,apiKey:""};
  const server=createDirectorProduction({providerKey:async()=>secret,build:async()=>{},
    findBrowser:async()=>"/mock/chromium",inspect:async()=>({ready:false,
      findings:[{severity:"error",code:"provider",message:"Provider denied "+secret}]})});
  const checked=await invoke(server,"POST","/check",{...inputs(),settings});
  assert.equal(checked.status,200);
  assert.ok(!JSON.stringify(checked.data).includes(secret));
  assert.match(checked.data.report.findings[0].message,/\[redacted\]/);
  const bad=createDirectorProduction({providerKey:async()=>secret,build:async()=>{},
    findBrowser:async()=>"/mock/chromium",inspect:async()=>{throw Error("Token failed: "+secret);}});
  const failed=await invoke(bad,"POST","/check",{...inputs(),settings});
  assert.equal(failed.status,422);
  assert.match(failed.data.error,/\[redacted\]/);
  assert.ok(!JSON.stringify(failed.data).includes(secret));
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
  assert.match(performed[0].expectedSceneMediaFingerprint,/^[a-f0-9]{64}$/,
    "even no-selection drafts must freeze an empty media snapshot before synthesis");
  assert.equal(performed[1].reuseFrom,performed[0].out);
  assert.equal(server.status().state,"done");
});

test("saved production starts a durable Jobs DAG before rendering and reports its ID",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-tracked-test-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const events=[];
  let exportedManifestHash,exportedVideoHash,exportedCaptionsHash;
  const server=createDirectorProduction({outputRoot:dir,findBrowser:async()=>"/mock/chromium",
    build:async()=>{},inspect:async()=>({ready:true,findings:[]}),
    jobTracker:()=>({start:async input=>{events.push(["start",input.productionId]);return "job-persisted";},
      advance:async(phase,payload)=>events.push(["advance",phase,payload]),
      complete:async payload=>events.push(["complete",payload]),fail:async()=>events.push(["fail"]),
      cancel:async()=>events.push(["cancel"])}),
    produce:async (_job,opts)=>{
      const releaseDir=join(opts.out,"release");await mkdir(releaseDir,{recursive:true});
      const digest=value=>createHash("sha256").update(value).digest("hex");
      const files={"video.mp4":"mock media","captions.srt":"mock captions",
        "cover-still.png":"mock cover","thumbnail-1.png":"mock concept 1",
        "thumbnail-2.png":"mock concept 2","thumbnail-3.png":"mock concept 3"};
      const keys={"video.mp4":"video","captions.srt":"captions","cover-still.png":"coverStill",
        "thumbnail-1.png":"thumbnail-1","thumbnail-2.png":"thumbnail-2","thumbnail-3.png":"thumbnail-3"};
      const artifacts={};
      for(const [file,contents] of Object.entries(files)){
        await writeFile(join(releaseDir,file),contents);
        artifacts[keys[file]]=digest(contents);
      }
      const manifest=JSON.stringify({schemaVersion:1,artifacts});
      await writeFile(join(releaseDir,"render-manifest.json"),manifest);
      exportedManifestHash=digest(manifest);exportedVideoHash=artifacts.video;
      exportedCaptionsHash=artifacts.captions;
      opts.onProgress({phase:"narration"});opts.onProgress({phase:"rendering",completedFrames:12,totalFrames:12,
        artifactLedger:{kind:"sound-mix",masterSha256:"a".repeat(64),samples:96000}});
      return {releaseDir,manifestHash:exportedManifestHash,
        artifactHashes:{video:exportedVideoHash,captions:exportedCaptionsHash}};
    }});
  const payload={...inputs(),settings:config,productionId:"production-"+"a".repeat(24),sourceRevision:"r1"};
  assert.equal((await invoke(server,"POST","/check",payload)).status,200);
  const started=await invoke(server,"POST","/start",{...payload,confirmRender:true});
  assert.equal(started.status,202);assert.equal(started.data.jobId,"job-persisted");
  for(let i=0;i<30&&server.status().state==="rendering";i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(server.status().state,"done");
  assert.equal(server.status().jobId,"job-persisted");
  assert.deepEqual(events.map(e=>e[0]),["start","advance","advance","complete"]);
  assert.equal(events[2][2].artifactLedger.masterSha256,"a".repeat(64));
  assert.deepEqual(events[3][1],{artifactLedger:{kind:"export-package",manifestHash:exportedManifestHash,
    artifacts:{video:exportedVideoHash,captions:exportedCaptionsHash}}});
  const restarted=createDirectorProduction({outputRoot:dir,latestProductionJob:async()=>null});
  assert.equal((await invoke(restarted,"GET",`/status/${payload.productionId}?sourceRevision=r1`)).data.state,"done");
  assert.equal((await invoke(restarted,"GET",`/assets/${payload.productionId}`)).data.assets.length,6);
});

test("a restarted failed production locates its original narration cache from the durable Jobs input",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-retry-cache-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const oldRun="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  let passedCache,passedRenderCache;
  const server=createDirectorProduction({outputRoot:dir,findBrowser:async()=>"/mock/chromium",
    build:async()=>{},inspect:async()=>({ready:true,findings:[]}),
    jobTracker:()=>({priorRunId:oldRun,start:async()=>"job-retried",
      advance:async()=>{},complete:async()=>{},fail:async()=>{},cancel:async()=>{}}),
    produce:async(_job,options)=>{
      passedCache=options.reuseSpeechCacheFrom;
      passedRenderCache=options.reuseRenderSegmentsFrom;
      const releaseDir=join(options.out,"release");await mkdir(releaseDir,{recursive:true});
      await writeFile(join(releaseDir,"video.mp4"),"mock retry video");return{releaseDir};
    }});
  const payload={...inputs(),settings:config,productionId:"production-"+"a".repeat(24)};
  await invoke(server,"POST","/check",payload);
  assert.equal((await invoke(server,"POST","/start",{...payload,confirmRender:true})).status,202);
  for(let i=0;i<40&&server.status().state==="rendering";i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(server.status().state,"done");
  assert.equal(passedCache,join(dir,"draft-"+oldRun));
  assert.equal(passedRenderCache,join(dir,"draft-"+oldRun),"retry can use verified segments from the failed run");
});

test("only an already completed video requires a second-version confirmation",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-version-confirm-"));t.after(()=>rm(dir,{recursive:true,force:true}));
  const productionId="production-"+"a".repeat(24),base={...inputs(),settings:config,productionId};
  let produced=0;
  const server=createDirectorProduction({outputRoot:dir,findBrowser:async()=>"/mock/chromium",
    build:async()=>{},inspect:async()=>({ready:true,findings:[]}),
    jobTracker:()=>({start:async()=>"job-version",advance:async()=>{},complete:async()=>{},fail:async()=>{},cancel:async()=>{}}),
    produce:async(_job,options)=>{
      produced++;
      const releaseDir=join(options.out,"release");await mkdir(releaseDir,{recursive:true});
      await writeFile(join(releaseDir,"video.mp4"),"verified version "+produced);
      return{releaseDir};
    }});
  assert.deepEqual((await invoke(server,"GET",`/version-policy/${productionId}`)).data,
    {requiresConfirmation:false,completedVersions:0});
  await invoke(server,"POST","/check",{...base,sourceRevision:"revision-1"});
  assert.equal((await invoke(server,"POST","/start",{...base,sourceRevision:"revision-1",confirmRender:true})).status,202);
  for(let i=0;i<40&&server.status().state==="rendering";i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(server.status().state,"done");
  assert.deepEqual((await invoke(server,"GET",`/version-policy/${productionId}`)).data,
    {requiresConfirmation:true,completedVersions:1});
  await invoke(server,"POST","/check",{...base,sourceRevision:"revision-2"});
  const denied=await invoke(server,"POST","/start",{...base,sourceRevision:"revision-2",confirmRender:true});
  assert.equal(denied.status,409);
  assert.match(denied.data.error,/confirm.*updated.*video/i);
  assert.equal(produced,1);
  assert.equal((await invoke(server,"POST","/start",{...base,sourceRevision:"revision-2",
    confirmRender:true,confirmUpdatedVersion:true})).status,202);
  for(let i=0;i<40&&server.status().state==="rendering";i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(server.status().state,"done");assert.equal(produced,2);
});

test("an unsuccessful first video is not counted as a completed version",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-failed-first-version-"));t.after(()=>rm(dir,{recursive:true,force:true}));
  const productionId="production-"+"b".repeat(24),payload={...inputs(),settings:config,productionId};
  const server=createDirectorProduction({outputRoot:dir,findBrowser:async()=>"/mock/chromium",
    build:async()=>{},inspect:async()=>({ready:true,findings:[]}),
    jobTracker:()=>({start:async()=>"job-failed-first",advance:async()=>{},complete:async()=>{},fail:async()=>{},cancel:async()=>{}}),
    produce:async()=>{throw Error("Simulated failed first video");}});
  await invoke(server,"POST","/check",payload);
  assert.equal((await invoke(server,"POST","/start",{...payload,confirmRender:true})).status,202);
  for(let i=0;i<40&&server.status().state==="rendering";i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(server.status().state,"failed");
  assert.deepEqual((await invoke(server,"GET",`/version-policy/${productionId}`)).data,
    {requiresConfirmation:false,completedVersions:0});
});

test("render identity tracks user-selected visual media and passes exact shot bindings to the renderer", async t => {
  const dir = await mkdtemp(join(tmpdir(), "director-selected-media-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const selected = { selections: [], invalidShots: [] };
  const received = [];
  const server = createDirectorProduction({ outputRoot: dir, findBrowser: async () => "/mock/chromium",
    build: async () => {}, inspect: async () => ({ ready: true, findings: [] }),
    listSelections: async () => selected,
    produce: async (_job, opts) => {
      received.push(opts);
      const releaseDir = join(opts.out, "release");
      await mkdir(releaseDir, { recursive: true });
      await writeFile(join(releaseDir, "video.mp4"), "mock video");
      return { releaseDir };
    },
  });
  const data = { ...inputs(), settings: config };
  assert.equal((await invoke(server, "POST", "/check", data)).status, 200);
  const first = data.bundle.plan.shots[0];
  selected.selections.push({ projectId: data.dossier.id, shotId: first.id, provider: "pexels",
    assetType: "photo", assetId: "49", sha256: "a".repeat(64),
    rightsStatus: "user-reviewed", sourceUrl: "https://www.pexels.com/photo/roof-49/",
    license: "Pexels License", licenseUrl: "https://www.pexels.com/license/" });
  const stale = await invoke(server, "POST", "/start", { ...data, confirmRender: true });
  assert.equal(stale.status, 409, "selection edits require a fresh render snapshot");
  assert.equal((await invoke(server, "POST", "/check", data)).status, 200);
  assert.equal((await invoke(server, "POST", "/start", { ...data, confirmRender: true })).status, 202);
  for (let i = 0; i < 30 && server.status().state === "rendering"; i++)
    await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(received.length, 1);
  assert.equal(received[0].sceneAssetProjectId, data.dossier.id);
  assert.equal(received[0].sceneShotMap[0].shotId, first.id);
  assert.match(received[0].expectedSceneMediaFingerprint, /^[a-f0-9]{64}$/);
});

test("rapid start clicks reserve one render even while Jobs creation is still pending", async t => {
  const dir = await mkdtemp(join(tmpdir(), "director-start-single-flight-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let acceptStart, calls = 0;
  const pending = new Promise(resolve => { acceptStart = resolve; });
  const server = createDirectorProduction({ outputRoot: dir, findBrowser: async () => "/mock/chromium",
    build: async () => {}, inspect: async () => ({ ready: true, findings: [] }),
    jobTracker: () => ({ start: async () => { calls++; await pending; return "single-job"; },
      advance: async () => {}, complete: async () => {}, fail: async () => {}, cancel: async () => {} }),
    produce: async (_job, opts) => {
      const releaseDir = join(opts.out, "release");
      await mkdir(releaseDir, { recursive: true });
      await writeFile(join(releaseDir, "video.mp4"), "mock video");
      return { releaseDir };
    },
  });
  const data = { ...inputs(), settings: config, productionId: `production-${"a".repeat(24)}` };
  assert.equal((await invoke(server, "POST", "/check", data)).status, 200);
  const first = invoke(server, "POST", "/start", { ...data, confirmRender: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal((await invoke(server, "POST", "/start", { ...data, confirmRender: true })).status, 409);
  acceptStart();
  assert.equal((await first).status, 202);
  assert.equal(calls, 1);
  for (let i = 0; i < 40 && server.status().state === "rendering"; i++)
    await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(server.status().state, "done");
});

test("cancel during a delayed Jobs reservation prevents any media production and cancels the reserved job", async t => {
  const dir = await mkdtemp(join(tmpdir(), "director-reservation-cancel-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let accept, signalReservation, renders = 0, cancels = 0;
  const reserved = new Promise(resolve => { accept = resolve; });
  const reservationStarted = new Promise(resolve => { signalReservation = resolve; });
  const server = createDirectorProduction({ outputRoot: dir, findBrowser: async () => "/mock/chromium",
    build: async () => {}, inspect: async () => ({ ready: true, findings: [] }),
    listSelections: async () => ({ selections: [], invalidShots: [] }),
    jobTracker: () => ({ start: async () => { signalReservation(); await reserved; return "reserved-job"; },
      advance: async () => {}, complete: async () => {}, fail: async () => {}, cancel: async () => { cancels++; } }),
    produce: async () => { renders++; throw Error("Must not synthesize media after cancellation"); },
  });
  const data = { ...inputs(), settings: config, productionId: `production-${"b".repeat(24)}` };
  await invoke(server, "POST", "/check", data);
  const start = invoke(server, "POST", "/start", { ...data, confirmRender: true });
  let reservationTimeout;
  try {
    await Promise.race([reservationStarted,
      start.then(result => { throw Error(`Render stopped before reserving a Jobs attempt (HTTP ${result.status}).`); }),
      new Promise((_, reject) => { reservationTimeout = setTimeout(() => reject(Error("Jobs reservation was never requested.")), 8000); }),
    ]);
  } finally { clearTimeout(reservationTimeout); }
  const cancelled = await invoke(server, "POST", "/cancel", { confirmed: true });
  accept();
  await start;
  assert.equal(cancelled.status, 202);
  assert.equal(cancels >= 1, true);
  assert.equal(renders, 0);
  assert.equal(server.status().state, "cancelled");
});

test("a failed scene render records an actionable step error without leaking provider diagnostics",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-failure-recovery-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  let failed;
  const server=createDirectorProduction({outputRoot:dir,findBrowser:async()=>"/mock/chromium",
    build:async()=>{},inspect:async()=>({ready:true,findings:[]}),
    jobTracker:()=>({start:async()=>"job-render-failure",advance:async()=>{},complete:async()=>{},
      fail:async(...args)=>{failed=args;},cancel:async()=>{}}),
    produce:async(_job,options)=>{
      options.onProgress({phase:"rendering",message:"Rendering scene 3"});
      throw Error("Internal provider detail: private-token-value");
    }});
  const payload={...inputs(),settings:config,productionId:"production-"+"f".repeat(24)};
  await invoke(server,"POST","/check",payload);
  assert.equal((await invoke(server,"POST","/start",{...payload,confirmRender:true})).status,202);
  for(let i=0;i<40&&server.status().state==="rendering";i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(server.status().state,"failed");
  assert.equal(failed?.[0],"scene_render_failed");
  assert.match(failed?.[1],/visual assets.*retry/i);
  assert.doesNotMatch(JSON.stringify({failed,status:server.status()}),/private-token-value/);
});

test("a full draft disk-space failure exposes the specific recoverable cause in Jobs",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-disk-failure-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  let failed;
  const server=createDirectorProduction({outputRoot:dir,findBrowser:async()=>"/mock/chromium",
    build:async()=>{},inspect:async()=>({ready:true,findings:[]}),
    jobTracker:()=>({start:async()=>"job-disk-full",advance:async()=>{},complete:async()=>{},
      fail:async(...args)=>{failed=args;},cancel:async()=>{}}),
    produce:async(_job,options)=>{
      await options.onProgress({phase:"rendering",message:"Encoding the edited scene"});
      throw Error("ENOSPC: no space left on device, write /private-token-value");
    }});
  const payload={...inputs(),settings:config,productionId:"production-"+"e".repeat(24)};
  await invoke(server,"POST","/check",payload);
  assert.equal((await invoke(server,"POST","/start",{...payload,confirmRender:true})).status,202);
  for(let i=0;i<40&&server.status().state==="rendering";i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(server.status().state,"failed");
  assert.equal(failed?.[0],"disk_full");
  assert.match(failed?.[1],/disk space/i);
  assert.match(server.status().message,/disk space/i);
  assert.equal(server.status().jobId,"job-disk-full");
  assert.doesNotMatch(JSON.stringify({failed,status:server.status()}),/private-token-value/);
});

test("lost worker ownership is a retryable failure, never a user cancellation",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-lost-worker-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  let abort,recorded;
  const server=createDirectorProduction({outputRoot:dir,findBrowser:async()=>"/mock/chromium",
    build:async()=>{},inspect:async()=>({ready:true,findings:[]}),
    jobTracker:()=>({start:async({workerAbortController})=>{
      abort=workerAbortController;return "job-interrupted";},
      advance:async()=>{},complete:async()=>{},fail:async(...args)=>{recorded=args;},cancel:async()=>{}}),
    produce:async(_job,options)=>{
      await options.onProgress({phase:"rendering",message:"Rendering a scene"});
      abort.abort(Error("This worker lost its Jobs claim. Unsafe to continue."));
      throw abort.signal.reason;
    }});
  const payload={...inputs(),settings:config,productionId:"production-"+"a".repeat(24)};
  await invoke(server,"POST","/check",payload);
  assert.equal((await invoke(server,"POST","/start",{...payload,confirmRender:true})).status,202);
  for(let i=0;i<40&&server.status().state==="rendering";i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(server.status().state,"failed");
  assert.equal(recorded?.[0],"jobs_lease_lost");
  assert.match(server.status().message,/interrupted.*retry/i);
  assert.doesNotMatch(server.status().message,/claim|worker ownership/i);
});

test("finished media becomes restart-discoverable before Jobs commits success",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-commit-recovery-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const productionId="production-"+"b".repeat(24);
  let confirmCompletion,completionStarted,completed=0;
  const inCompletion=new Promise(resolve=>{completionStarted=resolve;});
  const commitGate=new Promise(resolve=>{confirmCompletion=resolve;});
  const server=createDirectorProduction({outputRoot:dir,findBrowser:async()=>"/mock/chromium",
    build:async()=>{},inspect:async()=>({ready:true,findings:[]}),
    jobTracker:()=>({start:async()=>"job-commit-recovery",advance:async()=>{},
      complete:async()=>{completionStarted();await commitGate;completed++;},
      fail:async()=>{},cancel:async()=>{}}),
    produce:async(_job,options)=>{
      const releaseDir=join(options.out,"release");await mkdir(releaseDir,{recursive:true});
      await writeFile(join(releaseDir,"video.mp4"),"committed film");return{releaseDir};
    }});
  const payload={...inputs(),settings:config,productionId,sourceRevision:"revision-1"};
  assert.equal((await invoke(server,"POST","/check",payload)).status,200);
  assert.equal((await invoke(server,"POST","/start",{...payload,confirmRender:true})).status,202);
  let timer;
  try{await Promise.race([inCompletion,new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(Error("Jobs success was never reached")),8000);
  })]);}finally{clearTimeout(timer);}
  assert.equal(completed,0,"Jobs success is deliberately held before SQLite commit");
  const restarted=createDirectorProduction({outputRoot:dir,latestProductionJob:async()=>null});
  const saved=await invoke(restarted,"GET","/assets/"+productionId);
  assert.equal(saved.status,200);
  assert.equal(saved.data.assets.find(asset=>asset.kind==="video")?.sourceRevision,"revision-1",
    "another Studio process can locate the video even if Jobs completion never returns");
  const recovered=await invoke(restarted,"GET","/status/"+productionId+"?sourceRevision=revision-1");
  assert.equal(recovered.status,200);
  assert.equal(recovered.data.state,"done");
  assert.match(recovered.data.mediaUrl,/\/media\/[a-f0-9-]+\/video\.mp4$/u);
  assert.equal((await invoke(restarted,"GET","/status/"+productionId+"?sourceRevision=changed")).data.state,"idle",
    "changing a script revision must not represent an old export as current");
  confirmCompletion();
  for(let i=0;i<50&&server.status().state==="rendering";i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(completed,1);
  assert.equal(server.status().state,"done");
});

test("restart reports the matching durable video job without inventing completed media",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-restart-jobs-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const productionId="production-"+"c".repeat(24);
  const latestProductionJob=async()=>({job:{id:"job-persisted",jobKind:"video-production",state:"RUNNING"},
    nodes:[{nodeKey:"scene-plan",input:{sourceRevision:"revision-2"}},
      {nodeKey:"scene-render",id:"node-running",state:"RUNNING"}]});
  const restarted=createDirectorProduction({outputRoot:dir,latestProductionJob});
  const recovered=await invoke(restarted,"GET","/status/"+productionId+"?sourceRevision=revision-2");
  assert.equal(recovered.status,200);assert.equal(recovered.data.state,"rendering");
  assert.equal(recovered.data.jobId,"job-persisted");
  assert.match(recovered.data.message,/previous draft.*Jobs.*recover/i);
  assert.doesNotMatch(recovered.data.message,/worker ownership|stale revision|fingerprint/i);
  assert.equal((await invoke(restarted,"GET","/status/"+productionId+"?sourceRevision=revision-3")).data.state,"idle");
  assert.equal((await invoke(restarted,"GET","/status/../../invalid")).status,404);
  assert.equal((await invoke(restarted,"GET","/status/"+productionId+"?sourceRevision=bad%0Avalue")).status,422);
});

test("a rearmed ordinary failure is retryable rather than shown as a worker rendering forever",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-restart-ready-failure-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const productionId="production-"+"c".repeat(24);
  const worker=createDirectorProduction({outputRoot:dir,latestProductionJob:async()=>({
    job:{id:"job-ready-failed",jobKind:"video-production",state:"RUNNING"},
    nodes:[{nodeKey:"scene-plan",input:{sourceRevision:"script"}},
      {nodeKey:"scene-render",id:"node-render",state:"READY",errorCode:"scene_render_failed"}],
    attempts:[{nodeId:"node-render",state:"FAILED",errorCode:"scene_render_failed"}]
  })});
  const result=await invoke(worker,"GET",`/status/${productionId}?sourceRevision=script`);
  assert.equal(result.data.state,"failed");
  assert.equal(result.data.jobId,"job-ready-failed");
  assert.match(result.data.message,/scene rendering failed.*retry/i);
});

test("older completed releases still require confirmation after 100 unrelated exports",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-older-version-policy-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const records=join(dir,"production-media-records-v1");await mkdir(records);
  const oldId="production-"+"c".repeat(24),otherId="production-"+"d".repeat(24);
  for(let index=0;index<102;index++){
    const runId=randomUUID(),record={runId,productionId:index===0?oldId:otherId,
      sourceRevision:null,createdAt:1_800_000_000_000+index,manifestHash:null};
    await writeFile(join(records,runId+".json"),JSON.stringify({version:1,record}));
  }
  const worker=createDirectorProduction({outputRoot:dir});
  const older=await invoke(worker,"GET","/version-policy/"+oldId);
  assert.equal(older.status,200);
  assert.deepEqual(older.data,{requiresConfirmation:true,completedVersions:1});
});

test("restart shows the exact safe failed Jobs step rather than a generic interruption",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-restart-failed-step-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const productionId="production-"+"d".repeat(24);
  const restarted=createDirectorProduction({outputRoot:dir,latestProductionJob:async()=>({
    job:{id:"job-failed-disk",jobKind:"video-production",state:"FAILED"},
    nodes:[{nodeKey:"scene-plan",input:{sourceRevision:"revision-1"}},
      {id:"node-render",nodeKey:"scene-render",state:"FAILED",errorCode:"disk_full"}],
    attempts:[{nodeId:"node-render",state:"FAILED",errorCode:"disk_full",
      errorDetail:"Local disk space is exhausted. Free space and retry the draft."}]
  })});
  const restored=await invoke(restarted,"GET",`/status/${productionId}?sourceRevision=revision-1`);
  assert.equal(restored.data.state,"failed");
  assert.equal(restored.data.jobId,"job-failed-disk");
  assert.match(restored.data.message,/disk space/i);
  assert.match(restored.data.message,/retry/i);
});

test("a restarted coordinator claims and finishes one previously authorized full draft",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-auto-resurrect-"));t.after(()=>rm(dir,{recursive:true,force:true}));
  const productionId="production-"+"a".repeat(24),payload={...inputs(),settings:config,
    productionId,sourceRevision:"saved-script"};
  let failures=0;
  const initial=createDirectorProduction({outputRoot:dir,findBrowser:async()=>"/mock/chromium",
    build:async()=>{},inspect:async()=>({ready:true,findings:[]}),
    jobTracker:()=>({start:async()=>"job-interrupted",advance:async()=>{},complete:async()=>{},
      fail:async()=>{failures++;},cancel:async()=>{}}),
    produce:async()=>{throw Error("Simulated process termination");}});
  await invoke(initial,"POST","/check",payload);
  assert.equal((await invoke(initial,"POST","/start",{...payload,confirmRender:true})).status,202);
  for(let i=0;i<40&&initial.status().state==="rendering";i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(failures,1);
  const [saved]=await listRecoveryIntents(dir);
  assert.equal(saved?.request.settings.localVoiceAuthorized,true);
  assert.equal(saved?.request.settings.apiKey,undefined);
  const latestProductionJob=async()=>({job:{id:"job-interrupted",state:"RUNNING",jobKind:"video-production"},
    nodes:[{nodeKey:"scene-plan",input:{sourceRevision:"saved-script",revision:saved.revision}},
      {id:"node-narration",nodeKey:"narration",state:"READY",errorCode:"worker_lease_expired"}],
    attempts:[{nodeId:"node-narration",state:"FAILED",errorCode:"worker_lease_expired"}]});
  let resumed=0;
  const options={outputRoot:dir,findBrowser:async()=>"/mock/chromium",build:async()=>{},
    inspect:async()=>({ready:true,findings:[]}),latestProductionJob,
    jobTracker:()=>({priorRunId:saved.runId,start:async()=>"job-interrupted",advance:async()=>{},
      complete:async()=>{},fail:async()=>{},cancel:async()=>{}}),
    produce:async(_job,request)=>{
      resumed++;
      const releaseDir=join(request.out,"release");await mkdir(releaseDir,{recursive:true});
      await writeFile(join(releaseDir,"video.mp4"),"completed after restart");return{releaseDir};
    }};
  const a=createDirectorProduction(options),b=createDirectorProduction(options);
  const claimed=await Promise.all([a.recover(),b.recover()]);
  assert.deepEqual(claimed.sort(),[0,1],"a durable reservation prevents duplicate automatic recovery");
  for(let i=0;i<40&&!([a.status().state,b.status().state].includes("done"));i++)
    await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(resumed,1);
  const after=await listRecoveryIntents(dir);
  assert.equal(after.filter(item=>item.autoRecover).length,0,"a second restart needs a deliberate retry");
  const restored=await invoke(createDirectorProduction({outputRoot:dir,latestProductionJob}),"GET",
    `/status/${productionId}?sourceRevision=saved-script`);
  assert.equal(restored.data.state,"done");
});

test("a transient recovery readiness failure does not use up the one automatic restart",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-recovery-preflight-retry-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const productionId="production-"+"b".repeat(24),payload={...inputs(),settings:config,
    productionId,sourceRevision:"confirmed-script"};
  const initial=createDirectorProduction({outputRoot:dir,findBrowser:async()=>"/mock/chromium",
    build:async()=>{},inspect:async()=>({ready:true,findings:[]}),
    jobTracker:()=>({start:async()=>"job-preflight",advance:async()=>{},complete:async()=>{},
      fail:async()=>{},cancel:async()=>{}}),produce:async()=>{throw Error("Simulated stop");}});
  await invoke(initial,"POST","/check",payload);
  await invoke(initial,"POST","/start",{...payload,confirmRender:true});
  for(let i=0;i<40&&initial.status().state==="rendering";i++)await new Promise(resolve=>setTimeout(resolve,5));
  const [saved]=await listRecoveryIntents(dir);
  const latestProductionJob=async()=>({job:{id:"job-preflight",state:"RUNNING",jobKind:"video-production"},
    nodes:[{nodeKey:"scene-plan",input:{sourceRevision:payload.sourceRevision,revision:saved.revision}},
      {nodeKey:"scene-render",id:"node-render",state:"READY",errorCode:"worker_lease_expired"}]});
  let ready=false,starts=0;
  const worker=createDirectorProduction({outputRoot:dir,latestProductionJob,
    findBrowser:async()=>"/mock/chromium",build:async()=>{},
    inspect:async()=>ready?{ready:true,findings:[]}:{ready:false,findings:[{message:"Chromium unavailable"}]},
    jobTracker:()=>({start:async()=>{starts++;return "job-preflight";},advance:async()=>{},
      complete:async()=>{},fail:async()=>{},cancel:async()=>{}}),
    produce:async(_job,request)=>{
      const releaseDir=join(request.out,"release");await mkdir(releaseDir,{recursive:true});
      await writeFile(join(releaseDir,"video.mp4"),"resumed");return{releaseDir};
    }});
  assert.equal(await worker.recover(),0);
  assert.equal(starts,0);
  assert.equal((await listRecoveryIntents(dir))[0]?.autoRecover,true);
  ready=true;
  assert.equal(await worker.recover(),1);
  assert.equal(starts,1);
  for(let i=0;i<40&&worker.status().state==="rendering";i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(worker.status().state,"done");
  assert.equal((await listRecoveryIntents(dir))[0]?.autoRecover,false);
});

test("restart never resurrects a cancelled production or uses missing Fish credentials",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-restart-refused-"));t.after(()=>rm(dir,{recursive:true,force:true}));
  const productionId="production-"+"e".repeat(24),settings={...config,provider:"fish",
    voiceConsent:true,transmitText:true,localVoiceAuthorized:false};
  const payload={...inputs(),settings,productionId,sourceRevision:"fish-script"};
  const initial=createDirectorProduction({outputRoot:dir,providerKey:async()=>"initial-test-key",
    findBrowser:async()=>"/mock/chromium",build:async()=>{},inspect:async()=>({ready:true,findings:[]}),
    jobTracker:()=>({start:async()=>"job-fish",advance:async()=>{},complete:async()=>{},
      fail:async()=>{},cancel:async()=>{}}),produce:async()=>{throw Error("Stopped");}});
  await invoke(initial,"POST","/check",payload);
  assert.equal((await invoke(initial,"POST","/start",{...payload,confirmRender:true})).status,202);
  for(let i=0;i<40&&initial.status().state==="rendering";i++)await new Promise(resolve=>setTimeout(resolve,5));
  const [saved]=await listRecoveryIntents(dir);
  const latest=state=>async()=>({job:{id:"job-fish",state,jobKind:"video-production"},
    nodes:[{nodeKey:"scene-plan",input:{sourceRevision:"fish-script",revision:saved.revision}},
      {id:"node-narration",nodeKey:"narration",state:"READY",errorCode:"worker_lease_expired"}],
    attempts:[{nodeId:"node-narration",errorCode:"worker_lease_expired",state:"FAILED"}]});
  let voices=0;
  const cancelled=createDirectorProduction({outputRoot:dir,latestProductionJob:latest("CANCELLED"),
    providerKey:async()=>{voices++;return "";}});
  assert.equal(await cancelled.recover(),0);
  assert.equal(voices,0);
  const missing=createDirectorProduction({outputRoot:dir,latestProductionJob:latest("FAILED"),
    providerKey:async()=>{voices++;return "";}});
  assert.equal(await missing.recover(),0);
  assert.equal(voices,1);
  assert.equal(missing.status().state,"failed");
  assert.match(missing.status().message,/Fish Audio API key.*Settings/i);
});

test("restart never replays an ordinary failed narration or render attempt automatically",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-no-auto-error-retry-"));t.after(()=>rm(dir,{recursive:true,force:true}));
  const productionId="production-"+"f".repeat(24),payload={...inputs(),settings:config,
    productionId,sourceRevision:"draft-v1"};
  const initial=createDirectorProduction({outputRoot:dir,findBrowser:async()=>"/mock/chromium",
    build:async()=>{},inspect:async()=>({ready:true,findings:[]}),
    jobTracker:()=>({start:async()=>"job-error",advance:async()=>{},complete:async()=>{},
      fail:async()=>{},cancel:async()=>{}}),produce:async()=>{throw Error("Scene failed");}});
  await invoke(initial,"POST","/check",payload);
  await invoke(initial,"POST","/start",{...payload,confirmRender:true});
  for(let i=0;i<40&&initial.status().state==="rendering";i++)await new Promise(resolve=>setTimeout(resolve,5));
  const [saved]=await listRecoveryIntents(dir);
  let renders=0;
  const restarted=createDirectorProduction({outputRoot:dir,latestProductionJob:async()=>({
    job:{id:"job-error",state:"FAILED",jobKind:"video-production"},
    nodes:[{nodeKey:"scene-plan",input:{sourceRevision:"draft-v1",revision:saved.revision}},
      {id:"node-scene",nodeKey:"scene-render",state:"FAILED",errorCode:"scene_render_failed"}],
    attempts:[{nodeId:"node-scene",state:"FAILED",errorCode:"scene_render_failed"}]}),
    findBrowser:async()=>"/mock/chromium",build:async()=>{},inspect:async()=>({ready:true,findings:[]}),
    jobTracker:()=>({start:async()=>{renders++;return "job-error";}})});
  assert.equal(await restarted.recover(),0);
  assert.equal(renders,0,"only worker-crash recovery is automatic; scene failures need an explicit retry");
});

test("an older lease-loss attempt never overrides the latest ordinary render failure",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-history-not-replay-"));t.after(()=>rm(dir,{recursive:true,force:true}));
  const productionId="production-"+"a".repeat(24),payload={...inputs(),settings:config,
    productionId,sourceRevision:"draft-after-manual-retry"};
  const initial=createDirectorProduction({outputRoot:dir,findBrowser:async()=>"/mock/chromium",
    build:async()=>{},inspect:async()=>({ready:true,findings:[]}),
    jobTracker:()=>({start:async()=>"job-history",advance:async()=>{},complete:async()=>{},
      fail:async()=>{},cancel:async()=>{}}),produce:async()=>{throw Error("Stopped");}});
  await invoke(initial,"POST","/check",payload);
  await invoke(initial,"POST","/start",{...payload,confirmRender:true});
  for(let i=0;i<40&&initial.status().state==="rendering";i++)await new Promise(resolve=>setTimeout(resolve,5));
  const [saved]=await listRecoveryIntents(dir);
  let restarted=0;
  const worker=createDirectorProduction({outputRoot:dir,latestProductionJob:async()=>({
    job:{id:"job-history",state:"FAILED",jobKind:"video-production"},
    nodes:[{nodeKey:"scene-plan",input:{sourceRevision:payload.sourceRevision,revision:saved.revision}},
      {id:"node-render",nodeKey:"scene-render",state:"FAILED",errorCode:"scene_render_failed"}],
    attempts:[{nodeId:"node-render",attemptNumber:1,state:"FAILED",errorCode:"worker_lease_expired"},
      {nodeId:"node-render",attemptNumber:2,state:"FAILED",errorCode:"scene_render_failed"}]}),
    jobTracker:()=>({start:async()=>{restarted++;return "job-history";}})});
  assert.equal(await worker.recover(),0);
  assert.equal(restarted,0,"old crash history is not permission to repeat an ordinary failed render");
});

test("a damaged media index blocks another version before Jobs can start",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-recovery-index-failure-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  await writeFile(join(dir,"production-media-index-v1.json"),"{invalid json");
  let completed=0,failed=0;
  const server=createDirectorProduction({outputRoot:dir,findBrowser:async()=>"/mock/chromium",
    build:async()=>{},inspect:async()=>({ready:true,findings:[]}),
    jobTracker:()=>({start:async()=>"job-unindexed",advance:async()=>{},
      complete:async()=>{completed++;},fail:async()=>{failed++;},cancel:async()=>{}}),
    produce:async(_job,options)=>{
      const releaseDir=join(options.out,"release");await mkdir(releaseDir,{recursive:true});
      await writeFile(join(releaseDir,"video.mp4"),"valid film");return{releaseDir};
    }});
  const payload={...inputs(),settings:config,productionId:"production-"+"b".repeat(24)};
  await invoke(server,"POST","/check",payload);
  const attempt=await invoke(server,"POST","/start",{...payload,confirmRender:true});
  assert.equal(attempt.status,422);
  assert.match(attempt.data.error,/saved media index is invalid/i);
  assert.equal(completed,0);
  assert.equal(failed,0);
  assert.equal(await readFile(join(dir,"production-media-index-v1.json"),"utf8"),"{invalid json",
    "unreadable existing production history must not be overwritten");
});

test("Jobs cannot commit success when a renderer's claimed artifact hash is not on disk",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-unverified-export-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  let completed=0,failed=0;
  const server=createDirectorProduction({outputRoot:dir,findBrowser:async()=>"/mock/chromium",
    build:async()=>{},inspect:async()=>({ready:true,findings:[]}),
    jobTracker:()=>({start:async()=>"job-integrity",advance:async()=>{},
      complete:async()=>{completed++;},fail:async()=>{failed++;},cancel:async()=>{}}),
    produce:async(_job,options)=>{
      const releaseDir=join(options.out,"release");await mkdir(releaseDir,{recursive:true});
      await writeFile(join(releaseDir,"video.mp4"),"present but never verified");
      return {releaseDir,manifestHash:"a".repeat(64)};
    }});
  const payload={...inputs(),settings:config,productionId:"production-"+"a".repeat(24)};
  await invoke(server,"POST","/check",payload);
  assert.equal((await invoke(server,"POST","/start",{...payload,confirmRender:true})).status,202);
  for(let i=0;i<50&&server.status().state==="rendering";i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(server.status().state,"failed");
  assert.equal(completed,0);
  assert.equal(failed,1);
  assert.deepEqual((await invoke(server,"GET",`/assets/${payload.productionId}`)).data.assets,[]);
});

test("saved media links never follow a symlinked release folder or thumbnail",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-media-link-safety-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const runId="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",productionId="production-"+"d".repeat(24);
  const owned=join(dir,"draft-"+runId),outside=join(dir,"outside");
  await mkdir(owned);await mkdir(outside);
  await writeFile(join(outside,"thumbnail-1.png"),"private data");
  await writeFile(join(dir,"production-media-index-v1.json"),JSON.stringify({version:1,records:[{
    runId,productionId,sourceRevision:"r1",createdAt:Date.now()}]}));
  await symlink(outside,join(owned,"release"));
  const server=createDirectorProduction({outputRoot:dir,latestProductionJob:async()=>null});
  assert.equal((await invoke(server,"GET",`/media/${runId}/thumbnail-1.png`)).status,404);
  assert.equal((await invoke(server,"GET",`/status/${productionId}?sourceRevision=r1`)).data.state,"idle");
  await rm(join(owned,"release"));
  await mkdir(join(owned,"release"));
  await symlink(join(outside,"thumbnail-1.png"),join(owned,"release","thumbnail-1.png"));
  assert.equal((await invoke(server,"GET",`/media/${runId}/thumbnail-1.png`)).status,404);
  assert.deepEqual((await invoke(server,"GET","/assets/"+productionId)).data.assets,[]);
});

test("simultaneous independent producers never erase each other's completed release records",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-media-race-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  let releaseCount=0,releaseBoth;
  const ready=new Promise(resolve=>{releaseBoth=resolve;});
  const server=()=>createDirectorProduction({outputRoot:dir,findBrowser:async()=>"/mock/chromium",
    build:async()=>{},inspect:async()=>({ready:true,findings:[]}),
    jobTracker:()=>({start:async()=>"job-running",advance:async()=>{},complete:async()=>{},
      fail:async()=>{},cancel:async()=>{}}),
    produce:async(_job,options)=>{
      const releaseDir=join(options.out,"release");await mkdir(releaseDir,{recursive:true});
      await writeFile(join(releaseDir,"video.mp4"),"independent film");
      if(++releaseCount===2)releaseBoth();
      await ready;return{releaseDir};
    }});
  const first=server(),second=server();
  const a={...inputs(),settings:config,productionId:"production-"+"a".repeat(24),sourceRevision:"a1"};
  const b={...inputs(),settings:config,productionId:"production-"+"b".repeat(24),sourceRevision:"b1"};
  assert.equal((await invoke(first,"POST","/check",a)).status,200);
  assert.equal((await invoke(second,"POST","/check",b)).status,200);
  const starts=await Promise.all([invoke(first,"POST","/start",{...a,confirmRender:true}),
    invoke(second,"POST","/start",{...b,confirmRender:true})]);
  assert.deepEqual(starts.map(result=>result.status),[202,202]);
  for(let i=0;i<90&&[first,second].some(instance=>instance.status().state==="rendering");i++)
    await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(first.status().state,"done");assert.equal(second.status().state,"done");
  const records=await readdir(join(dir,"production-media-records-v1"));
  assert.equal(records.filter(name=>name.endsWith(".json")).length,2);
  const restarted=createDirectorProduction({outputRoot:dir,latestProductionJob:async()=>null});
  for(const payload of [a,b]){
    const files=await invoke(restarted,"GET","/assets/"+payload.productionId);
    assert.equal(files.data.assets.filter(asset=>asset.kind==="video").length,1);
    assert.equal((await invoke(restarted,"GET",`/status/${payload.productionId}?sourceRevision=${payload.sourceRevision}`)).data.state,"done");
  }
});

test("legacy production-media-index entries remain readable and untouched after the record migration",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-media-index-compat-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const runId="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",productionId="production-"+"f".repeat(24);
  const release=join(dir,"draft-"+runId,"release");await mkdir(release,{recursive:true});
  await writeFile(join(release,"video.mp4"),"previous version's film");
  const legacy=JSON.stringify({version:1,records:[{runId,productionId,sourceRevision:"old-script",
    createdAt:Date.now()}]})+"\n";
  const path=join(dir,"production-media-index-v1.json");await writeFile(path,legacy);
  const server=createDirectorProduction({outputRoot:dir,latestProductionJob:async()=>null});
  assert.equal((await invoke(server,"GET","/assets/"+productionId)).data.assets[0].kind,"video");
  assert.equal((await invoke(server,"GET",`/status/${productionId}?sourceRevision=old-script`)).data.state,"done");
  assert.equal(await readFile(path,"utf8"),legacy);
});

test("restart and media links reject a changed release artifact and a missing export manifest",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-media-integrity-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const runId="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",productionId="production-"+"f".repeat(24);
  const release=join(dir,"draft-"+runId,"release");
  const records=join(dir,"production-media-records-v1");
  await mkdir(release,{recursive:true});await mkdir(records);
  const digest=value=>createHash("sha256").update(value).digest("hex");
  const original=Buffer.from("completed video contents"),thumbnail=Buffer.from("verified thumbnail contents");
  const source=Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
  await writeFile(join(release,"video.mp4"),original);
  await writeFile(join(release,"thumbnail-1.png"),thumbnail);
  await writeFile(join(release,"thumbnail-1.svg"),source);
  const manifest=Buffer.from(JSON.stringify({schemaVersion:1,
    artifacts:{video:digest(original),"thumbnail-1":digest(thumbnail)},
    thumbnails:[{source:"thumbnail-1.svg",sourceSha256:digest(source)}]}));
  await writeFile(join(release,"render-manifest.json"),manifest);
  await writeFile(join(records,runId+".json"),JSON.stringify({version:1,record:{runId,productionId,
    sourceRevision:"revision-1",createdAt:Date.now(),manifestHash:digest(manifest)}}));
  const server=createDirectorProduction({outputRoot:dir,latestProductionJob:async()=>null});
  const statusPath=`/status/${productionId}?sourceRevision=revision-1`;
  assert.equal((await invoke(server,"GET",statusPath)).data.state,"done");
  assert.equal((await invoke(server,"GET",`/assets/${productionId}`)).data.assets.length,2);
  assert.equal((await audioResponse(server,`/media/${runId}/thumbnail-1.png`)).bytes.toString(),thumbnail.toString());
  assert.equal((await audioResponse(server,`/media/${runId}/thumbnail-1.svg`)).bytes.toString(),source.toString());

  await writeFile(join(release,"video.mp4"),"altered, invalid and longer video bytes");
  const damaged=await invoke(server,"GET",statusPath);
  assert.equal(damaged.data.state,"failed",
    "a nonempty but changed MP4 must not be advertised as a completed production");
  assert.match(damaged.data.message,/no longer matches.*generate the draft again/i);
  assert.equal((await invoke(server,"GET",`/media/${runId}/video.mp4`)).status,404);
  assert.deepEqual((await invoke(server,"GET",`/assets/${productionId}`)).data.assets.map(item=>item.filename),
    ["thumbnail-1.png"],"an unaffected verified thumbnail remains available");
  await writeFile(join(release,"video.mp4"),Buffer.alloc(original.length,0x41));
  assert.equal((await invoke(server,"GET",statusPath)).data.state,"failed",
    "a same-size in-place rewrite must invalidate cached file verification");

  await writeFile(join(release,"thumbnail-1.png"),"corrupt thumbnail bytes of a different size");
  assert.equal((await invoke(server,"GET",`/media/${runId}/thumbnail-1.png`)).status,404);
  await writeFile(join(release,"thumbnail-1.svg"),"tampered composition");
  assert.equal((await invoke(server,"GET",`/media/${runId}/thumbnail-1.svg`)).status,404);
  await writeFile(join(release,"video.mp4"),original);
  await rm(join(release,"render-manifest.json"));
  assert.equal((await invoke(server,"GET",statusPath)).data.state,"failed",
    "a modern release cannot bypass its integrity proof by deleting the manifest");
});

test("an opted-in draft saves scene-specific free media suggestions with Jobs provenance across restart",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-auto-assets-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const productionId="production-"+"c".repeat(24),events=[],searchCalls=[];
  const suggestion={kind:"contentgen-scene-asset-suggestions",schemaVersion:1,
    scenes:[{shotId:inputs().bundle.plan.shots[0].id,query:"house",strategy:"search",reason:"Physical subject",
      candidates:[{provider:"pexels",assetId:"42",title:"A house exterior",previewUrl:"",sourceUrl:"https://www.pexels.com/photo/house-42",
        license:"Pexels License",licenseUrl:"https://www.pexels.com/license/",rightsStatus:"needs-human-review"},
      {provider:"openverse",assetId:"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",title:"Roof restoration",
        previewUrl:"https://api.openverse.org/v1/images/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/thumb/",
        sourceUrl:"https://example.org/roof",license:"CC0-1.0 (unverified index)",
        licenseUrl:"https://creativecommons.org/publicdomain/zero/1.0/",rightsStatus:"needs-human-review"}]}],
    warnings:["A provider returned no other usable alternatives."]};
  const server=createDirectorProduction({outputRoot:dir,findBrowser:async()=>"/mock/chromium",
    build:async()=>{},inspect:async()=>({ready:true,findings:[]}),
    searchAssets:async(input,options)=>{searchCalls.push({input,options});return suggestion;},
    jobTracker:()=>({start:async()=>"job-media-1",advance:async(...args)=>events.push(args),
      complete:async()=>events.push(["complete"]),fail:async()=>events.push(["fail"]),cancel:async()=>{}}),
    produce:async(_job,options)=>{
      options.onProgress({phase:"browser-preflight"});
      options.onProgress({phase:"asset-search"});
      const summary=await options.prepareAssetSuggestions({signal:options.signal});
      options.onProgress({phase:"asset-preparation",assetSearchSummary:summary});
      options.onProgress({phase:"narration",
        artifactLedger:{kind:"asset-preparation",fingerprint:"a".repeat(64),selected:[
          {beatId:"beat-01",assetType:"photo",sha256:"b".repeat(64)}]}});
      const releaseDir=join(options.out,"release");await mkdir(releaseDir,{recursive:true});
      await writeFile(join(releaseDir,"video.mp4"),"mock video");
      return{releaseDir};
    }});
  const payload={...inputs(),settings:config,productionId,sourceRevision:"revision-1",searchFreeMedia:true};
  assert.equal((await invoke(server,"POST","/check",payload)).status,200);
  assert.equal((await invoke(server,"POST","/start",{...payload,confirmRender:true})).status,202);
  for(let i=0;i<60&&server.status().state==="rendering";i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(server.status().state,"done");
  assert.equal(searchCalls.length,1);
  assert.equal(searchCalls[0].input.allowExternalSearch,true);
  assert.deepEqual(searchCalls[0].input.providers,["polyhaven","openverse"]);
  assert.equal(searchCalls[0].options.pexelsKey,undefined);
  assert.deepEqual(events.map(entry=>entry[0]),["browser-preflight","asset-search","asset-preparation","narration","complete"]);
  assert.equal(events[2][1].assetSearch.status,"partial");
  assert.equal(events[2][1].assetSearch.candidates,2);
  assert.equal(events[3][1].artifactLedger.selected[0].sha256,"b".repeat(64));
  const restarted=createDirectorProduction({outputRoot:dir});
  const saved=await invoke(restarted,"GET","/suggestions/"+productionId);
  assert.equal(saved.status,200);assert.equal(saved.data.found,true);
  assert.deepEqual(saved.data.sourceShots,payload.bundle.plan.shots);
  assert.deepEqual(saved.data.sourceSound,payload.bundle.plan.sound);
  assert.deepEqual(saved.data.suggestions,suggestion);
  assert.equal((await invoke(restarted,"GET","/suggestions/production-"+"d".repeat(24))).data.found,false);
  assert.equal((await invoke(restarted,"GET","/suggestions/../secrets")).status,404);
});

test("automatic free media uses no Pexels API key even when a legacy key exists in the environment",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-photo-consent-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  let received=null;
  const server=createDirectorProduction({outputRoot:dir,env:{PEXELS_API_KEY:"old-unused-private-key"},
    findBrowser:async()=>"/mock/chromium",build:async()=>{},
    inspect:async()=>({ready:true,findings:[]}),
    searchAssets:async()=>({kind:"contentgen-scene-asset-suggestions",warnings:[],scenes:[]}),
    jobTracker:()=>({start:async()=>"job-auto-1",advance:async()=>{},complete:async()=>{},fail:async()=>{},cancel:async()=>{}}),
    produce:async(_job,options)=>{
      received={enabled:options.autoPrepareFreeMedia,key:options.pexelsKey};
      const releaseDir=join(options.out,"release");await mkdir(releaseDir,{recursive:true});
      await writeFile(join(releaseDir,"video.mp4"),"mock video");
      return {releaseDir};
    }});
  const payload={...inputs(),settings:config,productionId:"production-"+"c".repeat(24),
    searchFreeMedia:true,autoPrepareFreeMedia:true};
  assert.equal((await invoke(server,"POST","/check",{...payload,searchFreeMedia:false})).status,200);
  assert.equal((await invoke(server,"POST","/check",{...payload,autoPrepareFreeMedia:"yes"})).status,422);
  assert.equal((await invoke(server,"POST","/check",payload)).status,200);
  assert.equal((await invoke(server,"POST","/start",{...payload,confirmRender:true})).status,202);
  for(let i=0;i<60&&server.status().state==="rendering";i++)await new Promise(r=>setTimeout(r,5));
  assert.deepEqual(received,{enabled:true,key:undefined});
  assert.doesNotMatch(JSON.stringify(server.status()),/old-unused-private-key/);
});

test("retry reuses the interrupted run's intact scene catalog without another provider request",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-assets-retry-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const oldRun="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const productionId="production-"+"c".repeat(24),bundle=inputs().bundle;
  const suggestions={kind:"contentgen-scene-asset-suggestions",schemaVersion:1,warnings:[],scenes:[
    {shotId:bundle.plan.shots[0].id,candidates:[{provider:"pexels",title:"House exterior",
      sourceUrl:"https://www.pexels.com/photo/house-42",previewUrl:"",licenseUrl:"https://www.pexels.com/license/"}]}]};
  const previous={schemaVersion:1,productionId,sourceShots:bundle.plan.shots,
    sourceSound:bundle.plan.sound??[],suggestions};
  const oldPath=join(dir,"draft-"+oldRun);await mkdir(oldPath);
  await writeFile(join(oldPath,"asset-suggestions.json"),JSON.stringify(previous));
  let searches=0,summary;
  const server=createDirectorProduction({outputRoot:dir,findBrowser:async()=>"/mock/chromium",
    build:async()=>{},inspect:async()=>({ready:true,findings:[]}),
    searchAssets:async()=>{searches++;throw Error("unnecessary provider call");},
    jobTracker:()=>({priorRunId:oldRun,start:async()=>"job-resumed",advance:async()=>{},
      complete:async()=>{},fail:async()=>{},cancel:async()=>{}}),
    produce:async(_job,options)=>{
      summary=await options.prepareAssetSuggestions({signal:options.signal});
      const releaseDir=join(options.out,"release");await mkdir(releaseDir,{recursive:true});
      await writeFile(join(releaseDir,"video.mp4"),"retry film");return{releaseDir};
    }});
  const payload={...inputs(),settings:config,productionId,sourceRevision:"r1",searchFreeMedia:true};
  await invoke(server,"POST","/check",payload);
  assert.equal((await invoke(server,"POST","/start",{...payload,confirmRender:true})).status,202);
  for(let i=0;i<70&&server.status().state==="rendering";i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(server.status().state,"done");
  assert.equal(searches,0);
  assert.equal(summary.status,"completed");
  assert.equal(summary.reused,true);
  assert.match(server.status().message,/reused 1 saved media suggestion/i);
  const saved=await invoke(server,"GET","/suggestions/"+productionId);
  assert.deepEqual(saved.data.suggestions,suggestions);
  assert.deepEqual(JSON.parse(await readFile(join(dir,"draft-"+oldRun,"asset-suggestions.json"),"utf8")),previous,
    "the original catalog remains unchanged");
});

test("retry refuses a symlinked catalog and searches again",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-assets-stale-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const oldRun="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",bundle=inputs().bundle;
  const stale={schemaVersion:1,productionId:"production-"+"f".repeat(24),
    sourceShots:[{id:"old-shot"}],sourceSound:[],suggestions:{kind:"contentgen-scene-asset-suggestions",scenes:[],warnings:[]}};
  const oldPath=join(dir,"draft-"+oldRun);await mkdir(oldPath);
  const outside=join(dir,"not-a-catalog.json");await writeFile(outside,JSON.stringify(stale));
  await symlink(outside,join(oldPath,"asset-suggestions.json"));
  const fresh={kind:"contentgen-scene-asset-suggestions",schemaVersion:1,
    scenes:bundle.plan.shots.map(shot=>({shotId:shot.id,candidates:[]})),warnings:[]};
  let searches=0;
  const server=createDirectorProduction({outputRoot:dir,findBrowser:async()=>"/mock/chromium",
    build:async()=>{},inspect:async()=>({ready:true,findings:[]}),
    searchAssets:async()=>{searches++;return fresh;},
    jobTracker:()=>({priorRunId:oldRun,start:async()=>"job-resumed",advance:async()=>{},
      complete:async()=>{},fail:async()=>{},cancel:async()=>{}}),
    produce:async(_job,options)=>{
      await options.prepareAssetSuggestions({signal:options.signal});
      const releaseDir=join(options.out,"release");await mkdir(releaseDir,{recursive:true});
      await writeFile(join(releaseDir,"video.mp4"),"fresh film");return{releaseDir};
    }});
  const payload={...inputs(),settings:config,productionId:"production-"+"f".repeat(24),searchFreeMedia:true};
  await invoke(server,"POST","/check",payload);
  assert.equal((await invoke(server,"POST","/start",{...payload,confirmRender:true})).status,202);
  for(let i=0;i<70&&server.status().state==="rendering";i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(server.status().state,"done");
  assert.equal(searches,1);
  assert.deepEqual((await invoke(server,"GET","/suggestions/"+payload.productionId)).data.suggestions,fresh);
});

test("retry searches again when the saved catalog belongs to an older scene plan",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-assets-new-plan-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const oldRun="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",productionId="production-"+"a".repeat(24);
  const bundle=inputs().bundle,oldPath=join(dir,"draft-"+oldRun);
  await mkdir(oldPath);
  await writeFile(join(oldPath,"asset-suggestions.json"),JSON.stringify({schemaVersion:1,productionId,
    sourceShots:[{id:"old-scene"}],sourceSound:bundle.plan.sound??[],
    suggestions:{kind:"contentgen-scene-asset-suggestions",schemaVersion:1,scenes:[],warnings:[]}}));
  let calls=0;
  const server=createDirectorProduction({outputRoot:dir,findBrowser:async()=>"/mock/chromium",
    build:async()=>{},inspect:async()=>({ready:true,findings:[]}),
    searchAssets:async()=>{calls++;return{kind:"contentgen-scene-asset-suggestions",schemaVersion:1,
      scenes:[],warnings:[]};},
    jobTracker:()=>({priorRunId:oldRun,start:async()=>"job-retried",advance:async()=>{},
      complete:async()=>{},fail:async()=>{},cancel:async()=>{}}),
    produce:async(_job,options)=>{
      const summary=await options.prepareAssetSuggestions({signal:options.signal});
      assert.equal(summary.reused,undefined);
      const releaseDir=join(options.out,"release");await mkdir(releaseDir,{recursive:true});
      await writeFile(join(releaseDir,"video.mp4"),"updated scene film");return{releaseDir};
    }});
  const payload={...inputs(),settings:config,productionId,searchFreeMedia:true};
  await invoke(server,"POST","/check",payload);
  assert.equal((await invoke(server,"POST","/start",{...payload,confirmRender:true})).status,202);
  for(let i=0;i<70&&server.status().state==="rendering";i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(server.status().state,"done");
  assert.equal(calls,1);
});

test("retry never reads media catalogs from a non-UUID worker run path",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-assets-run-id-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const productionId="production-"+"b".repeat(24),bundle=inputs().bundle;
  const stray=join(dir,"not-an-owned-run");await mkdir(stray);
  await writeFile(join(stray,"asset-suggestions.json"),JSON.stringify({schemaVersion:1,productionId,
    sourceShots:bundle.plan.shots,sourceSound:bundle.plan.sound??[],
    suggestions:{kind:"contentgen-scene-asset-suggestions",schemaVersion:1,scenes:[],warnings:[]}}));
  let searches=0;
  const server=createDirectorProduction({outputRoot:dir,findBrowser:async()=>"/mock/chromium",
    build:async()=>{},inspect:async()=>({ready:true,findings:[]}),
    searchAssets:async()=>{searches++;return{kind:"contentgen-scene-asset-suggestions",schemaVersion:1,
      scenes:[],warnings:[]};},
    jobTracker:()=>({priorRunId:"x/../not-an-owned-run",start:async()=>"job-malformed",advance:async()=>{},
      complete:async()=>{},fail:async()=>{},cancel:async()=>{}}),
    produce:async(_job,options)=>{
      await options.prepareAssetSuggestions({signal:options.signal});
      const releaseDir=join(options.out,"release");await mkdir(releaseDir,{recursive:true});
      await writeFile(join(releaseDir,"video.mp4"),"new file");return{releaseDir};
    }});
  const payload={...inputs(),settings:config,productionId,searchFreeMedia:true};
  await invoke(server,"POST","/check",payload);
  assert.equal((await invoke(server,"POST","/start",{...payload,confirmRender:true})).status,202);
  for(let i=0;i<70&&server.status().state==="rendering";i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(server.status().state,"done");
  assert.equal(searches,1);
});

test("unavailable optional scene providers never block video or silently create a media match",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-search-fallback-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  let summary,searchCalls=0;
  const server=createDirectorProduction({outputRoot:dir,findBrowser:async()=>"/mock/chromium",
    build:async()=>{},inspect:async()=>({ready:true,findings:[]}),
    searchAssets:async()=>{searchCalls++;throw Error("Provider timed out");},
    jobTracker:()=>({start:async()=>"job-media-2",advance:async()=>{},complete:async()=>{},fail:async()=>{},cancel:async()=>{}}),
    produce:async(_job,options)=>{
      if(options.prepareAssetSuggestions)summary=await options.prepareAssetSuggestions({signal:options.signal});
      const releaseDir=join(options.out,"release");await mkdir(releaseDir,{recursive:true});
      await writeFile(join(releaseDir,"video.mp4"),"rendered without unrelated stock");
      return{releaseDir};
    }});
  const payload={...inputs(),settings:config,productionId:"production-"+"f".repeat(24),searchFreeMedia:true};
  await invoke(server,"POST","/check",payload);
  await invoke(server,"POST","/start",{...payload,confirmRender:true});
  for(let i=0;i<60&&server.status().state==="rendering";i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(server.status().state,"done");
  assert.equal(searchCalls,1);
  assert.deepEqual(summary,{status:"fallback",scenes:0,candidates:0,warnings:["Provider timed out"]});
  assert.equal((await invoke(server,"GET","/suggestions/"+payload.productionId)).data.found,false);
  assert.equal((await invoke(server,"POST","/check",{...payload,searchFreeMedia:false})).status,200);
  assert.equal((await invoke(server,"POST","/start",{...payload,searchFreeMedia:true,confirmRender:true})).status,409,
    "media-search consent is part of the preflight fingerprint");
  assert.equal((await invoke(server,"POST","/check",{...payload,searchFreeMedia:"yes"})).status,422);
});

test("cancel during online scene search remains cancelled even if a Jobs transition races it",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-search-cancel-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  let notifyStarted=()=>{},cancelled=false,voiceCalls=0;
  const searchStarted=new Promise(resolve=>{notifyStarted=resolve;});
  const server=createDirectorProduction({outputRoot:dir,findBrowser:async()=>"/mock/chromium",
    build:async()=>{},inspect:async()=>({ready:true,findings:[]}),
    searchAssets:async(_input,{signal})=>{
      notifyStarted();
      return await new Promise((_resolve,reject)=>{
        signal.addEventListener("abort",()=>reject(signal.reason),{once:true});
      });
    },
    jobTracker:()=>({start:async()=>"job-cancel",advance:async()=>{
      await new Promise(resolve=>setTimeout(resolve,12));
      if(cancelled)throw Error("Scheduler already cancelled this attempt.");
    },complete:async()=>{},fail:async()=>{},cancel:async()=>{cancelled=true;}}),
    produce:async(_job,options)=>{
      options.onProgress({phase:"browser-preflight"});
      options.onProgress({phase:"asset-search"});
      await options.prepareAssetSuggestions({signal:options.signal});
      voiceCalls++;
      throw Error("Voice generation should never run after cancellation.");
    }});
  const payload={...inputs(),settings:config,productionId:"production-"+"d".repeat(24),searchFreeMedia:true};
  await invoke(server,"POST","/check",payload);
  assert.equal((await invoke(server,"POST","/start",{...payload,confirmRender:true})).status,202);
  await searchStarted;
  assert.equal((await invoke(server,"POST","/cancel",{confirmed:true})).status,202);
  for(let i=0;i<60&&server.status().state==="rendering";i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(server.status().state,"cancelled");
  assert.equal(voiceCalls,0);
});

test("production renderer refuses to run if the durable Jobs service is unavailable",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-no-jobs-test-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  let renders=0;
  const server=createDirectorProduction({outputRoot:dir,findBrowser:async()=>"/mock/chromium",
    build:async()=>{},inspect:async()=>({ready:true,findings:[]}),
    jobTracker:()=>({start:async()=>{throw Error("Start the local Rust ContentGen server");}}),
    produce:async()=>{renders++;}});
  const payload={...inputs(),settings:config,productionId:"production-"+"a".repeat(24)};
  await invoke(server,"POST","/check",payload);
  const result=await invoke(server,"POST","/start",{...payload,confirmRender:true});
  assert.equal(result.status,422);assert.match(result.data.error,/Rust ContentGen server/);
  assert.equal(renders,0);
});

test("completed renders are discoverable by production across server restarts, never by another production",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-assets-test-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const productionId="production-"+"a".repeat(24),otherId="production-"+"b".repeat(24);
  const server=createDirectorProduction({outputRoot:dir,findBrowser:async()=>"/mock/chromium",
    jobTracker:()=>({start:async()=>"test-job",advance:async()=>{},complete:async()=>{},fail:async()=>{},cancel:async()=>{}}),
    build:async()=>{},inspect:async()=>({ready:true,findings:[],tools:{}}),
    produce:async(_job,opts)=>{
      const releaseDir=join(opts.out,"release");
      await mkdir(releaseDir,{recursive:true});
      await writeFile(join(releaseDir,"video.mp4"),"mock video media");
      await writeFile(join(releaseDir,"captions.srt"),"1\n00:00:00,000 --> 00:00:01,000\nTest");
      await writeFile(join(releaseDir,"cover-still.png"),"mock reviewed frame");
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
  assert.deepEqual(own.data.assets.map(asset=>asset.kind).sort(),["captions","thumbnail","video"]);
  assert.ok(own.data.assets.every(asset=>asset.platform==="youtube"));
  assert.ok(own.data.assets.every(asset=>asset.sourceRevision===params.sourceRevision));
  assert.match(own.data.assets[0].downloadUrl,/^\/api\/contentgen-video\/media\//);
  const cover=own.data.assets.find(asset=>asset.kind==="thumbnail");
  const served=await audioResponse(restarted,cover.downloadUrl.replace("/api/contentgen-video",""));
  assert.equal(served.status,200);
  assert.equal(served.headers["Content-Type"],"image/png");
  assert.equal(served.headers["Content-Disposition"],'attachment; filename="cover-still.png"');
  assert.equal(served.bytes.toString(),"mock reviewed frame");
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

