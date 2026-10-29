import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import * as offlineRigDialogue from "./offline-rig-dialogue.mjs";

const {makeOfflineRigDialogue}=offlineRigDialogue;

const run=promisify(execFile);
test("spoken Pip and Quill fixtures have measured contiguous 48-kHz windows, not a test-tone surrogate",async t=>{
  const {stdout:filters}=await run("ffmpeg",["-hide_banner","-filters"]);
  if(!/\bflite\b/.test(filters)){t.skip("FFmpeg was not built with offline Flite test speech");return;}
  const root=await mkdtemp(join(tmpdir(),"contentgen-rig-speech-test-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const track=await makeOfflineRigDialogue({outDir:root,turns:[
    {id:"pip-asks",speakerId:"pip",text:"Hello I am Pip",voice:"kal"},
    {id:"quill-answers",speakerId:"quill",text:"This is Quill speaking",voice:"slt"}
  ],fps:{num:30,den:1}});
  assert.equal(track.sampleRate,48000);
  assert.equal(track.turns.length,2);
  assert.equal(track.turns[0].startSample,0);
  assert.equal(track.turns[1].startSample,track.turns[0].endSample);
  assert.equal(track.turns[1].endSample,track.samples);
  assert.ok(track.turns.every(turn=>turn.endFrame>turn.startFrame && turn.endSample>turn.startSample));
  assert.equal(track.turns[1].endFrame,Math.round(track.samples*30/48000));
  const {stdout}=await run("ffprobe",["-v","error","-select_streams","a:0",
    "-show_entries","stream=duration_ts,sample_rate","-of","json",track.wavPath]);
  const audio=JSON.parse(stdout).streams?.[0];
  assert.equal(audio.sample_rate,"48000");
  assert.ok(Math.abs(Number(audio.duration_ts)-track.samples)<=1,
    "audio fixture sample offsets must match the actual WAV, not guessed narration duration");
});
test("a single offline dialogue turn retains its WAV sample count and accepts no unsafe filter text",async t=>{
  const {stdout:filters}=await run("ffmpeg",["-hide_banner","-filters"]);
  if(!/\bflite\b/.test(filters)){t.skip("FFmpeg was not built with offline Flite test speech");return;}
  const root=await mkdtemp(join(tmpdir(),"contentgen-one-rig-speech-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const selected=[{id:"single",speakerId:"pip",text:"Hello",voice:"kal"}];
  const track=await makeOfflineRigDialogue({outDir:root,turns:selected,fps:{num:30,den:1}});
  assert.equal(track.turns.length,1);
  assert.equal(track.turns[0].endSample,track.samples);
  await assert.rejects(makeOfflineRigDialogue({outDir:root,turns:[{
    ...selected[0],text:"hello;movie=evil"}],fps:{num:30,den:1}}),/safe spoken text/i);
  await assert.rejects(makeOfflineRigDialogue({outDir:root,turns:[{
    ...selected[0],text:"Pip's tail"}],fps:{num:30,den:1}}),/safe spoken text/i);
});

test("a continuous offline rig film keeps each scene's measured speech at its exact sample offset",async t=>{
  const {stdout:filters}=await run("ffmpeg",["-hide_banner","-filters"]);
  if(!/\bflite\b/.test(filters)){t.skip("FFmpeg lacks test-only Flite voices");return;}
  const root=await mkdtemp(join(tmpdir(),"contentgen-rig-scene-sound-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const first=await makeOfflineRigDialogue({outDir:root,turns:[{id:"first",speakerId:"pip",voice:"kal",text:"Hello Pip"}],
    fps:{num:30,den:1}});
  const second=await makeOfflineRigDialogue({outDir:root,turns:[{id:"second",speakerId:"quill",voice:"slt",text:"Hello Quill"}],
    fps:{num:30,den:1}});
  const totalSamples=4*48000;
  assert.equal(typeof offlineRigDialogue.assembleOfflineRigSceneAudio,"function");
  const assembled=await offlineRigDialogue.assembleOfflineRigSceneAudio({outDir:root,totalSamples,
    clips:[{wavPath:first.wavPath,startSample:0,samples:first.samples},
      {wavPath:second.wavPath,startSample:96000,samples:second.samples}]});
  assert.equal(assembled.samples,totalSamples);
  const {stdout:probed}=await run("ffprobe",["-v","error","-select_streams","a:0",
    "-show_entries","stream=duration_ts,sample_rate","-of","json",assembled.wavPath]);
  assert.equal(Number(JSON.parse(probed).streams[0].duration_ts),totalSamples);
  const {stdout:pcm}=await run("ffmpeg",["-hide_banner","-loglevel","error","-nostdin","-i",assembled.wavPath,
    "-f","s16le","-ac","1","-ar","48000","pipe:1"],{encoding:"buffer",maxBuffer:2*1024*1024});
  const power=(from,to)=>{let sum=0;for(let i=from;i<to;i++)sum+=Math.abs(pcm.readInt16LE(i*2));return sum;};
  assert.ok(first.samples+9600<96000,"the fixture must have a genuine silent gap between scenes");
  assert.equal(power(first.samples+4800,96000-4800),0,
    "speech must not drift into the silence between authored scenes");
  assert.ok(power(96000,144000)>0,"the second scene must audibly speak after its sample-accurate offset");
  await assert.rejects(offlineRigDialogue.assembleOfflineRigSceneAudio({outDir:root,totalSamples,clips:[
    {wavPath:first.wavPath,startSample:0,samples:first.samples},
    {wavPath:second.wavPath,startSample:1,samples:second.samples}]}),/overlap|boundary/i);
  await assert.rejects(offlineRigDialogue.assembleOfflineRigSceneAudio({outDir:root,totalSamples,clips:[
    {wavPath:first.wavPath,startSample:0,samples:first.samples},
    {wavPath:second.wavPath,startSample:totalSamples-1,samples:second.samples}]}),/duration|length|boundary/i);
});
