import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { probeVideo, renderVideoSegments } from "./render.mjs";

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name, bytes) {
  const type = Buffer.from(name);
  const header = Buffer.alloc(4); header.writeUInt32BE(bytes.length);
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(Buffer.concat([type, bytes])));
  return Buffer.concat([header, type, bytes, tail]);
}
function pngFrame(color) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(32, 0); ihdr.writeUInt32BE(18, 4); ihdr[8] = 8; ihdr[9] = 6;
  const pixels = Buffer.alloc(18 * (1 + 32 * 4));
  for (let y = 0; y < 18; y++) for (let x = 0; x < 32; x++) {
    const at = y * 129 + 1 + x * 4;
    pixels.set([color, 64, 180, 255], at);
  }
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}

const config = (dir, frames = 301) => ({
  stageUrl: "http://127.0.0.1:4545/video-export.html",
  manifest: { schemaVersion: 1, id: "smoke", width: 32, height: 18, fps: { num: 30, den: 1 }, durationFrames: frames },
  planHash: "f".repeat(64), buildHash: "b".repeat(64), outDir: dir, maxBatchFrames: 150,
});

async function harness(t) {
  const dir = await mkdtemp(join(tmpdir(), "contentgen-render-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let opened = 0, encoded = 0, captured = [], batchSizes = [], concatCalls = 0;
  const dependencies = {
    openCapture: async (stageUrl, expected) => {
      opened++;
      assert.match(stageUrl, /^http:\/\/127\.0\.0\.1/);
      return {
        manifest: expected,
        buildHash: "b".repeat(64),
        captureFrame: async (frame, path) => {
          captured.push(frame);
          await writeFile(path, Buffer.from(`png-frame-${frame}`));
        },
        close: async () => {},
      };
    },
    encodeBatch: async (batch) => {
      encoded++;
      batchSizes.push(batch.frameCount);
      assert.ok(batch.frameCount <= 150);
      await writeFile(batch.outputPath, Buffer.from(`encoded:${batch.startFrame}:${batch.frameCount}`));
    },
    probeSegment: async (path) => {
      const text = await readFile(path, "utf8");
      if (!text.startsWith("encoded:")) throw new Error("corrupt segment");
      return { frameCount: Number(text.split(":")[2]), width: 32, height: 18, fps: { num: 30, den: 1 } };
    },
    concatSegments: async (paths, finalPath) => {
      concatCalls++;
      const content = (await Promise.all(paths.map((p) => readFile(p, "utf8")))).join("|");
      await writeFile(finalPath, content);
    },
    probeFinal: async (path) => {
      const str = await readFile(path, "utf8");
      return { frameCount: str.split("|").reduce((s, part) => s + Number(part.split(":")[2]), 0), width: 32, height: 18, fps: { num: 30, den: 1 } };
    },
  };
  return { dir, dependencies, stats: () => ({ opened, encoded, captured, batchSizes, concatCalls }) };
}

test("301 frames use verified 150+150+1 segments and only absolute seeks", async (t) => {
  const { dir, dependencies, stats } = await harness(t);
  const result = await renderVideoSegments(config(dir), dependencies);
  assert.deepEqual(stats().batchSizes, [150, 150, 1]);
  assert.deepEqual(stats().captured, Array.from({ length: 301 }, (_, i) => i));
  assert.equal(result.frameCount, 301);
  assert.equal(result.segmentHashes.length, 3);
  assert.match(result.videoOnlyPath, /video-only\.mp4$/);
  assert.equal((await readdir(dir)).some((file) => file.startsWith(".capture-")), false, "only the owned PNG batch is reclaimed");
});

test("capture progress counts only batches that passed hashing and frame probes", async (t) => {
  const { dir, dependencies } = await harness(t);
  const updates = [];
  await renderVideoSegments({ ...config(dir), onProgress: (event) => updates.push(event) }, dependencies);
  assert.deepEqual(updates, [
    { phase: "rendering", completedFrames: 150, totalFrames: 301 },
    { phase: "rendering", completedFrames: 300, totalFrames: 301 },
    { phase: "rendering", completedFrames: 301, totalFrames: 301 },
  ]);
});

test("verified frame chunks are independently claimed and committed, including cache reuse",async(t)=>{
  const {dir,dependencies,stats}=await harness(t),events=[];
  const sceneJobs={beginScene:async({sceneId,fingerprint})=>{
    assert.match(fingerprint,/^[a-f0-9]{64}$/u);events.push("start:"+sceneId);return sceneId;},
    completeScene:async(id,result)=>{assert.match(result.sha256,/^[a-f0-9]{64}$/u);
      events.push(`done:${id}:${result.reused}`);},
    failScene:async id=>events.push("failed:"+id)};
  await renderVideoSegments({...config(dir,151),sceneJobs},dependencies);
  assert.deepEqual(events,["start:segment-00000","done:segment-00000:false",
    "start:segment-00001","done:segment-00001:false"]);
  const encoded=stats().encoded;events.length=0;
  await renderVideoSegments({...config(dir,151),sceneJobs},dependencies);
  assert.equal(stats().encoded,encoded);
  assert.deepEqual(events,["start:segment-00000","done:segment-00000:true",
    "start:segment-00001","done:segment-00001:true"]);
});

test("a capture crash fails only its claimed segment and cannot commit unfinished output",async(t)=>{
  const {dir,dependencies}=await harness(t),events=[];
  const sceneJobs={beginScene:async({sceneId})=>{events.push("start:"+sceneId);return sceneId;},
    completeScene:async id=>events.push("done:"+id),
    failScene:async id=>events.push("failed:"+id)};
  await assert.rejects(renderVideoSegments({...config(dir,151),sceneJobs},{...dependencies,
    encodeBatch:async()=>{throw Error("FFmpeg worker killed");}}),/FFmpeg worker killed/u);
  assert.deepEqual(events,["start:segment-00000","failed:segment-00000"]);
});

test("resume validates hash, manifest and probe, repairing only a damaged segment", async (t) => {
  const { dir, dependencies, stats } = await harness(t);
  await renderVideoSegments(config(dir, 151), dependencies);
  const firstCount = stats().captured.length;
  const second = await renderVideoSegments(config(dir, 151), dependencies);
  assert.equal(stats().captured.length, firstCount);
  assert.equal(stats().encoded, 2);
  assert.equal(second.segmentHashes.length, 2);
  await writeFile(join(dir, "segments", "segment-00000.mp4"), "tampered");
  const repaired=await renderVideoSegments(config(dir, 151), dependencies);
  assert.equal(repaired.renderedSegmentCount,1);
  assert.equal(repaired.reusedSegmentCount,0);
  assert.equal(stats().captured.length,firstCount+150,"only damaged segment frames should be recaptured");
  assert.equal((await readdir(join(dir,"segments"))).some(name=>name.includes(".mp4")&&
    name.startsWith(".recovery-")),true,"corrupt original remains available for diagnosis");
});

test("SIGKILL after H.264 publication repairs missing metadata without recapturing valid sibling",async t=>{
  const {dir,dependencies,stats}=await harness(t);
  await renderVideoSegments(config(dir,151),dependencies);
  await rm(join(dir,"segments","segment-00000.mp4.json"));
  const before=stats().captured.length;
  const result=await renderVideoSegments(config(dir,151),dependencies);
  assert.equal(result.renderedSegmentCount,1);
  assert.equal(stats().captured.length-before,150);
  assert.equal((await readdir(join(dir,"segments"))).some(name=>
    name.startsWith(".recovery-")&&name.endsWith("segment-00000.mp4")),true);
});

test("an interrupted concat is rebuilt from intact segments, and unsafe symlinks are rejected",async t=>{
  const {dir,dependencies,stats}=await harness(t);
  await renderVideoSegments(config(dir,151),dependencies);
  const before=stats();
  await rm(join(dir,"video-only.mp4.json"));
  const updates=[];
  const result=await renderVideoSegments({...config(dir,151),onProgress:event=>updates.push(event)},dependencies);
  assert.equal(result.renderedSegmentCount,0);
  assert.equal(stats().encoded,before.encoded);
  assert.equal(stats().concatCalls,before.concatCalls+1);
  assert.equal((await readdir(dir)).some(name=>name.startsWith(".recovery-")&&
    name.endsWith("video-only.mp4")),true);
  assert.ok(updates.some(event=>event.phase==="rendering"&&
    event.message?.includes("without recapturing")),"recovery reports a clear user-facing status");
  await rm(join(dir,"segments","segment-00000.mp4"));
  await symlink(join(dir,"video-only.mp4"),join(dir,"segments","segment-00000.mp4"));
  await assert.rejects(renderVideoSegments(config(dir,151),dependencies),/unsafe|regular file/i);
});

test("same narrative plan with changed built scene cannot reuse stale H264 segments", async (t) => {
  const { dir, dependencies } = await harness(t);
  await renderVideoSegments(config(dir, 151), dependencies);
  await assert.rejects(renderVideoSegments({ ...config(dir, 151), buildHash: "c".repeat(64) }, dependencies), /stale|fingerprint|resume|build/i);
});

test("damaged segments in a failed previous attempt are redrawn, never reused or made fatal",async t=>{
  const {dir,dependencies,stats}=await harness(t);
  const first=join(dir,"interrupted"),retry=join(dir,"retry");
  const manifest=config(first,151).manifest;
  const visualPlan={kind:"test-explainer",manifest,
    chapters:[{id:"scene-1",startFrame:0,endFrame:151,visual:{headline:"Roof costs"}}]};
  const planHash=createHash("sha256").update(JSON.stringify(visualPlan)).digest("hex");
  await renderVideoSegments({...config(first,151),planHash,visualPlan},dependencies);
  await writeFile(join(first,"segments","segment-00000.mp4"),"changed-media");
  const previouslyCaptured=stats().captured.length;
  const result=await renderVideoSegments({...config(retry,151),planHash,visualPlan,
    reuseFrom:{sourcePlan:visualPlan,buildHash:"b".repeat(64),segmentsDir:join(first,"segments")}},dependencies);
  assert.equal(result.reusedSegmentCount,1,"the separately verified second chunk is still reusable");
  assert.equal(stats().captured.length-previouslyCaptured,150,"only the damaged first chunk is redrawn");
  assert.equal(result.segmentHashes.length,2);
});

test("regenerating one edited scene reuses the other two verified scenes across exports",async t=>{
  const {dir,dependencies,stats}=await harness(t);
  const first=join(dir,"first"),second=join(dir,"second");
  const manifest=config(first,180).manifest;
  const chapters=["Start","Explanation","Outcome"].map((headline,index)=>({
    id:`scene-${index+1}`,startFrame:index*60,endFrame:(index+1)*60,visual:{headline}}));
  const base={kind:"test-explainer",manifest,chapters};
  const digest=plan=>createHash("sha256").update(JSON.stringify(plan)).digest("hex");
  await renderVideoSegments({...config(first,180),planHash:digest(base),visualPlan:base},dependencies);
  const oldCaptured=stats().captured.length,oldEncoded=stats().encoded;
  const modified={...base,chapters:chapters.map((chapter,index)=>index===1?
    {...chapter,visual:{headline:"An edited explanation"}}:chapter)};
  const result=await renderVideoSegments({...config(second,180),planHash:digest(modified),visualPlan:modified,
    reuseFrom:{sourcePlan:base,buildHash:"b".repeat(64),segmentsDir:join(first,"segments")}},dependencies);
  assert.equal(result.reusedSegmentCount,2);
  assert.equal(result.renderedSegmentCount,1);
  assert.equal(stats().encoded-oldEncoded,1);
  assert.deepEqual(stats().captured.slice(oldCaptured),Array.from({length:60},(_,index)=>index+60));
  assert.equal(result.frameCount,180);
});

test("capture abort leaves verified segments but never publishes an incomplete MP4", async (t) => {
  const { dir, dependencies } = await harness(t);
  let closed = false;
  const priorOpen = dependencies.openCapture;
  dependencies.openCapture = async (...args) => {
    const driver = await priorOpen(...args);
    return { ...driver, captureFrame: async (frame, path) => {
      if (frame === 151) throw new Error("simulated browser crash");
      return driver.captureFrame(frame, path);
    }, close: async () => { closed = true; } };
  };
  await assert.rejects(renderVideoSegments(config(dir), dependencies), /browser crash/);
  assert.equal(closed, true);
  const children = await readdir(dir);
  assert.equal(children.includes("video-only.mp4"), false);
  assert.equal(children.some((item) => item.startsWith(".capture-")), false);
  assert.ok((await readdir(join(dir, "segments"))).includes("segment-00000.mp4"));
});

test("unsafe endpoint, excessive batch, invalid hash and unsafe directory fail before browser work", async (t) => {
  const { dir, dependencies, stats } = await harness(t);
  await assert.rejects(renderVideoSegments({ ...config(dir), stageUrl: "https://external.example/" }, dependencies), /loopback/i);
  await assert.rejects(renderVideoSegments({ ...config(dir), maxBatchFrames: 151 }, dependencies), /150/i);
  await assert.rejects(renderVideoSegments({ ...config(dir), planHash: "???" }, dependencies), /hash/i);
  await assert.rejects(renderVideoSegments({ ...config(dir), outDir: "/" }, dependencies), /output|root|directory/i);
  await symlink(dir,join(dir,"linked-folder"));
  await assert.rejects(renderVideoSegments({ ...config(join(dir,"linked-folder","nested")) },dependencies),
    /unsafe|linked|parent/i,"rendering may not write through linked job directory parents");
  assert.equal(stats().opened, 0);
});

test("manifest mismatch aborts before recording any frame", async (t) => {
  const { dir, dependencies, stats } = await harness(t);
  dependencies.openCapture = async () => ({
    manifest: { ...config(dir).manifest, width: 100 },
    captureFrame: async () => { throw new Error("no capture should start"); },
    close: async () => {},
  });
  await assert.rejects(renderVideoSegments(config(dir), dependencies), /manifest/i);
  assert.equal(stats().encoded, 0);
});

test("browser handshake must prove the same static build fingerprint as the resume identity", async (t) => {
  const { dir, dependencies, stats } = await harness(t);
  const original = dependencies.openCapture;
  dependencies.openCapture = async (...args) => ({ ...await original(...args), buildHash: "c".repeat(64) });
  await assert.rejects(renderVideoSegments(config(dir, 151), dependencies), /build|fingerprint|handshake/i);
  assert.equal(stats().captured.length, 0);
});

test("real FFmpeg encodes two batches and probes a complete H.264 MP4", { skip: spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status !== 0 || spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status !== 0 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "contentgen-render-integration-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const result = await renderVideoSegments({ ...config(dir, 3), maxBatchFrames: 2 }, {
    openCapture: async (_url, manifest) => ({
      manifest,
      buildHash: "b".repeat(64),
      captureFrame: async (frame, path) => writeFile(path, pngFrame(30 + frame * 50)),
      close: async () => {},
    }),
  });
  assert.equal(result.frameCount, 3);
  assert.equal(result.segmentHashes.length, 2);
  assert.equal(result.peakScratchBytes > 0, true);
  assert.ok((await readFile(result.videoOnlyPath)).length > 1000);
  // Real FFmpeg concat can be killed after the MP4 rename but before the
  // sidecar commit. A fresh invocation must not encode any finished chunks.
  const before=(await readFile(result.videoOnlyPath)).toString("hex");
  await rm(join(dir,"video-only.mp4.json"));
  const resumed=await renderVideoSegments({ ...config(dir,3),maxBatchFrames:2 },{
    openCapture:async (_url,manifest)=>({manifest,buildHash:"b".repeat(64),
      captureFrame:async()=>{throw Error("All frames should be cached");},close:async()=>{}}),
  });
  assert.equal(resumed.renderedSegmentCount,0);
  assert.equal((await readFile(resumed.videoOnlyPath)).toString("hex"),before);
  assert.equal((await probeVideo(resumed.videoOnlyPath)).frameCount,3);
});

