import test from "node:test";
import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {createHash} from "node:crypto";
import {mkdtemp,readFile,rm,writeFile,readdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {downloadPexelsDraftPhoto,downloadPexelsDraftVideo} from "./asset-discovery.mjs";
import {prepareAutomaticDraftMedia} from "./automatic-draft-assets.mjs";

const exec=promisify(execFile);
const hash=value=>createHash("sha256").update(value).digest("hex");
const bytes=Buffer.from([0xff,0xd8,0xff,0xe0,0,0,0,0,0,0,0,0xff,0xd9]);
const meta=assetId=>({provider:"pexels",assetId,assetType:"photo",
  sourceUrl:`https://www.pexels.com/photo/a-roof-${assetId}/`,license:"Pexels License",
  licenseUrl:"https://www.pexels.com/license/",creator:"Maker"});
const candidate=assetId=>({...meta(assetId),title:"Residential roof with sunlight",
  match:{grade:"strong",score:80}});
const scene=(shotId,assetId)=>({shotId,candidates:[candidate(assetId)]});
const suggestions=scenes=>({kind:"contentgen-scene-asset-suggestions",scenes});
const shotMap=[{shotId:"shot-a",beatId:"beat-a"},{shotId:"shot-b",beatId:"beat-b"},
  {shotId:"shot-c",beatId:"beat-c"}];
const existing=()=>({bindings:{},assets:[],fingerprint:hash("approved-assets")});
const probePhoto=async()=>({codec:"mjpeg",width:1280,height:720});
const videoBytes=Buffer.from("0000ftyp0000fake-mp4");
const videoMeta=assetId=>({provider:"pexels",assetId,assetType:"video",
  sourceUrl:`https://www.pexels.com/video/roof-footage-${assetId}/`,
  license:"Pexels License",licenseUrl:"https://www.pexels.com/license/",
  creator:"Videographer",durationSeconds:12});
const videoCandidate=assetId=>({...videoMeta(assetId),title:"Close-up home roof repair",
  match:{grade:"strong",score:82}});
const probeVideo=async()=>({codec:"h264",width:1280,height:720,durationSeconds:12});

test("automatic draft images honor manually pinned scenes and avoid duplicate photos",async t=>{
  const out=await mkdtemp(join(tmpdir(),"contentgen-auto-photos-"));
  t.after(()=>rm(out,{recursive:true,force:true}));
  const pinned={...existing(),bindings:{"beat-a":{provider:"pexels",assetId:"17",sha256:hash("pin")}}};
  const calls=[];
  const work={beginScene:async info=>{calls.push(["begin",info.sceneId]);return info.sceneId;},
    completeScene:async(id,result)=>calls.push(["complete",id,result.sha256]),
    failScene:async(id)=>calls.push(["fail",id])};
  const input={suggestions:suggestions([scene("shot-a","17"),scene("shot-b","42"),scene("shot-c","42")]),
    shotMap,existing:pinned,outputDir:out,pexelsKey:"test",sceneJobs:work};
  const result=await prepareAutomaticDraftMedia(input,{downloadPhoto:async id=>({bytes,meta:meta(id)}),probePhoto});
  assert.equal(result.prepared,1);
  assert.equal(result.bindings["beat-a"],pinned.bindings["beat-a"],"manual selection remains untouched");
  assert.equal(result.bindings["beat-b"].assetId,"42");
  assert.equal(result.bindings["beat-b"].rightsStatus,"draft-provider-license");
  assert.equal(result.bindings["beat-c"],undefined,"one photo cannot repeat as distinct scenes");
  assert.equal(result.assets.length,1);
  assert.deepEqual(calls.map(item=>item.slice(0,2)),[["begin","beat-b"],["complete","beat-b"]]);
  assert.equal(hash(await readFile(result.assets[0].path)),result.assets[0].sha256);

  const recovered=await prepareAutomaticDraftMedia({...input,existing:pinned},
    {downloadPhoto:()=>{throw Error("Cached photo must not download again");},probePhoto});
  assert.equal(recovered.prepared,1);
  assert.equal(recovered.fingerprint,result.fingerprint);
  assert.equal(calls.length,2,"verified cache reuse does not duplicate a completed scene Job");
});

test("an unsuitable first provider asset retries one different ranked candidate in its own durable Jobs attempt",async t=>{
  const out=await mkdtemp(join(tmpdir(),"contentgen-auto-alternate-"));
  t.after(()=>rm(out,{recursive:true,force:true}));
  const calls=[];
  const sceneJobs={beginScene:async({sceneId,fingerprint})=>{
    calls.push(["begin",sceneId,fingerprint]);return fingerprint;},
  completeScene:async(id)=>calls.push(["complete",id]),
  failScene:async(id)=>calls.push(["fail",id])};
  const result=await prepareAutomaticDraftMedia({suggestions:suggestions([
    {shotId:"shot-a",candidates:[candidate("71"),candidate("72")]}]),
    shotMap,existing:existing(),outputDir:out,pexelsKey:"test",sceneJobs},
  {downloadPhoto:async id=>{
    calls.push(["download",id]);
    if(id==="71")throw Error("Pexels original unavailable");
    return {bytes,meta:meta(id)};
  },probePhoto});
  assert.equal(result.prepared,1);
  assert.equal(result.bindings["beat-a"].assetId,"72");
  assert.deepEqual(calls.filter(entry=>entry[0]==="download").map(entry=>entry[1]),["71","72"]);
  assert.equal(calls.filter(entry=>entry[0]==="begin").length,2);
  assert.equal(new Set(calls.filter(entry=>entry[0]==="begin").map(entry=>entry[2])).size,2);
  assert.equal(calls.filter(entry=>entry[0]==="fail").length,1);
  assert.equal(calls.filter(entry=>entry[0]==="complete").length,1);
  assert.match(result.warnings.join(" "),/one suggested Pexels asset was unavailable/i);
});

test("a speculative backup never takes the only suitable original from another scene",async t=>{
  const out=await mkdtemp(join(tmpdir(),"contentgen-auto-fair-"));
  t.after(()=>rm(out,{recursive:true,force:true}));
  const attempts=[];
  const result=await prepareAutomaticDraftMedia({suggestions:suggestions([
    {shotId:"shot-a",candidates:[candidate("71"),candidate("72")]},scene("shot-b","72")]),
    shotMap,existing:existing(),outputDir:out,pexelsKey:"test"},
  {downloadPhoto:async id=>{
    attempts.push(id);
    if(id==="71")throw Error("First original unavailable");
    return {bytes,meta:meta(id)};
  },probePhoto});
  assert.equal(result.prepared,1);
  assert.equal(result.bindings["beat-a"],undefined);
  assert.equal(result.bindings["beat-b"].assetId,"72");
  assert.deepEqual(attempts.sort(),["71","72"],"a candidate is never downloaded twice across scenes");
});

test("failed provider requests have a whole-production budget even across many scenes",async t=>{
  const out=await mkdtemp(join(tmpdir(),"contentgen-auto-attempt-budget-"));
  t.after(()=>rm(out,{recursive:true,force:true}));
  const map=Array.from({length:12},(_,i)=>({shotId:`shot-${i}`,beatId:`beat-${i}`}));
  const proposals=map.map(({shotId},i)=>({shotId,
    candidates:[candidate(String(i*2+100)),candidate(String(i*2+101))]}));
  const attempted=[];
  const result=await prepareAutomaticDraftMedia({suggestions:suggestions(proposals),shotMap:map,
    existing:existing(),outputDir:out,pexelsKey:"test"},{downloadPhoto:async id=>{
    attempted.push(id);throw Error("Provider temporarily unavailable");
  },probePhoto});
  assert.equal(result.prepared,0);
  assert.equal(attempted.length,6,"unavailable providers cannot trigger 24 retries for a large storyboard");
  assert.match(result.warnings.join(" "),/automatic original-media download limit reached/i);
  assert.equal(Object.keys(result.bindings).length,0,"no unverified remote media is selected");
});

test("lost Jobs completion ownership aborts media preparation instead of silently picking another asset",async t=>{
  const out=await mkdtemp(join(tmpdir(),"contentgen-auto-lost-claim-"));
  t.after(()=>rm(out,{recursive:true,force:true}));
  const attempted=[];
  const sceneJobs={beginScene:async()=>"claim",completeScene:async()=>{throw Error("Jobs lease lost");},
    failScene:async()=>{}};
  await assert.rejects(prepareAutomaticDraftMedia({suggestions:suggestions([
    {shotId:"shot-a",candidates:[candidate("71"),candidate("72")]}]),
    shotMap,existing:existing(),outputDir:out,pexelsKey:"test",sceneJobs},
  {downloadPhoto:async id=>{attempted.push(id);return {bytes,meta:meta(id)};},probePhoto}),/Jobs lease lost/);
  assert.deepEqual(attempted,["71"],"a failed ownership transition cannot silently start a second download");
});

test("independent scene downloads overlap while keeping a strict three-asset quota",async t=>{
  const out=await mkdtemp(join(tmpdir(),"contentgen-auto-overlap-"));
  t.after(()=>rm(out,{recursive:true,force:true}));
  const ids=["shot-a","shot-b","shot-c","shot-d","shot-e"];
  const map=ids.map((shotId,i)=>({shotId,beatId:`beat-${i}`}));
  const proposals=ids.map((shotId,i)=>scene(shotId,String(i+50)));
  let unblock=()=>{};
  const gate=new Promise(resolve=>{unblock=resolve;});
  let seenTwo=()=>{};
  const ready=new Promise(resolve=>{seenTwo=resolve;});
  const running=new Set(),started=[],maxConcurrency={value:0};
  const work={beginScene:async({sceneId})=>sceneId,completeScene:async()=>{},failScene:async()=>{}};
  const pending=prepareAutomaticDraftMedia({suggestions:suggestions(proposals),shotMap:map,
    existing:existing(),outputDir:out,pexelsKey:"test",sceneJobs:work},{downloadPhoto:async id=>{
    started.push(id);running.add(id);maxConcurrency.value=Math.max(maxConcurrency.value,running.size);
    if(started.length===2)seenTwo();
    await gate;
    running.delete(id);
    return {bytes,meta:meta(id)};
  },probePhoto});
  let deadline;
  try{
    await Promise.race([ready,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error("Downloads did not overlap")),1500);})]);
  }finally{clearTimeout(deadline);unblock();}
  const result=await pending;
  assert.equal(maxConcurrency.value,2);
  assert.equal(result.prepared,3);
  assert.equal(started.length,3,"no fourth download can escape the three-asset quota");
  assert.deepEqual(result.assets.map(x=>x.assetType),["photo","photo","photo"]);
  assert.deepEqual(Object.keys(result.bindings).sort(),["beat-0","beat-1","beat-2"]);
});

