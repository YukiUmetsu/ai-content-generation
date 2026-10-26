import test from "node:test";
import assert from "node:assert/strict";
import {rankShotCandidates} from "./asset-matching.mjs";

const shot={id:"shot-roof",purpose:"explain",visualChange:"Wind damages roof tiles",
  visualElements:[{label:"Roof tiles"}]};
const narration={narration:"Wind lifts roof tiles. Replacing the damaged roof can be expensive.",pauseAfterMs:400};
const media=(assetId,title,width,height,durationSeconds=20)=>({provider:"pexels",assetId:String(assetId),
  assetType:"video",title,width,height,durationSeconds,sourceUrl:`https://www.pexels.com/video/${title.toLowerCase().replaceAll(" ","-")}-${assetId}/`,
  license:"Pexels License"});

test("visible subject relevance outranks an unrelated but easy-to-crop clip",()=>{
  const ranked=rankShotCandidates({shot,narration,candidates:[
    media(1,"Paint roller",1280,720),media(2,"Roof tiles after storm",1280,720),
    media(3,"Roof tiles in wind",720,1280)],destination:"landscape"});
  assert.deepEqual(ranked.candidates.map(x=>x.assetId),["2","3","1"]);
  assert.equal(ranked.recommendedAssetKey,"pexels:video:2");
  assert.equal(ranked.candidates[0].match.grade,"strong");
  assert.ok(ranked.candidates[0].match.breakdown.semantic>ranked.candidates[2].match.breakdown.semantic);
  assert.ok(ranked.candidates[0].match.reasons.some(x=>/subject/i.test(x)));
});

test("portrait and landscape favor different copies of the same footage",()=>{
  const candidates=[media(1,"Roof tiles",1280,720),media(2,"Roof tiles",720,1280)];
  assert.equal(rankShotCandidates({shot,narration,candidates,destination:"landscape"}).candidates[0].assetId,"1");
  assert.equal(rankShotCandidates({shot,narration,candidates,destination:"portrait"}).candidates[0].assetId,"2");
});

test("measured scene duration penalizes a clip too short to cover the narration",()=>{
  const ranked=rankShotCandidates({shot,narration,candidates:[
    media(1,"Roof tiles",1280,720,4),media(2,"Roof tiles",1280,720,21)],
    durationSeconds:18});
  assert.equal(ranked.shotDuration.source,"measured");
  assert.equal(ranked.shotDuration.seconds,18);
  assert.equal(ranked.candidates[0].assetId,"2");
  assert.ok(ranked.candidates[1].match.reasons.some(x=>/shorter|short/i.test(x)));
});

test("unknown generic footage does not receive false confidence or auto selection",()=>{
  const ranked=rankShotCandidates({shot,narration,candidates:[
    media(88,"Pexels footage 88",1280,720)],destination:"landscape"});
  assert.equal(ranked.recommendedAssetKey,null);
  assert.notEqual(ranked.candidates[0].match.grade,"strong");
  assert.ok(ranked.candidates[0].match.reasons.some(x=>/unknown|no clear|review/i.test(x)));
});

test("missing sizes or video durations are reviewable, stable, and never manufacture fit claims",()=>{
  const candidates=[{provider:"polyhaven",assetType:"model",assetId:"roof_tiles",title:"Roof tiles",sourceUrl:"https://polyhaven.com/a/roof_tiles"},
    {provider:"pexels",assetType:"video",assetId:"1",title:"Roof tiles",durationSeconds:-4,width:0,height:0}];
  const ranked=rankShotCandidates({shot,narration,candidates,destination:"portrait"});
  assert.equal(ranked.candidates.length,2);
  assert.ok(ranked.candidates.every(x=>Number.isFinite(x.match.score)));
  assert.ok(ranked.candidates.find(x=>x.assetType==="video").match.reasons.some(x=>/unknown|missing/i.test(x)));
});

test("trusted provider subject tags can rescue a generic 3D model title",()=>{
  const ranked=rankShotCandidates({shot,narration,candidates:[
    {provider:"polyhaven",assetType:"model",assetId:"shingles",title:"Construction kit",keywords:["roof","tiles"],
      sourceUrl:"https://polyhaven.com/a/shingles"},
    {provider:"polyhaven",assetType:"model",assetId:"unrelated",title:"Wooden chair",keywords:["chair"],
      sourceUrl:"https://polyhaven.com/a/unrelated"}]});
  assert.equal(ranked.candidates[0].assetId,"shingles");
  assert.equal(ranked.recommendedAssetKey,"polyhaven:model:shingles");
  assert.equal(ranked.candidates[0].match.grade,"strong");
});
