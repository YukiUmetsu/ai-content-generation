import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {bindApprovedSfxToRenderJob,resolveAndBindApprovedSfx} from "./sfx-render-bindings.mjs";
import {compilePreproductionBundle} from "./preproduction.mjs";
import {compilePreproductionRenderJob} from "./preproduction-render-bridge.mjs";
import {parseVideoProductionJob} from "./job.mjs";

const audioHash="f".repeat(64);
const approved=(shotId,mode="auto")=>({shotId,mode,intent:"Soft reveal",assetId:"f0012345-1234-1234-1234-123456789abc",
  sha256:audioHash,localPath:"/local/sfx/approved.wav",title:"Soft reveal",license:"cc0",rightsStatus:"user-reviewed"});
function bridge(){return {job:{kind:"video-production-job",visualFamily:"general-explainer-v1",topic:{payoffEventId:"payoff"},
  beats:[{id:"beat0",eventIds:[]},{id:"beat1",eventIds:["test-accent"]},{id:"beat2",eventIds:["payoff"]}],
  events:[{id:"test-accent",beatId:"beat1"},{id:"payoff",beatId:"beat2"}],
  sounds:[{id:"test-tick",eventId:"test-accent",category:"transition",assetRef:"self-authored-test-soft-tick",licenseStatus:"test-only"},
    {id:"test-chime",eventId:"payoff",category:"reveal",assetRef:"self-authored-test-chime",licenseStatus:"test-only"}]},
  shotMap:[{shotId:"shot0",beatId:"beat0"},{shotId:"shot1",beatId:"beat1"},{shotId:"shot2",beatId:"beat2"}]};}

test("approved scene effects attach to real beat starts; mute removes procedural chimes",()=>{
  const original=bridge(),snapshot=structuredClone(original);
  const {job,sfxSummary}=bindApprovedSfxToRenderJob(original,[approved("shot0"),
    {shotId:"shot1",mode:"mute",intent:"click",assetId:null},approved("shot2","pin")]);
  assert.deepEqual(original,snapshot,"binding must never mutate checked source data");
  assert.equal(job.sounds.length,2);
  assert.deepEqual(job.sounds.map(x=>x.licenseStatus),["verified","verified"]);
  assert.ok(job.sounds.every(x=>x.assetSha256===audioHash));
  assert.equal(job.sounds[1].eventId,"payoff","the existing payoff event owns this cue");
  assert.equal(job.events.find(x=>x.id===job.sounds[0].eventId).beatId,"beat0");
  assert.ok(job.beats[0].eventIds.includes(job.sounds[0].eventId));
  assert.ok(job.sounds.every(x=>x.eventId!=="test-accent"));
  assert.deepEqual(sfxSummary,{approved:2,muted:1,unmatched:0});
});

test("missing automatic matches are silent, even when legacy renderer has a test chime",()=>{
  const {job,sfxSummary}=bindApprovedSfxToRenderJob(bridge(),[
    {shotId:"shot2",mode:"auto",intent:"Soft chime",assetId:null}]);
  assert.deepEqual(job.sounds,[]);
  assert.equal(sfxSummary.unmatched,1);
  assert.equal(job.events.find(x=>x.id==="payoff").beatId,"beat2");
});

test("damaged pinned cues and unreviewed paths never enter the production job",()=>{
  const missing={...approved("shot0","pin"),assetId:null,localPath:null,sha256:null};
  assert.throws(()=>bindApprovedSfxToRenderJob(bridge(),[missing]),/pinned|missing|damaged/i);
  for(const fields of [{license:"by-nc"},{rightsStatus:"unverified"},{sha256:"bad"},{localPath:"../bad.wav"}]){
    assert.throws(()=>bindApprovedSfxToRenderJob(bridge(),[{...approved("shot0"),...fields}]),/approved|verified|license|path|hash|rights/i);
  }
});

test("a changed or ambiguous shot-to-beat map cannot silently time the wrong SFX",()=>{
  const compiled=bridge();compiled.shotMap[1].beatId="beat2";
  assert.throws(()=>bindApprovedSfxToRenderJob(compiled,[approved("shot1")]),/shot.*map|beat.*map|mapping/i);
  assert.throws(()=>bindApprovedSfxToRenderJob(bridge(),[approved("not-a-shot")]),/unknown shot/i);
  assert.throws(()=>bindApprovedSfxToRenderJob(bridge(),[approved("shot0"),approved("shot0")]),/duplicate/i);
});

test("check and start can resolve the same trusted bank; changed sound choice changes the job identity",async()=>{
  const compiled=bridge(),bundle={kind:"preproduction-bundle",researchId:"my-project"};
  const sources=[];
  const resolve=async input=>{
    sources.push(input);
    return [approved("shot0")];
  };
  const first=await resolveAndBindApprovedSfx(compiled,{dossier:{id:"my-project"},bundle},{resolve});
  assert.deepEqual(sources,[{projectId:"my-project",bundle}]);
  const second=await resolveAndBindApprovedSfx(compiled,{dossier:{id:"my-project"},bundle},
    {resolve:async()=>[{...approved("shot0"),sha256:"c".repeat(64)}]});
  assert.notDeepEqual(first.job.sounds,second.job.sounds);
  await assert.rejects(resolveAndBindApprovedSfx(compiled,{dossier:{id:"other"},bundle},{resolve}),/project|matching/i);
  await assert.rejects(resolveAndBindApprovedSfx(compiled,{dossier:{id:"my-project"},bundle},
    {resolve:async()=>[{...approved("shot0","pin"),assetId:null}]}),/pinned|damaged|missing/i);
});

