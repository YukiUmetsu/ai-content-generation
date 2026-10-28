import test from "node:test";
import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {createHash} from "node:crypto";
import {mkdtemp,readFile,rm,writeFile,readdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {downloadPexelsDraftPhoto} from "./asset-discovery.mjs";
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
  assert.equal(third.warnings.length,1);
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
