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

test("Pexels API approval is disabled and website files require a same-origin binary upload",async()=>{
  const approvals=[];
  const deps={importJob:async(input,{importer})=>importer(input,{}),
    approve:async()=>{throw Error("retired Pexels API must not be called");},
    importDownloaded:async(input,bytes)=>{approvals.push({input,bytes});return {provider:"pexels",sha256:"a".repeat(64)};}};
  assert.equal((await invoke("POST","/approve",{provider:"pexels",confirmRights:true,confirmDownload:true},deps)).status,422);
  const page="https://www.pexels.com/photo/forest-12345/";
  const url="/import-downloaded?"+new URLSearchParams({projectId:"project-1",shotId:"shot-house",
    sourceUrl:page,assetType:"photo",creator:"Author",confirmRights:"yes"});
  async function upload(headers={}){
    const bytes=Buffer.from("Pexels example bytes");
    const req=Readable.from([bytes]);
    Object.assign(req,{method:"POST",url,headers:{host:"127.0.0.1:5173",origin:"http://127.0.0.1:5173",
      "x-contentgen-director":"local-only","content-type":"application/octet-stream",...headers}});
    let status,result;const res={writeHead(code){status=code;},end(data){result=JSON.parse(data);}};
    await handleAssetDiscoveryRequest(req,res,deps);
    return {status,result};
  }
  assert.equal((await upload({origin:"https://evil.example"})).status,403);
  assert.equal((await upload({"content-type":"application/json"})).status,422);
  assert.equal(approvals.length,0);
  assert.equal((await upload()).status,200);
  assert.equal(approvals[0].input.sourceUrl,page);
  assert.equal(approvals[0].bytes.toString(),"Pexels example bytes");
});

test("single-photo Pexels page import requires an explicit same-origin action",async()=>{
  const inputs=[];
  const deps={importJob:async(input,{importer})=>importer(input,{}),
    importFromPage:async input=>{inputs.push(input);return {assetId:"123",provider:"pexels"};}};
  const data={projectId:"project-1",shotId:"scene-1",assetType:"photo",confirmRights:true,
    sourceUrl:"https://www.pexels.com/photo/forest-123/"};
  assert.equal((await invoke("POST","/import-from-page",data,deps,
    {origin:"https://other.example"})).status,403);
  assert.equal((await invoke("POST","/import-from-page",{...data,confirmRights:false},deps)).status,422);
  assert.equal(inputs.length,0);
  assert.deepEqual((await invoke("POST","/import-from-page",data,deps)).result,{assetId:"123",provider:"pexels"});
  assert.deepEqual(inputs,[data]);
});
