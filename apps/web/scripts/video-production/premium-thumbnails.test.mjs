import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
