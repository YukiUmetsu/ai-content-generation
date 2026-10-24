import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {parseVideoProductionJob} from "./job.mjs";

const fixture=()=>JSON.parse(readFileSync(new URL("../../../../examples/video-production-house-math-smoke.json",import.meta.url),"utf8"));

test("payoff scene with intentionally silent sound lane is a valid render job",()=>{
  const job=fixture();job.sounds=[];
  const parsed=parseVideoProductionJob(job);
  assert.equal(parsed.ok,true,parsed.findings.map(x=>x.code).join(", "));
});

test("verified local-bank sounds carry a strictly formatted optional source checksum",()=>{
  const job=fixture();
  job.sounds[0]={...job.sounds[0],licenseStatus:"verified",assetRef:"/approved/wind.wav",assetSha256:"a".repeat(64)};
  assert.equal(parseVideoProductionJob(job).ok,true);
  job.sounds[0].assetSha256="incorrect hash";
  assert.equal(parseVideoProductionJob(job).findings.some(x=>x.code==="invalid-sound-hash"),true);
});

test("only non-payoff events may request an exact visual reveal anchor",()=>{
  const job=fixture();job.events.push({id:"visual-cue",beatId:"reveal",anchor:"first-visual-reveal"});
  job.beats[2].eventIds.push("visual-cue");
  assert.equal(parseVideoProductionJob(job).ok,true);
  job.events.at(-1).anchor="estimated-50-percent";
  assert.ok(parseVideoProductionJob(job).findings.some(x=>x.code==="invalid-event-anchor"));
  job.events.at(-1).anchor="first-visual-reveal";
  job.events[0].anchor="first-visual-reveal";
  assert.ok(parseVideoProductionJob(job).findings.some(x=>x.code==="invalid-payoff-anchor"));
});

test("bounded soundtrack gain, fades and explicit offsets validate as part of the render job",()=>{
  const job=fixture();job.sounds[0]={...job.sounds[0],kind:"effect",offsetMs:250,
    gainDb:-24,fadeInMs:75,fadeOutMs:180};
  assert.equal(parseVideoProductionJob(job).ok,true);
  for(const change of [{gainDb:4},{offsetMs:-1},{fadeInMs:9000},{kind:"music"},{fadeOutMs:1.5}]){
    const mutated=structuredClone(job);Object.assign(mutated.sounds[0],change);
    assert.equal(parseVideoProductionJob(mutated).ok,false,JSON.stringify(change));
  }
  const ambience=structuredClone(job);ambience.sounds[0].kind="ambience";
  ambience.sounds[0].gainDb=-34;ambience.sounds[0].offsetMs=0;
  ambience.sounds[0].fadeInMs=1200;ambience.sounds[0].fadeOutMs=1700;
  assert.equal(parseVideoProductionJob(ambience).ok,true);
  ambience.sounds[0].gainDb=-3;
  assert.equal(parseVideoProductionJob(ambience).ok,false);
});

test("a production job cannot silently layer several ambience loops",()=>{
  const job=fixture();
  job.sounds[0]={...job.sounds[0],kind:"ambience",gainDb:-30};
  job.sounds.push({...job.sounds[0],id:"other-ambience"});
  assert.ok(parseVideoProductionJob(job).findings.some(x=>x.code==="multiple-ambience-beds"));
});
