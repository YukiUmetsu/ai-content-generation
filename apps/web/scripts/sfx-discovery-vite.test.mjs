import test from "node:test";
import assert from "node:assert/strict";
import {Readable} from "node:stream";
import {createHash} from "node:crypto";
import {handleSfxDiscoveryRequest} from "./sfx-discovery-vite.mjs";

async function request(method,url,data,deps={},headers={}){
  const req=Readable.from(data===undefined?[]:[Buffer.from(JSON.stringify(data))]);
  Object.assign(req,{method,url,headers:{host:"127.0.0.1:5173",
    ...(method==="POST"?{origin:"http://127.0.0.1:5173","x-contentgen-director":"local-only"}:{}),
    ...headers}});
  let status,answer;
  const res={writeHead(code){status=code;},end(data){answer=data?JSON.parse(data):null;}};
  await handleSfxDiscoveryRequest(req,res,deps);
  return {status,answer};
}

test("sound API blocks cross-site access and denies unapproved network or download",async()=>{
  let searches=0,downloads=0;
  const deps={search:async()=>{searches++;return {scenes:[]};},
    approve:async()=>{downloads++;return {approved:true};}};
  assert.equal((await request("POST","/suggest",{allowExternalSearch:false},deps)).status,422);
  assert.equal((await request("POST","/suggest",{allowExternalSearch:true},deps,{origin:"http://evil.test"})).status,403);
  assert.equal(searches,0);
  assert.equal((await request("POST","/suggest",{allowExternalSearch:true},deps)).status,200);
  assert.equal(searches,1);
  assert.equal((await request("POST","/approve",{confirmRights:false,confirmDownload:true},deps)).status,422);
  assert.equal(downloads,0);
  assert.equal((await request("POST","/approve",{confirmRights:true,confirmDownload:true},deps)).status,200);
  assert.equal(downloads,1);
});

test("library, plan, and per-shot override endpoints are restricted to local Studio",async()=>{
  const deps={list:async()=>[{assetId:"sound"}],
    resolve:async ({projectId})=>[{projectId,shotId:"shot-one",mode:"auto"}],
    choice:async input=>({projectId:input.projectId,mode:input.mode})};
  assert.deepEqual((await request("GET","/library",undefined,deps)).answer.assets,[{assetId:"sound"}]);
  assert.equal((await request("GET","/library",undefined,deps,{host:"evil.test"})).status,403);
  assert.equal((await request("POST","/choices",{projectId:"../escape",bundle:{}},deps)).status,422);
  assert.equal((await request("POST","/choices",{projectId:"prj1",bundle:{}},deps)).answer.scenes[0].shotId,"shot-one");
  assert.equal((await request("POST","/set-choice",{projectId:"prj1",shotId:"s1",mode:"mute"},deps)).answer.mode,"mute");
});

test("supplementary sound-design edits require same-origin action and never accept local paths",async()=>{
  let reads=0,writes=0;
  const deps={soundDesignRead:async ({projectId})=>{reads++;return {projectId,
    layers:[{layerId:"layer1",localPath:"/private/approved/impact.wav",assetId:"approved",title:"Impact"}],
    ambience:{assetId:"amb",localPath:"/private/approved/rain.wav",title:"Rain"}};},
    soundDesignWrite:async ({projectId,action})=>{writes++;return {projectId,action};}};
  const payload={projectId:"p1",action:"upsert",shotId:"intro",assetId:"approved",sha256:"b".repeat(64)};
  const read=await request("POST","/sound-design",{projectId:"p1",action:"resolve",bundle:{}},deps);
  assert.equal(read.status,200);
  assert.equal(read.answer.layers[0].title,"Impact");
  assert.equal(read.answer.ambience.title,"Rain");
  assert.equal(JSON.stringify(read.answer).includes("/private/approved"),false,
    "editor API returns approved cue metadata, never local audio filesystem paths");
  assert.equal(reads,1);
  assert.equal((await request("POST","/sound-design",payload,deps,{origin:"http://evil.test"})).status,403);
  assert.equal((await request("POST","/sound-design",{...payload,localPath:"/etc/passwd"},deps)).status,422);
  assert.equal((await request("POST","/sound-design",{...payload,projectId:"../escape"},deps)).status,422);
  assert.equal((await request("POST","/sound-design",payload,deps)).answer.action,"upsert");
  assert.equal(writes,1,"invalid writes never reach persistence");
});

test("sound previews are served only from hash-verified approved bank items",async()=>{
  const bytes=Buffer.from("RIFF-audition"),digest=createHash("sha256").update(bytes).digest("hex");
  const item={sha256:digest,localPath:"/approved/sfx.wav"};
  const invoke=async (url,host="127.0.0.1:5173")=>{
    const req=Readable.from([]);Object.assign(req,{method:"GET",url,headers:{host}});
    let status,body,headers;
    const res={writeHead(code,h){status=code;headers=h;},end(value){body=value;}};
    await handleSfxDiscoveryRequest(req,res,{list:async()=>[item],readAudio:async path=>{
      assert.equal(path,item.localPath);return bytes;}});
    return {status,headers,body};
  };
  const accepted=await invoke(`/preview/${digest}`);
  assert.equal(accepted.status,200);
  assert.equal(accepted.headers["Content-Type"],"audio/wav");
  assert.deepEqual(accepted.body,bytes);
  assert.equal((await invoke("/preview/../secrets")).status,404);
  assert.equal((await invoke(`/preview/${"b".repeat(64)}`)).status,404);
  assert.equal((await invoke(`/preview/${digest}`,"evil.test")).status,403);
});
