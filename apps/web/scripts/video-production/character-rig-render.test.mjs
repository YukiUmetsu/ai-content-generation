import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { assertCharacterRasterIntegrity, characterRasterPreflightList, loadProjectCharacterRigs, readCharacterZip } from "./character-rig-render.mjs";

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

// The starter ZIP stores character.json without compression. Change only its
// manifest and both ZIP CRCs, so archive/hash integrity passes and the saved
// animation itself is what the production preflight must reject.
function mutateSavedAnimation(bytes, before, after) {
  assert.equal(Buffer.byteLength(before),Buffer.byteLength(after));
  const modified=Buffer.from(bytes);
  assert.equal(modified.readUInt32LE(0),0x04034b50);
  assert.equal(modified.readUInt16LE(8),0,"fixture's manifest must be stored");
  const start=30+modified.readUInt16LE(26)+modified.readUInt16LE(28);
  const length=modified.readUInt32LE(22);
  const original=modified.toString("utf8",start,start+length);
  assert.ok(original.includes(before),"expected fixture animation field");
  const changed=Buffer.from(original.replace(before,after));
  assert.equal(changed.length,length);
  changed.copy(modified,start);
  let crc=0xffffffff;
  for(const byte of changed){
    crc^=byte;
    for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  crc=(crc^0xffffffff)>>>0;
  modified.writeUInt32LE(crc,14);
  const eocd=modified.length-22;
  assert.equal(modified.readUInt32LE(eocd),0x06054b50);
  const central=modified.readUInt32LE(eocd+16);
  assert.equal(modified.readUInt32LE(central),0x02014b50);
  modified.writeUInt32LE(crc,central+16);
  return modified;
}

test("preflight rejects invalid saved animation references before narration or browser rendering",async()=>{
  const original=await archive("pip");
  const corruptions=[
    ["\"parts\": [\n      \"eyes\"", "\"parts\": [\n      \"arms\"", /blink|part|variant/i],
    ["\"right-arm\": {\n              \"rotation\"", "\"ghost-arm\": {\n              \"rotation\"", /action|part|pose/i],
    ["\"head\": {\n            \"rotation\"", "\"fake\": {\n            \"rotation\"", /expression|part|pose/i],
  ];
  for(const [before,after,diagnostic] of corruptions){
    // A correct SHA, CRC and image payload must not legitimize bad animation.
    const altered=mutateSavedAnimation(original,before,after);
    const parsed=readCharacterZip(altered);
    assert.equal(parsed.entries.size,readCharacterZip(original).entries.size);
    const draft=record("pip",altered,parsed.definition.revision);
    const mock=mockCatalog([draft],new Map([[draft.id,altered]]));
    await assert.rejects(loadProjectCharacterRigs({projectId,speakers:["pip"],fetchImpl:mock.fetchImpl}),
      diagnostic,"invalid saved rig must fail at the worker boundary");
  }
});

test("preflight preserves supported Kumiki hold phases in saved custom animation",async()=>{
  const original=await archive("pip");
  const modified=mutateSavedAnimation(original,
    '"name": "act",\n          "frames"',
    '"name": "hold",\n         "frames"');
  const draft=record("pip",modified,readCharacterZip(modified).definition.revision);
  const mock=mockCatalog([draft],new Map([[draft.id,modified]]));
  const resolved=await loadProjectCharacterRigs({projectId,speakers:["pip"],fetchImpl:mock.fetchImpl});
  assert.equal(resolved.rigs.pip.definition.actions["pip-explain"].phases[1].name,"hold");
});
test("real starter ZIPs load as articulated raster definitions with exact image checksums",async()=>{
  for(const id of ["pip","quill"]){
    const bytes=await archive(id), parsed=readCharacterZip(bytes);
    assert.equal(parsed.definition.characterId,id);
    assert.equal(parsed.definition.mode,"puppet-2.5d");
    assert.ok(Object.keys(parsed.definition.assets).length>=7);
    assert.ok(parsed.definition.speech.approximateCycle.length>=2);
    for(const asset of Object.values(parsed.definition.assets)){
      assert.ok(parsed.entries.has(asset.uri.toLowerCase()));
      assert.equal(sha(parsed.entries.get(asset.uri.toLowerCase()).data),asset.sha256);
    }
  }
});
test("raster preflight decodes checked PNG rows, rejecting damaged image data even if ZIP metadata is valid",async()=>{
  const bytes=await archive("pip"),parsed=readCharacterZip(bytes);
  const image=Object.values(parsed.definition.assets).find(item=>item.mediaType==="image/png");
  const valid=parsed.entries.get(image.uri.toLowerCase()).data;
  assert.doesNotThrow(()=>assertCharacterRasterIntegrity(valid,image));
  const truncated=valid.subarray(0,valid.length-12);
  assert.throws(()=>assertCharacterRasterIntegrity(truncated,image),/PNG|image/i);
  const damaged=Buffer.from(valid);
  const idat=damaged.indexOf(Buffer.from("IDAT"));
  assert.ok(idat>0,"starter image contains IDAT data");
  damaged[idat+6]^=1;
  assert.throws(()=>assertCharacterRasterIntegrity(damaged,image),/PNG|checksum|image/i);
  assert.throws(()=>assertCharacterRasterIntegrity(valid,{...image,width:image.width+1}),/dimensions/i);
});
test("WebP preflight refuses invalid RIFF lengths and mismatched dimensions",()=>{
  // A minimal lossless WebP header; the browser still performs final decoding.
  const webp=Buffer.alloc(26);
  webp.write("RIFF",0);webp.writeUInt32LE(18,4);webp.write("WEBP",8);
  webp.write("VP8L",12);webp.writeUInt32LE(5,16);
  webp[20]=0x2f;webp.writeUInt32LE(3|(4<<14),21);
  const asset={mediaType:"image/webp",width:4,height:5};
  assert.doesNotThrow(()=>assertCharacterRasterIntegrity(webp,asset));
  assert.throws(()=>assertCharacterRasterIntegrity(webp,{...asset,width:8}),/dimensions/i);
  const broken=Buffer.from(webp);broken.writeUInt32LE(999,4);
  assert.throws(()=>assertCharacterRasterIntegrity(broken,asset),/WebP|RIFF/i);
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
  const check=characterRasterPreflightList(selected.rigs);
  assert.equal(check.length,selected.assets.length);
  assert.ok(check.every(layer=>layer.url.startsWith("/__character_assets/")&&layer.width>0&&layer.height>0));
});
test("browser preflight refuses an omitted or disguised saved raster URL instead of silently drawing bundled art",async()=>{
  const bytes=await archive("pip"),draft=record("pip",bytes,readCharacterZip(bytes).definition.revision);
  const mock=mockCatalog([draft],new Map([[draft.id,bytes]]));
  const selected=await loadProjectCharacterRigs({projectId,speakers:["pip"],fetchImpl:mock.fetchImpl});
  const valid=characterRasterPreflightList(selected.rigs);
  assert.ok(valid.length>0);
  const uri=Object.values(selected.rigs.pip.definition.assets)[0].uri;
  const altered=structuredClone(selected.rigs);
  delete altered.pip.assetUrls[uri];
  assert.throws(()=>characterRasterPreflightList(altered),/missing|raster/i);
  altered.pip.assetUrls[uri]="https://example.org/stolen.png";
  assert.throws(()=>characterRasterPreflightList(altered),/raster|URL/i);
});
test("raster preflight bounds the total Chromium-decoded pixel budget",()=>{
  const assets=Object.fromEntries(Array.from({length:3},(_,index)=>[
    `layer${index}`,{kind:"image",uri:`layers/${index}.png`,mediaType:"image/png",
      width:8192,height:8192}  ]));
  const urls=Object.fromEntries(Array.from({length:3},(_,index)=>[
    `layers/${index}.png`,`/__character_assets/${String(index).repeat(64)}.png`]));
  assert.throws(()=>characterRasterPreflightList({pip:{definition:{assets},assetUrls:urls}}),/budget|pixels|raster/i);
});
test("missing custom rigs retain bundled fallback without fetching arbitrary character names",async()=>{
  const mock=mockCatalog([],new Map());
  const selected=await loadProjectCharacterRigs({projectId,speakers:["pip","unknown"],fetchImpl:mock.fetchImpl});
  assert.deepEqual(selected,{rigs:{},assets:[],identity:[]});
  assert.equal(mock.calls.length,1);
  const none=await loadProjectCharacterRigs({projectId,speakers:["unknown","narrator"],fetchImpl:()=>{throw Error("unexpected network");}});
  assert.deepEqual(none,{rigs:{},assets:[],identity:[]});
});
test("an explicitly selected revision stays pinned and never downgrades to the newest saved ZIP",async()=>{
  const pip=await archive("pip"),rev=readCharacterZip(pip).definition.revision;
  const older=record("pip",pip,rev),latest={...older,id:`character-draft-${"e".repeat(32)}`};
  const mocks=mockCatalog([latest,older],new Map([[older.id,pip],[latest.id,pip]]));
  const pinned=await loadProjectCharacterRigs({projectId,speakers:["pip"],selectedDraftIds:{pip:older.id},fetchImpl:mocks.fetchImpl});
  assert.equal(pinned.rigs.pip.draftId,older.id);
  assert.equal(pinned.identity[0].draftId,older.id);
  assert.ok(mocks.calls.at(-1).url.includes(older.id));
  await assert.rejects(loadProjectCharacterRigs({projectId,speakers:["pip"],
    selectedDraftIds:{pip:`character-draft-${"f".repeat(32)}`},fetchImpl:mocks.fetchImpl}),/selected|missing|revision/i);
  await assert.rejects(loadProjectCharacterRigs({projectId,speakers:["pip"],
    selectedDraftIds:{quill:older.id},fetchImpl:mocks.fetchImpl}),/selection|speaker/i);
});
test("scene revisions remain independently pinned, share immutable archives, and reject missing scene art",async()=>{
  const pip=await archive("pip"),rev=readCharacterZip(pip).definition.revision;
  const old=record("pip",pip,rev),newer={...old,id:`character-draft-${"e".repeat(32)}`};
  const mock=mockCatalog([newer,old],new Map([[old.id,pip],[newer.id,pip]]));
  const selected=await loadProjectCharacterRigs({projectId,speakers:["pip"],
    selectedDraftIds:{pip:newer.id},
    selectedDraftIdsByScene:{"first-beat":{pip:old.id},"second-beat":{pip:newer.id}},
    fetchImpl:mock.fetchImpl});
  assert.equal(selected.rigs.pip.draftId,newer.id);
  assert.equal(selected.rigsByScene["first-beat"].pip.draftId,old.id);
  assert.equal(selected.rigsByScene["second-beat"].pip.draftId,newer.id);
  assert.equal(selected.identity.length,3);
  assert.equal(selected.identity[1].beatId,"first-beat");
  assert.equal(mock.calls.length,3,"a selected archive should only be fetched once per render");
  assert.equal(characterRasterPreflightList(selected.rigs,selected.rigsByScene).length,
    Object.keys(selected.rigs.pip.assetUrls).length);
  await assert.rejects(loadProjectCharacterRigs({projectId,speakers:["pip"],
    selectedDraftIdsByScene:{first:{pip:`character-draft-${"f".repeat(32)}`}},
    fetchImpl:mock.fetchImpl}),/missing|revision|selected/i);
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
  parsed.entries.get(Object.values(parsed.definition.assets)[0].uri.toLowerCase()).data[0]^=1;
  assert.throws(()=>readCharacterZip(modified),/checksum/);
});
test("no corrupt or missing saved rig silently falls back to bundled art",async()=>{
  const pip=await archive("pip"),draft=record("pip",pip,readCharacterZip(pip).definition.revision);
  const mock=mockCatalog([draft],new Map());
  await assert.rejects(loadProjectCharacterRigs({projectId,speakers:["pip"],fetchImpl:mock.fetchImpl}),/HTTP 404/);
});
test("duplicate catalog IDs cannot reuse a cached Pip archive as Quill artwork",async()=>{
  const pip=await archive("pip"),rev=readCharacterZip(pip).definition.revision;
  const p=record("pip",pip,rev),q={...p,characterId:"quill"};
  const mock=mockCatalog([p,q],new Map([[p.id,pip]]));
  await assert.rejects(loadProjectCharacterRigs({projectId,speakers:["pip","quill"],fetchImpl:mock.fetchImpl}),
    /duplicate.*revision/i);
});
