import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename,join } from "node:path";
import { generateProductionThumbnails, rasterizeThumbnailSvg, thumbnailCopy } from "./premium-thumbnails.mjs";

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
  assert.deepEqual(events.filter(item=>item[0]==="begin").map(item=>item.slice(1)).sort((a,b)=>a[1].localeCompare(b[1])),
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
  assert.equal(starts,3,"all independent concepts still claim work when one fails");
  const retried=[];
  const outputs=await generateProductionThumbnails(fixture,{outputDir:later,
    cacheDir:join(root,"later-cache"),reuseCacheDir:join(root,"prior-cache"),sceneJobs:{
      beginScene:async({sceneId})=>{retried.push(sceneId);return sceneId;},
      completeScene:async()=>{},failScene:async()=>{},
    }});
  assert.deepEqual(retried,["thumbnail-2"],"completed third concept also survives the failure");
  assert.equal(outputs.length,3);
  assert.equal(outputs[0].sha256,sha(await readFile(join(prior,"thumbnail-1.png"))));
  assert.equal(outputs[2].sha256,sha(await readFile(join(prior,"thumbnail-3.png"))));
});

test("a later draft reuses title cards saved by an earlier unfinished draft",async t=>{
  const root=await mkdtemp(join(tmpdir(),"contentgen-thumb-sibling-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const earlier=join(root,"draft-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
  const later=join(root,"draft-aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff");
  await mkdir(join(earlier,"staging"),{recursive:true});
  await mkdir(join(later,"staging"),{recursive:true});
  const png=Buffer.alloc(160);
  Buffer.from("89504e470d0a1a0a","hex").copy(png,0);
  png.writeUInt32BE(1280,16);png.writeUInt32BE(720,20);
  await generateProductionThumbnails(fixture,{
    outputDir:join(earlier,"staging"),
    cacheDir:join(earlier,".render","thumbnails"),
    convert:async(_svg,path)=>writeFile(path,png),
  });
  const outputs=await generateProductionThumbnails(fixture,{
    outputDir:join(later,"staging"),
    cacheDir:join(later,".render","thumbnails"),
    convert:async()=>{throw Error("finished title cards must not be redrawn");},
    sceneJobs:{beginScene:async()=>{throw Error("finished title cards must not be claimed");}},
  });
  assert.equal(outputs.length,3);
  assert.deepEqual(outputs.map(item=>item.sha256),Array(3).fill(sha(png)));
});

test("a busy thumbnail claim is retried once",async()=>{
  const outputDir=await mkdtemp(join(tmpdir(),"contentgen-thumb-claim-retry-"));
  let calls=0;
  const png=Buffer.alloc(160);
  Buffer.from("89504e470d0a1a0a","hex").copy(png,0);
  png.writeUInt32BE(1280,16);png.writeUInt32BE(720,20);
  await generateProductionThumbnails(fixture,{outputDir,convert:async(_svg,path)=>writeFile(path,png),
    sceneJobs:{
      beginScene:async()=>{
        calls++;
        if(calls===1)throw Error("Jobs service unavailable. database is locked");
        return "claimed";
      },
      completeScene:async()=>{},
      failScene:async()=>{},
    }});
  assert.equal(calls,4,"the first concept retries once and the other two claim immediately");
});

test("independent thumbnail attempts run concurrently but settle before reporting failure",async t=>{
  const outputDir=await mkdtemp(join(tmpdir(),"contentgen-thumbnails-parallel-"));
  t.after(()=>rm(outputDir,{recursive:true,force:true}));
  const builds=[1,2,3].map(n=>({id:String(n),label:`Concept ${n}`,
    media:{},svg:`<svg xmlns="http://www.w3.org/2000/svg"><text>${n}</text></svg>`}));
  const source=()=>builds;
  const png=Buffer.alloc(160);
  Buffer.from("89504e470d0a1a0a","hex").copy(png,0);
  png.writeUInt32BE(1280,16);png.writeUInt32BE(720,20);
  let unblock=()=>{};
  const gate=new Promise(resolve=>{unblock=resolve;});
  const started=[],finished=[];
  const pending=generateProductionThumbnails(fixture,{outputDir,compose:async()=>source,
    convert:async(_svg,path)=>{
      const name=basename(path);
      started.push(name);
      if(name==="thumbnail-2.png")throw Error("isolated thumbnail conversion failed");
      await gate;
      await writeFile(path,png);
      finished.push(name);
    }});
  // Give the independent conversions a chance to start without needing the
  // first successful concept to complete. A serial loop cannot pass this.
  let deadline;
  await Promise.race([
    (async()=>{while(started.length!==3)await new Promise(resolve=>setTimeout(resolve,5));})(),
    new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error("thumbnail workers did not start together")),2000);})
  ]).finally(()=>{clearTimeout(deadline);unblock();});
  await assert.rejects(pending,/isolated thumbnail conversion failed/);
  assert.deepEqual(started.sort(),["thumbnail-1.png","thumbnail-2.png","thumbnail-3.png"]);
  assert.deepEqual(finished.sort(),["thumbnail-1.png","thumbnail-3.png"],
    "remaining workers finish before parent observes failure");
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