test("a cancelled batch settles both claimed downloads before returning",async t=>{
  const out=await mkdtemp(join(tmpdir(),"contentgen-auto-cancel-"));
  t.after(()=>rm(out,{recursive:true,force:true}));
  const abort=new AbortController();
  const claimed=[],failed=[],completed=[];
  let bothStarted=()=>{};
  const ready=new Promise(resolve=>{bothStarted=resolve;});
  const work={beginScene:async({sceneId})=>{claimed.push(sceneId);if(claimed.length===2)bothStarted();return sceneId;},
    failScene:async(id)=>failed.push(id),completeScene:async id=>completed.push(id)};
  const pending=prepareAutomaticDraftMedia({suggestions:suggestions([scene("shot-a","81"),scene("shot-b","82")]),
    shotMap,existing:existing(),outputDir:out,pexelsKey:"test",signal:abort.signal,sceneJobs:work},
  {downloadPhoto:async(_id,{signal})=>new Promise((_,reject)=>{
    if(signal.aborted)return reject(signal.reason);
    signal.addEventListener("abort",()=>reject(signal.reason),{once:true});
  }),probePhoto});
  await ready;
  abort.abort(Error("User cancelled media preparation"));
  await assert.rejects(pending,/User cancelled media preparation/);
  assert.deepEqual(claimed.sort(),["beat-a","beat-b"]);
  assert.deepEqual(failed.sort(),["beat-a","beat-b"]);
  assert.deepEqual(completed,[]);
});

