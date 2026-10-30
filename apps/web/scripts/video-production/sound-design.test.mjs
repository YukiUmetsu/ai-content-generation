import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,mkdir,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {setSoundDesign,resolveSoundDesign} from "./sound-design.mjs";
import {resolveAndBindApprovedSfx} from "./sfx-render-bindings.mjs";

const assetId="f0012345-1234-1234-1234-123456789abc";
const bundle={plan:{shots:[{id:"intro"},{id:"detail"}]}};
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
function wav(){const b=Buffer.alloc(44+4800*2);b.write("RIFF",0);b.writeUInt32LE(b.length-8,4);
  b.write("WAVEfmt ",8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);
  b.writeUInt32LE(48000,24);b.writeUInt32LE(96000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);
  b.write("data",36);b.writeUInt32LE(b.length-44,40);b.writeInt16LE(2000,44);return b;}
async function setup(t){const root=await mkdtemp(join(tmpdir(),"sound-design-"));
  t.after(()=>rm(root,{force:true,recursive:true}));
  const bytes=wav(),sha256=hash(bytes),dir=join(root,"bank","asset_"+"a".repeat(24));
  await mkdir(dir,{recursive:true});await writeFile(join(dir,"sfx.wav"),bytes);
  await writeFile(join(dir,"manifest.json"),JSON.stringify({schemaVersion:1,kind:"contentgen-approved-sfx",
    provider:"openverse",assetId,license:"cc0",rightsStatus:"user-reviewed",sha256,
    title:"Quiet wind",sizeBytes:bytes.length}));
  return {root,sha256,localPath:join(dir,"sfx.wav")};}
const cue=(sha256,overrides={})=>({action:"upsert",projectId:"p1",shotId:"intro",assetId,sha256,
  trigger:"shot-start",offsetMs:240,gainDb:-21,fadeInMs:80,fadeOutMs:140,...overrides});

test("multiple reviewed shot layers persist independently and can be edited or removed",async t=>{
  const {root,sha256,localPath}=await setup(t);
  const first=await setSoundDesign(cue(sha256),{root});
  const second=await setSoundDesign(cue(sha256,{shotId:"detail",offsetMs:0}),{root});
  assert.notEqual(first.layerId,second.layerId);
  let resolved=await resolveSoundDesign({projectId:"p1",bundle},{root});
  assert.equal(resolved.layers.length,2);
  assert.deepEqual(resolved.layers[0],{layerId:first.layerId,shotId:"intro",assetId,sha256,
    trigger:"shot-start",offsetMs:240,gainDb:-21,fadeInMs:80,fadeOutMs:140,
    title:"Quiet wind",license:"cc0",rightsStatus:"user-reviewed",localPath});
  await setSoundDesign(cue(sha256,{layerId:first.layerId,offsetMs:460,gainDb:-36}),{root});
  resolved=await resolveSoundDesign({projectId:"p1",bundle},{root});
  assert.equal(resolved.layers.length,2);
  assert.equal(resolved.layers[0].offsetMs,460);
  assert.equal(resolved.layers[0].gainDb,-36);
  await setSoundDesign({action:"remove",projectId:"p1",layerId:first.layerId},{root});
  assert.deepEqual((await resolveSoundDesign({projectId:"p1",bundle},{root})).layers.map(x=>x.layerId),[second.layerId]);
  assert.equal((await resolveSoundDesign({projectId:"p2",bundle},{root})).layers.length,0);
});

test("ambience is a separate optional reviewed loop with conservative gain",async t=>{
  const {root,sha256}=await setup(t);
  await setSoundDesign({action:"ambience",projectId:"p1",assetId,sha256,gainDb:-33,
    fadeInMs:1200,fadeOutMs:1800},{root});
  let resolved=await resolveSoundDesign({projectId:"p1",bundle},{root});
  assert.equal(resolved.ambience.gainDb,-33);
  assert.equal(resolved.ambience.assetId,assetId);
  await setSoundDesign({action:"ambience",projectId:"p1",assetId:null},{root});
  resolved=await resolveSoundDesign({projectId:"p1",bundle},{root});
  assert.equal(resolved.ambience,null);
});

test("reviewed music can become the video bed but cannot be added as a one-shot effect",async t=>{
  const {root,sha256}=await setup(t);
  const path=join(root,"bank","asset_"+"a".repeat(24),"manifest.json");
  const manifest=JSON.parse(await readFile(path,"utf8"));
  await writeFile(path,JSON.stringify({...manifest,assetType:"music"}));
  await assert.rejects(setSoundDesign(cue(sha256),{root}),/approved|missing|damaged/i);
  await setSoundDesign({action:"ambience",projectId:"p1",assetId,sha256,
    gainDb:-32,fadeInMs:1100,fadeOutMs:1500},{root});
  const sound=await resolveSoundDesign({projectId:"p1",bundle},{root});
  assert.equal(sound.ambience.title,"Quiet wind");
  assert.equal(sound.ambience.gainDb,-32);
});

test("new productions automatically choose relevant reviewed CC0 music with quiet narration-safe levels",async t=>{
  const {root,sha256,localPath}=await setup(t);
  const path=join(root,"bank","asset_"+"a".repeat(24),"manifest.json");
  const manifest=JSON.parse(await readFile(path,"utf8"));
  await writeFile(path,JSON.stringify({...manifest,assetType:"music",
    title:"Gentle instrumental ambient underscore",tags:["calm","background","instrumental"]}));
  const production={plan:{shots:[{id:"intro"}],story:{question:"Why do homeowners pay so much for their roof?"},
    sound:[{shotId:"intro",narration:"We examine the true cost of repairs."}]}};
  const music=await resolveSoundDesign({projectId:"new-video",bundle:production},{root});
  assert.equal(music.ambienceMode,"auto");
  assert.equal(music.ambience?.assetId,assetId);
  assert.equal(music.ambience?.sha256,sha256);
  assert.equal(music.ambience?.localPath,localPath);
  assert.equal(music.ambience?.gainDb,-34);
  await assert.rejects(readFile(join(root,"projects","new-video","sound-design.json")),/ENOENT/,
    "automatic direction should not overwrite or silently pin an editorial choice");
});