test("real FFmpeg updates only one edited scene and exports valid six-frame MP4",{
  skip:spawnSync("ffmpeg",["-version"],{stdio:"ignore"}).status!==0 ||
    spawnSync("ffprobe",["-version"],{stdio:"ignore"}).status!==0
},async t=>{
  const dir=await mkdtemp(join(tmpdir(),"contentgen-targeted-ffmpeg-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const source=join(dir,"first"),updated=join(dir,"updated");
  const chapters=[0,1,2].map(index=>({id:`scene-${index}`,
    startFrame:index*2,endFrame:(index+1)*2,visual:{headline:`Original ${index}`}}));
  const manifest=config(source,6).manifest;
  const firstPlan={manifest,chapters};
  const newPlan={manifest,chapters:chapters.map((chapter,index)=>index===1?
    {...chapter,visual:{headline:"Updated middle scene"}}:chapter)};
  const hash=plan=>createHash("sha256").update(JSON.stringify(plan)).digest("hex");
  let phase=0;const frames=[];
  const deps={openCapture:async (_url,expected)=>({manifest:expected,
    buildHash:"b".repeat(64),captureFrame:async (frame,path)=>{
      frames.push({phase,frame});
      return writeFile(path,pngFrame(frame>=2&&frame<4&&phase===1?210:30+Math.floor(frame/2)*50));
    },close:async()=>{}})};
  const initial=await renderVideoSegments({...config(source,6),maxBatchFrames:2,
    planHash:hash(firstPlan),visualPlan:firstPlan},deps);
  assert.equal(initial.renderedSegmentCount,3);
  phase=1;
  const result=await renderVideoSegments({...config(updated,6),maxBatchFrames:2,
    planHash:hash(newPlan),visualPlan:newPlan,
    reuseFrom:{sourcePlan:firstPlan,buildHash:"b".repeat(64),segmentsDir:join(source,"segments")}},deps);
  assert.equal(result.renderedSegmentCount,1);
  assert.equal(result.reusedSegmentCount,2);
  assert.deepEqual(frames.filter(item=>item.phase===1).map(item=>item.frame),[2,3]);
  assert.equal(result.segmentHashes[0].sha256,initial.segmentHashes[0].sha256);
  assert.notEqual(result.segmentHashes[1].sha256,initial.segmentHashes[1].sha256);
  assert.equal(result.segmentHashes[2].sha256,initial.segmentHashes[2].sha256);
  assert.equal((await probeVideo(result.videoOnlyPath)).frameCount,6);
});

test("captures bounded verified review stills, reuses them and repairs damaged preview only", async (t) => {
  const { dir, dependencies, stats } = await harness(t);
  const originalOpen = dependencies.openCapture;
  let stillCaptures=0;
  dependencies.openCapture = async (...args) => {
    const driver = await originalOpen(...args);
    return { ...driver, captureFrame: (frame, path) => {
      if (path.includes("/stills/")) { stillCaptures++; return writeFile(path, pngFrame(frame % 255)); }
      return driver.captureFrame(frame, path);
    } };
  };
  const requested = { ...config(dir, 151), reviewFrames: [0, 75, 150] };
  const first = await renderVideoSegments(requested, dependencies);
  assert.deepEqual(first.reviewStills.map((item) => item.frame), [0, 75, 150]);
  for (const item of first.reviewStills) {
    const bytes = await readFile(item.path);
    assert.equal(item.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  }
  const calls = stats().captured.length;
  const second = await renderVideoSegments(requested, dependencies);
  assert.equal(stats().captured.length, calls, "no segment or preview frame recapture on verified resume");
  assert.deepEqual(second.reviewStills, first.reviewStills);
  await writeFile(first.reviewStills[0].path, "tampered");
  const repaired=await renderVideoSegments(requested,dependencies);
  assert.equal(stats().captured.length,calls,"no video segment was recaptured");
  assert.equal(stillCaptures,4,"only the broken still was recaptured");
  assert.equal(repaired.reviewStills[1].sha256,first.reviewStills[1].sha256);
  assert.equal((await readdir(join(dir,"stills"))).some(name=>name.startsWith(".recovery-")),true);
});

test("invalid review frame requests fail before allocating media resources", async (t) => {
  const { dir, dependencies, stats } = await harness(t);
  await assert.rejects(renderVideoSegments({ ...config(dir, 151), reviewFrames: [151] }, dependencies), /review frame/i);
  await assert.rejects(renderVideoSegments({ ...config(dir, 151), reviewFrames: [0, 0] }, dependencies), /review frame/i);
  await assert.rejects(renderVideoSegments({ ...config(dir, 151), reviewFrames: Array.from({ length: 6 }, (_, i) => i) }, dependencies), /review frame/i);
  assert.equal(stats().opened, 0);
});
