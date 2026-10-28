import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
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
  const server=createDirectorProduction({outputRoot:dir,findBrowser:async()=>"/mock/chromium",
    build:async()=>{},inspect:async()=>({ready:true,findings:[]}),
    jobTracker:()=>({start:async input=>{events.push(["start",input.productionId]);return "job-persisted";},
      advance:async(phase,payload)=>events.push(["advance",phase,payload]),
      complete:async payload=>events.push(["complete",payload]),fail:async()=>events.push(["fail"]),
      cancel:async()=>events.push(["cancel"])}),
    produce:async (_job,opts)=>{
      const releaseDir=join(opts.out,"release");await mkdir(releaseDir,{recursive:true});
      await writeFile(join(releaseDir,"video.mp4"),"mock media");
      opts.onProgress({phase:"narration"});opts.onProgress({phase:"rendering",completedFrames:12,totalFrames:12,
        artifactLedger:{kind:"sound-mix",masterSha256:"a".repeat(64),samples:96000}});
      return {releaseDir,manifestHash:"b".repeat(64),artifactHashes:{video:"c".repeat(64),captions:"d".repeat(64)}};
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
  assert.deepEqual(events[3][1],{artifactLedger:{kind:"export-package",manifestHash:"b".repeat(64),
    artifacts:{video:"c".repeat(64),captions:"d".repeat(64)}}});
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

test("an opted-in draft saves scene-specific free media suggestions with Jobs provenance across restart",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-auto-assets-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const productionId="production-"+"c".repeat(24),events=[],searchCalls=[];
  const suggestion={kind:"contentgen-scene-asset-suggestions",schemaVersion:1,
    scenes:[{shotId:inputs().bundle.plan.shots[0].id,query:"house",strategy:"search",reason:"Physical subject",
      candidates:[{provider:"pexels",assetId:"42",title:"A house exterior",previewUrl:"",sourceUrl:"https://www.pexels.com/photo/house-42",
        license:"Pexels License",licenseUrl:"https://www.pexels.com/license/",rightsStatus:"needs-human-review"}]}],
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
  assert.equal(searchCalls[0].options.pexelsKey,undefined);
  assert.deepEqual(events.map(entry=>entry[0]),["browser-preflight","asset-search","asset-preparation","narration","complete"]);
  assert.equal(events[2][1].assetSearch.status,"partial");
  assert.equal(events[2][1].assetSearch.candidates,1);
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

test("automatic draft photos require their own opt-in and pass Pexels credentials only to the backend",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"director-photo-consent-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  let received=null;
  const server=createDirectorProduction({outputRoot:dir,env:{PEXELS_API_KEY:"test-private-key"},
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
  assert.equal((await invoke(server,"POST","/check",{...payload,searchFreeMedia:false})).status,422);
  assert.equal((await invoke(server,"POST","/check",{...payload,autoPrepareFreeMedia:"yes"})).status,422);
  assert.equal((await invoke(server,"POST","/check",payload)).status,200);
  assert.equal((await invoke(server,"POST","/start",{...payload,autoPrepareFreeMedia:false,confirmRender:true})).status,409,
    "changing automatic download settings invalidates the readiness identity");
  assert.equal((await invoke(server,"POST","/start",{...payload,confirmRender:true})).status,202);
  for(let i=0;i<60&&server.status().state==="rendering";i++)await new Promise(r=>setTimeout(r,5));
  assert.deepEqual(received,{enabled:true,key:"test-private-key"});
  assert.doesNotMatch(JSON.stringify(server.status()),/test-private-key/);
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

