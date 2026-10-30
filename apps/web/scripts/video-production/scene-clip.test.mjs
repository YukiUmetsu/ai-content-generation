import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {mkdtemp,mkdir,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {renderSelectedSceneClip} from "./scene-clip.mjs";

const hash=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const manifest={schemaVersion:1,id:"clip",width:1920,height:1080,
  fps:{num:30,den:1},durationFrames:90};
const chapters=[0,1,2].map(index=>({id:`beat-${index+1}`,
  startFrame:index*30,endFrame:(index+1)*30,visual:{headline:`Scene ${index+1}`}}));
const plan={manifest,chapters};
const compile=()=>({shotMap:chapters.map((chapter,i)=>({shotId:`shot-${i+1}`,beatId:chapter.id})),
  plan,renderPlanSha256:hash(plan)});
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),"contentgen-scene-clip-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,".render"));
  return root;
}
test("selected scene generates a bounded MP4 without invoking another chapter",async t=>{
  const outDir=await fixture(t),calls=[];
  let closed=false;
  const result=await renderSelectedSceneClip({dossier:{},bundle:{},shotId:"shot-2",outDir,
    browserExecutable:"/path/to/chrome"},{compile,
    openStage:async()=>({url:"http://127.0.0.1:1234/video-export.html",buildHash:"a".repeat(64),
      close:async()=>{closed=true;}}),
    render:async options=>{
      calls.push(options);
      await writeFile(join(outDir,".render","video-only.mp4"),Buffer.alloc(256,0x41));
      return {frameCount:30,sourceChapterId:"beat-2",videoOnlyPath:join(outDir,".render","video-only.mp4")};
    }});
  assert.equal(closed,true);
  assert.equal(calls.length,1);
  assert.equal(calls[0].onlyChapterId,"beat-2");
  assert.deepEqual(calls[0].manifest,manifest);
  assert.equal(calls[0].buildHash,"a".repeat(64));
  assert.equal(result.shotId,"shot-2");
  assert.equal(result.durationFrames,30);
  assert.equal(result.sizeBytes,256);
  assert.equal((await readFile(join(outDir,"video.mp4"))).length,256);
});
test("missing or excessive scenes are refused before starting a browser",async t=>{
  const outDir=await fixture(t);
  let opened=0;
  const deps={compile,openStage:async()=>{opened++;throw Error("must not start");}};
  await assert.rejects(renderSelectedSceneClip({shotId:"wrong",outDir},deps),/bounded|timeline/u);
  await assert.rejects(renderSelectedSceneClip({shotId:"../unsafe",outDir},deps),/saved storyboard/u);
  assert.equal(opened,0);
});
test("stage is closed on interrupted render and no downloadable clip is published",async t=>{
  const outDir=await fixture(t);
  let closed=0;
  await assert.rejects(renderSelectedSceneClip({shotId:"shot-1",outDir},
    {compile,openStage:async()=>({url:"http://127.0.0.1:1234",buildHash:"a".repeat(64),
      close:async()=>{closed++;}}),render:async()=>{throw Error("worker interrupted");}}),
  /worker interrupted/u);
  assert.equal(closed,1);
  await assert.rejects(readFile(join(outDir,"video.mp4")),/ENOENT/u);
});
