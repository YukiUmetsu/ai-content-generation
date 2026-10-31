import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {execFile} from "node:child_process";
import {mkdtemp,readFile,rm,symlink,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {promisify} from "node:util";
import {downloadVerifiedCommonsPhoto,prepareAutomaticCommonsMedia} from "./automatic-commons-assets.mjs";

const run=promisify(execFile),hash=(algo,bytes)=>createHash(algo).update(bytes).digest("hex");
const PAGE="https://commons.wikimedia.org/wiki/File:Forest_River.jpg";
const ORIGINAL="https://upload.wikimedia.org/wikipedia/commons/4/42/Forest_River.jpg";
const LICENSE="https://creativecommons.org/publicdomain/zero/1.0/";
const CANDIDATE={provider:"openverse",assetType:"photo",assetId:"12222222-3333-4444-8888-999999999999",
  title:"Riverside forest under sunlight",sourceUrl:PAGE,
  license:"CC0-1.0 (unverified index)",licenseUrl:LICENSE,match:{grade:"strong",score:85}};
const suggestions={kind:"contentgen-scene-asset-suggestions",scenes:[
  {shotId:"scene-a",candidates:[CANDIDATE]},
  {shotId:"scene-b",candidates:[CANDIDATE]}]};
const shotMap=[{shotId:"scene-a",beatId:"beat-a"},{shotId:"scene-b",beatId:"beat-b"}];
const existing=()=>({bindings:{},assets:[],fingerprint:"a".repeat(64)});

async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),"contentgen-commons-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const jpg=join(root,"image.jpg");
  await run("ffmpeg",["-hide_banner","-loglevel","error","-nostdin","-y","-f","lavfi",
    "-i","color=c=blue:s=1280x720","-frames:v","1",jpg],{timeout:30000});
  const bytes=await readFile(jpg);
  const record={title:"File:Forest River.jpg",imageinfo:[{mime:"image/jpeg",size:bytes.length,
    width:1280,height:720,sha1:hash("sha1",bytes),url:ORIGINAL,
    extmetadata:{LicenseUrl:{value:LICENSE},LicenseShortName:{value:"CC0 1.0"},
      Artist:{value:"<b>Creative photographer</b>"}}}]};
  let apiCalls=0,downloadCalls=0;
  const fetcher=async url=>{
    const link=new URL(String(url));
    if(link.hostname==="commons.wikimedia.org"){
      apiCalls++;
      assert.equal(link.searchParams.get("titles"),"File:Forest River.jpg");
      return Response.json({query:{pages:{"11":record}}},{headers:{"Content-Type":"application/json"}});
    }
    assert.equal(link.href,ORIGINAL);downloadCalls++;
    return new Response(bytes,{headers:{"Content-Type":"image/jpeg","Content-Length":String(bytes.length)}});
  };
  return {root,bytes,record,fetcher,calls:()=>({apiCalls,downloadCalls})};
}

test("original Commons CC0 license, JPEG hash and FFprobe determine automatic eligibility",async t=>{
  const f=await fixture(t);
  const jobs=[];
  const result=await prepareAutomaticCommonsMedia({suggestions,shotMap,existing:existing(),
    outputDir:join(f.root,"media"),sceneJobs:{beginScene:async info=>{jobs.push(["begin",info]);return "owned";},
      completeScene:async(_,data)=>jobs.push(["complete",data.sha256]),
      failScene:async()=>{throw Error("Unexpected job failure");}}},
  {download:(candidate,opts)=>downloadVerifiedCommonsPhoto(candidate,{...opts,fetcher:f.fetcher})});
  assert.equal(result.prepared,1,"a single photograph cannot be duplicated across two scenes");
  assert.equal(result.bindings["beat-a"].provider,"wikimedia-commons");
  assert.equal(result.bindings["beat-a"].license,"CC0-1.0");
  assert.equal(result.bindings["beat-a"].creator,"Creative photographer");
  assert.equal(result.bindings["beat-a"].title,"Riverside forest under sunlight");
  assert.equal(result.bindings["beat-b"],undefined);
  assert.equal(result.assets[0].sha256,hash("sha256",f.bytes));
  assert.deepEqual(jobs.map(item=>item[0]),["begin","complete"]);
  assert.deepEqual(f.calls(),{apiCalls:1,downloadCalls:1});
});