test("verified draft cache survives worker restart and can be copied into a new production run",async t=>{
  const prior=await mkdtemp(join(tmpdir(),"contentgen-photo-prior-"));
  const current=await mkdtemp(join(tmpdir(),"contentgen-photo-next-"));
  t.after(()=>Promise.all([rm(prior,{recursive:true,force:true}),rm(current,{recursive:true,force:true})]));
  const config={suggestions:suggestions([scene("shot-a","59")]),shotMap,existing:existing(),
    outputDir:prior,pexelsKey:"test"};
  const first=await prepareAutomaticDraftMedia(config,{downloadPhoto:async id=>({bytes,meta:meta(id)}),probePhoto});
  assert.equal(first.prepared,1);
  const second=await prepareAutomaticDraftMedia({...config,outputDir:current,previousOutputDir:prior},
    {downloadPhoto:()=>{throw Error("Should reuse independently verified media");},probePhoto});
  assert.equal(second.prepared,1);
  assert.equal(second.fingerprint,first.fingerprint);
  assert.equal(hash(await readFile(second.assets[0].path)),hash(bytes));
  assert.equal((await readdir(current)).filter(name=>name.endsWith(".json")).length,1);
  await writeFile(first.assets[0].path,"damaged");
  const third=await prepareAutomaticDraftMedia({...config,outputDir:join(current,"fresh"),
    previousOutputDir:prior},{downloadPhoto:()=>{throw Error("Provider failed");},probePhoto});
  assert.equal(third.prepared,0,"damaged prior media cannot silently be reused");
  assert.equal(third.fingerprint,config.existing.fingerprint);
  assert.equal(third.warnings.length,2,"cache corruption and subsequent provider outage are reported separately");
  assert.match(third.warnings[0],/previous media cache failed verification/);
});

