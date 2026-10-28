import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { buildSampleTimeline } from "./timeline.mjs";
import { synthesizeNarration } from "./speech.mjs";
import { renderMasterAudio } from "./audio.mjs";

function toneWav(samples, amplitude = 2000, sampleRate = 48000, hertz = 220) {
  const b = Buffer.alloc(44 + samples * 2);
  b.write("RIFF", 0); b.writeUInt32LE(b.length - 8, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22); b.writeUInt32LE(sampleRate, 24); b.writeUInt32LE(sampleRate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36);
  b.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) b.writeInt16LE(amplitude === 0 ? 0 : Math.round(Math.sin(2 * Math.PI * hertz * i / sampleRate) * amplitude), 44 + 2 * i);
  return b;
}
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const enabled = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 && spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;
function strengthAt(bytes,start,count,hertz){
  const data=bytes.indexOf(Buffer.from("data"))+8;
  assert.ok(data>=8,"rendered WAV must have an audio data chunk");
  let sum=0;
  for(let index=start;index<start+count;index++)sum+=bytes.readInt16LE(data+2*index)*Math.sin(2*Math.PI*hertz*index/48000);
  return Math.abs(sum/count);
}

async function fixture(t, { amplitude = 2000, sampleRate = 48000 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "contentgen-master-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const beats = [];
  for (const [i, id] of ["intro", "payoff"].entries()) {
    const audio = toneWav(sampleRate, amplitude, sampleRate);
    const wavPath = join(dir, `${id}.wav`);
    await writeFile(wavPath, audio);
    beats.push({ id, wavPath, samples: sampleRate, sha256: sha256(audio), text: `An illustrative ${id} sentence.`, pauseAfterMs: i === 0 ? 250 : 0, eventIds: i === 1 ? ["lifetime-total-reveal"] : [], licenseStatus: "test-only" });
  }
  const events = [{ id: "lifetime-total-reveal", beatId: "payoff" }];
  const timeline = buildSampleTimeline(beats, { fps: { num: 30, den: 1 }, events });
  const sfx = [{ id: "reveal", eventId: "lifetime-total-reveal", assetRef: "self-authored-test-chime", licenseStatus: "test-only" }];
  return { dir, beats, timeline, sfx };
}

test("rendered master matches measured speech samples with silent gaps, SRT and event-timed chime", { skip: !enabled }, async (t) => {
  const { dir, beats, timeline, sfx } = await fixture(t);
  const result = await renderMasterAudio({ beats, timeline, sfx }, { outputDir: join(dir, "output"), allowTestAssets: true });
  assert.equal(result.samples, 108000);
  assert.equal(result.sfxCueSamples.reveal, 60000);
  assert.match(result.srtText, /00:00:01,250 --> 00:00:02,250/);
  const voice = await readFile(result.voiceStemPath);
  assert.equal(voice.readUInt32LE(40), timeline.totalSamples * 2);
  assert.equal(voice.readInt16LE(44 + 48000 * 2), 0, "silence must not be filled by a stretched narration beat");
  assert.ok(result.loudness.integratedLufs < 0);
  assert.ok(result.loudness.truePeakDbtp <= -1.45, "measured peak must be within approved limit");
  assert.ok((await readFile(result.wavPath)).length > 1000);
});

test("intentional no-SFX mix remains playable without inserting sounds", { skip: !enabled }, async (t) => {
  const { dir, beats, timeline } = await fixture(t);
  const result = await renderMasterAudio({ beats, timeline, sfx: [] }, { outputDir: join(dir, "no-sfx") });
  assert.equal(result.samples, timeline.totalSamples);
  assert.deepEqual(result.sfxCueSamples, {});
  assert.equal(result.findings.length, 0);
  assert.equal(result.ducking,null,"silence-only or narration-only mixes must not claim music processing");
});

test("actual FFmpeg voice stem follows Pip, Quill, narrator, Pip without swapping speakers", {skip:!enabled},async t=>{
  const dir=await mkdtemp(join(tmpdir(),"contentgen-dialogue-master-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const voices={pip:240,quill:360,narrator:480};
  const beats=["pip","quill","narrator","pip"].map((name,index)=>({
    id:`line-${index}`,narration:`Spoken line ${index} by ${name}.`,pauseAfterMs:index===1?250:0,
    eventIds:[],speaker:{id:name,role:name==="narrator"?"narrator":"character",voiceId:name}
  }));
  const job={locale:"en-US",approval:"test-only",policy:{commercialRightsVerified:false},
    voice:{provider:"local",voiceId:"narrator",modelId:"local-fixture",licenseStatus:"test-only"},beats};
  const speech=await synthesizeNarration(job,{
    provider:"local",providerRevision:"rig-test-1",cacheRoot:join(dir,"cache"),
    localVoiceAuthorized:true,authorizedVoiceIds:["pip","quill"],
    normalizeWav:async(input,output)=>writeFile(output,await readFile(input)),
    synthesize:async request=>({audio:toneWav(48000,3000,48000,voices[request.voiceId]),
      provider:"local",modelId:"local-fixture",voiceId:request.voiceId,
      engineVersion:"rig-test-1",encoding:"wav"})
  });
  assert.deepEqual(speech.map(beat=>beat.speakerId),["pip","quill","narrator","pip"]);
  const timeline=buildSampleTimeline(speech,{fps:{num:30,den:1},events:[]});
  const master=await renderMasterAudio({beats:speech,timeline,sfx:[]},{outputDir:join(dir,"mixed")});
  const stem=await readFile(master.voiceStemPath);
  for(const range of timeline.beats){
    const speaker=speech.find(beat=>beat.id===range.id).speakerId;
    const expected=voices[speaker];
    const signal=strengthAt(stem,range.startSample+12000,12000,expected);
    assert.ok(signal>500,`Expected ${speaker} to be audible on its own aligned segment, measured ${signal}`);
    for(const [name,hz] of Object.entries(voices)){
      if(name===speaker)continue;
      assert.ok(strengthAt(stem,range.startSample+12000,12000,hz)<signal/8,
        `${speaker}'s segment must not contain ${name}'s voice tone`);
    }
  }
  assert.equal(stem.readInt16LE(44+timeline.beats[1].pauseEndSample*2-2),0,
    "narration pauses must remain silent before the next speaker");
});

test("reviewed SFX is mixed at the exact event sample only when the imported WAV hash still matches", { skip: !enabled }, async t=>{
  const {dir,beats,timeline}=await fixture(t);
  const wav=toneWav(12000,1900),assetPath=join(dir,"reviewed-sound.wav");
  await writeFile(assetPath,wav);
  const sound={id:"reviewed",eventId:"lifetime-total-reveal",assetRef:assetPath,
    assetPath,assetSha256:sha256(wav),licenseStatus:"verified"};
  const verified=await renderMasterAudio({beats,timeline,sfx:[sound]},
    {outputDir:join(dir,"verified")});
  assert.equal(verified.sfxCueSamples.reviewed,60000);
  assert.equal(verified.samples,timeline.totalSamples);
  await writeFile(assetPath,toneWav(12000,2100));
  await assert.rejects(renderMasterAudio({beats,timeline,sfx:[sound]},
    {outputDir:join(dir,"tampered")}),/checksum|hash|changed/i);
});

test("multiple effects offset from one event mix independently, with bounded gain and fades",{skip:!enabled},async t=>{
  const {dir,beats,timeline}=await fixture(t);
  const bytes=toneWav(24000,3000),assetPath=join(dir,"additional.wav");await writeFile(assetPath,bytes);
  const effect={kind:"effect",assetRef:assetPath,assetPath,assetSha256:sha256(bytes),
    eventId:"lifetime-total-reveal",licenseStatus:"verified",gainDb:-18,fadeInMs:120,fadeOutMs:240};
  const sfx=[{...effect,id:"hit-a",offsetMs:0},{...effect,id:"hit-b",offsetMs:250,gainDb:-30,fadeInMs:0,fadeOutMs:120}];
  const result=await renderMasterAudio({beats,timeline,sfx},{outputDir:join(dir,"multi")});
  assert.deepEqual(result.sfxCueSamples,{"hit-a":60000,"hit-b":72000});
  assert.equal(result.samples,timeline.totalSamples);
  assert.ok(result.loudness.truePeakDbtp<=-1.45);
  const single=await renderMasterAudio({beats,timeline,sfx:sfx.slice(0,1)},
    {outputDir:join(dir,"single")});
  assert.notEqual(sha256(await readFile(result.wavPath)),sha256(await readFile(single.wavPath)),
    "the second independently timed cue must alter the actual master");
});

test("a short ambience sample loops across the full measured film and respects safe fade bounds",{skip:!enabled},async t=>{
  const {dir,beats,timeline}=await fixture(t);
  const fullTimeline={...timeline,eventSamples:{...timeline.eventSamples,"film-start":0}};
  const bytes=toneWav(4800,2000,48000,1000),assetPath=join(dir,"ambient.wav");await writeFile(assetPath,bytes);
  const ambience={id:"ambient",kind:"ambience",eventId:"film-start",assetRef:assetPath,
    assetPath,assetSha256:sha256(bytes),licenseStatus:"verified",offsetMs:0,
    gainDb:-25,fadeInMs:200,fadeOutMs:400};
  const result=await renderMasterAudio({beats,timeline:fullTimeline,sfx:[ambience]},{outputDir:join(dir,"ambient")});
  assert.equal(result.samples,timeline.totalSamples);
  assert.equal(result.sfxCueSamples.ambient,0);
  assert.ok(result.loudness.truePeakDbtp<=-1.45);
  const late=await readFile(result.wavPath);
  const steady=strengthAt(late,48000,4800,1000);
  assert.ok(steady>15,"1000 Hz ambience must still be audible after the original 0.1s clip ends");
  assert.ok(steady>strengthAt(late,0,2400,1000)*1.7,"fade-in must be audible in the actual master");
  assert.ok(steady>strengthAt(late,101000,2400,1000)*1.7,"fade-out must be audible near the end of the master");
  await assert.rejects(renderMasterAudio({beats,timeline:fullTimeline,sfx:[{...ambience,gainDb:2}]},
    {outputDir:join(dir,"too-loud")}),/gain|range|bound/i);
  await assert.rejects(renderMasterAudio({beats,timeline:fullTimeline,sfx:[{...ambience,offsetMs:500}]},
    {outputDir:join(dir,"bad-ambient-offset")}),/offset|ambien/i);
});

test("music bed audibly ducks under narration and rises during a long measured pause",{skip:!enabled},async t=>{
  const {dir,beats}=await fixture(t);
  beats[0].pauseAfterMs=1500;
  const timeline=buildSampleTimeline(beats,{fps:{num:30,den:1},
    events:[{id:"lifetime-total-reveal",beatId:"payoff"}]});
  const withStart={...timeline,eventSamples:{...timeline.eventSamples,"film-start":0}};
  const bytes=toneWav(4800,10000,48000,1000),assetPath=join(dir,"music.wav");
  await writeFile(assetPath,bytes);
  const music={id:"music",kind:"ambience",eventId:"film-start",assetRef:assetPath,
    assetPath,assetSha256:sha256(bytes),licenseStatus:"verified",gainDb:-20,fadeInMs:100,fadeOutMs:100};
  const result=await renderMasterAudio({beats,timeline:withStart,sfx:[music]},
    {outputDir:join(dir,"narration-ducked")});
  const master=await readFile(result.wavPath);
  const speaking=strengthAt(master,24000,4800,1000),pause=strengthAt(master,96000,4800,1000);
  assert.ok(speaking>1,"music must remain audible under the voice rather than being hard-muted");
  assert.ok(pause>speaking*1.6,
    `music should rise in real narration pauses (${pause.toFixed(1)} vs ${speaking.toFixed(1)} 1 kHz strength)`);
  assert.equal(result.samples,timeline.totalSamples);
  assert.deepEqual(result.ducking,{mode:"voice-sidechain",beds:1,threshold:0.018,ratio:8,attackMs:70,releaseMs:350});
  assert.ok(result.loudness.truePeakDbtp<=-1.45);
});

test("multiple sustained beds duck independently without suppressing event-timed effects",{skip:!enabled},async t=>{
  const {dir,beats,timeline,sfx}=await fixture(t);
  const withStart={...timeline,eventSamples:{...timeline.eventSamples,"film-start":0}};
  const beds=[];
  for(const [index,hz] of [1000,1400].entries()){
    const bytes=toneWav(4800,5000,48000,hz),assetPath=join(dir,`bed-${index}.wav`);
    await writeFile(assetPath,bytes);
    beds.push({id:`music-${index}`,kind:"ambience",eventId:"film-start",assetRef:assetPath,
      assetPath,assetSha256:sha256(bytes),licenseStatus:"verified",gainDb:-25,
      fadeInMs:100,fadeOutMs:100});
  }
  const musicOnly=await renderMasterAudio({beats,timeline:withStart,sfx:beds},
    {outputDir:join(dir,"two-beds")});
  const withEffect=await renderMasterAudio({beats,timeline:withStart,sfx:[...beds,...sfx]},
    {outputDir:join(dir,"two-beds-and-cue"),allowTestAssets:true});
  assert.equal(withEffect.samples,timeline.totalSamples);
  assert.equal(withEffect.sfxCueSamples.reveal,60000);
  assert.notEqual(sha256(await readFile(musicOnly.wavPath)),sha256(await readFile(withEffect.wavPath)));
  assert.ok(withEffect.loudness.truePeakDbtp<=-1.45);
  await assert.rejects(renderMasterAudio({beats,timeline:withStart,sfx:[...beds,...beds.map(
    (bed,index)=>({...bed,id:`additional-${index}`})),{...beds[0],id:"fifth"}]},
  {outputDir:join(dir,"too-many-beds")}),/four sustained ambience beds/);
});

test("manual cue offsets that start outside the finished timeline fail without publishing a master",{skip:!enabled},async t=>{
  const {dir,beats,timeline}=await fixture(t);
  const bytes=toneWav(4800),assetPath=join(dir,"end.wav");await writeFile(assetPath,bytes);
  const effect={id:"past-end",kind:"effect",eventId:"lifetime-total-reveal",assetPath,
    assetRef:assetPath,assetSha256:sha256(bytes),licenseStatus:"verified",offsetMs:10000,
    gainDb:-18,fadeInMs:0,fadeOutMs:0};
  await assert.rejects(renderMasterAudio({beats,timeline,sfx:[effect]},
    {outputDir:join(dir,"past-end")}),/outside|duration|timeline|offset/i);
});

test("orphan event, mismatched asset/rights, missing speech, wrong rate and clipped input fail closed", { skip: !enabled }, async (t) => {
  const { dir, beats, timeline, sfx } = await fixture(t);
  const out = (name) => ({ outputDir: join(dir, name), allowTestAssets: true });
  await assert.rejects(renderMasterAudio({ beats, timeline, sfx: [{ ...sfx[0], eventId: "missing" }] }, out("orphan")), /event/i);
  await assert.rejects(renderMasterAudio({ beats, timeline, sfx: [{ ...sfx[0], startSample: timeline.eventSamples["lifetime-total-reveal"] + 480 }] }, out("shifted")), /timing/i);
  await assert.rejects(renderMasterAudio({ beats, timeline, sfx: [{ ...sfx[0], assetRef: "unlicensed-file", licenseStatus: "unknown" }] }, out("rights")), /license|rights/i);
  await assert.rejects(renderMasterAudio({ beats, timeline, sfx }, { outputDir: join(dir, "no-test-permission") }), /test-only|permission/i);
  await assert.rejects(renderMasterAudio({ beats: [{ ...beats[0], wavPath: "/missing.wav" }, beats[1]], timeline, sfx }, out("missing-audio")), /missing|read|speech/i);
  const wrongRate = await fixture(t, { sampleRate: 16000 });
  await assert.rejects(renderMasterAudio({ beats: wrongRate.beats, timeline: wrongRate.timeline, sfx: wrongRate.sfx }, { outputDir: join(wrongRate.dir, "wrong"), allowTestAssets: true }), /48 kHz|sample.rate|format/i);
  const clipped = await fixture(t, { amplitude: 32767 });
  await assert.rejects(renderMasterAudio({ beats: clipped.beats, timeline: clipped.timeline, sfx: clipped.sfx }, { outputDir: join(clipped.dir, "clip"), allowTestAssets: true }), /clipp/i);
  const silent = await fixture(t, { amplitude: 0 });
  await assert.rejects(renderMasterAudio({ beats: silent.beats, timeline: silent.timeline, sfx: silent.sfx }, { outputDir: join(silent.dir, "silent"), allowTestAssets: true }), /silence|silent/i);
  const halfSilent = await fixture(t);
  const silentPayoffBytes = toneWav(48000, 0);
  await writeFile(halfSilent.beats[1].wavPath, silentPayoffBytes);
  halfSilent.beats[1].sha256 = sha256(silentPayoffBytes);
  await assert.rejects(renderMasterAudio({ beats: halfSilent.beats, timeline: halfSilent.timeline, sfx: halfSilent.sfx }, { outputDir: join(halfSilent.dir, "half-silent"), allowTestAssets: true }), /silence|silent/i);
});
