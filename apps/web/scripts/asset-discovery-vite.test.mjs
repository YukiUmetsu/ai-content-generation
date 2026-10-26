import test from "node:test";
import assert from "node:assert/strict";
import {Readable} from "node:stream";
import {handleAssetDiscoveryRequest} from "./asset-discovery-vite.mjs";

async function invoke(method,url,payload,deps={},headers={}){
  const req=Readable.from(payload===undefined?[]:[Buffer.from(JSON.stringify(payload))]);
  Object.assign(req,{method,url,headers:{host:"127.0.0.1:5173",
    ...(method==="POST"?{origin:"http://127.0.0.1:5173","x-contentgen-director":"local-only"}:{}),
    ...headers}});
  let status,result;
  const res={writeHead(value){status=value;},end(text){result=JSON.parse(text);}};
  await handleAssetDiscoveryRequest(req,res,deps);
  return {status,result};
}

test("local asset API cannot search or download before a user-approved action",async()=>{
  let searched=0,downloaded=0;
  const deps={search:async data=>{searched++;assert.equal(data.allowExternalSearch,true);return {scenes:[]};},
    approve:async()=>{downloaded++;return {approved:true};}};
  assert.equal((await invoke("POST","/suggest",{bundle:{plan:{shots:[]}}},deps)).status,422);
  assert.equal(searched,0);
  assert.equal((await invoke("POST","/suggest",{allowExternalSearch:true,bundle:{}},deps,
    {origin:"http://another-host"})).status,403);
  assert.equal((await invoke("POST","/suggest",{allowExternalSearch:true,bundle:{}},deps)).status,200);
  assert.equal(searched,1);
  assert.equal(downloaded,0);
  assert.equal((await invoke("POST","/approve",{confirmDownload:false,confirmRights:true},deps)).status,422);
  assert.equal(downloaded,0);
  assert.equal((await invoke("POST","/approve",{confirmDownload:true,confirmRights:true},deps)).status,200);
  assert.equal(downloaded,1);
});

test("local asset API lists project approvals, not arbitrary filesystem paths",async()=>{
  const deps={list:async request=>{assert.equal(request.projectId,"project-1");return [{assetId:"asset-a"}];}};
  assert.deepEqual((await invoke("GET","/approved?projectId=project-1",undefined,deps)),
    {status:200,result:{assets:[{assetId:"asset-a"}]}});
  assert.equal((await invoke("GET","/approved?projectId=../../secrets",undefined,deps)).status,422);
});

test("local asset API binds and clears a verified scene asset only through same-origin actions",async()=>{
  const called=[];
  const deps={selected:async ({projectId})=>({selections:[{projectId,shotId:"shot-a",sha256:"a".repeat(64)}],invalidShots:[]}),
    select:async input=>{called.push(["select",input]);return {shotId:input.shotId,sha256:input.sha256};},
    clear:async input=>{called.push(["clear",input]);return {cleared:true};}};
  const ref={projectId:"p1",shotId:"shot-a",provider:"pexels",assetId:"83",sha256:"a".repeat(64)};
  assert.equal((await invoke("GET","/selected?projectId=p1",undefined,deps)).result.selections[0].shotId,"shot-a");
  assert.equal((await invoke("POST","/select",ref,deps,{origin:"http://localhost:5173"})).status,403);
  assert.equal(called.length,0);
  assert.deepEqual((await invoke("POST","/select",ref,deps)).result,{shotId:"shot-a",sha256:"a".repeat(64)});
  assert.deepEqual((await invoke("POST","/clear",{projectId:"p1",shotId:"shot-a"},deps)).result,{cleared:true});
  assert.deepEqual(called.map(([action])=>action),["select","clear"]);
  assert.equal((await invoke("GET","/selected?projectId=../../etc",undefined,deps)).status,422);
});
