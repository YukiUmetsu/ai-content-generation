import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approveAsset, discoverShotAssets, listApprovedAssets, planSceneAssetNeeds } from "./asset-discovery.mjs";

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

test("asset needs prefer real tangible subjects; pure charts stay in Kumiki", () => {
  const needs = planSceneAssetNeeds(bundle);
  assert.equal(needs[0].shotId, "shot-house");
  assert.equal(needs[0].strategy, "search");
  assert.match(needs[0].query, /roof/i);
  assert.equal(needs[1].strategy, "kumiki");
});

test("discovery is opt-in, metadata-only, and does not download any assets", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({url:String(url),options});
    assert.equal(new URL(url).hostname, "api.polyhaven.com");
    assert.match(options.headers["User-Agent"], /ContentGen/);
    return response(polyCatalog);
  };
  await assert.rejects(discoverShotAssets({bundle, providers:["polyhaven"]}, {fetchImpl}), /explicit/i);
  assert.equal(calls.length, 0);
  const result = await discoverShotAssets({bundle, providers:["polyhaven"], allowExternalSearch:true}, {fetchImpl});
  assert.equal(calls.length, 1);
  assert.equal(result.scenes.length, 2);
  assert.equal(result.scenes[0].candidates[0].assetId, "roof_tiles");
  assert.equal(result.scenes[0].candidates[0].license, "CC0-1.0");
  assert.equal(result.scenes[1].candidates.length, 0);
  assert.equal(result.scenes[1].strategy, "kumiki");
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
  assert.deepEqual(await listApprovedAssets({projectId:"project-1"},{root}),[]);
});

test("Pexels search is optional and never exposes the credential in the normalized response", async () => {
  const key="test-pexels-secret";
  const fetchImpl=async (url, opts) => {
    assert.equal(new URL(url).hostname,"api.pexels.com");
    assert.equal(opts.headers.Authorization,key);
    return response({photos:[{id:49,url:"https://www.pexels.com/photo/roof-49/",alt:"A roof",
      photographer:"Photo Maker",src:{medium:"https://images.pexels.com/photos/49/roof.jpeg"}}]});
  };
  const result=await discoverShotAssets({bundle,providers:["pexels"],allowExternalSearch:true},
    {fetchImpl,pexelsKey:key});
  assert.equal(result.scenes[0].candidates[0].provider,"pexels");
  assert.doesNotMatch(JSON.stringify(result),/test-pexels-secret/);
});
