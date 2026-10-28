import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { loadProjectCharacterRigs, readCharacterZip } from "./character-rig-render.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const archive = id => readFile(new URL(`../../public/starter-characters/${id}.zip`, import.meta.url));
const projectId = "project-character-video-test";
function record(id, bytes, revision) {
  return { id: `character-draft-${id==="pip"?"a":"b"}`.padEnd(48,"0"), projectId, characterId:id,
    revision, archiveSha256:sha(bytes), sizeBytes:bytes.length, status:"unverified" };
}
function mockCatalog(drafts, archives) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({url:String(url),options});
    const path = new URL(url).pathname;
    if (path === "/api/character-drafts")
      return new Response(JSON.stringify({drafts}),{headers:{"content-type":"application/json"}});
    const id = /\/api\/character-drafts\/(character-draft-[a-f0-9]{32})\/archive/.exec(path)?.[1];
    if (!id || !archives.has(id)) return new Response("missing",{status:404});
    return new Response(archives.get(id),{headers:{"content-type":"application/zip"}});
  };
  return {fetchImpl,calls};
}
test("real starter ZIPs load as articulated raster definitions with exact image checksums",async()=>{
  for(const id of ["pip","quill"]){
    const bytes=await archive(id), parsed=readCharacterZip(bytes);
    assert.equal(parsed.definition.characterId,id);
    assert.equal(parsed.definition.mode,"puppet-2.5d");
    assert.ok(Object.keys(parsed.definition.assets).length>=7);
    assert.ok(parsed.definition.speech.approximateCycle.length>=2);
    for(const asset of Object.values(parsed.definition.assets)){
      assert.ok(parsed.entries.has(asset.uri));
      assert.equal(sha(parsed.entries.get(asset.uri).data),asset.sha256);
    }
  }
});
test("saved immutable Pip and Quill revisions become a project-owned render cast",async()=>{
  const pip=await archive("pip"),quill=await archive("quill");
  const first=record("pip",pip,readCharacterZip(pip).definition.revision);
  const second=record("quill",quill,readCharacterZip(quill).definition.revision);
  const mocks=mockCatalog([first,second],new Map([[first.id,pip],[second.id,quill]]));
  const selected=await loadProjectCharacterRigs({projectId,speakers:["pip","quill","narrator"],fetchImpl:mocks.fetchImpl});
  assert.deepEqual(Object.keys(selected.rigs),["pip","quill"]);
  assert.equal(selected.identity.length,2);
  assert.ok(selected.assets.length>=14);
  for(const id of ["pip","quill"]){
    const rig=selected.rigs[id];
    assert.equal(rig.definition.characterId,id);
    assert.equal(rig.definition.assets.head.kind,"image");
    assert.equal(rig.archiveSha256,sha(id==="pip"?pip:quill));
    for(const url of Object.values(rig.assetUrls))assert.match(url,/^\/__character_assets\/[a-f0-9]{64}\.png$/);
  }
  assert.equal(mocks.calls.length,3);
  assert.ok(mocks.calls.every(call=>new URL(call.url).hostname==="127.0.0.1"));
  assert.ok(mocks.calls.every(call=>call.options.cache==="no-store"));
});
test("missing custom rigs retain bundled fallback without fetching arbitrary character names",async()=>{
  const mock=mockCatalog([],new Map());
  const selected=await loadProjectCharacterRigs({projectId,speakers:["pip","unknown"],fetchImpl:mock.fetchImpl});
  assert.deepEqual(selected,{rigs:{},assets:[],identity:[]});
  assert.equal(mock.calls.length,1);
  const none=await loadProjectCharacterRigs({projectId,speakers:["unknown","narrator"],fetchImpl:()=>{throw Error("unexpected network");}});
  assert.deepEqual(none,{rigs:{},assets:[],identity:[]});
});
test("rejects wrong project, tampered archive, forged revision and unsafe backend",async()=>{
  const pip=await archive("pip"),rev=readCharacterZip(pip).definition.revision;
  const draft=record("pip",pip,rev);
  for(const altered of [{...draft,projectId:"other-project"},{...draft,revision:"forged"},{...draft,archiveSha256:"0".repeat(64)}]){
    const mock=mockCatalog([altered],new Map([[draft.id,pip]]));
    await assert.rejects(loadProjectCharacterRigs({projectId,speakers:["pip"],fetchImpl:mock.fetchImpl}),/Character rig export blocked/);
  }
  await assert.rejects(loadProjectCharacterRigs({projectId,speakers:["pip"],origin:"https://evil.example"}),/loopback/);
  const modified=Buffer.from(pip),parsed=readCharacterZip(modified);
  parsed.entries.get(Object.values(parsed.definition.assets)[0].uri).data[0]^=1;
  assert.throws(()=>readCharacterZip(modified),/checksum/);
});
test("no corrupt or missing saved rig silently falls back to bundled art",async()=>{
  const pip=await archive("pip"),draft=record("pip",pip,readCharacterZip(pip).definition.revision);
  const mock=mockCatalog([draft],new Map());
  await assert.rejects(loadProjectCharacterRigs({projectId,speakers:["pip"],fetchImpl:mock.fetchImpl}),/HTTP 404/);
});
