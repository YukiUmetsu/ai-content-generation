import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {createManualVideoDraft} from "./manual-draft.mjs";
import {parseVideoProductionJob} from "./job.mjs";
import {synthesizeNarration} from "./speech.mjs";
import {buildSampleTimeline} from "./timeline.mjs";
import {writeSceneSpeechSrt} from "./timeline.mjs";
import {renderMasterAudio} from "./audio.mjs";
import {compileGeneralVisuals} from "./general-visual-plan.mjs";

const lines=[
  {id:"pip-first",narration:"Pip asks how the moving heat reaches the house.",
    speaker:{id:"pip",role:"character",voiceId:"pip-voice"},pauseAfterMs:120},
  {id:"quill-reply",narration:"Quill explains that the fluid carries energy.",
    speaker:{id:"quill",role:"character",voiceId:"quill-voice"},pauseAfterMs:150},
  {id:"narration-over-visuals",narration:"The same diagram remains visible while the narrator explains the next change.",
    pauseAfterMs:0},
];
const scenes=[
  {headline:"How heat moves",narration:"Heat moves between indoor and outdoor air using a refrigerant circuit, compressor, and coils.",items:["Heat source","Compressor"]},
  {headline:"Follow the energy",narration:"The circulating fluid takes energy from one coil to another and gives it to indoor air.",intent:"general-flow",items:["Outdoor coil","Indoor coil"]},
  {headline:"Keep the result",narration:"The final efficiency depends on outdoor temperatures and how a whole heating system is installed.",items:["Equipment","Installation"]},
];
function jobWithTurns(){
  const job=createManualVideoDraft({title:"Heat transfer",viewerQuestion:"How does it work?",audience:"Homeowners",
    locale:"en-US",scenes}).job;
  job.voice={...job.voice,provider:"local",modelId:"local-fixture",voiceId:"narrator-voice",licenseStatus:"test-only"};
  job.beats[0].speechTurns=structuredClone(lines);
  job.beats[0].narration=lines.map(line=>line.narration).join(" ");
  return job;
}
function wave(samples,frequency){
  const b=Buffer.alloc(44+samples*2);
  b.write("RIFF",0);b.writeUInt32LE(b.length-8,4);b.write("WAVE",8);
  b.write("fmt ",12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);
  b.writeUInt32LE(48000,24);b.writeUInt32LE(96000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);
  b.write("data",36);b.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++)b.writeInt16LE(Math.round(2800*Math.sin(2*Math.PI*frequency*i/48000)),44+i*2);
  return b;
}
const enabled=spawnSync("ffmpeg",["-version"],{stdio:"ignore"}).status===0&&
  spawnSync("ffprobe",["-version"],{stdio:"ignore"}).status===0;

test("one visual scene accepts ordered, individually identified Pip, Quill, and narrator speech turns",()=>{
  const job=jobWithTurns();
  assert.equal(parseVideoProductionJob(job).ok,true);
  assert.equal(job.beats.length,3,"three visual scenes must not become five separate cuts");
  for(const changed of [
    {...job.beats[0],narration:"A different summary silently changes the approved script."},
    {...job.beats[0],speechTurns:[lines[0],{...lines[1],id:lines[0].id},lines[2]]},
    {...job.beats[0],speechTurns:[...lines,{...lines[0],id:"unscheduled",startMs:200}]},
    {...job.beats[0],speechTurns:[...lines.slice(0,2),{...lines[2],speaker:{id:"narrator",role:"character",voiceId:"narrator-voice"}}]},
  ]){
    const altered=structuredClone(job);altered.beats[0]=changed;
    assert.equal(parseVideoProductionJob(altered).ok,false,"invalid or ambiguous turns must fail before synthesis");
  }
});

test("caption identifiers are scoped to scenes so repeatable character line IDs do not collide",()=>{
  const speech=["scene-one","scene-two"].map(id=>({id,text:"One shared caption ID",samples:48000,pauseAfterMs:0,
    turns:[{id:"shared-line",text:"One shared caption ID",samples:48000,pauseAfterMs:0,
      speakerId:"pip",speakerRole:"character"}]}));
  const timeline=buildSampleTimeline(speech,{fps:{num:30,den:1}});
  const captions=writeSceneSpeechSrt(timeline,speech);
  assert.equal(captions.match(/Pip: One shared caption ID/gu)?.length,2);
  assert.match(captions,/00:00:01,000 --> 00:00:02,000/u);
});