test("a real research-to-render bridge with reviewed SFX remains valid for production",()=>{
  const fixture=name=>JSON.parse(readFileSync(new URL(`../../../../examples/${name}`,import.meta.url),"utf8"));
  const dossier=fixture("preproduction-research-smoke.json");
  const bundle=compilePreproductionBundle(dossier,fixture("preproduction-plan-smoke.json"));
  const compiled=compilePreproductionRenderJob(dossier,bundle);
  const {job}=bindApprovedSfxToRenderJob(compiled,[approved(bundle.plan.shots[0].id)]);
  const parsed=parseVideoProductionJob(job);
  assert.equal(parsed.ok,true,JSON.stringify(parsed.findings.filter(f=>f.severity==="error")));
  assert.equal(job.sounds.length,1);
});

test("reviewed visual reveal uses its own anchored event and never moves the narrative payoff",()=>{
  const compiled=bridge();
  const selected={...approved("shot2","pin"),trigger:"first-visual-reveal"};
  const {job}=bindApprovedSfxToRenderJob(compiled,[selected]);
  assert.equal(job.sounds.length,1);
  const event=job.events.find(x=>x.id===job.sounds[0].eventId);
  assert.equal(event.anchor,"first-visual-reveal");
  assert.equal(event.beatId,"beat2");
  assert.notEqual(event.id,job.topic.payoffEventId);
  assert.equal(job.events.find(x=>x.id==="payoff").anchor,undefined);
  assert.ok(job.beats[2].eventIds.includes(event.id));
  assert.throws(()=>bindApprovedSfxToRenderJob(compiled,[{...selected,trigger:"halfway-maybe"}]),/trigger|timing/i);
});

test("unsupported custom-scene reveals are rejected at readiness before expensive narration",()=>{
  const compiled=bridge();compiled.job.beats[0].visual={sceneRecipe:"custom-scenes-v1"};
  assert.throws(()=>bindApprovedSfxToRenderJob(compiled,[{...approved("shot0"),
    trigger:"first-visual-reveal"}]),/unsupported|scene|recipe/i);
});

test("dynamic visual families are rejected at readiness without guessing their reveal",()=>{
  for(const change of [
    {visualIntent:"general-flow"},
    {visual:{chart:{kind:"bar"}}},
    {visual:{direction:{visualMechanic:{type:"transform"}}}},
    {visual:{direction:{transformation:{type:"morph"}}}},
    {visualIntent:"general-intro",visual:{hookStrategy:"unexpected-reveal"}},
  ]){
    const compiled=bridge();Object.assign(compiled.job.beats[0],change);
    assert.throws(()=>bindApprovedSfxToRenderJob(compiled,[{...approved("shot0"),trigger:"first-visual-reveal"}]),
      /unsupported|visual|dynamic|timing/i);
  }
});

test("supplementary cues retain separate events, individual mix controls and an ambience bed",()=>{
  const compiled=bridge(),base=approved("shot0");
  const layer=(layerId,shotId,trigger,offsetMs)=>({layerId,shotId,trigger,offsetMs,assetId:base.assetId,
    sha256:base.sha256,localPath:base.localPath,license:"cc0",rightsStatus:"user-reviewed",
    gainDb:-25,fadeInMs:60,fadeOutMs:160});
  const ambience={...layer("not-used","shot0","shot-start",0),gainDb:-34,fadeInMs:1200,fadeOutMs:1700};
  const {job,sfxSummary}=bindApprovedSfxToRenderJob(compiled,[base],{layers:[
    layer("layer_alpha","shot0","shot-start",360),layer("layer_beta","shot2","first-visual-reveal",80)],ambience});
  assert.equal(job.sounds.length,4);
  const extra=job.sounds.find(s=>s.id==="reviewed-layer-layer_alpha");
  assert.equal(extra.offsetMs,360);
  assert.equal(extra.gainDb,-25);
  assert.equal(extra.fadeOutMs,160);
  const reveal=job.sounds.find(s=>s.id==="reviewed-layer-layer_beta");
  assert.equal(job.events.find(e=>e.id===reveal.eventId).anchor,"first-visual-reveal");
  assert.equal(job.events.find(e=>e.id===extra.eventId).anchor,undefined);
  assert.notEqual(reveal.eventId,job.topic.payoffEventId);
  assert.equal(job.sounds.find(s=>s.kind==="ambience").gainDb,-34);
  assert.equal(sfxSummary.extraLayers,2);
  assert.equal(sfxSummary.ambience,1);
});

test("invalid extra-layer mapping and permissions fail at readiness",()=>{
  const approvedAsset=approved("shot0");
  const layer={layerId:"layer_test",shotId:"shot0",assetId:approvedAsset.assetId,
    sha256:approvedAsset.sha256,localPath:approvedAsset.localPath,license:"cc0",
    rightsStatus:"user-reviewed",trigger:"shot-start",offsetMs:0,gainDb:-20,fadeInMs:0,fadeOutMs:0};
  for(const change of [{shotId:"orphan"},{sha256:"invalid"},{rightsStatus:"unknown"},
    {trigger:"invented-reveal"},{offsetMs:-1}]){
    assert.throws(()=>bindApprovedSfxToRenderJob(bridge(),[],{layers:[{...layer,...change}],ambience:null}),
      /invalid|unsupported|approved|unknown|offset|shot|rights|trigger/i);
  }
  const compiled=bridge();compiled.job.beats[0].visualIntent="general-flow";
  assert.throws(()=>bindApprovedSfxToRenderJob(compiled,[],{layers:[{...layer,trigger:"first-visual-reveal"}],ambience:null}),
    /unsupported|visual/i);
});
