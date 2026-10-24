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
