import assert from "node:assert/strict";
import {test} from "node:test";
import {productionProviderKey} from "./provider-keychain.mjs";

test("Fish fetches its macOS Keychain account without a browser API",async()=>{
  const calls=[];
  const read=async(path,args)=>{calls.push({path,args});return {stdout:"  mock-provider-secret  \n"};};
  assert.equal(await productionProviderKey("fish",{platform:"darwin",read,env:{}}),"mock-provider-secret");
  assert.deepEqual(calls.map(call=>call.args[4]),["fish-audio-api"]);
  assert.ok(calls.every(call=>call.path==="/usr/bin/security"));
});

test("missing or denied Keychain entries use explicit env fallback without exposing OS diagnostics",async()=>{
  const env={FISH_AUDIO_API_KEY:"fallback-fish-secret"};
  assert.equal(await productionProviderKey("fish",{platform:"darwin",env,
    read:async()=>{throw Error("private OS credential detail");}}),env.FISH_AUDIO_API_KEY);
  assert.equal(await productionProviderKey("fish",{platform:"linux",env}),env.FISH_AUDIO_API_KEY);
  await assert.rejects(productionProviderKey("pexels"),/Unknown production credential provider/);
});
