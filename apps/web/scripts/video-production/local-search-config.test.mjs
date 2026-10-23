import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseLocalSearchConfig, ensureLocalSearchConfig, chooseLocalPort,
  configuredSearchEndpoint } from "./local-search-config.mjs";
import { validateResearchModelSettings, saveResearchModelSettings,
  readResearchModelSettings, readResearchModelSettingsSync,
  discoverResearchModels, modelsEndpoint } from "./research-model-settings.mjs";

test("stable random high port is captured once and used for source search", async t => {
  const root=await mkdtemp(join(tmpdir(), "contentgen-port-"));
  t.after(() => rm(root,{recursive:true,force:true}));
  const path=join(root,".env");
  const random=()=>Buffer.alloc(32,42);
  let picks=0;
  const first=await ensureLocalSearchConfig({ file:path, random, pickPort:async()=>{picks++;return 49273;} });
  assert.equal(first.port,49273);
  assert.equal(first.endpoint,"http://127.0.0.1:49273/search");
  assert.equal(first.created,true);
  assert.equal((await stat(path)).mode & 0o077,0);
  const text=await readFile(path,"utf8");
  assert.match(text,/^SEARXNG_SECRET=[a-f0-9]{64}\nSEARXNG_PORT=49273\n$/u);
  assert.equal(parseLocalSearchConfig(text).port,49273);
  assert.equal(configuredSearchEndpoint(path),first.endpoint);
  const second=await ensureLocalSearchConfig({file:path,random:()=>{throw Error("no more random");},pickPort:async()=>{throw Error("no second pick");}});
  assert.equal(second.created,false);
  assert.equal(second.port,49273);
  assert.equal(picks,1);
});

test("legacy secret-only config upgrades without changing the secret", async t => {
  const root=await mkdtemp(join(tmpdir(),"contentgen-upgrade-"));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=join(root,".env"),secret="f".repeat(64);
  await writeFile(file,"SEARXNG_SECRET="+secret+"\n");
  const cfg=await ensureLocalSearchConfig({file,pickPort:async()=>57892});
  assert.equal(cfg.port,57892);
  assert.match(await readFile(file,"utf8"),new RegExp("^SEARXNG_SECRET="+secret+"\\nSEARXNG_PORT=57892\\n$"));
});
test("invalid port/config is refused and occupied random candidates are skipped", async () => {
  for(const value of ["SEARXNG_SECRET="+"0".repeat(64)+"\nSEARXNG_PORT=8080\n",
    "SEARXNG_SECRET="+"0".repeat(64)+"\nSEARXNG_PORT=99999\n",
    "SEARXNG_SECRET="+"0".repeat(64)+"\nSEARXNG_PORT=40000\nEVIL=1\n"])
    assert.throws(()=>parseLocalSearchConfig(value));
  let draws=0;
  const port=await chooseLocalPort({random:()=>++draws===1?49403:51023,available:async p=>p===51023});
  assert.equal(port,51023);
  assert.equal(draws,2);
});

test("research model settings are strictly local and shared on disk with CLI",async t=>{
  const root=await mkdtemp(join(tmpdir(),"contentgen-local-model-"));t.after(()=>rm(root,{recursive:true,force:true}));
  const path=join(root,"research-model.json");
  assert.equal(await readResearchModelSettings(path),null);
  const value={version:1,endpoint:"http://127.0.0.1:11434/v1/chat/completions",model:"qwen3:8b"};
  const saved=await saveResearchModelSettings(value,path);
  assert.deepEqual(saved,value);
  assert.deepEqual(readResearchModelSettingsSync(path),value);
  assert.deepEqual(await readResearchModelSettings(path),value);
  assert.equal((await stat(path)).mode&0o077,0);
  for(const endpoint of ["https://api.openai.com/v1/chat/completions",
    "http://example.com:11434/v1/chat/completions",
    "http://127.0.0.1:11434/private","http://127.0.0.1:11434/v1/chat/completions?token=x"])
    assert.throws(()=>validateResearchModelSettings({...value,endpoint}),/loopback/);
  assert.throws(()=>validateResearchModelSettings({...value,apiKey:"secret"}),/Expected/);
  assert.throws(()=>validateResearchModelSettings({...value,model:""}),/Choose/);
  assert.equal(modelsEndpoint(value.endpoint),"http://127.0.0.1:11434/v1/models");
});
test("model discovery never sends text or external requests and bounds response",async()=>{
  const result=await discoverResearchModels("http://127.0.0.1:1234/v1/chat/completions",{
    transport:async (url,opts)=>{
      assert.equal(url,"http://127.0.0.1:1234/v1/models");
      assert.equal(opts.redirect,"error");
      assert.equal(opts.method,undefined);
      return new Response(JSON.stringify({data:[{id:"local-a"},{id:"local-b"},{id:"local-a"}]}),{status:200});
    }
  });
  assert.deepEqual(result,["local-a","local-b"]);
  await assert.rejects(discoverResearchModels("https://remote.example.com/v1/chat/completions",
    {transport:async()=>{throw Error("remote called");}}),/loopback/);
  await assert.rejects(discoverResearchModels("http://127.0.0.1:11434/v1/chat/completions",
    {transport:async()=>new Response("bad",{status:500})}),/HTTP 500/);
});
