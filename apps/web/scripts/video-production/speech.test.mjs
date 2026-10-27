import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { synthesizeNarration, probeNormalizedWav } from "./speech.mjs";

function pcmWave(samples, sampleRate = 48000) {
  const b = Buffer.alloc(44 + samples * 2);
  b.write("RIFF", 0); b.writeUInt32LE(b.length - 8, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22); b.writeUInt32LE(sampleRate, 24); b.writeUInt32LE(sampleRate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36);
  b.writeUInt32LE(samples * 2, 40);
  return b;
}
const job = {
  locale: "en-US", approval: "test-only",
  policy: { commercialRightsVerified: false, maxCostUsd: 0 },
  voice: { provider: "local", modelId: "installed-test-model", voiceId: "licensed-voice", profileId: "local-en", locale: "en-US", endpoint: "http://127.0.0.1:8765", licenseStatus: "test-only" },
  beats: [{ id: "a", narration: "First sentence.", pauseAfterMs: 250, eventIds: [] }, { id: "b", narration: "Second sentence.", pauseAfterMs: 0, eventIds: [] }],
};

const fakeMedia = {
  normalizeWav: async (inputPath, outputPath) => copyFile(inputPath, outputPath),
  probeWav: async (path) => ({ sampleRate: 48000, channels: 1, codecName: "pcm_s16le", samples: ((await readFile(path)).byteLength - 44) / 2 }),
};

async function testContext(t) {
  const cacheRoot = await mkdtemp(join(tmpdir(), "contentgen-speech-test-"));
  t.after(() => rm(cacheRoot, { recursive: true, force: true }));
  return cacheRoot;
}

test("speech outputs measured 48 kHz samples and a SHA-backed reusable per-beat cache", async (t) => {
  const cacheRoot = await testContext(t);
  let calls = 0;
  const synthesize = async () => { calls++; return { audio: pcmWave(4800), provider: "local", modelId: job.voice.modelId, voiceId: job.voice.voiceId, engineVersion: "engine-0.1", encoding: "wav" }; };
  const options = { provider: "local", providerRevision: "engine-0.1", cacheRoot, localVoiceAuthorized: true, synthesize, ...fakeMedia };
  const first = await synthesizeNarration(job, options);
  assert.equal(calls, 2);
  assert.deepEqual(first.map((b) => b.samples), [4800, 4800]);
  assert.equal(first[0].licenseStatus, "test-only");
  assert.match(first[0].sha256, /^[0-9a-f]{64}$/);
  const second = await synthesizeNarration(job, options);
  assert.equal(calls, 2, "cache hit must avoid both provider calls");
  assert.deepEqual(second.map((b) => b.wavPath), first.map((b) => b.wavPath));
  await assert.rejects(synthesizeNarration(job, { ...options, localVoiceAuthorized: false }), /authorization/i);
  assert.equal(calls, 2, "revoked authorization must not permit cached playback");
});

test("editing one beat does not regenerate unrelated speech; engine/version/voice isolate keys", async (t) => {
  const cacheRoot = await testContext(t);
  let calls = 0;
  const synthesize = async () => { calls++; return { audio: pcmWave(4800), provider: "local", modelId: job.voice.modelId, voiceId: job.voice.voiceId, engineVersion: "engine-0.1", encoding: "wav" }; };
  const options = { provider: "local", providerRevision: "engine-0.1", cacheRoot, localVoiceAuthorized: true, synthesize, ...fakeMedia };
  const first = await synthesizeNarration(job, options);
  const changed = { ...job, beats: [{ ...job.beats[0], narration: "Different sentence." }, job.beats[1]] };
  const second = await synthesizeNarration(changed, options);
  assert.equal(calls, 3);
  assert.notEqual(first[0].wavPath, second[0].wavPath);
  assert.equal(first[1].wavPath, second[1].wavPath);
  await synthesizeNarration(job, { ...options, providerRevision: "engine-0.2", synthesize: async () => { calls++; return { audio: pcmWave(4800), provider: "local", modelId: job.voice.modelId, voiceId: job.voice.voiceId, engineVersion: "engine-0.2", encoding: "wav" }; } });
  assert.equal(calls, 5);
});

test("corrupt cached WAV forces regeneration and never returns corrupt data", async (t) => {
  const cacheRoot = await testContext(t);
  let calls = 0;
  const options = { provider: "local", providerRevision: "engine-0.1", cacheRoot, localVoiceAuthorized: true, synthesize: async () => { calls++; return { audio: pcmWave(960), provider: "local", modelId: job.voice.modelId, voiceId: job.voice.voiceId, engineVersion: "engine-0.1", encoding: "wav" }; }, ...fakeMedia };
  const [first] = await synthesizeNarration({ ...job, beats: [job.beats[0]] }, options);
  await writeFile(first.wavPath, Buffer.from("corrupt"));
  const [next] = await synthesizeNarration({ ...job, beats: [job.beats[0]] }, options);
  assert.equal(calls, 2);
  assert.equal(next.samples, 960);
  assert.deepEqual(await readFile(next.wavPath), pcmWave(960));
});

