import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {planSfxNeeds,discoverSfx,recommendApprovedSfx,approveSfx,listApprovedSfx,
  setSceneSfxChoice,resolveSceneSfxChoices,exportSfxForTimeline} from "./sfx-discovery.mjs";

const bundle={plan:{shots:[
  {id:"shot-roof",visualChange:"The roof tiles slide under a storm"},
  {id:"shot-cost",visualChange:"A bar chart reveals costs"},
  {id:"shot-break",visualChange:"Calm pause"}],
  sound:[{shotId:"shot-roof",sfxIntent:"Soft wind gust"},
    {shotId:"shot-cost",sfxIntent:"Subtle whoosh reveal"},
    {shotId:"shot-break",sfxIntent:null}]}};
const sound=(id,title,license="cc0",source="wikimedia")=>({
  id,title,license,license_version:"1.0",creator:"Sound Creator",
  foreign_landing_url:`https://commons.wikimedia.org/wiki/File:${id}.ogg`,
  url:`https://upload.wikimedia.org/wikipedia/commons/${id}.ogg`,
  duration:2200,category:"sound_effect",source,
  tags:[{name:"wind"},{name:"gust"}]});
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});

test("sparse SFX intent plans explicit scene cues and leaves silent beats alone",()=>{
  const cues=planSfxNeeds(bundle);
  assert.deepEqual(cues.map(x=>({shotId:x.shotId,query:x.query})),[
    {shotId:"shot-roof",query:"wind gust"},{shotId:"shot-cost",query:"whoosh"}]);
  assert.deepEqual(planSfxNeeds({plan:{shots:bundle.plan.shots,sound:[]}}),[]);
});

test("external Openverse search requires user action and accepts only commercial CC0 sound effects",async()=>{
  const calls=[];
  const fetchImpl=async url=>{calls.push(String(url));return json({results:[
    sound("6e4e06ce-cab2-4871-a8c2-123456789abc","Soft wind gust"),
    sound("f12bc580-d270-4073-ae3f-123456789abc","Wind gust noncommercial","by-nc"),
    {...sound("21fd1da4-4dcb-4c21-8433-123456789abc","Ocean music"),category:"music"}]});};
  await assert.rejects(discoverSfx({bundle,allowExternalSearch:false},{fetchImpl}),/approval|permission/i);
  assert.equal(calls.length,0);
  const result=await discoverSfx({bundle,allowExternalSearch:true},{fetchImpl});
  assert.equal(result.scenes.length,2);
  assert.equal(result.scenes[0].candidates.length,1);
  assert.equal(result.scenes[0].candidates[0].assetId,"6e4e06ce-cab2-4871-a8c2-123456789abc");
  assert.equal(result.scenes[0].candidates[0].rightsStatus,"needs-human-review");
  assert.equal(result.scenes[0].candidates[0].durationSeconds,2.2,
    "Openverse audio duration is milliseconds, not seconds");
  assert.ok(calls.every(x=>x.startsWith("https://api.openverse.org/v1/audio/?")&&
    x.includes("license=cc0")&&x.includes("category=sound_effect")));
  assert.ok(calls.length<=2,"no per-result download or extra provider call");
});

test("Openverse CC0 Freesound preview paths are supported without accepting arbitrary Freesound endpoints",async()=>{
  const id="d1d5d79a-3db0-4f36-9ce3-1081af7feabc";
  const valid={...sound(id,"Subtle wind noise"),url:"https://freesound.org/data/previews/415/415362_6044691-hq.mp3",
    foreign_landing_url:"https://freesound.org/people/creator/sounds/415362/"};
  const fetchImpl=async()=>json({results:[valid,{...valid,id:"8a3a65f3-6721-4398-adf1-a209d0e52c41",
    url:"https://freesound.org/apiv2/private/secret"}]});
  const result=await discoverSfx({bundle,allowExternalSearch:true},{fetchImpl});
  assert.equal(result.scenes[0].candidates.length,1);
  assert.equal(result.scenes[0].candidates[0].previewUrl,valid.url);
});