test("corrupt prior worker media is redownloaded and reverified when its provider is available",async t=>{
  const prior=await mkdtemp(join(tmpdir(),"contentgen-repair-prior-"));
  const current=await mkdtemp(join(tmpdir(),"contentgen-repair-current-"));
  t.after(()=>Promise.all([rm(prior,{recursive:true,force:true}),rm(current,{recursive:true,force:true})]));
  const config={suggestions:suggestions([scene("shot-a","59")]),shotMap,existing:existing(),
    outputDir:prior,pexelsKey:"test"};
  const first=await prepareAutomaticDraftMedia(config,
    {downloadPhoto:async id=>({bytes,meta:meta(id)}),probePhoto});
  assert.equal(first.prepared,1);
  await writeFile(first.assets[0].path,"corrupted partial file");
  const calls=[];
  const work={beginScene:async()=>{calls.push("claim");return "retry-claim";},
    completeScene:async()=>calls.push("complete"),failScene:async()=>calls.push("fail")};
  const repaired=await prepareAutomaticDraftMedia({...config,outputDir:current,
    previousOutputDir:prior,sceneJobs:work},{downloadPhoto:async id=>{
    calls.push("download");return {bytes,meta:meta(id)};
  },probePhoto});
  assert.equal(repaired.prepared,1);
  assert.deepEqual(calls,["claim","download","complete"]);
  assert.equal(hash(await readFile(repaired.assets[0].path)),hash(bytes));
  assert.equal(await readFile(first.assets[0].path,"utf8"),"corrupted partial file",
    "an invalid historical artifact is left intact for review");
  assert.match(repaired.warnings.join(" "),/previous media cache failed verification/i);
});

test("automatic Pexels MP4 footage has a separately claimed job and survives a verified restart",async t=>{
  const first=await mkdtemp(join(tmpdir(),"contentgen-video-prior-"));
  const next=await mkdtemp(join(tmpdir(),"contentgen-video-next-"));
  t.after(()=>Promise.all([rm(first,{recursive:true,force:true}),rm(next,{recursive:true,force:true})]));
  const calls=[];
  const sceneJobs={beginScene:async info=>{calls.push(["claim",info.kind,info.sceneId]);return "claim";},
    completeScene:async id=>calls.push(["complete",id]),failScene:async id=>calls.push(["fail",id])};
  const input={suggestions:suggestions([{shotId:"shot-a",candidates:[videoCandidate("71")]}]),
    shotMap,existing:existing(),outputDir:first,pexelsKey:"key",sceneJobs};
  const downloaded=await prepareAutomaticDraftMedia(input,{downloadVideo:async id=>({
    bytes:videoBytes,meta:videoMeta(id)}),probeVideo});
  assert.equal(downloaded.prepared,1);
  assert.equal(downloaded.bindings["beat-a"].assetType,"video");
  assert.equal(downloaded.bindings["beat-a"].durationSeconds,12);
  assert.ok(downloaded.assets[0].url.endsWith(".mp4"));
  assert.equal(hash(await readFile(downloaded.assets[0].path)),hash(videoBytes));
  assert.deepEqual(calls,[["claim","asset-download","beat-a"],["complete","claim"]]);

  const resumed=await prepareAutomaticDraftMedia({...input,outputDir:next,previousOutputDir:first},
    {downloadVideo:()=>{throw Error("Cached footage must not redownload");},probeVideo});
  assert.equal(resumed.prepared,1);
  assert.equal(resumed.fingerprint,downloaded.fingerprint);
  assert.deepEqual(calls,[["claim","asset-download","beat-a"],["complete","claim"]],
    "reusing fully verified footage must not repeat the download job");
  assert.equal(hash(await readFile(resumed.assets[0].path)),hash(videoBytes));
  await writeFile(resumed.assets[0].path,"damaged");
  const denied=await prepareAutomaticDraftMedia({...input,outputDir:next},
    {downloadVideo:()=>{throw Error("Provider unavailable");},probeVideo});
  assert.equal(denied.prepared,0);
  assert.equal(denied.warnings.length,1,"a corrupted cache never becomes a scene binding");
});

