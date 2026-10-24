import test from "node:test";
import assert from "node:assert/strict";
import {planSoundAudition} from "./sound-audition-plan.mjs";

const A="a".repeat(64),B="b".repeat(64),C="c".repeat(64);
const approved=[
  {assetId:"a",sha256:A,title:"Soft tick",durationSeconds:0.5,license:"cc0",rightsStatus:"user-reviewed"},
  {assetId:"b",sha256:B,title:"Whoosh",durationSeconds:2,license:"cc0",rightsStatus:"user-reviewed"},
  {assetId:"c",sha256:C,title:"Soft rain",durationSeconds:4,license:"cc0",rightsStatus:"user-reviewed"},
];
const shot="shot-1",choice={shotId:shot,mode:"pin",assetId:"a",sha256:A,trigger:"shot-start"};
const layer={layerId:"layer-1",shotId:shot,assetId:"b",sha256:B,trigger:"shot-start",
  offsetMs:300,gainDb:-24,fadeInMs:60,fadeOutMs:200};
const ambient={assetId:"c",sha256:C,gainDb:-36,fadeInMs:500,fadeOutMs:800};

test("audition plans an approved primary cue, independent offset layer and looping ambience",()=>{
  const mix=planSoundAudition({shotId:shot,choice,layers:[layer],ambience:ambient,library:approved});
  assert.equal(mix.durationMs,12000);
  assert.deepEqual(mix.cues.map(cue=>[cue.kind,cue.startMs,cue.loop]),[
    ["primary",0,false],["layer",300,false],["ambience",0,true]
  ]);
  assert.equal(mix.cues[0].gain,0.12,"legacy primary gain matches export mixer");
  assert.equal(mix.cues[1].gain,10**(-24/20));
  assert.equal(mix.cues[1].fadeOutMs,200);
  assert.equal(mix.cues[2].durationMs,12000);
  assert.equal(mix.cues[1].url,`/api/contentgen-sfx/preview/${B}`);
  assert.equal(JSON.stringify(mix).includes("localPath"),false);
});

test("audition omits unmeasured visual reveal cues with an honest explanation",()=>{
  const mix=planSoundAudition({shotId:shot,choice:{...choice,trigger:"first-visual-reveal"},
    layers:[{...layer,trigger:"first-visual-reveal"}],ambience:null,library:approved});
  assert.deepEqual(mix.cues,[]);
  assert.match(mix.warnings.join(" "),/visual reveal/i);
});

test("audition permits a muted primary while retaining extra layers and ambience",()=>{
  const mix=planSoundAudition({shotId:shot,choice:{...choice,mode:"mute"},
    layers:[layer,{...layer,shotId:"different",layerId:"layer-other"}],ambience:ambient,library:approved});
  assert.deepEqual(mix.cues.map(c=>c.kind),["layer","ambience"]);
});

test("audition never fetches unapproved, changed-hash or malformed library entries",()=>{
  const library=[{...approved[0],rightsStatus:"needs-human-review"},
    {...approved[1],sha256:"0".repeat(64)},
    {...approved[2],license:"by-nc"}];
  const mix=planSoundAudition({shotId:shot,choice,layers:[layer],ambience:ambient,library});
  assert.deepEqual(mix.cues,[]);
  assert.match(mix.warnings.join(" "),/approved sound/i);
});

test("audition rejects invalid time windows and safely omits clips outside the preview",()=>{
  assert.throws(()=>planSoundAudition({shotId:shot,library:approved,windowMs:Infinity}),/window/i);
  const mix=planSoundAudition({shotId:shot,library:approved,choice:null,
    layers:[{...layer,offsetMs:10000}],ambience:null,windowMs:6000});
  assert.deepEqual(mix.cues,[]);
  assert.match(mix.warnings.join(" "),/outside the audition/i);
});
