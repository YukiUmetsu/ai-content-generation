import test from "node:test";
import assert from "node:assert/strict";
import { withAutomaticApprovedMedia } from "./automatic-approved-assets.mjs";

const map=[{shotId:"roof",beatId:"beat-roof"},{shotId:"tax",beatId:"beat-tax"}];
const bundle={plan:{shots:[
  {id:"roof",visualElements:[{label:"roof",detail:"roof repair"}],visualChange:"Roof replacement"},
  {id:"tax",visualElements:[{label:"tax",detail:"tax chart"}],visualChange:"Tax graph"}],
  sound:[{shotId:"roof",narration:"Inspect the roof repair"},{shotId:"tax",narration:"Chart taxes"}]}};
const media=(shotId,assetId,title,sha256)=>({shotId,assetId,title,sha256,provider:"pexels",
  assetType:"photo",rightsStatus:"user-reviewed",width:1920,height:1080,
  sourceUrl:`https://www.pexels.com/photo/${assetId}/`,license:"Pexels License",
  licenseUrl:"https://www.pexels.com/license/"});

test("automatic preparation uses approved relevant originals without overriding manual pins",()=>{
  const pinned=media("tax","manually-selected","Tax chart","a".repeat(64));
  const selected={selections:[pinned],invalidShots:[]};
  const auto=withAutomaticApprovedMedia(selected,[
    media("roof","r1","roof repair","b".repeat(64)),
    media("tax","t2","tax changes","c".repeat(64))],map,bundle);
  assert.deepEqual(auto.selections.map(x=>x.assetId),["manually-selected","r1"]);
  assert.equal(auto.selections[1].automaticallySelected,true);
  assert.deepEqual(selected.selections,[pinned],"a default suggestion must not mutate the saved manual pin");
});

test("a rejected, weak, duplicated or corrupted asset never becomes an automatic binding",()=>{
  const selected={selections:[],invalidShots:["tax"]};
  const result=withAutomaticApprovedMedia(selected,[
    media("roof","generic","happy smiling people","d".repeat(64)),
    {...media("roof","unreviewed","roof repair","e".repeat(64)),rightsStatus:"needs-human-review"},
    media("tax","relevant","tax chart","f".repeat(64))],map,bundle);
  assert.deepEqual(result.selections,[]);
});