test("approved library automatically suggests matching sounds, never weak or unapproved files",()=>{
  const approved=[{assetId:"wind-id",title:"Soft wind gust outdoors",tags:["wind","gust"],license:"cc0",rightsStatus:"user-reviewed",sha256:"a".repeat(64),localPath:"/tmp/wind.wav"},
    {assetId:"music-id",title:"Classical cello",tags:["music"],license:"cc0",rightsStatus:"user-reviewed",sha256:"b".repeat(64),localPath:"/tmp/music.wav"},
    {assetId:"unapproved",title:"Subtle whoosh reveal",tags:["whoosh"],license:"by-nc",rightsStatus:"unverified",sha256:"c".repeat(64),localPath:"/tmp/bad.wav"}];
  const recommendations=recommendApprovedSfx(bundle,approved);
  assert.equal(recommendations.find(x=>x.shotId==="shot-roof").assetId,"wind-id");
  assert.equal(recommendations.find(x=>x.shotId==="shot-cost").assetId,null);
  assert.equal(recommendations.find(x=>x.shotId==="shot-break"),undefined);
});

test("SFX discovery searches a bounded number of cues concurrently",async()=>{
  let active=0,maxActive=0,calls=0;
  const many={plan:{shots:Array.from({length:12},(_,i)=>({id:`shot_${i}`})),
    sound:Array.from({length:12},(_,i)=>({shotId:`shot_${i}`,sfxIntent:`effect${i} impact`}))}};
  const fetchImpl=async()=>{
    calls++;active++;maxActive=Math.max(maxActive,active);
    await new Promise(resolve=>setTimeout(resolve,5));active--;
    return json({results:[]});
  };
  await discoverSfx({bundle:many,allowExternalSearch:true},{fetchImpl});
  assert.equal(calls,12);
  assert.ok(maxActive>=2&&maxActive<=3,"search must be bounded but not serial");
});

