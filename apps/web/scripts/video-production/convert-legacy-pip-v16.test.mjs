import assert from "node:assert/strict";
import test from "node:test";
import { convertPipMetadata } from "./convert-legacy-pip-v16.mjs";

function fixture(){
  const origin=[160,100];
  const regions=Object.fromEntries(["tail","leg_left","leg_right","torso","head","scarf","satchel"]
    .map(key=>[key,{width:350,height:300,origin}]));
  const landmarks=Object.fromEntries(["tail_base","hip_left","hip_right","shoulder_left",
    "shoulder_right","torso_center","neck","satchel_mount"].map(key=>[key,{x:750,y:550}]));
  const rig={schemaVersion:"1.6-rebuild",id:"pipkin_sprig",renderer:"registered-sprite-2d",
    stage:{width:1440,height:900},regions,landmarks};
  const arms=Object.fromEntries(["relaxed_left","relaxed_right","ask_right","point_left","point_right",
    "wave_right","ask_left","wave_left","open_left","open_right"].map(name=>[name,{
      file:`arm_${name}.png`,width:200,height:170,origin:[80,50]}]));
  const assetNames=[...Object.keys(regions),...Array.from({length:7},(_,i)=>`mouth${i}`),
    ...Array.from({length:6},(_,i)=>Array.from({length:3},(_,j)=>`mouth_between_${i}_${i+1}_${j+1}`)).flat(),
    ...Object.keys(arms).map(name=>`arm_${name}`)];
  const assets=Object.fromEntries(assetNames.map(name=>[name,{width:620,height:620,sha256:"a".repeat(64)}]));
  return {rig,arms,assets};
}

test("legacy Pip conversion binds the measured neck, shoulders and paws to Kumiki scene coordinates",()=>{
  const {rig,arms,assets}=fixture();
  const definition=convertPipMetadata(rig,arms,assets);
  assert.equal(definition.characterId,"pip");
  assert.equal(definition.revision,"pip-animated-rig-v1.6-imported");
  assert.equal(definition.parts.length,11);
  assert.equal(definition.parts.find(part=>part.id==="head").rest.x,750-160-340);
  assert.equal(definition.parts.find(part=>part.id==="arm_right").pivot.x,310);
  assert.equal(definition.parts.find(part=>part.id==="arm_right").rest.x,750-310-340);
  assert.equal(definition.parts.find(part=>part.id==="mouth").parent,"head");
  assert.equal(definition.speech.mouthPart,"mouth");
  assert.equal(definition.speech.rest,"stage0");
  assert.ok(definition.speech.approximateCycle.length>=5);
  assert.equal(Object.keys(definition.parts.find(part=>part.id==="mouth").variants).length,25);
  for(const action of ["pip-explain","ask_question","point_left","point_right","wave","walk"])
    assert.ok(definition.actions[action]?.phases.length>=3,`${action} is a data-only Kumiki action`);
  assert.deepEqual(definition.actions.ask_question.phases[1].variants,{arm_right:"ask_right"});
  assert.ok(definition.actions.walk.phases.length>=8,"walk must cycle both paws and move the root");
  assert.equal(definition.blink,undefined,"legacy archive lacks closed-eye art; do not fake a blink");
  assert.ok(Object.values(definition.assets).every(asset=>asset.kind==="image"&&asset.sha256==="a".repeat(64)));
});

test("legacy converter rejects other rig generations and missing registered sprites",()=>{
  const {rig,arms,assets}=fixture();
  assert.throws(()=>convertPipMetadata({...rig,schemaVersion:"1.5"},arms,assets),/layout/);
  const incomplete={...arms};delete incomplete.ask_right;
  assert.throws(()=>convertPipMetadata(rig,incomplete,assets),/ask_right/);
  assert.throws(()=>convertPipMetadata(rig,{...arms,point_left:{...arms.point_left,origin:[Infinity,50]}},assets),/registration/);
  const missing={...assets};delete missing.mouth6;
  assert.throws(()=>convertPipMetadata(rig,arms,missing),/mouth6/);
});