test("Openverse's CC0 label alone never permits downloading the original",async t=>{
  const f=await fixture(t);
  f.record.imageinfo[0].extmetadata.LicenseUrl.value="https://creativecommons.org/licenses/by/4.0/";
  await assert.rejects(downloadVerifiedCommonsPhoto(CANDIDATE,{fetcher:f.fetcher}),/verify CC0/i);
  assert.equal(f.calls().downloadCalls,0);
  f.record.imageinfo[0].extmetadata.LicenseUrl.value=LICENSE;
  f.record.imageinfo[0].url="https://evil.example.com/attack.jpg";
  await assert.rejects(downloadVerifiedCommonsPhoto(CANDIDATE,{fetcher:f.fetcher}),/untrusted/i);
  assert.equal(f.calls().downloadCalls,0);
  f.record.imageinfo[0].url=ORIGINAL;
  f.record.imageinfo[0].sha1="0".repeat(40);
  await assert.rejects(downloadVerifiedCommonsPhoto(CANDIDATE,{fetcher:f.fetcher}),/SHA-1/i);
  assert.equal(f.calls().downloadCalls,1,"the downloaded bytes must match Commons' own SHA-1");
  await assert.rejects(downloadVerifiedCommonsPhoto({...CANDIDATE,sourceUrl:"http://localhost/private"},
    {fetcher:f.fetcher}),/strong.*CC0/i);
});

test("Common Wikimedia links with encoded File colon resolve to the same vetted title",async t=>{
  const f=await fixture(t);
  const variant={...CANDIDATE,sourceUrl:"https://commons.wikimedia.org/wiki/File%3AForest_River.jpg"};
  const result=await downloadVerifiedCommonsPhoto(variant,{fetcher:f.fetcher});
  assert.equal(result.meta.sourceUrl,variant.sourceUrl);
  assert.equal(result.bytes.length,f.bytes.length);
});

test("verified cache survives restart without network and repairs a damaged earlier cache",async t=>{
  const f=await fixture(t);
  const download=(candidate,opts)=>downloadVerifiedCommonsPhoto(candidate,{...opts,fetcher:f.fetcher});
  const first=await prepareAutomaticCommonsMedia({suggestions,shotMap,existing:existing(),
    outputDir:join(f.root,"first")},{download});
  assert.equal(first.prepared,1);
  const second=await prepareAutomaticCommonsMedia({suggestions,shotMap,existing:existing(),
    outputDir:join(f.root,"second"),previousOutputDir:join(f.root,"first")},
  {download:()=>{throw Error("A verified cached file must avoid the provider.");}});
  assert.equal(second.prepared,1);assert.equal(second.assets[0].sha256,first.assets[0].sha256);
  await writeFile(first.assets[0].path,"damaged");
  const third=await prepareAutomaticCommonsMedia({suggestions,shotMap,existing:existing(),
    outputDir:join(f.root,"third"),previousOutputDir:join(f.root,"first")},{download});
  assert.equal(third.prepared,1);
  assert.match(third.warnings.join(" "),/earlier Commons media did not verify/i);
  assert.equal(f.calls().downloadCalls,2,"a damaged prior file needs a fresh authoritative download");
});

test("manual scene pins win, worker-claim failure propagates and no provider gets contacted",async t=>{
  const f=await fixture(t);
  const selected=existing();selected.bindings["beat-a"]={provider:"pexels",sourceUrl:PAGE,sha256:"b".repeat(64)};
  const skipped=await prepareAutomaticCommonsMedia({suggestions,shotMap,existing:selected,
    outputDir:join(f.root,"skipped")},{download:()=>{throw Error("Pinned media cannot be replaced");}});
  assert.equal(skipped.prepared,0);assert.deepEqual(skipped.bindings["beat-a"],selected.bindings["beat-a"]);
  await assert.rejects(prepareAutomaticCommonsMedia({suggestions,shotMap,existing:existing(),
    outputDir:join(f.root,"unclaimed"),sceneJobs:{beginScene:async()=>{throw Error("Rust claim failed");}}},
  {download:()=>{throw Error("Claims must happen before downloading");}}),/Rust claim failed/);
  assert.deepEqual(f.calls(),{apiCalls:0,downloadCalls:0});
});

test("automatic media refuses symlinked output parents before claiming or fetching",async t=>{
  const f=await fixture(t);
  await symlink(join(f.root,"private"),join(f.root,"escape"));
  await assert.rejects(prepareAutomaticCommonsMedia({suggestions,shotMap,existing:existing(),
    outputDir:join(f.root,"escape","new-media"),sceneJobs:{beginScene:async()=>{
      throw Error("A symlink must be rejected before Jobs are started.");}}},
  {download:()=>{throw Error("A symlink must be rejected before any remote transfer.");}}),
  /scene media parent folder|real directory|ENOTDIR/i);
  assert.deepEqual(f.calls(),{apiCalls:0,downloadCalls:0});
});