test("a working FFmpeg SVG decoder does not open a browser", async t => {
  const dir = await mkdtemp(join(tmpdir(), "contentgen-thumb-ffmpeg-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const svgPath = join(dir, "thumb.svg"), pngPath = join(dir, "thumb.png");
  await writeFile(svgPath, "<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
  let opened = false;
  await rasterizeThumbnailSvg(svgPath, pngPath, {
    run: async () => {},
    launchBrowser: async () => { opened = true; throw Error("browser opened"); },
  });
  assert.equal(opened, false);
});

test("FFmpeg without an SVG decoder draws the thumbnail in one shared browser", async t => {
  const dir = await mkdtemp(join(tmpdir(), "contentgen-thumb-browser-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const svgPath = join(dir, "thumb.svg"), pngPath = join(dir, "thumb.png");
  await writeFile(svgPath, "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1280\" height=\"720\"></svg>");
  const png = Buffer.from("browser-png");
  let opens = 0;
  const browser = {
    async newPage() {
      return { async setContent() {}, async screenshot() { return png; }, async close() {} };
    },
    async close() {},
  };
  await rasterizeThumbnailSvg(svgPath, pngPath, {
    run: async () => {
      const error = Error("Command failed");
      error.stderr = "Decoding requested, but no decoder found for: svg";
      throw error;
    },
    launchBrowser: async () => { opens += 1; return browser; },
  });
  assert.equal(opens, 1);
  assert.equal(await readFile(pngPath, "utf8"), "browser-png");
  await assert.rejects(rasterizeThumbnailSvg(svgPath, join(dir, "other.png"), {
    run: async () => { throw Object.assign(Error("disk full"), { stderr: "No space left on device" }); },
    launchBrowser: async () => { throw Error("browser opened"); },
  }), /disk full/u);
});

test("installed Chromium or FFmpeg exports a real 1280×720 thumbnail PNG", { timeout: 45_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), "contentgen-thumb-real-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const svgPath = join(dir, "thumb.svg"), pngPath = join(dir, "thumb.png");
  await writeFile(svgPath, `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#152D36"/><text x="80" y="360" fill="#F8F4EC" font-size="72" font-family="Arial">Draft</text></svg>`);
  await rasterizeThumbnailSvg(svgPath, pngPath);
  const png = await readFile(pngPath);
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), 1280);
  assert.equal(png.readUInt32BE(20), 720);
});

test("a repetitive short script still receives three grounded thumbnail messages",()=>{
  const short={topic:{title:"An honest house budget"},beats:[{
    id:"start",narration:"An honest house budget",visual:{headline:"An honest house budget"}}]};
  const three=thumbnailCopy(short).headlines;
  assert.equal(new Set(three).size,3);
  assert.ok(three.every(headline=>headline.includes("house budget")));
});
