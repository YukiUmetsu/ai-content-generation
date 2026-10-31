import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approveAsset, clearSelectedSceneAsset, discoverShotAssets, listApprovedAssets,
  listSelectedSceneAssets, planSceneAssetNeeds, selectApprovedSceneAsset,
  importDownloadedPexelsAsset, importPexelsPhotoPage } from "./asset-discovery.mjs";

const exec=promisify(execFile);

test("site-downloaded Pexels JPEG is checked, hashed, reusable, and explicitly pinnable",async t=>{
  const root=await mkdtemp(join(tmpdir(),"pexels-website-upload-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const image=Buffer.alloc(512);image.set([0xff,0xd8,0xff]);
  const input={projectId:"project-1",shotId:"shot-house",assetType:"photo",sourceUrl:
    "https://www.pexels.com/photo/a-house-in-sunlight-123456/",creator:"Example Artist",confirmRights:true};
  const opts={root,probe:async()=>({stdout:JSON.stringify({streams:[{codec_name:"mjpeg",width:1920,height:1080}]})})};
  const saved=await importDownloadedPexelsAsset(input,image,opts);
  assert.equal(saved.provider,"pexels");
  assert.equal(saved.acquisition,"user-downloaded-from-website");
  assert.equal(saved.creator,"Example Artist");
  assert.equal(saved.sha256.length,64);
  assert.equal((await listApprovedAssets({projectId:input.projectId},{root})).length,1);
  const pinned=await selectApprovedSceneAsset({projectId:input.projectId,shotId:input.shotId,
    provider:"pexels",assetId:"123456",sha256:saved.sha256},{root});
  assert.equal(pinned.localPath,saved.localPath);
  const again=await importDownloadedPexelsAsset(input,image,opts);
  assert.equal(again.localPath,saved.localPath);
  await writeFile(saved.localPath,Buffer.alloc(512,1));
  assert.equal((await listApprovedAssets({projectId:input.projectId},{root})).length,0);
  const repaired=await importDownloadedPexelsAsset(input,image,opts);
  assert.equal(repaired.localPath,saved.localPath);
  assert.equal((await listApprovedAssets({projectId:input.projectId},{root})).length,1);
  const names=await readdir(join(root,input.projectId,input.shotId));
  const quarantine=names.find(name=>name.startsWith(".damaged-"));
  assert.ok(quarantine,"damaged bytes are retained as a recoverable quarantine, never deleted");
  assert.deepEqual(await readFile(join(root,input.projectId,input.shotId,quarantine,"photo.jpg")),
    Buffer.alloc(512,1));
  await assert.rejects(importDownloadedPexelsAsset({...input,sourceUrl:"https://evil.example/photo/a-123456/"},image,opts),/Pexels source page/);
  await assert.rejects(importDownloadedPexelsAsset({...input,sourceUrl:"https://www.pexels.com/video/a-123456/"},image,opts),/must match/);
  await assert.rejects(importDownloadedPexelsAsset({...input,confirmRights:false},image,opts),/Review/);
  await assert.rejects(importDownloadedPexelsAsset(input,Buffer.alloc(512),opts),/JPEG/);
  await assert.rejects(importDownloadedPexelsAsset({...input,shotId:"../secret"},image,opts),/identifier/);
});

test("website imports reject a symlinked project directory before writing any files",async t=>{
  const root=await mkdtemp(join(tmpdir(),"pexels-site-symlink-"));
  const outside=await mkdtemp(join(tmpdir(),"pexels-site-outside-"));
  t.after(()=>Promise.all([rm(root,{recursive:true,force:true}),rm(outside,{recursive:true,force:true})]));
  await symlink(outside,join(root,"project-1"));
  const jpg=Buffer.alloc(512);jpg.set([0xff,0xd8,0xff]);
  await assert.rejects(importDownloadedPexelsAsset({projectId:"project-1",shotId:"shot-1",
    sourceUrl:"https://www.pexels.com/photo/roof-12345/",assetType:"photo",confirmRights:true},jpg,
  {root,probe:async()=>({stdout:JSON.stringify({streams:[{codec_name:"mjpeg",width:1280,height:720}]})})}),
  /real local directory/);
  assert.deepEqual(await readdir(outside),[],"no output may be written through a symlinked project folder");
});

test("real FFmpeg media probes accept a compatible website JPEG and H.264 MP4",async t=>{
  const root=await mkdtemp(join(tmpdir(),"pexels-ffprobe-upload-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const jpg=join(root,"sample.jpg"),mp4=join(root,"sample.mp4");
  await exec("ffmpeg",["-hide_banner","-loglevel","error","-f","lavfi","-i","color=c=blue:s=1280x720",
    "-frames:v","1","-threads","1","-y",jpg],{timeout:30000});
  await exec("ffmpeg",["-hide_banner","-loglevel","error","-f","lavfi","-i","color=c=blue:s=1280x720:r=15",
    "-t","1","-c:v","libx264","-threads","1","-pix_fmt","yuv420p","-y",mp4],{timeout:30000});
  const input={projectId:"project-1",shotId:"shot-house",confirmRights:true};
  const photo=await importDownloadedPexelsAsset({...input,assetType:"photo",
    sourceUrl:"https://www.pexels.com/photo/blue-sky-11111/"},await readFile(jpg),{root});
  const video=await importDownloadedPexelsAsset({...input,assetType:"video",
    sourceUrl:"https://www.pexels.com/video/blue-ocean-22222/"},await readFile(mp4),{root});
  assert.equal(photo.width,1280);
  assert.equal(video.width,1280);
  assert.equal(video.height,720);
  assert.ok(video.durationSeconds>0&&video.durationSeconds<=90);
  assert.equal((await listApprovedAssets({projectId:"project-1"},{root})).length,2);
});

test("one selected Pexels photo page downloads one verified image without an API key or crawling",async t=>{
  const root=await mkdtemp(join(tmpdir(),"pexels-page-photo-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const page="https://www.pexels.com/photo/landscape-99111/";
  const cdn="https://images.pexels.com/photos/99111/pexels-photo-99111.jpeg";
  const bytes=Buffer.alloc(512);bytes.set([0xff,0xd8,0xff]);
  const seen=[];
  const fetchImpl=async(url,options)=>{
    seen.push({url,options});
    if(url===page)return new Response(`<html><meta property="og:image" content="${cdn}"></html>`,
      {status:200,headers:{"content-type":"text/html"}});
    if(url===cdn)return new Response(bytes,{status:200,headers:{"content-type":"image/jpeg"}});
    throw Error("Untrusted request: "+url);
  };
  const input={projectId:"project-1",shotId:"shot-house",assetType:"photo",sourceUrl:page,confirmRights:true};
  const opts={root,fetchImpl,probe:async()=>({stdout:JSON.stringify({streams:[{codec_name:"mjpeg",width:1920,height:1080}]})})};
  const imported=await importPexelsPhotoPage(input,opts);
  assert.equal(imported.assetId,"99111");
  assert.equal(imported.acquisition,"website-page-download");
  assert.deepEqual(seen.map(entry=>entry.url),[page,cdn]);
  assert.ok(seen.every(entry=>entry.options.redirect==="error"&&!entry.options.headers.Authorization));
  await assert.rejects(importPexelsPhotoPage({...input,sourceUrl:"https://evil.example/photo/a-99111/"},opts),/direct Pexels/);
  assert.equal(seen.length,2);
  const deny=async()=>new Response("Forbidden",{status:403,headers:{"content-type":"text/html"}});
  await assert.rejects(importPexelsPhotoPage(input,{...opts,fetchImpl:deny}),/did not allow/);
  await assert.rejects(importPexelsPhotoPage(input,{...opts,fetchImpl:async()=>new Response(
    `<meta property="og:image" content="https://evil.example/photos/99111/a.jpeg">`,
    {headers:{"content-type":"text/html"}})}),/not available/);
});

const bundle = { plan: { shots: [
  { id: "shot-house", purpose: "Show the roof", visualChange: "Camera reveals roof damage", onScreenText: "Roof replacement", visualElements: [{ label: "Roof", detail: "Roof replacement costs" }] },
  { id: "shot-cost", purpose: "Compare mortgage interest", visualChange: "Show cost chart", onScreenText: "Interest paid", visualElements: [{ label: "Interest chart", detail: "Shows financial cost over time" }] },
] } };
const polyCatalog = {
  roof_tiles: { name: "Roof Tiles", description: "Roof tiles on a house", tags: ["roof", "house"], type: 1,
    thumbnail_url: "https://cdn.polyhaven.com/asset_img/thumbs/roof_tiles.png" },
  forest: { name: "Forest", description: "Forest trees", tags: ["forest"], type: 0,
    thumbnail_url: "https://cdn.polyhaven.com/asset_img/thumbs/forest.png" },
};
function response(body, code=200) { return new Response(JSON.stringify(body), { status: code, headers: { "content-type": "application/json" } }); }

test("accounting software is searched as a computer screen or an app icon", () => {
  const software = { plan: { shots: [
    { id: "shot-books", purpose: "Compare the old process", visualChange: "Show a comparison chart",
      visualElements: [{ label: "Interest chart", detail: "Shows financial cost over time" }] },
  ], sound: [{ shotId: "shot-books", narration: "The team still enters every invoice in accounting software by hand." }] } };
  const [need] = planSceneAssetNeeds(software);
  assert.equal(need.strategy, "search");
  assert.equal(need.query, "accounting software laptop screen");
  assert.deepEqual(need.pictureWords, ["accounting", "software"]);
  assert.match(need.reason, /computer|icon/i);
  const japanese = planSceneAssetNeeds({ plan: { shots: [{ id: "shot-jp", purpose: "Show the tool" }],
    sound: [{ shotId: "shot-jp", narration: "会計ソフトは請求書を受信箱から台帳へ移します。" }] } });
  assert.equal(japanese[0].query, "accounting software laptop screen");
});

test("asset needs prefer real tangible subjects; pure charts stay in Kumiki", () => {
  const needs = planSceneAssetNeeds(bundle);
  assert.equal(needs[0].shotId, "shot-house");
  assert.equal(needs[0].strategy, "search");
  assert.match(needs[0].query, /roof/i);
  assert.equal(needs[1].strategy, "kumiki");
});

test("discovery is opt-in and does not search Poly Haven", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return response({results:[]});
  };
  await assert.rejects(discoverShotAssets({bundle, providers:["openverse"]}, {fetchImpl}), /explicit/i);
  assert.equal(calls.length, 0);
  const result = await discoverShotAssets({bundle, providers:["polyhaven","openverse"], allowExternalSearch:true}, {fetchImpl});
  assert.equal(calls.some(url => url.includes("polyhaven")), false);
  assert.equal(calls.some(url => url.includes("openverse")), true);
  assert.match(result.warnings.join(" "), /Poly Haven search has been retired/);
  assert.equal(result.scenes[0].candidates.length, 0);
});

test("Openverse adds CC0-only scene photo leads without treating index metadata as verified rights",async()=>{
  const valid={id:"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",title:"Damaged roof on home",
    foreign_landing_url:"https://example.org/photos/damaged-roof",license:"cc0",filetype:"jpg",
    mature:false,watermarked:false,width:1920,height:1080,creator:"An artist",provider:"flickr",
    tags:[{name:"roof"},{name:"house"}]};
  const urls=[];
  const discovered=await discoverShotAssets({bundle,providers:["openverse"],allowExternalSearch:true},
    {fetchImpl:async(url,options)=>{
      urls.push(String(url));
      assert.equal(options.redirect,"error");
      assert.equal(new URL(url).hostname,"api.openverse.org");
      assert.equal(new URL(url).searchParams.get("license"),"cc0");
      return response({results:[valid,
        {...valid,id:"bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee",license:"by"},
        {...valid,id:"cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee",mature:true},
        {...valid,id:"dddddddd-bbbb-4ccc-8ddd-eeeeeeeeeeee",foreign_landing_url:"https://localhost/private"}]});
    }});
  assert.equal(urls.length,1);
  const lead=discovered.scenes[0].candidates[0];
  assert.equal(discovered.scenes[0].candidates.length,1);
  assert.equal(lead.provider,"openverse");
  assert.equal(lead.assetType,"photo");
  assert.equal(lead.rightsStatus,"needs-human-review");
  assert.equal(lead.licenseUrl,"https://creativecommons.org/publicdomain/zero/1.0/");
  assert.equal(lead.previewUrl,"https://api.openverse.org/v1/images/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/thumb/");
  assert.equal(lead.sourceUrl,valid.foreign_landing_url);
  assert.equal(discovered.scenes[1].candidates.length,0,"abstract chart scenes must not trigger provider suggestions");
  await assert.rejects(approveAsset({projectId:"project-1",shotId:"shot-house",provider:"openverse",
    assetId:valid.id,assetType:"photo",confirmDownload:true,confirmRights:true}),/unknown asset provider\/type/i,
    "a search-only lead must never enter the approved importer without a separate rights-verified implementation");
});

test("Openverse rate limits leave Kumiki fallback available without fabricating licensed matches",async()=>{
  const discovered=await discoverShotAssets({bundle,providers:["openverse"],allowExternalSearch:true},
    {fetchImpl:async()=>response({detail:"Rate limited"},429)});
  assert.equal(discovered.scenes[0].candidates.length,0);
  assert.equal(discovered.scenes[0].strategy,"search");
  assert.match(discovered.warnings.join(" "),/Openverse.*HTTP 429/iu);
});

test("job cancellation propagates into provider requests without removing per-request deadlines",async()=>{
  const cancel=new AbortController();let requestSignal;
  await discoverShotAssets({bundle,providers:["openverse"],allowExternalSearch:true},
    {signal:cancel.signal,fetchImpl:async(_url,options)=>{
      requestSignal=options.signal;return response(polyCatalog);
    }});
  assert.ok(requestSignal instanceof AbortSignal);
  assert.notEqual(requestSignal,cancel.signal,"provider request includes its own timeout as well as job cancellation");
  assert.equal(requestSignal.aborted,false);
  cancel.abort(Error("The editor cancelled the render"));
  assert.equal(requestSignal.aborted,true);
});

test("approved download re-resolves provider IDs, hashes bytes and writes private per-scene provenance", async t => {
  const root = await mkdtemp(join(tmpdir(), "contentgen-assets-test-"));
  t.after(() => rm(root, {recursive:true,force:true}));
  let calls=0;
  const fetchImpl = async url => {
    calls++;
    if (String(url)==="https://api.polyhaven.com/assets") return response(polyCatalog);
    if (String(url).startsWith("https://api.polyhaven.com/files/")) return response({
      diffuse: { "1k": { jpg: {url:"https://dl.polyhaven.org/asset.jpg", size:7} } },
    });
    if (String(url)==="https://dl.polyhaven.org/asset.jpg") return new Response(Buffer.from("image!!"));
    throw Error("Unexpected URL " + url);
  };
  const input={projectId:"project-1",shotId:"shot-house",provider:"polyhaven",assetId:"roof_tiles",
    assetType:"texture",confirmDownload:true,confirmRights:true};
  await assert.rejects(approveAsset({...input,confirmDownload:false},{root,fetchImpl}), /approval/i);
  assert.equal(calls,0);
  const saved=await approveAsset(input,{root,fetchImpl});
  assert.equal(saved.provider,"polyhaven");
  assert.equal(saved.shotId,"shot-house");
  assert.equal(saved.license,"CC0-1.0");
  assert.equal(saved.sizeBytes,7);
  assert.match(saved.sha256,/^[a-f0-9]{64}$/);
  assert.equal((await readFile(saved.localPath)).toString(),"image!!");
  assert.equal((await listApprovedAssets({projectId:"project-1"},{root})).length,1);
  const again=await approveAsset(input,{root,fetchImpl});
  assert.equal(again.sha256,saved.sha256);
  assert.equal((await readdir(join(root,"project-1","shot-house"))).length,1,"one content-addressed asset directory");
  await writeFile(saved.localPath,"tampered media");
  assert.equal((await listApprovedAssets({projectId:"project-1"},{root})).length,0,
    "modified media can no longer count as an approved local asset");
});

test("approved downloads retry a temporary provider outage without duplicating imported media",async t=>{
  const root=await mkdtemp(join(tmpdir(),"contentgen-download-retry-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  let fileRequests=0;
  const fetchImpl=async url=>{
    if(url==="https://api.polyhaven.com/assets")return response(polyCatalog);
    if(String(url).startsWith("https://api.polyhaven.com/files/"))return response({
      diffuse:{"1k":{jpg:{url:"https://dl.polyhaven.org/retry.jpg",size:7}}}});
    if(url==="https://dl.polyhaven.org/retry.jpg"){
      fileRequests++;
      return fileRequests===1?new Response("unavailable",{status:503}):new Response("image!!");
    }
    throw Error("Unexpected URL "+url);
  };
  const saved=await approveAsset({projectId:"project-1",shotId:"shot-house",provider:"polyhaven",
    assetId:"roof_tiles",assetType:"texture",confirmDownload:true,confirmRights:true},{root,fetchImpl});
  assert.equal(fileRequests,2);
  assert.equal((await readFile(saved.localPath,"utf8")),"image!!");
  assert.equal((await listApprovedAssets({projectId:"project-1"},{root})).length,1);
});

test("downloads stop on rate limits and cancellation without partial approved assets",async t=>{
  const root=await mkdtemp(join(tmpdir(),"contentgen-download-stop-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const input={projectId:"project-1",shotId:"shot-house",provider:"polyhaven",
    assetId:"roof_tiles",assetType:"texture",confirmDownload:true,confirmRights:true};
  const controller=new AbortController();let requests=0;
  const fetchImpl=async url=>{
    if(url==="https://api.polyhaven.com/assets")return response(polyCatalog);
    if(String(url).startsWith("https://api.polyhaven.com/files/"))return response({
      diffuse:{"1k":{jpg:{url:"https://dl.polyhaven.org/limit.jpg",size:7}}}});
    requests++;return new Response("rate limited",{status:429});
  };
  await assert.rejects(approveAsset(input,{root,fetchImpl}),/rate.limit/i);
  assert.equal(requests,1);
  await assert.rejects(approveAsset(input,{root,signal:controller.signal,fetchImpl:async url=>{
    if(url==="https://api.polyhaven.com/assets")return response(polyCatalog);
    if(String(url).startsWith("https://api.polyhaven.com/files/"))return response({
      diffuse:{"1k":{jpg:{url:"https://dl.polyhaven.org/limit.jpg",size:7}}}});
    requests++;controller.abort(Error("Editor cancelled download"));
    return new Response("unavailable",{status:503});
  }}),/Editor cancelled download/);
  assert.equal(requests,2,"a cancelled transfer must not retry");
  assert.deepEqual(await listApprovedAssets({projectId:"project-1"},{root}),[]);
  let exhausted=0;
  await assert.rejects(approveAsset(input,{root,fetchImpl:async url=>{
    if(url==="https://api.polyhaven.com/assets")return response(polyCatalog);
    if(String(url).startsWith("https://api.polyhaven.com/files/"))return response({
      diffuse:{"1k":{jpg:{url:"https://dl.polyhaven.org/limit.jpg",size:7}}}});
    exhausted++;return new Response("unavailable",{status:503});
  }}),/three attempts/i);
  assert.equal(exhausted,3,"retries must be bounded and observable to the importer");
  assert.deepEqual(await listApprovedAssets({projectId:"project-1"},{root}),[]);
});

test("small glTF models keep their nested texture dependencies without accepting path traversal",async t=>{
  const root=await mkdtemp(join(tmpdir(),"contentgen-model-test-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const input={projectId:"prj-1",shotId:"scene-1",provider:"polyhaven",assetId:"wooden_chair",
    assetType:"model",confirmDownload:true,confirmRights:true};
  const fetchImpl=async url=>{
    if(url==="https://api.polyhaven.com/assets")return response({
      wooden_chair:{name:"Chair",type:2,tags:["chair"]}});
    if(url==="https://api.polyhaven.com/files/wooden_chair")return response({
      gltf:{"1k":{gltf:{url:"https://dl.polyhaven.org/model.gltf",size:3,
        include:{"textures/wood.jpg":{url:"https://dl.polyhaven.org/wood.jpg",size:4}}}}}});
    if(url==="https://dl.polyhaven.org/model.gltf")return new Response("3-D");
    if(url==="https://dl.polyhaven.org/wood.jpg")return new Response("wood");
    throw Error("Unexpected URL "+url);
  };
  const saved=await approveAsset(input,{root,fetchImpl});
  assert.equal(saved.files.length,2);
  assert.equal((await readFile(join(saved.localPath,"..","textures","wood.jpg"),"utf8")),"wood");
  assert.equal((await listApprovedAssets({projectId:"prj-1"},{root})).length,1);
  await writeFile(join(saved.localPath,"..","textures","wood.jpg"),"altered");
  assert.equal((await listApprovedAssets({projectId:"prj-1"},{root})).length,0,
    "tampered dependent textures invalidate an approved model");
});

test("download rejects untrusted URLs, redirects, oversized files and path traversal", async t => {
  const root = await mkdtemp(join(tmpdir(), "contentgen-assets-reject-"));
  t.after(() => rm(root,{recursive:true,force:true}));
  const base={projectId:"project-1",shotId:"shot-house",provider:"polyhaven",assetId:"roof_tiles",
    assetType:"texture",confirmDownload:true,confirmRights:true};
  await assert.rejects(approveAsset({...base,projectId:"../../escape"},{root}),/identifier/i);
  const bad = async url => String(url)==="https://api.polyhaven.com/assets"?response(polyCatalog):
    String(url).startsWith("https://api.")?response({diffuse:{"1k":{jpg:{url:"http://127.0.0.1/secrets.jpg",size:4}}}}):
    new Response("oops");
  await assert.rejects(approveAsset(base,{root,fetchImpl:bad}),/trusted|host/i);
  const huge = async url => String(url)==="https://api.polyhaven.com/assets"?response(polyCatalog):
    String(url).startsWith("https://api.")?response({diffuse:{"1k":{jpg:{url:"https://dl.polyhaven.org/huge.jpg",size:1000000000}}}}):
    new Response("x");
  await assert.rejects(approveAsset(base,{root,fetchImpl:huge}),/limit|large/i);
  const crossProvider=async url=>String(url)==="https://api.polyhaven.com/assets"?response(polyCatalog):
    String(url).startsWith("https://api.")?response({diffuse:{"1k":{jpg:{
      url:"https://player.vimeo.com/external/fake.jpg",size:4}}}}):new Response("oops");
  await assert.rejects(approveAsset(base,{root,fetchImpl:crossProvider}),/host|trusted/i,
    "Poly Haven cannot route a file fetch through a stock footage host");
  assert.deepEqual(await listApprovedAssets({projectId:"project-1"},{root}),[]);
});

test("a legacy Pexels search choice never contacts its retired API or exposes its key", async () => {
  const key="test-pexels-secret";
  const fetchImpl=async()=>{throw Error("The retired Pexels API must never be called.");};
  const result=await discoverShotAssets({bundle,providers:["pexels"],allowExternalSearch:true},
    {fetchImpl,pexelsKey:key});
  assert.equal(result.scenes[0].candidates.length,0);
  assert.match(result.warnings.join(" "),/Pexels API search has been retired/i);
  assert.doesNotMatch(JSON.stringify(result),/test-pexels-secret/);
});

test("retired Pexels footage API requests cannot be revived by old local credentials",async()=>{
  let calls=0;
  const fetchImpl=async()=>{calls++;throw Error("Do not contact a retired provider.");};
  const results=await discoverShotAssets({bundle,providers:["pexels"],allowExternalSearch:true},
    {fetchImpl,pexelsKey:"private-key"});
  assert.equal(results.scenes[0].candidates.length,0);
  assert.doesNotMatch(JSON.stringify(results),/private-key|sig=token/);
  assert.equal(calls,0);
});

test("default scene discovery uses the no-key providers and never Pexels",async()=>{
  const visited=[];
  const results=await discoverShotAssets({bundle,allowExternalSearch:true},
    {fetchImpl:async url=>{visited.push(new URL(String(url)).hostname);
      return response({results:[]});},
    pexelsKey:"retired-private-key"});
  assert.equal(visited.includes("api.polyhaven.com"), false);
  assert.ok(visited.includes("api.openverse.org"));
  assert.ok(!visited.includes("api.pexels.com"));
  assert.doesNotMatch(JSON.stringify(results),/retired-private-key/);
});

test("approved Pexels video resolves its own provider ID and stores an MP4 with provenance",async t=>{
  const root=await mkdtemp(join(tmpdir(),"contentgen-footage-test-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const bytes=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from("ftypisom"),Buffer.alloc(28)]);
  const calls=[];
  const fetchImpl=async url=>{
    calls.push(String(url));
    if(String(url)==="https://api.pexels.com/v1/videos/videos/83")return response({
      id:83,url:"https://www.pexels.com/video/roof-83/",image:"https://images.pexels.com/videos/83/roof.jpg",
      duration:12,user:{name:"Film Artist"},video_files:[
        {id:2,quality:"hd",file_type:"video/mp4",width:1920,height:1080,
          link:"https://player.vimeo.com/external/83.fullhd.mp4?token=abc"},
        {id:1,quality:"hd",file_type:"video/mp4",width:1280,height:720,
          link:"https://videos.pexels.com/video-files/83/720.mp4"}]});
    if(String(url)==="https://videos.pexels.com/video-files/83/720.mp4")return new Response(bytes,
      {headers:{"Content-Type":"video/mp4"}});
    throw Error("Unexpected external request "+url);
  };
  const input={projectId:"project-1",shotId:"shot-house",provider:"pexels",assetId:"83",
    assetType:"video",confirmDownload:true,confirmRights:true,url:"https://evil.test/private"};
  const saved=await approveAsset(input,{root,fetchImpl,pexelsKey:"private-key"});
  assert.equal(saved.assetType,"video");
  assert.equal(saved.durationSeconds,12);
  assert.deepEqual({width:saved.width,height:saved.height},{width:1280,height:720});
  assert.equal(saved.files[0].name,"video.mp4");
  assert.deepEqual(await readFile(saved.localPath),bytes);
  assert.equal((await listApprovedAssets({projectId:"project-1"},{root}))[0].sha256,saved.sha256);
  assert.deepEqual(calls,["https://api.pexels.com/v1/videos/videos/83",
    "https://videos.pexels.com/video-files/83/720.mp4"]);
  assert.doesNotMatch(JSON.stringify(saved),/private-key|evil\.test|token=abc/);
  const ref={projectId:"project-1",shotId:"shot-house",provider:"pexels",assetId:"83",sha256:saved.sha256};
  await assert.rejects(selectApprovedSceneAsset({...ref,focalPoint:{x:1.1,y:.4}},{root}),/framing/i);
  await assert.rejects(selectApprovedSceneAsset({...ref,focalPoint:{x:.5,y:.4,inject:true}},{root}),/framing/i);
  const selected=await selectApprovedSceneAsset({...ref,focalPoint:{x:.15,y:.82}},{root});
  assert.deepEqual(selected.focalPoint,{x:.15,y:.82});
  assert.deepEqual((await listSelectedSceneAssets({projectId:"project-1"},{root})).selections[0].focalPoint,
    {x:.15,y:.82});
});

test("Pexels video import refuses forged hosts and non-MP4 download payloads",async t=>{
  const root=await mkdtemp(join(tmpdir(),"contentgen-footage-reject-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const input={projectId:"project-1",shotId:"shot-house",provider:"pexels",assetId:"83",
    assetType:"video",confirmDownload:true,confirmRights:true};
  let downloadCalls=0;
  const makeFetch=link=>async url=>{
    if(String(url).includes("/videos/videos/"))return response({id:83,
      url:"https://www.pexels.com/video/roof-83/",image:"https://images.pexels.com/videos/83/roof.jpg",
      duration:12,user:{name:"Film Artist"},video_files:[{quality:"hd",file_type:"video/mp4",
        width:1280,height:720,link}]});
    downloadCalls++;return new Response("<html>not a video</html>");
  };
  await assert.rejects(approveAsset(input,{root,pexelsKey:"private-key",
    fetchImpl:makeFetch("https://127.0.0.1/secrets.mp4")}),/compatible|trusted|host/i);
  assert.equal(downloadCalls,0);
  await assert.rejects(approveAsset(input,{root,pexelsKey:"private-key",
    fetchImpl:makeFetch("https://videos.pexels.com/video-files/83/720.mp4")}),/MP4|video/i);
  assert.deepEqual(await listApprovedAssets({projectId:"project-1"},{root}),[]);
});

test("Pexels image import refuses HTML or spoofed JPEG responses before recording approval", async t => {
  const root = await mkdtemp(join(tmpdir(), "contentgen-photo-reject-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = { projectId: "project-1", shotId: "shot-house", provider: "pexels", assetId: "49",
    assetType: "photo", confirmDownload: true, confirmRights: true };
  for (const [contentType, bytes] of [["text/html", "<html>not a JPEG</html>"],
    ["image/jpeg", "<html>pretend-image</html>"]]) {
    const fetchImpl = async url => String(url).includes("api.pexels.com") ? response({
      id: 49, url: "https://www.pexels.com/photo/roof-49/", alt: "Roof", photographer: "Photographer",
      src: { large: "https://images.pexels.com/photos/49/roof.jpeg" },
    }) : new Response(bytes, { headers: { "content-type": contentType } });
    await assert.rejects(approveAsset(input, { root, pexelsKey: "test", fetchImpl }), /JPEG|image|type/i);
  }
  assert.deepEqual(await listApprovedAssets({ projectId: "project-1" }, { root }), []);
});

test("scene selection pins only an approved SHA, can be revised and detects a damaged source",async t=>{
  const root=await mkdtemp(join(tmpdir(),"contentgen-selection-test-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const fetchImpl=async url=>{
    if(url==="https://api.polyhaven.com/assets")return response(polyCatalog);
    if(String(url).startsWith("https://api.polyhaven.com/files/"))return response({
      diffuse:{"1k":{jpg:{url:"https://dl.polyhaven.org/asset.jpg",size:7}}}});
    if(url==="https://dl.polyhaven.org/asset.jpg")return new Response(Buffer.from("image!!"));
    throw Error("Unexpected URL "+url);
  };
  const item=await approveAsset({projectId:"project-1",shotId:"shot-house",provider:"polyhaven",
    assetId:"roof_tiles",assetType:"texture",confirmDownload:true,confirmRights:true},{root,fetchImpl});
  const ref={projectId:"project-1",shotId:"shot-house",provider:"polyhaven",assetId:"roof_tiles",
    sha256:item.sha256};
  await assert.rejects(selectApprovedSceneAsset({...ref,sha256:"a".repeat(64)},{root}),/approved/i);
  await assert.rejects(selectApprovedSceneAsset({...ref,shotId:"shot-cost"},{root}),/approved/i);
  await assert.rejects(selectApprovedSceneAsset({...ref,shotId:"../bad"},{root}),/identifier/i);
  await assert.rejects(selectApprovedSceneAsset({...ref,focalPoint:{x:.2,y:.8}},{root}),/framing/i,
    "non-renderable textures must not accept video framing controls");
  const saved=await selectApprovedSceneAsset(ref,{root});
  assert.equal(saved.shotId,"shot-house");
  const first=await listSelectedSceneAssets({projectId:"project-1"},{root});
  assert.equal(first.selections[0].sha256,item.sha256);
  assert.equal(first.selections[0].localPath,item.localPath);
  assert.deepEqual(first.invalidShots,[]);
  await writeFile(item.localPath,"damaged");
  const invalid=await listSelectedSceneAssets({projectId:"project-1"},{root});
  assert.deepEqual(invalid.selections,[]);
  assert.deepEqual(invalid.invalidShots,["shot-house"]);
  await clearSelectedSceneAsset({projectId:"project-1",shotId:"shot-house"},{root});
  assert.deepEqual(await listSelectedSceneAssets({projectId:"project-1"},{root}),
    {schemaVersion:1,kind:"contentgen-scene-media-selections",selections:[],invalidShots:[]});
});

test("portrait discovery preserves measured scene timing with no-key Openverse suggestions",async()=>{
  const calls=[];
  const bundleWithSound={plan:{...bundle.plan,sound:[{shotId:"shot-house",narration:
    "A storm sends roof tiles sliding off the house while the owner watches.",pauseAfterMs:500}]}};
  const fetchImpl=async url=>{
    calls.push(String(url));
    assert.equal(new URL(String(url)).hostname,"api.openverse.org");
    return response({results:[{id:"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      title:"Storm damage roof tiles sliding from house",license:"cc0",filetype:"jpg",
      foreign_landing_url:"https://commons.wikimedia.org/wiki/File:Storm_roof.jpg",
      mature:false,watermarked:false,width:720,height:1280,
      creator:"Photo Artist",provider:"wikimedia",tags:[{name:"storm"},{name:"roof tiles"}]}]});
  };
  const result=await discoverShotAssets({bundle:bundleWithSound,providers:["openverse"],
    destination:"portrait",sceneDurationsSeconds:{"shot-house":18},allowExternalSearch:true},
    {fetchImpl});
  assert.ok(calls.every(url=>url.includes("license=cc0")));
  const scene=result.scenes[0];
  assert.deepEqual(scene.shotDuration,{seconds:18,source:"measured"});
  assert.equal(scene.candidates[0].provider,"openverse");
  assert.equal(scene.candidates[0].assetType,"photo");
  assert.equal(scene.candidates[0].width,720);
  assert.equal(scene.candidates[0].height,1280);
  assert.equal(scene.candidates[0].rightsStatus,"needs-human-review");
  assert.ok(scene.candidates[0].match.reasons.length>0);
});

test("invalid destination and timing override reject before any provider requests",async()=>{
  let calls=0;
  const fetchImpl=async()=>{calls++;return response({photos:[],videos:[]});};
  await assert.rejects(discoverShotAssets({bundle,providers:["pexels"],allowExternalSearch:true,
    destination:"4K-or-ignore",sceneDurationsSeconds:{}},{fetchImpl,pexelsKey:"key"}),/destination/i);
  await assert.rejects(discoverShotAssets({bundle,providers:["pexels"],allowExternalSearch:true,
    destination:"landscape",sceneDurationsSeconds:{"shot-house":-8}},{fetchImpl,pexelsKey:"key"}),/duration/i);
  assert.equal(calls,0);
});