test("auto footage rejects unsupported codecs, oversized dimensions and mismatched rights",async t=>{
  const out=await mkdtemp(join(tmpdir(),"contentgen-video-bad-"));
  t.after(()=>rm(out,{recursive:true,force:true}));
  const input={suggestions:suggestions([{shotId:"shot-a",candidates:[videoCandidate("71")]}]),
    shotMap,existing:existing(),outputDir:out,pexelsKey:"key"};
  for(const probe of [{codec:"hevc",width:1280,height:720,durationSeconds:12},
    {codec:"h264",width:1280,height:720,durationSeconds:91},
    {codec:"h264",width:640,height:360,durationSeconds:12}]){
    const result=await prepareAutomaticDraftMedia(input,{downloadVideo:async id=>({
      bytes:videoBytes,meta:videoMeta(id)}),probeVideo:async()=>probe});
    assert.equal(result.prepared,0);
  }
  const wrong=await prepareAutomaticDraftMedia(input,{downloadVideo:async id=>({
    bytes:videoBytes,meta:{...videoMeta(id),license:"Unknown License"}}),probeVideo});
  assert.equal(wrong.prepared,0);
});

test("provider mismatch, low-resolution photos and cancellation fail safely",async t=>{
  const out=await mkdtemp(join(tmpdir(),"contentgen-photo-reject-"));
  t.after(()=>rm(out,{recursive:true,force:true}));
  const config={suggestions:suggestions([scene("shot-a","42")]),shotMap,existing:existing(),
    outputDir:out,pexelsKey:"test"};
  const wrong=await prepareAutomaticDraftMedia(config,{downloadPhoto:async()=>({bytes,meta:meta("99")}),probePhoto});
  assert.equal(wrong.prepared,0);
  assert.equal(wrong.warnings.length,1);
  const tiny=await prepareAutomaticDraftMedia(config,{downloadPhoto:async()=>({bytes,meta:meta("42")}),
    probePhoto:async()=>({codec:"mjpeg",width:500,height:500})});
  assert.equal(tiny.prepared,0);
  const cancel=new AbortController();cancel.abort(Error("User stopped the render"));
  await assert.rejects(prepareAutomaticDraftMedia({...config,signal:cancel.signal},
    {downloadPhoto:async()=>({bytes,meta:meta("42")}),probePhoto}),/User stopped/);
  await assert.rejects(prepareAutomaticDraftMedia({...config,sceneJobs:{
    beginScene:async()=>{throw Error("Jobs service unavailable");}}},
  {downloadPhoto:async()=>({bytes,meta:meta("42")}),probePhoto}),/Jobs service unavailable/,
  "a missing durable claim must fail the render, not turn into untracked asset work");
});

test("automatic download verifies per-ID Pexels response and trusted JPEG endpoint",async()=>{
  const seen=[];
  const fetchImpl=async(url,opts)=>{
    seen.push(String(url));
    if(String(url).startsWith("https://api.pexels.com/")){
      assert.equal(opts.headers.Authorization,"secret-key");
      return new Response(JSON.stringify({id:42,url:"https://www.pexels.com/photo/roof-42/",
        alt:"Roof",photographer:"A Photographer",
        src:{large:"https://images.pexels.com/photos/42/photo.jpg"}}),
      {headers:{"Content-Type":"application/json"}});
    }
    assert.equal(String(url),"https://images.pexels.com/photos/42/photo.jpg");
    return new Response(bytes,{headers:{"Content-Type":"image/jpeg"}});
  };
  const result=await downloadPexelsDraftPhoto("42",{pexelsKey:"secret-key",fetchImpl});
  assert.equal(hash(result.bytes),hash(bytes));
  assert.equal(result.meta.creator,"A Photographer");
  assert.equal(seen.length,2);
  await assert.rejects(downloadPexelsDraftPhoto("42",{pexelsKey:"secret-key",fetchImpl:async()=>
    new Response(JSON.stringify({id:43}),{headers:{"Content-Type":"application/json"}})}),/different photograph/i);
  await assert.rejects(downloadPexelsDraftPhoto("../42",{pexelsKey:"secret-key",fetchImpl}),/identifier|invalid/i);
});

