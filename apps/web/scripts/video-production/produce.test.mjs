import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { produceVideo } from "./produce.mjs";

const source = JSON.parse(readFileSync(new URL("../../../../examples/video-production-house-math-smoke.json", import.meta.url), "utf8"));
const hash = (b) => createHash("sha256").update(b).digest("hex");

async function context(t) {
  const root = await mkdtemp(join(tmpdir(), "contentgen-pipeline-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const job = structuredClone(source);
  job.voice = { profileId: "local-narrator", provider: "local", modelId: "installed-mock", voiceId: "licensed", locale: "en-US", endpoint: "http://127.0.0.1:8765", licenseStatus: "test-only" };
  let providerCalls = 0, sceneCalls = 0, browserCalls = 0, closed = false;
  const injected = {
    synthesizeNarration: async (j) => {
      providerCalls += j.beats.length;
      return j.beats.map((b) => ({ id: b.id, samples: 48000, pauseAfterMs: b.pauseAfterMs, eventIds: b.eventIds, text: b.narration, wavPath: "mocked", sha256: hash(b.narration), provider: "local", modelId: "installed-mock", providerRevision: "bridge-1" }));
    },
    renderMasterAudio: async (input, options) => {
      await mkdir(options.outputDir, { recursive: true });
      const wavPath = join(options.outputDir, "master.wav"), voiceStemPath = join(options.outputDir, "voice.wav"), srtPath = join(options.outputDir, "captions.srt");
      await writeFile(wavPath, "generated-audio");
      await writeFile(voiceStemPath, "voice");
      await writeFile(srtPath, "1\n00:00:00,000 --> 00:00:01,000\nSample");
      return { wavPath, voiceStemPath, srtPath, samples: input.timeline.totalSamples, loudness: { integratedLufs: -16, truePeakDbtp: -2 }, findings: [] };
    },
    startLocalStageServer: async ({ validatedPlan }) => {
      sceneCalls++;
      assert.equal(validatedPlan.kind, "house-math-visual-plan");
      return { url: "http://127.0.0.1:9876/video-export.html", buildHash: "b".repeat(64), close: async () => { closed = true; } };
    },
    preflightExport: async () => ({ buildHash: "b".repeat(64) }),
    renderVideoSegments: async ({ manifest, outDir, reviewFrames }) => {
      browserCalls++;
      await mkdir(outDir, { recursive: true });
      const videoOnlyPath = join(outDir, "video-only.mp4");
      await writeFile(videoOnlyPath, "h264-video");
      await mkdir(join(outDir, "stills"), { recursive: true });
      const reviewStills = await Promise.all(reviewFrames.map(async (frame) => {
        const path = join(outDir, "stills", `frame-${String(frame).padStart(6, "0")}.png`);
        const bytes = Buffer.from(`captured-frame-${frame}`);
        await writeFile(path, bytes);
        return { frame, path, sha256: hash(bytes) };
      }));
      return { videoOnlyPath, frameCount: manifest.durationFrames, segmentHashes: [{ sha256: hash("seg"), startFrame: 0, frameCount: manifest.durationFrames }], reviewStills, peakScratchBytes: 10000 };
    },
    mux: async (_video, _audio, output) => { await writeFile(output, "muxed-film"); },
    probeMp4: async (_path, { fps, totalFrames, totalSamples }) => ({ width: 1920, height: 1080, fps, frameCount: totalFrames, audioSampleRate: 48000, audioDurationSeconds: totalSamples / 48000, videoDurationSeconds: totalFrames * fps.den / fps.num }),
    generateThumbnails: async (_job, { outputDir }) => Promise.all([1,2,3].map(async n => {
      const file=`thumbnail-${n}.png`,source=`thumbnail-${n}.svg`;
      const bytes=Buffer.from(`kumiki-png-${n}`),svg=Buffer.from(`<svg>${n}</svg>`);
      await writeFile(join(outputDir,file),bytes);
      await writeFile(join(outputDir,source),svg);
      return {id:`thumbnail-${n}`,file,source,sha256:hash(bytes),sourceSha256:hash(svg),width:1280,height:720};
    })),
    toolVersions: { ffmpeg: "mock-ffmpeg", ffprobe: "mock-ffprobe" },
  };
  const opts = { out: join(root, "production"), provider: "local", providerRevision: "bridge-1", localVoiceAuthorized: true, allowTestAssets: true, distRoot: join(root, "dist") };
  return { root, job, injected, opts, status: () => ({ providerCalls, sceneCalls, browserCalls, closed }) };
}

test("one command connects synthetic adapter outputs into atomically published reviewed-draft artifacts", async (t) => {
  const ctx = await context(t);
  const thumbnailGenerator=ctx.injected.generateThumbnails;
  ctx.injected.generateThumbnails=async(job,options)=>{
    assert.equal(options.cacheDir,join(ctx.opts.out,".render","thumbnails"));
    return thumbnailGenerator(job,options);
  };
  const result = await produceVideo(ctx.job, ctx.opts, ctx.injected);
  assert.equal(ctx.status().providerCalls, 3);
  assert.equal(ctx.status().browserCalls, 1);
  assert.equal(ctx.status().closed, true);
  assert.equal(result.qa.technicalPass, true);
  assert.equal(result.qa.commercialReady, false);
  assert.ok(result.qa.findings.some(({ code, severity }) => code === "caption-reading-speed" && severity === "warning"));
  assert.match(await readFile(join(result.releaseDir, "video.mp4"), "utf8"), /muxed-film/);
  assert.deepEqual((await readdir(result.releaseDir)).sort(), ["captions.srt", "cover-still.png", "master.wav", "qa-report.json", "render-manifest.json", "stills", "thumbnail-1.png", "thumbnail-1.svg", "thumbnail-2.png", "thumbnail-2.svg", "thumbnail-3.png", "thumbnail-3.svg", "video.mp4", "voice.wav"]);
  assert.equal(result.qa.reviewStills.length >= 2, true);
  for (const still of result.qa.reviewStills) {
    const bytes = await readFile(join(result.releaseDir, still.file));
    assert.equal(hash(bytes), still.sha256);
  }
  const manifest = JSON.parse(await readFile(join(result.releaseDir, "render-manifest.json"), "utf8"));
  assert.equal(manifest.artifacts.coverStill,hash(await readFile(join(result.releaseDir,"cover-still.png"))));
  assert.equal(manifest.artifacts.coverStill,manifest.reviewStills[0].sha256);
  assert.equal(manifest.buildHash, "b".repeat(64));
  assert.equal(manifest.artifacts.voice, hash(await readFile(join(result.releaseDir, "voice.wav"))));
  assert.equal(manifest.narration.length, ctx.job.beats.length);
  assert.equal(manifest.narration[0].providerRevision, "bridge-1");
  assert.equal(manifest.narration[0].sha256, hash(ctx.job.beats[0].narration));
  assert.equal(manifest.soundDucking,null,"drafts without background beds must not claim voice-triggered ducking");
});

test("selected scene photo reaches the actual general Kumiki plan and stage before narration", async t => {
  const ctx = await context(t);
  const general = JSON.parse(readFileSync(new URL("../../../../examples/video-production-general-smoke.json", import.meta.url), "utf8"));
  ctx.job = { ...general, voice: ctx.job.voice };
  const beatId = ctx.job.beats[0].id;
  const photoHash = "e".repeat(64);
  const media = { assetType: "photo", sha256: photoHash, url: `/__video_media/${photoHash}.jpg`,
    provider: "pexels", assetId: "49", sourceUrl: "https://www.pexels.com/photo/roof-49/",
    license: "Pexels License", licenseUrl: "https://www.pexels.com/license/", creator: "Photographer" };
  const asset = { url: media.url, path: join(ctx.root, "frozen.jpg"), sha256: photoHash, assetType: "photo" };
  const events = [],progress=[];
  ctx.injected.prepareApprovedSceneMedia = async input => {
    events.push("asset-preflight");
    assert.equal(input.projectId, "dossier-1");
    assert.deepEqual(input.shotMap, [{ shotId: "scene-roof", beatId }]);
    return { fingerprint: "c".repeat(64), bindings: { [beatId]: media }, assets: [asset] };
  };
  const speech = ctx.injected.synthesizeNarration;
  ctx.injected.synthesizeNarration = async (...args) => { events.push("narration"); return speech(...args); };
  ctx.injected.startLocalStageServer = async ({ validatedPlan, approvedMedia }) => {
    assert.equal(validatedPlan.kind, "general-explainer-visual-plan");
    assert.equal(validatedPlan.chapters[0].visual.stockMedia.url, media.url);
    assert.equal(validatedPlan.chapters[0].visual.stockMedia.sha256, photoHash);
    assert.deepEqual(approvedMedia, [asset]);
    return { url: "http://127.0.0.1:9876/video-export.html", buildHash: "b".repeat(64), close: async () => {} };
  };
  const result = await produceVideo(ctx.job, { ...ctx.opts, sceneAssetProjectId: "dossier-1",
    sceneShotMap: [{ shotId: "scene-roof", beatId }], expectedSceneMediaFingerprint: "c".repeat(64),
    onProgress:event=>progress.push(event) }, ctx.injected);
  assert.deepEqual(events, ["asset-preflight", "narration"]);
  assert.deepEqual(progress.find(event=>event.phase==="narration")?.artifactLedger,
    {kind:"asset-preparation",fingerprint:"c".repeat(64),
      selected:[{beatId,assetType:"photo",sha256:photoHash}]});
  assert.ok(!JSON.stringify(progress).includes(asset.path));
  const released = JSON.parse(await readFile(join(result.releaseDir, "render-manifest.json"), "utf8"));
  assert.equal(released.plan.chapters[0].visual.stockMedia.sha256, photoHash);
  assert.equal(released.sceneMedia[0].sha256, photoHash);
});

test("a missing user-selected scene photo fails before any provider TTS or render call", async t => {
  const ctx = await context(t);
  ctx.injected.prepareApprovedSceneMedia = async () => { throw Error("Selected asset changed; choose another image"); };
  await assert.rejects(produceVideo(ctx.job, { ...ctx.opts, sceneAssetProjectId: "dossier-1",
    sceneShotMap: [{ shotId: "scene-roof", beatId: ctx.job.beats[0].id }] }, ctx.injected), /Selected asset changed/);
  assert.equal(ctx.status().providerCalls, 0);
  assert.equal(ctx.status().browserCalls, 0);
});

test("opted-in automatic photo becomes actual scene media before narration and persists draft provenance",async t=>{
  const ctx=await context(t);
  const general=JSON.parse(readFileSync(new URL("../../../../examples/video-production-general-smoke.json",import.meta.url),"utf8"));
  ctx.job={...general,voice:ctx.job.voice};
  const beatId=ctx.job.beats[0].id,photoHash="f".repeat(64),events=[];
  const media={assetType:"photo",url:`/__video_media/${photoHash}.jpg`,sha256:photoHash,
    provider:"pexels",assetId:"42",sourceUrl:"https://www.pexels.com/photo/roof-42/",
    license:"Pexels License",licenseUrl:"https://www.pexels.com/license/",
    rightsStatus:"draft-provider-license",automaticallyPrepared:true};
  ctx.injected.prepareApprovedSceneMedia=async()=>({bindings:{},assets:[],fingerprint:hash("empty")});
  ctx.injected.prepareAutomaticDraftMedia=async(input)=>{
    events.push("photo-prepare");
    assert.equal(input.pexelsKey,"local-test-key");
    assert.equal(input.shotMap[0].beatId,beatId);
    return {bindings:{[beatId]:media},assets:[{url:media.url,path:join(ctx.root,"photo.jpg"),
      sha256:photoHash,assetType:"photo"}],fingerprint:hash("photo-plan"),prepared:1,warnings:[]};
  };
  const speech=ctx.injected.synthesizeNarration;
  ctx.injected.synthesizeNarration=async(...args)=>{events.push("narration");return speech(...args);};
  ctx.injected.startLocalStageServer=async({validatedPlan,approvedMedia})=>{
    assert.equal(validatedPlan.chapters[0].visual.stockMedia.rightsStatus,"draft-provider-license");
    assert.equal(approvedMedia.length,1);
    return {url:"http://127.0.0.1:9876/video-export.html",buildHash:"b".repeat(64),close:async()=>{}};
  };
  const produced=await produceVideo(ctx.job,{...ctx.opts,sceneAssetProjectId:"dossier-1",
    sceneShotMap:[{shotId:"scene-roof",beatId}],autoPrepareFreeMedia:true,pexelsKey:"local-test-key",
    prepareAssetSuggestions:async()=>{
      await writeFile(join(ctx.opts.out,"asset-suggestions.json"),JSON.stringify({
        suggestions:{kind:"contentgen-scene-asset-suggestions",scenes:[]}}));
      return {status:"completed"};
    }},ctx.injected);
  assert.deepEqual(events,["photo-prepare","narration"]);
  const manifest=JSON.parse(await readFile(join(produced.releaseDir,"render-manifest.json"),"utf8"));
  assert.equal(manifest.sceneMedia[0].rightsStatus,"draft-provider-license");
  assert.equal(manifest.sceneMedia[0].sha256,photoHash);
});

test("opted-in automatic H.264 footage reaches the actual Kumiki scene and keeps draft provenance",async t=>{
  const ctx=await context(t);
  const general=JSON.parse(readFileSync(new URL("../../../../examples/video-production-general-smoke.json",import.meta.url),"utf8"));
  ctx.job={...general,voice:ctx.job.voice};
  const beatId=ctx.job.beats[0].id,videoHash="e".repeat(64),events=[];
  const media={assetType:"video",url:`/__video_media/${videoHash}.mp4`,sha256:videoHash,
    provider:"pexels",assetId:"71",sourceUrl:"https://www.pexels.com/video/roof-71/",
    license:"Pexels License",licenseUrl:"https://www.pexels.com/license/",
    durationSeconds:12,width:1280,height:720,
    rightsStatus:"draft-provider-license",automaticallyPrepared:true};
  ctx.injected.prepareApprovedSceneMedia=async()=>({bindings:{},assets:[],fingerprint:hash("empty")});
  ctx.injected.prepareAutomaticDraftMedia=async()=>({bindings:{[beatId]:media},
    assets:[{url:media.url,path:join(ctx.root,"clip.mp4"),sha256:videoHash,assetType:"video"}],
    fingerprint:hash("video-plan"),prepared:1,warnings:[]});
  const speech=ctx.injected.synthesizeNarration;
  ctx.injected.synthesizeNarration=async(...args)=>{events.push("narration");return speech(...args);};
  ctx.injected.startLocalStageServer=async({validatedPlan,approvedMedia})=>{
    assert.equal(validatedPlan.chapters[0].visual.stockMedia.assetType,"video");
    assert.equal(validatedPlan.chapters[0].visual.stockMedia.durationSeconds,12);
    assert.equal(approvedMedia[0].assetType,"video");
    assert.equal(approvedMedia[0].url,media.url);
    return {url:"http://127.0.0.1:9876/video-export.html",buildHash:"b".repeat(64),close:async()=>{}};
  };
  const produced=await produceVideo(ctx.job,{...ctx.opts,sceneAssetProjectId:"dossier-1",
    sceneShotMap:[{shotId:"scene-roof",beatId}],autoPrepareFreeMedia:true,pexelsKey:"local-test-key",
    prepareAssetSuggestions:async()=>{
      await writeFile(join(ctx.opts.out,"asset-suggestions.json"),JSON.stringify({
        suggestions:{kind:"contentgen-scene-asset-suggestions",scenes:[]}}));
      return {status:"completed"};
    },onProgress:async event=>{if(event.phase==="asset-prepared")events.push(event.message);}},ctx.injected);
  assert.equal(events.at(-1),"narration");
  assert.match(events[0],/original scene media items prepared/);
  const manifest=JSON.parse(await readFile(join(produced.releaseDir,"render-manifest.json"),"utf8"));
  assert.equal(manifest.sceneMedia[0].assetType,"video");
  assert.equal(manifest.sceneMedia[0].sha256,videoHash);
  assert.equal(manifest.sceneMedia[0].rightsStatus,"draft-provider-license");
});

test("release manifest records approved sound identity, event, and measured cue sample without local paths",async t=>{
  const ctx=await context(t);
  const original=ctx.injected.renderMasterAudio;
  let received;
  ctx.injected.renderMasterAudio=async(input,options)=>{received=input.sfx;return original(input,options);};
  const sample=ctx.job.sounds[0];
  ctx.job.sounds=[{...sample,assetRef:"/approved/local/asset.wav",assetSha256:"a".repeat(64),
    licenseStatus:"verified"}];
  const result=await produceVideo(ctx.job,ctx.opts,ctx.injected);
  assert.equal(received[0].assetSha256,"a".repeat(64));
  assert.equal(received[0].assetPath,"/approved/local/asset.wav");
  const manifest=JSON.parse(await readFile(join(result.releaseDir,"render-manifest.json"),"utf8"));
  assert.deepEqual(manifest.soundEffects,[{id:sample.id,eventId:sample.eventId,
    eventSample:124800,licenseStatus:"verified",assetSha256:"a".repeat(64)}]);
  assert.ok(!JSON.stringify(manifest).includes("/approved/local/asset.wav"));
});

test("release manifest records actual voice-sidechain sound settings",async t=>{
  const ctx=await context(t),original=ctx.injected.renderMasterAudio;
  const ducking={mode:"voice-sidechain",beds:1,threshold:0.018,ratio:8,attackMs:70,releaseMs:350};
  ctx.injected.renderMasterAudio=async(...args)=>({...await original(...args),ducking});
  const result=await produceVideo(ctx.job,ctx.opts,ctx.injected);
  const manifest=JSON.parse(await readFile(join(result.releaseDir,"render-manifest.json"),"utf8"));
  assert.deepEqual(manifest.soundDucking,ducking);
});

test("release manifest records effective offsets and ambience settings without revealing sound paths",async t=>{
  const ctx=await context(t),payoff=ctx.job.sounds[0].eventId;
  ctx.job.events.push({id:"sound-bed-start",beatId:ctx.job.beats[0].id});
  ctx.job.beats[0].eventIds.push("sound-bed-start");
  ctx.job.sounds=[{id:"manual-layer",kind:"effect",eventId:payoff,category:"supplemental",
    assetRef:"/approved/clip.wav",assetSha256:"e".repeat(64),licenseStatus:"verified",
    offsetMs:375,gainDb:-28,fadeInMs:80,fadeOutMs:120},
    {id:"room-tone",kind:"ambience",eventId:"sound-bed-start",category:"ambience",
      assetRef:"/approved/room.wav",assetSha256:"f".repeat(64),licenseStatus:"verified",
      offsetMs:0,gainDb:-33,fadeInMs:1200,fadeOutMs:1800}];
  const result=await produceVideo(ctx.job,ctx.opts,ctx.injected);
  const manifest=JSON.parse(await readFile(join(result.releaseDir,"render-manifest.json"),"utf8"));
  assert.equal(manifest.soundEffects[0].eventSample,124800+375*48);
  assert.equal(manifest.soundEffects[0].gainDb,-28);
  assert.equal(manifest.soundEffects[0].fadeOutMs,120);
  assert.equal(manifest.soundEffects[1].eventSample,0);
  assert.equal(manifest.soundEffects[1].kind,"ambience");
  assert.ok(!JSON.stringify(manifest.soundEffects).includes("/approved/"));
});

test("production binds a reviewed visual sound to a measured on-screen reveal before mixing and export",async t=>{
  const ctx=await context(t),generic=JSON.parse(readFileSync(
    new URL("../../../../examples/video-production-general-smoke.json",import.meta.url),"utf8"));
  ctx.job={...generic,voice:ctx.job.voice};
  const first=ctx.job.beats[0];
  first.eventIds.push("semantic-reveal");
  ctx.job.events.push({id:"semantic-reveal",beatId:first.id,anchor:"first-visual-reveal"});
  ctx.job.sounds=[{id:"semantic-whoosh",eventId:"semantic-reveal",category:"visual.reveal",
    assetRef:"/reviewed/whoosh.wav",assetSha256:"b".repeat(64),licenseStatus:"verified"}];
  let audioEvent=null,visualEvent=null;
  const originalAudio=ctx.injected.renderMasterAudio;
  ctx.injected.renderMasterAudio=async(input,options)=>{
    audioEvent=input.timeline.eventSamples["semantic-reveal"];
    assert.equal(input.sfx[0].eventId,"semantic-reveal");
    return originalAudio(input,options);
  };
  ctx.injected.startLocalStageServer=async({validatedPlan})=>{
    assert.equal(validatedPlan.kind,"general-explainer-visual-plan");
    visualEvent=validatedPlan.events["semantic-reveal"];
    return {url:"http://127.0.0.1:9876/video-export.html",buildHash:"b".repeat(64),close:async()=>{}};
  };
  const result=await produceVideo(ctx.job,ctx.opts,ctx.injected);
  const manifest=JSON.parse(await readFile(join(result.releaseDir,"render-manifest.json"),"utf8"));
  assert.ok(Number.isSafeInteger(audioEvent)&&audioEvent>0);
  assert.ok(Number.isSafeInteger(visualEvent)&&visualEvent>0);
  assert.equal(manifest.soundEffects[0].eventSample,audioEvent);
  assert.equal(manifest.plan.events["semantic-reveal"],visualEvent);
  assert.equal(manifest.plan.events[ctx.job.topic.payoffEventId],
    manifest.plan.chapters.at(-1).startFrame);
});

test("production emits real stage transitions and forwards verified capture frame progress", async (t) => {
  const ctx = await context(t);
  const events = [];
  const originalRender = ctx.injected.renderVideoSegments;
  ctx.injected.renderVideoSegments = async (options) => {
    options.onProgress?.({ phase: "rendering", completedFrames: 90, totalFrames: 90 });
    return originalRender(options);
  };
  const result=await produceVideo(ctx.job, { ...ctx.opts, onProgress: (event) => events.push(event) }, ctx.injected);
  const phases = events.map((event) => event.phase);
  assert.deepEqual(phases, ["browser-preflight", "asset-search", "asset-preparation", "narration", "timeline", "audio", "captions", "rendering", "rendering", "thumbnails", "mux", "qa", "review"]);
  assert.deepEqual(events.find((event) => event.completedFrames === 90),
    { phase: "rendering", completedFrames: 90, totalFrames: 90 });
  const narration=events.find(event=>event.phase==="timeline")?.artifactLedger;
  assert.equal(narration?.kind,"narration");
  assert.equal(narration?.beats.length,ctx.job.beats.length);
  assert.match(narration?.beats[0].sha256,/^[a-f0-9]{64}$/);
  const visual=events.find(event=>event.phase==="thumbnails")?.artifactLedger;
  assert.equal(visual?.kind,"scene-render");
  assert.match(visual?.planHash,/^[a-f0-9]{64}$/);
  const release=JSON.parse(await readFile(join(result.releaseDir,"render-manifest.json"),"utf8"));
  assert.deepEqual(visual?.segments,release.segmentHashes);
  const captions=events.find(event=>event.phase==="rendering")?.artifactLedger;
  assert.equal(captions?.kind,"captions");
  assert.equal(captions?.sha256,hash("1\n00:00:00,000 --> 00:00:01,000\nSample"));
  const thumbnails=events.find(event=>event.phase==="mux")?.artifactLedger;
  assert.equal(thumbnails?.kind,"thumbnails");
  assert.equal(thumbnails?.concepts.length,3);
  const mux=events.find(event=>event.phase==="qa")?.artifactLedger;
  assert.equal(mux?.kind,"final-mux");
  assert.equal(mux?.artifacts.video,hash("muxed-film"));
  assert.equal(mux?.artifacts.captions,hash("1\n00:00:00,000 --> 00:00:01,000\nSample"));
  const technical=events.find(event=>event.phase==="review")?.artifactLedger;
  assert.equal(technical?.kind,"technical-qa");
  assert.equal(technical?.technicalPass,true);
  assert.match(technical?.manifestHash,/^[a-f0-9]{64}$/);
  assert.equal(result.artifactHashes?.coverStill,hash("captured-frame-0"));
  assert.ok(!JSON.stringify(events).includes(ctx.opts.out),"durable job data must never disclose local paths");
});

test("the renderer waits for a durable narration claim before calling the voice provider",async t=>{
  const ctx=await context(t);
  let openGate,arrived;
  const gate=new Promise(resolve=>{openGate=resolve;});
  const claimed=new Promise(resolve=>{arrived=resolve;});
  const work=produceVideo(ctx.job,{...ctx.opts,onProgress:event=>{
    if(event.phase==="narration"){arrived();return gate;}
  }},ctx.injected);
  await claimed;
  assert.equal(ctx.status().providerCalls,0,"no voice request may run ahead of the claimed Jobs stage");
  openGate();
  await work;
  assert.ok(ctx.status().providerCalls>0);
});

test("a rejected Jobs claim prevents any paid or external production work",async t=>{
  const ctx=await context(t);
  await assert.rejects(produceVideo(ctx.job,{...ctx.opts,
    onProgress:event=>event.phase==="browser-preflight"?Promise.reject(Error("Jobs claim unavailable")):undefined},
    ctx.injected),/Jobs claim unavailable/);
  assert.equal(ctx.status().providerCalls,0);
  assert.equal(ctx.status().browserCalls,0);
});

test("media suggestions are prepared before narration and expose a bounded Jobs summary",async t=>{
  const ctx=await context(t),events=[];
  const originalNarration=ctx.injected.synthesizeNarration;
  ctx.injected.synthesizeNarration=async(...args)=>{events.push("voice");return originalNarration(...args);};
  await produceVideo(ctx.job,{...ctx.opts,
    prepareAssetSuggestions:async()=>{events.push("search");return{status:"partial",candidates:3,warnings:["Pexels unavailable"]};},
    onProgress:event=>{if(event.phase==="asset-preparation")events.push(event.assetSearchSummary);}},ctx.injected);
  assert.equal(events[0],"search");
  assert.deepEqual(events[1],{status:"partial",candidates:3,warnings:["Pexels unavailable"]});
  assert.equal(events[2],"voice");
});

test("retrying an interrupted draft uses only its existing verified speech-cache directory",async t=>{
  const ctx=await context(t),prior=join(ctx.root,"draft-prior"),cache=join(prior,".cache");
  await mkdir(cache,{recursive:true});
  let actualCache;
  const normal=ctx.injected.synthesizeNarration;
  ctx.injected.synthesizeNarration=async(job,options)=>{
    actualCache=options.reuseCacheRoot;
    assert.equal(options.skipInvalidPriorCache,true);
    return normal(job,options);
  };
  await produceVideo(ctx.job,{...ctx.opts,reuseSpeechCacheFrom:prior},ctx.injected);
  assert.equal(actualCache,cache);
  const next=await context(t);
  let missingCache;
  const nextSpeech=next.injected.synthesizeNarration;
  next.injected.synthesizeNarration=async(job,options)=>{
    missingCache=options.reuseCacheRoot;return nextSpeech(job,options);
  };
  await produceVideo(next.job,{...next.opts,reuseSpeechCacheFrom:join(next.root,"missing-prior")},next.injected);
  assert.equal(missingCache,null,"a missing interrupted cache must safely regenerate narration");
});

test("a failed draft persists its exact Kumiki plan so retry can reuse verified scene segments",async t=>{
  const first=await context(t);
  first.injected.renderVideoSegments=async options=>{
    await mkdir(join(options.outDir,"segments"),{recursive:true});
    throw Error("capture stopped midway");
  };
  await assert.rejects(produceVideo(first.job,first.opts,first.injected),/capture stopped midway/);
  const sourcePath=join(first.opts.out,".render","render-source-plan.json");
  const saved=JSON.parse(await readFile(sourcePath,"utf8"));
  assert.equal(saved.schemaVersion,1);
  assert.equal(saved.buildHash,"b".repeat(64));
  assert.equal(saved.planHash,hash(JSON.stringify(saved.plan)));
  assert.equal(saved.plan.chapters.length,first.job.beats.length);
  assert.equal((await readdir(first.opts.out)).includes("release"),false);
  const second=await context(t);
  const original=second.injected.renderVideoSegments;
  second.injected.renderVideoSegments=async options=>{
    assert.deepEqual(options.reuseFrom?.sourcePlan,saved.plan);
    assert.equal(options.reuseFrom?.buildHash,"b".repeat(64));
    assert.equal(options.reuseFrom?.segmentsDir,join(first.opts.out,".render","segments"));
    return original(options);
  };
  await produceVideo(second.job,{...second.opts,reuseRenderSegmentsFrom:first.opts.out},second.injected);
});

test("tampered interrupted scene plan is ignored without trusting its segment cache",async t=>{
  const first=await context(t);
  first.injected.renderVideoSegments=async options=>{
    await mkdir(join(options.outDir,"segments"),{recursive:true});
    throw Error("browser interrupted");
  };
  await assert.rejects(produceVideo(first.job,first.opts,first.injected),/browser interrupted/);
  const path=join(first.opts.out,".render","render-source-plan.json");
  const saved=JSON.parse(await readFile(path,"utf8"));
  await writeFile(path,JSON.stringify({...saved,planHash:"0".repeat(64)}));
  const second=await context(t);
  const original=second.injected.renderVideoSegments;
  second.injected.renderVideoSegments=async options=>{
    assert.equal(options.reuseFrom,undefined,"a changed plan cannot be used for scene reuse");
    return original(options);
  };
  await produceVideo(second.job,{...second.opts,reuseRenderSegmentsFrom:first.opts.out},second.injected);
});

test("cancelling media search prevents voice calls and leaves no completed release",async t=>{
  const ctx=await context(t),abort=new AbortController();
  await assert.rejects(produceVideo(ctx.job,{...ctx.opts,signal:abort.signal,
    prepareAssetSuggestions:async()=>{abort.abort(Error("Stopped by editor"));return{status:"cancelled"};}},ctx.injected),
    /cancelled during scene media discovery/i);
  assert.equal(ctx.status().providerCalls,0);
  assert.equal((await readdir(ctx.opts.out)).includes("release"),false);
});

test("stage/render failure closes the local server and never publishes an incomplete release", async (t) => {
  const ctx = await context(t);
  ctx.injected.renderVideoSegments = async () => { throw new Error("mock browser crash"); };
  await assert.rejects(produceVideo(ctx.job, ctx.opts, ctx.injected), /browser crash/);
  assert.equal(ctx.status().closed, true);
  assert.equal((await readdir(ctx.opts.out)).includes("release"), false);
  assert.equal((await readdir(ctx.opts.out)).some((name) => name.startsWith(".release-staging-")), false);
});

test("denies unauthorized local voice and mismatched provider before any TTS call", async (t) => {
  const ctx = await context(t);
  await assert.rejects(produceVideo(ctx.job, { ...ctx.opts, localVoiceAuthorized: false }, ctx.injected), /voice|authoriz/i);
  await assert.rejects(produceVideo(ctx.job, { ...ctx.opts, provider: "fish" }, ctx.injected), /provider|substitution/i);
  assert.equal(ctx.status().providerCalls, 0);
});

test("final release cannot silently overwrite prior output", async (t) => {
  const ctx = await context(t);
  await produceVideo(ctx.job, ctx.opts, ctx.injected);
  await assert.rejects(produceVideo(ctx.job, ctx.opts, ctx.injected), /exists|release/i);
  assert.equal(ctx.status().browserCalls, 1);
});

test("blocks paid Fish models before any provider call when per-job spending is not metered", async (t) => {
  const ctx = await context(t);
  ctx.job.voice = { ...source.voice, modelId: "s2.1-pro", voiceId: "licensed-reference" };
  const fish = {
    ...ctx.opts, provider: "fish", allowNetwork: true, voiceReferenceConsent: true,
    textTransmissionApproved: true, apiKey: "dummy", paidUsageApproved: true, budgetUsd: 1,
  };
  await assert.rejects(produceVideo(ctx.job, fish, ctx.injected), /paid|meter|budget/i);
  assert.equal(ctx.status().providerCalls, 0);
});

test("direct pipeline call rejects budget exceeding job cap before generation", async (t) => {
  const ctx = await context(t);
  await assert.rejects(produceVideo(ctx.job, { ...ctx.opts, budgetUsd: 1 }, ctx.injected), /budget|cost/i);
  assert.equal(ctx.status().providerCalls, 0);
});

test("missing review frames aborts publication rather than claiming a complete export", async (t) => {
  const ctx = await context(t);
  ctx.injected.renderVideoSegments = async () => ({ frameCount: 90, segmentHashes: [], reviewStills: [], peakScratchBytes: 0, videoOnlyPath: "missing" });
  await assert.rejects(produceVideo(ctx.job, ctx.opts, ctx.injected), /review still|preview/i);
  assert.equal((await readdir(ctx.opts.out)).includes("release"), false);
});

test("broken renderer prerequisites fail before any provider usage or output publication", async (t) => {
  const ctx = await context(t);
  ctx.injected.preflightExport = async () => { throw new Error("built renderer missing"); };
  await assert.rejects(produceVideo(ctx.job, ctx.opts, ctx.injected), /renderer missing/);
  assert.equal(ctx.status().providerCalls, 0);
  assert.equal(ctx.status().sceneCalls, 0);
});

test("rebuilding scene between preflight and capture never publishes stale pixels", async (t) => {
  const ctx = await context(t);
  const serve = ctx.injected.startLocalStageServer;
  ctx.injected.startLocalStageServer = async (data) => ({ ...await serve(data), buildHash: "c".repeat(64) });
  await assert.rejects(produceVideo(ctx.job, ctx.opts, ctx.injected), /build|scene.*changed/i);
  assert.equal(ctx.status().browserCalls, 0);
});


test("revised production accepts only a verified previous release, forwards media reuse and never mutates original",async t=>{
  const ctx=await context(t);
  const old=await produceVideo(ctx.job,ctx.opts,ctx.injected);
  const oldManifest=await readFile(join(old.releaseDir,"render-manifest.json"));
  const oldVideo=await readFile(join(old.releaseDir,"video.mp4"));
  const nextOut=join(ctx.root,"revised-render");
  const revised=structuredClone(ctx.job);
  revised.beats[1].narration+=" This is the updated sentence.";
  let reuseSpeechRoot=null,renderReuse=null;
  const injected={
    ...ctx.injected,
    synthesizeNarration:async (job,settings)=>{
      reuseSpeechRoot=settings.reuseCacheRoot;
      return ctx.injected.synthesizeNarration(job,settings);
    },
    renderVideoSegments:async options=>{
      renderReuse=options.reuseFrom;
      assert.equal(options.visualPlan.kind,"house-math-visual-plan");
      return ctx.injected.renderVideoSegments(options);
    }
  };
  const result=await produceVideo(revised,{...ctx.opts,out:nextOut,reuseFrom:ctx.opts.out},injected);
  assert.equal(reuseSpeechRoot,join(ctx.opts.out,".cache"));
  assert.equal(renderReuse.buildHash,"b".repeat(64));
  assert.equal(renderReuse.segmentsDir,join(ctx.opts.out,".render","segments"));
  assert.equal(renderReuse.sourcePlan.kind,"house-math-visual-plan");
  assert.match(await readFile(join(result.releaseDir,"video.mp4"),"utf8"),/muxed-film/);
  assert.deepEqual(await readFile(join(old.releaseDir,"render-manifest.json")),oldManifest);
  assert.deepEqual(await readFile(join(old.releaseDir,"video.mp4")),oldVideo);
  await assert.rejects(produceVideo(revised,{...ctx.opts,out:ctx.opts.out,reuseFrom:ctx.opts.out},ctx.injected),/release|same|different/i);
});
test("corrupt previous plan hash refuses release before any TTS",async t=>{
  const ctx=await context(t);
  const first=await produceVideo(ctx.job,ctx.opts,ctx.injected);
  const path=join(first.releaseDir,"render-manifest.json");
  const doc=JSON.parse(await readFile(path,"utf8"));
  doc.planHash="0".repeat(64);
  await writeFile(path,JSON.stringify(doc));
  const oldCalls=ctx.status().providerCalls;
  await assert.rejects(produceVideo(ctx.job,{...ctx.opts,out:join(ctx.root,"new"),reuseFrom:ctx.opts.out},ctx.injected),/tampered|invalid/i);
  assert.equal(ctx.status().providerCalls,oldCalls);
});