test("a late unauthorized voice within a scene fails before paid synthesis, including on cache hits",async t=>{
  const root=await mkdtemp(join(tmpdir(),"contentgen-dialogue-denied-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  let calls=0;
  const options={provider:"local",providerRevision:"unit-test-1",cacheRoot:root,localVoiceAuthorized:true,
    authorizedVoiceIds:["pip-voice"],synthesize:async()=>{calls++;throw Error("Provider must not be called");}};
  await assert.rejects(synthesizeNarration(jobWithTurns(),options),/additional speaker voice is not authorized/u);
  assert.equal(calls,0);
});

test("oversized multi-scene conversations fail before any provider request",async t=>{
  const root=await mkdtemp(join(tmpdir(),"contentgen-dialogue-limit-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const job=jobWithTurns();
  const turn={id:"pip-line",narration:"Let's inspect the same diagram again.",pauseAfterMs:0};
  job.beats=Array.from({length:11},(_,index)=>({
    ...structuredClone(job.beats[0]),id:`scene-${index}`,
    speechTurns:Array.from({length:16},(_,line)=>({...turn,id:`line-${line}`})),
    narration:Array(16).fill(turn.narration).join(" "),eventIds:[]
  }));
  assert.ok(parseVideoProductionJob(job).findings.some(finding=>finding.code==="speech-turn-limit"));
  let called=0;
  await assert.rejects(synthesizeNarration(job,{provider:"local",providerRevision:"1",cacheRoot:root,
    localVoiceAuthorized:true,synthesize:async()=>{called++;throw Error("must not run");}}),/too many speech turns/u);
  assert.equal(called,0);
});

test("one continuous scene's FFmpeg master sequences character and narrator turns with timed labeled captions",{skip:!enabled},async t=>{
  const root=await mkdtemp(join(tmpdir(),"contentgen-dialogue-scene-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const job=jobWithTurns(),frequencies={"pip-voice":230,"quill-voice":350,"narrator-voice":470};
  const called=[];
  const options={provider:"local",providerRevision:"unit-test-1",cacheRoot:join(root,"cache"),
    localVoiceAuthorized:true,authorizedVoiceIds:["pip-voice","quill-voice"],
    normalizeWav:async(source,dest)=>writeFile(dest,await readFile(source)),
    synthesize:async(request,id)=>{called.push({id,voiceId:request.voiceId});return{
      audio:wave(48000,frequencies[request.voiceId]),provider:"local",modelId:"local-fixture",
      voiceId:request.voiceId,engineVersion:"unit-test-1",encoding:"wav"};}};
  const first=await synthesizeNarration(job,options);
  assert.equal(first.length,3,"each visual scene keeps one measured timeline slot");
  assert.equal(first[0].turns.length,3);
  assert.equal(first[0].samples,3*48000+(120+150)*48);
  assert.deepEqual(called.slice(0,3).map(x=>x.voiceId),["pip-voice","quill-voice","narrator-voice"]);
  const timeline=buildSampleTimeline(first,{fps:{num:30,den:1},events:job.events});
  const visual=compileGeneralVisuals(job,timeline,first);
  assert.deepEqual(visual.chapters[0].dialogue.turns.map(turn=>turn.speakerId),["pip","quill","narrator"]);
  assert.equal(visual.chapters[0].dialogue.turns[0].startFrame,0);
  assert.equal(visual.chapters[0].dialogue.turns[1].startFrame,34);
  assert.equal(visual.chapters[0].dialogue.turns[2].startFrame,68);
  const output=await renderMasterAudio({beats:first,timeline,sfx:[]},{outputDir:join(root,"master")});
  const stem=await readFile(output.voiceStemPath);
  const signalAt=(start,frequency)=>{
    let total=0;for(let i=start;i<start+12000;i++)total+=stem.readInt16LE(44+i*2)*
      Math.sin(2*Math.PI*frequency*i/48000);return Math.abs(total/12000);
  };
  assert.ok(signalAt(12000,230)>600);
  assert.ok(signalAt(53760+12000,350)>600);
  assert.ok(signalAt(108960+12000,470)>600);
  assert.equal(stem.readInt16LE(44+48010*2),0,"Pip's explicit pause is genuinely silent");
  assert.match(output.srtText,/Pip: Pip asks how the moving heat reaches the house\./u);
  assert.match(output.srtText,/Quill: Quill explains that the fluid carries energy\./u);
  assert.match(output.srtText,/Narrator: The same diagram remains visible/u);
  assert.match(output.srtText,/00:00:01,120 --> 00:00:02,120/u);
  const cached=await synthesizeNarration(job,options);
  assert.equal(called.length,5,"a second run must reuse all five exact cached speech segments");
  assert.equal(cached[0].samples,first[0].samples);
  const revised=structuredClone(job);
  revised.beats[0].speechTurns[1].narration="Quill now explains how a different valve redirects this heat.";
  revised.beats[0].narration=revised.beats[0].speechTurns.map(turn=>turn.narration).join(" ");
  await synthesizeNarration(revised,options);
  assert.equal(called.length,6,"editing one Quill line must regenerate just that line");
  assert.equal(called.at(-1).voiceId,"quill-voice");
  assert.match(createHash("sha256").update(stem).digest("hex"),/^[a-f0-9]{64}$/u);
});
