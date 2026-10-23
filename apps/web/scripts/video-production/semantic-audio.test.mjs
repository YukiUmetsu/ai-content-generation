import test from "node:test";
import assert from "node:assert/strict";
import { makeTestSoftTick } from "./audio.mjs";

test("self-authored quiet transition cue is a bounded, valid 48k mono original WAV",()=>{
  const pcm=makeTestSoftTick();
  assert.equal(pcm.toString("ascii",0,4),"RIFF");
  assert.equal(pcm.toString("ascii",8,12),"WAVE");
  assert.equal(pcm.readUInt32LE(24),48000);
  assert.equal(pcm.readUInt16LE(22),1);
  assert.equal(pcm.readUInt16LE(34),16);
  assert.equal(pcm.readUInt32LE(40),Math.round(48000*.12)*2);
  let max=0;
  for(let i=44;i<pcm.length;i+=2)max=Math.max(max,Math.abs(pcm.readInt16LE(i)));
  assert.ok(max>0&&max<9000);
  assert.deepEqual(makeTestSoftTick(),pcm);
});
