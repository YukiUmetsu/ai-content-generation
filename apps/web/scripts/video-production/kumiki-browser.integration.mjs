/** Optional actual Chromium -> Kumiki -> PNG -> FFmpeg -> FFprobe integration.
 * Run after `pnpm build` with CONTENTGEN_CHROMIUM_EXECUTABLE set. No voice
 * provider, credentials, external requests or published media are involved.
 */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {execFile} from "node:child_process";
import {readFileSync} from "node:fs";
import {mkdir,mkdtemp,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {promisify} from "node:util";
import {chromium} from "playwright-core";
import {buildSampleTimeline} from "./timeline.mjs";
import {compileGeneralVisuals} from "./general-visual-plan.mjs";
import {startLocalStageServer} from "./stage-server.mjs";
import {loadProjectCharacterRigs,readCharacterZip} from "./character-rig-render.mjs";
import {generateProductionThumbnails} from "./premium-thumbnails.mjs";
import {renderSelectedSceneClip} from "./scene-clip.mjs";
import {renderVideoSegments} from "./render.mjs";

const run=promisify(execFile);
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const browserPath=process.env.CONTENTGEN_CHROMIUM_EXECUTABLE;
if(!browserPath)throw Error("Set CONTENTGEN_CHROMIUM_EXECUTABLE to an installed Chromium browser.");
const input=JSON.parse(readFileSync(new URL("../../../../examples/video-production-general-smoke.json",import.meta.url)));
const timeline=buildSampleTimeline(input.beats.map(beat=>({id:beat.id,samples:48000,
  pauseAfterMs:beat.pauseAfterMs,eventIds:beat.eventIds})),
{fps:input.destination.fps,events:input.events});
const plan=compileGeneralVisuals(input,timeline);
const manifest=plan.manifest;
const root=await mkdtemp(join(tmpdir(),"contentgen-real-kumiki-"));
let stage,browser;
try{
  stage=await startLocalStageServer({distRoot:fileURLToPath(new URL("../../dist",import.meta.url)),
    validatedPlan:plan});
  // Chromium refuses to start as root inside some CI containers. This flag is
  // intentionally opt-in for this standalone test, never for production.
  const unsafeTestSandbox=process.env.CONTENTGEN_BROWSER_TEST_NO_SANDBOX==="1";
  browser=await chromium.launch({executablePath:browserPath,headless:true,
    args:unsafeTestSandbox?["--no-sandbox"]:[]});
  const page=await browser.newPage({viewport:{width:manifest.width,height:manifest.height},
    deviceScaleFactor:1,reducedMotion:"reduce"});
  const pageErrors=[];
  page.on("pageerror",error=>pageErrors.push(error.message));
  await page.goto(stage.url,{waitUntil:"networkidle",timeout:30000});
  await page.waitForFunction(()=>Boolean(window.__kmVideoExport?.manifest),undefined,{timeout:20000});
  assert.deepEqual(await page.evaluate(()=>window.__kmVideoExport.manifest),manifest,
    "the live Kumiki page must adopt the validated plan manifest");
  assert.equal(await page.evaluate(()=>window.__contentgenBuildHash),stage.buildHash,
    "a browser render must be bound to the exact built assets");
  const viewport=page.locator("[data-km-video-capture]");
  assert.equal(await viewport.count(),1,"Kumiki capture region must be present");
  const screenshots=[];
  for(let frame=0;frame<12;frame++){
    await page.evaluate(index=>window.__kmVideoExport.seek(index),frame);
    const bytes=await viewport.screenshot({path:join(root,`frame-${String(frame).padStart(5,"0")}.png`),
      animations:"disabled",scale:"css"});
    assert.equal(bytes.subarray(0,8).toString("hex"),"89504e470d0a1a0a");
    assert.equal(bytes.readUInt32BE(16),manifest.width);
    assert.equal(bytes.readUInt32BE(20),manifest.height);
    screenshots.push(sha(bytes));
  }
  await page.evaluate(()=>window.__kmVideoExport.seek(0));
  const repeated=await viewport.screenshot({animations:"disabled",scale:"css"});
  assert.equal(sha(repeated),screenshots[0],"seeking to a frame must render deterministically");
  assert.deepEqual(pageErrors,[],"the real built Kumiki page must not throw during capture");
  const video=join(root,"kumiki-smoke.mp4");
  await run("ffmpeg",["-hide_banner","-loglevel","error","-nostdin","-y",
    "-framerate",`${manifest.fps.num}/${manifest.fps.den}`,
    "-i",join(root,"frame-%05d.png"),"-frames:v","12","-c:v","libx264",
    "-pix_fmt","yuv420p",video],{timeout:60000});
  const {stdout}=await run("ffprobe",["-v","error","-count_frames","-select_streams","v:0",
    "-show_entries","stream=codec_name,width,height,nb_read_frames","-of","json",video],{timeout:30000});
  const stream=JSON.parse(stdout).streams?.[0];
  assert.equal(stream?.codec_name,"h264");
  assert.equal(stream.width,manifest.width);
  assert.equal(stream.height,manifest.height);
  assert.equal(Number(stream.nb_read_frames),12);
  // The same real compositor must consume a frozen, verified CC0 photo; this
  // guards the full automatic-media -> loopback asset -> Kumiki image boundary.
  const photoFile=join(root,"commons-scene.jpg");
  await run("ffmpeg",["-hide_banner","-loglevel","error","-nostdin","-y","-f","lavfi",
    "-i","color=c=blue:s=1280x720","-frames:v","1",photoFile],{timeout:30000});
  const photoHash=sha(await readFile(photoFile));
  const photoUrl=`/__video_media/${photoHash}.jpg`;
  const enriched=structuredClone(plan);
  enriched.chapters[0].visual.stockMedia={assetType:"photo",url:photoUrl,sha256:photoHash,
    provider:"wikimedia-commons",rightsStatus:"draft-provider-license",
    license:"CC0-1.0",licenseUrl:"https://creativecommons.org/publicdomain/zero/1.0/",
    assetId:"sample-scene",width:1280,height:720};
  const mediaStage=await startLocalStageServer({distRoot:fileURLToPath(new URL("../../dist",import.meta.url)),
    validatedPlan:enriched,approvedMedia:[{url:photoUrl,path:photoFile,sha256:photoHash,assetType:"photo"}]});
  try{
    const mediaPage=await browser.newPage({viewport:{width:manifest.width,height:manifest.height}});
    try{
      await mediaPage.goto(mediaStage.url,{waitUntil:"networkidle",timeout:30000});
      await mediaPage.waitForFunction(()=>Boolean(window.__kmVideoExport?.manifest),undefined,{timeout:20000});
      await mediaPage.evaluate(()=>window.__kmVideoExport.seek(0));
      const photo=mediaPage.locator("[data-contentgen-stock-photo]");
      await photo.waitFor({timeout:10000});
      await mediaPage.waitForFunction(()=>{
        const image=document.querySelector("[data-contentgen-stock-photo]");
        return Boolean(image?.complete&&image.naturalWidth===1280&&image.naturalHeight===720);
      });
      const seen=await mediaPage.locator("[data-km-video-capture]").screenshot();
      assert.notEqual(sha(seen),screenshots[0],"verified Commons photo must visibly change the scene");
    }finally{await mediaPage.close();}
  }finally{await mediaStage.close();}
  // Saved Character Studio ZIP sprites must animate in real Chromium, not only SSR.
  const rigArchives=new Map();
  const rigDrafts=[];
  for(const id of ["pip","quill"]){
    const bytes=await readFile(new URL("../../public/starter-characters/"+id+".zip",import.meta.url));
    const draftId=("character-draft-"+(id==="pip"?"a":"b")).padEnd(48,"0");
    rigArchives.set(draftId,bytes);
    rigDrafts.push({id:draftId,projectId:"rig-browser-smoke",characterId:id,
      revision:readCharacterZip(bytes).definition.revision,archiveSha256:sha(bytes),sizeBytes:bytes.length});
  }
  const rigPacks=await loadProjectCharacterRigs({projectId:"rig-browser-smoke",speakers:["pip","quill"],
    fetchImpl:async url=>{
      const parsed=new URL(url),match=/\/api\/character-drafts\/(character-draft-[a-f0-9]{32})\/archive/.exec(parsed.pathname);
      return match?new Response(rigArchives.get(match[1])??"",{status:rigArchives.has(match[1])?200:404}):
        new Response(JSON.stringify({drafts:rigDrafts}),{headers:{"content-type":"application/json"}});
    }});
  const rigPlan=structuredClone(plan);
  rigPlan.characterRigs=rigPacks.rigs;
  rigPlan.chapters[0].dialogue={turns:[
    {id:"pip-asks",speakerId:"pip",role:"character",animationAction:"pip-explain",startFrame:0,endFrame:24},
    {id:"quill-replies",speakerId:"quill",role:"character",startFrame:24,endFrame:30}
  ]};
  const rigStage=await startLocalStageServer({distRoot:fileURLToPath(new URL("../../dist",import.meta.url)),
    validatedPlan:rigPlan,characterAssets:rigPacks.assets});
  try{
    const rigPage=await browser.newPage({viewport:{width:manifest.width,height:manifest.height},deviceScaleFactor:1});
    try{
      await rigPage.goto(rigStage.url,{waitUntil:"networkidle",timeout:30000});
      await rigPage.waitForFunction(()=>Boolean(window.__kmVideoExport?.manifest),undefined,{timeout:20000});
      const frames=[];
      const armTransforms=[];
      for(const [index,frame] of [2,10,28].entries()){
        await rigPage.evaluate(index=>window.__kmVideoExport.seek(index),frame);
        const actor=rigPage.locator('[data-conversation-performer="pip"]');
        assert.equal(await actor.getAttribute("data-rig-source"),"character-studio");
        assert.equal(await actor.locator("[data-km-character-presenter]").getAttribute("data-diagnostics"),"0");
        assert.ok(await actor.locator("svg image").count()>=4);
        armTransforms.push(await actor.locator('[data-part="right-arm"]').getAttribute("transform"));
        if(frame===28){
          assert.equal(await actor.getAttribute("data-speaking"),"false");
          assert.ok(await actor.locator('[data-part="mouth"] [data-asset="mouthRest"]').count()>0,
            "the saved raster mouth must close while Quill speaks");
        }
        frames.push(sha(await actor.screenshot({animations:"disabled"})));
        await rigPage.locator("[data-km-video-capture]").screenshot({path:join(root,`custom-rig-${String(index).padStart(2,"0")}.png`),animations:"disabled"});
      }
      assert.notEqual(armTransforms[0],armTransforms[1],
        "saved Pip arm must actually gesture during a long measured speech turn");
      assert.notEqual(frames[0],frames[1],"saved Pip mouth/arm layers must visibly animate during measured speech");
      assert.notEqual(frames[1],frames[2],"Pip must return to listening when Quill speaks");
      assert.equal(await rigPage.locator('[data-conversation-performer="quill"]').getAttribute("data-rig-source"),"character-studio");
      assert.equal(await rigPage.locator('[data-conversation-performer="quill"]').getAttribute("data-speaking"),"true");
      assert.equal(await rigPage.locator('[data-conversation-performer="quill"] [data-km-character-presenter]').getAttribute("data-diagnostics"),"0");
    }finally{await rigPage.close();}
    // Encode the *continuous* Kumiki scene at the real manifest FPS. Three
    // sampled PNGs at 3 fps prove artwork differences, but cannot prove that
    // speech closes at frame 24 or that exported timing survives FFmpeg.
    assert.ok(rigPlan.chapters[0].endFrame>=30);
    const realRigClip=await renderVideoSegments({stageUrl:rigStage.url,
      manifest:rigPlan.manifest,visualPlan:rigPlan,onlyChapterId:rigPlan.chapters[0].id,
      planHash:sha(JSON.stringify(rigPlan)),buildHash:rigStage.buildHash,
      outDir:join(root,"continuous-custom-rig"),browserExecutable:browserPath,
      maxBatchFrames:30,reviewFrames:[2,10,28]});
    assert.equal(realRigClip.frameCount,rigPlan.chapters[0].endFrame-rigPlan.chapters[0].startFrame);
    assert.equal(realRigClip.reviewStills.length,3);
    const customMp4=realRigClip.videoOnlyPath;
    const customProbe=await run("ffprobe",["-v","error","-count_frames","-select_streams","v:0",
      "-show_entries","stream=codec_name,width,height,nb_read_frames,r_frame_rate","-of","json",customMp4],{timeout:30000});
    const customStream=JSON.parse(customProbe.stdout).streams?.[0];
    assert.equal(customStream?.codec_name,"h264");
    assert.equal(customStream?.width,1920);
    assert.equal(customStream?.height,1080);
    assert.equal(Number(customStream?.nb_read_frames),realRigClip.frameCount,
      "every measured dialogue frame must encode into a real H.264 video");
    assert.equal(customStream?.r_frame_rate,"30/1", "custom rigs cannot be exported at a sampled 3-fps animation rate");
    // Also verify the real movie's audio/video container contract without a
    // paid voice provider. The test tone stands in for an already-measured
    // 48-kHz spoken track; the actual production mux consumes that WAV.
    const clipSeconds=realRigClip.frameCount*rigPlan.manifest.fps.den/rigPlan.manifest.fps.num;
    const syncedMp4=join(root,"continuous-custom-rig-with-audio.mp4");
    await run("ffmpeg",["-hide_banner","-loglevel","error","-nostdin","-y",
      "-i",customMp4,"-f","lavfi","-i",`sine=frequency=440:sample_rate=48000:duration=${clipSeconds}`,
      "-map","0:v:0","-map","1:a:0","-c:v","copy","-c:a","aac","-b:a","128k",
      "-t",String(clipSeconds),"-movflags","+faststart",syncedMp4],{timeout:60000});
    const syncedProbe=await run("ffprobe",["-v","error","-show_entries",
      "stream=codec_type,codec_name,start_time,duration","-of","json",syncedMp4],{timeout:30000});
    const streams=JSON.parse(syncedProbe.stdout).streams??[];
    const videoTrack=streams.find(stream=>stream.codec_type==="video");
    const audioTrack=streams.find(stream=>stream.codec_type==="audio");
    assert.equal(videoTrack?.codec_name,"h264");
    assert.equal(audioTrack?.codec_name,"aac");
    for(const stream of [videoTrack,audioTrack]){
      assert.ok(Math.abs(Number(stream.start_time))<=1/rigPlan.manifest.fps.num,
        "audio/video starts cannot differ from the authored scene by more than a frame");
      assert.ok(Math.abs(Number(stream.duration)-clipSeconds)<=1/rigPlan.manifest.fps.num,
        "audio/video durations must stay within a frame of measured dialogue");
    }
  }finally{await rigStage.close();}
  // Exercise the actual selected-scene API's file publication via the same
  // Chromium page, H.264 encoder and FFprobe. Only three preview frames are
  // requested, keeping the provider-free smoke run bounded.
  const clipPlan=structuredClone(plan);
  clipPlan.manifest.durationFrames=3;
  clipPlan.chapters=[{...clipPlan.chapters[0],endFrame:3}];
  const selectedShot="selected-first-scene",clipOut=join(root,"selected-preview");
  await mkdir(clipOut);
  const clip=await renderSelectedSceneClip({shotId:selectedShot,outDir:clipOut,
    browserExecutable:browserPath},{compile:()=>({plan:clipPlan,
      renderPlanSha256:sha(Buffer.from(JSON.stringify(clipPlan))),
      shotMap:[{shotId:selectedShot,beatId:clipPlan.chapters[0].id}]}),
    render:options=>renderVideoSegments(options,{openCapture:async(url,expected)=>{
      const clipPage=await browser.newPage({viewport:{width:expected.width,height:expected.height}});
      await clipPage.goto(url,{waitUntil:"networkidle",timeout:30000});
      await clipPage.waitForFunction(()=>Boolean(window.__kmVideoExport?.manifest),undefined,{timeout:20000});
      return {manifest:await clipPage.evaluate(()=>window.__kmVideoExport.manifest),
        buildHash:await clipPage.evaluate(()=>window.__contentgenBuildHash),
        captureFrame:async(frame,path)=>{await clipPage.evaluate(index=>window.__kmVideoExport.seek(index),frame);
          await clipPage.locator("[data-km-video-capture]").screenshot({path,animations:"disabled",scale:"css"});},
        close:async()=>clipPage.close()};
    }})});
  assert.equal(clip.durationFrames,3);
  const clipProbe=await run("ffprobe",["-v","error","-count_frames","-select_streams","v:0",
    "-show_entries","stream=codec_name,width,height,nb_read_frames","-of","json",
    join(clipOut,"video.mp4")],{timeout:30000});
  const clipStream=JSON.parse(clipProbe.stdout).streams?.[0];
  assert.equal(clipStream?.codec_name,"h264");
  assert.equal(Number(clipStream.nb_read_frames),3);
  assert.equal(clipStream.width,manifest.width);
  assert.equal(clipStream.height,manifest.height);
  const concepts=await generateProductionThumbnails(input,{outputDir:root});
  assert.equal(concepts.length,3);
  await page.setViewportSize({width:1920,height:1080});
  await page.setContent(await readFile(join(root,"thumbnail-2.svg"),"utf8"));
  const textFit=await page.evaluate(()=>{
    const svg=document.querySelector("svg");
    const boxes=[...svg.querySelectorAll("rect")].map(node=>node.getBoundingClientRect());
    const panels=boxes.filter(box=>box.width>500&&box.width<600&&box.height>330&&box.height<370);
    const labels=[...svg.querySelectorAll("text")].map(node=>node.getBoundingClientRect())
      .filter(box=>panels.some(panel=>box.top>=panel.top&&box.top<panel.bottom));
    return {panels:panels.length,labels:labels.length,outside:labels.filter(label=>
      !panels.some(panel=>label.left>=panel.left+12&&label.right<=panel.right-12&&
        label.top>=panel.top+12&&label.bottom<=panel.bottom-12)).length};
  });
  assert.equal(textFit.panels,3,"bento thumbnail needs three separate visual panels");
  assert.ok(textFit.labels>=6,"bento thumbnail needs meaningful visible headings");
  assert.equal(textFit.outside,0,"no tile heading may overlap adjacent thumbnails or escape its panel");
  process.stdout.write(`PASS: real Kumiki Chromium export, a three-frame selected-scene H.264 preview, deterministic ${manifest.width}x${manifest.height} PNGs, FFprobe and three bounded thumbnail panels.\n`);
}finally{
  await browser?.close().catch(()=>{});
  await stage?.close().catch(()=>{});
  await rm(root,{recursive:true,force:true});
}