test("speech refuses missing revision, zero samples, invalid probe and version mismatch", async (t) => {
  const cacheRoot = await testContext(t);
  const one = { ...job, beats: [job.beats[0]] };
  const deps = { provider: "local", cacheRoot, localVoiceAuthorized: true, synthesize: async () => ({ audio: pcmWave(10), provider: "local", modelId: job.voice.modelId, voiceId: job.voice.voiceId, engineVersion: "engine-0.1", encoding: "wav" }), ...fakeMedia };
  await assert.rejects(synthesizeNarration(one, deps), /revision/i);
  await assert.rejects(synthesizeNarration(one, { ...deps, providerRevision: "expected-other" }), /version/i);
  await assert.rejects(synthesizeNarration(one, { ...deps, providerRevision: "engine-0.1", probeWav: async () => ({ sampleRate: 16000, channels: 1, codecName: "pcm_s16le", samples: 0 }) }), /sample|format/i);
  await assert.rejects(synthesizeNarration(one, { ...deps, providerRevision: "engine-0.1", probeWav: async () => ({ sampleRate: 48000, channels: 1, codecName: "pcm_s16le", samples: 0 }) }), /sample/i);
});

test("FFmpeg normalizes 16 kHz generated WAV to measured 48 kHz PCM", { skip: spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status !== 0 || spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status !== 0 }, async (t) => {
  const cacheRoot = await testContext(t);
  const one = { ...job, beats: [job.beats[0]] };
  const result = await synthesizeNarration(one, {
    provider: "local", providerRevision: "engine-0.1", cacheRoot, localVoiceAuthorized: true,
    synthesize: async () => ({ audio: pcmWave(1600, 16000), provider: "local", modelId: job.voice.modelId, voiceId: job.voice.voiceId, engineVersion: "engine-0.1", encoding: "wav" }),
  });
  assert.equal(result[0].samples, 4800);
  assert.equal((await probeNormalizedWav(result[0].wavPath)).sampleRate, 48000);
});


test("previous production cache lets one changed sentence synthesize without repeating unaffected TTS",async t=>{
  const sourceRoot=await testContext(t);
  const revisedRoot=await testContext(t);
  let providerCalls=0;
  const synthesize=async()=>{
    providerCalls++;
    return {audio:pcmWave(4800),provider:"local",modelId:job.voice.modelId,
      voiceId:job.voice.voiceId,engineVersion:"engine-0.1",encoding:"wav"};
  };
  const options={provider:"local",providerRevision:"engine-0.1",
    localVoiceAuthorized:true,synthesize,...fakeMedia};
  const old=await synthesizeNarration(job,{...options,cacheRoot:sourceRoot});
  assert.equal(providerCalls,2);
  const revised={...job,beats:[{...job.beats[0],narration:"A newly edited local sentence."},job.beats[1]]};
  const reused=[];
  const next=await synthesizeNarration(revised,{...options,cacheRoot:revisedRoot,reuseCacheRoot:sourceRoot,
    onReuse:event=>reused.push(event.beatId)});
  assert.equal(providerCalls,3);
  assert.deepEqual(reused,["b"]);
  assert.notEqual(next[0].sha256,null);
  assert.equal(next[1].sha256,old[1].sha256);
  assert.notEqual(next[1].wavPath,old[1].wavPath);
  assert.deepEqual(await readFile(next[1].wavPath),await readFile(old[1].wavPath));
  assert.equal((await synthesizeNarration(revised,{...options,cacheRoot:revisedRoot})).length,2);
  assert.equal(providerCalls,3);
});
test("prior narration with corrupted hash refuses reuse; missing prior beat may be generated",async t=>{
  const sourceRoot=await testContext(t),targetRoot=await testContext(t);
  let calls=0;
  const synthesize=async()=>{calls++;return {audio:pcmWave(4800),provider:"local",
    modelId:job.voice.modelId,voiceId:job.voice.voiceId,engineVersion:"engine-0.1",encoding:"wav"};};
  const options={provider:"local",providerRevision:"engine-0.1",cacheRoot:sourceRoot,
    localVoiceAuthorized:true,synthesize,...fakeMedia};
  const source=await synthesizeNarration(job,options);
  await writeFile(source[0].wavPath,"tampered");
  await assert.rejects(synthesizeNarration(job,{...options,cacheRoot:targetRoot,
    reuseCacheRoot:sourceRoot}),/hash mismatch/);
  assert.equal(calls,2);
  await assert.rejects(synthesizeNarration(job,{...options,cacheRoot:targetRoot,
    reuseCacheRoot:sourceRoot,localVoiceAuthorized:false}),/authoriz/);
  const recovered=await synthesizeNarration(job,{...options,cacheRoot:targetRoot,
    reuseCacheRoot:sourceRoot,skipInvalidPriorCache:true});
  assert.equal(calls,3,"a retry resynthesizes only the corrupted beat after fresh authorization");
  assert.deepEqual(await readFile(recovered[1].wavPath),await readFile(source[1].wavPath),
    "untouched narration still reuses its verified source");
});
