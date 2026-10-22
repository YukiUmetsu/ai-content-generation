import assert from "node:assert/strict";
import test from "node:test";
import { synthesizeLocalBeat } from "./local.mjs";

const sampleWave = () => {
  const b = Buffer.alloc(46);
  b.write("RIFF", 0); b.writeUInt32LE(38, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22); b.writeUInt32LE(44100, 24); b.writeUInt32LE(88200, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36);
  b.writeUInt32LE(2, 40); b.writeInt16LE(1, 44);
  return b;
};
const input = {
  text: "A cleanly generated local sentence.",
  locale: "en-US",
  voiceId: "local-voice-1",
  modelId: "installed-qwen-voice",
  direction: { pace: "measured" },
  endpoint: "http://127.0.0.1:8765",
  rightsContext: { localVoiceAuthorized: true, commercialRightsVerified: false },
};
const response = () => new Response(sampleWave(), {
  headers: { "content-type": "audio/wav", "x-tts-engine-version": "qwen-mlx-bridge-0.1" },
});

test("local bridge sends a versioned JSON request to loopback and returns real WAV bytes", async () => {
  let seen;
  const got = await synthesizeLocalBeat(input, {
    fetchImpl: async (url, init) => { seen = { url, init }; return response(); },
  });
  assert.equal(seen.url, "http://127.0.0.1:8765/v1/speech");
  assert.equal(seen.init.redirect, "error");
  const body = JSON.parse(seen.init.body);
  assert.deepEqual(body, {
    schema_version: 1,
    text: input.text,
    locale: "en-US",
    voice_id: "local-voice-1",
    model_id: "installed-qwen-voice",
    direction: { pace: "measured" },
    format: "wav",
  });
  assert.equal(got.provider, "local");
  assert.equal(got.engineVersion, "qwen-mlx-bridge-0.1");
  assert.deepEqual(Buffer.from(got.audio), sampleWave());
});

test("non-loopback and tricky URL forms are rejected before fetch", async () => {
  let calls = 0;
  for (const endpoint of [
    "https://example.com", "http://192.168.1.10:8765", "http://127.0.0.1.evil.com",
    "file:///tmp/server", "http://localhost:8765@evil.com/", "http://127.0.0.1:8765/admin",
    "http://127.0.0.1:8765?token=secret", "http://[::ffff:127.0.0.1]:8765",
  ]) {
    await assert.rejects(
      synthesizeLocalBeat({ ...input, endpoint }, { fetchImpl: async () => { calls++; return response(); } }),
      /loopback|endpoint|address/i,
    );
  }
  assert.equal(calls, 0);
});

test("IPv6 loopback and localhost are accepted", async () => {
  for (const endpoint of ["http://[::1]:8765", "http://localhost:8765/"]) {
    let url;
    await synthesizeLocalBeat({ ...input, endpoint }, { fetchImpl: async (u) => { url = u; return response(); } });
    assert.equal(new URL(url).pathname, "/v1/speech");
  }
});

test("missing engine and permission are actionable without silent provider fallback", async () => {
  let calls = 0;
  const deps = { fetchImpl: async () => { calls++; return response(); } };
  await assert.rejects(synthesizeLocalBeat({ ...input, endpoint: "" }, deps), /endpoint/i);
  await assert.rejects(synthesizeLocalBeat({ ...input, modelId: "" }, deps), /model/i);
  await assert.rejects(synthesizeLocalBeat({ ...input, rightsContext: { localVoiceAuthorized: false } }, deps), /authorized|consent/i);
  assert.equal(calls, 0);
});

test("redirect, connection refusal, missing engine version and malformed WAV fail", async () => {
  await assert.rejects(synthesizeLocalBeat(input, { fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://example.com/" } }) }), /redirect/i);
  await assert.rejects(synthesizeLocalBeat(input, { fetchImpl: async () => { throw new TypeError("connection refused"); } }),
    (error) => error.code === "local-unavailable");
  await assert.rejects(synthesizeLocalBeat(input, { fetchImpl: async () => new Response(sampleWave(), { headers: { "content-type": "audio/wav" } }) }), /version/i);
  await assert.rejects(synthesizeLocalBeat(input, { fetchImpl: async () => new Response("not audio", { headers: { "content-type": "audio/wav", "x-tts-engine-version": "test" } }) }), /WAV/i);
  const compressed = sampleWave();
  compressed.writeUInt16LE(7, 20);
  await assert.rejects(synthesizeLocalBeat(input, { fetchImpl: async () => new Response(compressed, { headers: { "content-type": "audio/wav", "x-tts-engine-version": "test" } }) }), /PCM/i);
});

test("local request timeout aborts without making a remote fallback", async () => {
  const never = (_, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
  await assert.rejects(synthesizeLocalBeat(input, { fetchImpl: never, timeoutMs: 5 }), /timeout|aborted/i);
});
