import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateProductionThumbnails, thumbnailCopy } from "./premium-thumbnails.mjs";

const fixture = JSON.parse(readFileSync(new URL("../../../../examples/video-production-house-math-smoke.json",import.meta.url)));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

test("Kumiki automatically exports three distinct script-grounded, 1280×720 real FFmpeg PNGs", async t => {
  const outputDir = await mkdtemp(join(tmpdir(),"contentgen-thumbnails-"));
  t.after(() => rm(outputDir,{recursive:true,force:true}));
  const items = await generateProductionThumbnails(fixture,{outputDir});
  assert.equal(items.length,3);
  assert.equal(new Set(items.map(x=>x.headline)).size,3);
  assert.equal(new Set(items.map(x=>x.sha256)).size,3);
  for(const item of items){
    const png=await readFile(join(outputDir,item.file));
    const svg=await readFile(join(outputDir,item.source));
    assert.equal(png.readUInt32BE(16),1280);
    assert.equal(png.readUInt32BE(20),720);
    assert.equal(sha(png),item.sha256);
    assert.equal(sha(svg),item.sourceSha256);
    assert.match(svg.toString(),/<svg/u);
  }
});

test("each concept has a durable Jobs attempt and survives restart without rerendering finished PNGs",async t=>{
  const root=await mkdtemp(join(tmpdir(),"contentgen-thumb-recovery-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const firstDir=join(root,"first"),firstCache=join(root,"first-cache");
  const resumedDir=join(root,"resumed"),resumedCache=join(root,"resumed-cache");
  await Promise.all([mkdir(firstDir),mkdir(resumedDir)]);
  const events=[];
  const sceneJobs={
    beginScene:async info=>{events.push(["begin",info.kind,info.sceneId]);return info.sceneId;},
    completeScene:async(token,proof)=>events.push(["complete",token,proof.sha256]),
    failScene:async(token)=>events.push(["fail",token]),
  };
  const first=await generateProductionThumbnails(fixture,{outputDir:firstDir,cacheDir:firstCache,sceneJobs});
  assert.deepEqual(events.filter(item=>item[0]==="begin").map(item=>item.slice(1)),
    [["thumbnail-concept","thumbnail-1"],["thumbnail-concept","thumbnail-2"],["thumbnail-concept","thumbnail-3"]]);
  assert.equal(events.filter(item=>item[0]==="complete").length,3);
  const second=await generateProductionThumbnails(fixture,{outputDir:resumedDir,
    cacheDir:resumedCache,reuseCacheDir:firstCache,ffmpeg:"missing-ffmpeg-command",
    sceneJobs:{beginScene:async()=>{throw Error("Cached thumbnails must not be rendered");}}});
  assert.deepEqual(second.map(item=>item.sha256),first.map(item=>item.sha256));
  for(const item of second){
    assert.equal(sha(await readFile(join(resumedDir,item.file))),item.sha256);
    assert.equal(sha(await readFile(join(resumedCache,item.file))),item.sha256);
  }
  await writeFile(join(firstCache,"thumbnail-2.png"),"bad jpeg");
  const damagedDir=join(root,"damaged");await mkdir(damagedDir);
  const invalidClaims=[];
  await assert.rejects(generateProductionThumbnails(fixture,{outputDir:damagedDir,
    reuseCacheDir:firstCache,sceneJobs:{beginScene:async({sceneId})=>{
      invalidClaims.push(sceneId);throw Error("Regenerate invalid concept");}}}),/Regenerate invalid concept/,
  "damaged thumbnail bytes must request a fresh Job, not pass cache validation");
  assert.deepEqual(invalidClaims,["thumbnail-2"]);
});

test("interrupted thumbnail production retries only unfinished concepts",async t=>{
  const root=await mkdtemp(join(tmpdir(),"contentgen-thumbnail-interrupted-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const prior=join(root,"prior"),later=join(root,"later");
  await Promise.all([mkdir(prior),mkdir(later)]);
  let starts=0;
  await assert.rejects(generateProductionThumbnails(fixture,{outputDir:prior,
    cacheDir:join(root,"prior-cache"),sceneJobs:{
      beginScene:async({sceneId})=>{
        starts++;
        if(sceneId==="thumbnail-2")throw Error("worker was interrupted");
        return sceneId;
      },completeScene:async()=>{},failScene:async()=>{},
    }}),/worker was interrupted/);
  assert.equal(starts,2);
  const retried=[];
  const outputs=await generateProductionThumbnails(fixture,{outputDir:later,
    cacheDir:join(root,"later-cache"),reuseCacheDir:join(root,"prior-cache"),sceneJobs:{
      beginScene:async({sceneId})=>{retried.push(sceneId);return sceneId;},
      completeScene:async()=>{},failScene:async()=>{},
    }});
  assert.deepEqual(retried,["thumbnail-2","thumbnail-3"]);
  assert.equal(outputs.length,3);
  assert.equal(outputs[0].sha256,sha(await readFile(join(prior,"thumbnail-1.png"))));
});

test("unusable thumbnail export never reaches the release manifest",async t=>{
  const outputDir=await mkdtemp(join(tmpdir(),"contentgen-thumb-invalid-"));
  t.after(()=>rm(outputDir,{recursive:true,force:true}));
  const fake=()=>[1,2,3].map(n=>({id:String(n),label:"Concept",media:{},svg:`<svg>${n}</svg>`}));
  await assert.rejects(generateProductionThumbnails(fixture,{outputDir,compose:async()=>fake,
    convert:async(_svg,path)=>writeFile(path,"not a png")}),/valid 1280×720 PNG/u);
  await assert.rejects(generateProductionThumbnails({...fixture,beats:[]},{outputDir}),/script/u);
  assert.equal(thumbnailCopy(fixture).headlines.every(Boolean),true);
});

test("a repetitive short script still receives three grounded thumbnail messages",()=>{
  const short={topic:{title:"An honest house budget"},beats:[{
    id:"start",narration:"An honest house budget",visual:{headline:"An honest house budget"}}]};
  const three=thumbnailCopy(short).headlines;
  assert.equal(new Set(three).size,3);
  assert.ok(three.every(headline=>headline.includes("house budget")));
});
