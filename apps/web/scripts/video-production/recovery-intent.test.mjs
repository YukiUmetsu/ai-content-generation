import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,writeFile,symlink,stat,mkdir,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {listRecoveryIntents,reserveRecoveryAttempt,writeRecoveryIntent} from "./recovery-intent.mjs";

const runId="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const productionId="production-"+"a".repeat(24);
const intent={productionId,sourceRevision:"script-rev-1",revision:"f".repeat(64),
  request:{productionId,sourceRevision:"script-rev-1",settings:{provider:"fish",voiceId:"approved-voice",
    providerRevision:"fish-v1",voiceConsent:true,transmitText:true,apiKey:"do-not-store-my-key",
    privateApiCredential:"unrecognized-secret-value"},
    dossier:{id:"test-project"},bundle:{plan:{shots:[]}},searchFreeMedia:false,confirmUpdatedVersion:false}};

test("recovery snapshots are private, version-bound and never contain a provider key",async t=>{
  const root=await mkdtemp(join(tmpdir(),"draft-intent-"));t.after(()=>rm(root,{recursive:true,force:true}));
  await writeRecoveryIntent(root,runId,intent);
  const path=join(root,"draft-"+runId,"render-intent.json");
  const raw=await readFile(path,"utf8");
  assert.doesNotMatch(raw,/do-not-store-my-key|apiKey|unrecognized-secret-value|privateApiCredential/);
  assert.equal((await stat(path)).mode&0o777,0o600);
  const listed=await listRecoveryIntents(root);
  assert.equal(listed.length,1);
  assert.equal(listed[0].revision,intent.revision);
  assert.equal(listed[0].request.settings.voiceConsent,true);
  assert.equal(listed[0].request.settings.apiKey,undefined);
  assert.equal(listed[0].autoRecover,true);
  assert.equal(await reserveRecoveryAttempt(root,runId),true);
  assert.equal(await reserveRecoveryAttempt(root,runId),false,
    "only one restarted coordinator can reserve automatic recovery");
  assert.equal((await listRecoveryIntents(root))[0].autoRecover,false);
});

test("tampered and symlinked recovery intents never become executable inputs",async t=>{
  const root=await mkdtemp(join(tmpdir(),"draft-intent-invalid-"));t.after(()=>rm(root,{recursive:true,force:true}));
  await writeRecoveryIntent(root,runId,intent);
  const path=join(root,"draft-"+runId,"render-intent.json");
  await writeFile(path,JSON.stringify({...intent,request:{...intent.request,settings:{...intent.request.settings,apiKey:"injected"}}}));
  assert.deepEqual(await listRecoveryIntents(root),[]);
  const second="bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
  await mkdir(join(root,"draft-"+second));
  await symlink(path,join(root,"draft-"+second,"render-intent.json"));
  assert.deepEqual(await listRecoveryIntents(root),[]);
});

test("invalid identities and oversized snapshots cannot be stored",async t=>{
  const root=await mkdtemp(join(tmpdir(),"draft-intent-bound-"));t.after(()=>rm(root,{recursive:true,force:true}));
  await assert.rejects(writeRecoveryIntent(root,"../escape",intent),/identity|run ID/i);
  await assert.rejects(writeRecoveryIntent(root,runId,{...intent,revision:"wrong"}),/revision/i);
  await assert.rejects(writeRecoveryIntent(root,runId,{...intent,
    request:{...intent.request,bundle:{text:"x".repeat(1_500_000)}}}),/size|large/i);
});