const soundId="6e4e06ce-cab2-4871-a8c2-123456789abc";
function wav(){
  const bytes=Buffer.alloc(44+480*2);bytes.write("RIFF",0);bytes.writeUInt32LE(bytes.length-8,4);
  bytes.write("WAVEfmt ",8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);
  bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(48000,24);bytes.writeUInt32LE(96000,28);
  bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write("data",36);
  bytes.writeUInt32LE(960,40);bytes.writeInt16LE(3000,44);return bytes;
}
const approval={assetId:soundId,confirmDownload:true,confirmRights:true};
async function imported(t){
  const root=await mkdtemp(join(tmpdir(),"contentgen-sfx-test-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url:String(url),options});
    if(String(url)===`https://api.openverse.org/v1/audio/${soundId}/`)
      return json(sound(soundId,"Wind gust"));
    if(String(url)===`https://upload.wikimedia.org/wikipedia/commons/${soundId}.ogg`)
      return new Response(Buffer.from("OggS-example-bytes"));
    throw Error("unexpected external URL: "+url);
  };
  const transcode=async(_input,output)=>{await writeFile(output,wav());};
  return {root,calls,fetchImpl,transcode};
}

test("first download requires review, re-resolves a CC0 source and stores verified reusable WAV",async t=>{
  const opts=await imported(t);
  await assert.rejects(approveSfx({...approval,confirmRights:false},opts),/approval|review/i);
  assert.equal(opts.calls.length,0);
  const saved=await approveSfx({...approval,url:"http://127.0.0.1/private"},opts);
  assert.equal(saved.license,"cc0");
  assert.equal(saved.rightsStatus,"user-reviewed");
  assert.equal(saved.sourceUrl,`https://commons.wikimedia.org/wiki/File:${soundId}.ogg`);
  assert.match(saved.sha256,/^[a-f0-9]{64}$/);
  assert.equal((await readFile(saved.localPath)).toString("ascii",0,4),"RIFF");
  assert.deepEqual(opts.calls.map(x=>x.url),[
    `https://api.openverse.org/v1/audio/${soundId}/`,
    `https://upload.wikimedia.org/wikipedia/commons/${soundId}.ogg`]);
  assert.ok(opts.calls.every(x=>x.options.redirect==="error"));
  assert.equal((await listApprovedSfx({root:opts.root})).length,1);
  await writeFile(saved.localPath,"tampered waveform");
  assert.equal((await listApprovedSfx({root:opts.root})).length,0);
  await assert.rejects(approveSfx(approval,opts),/conflict|damaged|invalid|tamper/i,
    "a repeated approval cannot claim a tampered existing import succeeded");
});

test("real FFmpeg conversion accepts standard ancillary WAV chunks without losing PCM verification",async t=>{
  const root=await mkdtemp(join(tmpdir(),"contentgen-sfx-ffmpeg-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const fetchImpl=async url=>String(url).includes("/v1/audio/")?json(sound(soundId,"Wind gust")):
    new Response(wav());
  const saved=await approveSfx(approval,{root,fetchImpl});
  assert.equal(saved.sizeBytes>44,true);
  assert.equal((await listApprovedSfx({root})).length,1);
});

test("disallowed hosts, license changes and redirects never create an approved sound",async t=>{
  const opts=await imported(t);
  for(const mutated of [
    {...sound(soundId,"wind"),license:"by-nc"},
    {...sound(soundId,"wind"),url:"https://127.0.0.1/private"},
    {...sound(soundId,"wind"),url:"https://evil.test/song.mp3"}]){
    let downloads=0;
    const fetchImpl=async url=>{
      if(String(url).includes("/v1/audio/"))return json(mutated);
      downloads++;return new Response("fake");};
    await assert.rejects(approveSfx(approval,{...opts,fetchImpl}),/license|CC0|host|trusted/i);
    assert.equal(downloads,0);
  }
  const redirect=async url=>String(url).includes("/v1/audio/")?json(sound(soundId,"wind")):
    new Response(null,{status:302,headers:{location:"https://evil.test/track.ogg"}});
  await assert.rejects(approveSfx(approval,{...opts,fetchImpl:redirect}),/HTTP|redirect|download/i);
  assert.deepEqual(await listApprovedSfx({root:opts.root}),[]);
});

test("automatic reuse, user pins and mute remain persistent and never use damaged files",async t=>{
  const opts=await imported(t);
  const saved=await approveSfx(approval,opts);
  const input={projectId:"house-project",bundle};
  const before=await resolveSceneSfxChoices(input,{root:opts.root});
  assert.equal(before.find(x=>x.shotId==="shot-roof").assetId,soundId);
  await setSceneSfxChoice({projectId:"house-project",shotId:"shot-roof",mode:"mute"},{root:opts.root});
  const muted=await resolveSceneSfxChoices(input,{root:opts.root});
  assert.equal(muted.find(x=>x.shotId==="shot-roof").assetId,null);
  assert.equal(muted.find(x=>x.shotId==="shot-roof").mode,"mute");
  await setSceneSfxChoice({projectId:"house-project",shotId:"shot-roof",mode:"pin",
    assetId:soundId,sha256:saved.sha256},{root:opts.root});
  const pinned=await resolveSceneSfxChoices(input,{root:opts.root});
  assert.equal(pinned.find(x=>x.shotId==="shot-roof").mode,"pin");
  assert.equal(pinned.find(x=>x.shotId==="shot-roof").assetId,soundId);
  assert.deepEqual(exportSfxForTimeline({sceneChoices:pinned,eventIdByShot:{"shot-roof":"roof-hit"},
    timeline:{eventSamples:{"roof-hit":48000}}}).map(x=>({id:x.id,eventId:x.eventId,
      assetPath:x.assetPath,licenseStatus:x.licenseStatus})),[
    {id:"sfx-shot-roof",eventId:"roof-hit",assetPath:saved.localPath,licenseStatus:"verified"}]);
  assert.equal(exportSfxForTimeline({sceneChoices:pinned,eventIdByShot:{},timeline:{eventSamples:{}}}).length,0);
  await writeFile(saved.localPath,"corrupt");
  const damaged=await resolveSceneSfxChoices(input,{root:opts.root});
  assert.equal(damaged.find(x=>x.shotId==="shot-roof").assetId,null);
  assert.match(damaged.find(x=>x.shotId==="shot-roof").reason,/missing|damaged/i);
  await setSceneSfxChoice({projectId:"house-project",shotId:"shot-roof",mode:"auto"},{root:opts.root});
  assert.equal((await resolveSceneSfxChoices(input,{root:opts.root})).find(x=>x.shotId==="shot-roof").assetId,null);
});

test("cannot pin unapproved sounds or use unsafe project and shot IDs",async t=>{
  const opts=await imported(t);
  await assert.rejects(setSceneSfxChoice({projectId:"../escape",shotId:"shot-roof",mode:"mute"},
    {root:opts.root}),/identifier|invalid/i);
  await assert.rejects(setSceneSfxChoice({projectId:"house-project",shotId:"../../escape",mode:"mute"},
    {root:opts.root}),/identifier|invalid/i);
  await assert.rejects(setSceneSfxChoice({projectId:"house-project",shotId:"shot-roof",mode:"pin",
    assetId:soundId,sha256:"a".repeat(64)},{root:opts.root}),/approved|verified/i);
});