test("Pexels footage download resolves only a matching official ID and trusted HD MP4",async()=>{
  const seen=[];
  const fetchImpl=async(url,opts)=>{
    seen.push(String(url));
    if(String(url).startsWith("https://api.pexels.com/")){
      assert.equal(opts.headers.Authorization,"secret-key");
      return new Response(JSON.stringify({id:71,url:"https://www.pexels.com/video/roof-71/",
        image:"https://images.pexels.com/videos/71.jpg",duration:12,
        user:{name:"Camera Operator"},video_files:[{file_type:"video/mp4",quality:"hd",
          width:1280,height:720,link:"https://videos.pexels.com/video/71.mp4"}]}),
      {headers:{"Content-Type":"application/json"}});
    }
    assert.equal(String(url),"https://videos.pexels.com/video/71.mp4");
    return new Response(videoBytes,{headers:{"Content-Type":"video/mp4"}});
  };
  const result=await downloadPexelsDraftVideo("71",{pexelsKey:"secret-key",fetchImpl});
  assert.equal(hash(result.bytes),hash(videoBytes));
  assert.equal(result.meta.creator,"Camera Operator");
  assert.equal(result.meta.durationSeconds,12);
  assert.equal(seen.length,2);
  await assert.rejects(downloadPexelsDraftVideo("72",{pexelsKey:"secret-key",fetchImpl}),/different video/i);
  await assert.rejects(downloadPexelsDraftVideo("../71",{pexelsKey:"secret-key",fetchImpl}),/invalid/i);
});

test("real FFmpeg-generated JPEG is probed before automatic draft usage",async t=>{
  const out=await mkdtemp(join(tmpdir(),"contentgen-photo-real-probe-"));
  t.after(()=>rm(out,{recursive:true,force:true}));
  const generated=join(out,"from-ffmpeg.jpg");
  await exec("ffmpeg",["-v","error","-f","lavfi","-i","color=c=blue:s=1280x720:r=1",
    "-frames:v","1",generated],{timeout:30000});
  const jpg=await readFile(generated);
  const result=await prepareAutomaticDraftMedia({suggestions:suggestions([scene("shot-a","42")]),
    shotMap,existing:existing(),outputDir:join(out,"owned"),pexelsKey:"test"},
  {downloadPhoto:async id=>({bytes:jpg,meta:meta(id)})});
  assert.equal(result.prepared,1);
  assert.equal(result.bindings["beat-a"].width,1280);
  assert.equal(result.bindings["beat-a"].height,720);
});

test("real H.264 MP4 passes FFprobe and is reused without rerendering another scene",async t=>{
  const out=await mkdtemp(join(tmpdir(),"contentgen-video-real-probe-"));
  t.after(()=>rm(out,{recursive:true,force:true}));
  const generated=join(out,"generated.mp4");
  await exec("ffmpeg",["-v","error","-f","lavfi","-i","color=c=blue:s=1280x720:r=12",
    "-t","1","-c:v","libx264","-pix_fmt","yuv420p",generated],{timeout:30000});
  const bytes=await readFile(generated);
  const result=await prepareAutomaticDraftMedia({suggestions:suggestions([{
    shotId:"shot-a",candidates:[videoCandidate("71")]}]),shotMap,existing:existing(),
    outputDir:join(out,"owned"),pexelsKey:"test"},
  {downloadVideo:async id=>({bytes,meta:videoMeta(id)})});
  assert.equal(result.prepared,1);
  assert.equal(result.bindings["beat-a"].assetType,"video");
  assert.equal(result.bindings["beat-a"].width,1280);
  assert.equal(result.bindings["beat-a"].height,720);
  assert.equal(result.bindings["beat-a"].durationSeconds,1);
});
