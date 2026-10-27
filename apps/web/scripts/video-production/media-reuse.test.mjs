import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listRenderChunks, reusableChapter } from "./media-reuse.mjs";
import { renderVideoSegments } from "./render.mjs";

const sha=x=>createHash("sha256").update(x).digest("hex");
const manifest=(frames=180)=>({schemaVersion:1,id:"demonstration",width:32,height:18,
  durationFrames:frames,fps:{num:30,den:1}});
function plan(){
  return {schemaVersion:1,kind:"general-explainer-visual-plan",title:"Illustrative cost",
    locale:"en-US",manifest:manifest(),
    claims:[{id:"c1",text:"Illustrative estimate"}],events:{ending:90},payoffEventId:"ending",
    disclaimer:"DRAFT",commercialReady:false,
    chapters:[
      {id:"a",intent:"general-intro",startFrame:0,endFrame:90,visual:{headline:"A question"}},
      {id:"b",intent:"general-payoff",startFrame:90,endFrame:180,visual:{headline:"An answer"}}]};
}
function config(dir,p){
  return {stageUrl:"http://127.0.0.1:3001/video-export.html",manifest:p.manifest,
    visualPlan:p,planHash:sha(JSON.stringify(p)),buildHash:"b".repeat(64),
    outDir:dir,maxBatchFrames:150};
}
function mocks(){
  const touched=[];
  const probes=async file=>{
    const body=await readFile(file,"utf8");
    const match=/^frame:(\d+):(\d+)$/u.exec(body);
    if(!match)throw Error("invalid mock H264");
    return {width:32,height:18,frameCount:Number(match[2]),fps:{num:30,den:1}};
  };
  const api={
    openCapture:async (_,expected)=>({manifest:expected,buildHash:"b".repeat(64),
      captureFrame:async (frame,file)=>{touched.push(frame);await writeFile(file,"png:"+frame);},
      close:async()=>{}}),
    encodeBatch:async ({startFrame,frameCount,outputPath})=>writeFile(outputPath,"frame:"+startFrame+":"+frameCount),
    probeSegment:probes,
    probeFinal:async file=>{
      const body=await readFile(file,"utf8");
      const frames=body.split("|").reduce((n,segment)=>n+Number(segment.split(":")[2]),0);
      return {width:32,height:18,frameCount:frames,fps:{num:30,den:1}};
    },
    concatSegments:async (paths,out)=>writeFile(out,(await Promise.all(paths.map(p=>readFile(p,"utf8")))).join("|"))
  };
  return {api,touched};
}
test("scene-aligned chunking never crosses a narrator chapter boundary",()=>{
  const p=plan();
  assert.deepEqual(listRenderChunks(p.manifest,150,p).map(c=>[c.startFrame,c.frameCount,c.chapterIndex]),
    [[0,90,0],[90,90,1]]);
  assert.deepEqual(listRenderChunks(p.manifest,150).map(c=>c.frameCount),[150,30]);
  assert.throws(()=>listRenderChunks(p.manifest,150,{...p,chapters:[]}),/chapters/);
});
test("visual-only edit captures just changed chapter and reuses verified original",async t=>{
  const root=await mkdtemp(join(tmpdir(),"contentgen-selective-video-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const oldPlan=plan(),oldDir=join(root,"old"),newDir=join(root,"new");
  const before=mocks();
  await renderVideoSegments(config(oldDir,oldPlan),before.api);
  assert.equal(before.touched.length,180);
  const oldSegment=await readFile(join(oldDir,"segments","segment-00000.mp4"));
  const oldMeta=await readFile(join(oldDir,"segments","segment-00000.mp4.json"));
  const revised=structuredClone(oldPlan);
  revised.chapters[1].visual.headline="The newly clarified answer";
  assert.equal(reusableChapter(oldPlan,revised,0,"b".repeat(64)),true);
  assert.equal(reusableChapter(oldPlan,revised,1,"b".repeat(64)),false);
  const next=mocks(),events=[];
  const result=await renderVideoSegments({...config(newDir,revised),
    reuseFrom:{sourcePlan:oldPlan,buildHash:"b".repeat(64),segmentsDir:join(oldDir,"segments")},
    onProgress:event=>events.push(event)},next.api);
  assert.equal(next.touched.length,90);
  assert.equal(next.touched[0],90);
  assert.equal(next.touched.at(-1),179);
  assert.deepEqual(events.filter(e=>e.phase==="segment-reused").map(e=>e.chapterIndex),[0]);
  assert.deepEqual(result.segmentHashes.map(s=>s.frameCount),[90,90]);
  assert.deepEqual(await readFile(join(oldDir,"segments","segment-00000.mp4")),oldSegment);
  assert.deepEqual(await readFile(join(oldDir,"segments","segment-00000.mp4.json")),oldMeta);
  assert.deepEqual(await readFile(join(newDir,"segments","segment-00000.mp4")),oldSegment);
});
test("retimed and globally altered scene must render all frames, not reuse unsafe visuals",async t=>{
  const root=await mkdtemp(join(tmpdir(),"contentgen-no-unsafe-reuse-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const old=plan();
  await renderVideoSegments(config(join(root,"old"),old),mocks().api);
  const moved=structuredClone(old);
  moved.events.ending=100;
  assert.equal(reusableChapter(old,moved,0,"b".repeat(64)),false);
  const changed=mocks();
  await renderVideoSegments({...config(join(root,"changed"),moved),
    reuseFrom:{sourcePlan:old,buildHash:"b".repeat(64),segmentsDir:join(root,"old","segments")}},changed.api);
  assert.equal(changed.touched.length,180);
  const durationChange=structuredClone(old);
  durationChange.manifest.durationFrames=181;
  durationChange.chapters[1].endFrame=181;
  assert.equal(reusableChapter(old,durationChange,0,"b".repeat(64)),false);
  assert.equal(reusableChapter(old,old,0,"c".repeat(64)),true); // same SHA-format; caller separately checks matching built scene
});
test("tampered prior scene video is redrawn without copying corrupted bytes",async t=>{
  const root=await mkdtemp(join(tmpdir(),"contentgen-tamper-scene-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const old=plan(),from=join(root,"old");
  await renderVideoSegments(config(from,old),mocks().api);
  await writeFile(join(from,"segments","segment-00000.mp4"),"unexpected bytes");
  const revised=structuredClone(old);revised.chapters[1].visual.headline="Edit only later chapter";
  const next=mocks();
  const result=await renderVideoSegments({...config(join(root,"new"),revised),
    reuseFrom:{sourcePlan:old,buildHash:"b".repeat(64),segmentsDir:join(from,"segments")}},next.api);
  assert.equal(result.reusedSegmentCount,0);
  assert.equal(next.touched.length,180);
  assert.notEqual((await readFile(join(root,"new","segments","segment-00000.mp4"),"utf8")),"unexpected bytes");
});