test("explicit music off, pinned music and return to automatic choice persist across storyboard regeneration",async t=>{
  const {root,sha256}=await setup(t);
  const path=join(root,"bank","asset_"+"a".repeat(24),"manifest.json");
  const manifest=JSON.parse(await readFile(path,"utf8"));
  await writeFile(path,JSON.stringify({...manifest,assetType:"music",title:"Quiet calm background music",tags:["ambient"]}));
  await setSoundDesign({action:"ambience",projectId:"p3",assetId:null},{root});
  assert.deepEqual({mode:(await resolveSoundDesign({projectId:"p3",bundle},{root})).ambienceMode,
    bed:(await resolveSoundDesign({projectId:"p3",bundle},{root})).ambience}, {mode:"off",bed:null});
  await setSoundDesign({action:"ambience",projectId:"p3",assetId,sha256,gainDb:-29,
    fadeInMs:800,fadeOutMs:900},{root});
  const pinned=await resolveSoundDesign({projectId:"p3",bundle},{root});
  assert.equal(pinned.ambienceMode,"pin");
  assert.equal(pinned.ambience.gainDb,-29);
  await setSoundDesign({action:"auto-ambience",projectId:"p3"},{root});
  const automatic=await resolveSoundDesign({projectId:"p3",bundle},{root});
  assert.equal(automatic.ambienceMode,"auto");
  assert.equal(automatic.ambience.assetId,assetId);
  assert.equal(automatic.ambience.gainDb,-34);
});

test("automatic CC0 music is bound to an actual render beat with verified bytes and authoring-safe defaults",async t=>{
  const {root,sha256,localPath}=await setup(t);
  const manifestPath=join(root,"bank","asset_"+"a".repeat(24),"manifest.json");
  const manifest=JSON.parse(await readFile(manifestPath,"utf8"));
  await writeFile(manifestPath,JSON.stringify({...manifest,assetType:"music",title:"Soft ambient instrumental",tags:["subtle","minimal"]}));
  const input={dossier:{id:"draft-video"},bundle:{researchId:"draft-video",plan:{shots:[{id:"intro"}],
    story:{question:"What does home insurance really cost?"},
    sound:[{shotId:"intro",narration:"An unexpected annual expense."}]}}};
  const compiled={job:{kind:"video-production-job",visualFamily:"general-explainer-v1",topic:{},
    beats:[{id:"beat-intro",eventIds:[]}],events:[],sounds:[]},
  shotMap:[{shotId:"intro",beatId:"beat-intro"}]};
  const {job,sfxSummary}=await resolveAndBindApprovedSfx(compiled,input,
    {resolve:async()=>[],resolveDesign:selection=>resolveSoundDesign(selection,{root})});
  assert.equal(sfxSummary.ambience,1);
  assert.deepEqual(job.sounds.map(({kind,assetRef,assetSha256,gainDb})=>({kind,assetRef,assetSha256,gainDb})),
    [{kind:"ambience",assetRef:localPath,assetSha256:sha256,gainDb:-34}]);
  assert.equal(job.events[0].beatId,"beat-intro");
  await setSoundDesign({action:"ambience",projectId:"draft-video",assetId:null},{root});
  const muted=await resolveAndBindApprovedSfx(compiled,input,
    {resolve:async()=>[],resolveDesign:selection=>resolveSoundDesign(selection,{root})});
  assert.deepEqual(muted.job.sounds,[],"explicit mute must never keep an earlier automatic music bed");
  assert.equal(muted.sfxSummary.ambience,undefined);
});

test("invalid rights, bad IDs, out-of-bounds envelope and full shot fail without touching saved data",async t=>{
  const {root,sha256,localPath}=await setup(t);
  const cases=[cue(sha256,{gainDb:3}),cue(sha256,{fadeOutMs:-2}),cue(sha256,{offsetMs:10001}),
    cue(sha256,{assetId:"invalid"}),cue("0".repeat(64)),cue(sha256,{shotId:"../evil"}),
    cue(sha256,{trigger:"timecode-from-model"})];
  for(const invalid of cases)await assert.rejects(setSoundDesign(invalid,{root}),/invalid|approved|bounded|hash|range|shot|sound/i);
  for(let n=0;n<4;n++)await setSoundDesign(cue(sha256,{offsetMs:n*200}),{root});
  await assert.rejects(setSoundDesign(cue(sha256),{root}),/limit|four|maximum/i);
  await writeFile(localPath,"corrupted approved audio");
  await assert.rejects(resolveSoundDesign({projectId:"p1",bundle},{root}),/missing|damaged|revoked|approved/i);
  const saved=JSON.parse(await readFile(join(root,"projects","p1","sound-design.json"),"utf8"));
  assert.equal(saved.layers.length,4,"rejected writes cannot alter the stored design");
});

test("a saved clip referring to a shot removed from the current storyboard blocks reuse",async t=>{
  const {root,sha256}=await setup(t);
  await setSoundDesign(cue(sha256,{shotId:"detail"}),{root});
  await assert.rejects(resolveSoundDesign({projectId:"p1",bundle:{plan:{shots:[{id:"intro"}]}}},{root}),
    /unknown|shot|storyboard/i);
});
