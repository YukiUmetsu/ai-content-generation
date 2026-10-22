import assert from "node:assert/strict";
import test from "node:test";
import { synthesizeFishBeat } from "./fish.mjs";

const wav = () => {
  const b = Buffer.alloc(46);
  b.write("RIFF", 0); b.writeUInt32LE(38, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22); b.writeUInt32LE(44100, 24); b.writeUInt32LE(88200, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36);
  b.writeUInt32LE(2, 40); b.writeInt16LE(1, 44);
  return b;
};
const request = {
  text: "A hypothetical five hundred thousand dollar home.",
  locale: "en-US",
  voiceId: "licensed-model-123",
  modelId: "s2.1-pro-free",
  direction: { pace: "measured", emotion: "curious" },
  allowNetwork: true,
  rightsContext: { voiceReferenceConsent: true, textTransmissionApproved: true, commercialRightsVerified: false },
};
const goodResponse = () => new Response(wav(), { status: 200, headers: { "content-type": "audio/wav" } });

test("Fish request uses explicit free model header, WAV output and no uploaded samples", async () => {
  let seen;
  const result = await synthesizeFishBeat(request, {
    apiKey: "secret-do-not-log",
    fetchImpl: async (url, init) => { seen = { url, init }; return goodResponse(); },
  });
  assert.equal(seen.url, "https://api.fish.audio/v1/tts");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers.model, "s2.1-pro-free");
  assert.equal(seen.init.headers.Authorization, "Bearer secret-do-not-log");
  const body = JSON.parse(seen.init.body);
  assert.equal(body.text, request.text);
  assert.equal(body.reference_id, request.voiceId);
  assert.equal(body.format, "wav");
  assert.equal(body.sample_rate, 44100);
  assert.equal(body.prosody.speed, 1);
  assert.equal("references" in body, false);
  assert.equal(result.provider, "fish");
  assert.equal(result.encoding, "wav");
  assert.deepEqual(Buffer.from(result.audio), wav());
});

test("remote TTS requires network, key and voice-reference consent before fetch", async () => {
  let calls = 0;
  const deps = { apiKey: "private", fetchImpl: async () => { calls++; return goodResponse(); } };
  await assert.rejects(synthesizeFishBeat({ ...request, allowNetwork: false }, deps), /network/i);
  await assert.rejects(synthesizeFishBeat(request, { ...deps, apiKey: "" }), /key/i);
  await assert.rejects(synthesizeFishBeat({ ...request, rightsContext: { voiceReferenceConsent: false, textTransmissionApproved: true } }, deps), /consent/i);
  await assert.rejects(synthesizeFishBeat({ ...request, voiceId: "configure-a-licensed-reference" }, deps), /voice/i);
  assert.equal(calls, 0);
});

test("unknown model and non-opted-in paid model never invoke the API", async () => {
  let calls = 0;
  const deps = { apiKey: "private", fetchImpl: async () => { calls++; return goodResponse(); } };
  await assert.rejects(synthesizeFishBeat({ ...request, modelId: "new-unreviewed-model" }, deps), /model/i);
  await assert.rejects(synthesizeFishBeat({ ...request, modelId: "s2.1-pro" }, deps), /paid/i);
  assert.equal(calls, 0);
});

test("401/402/403 fail without retry and never expose secret or provider body", async () => {
  for (const status of [401, 402, 403]) {
    let calls = 0;
    const deps = {
      apiKey: "private-fish-token",
      fetchImpl: async () => { calls++; return new Response('{"message":"private-fish-token"}', { status, headers: { "content-type": "application/json" } }); },
      sleep: async () => { throw new Error("should not retry"); },
    };
    await assert.rejects(synthesizeFishBeat(request, deps), (error) => {
      assert.equal(error.status, status);
      assert.equal(JSON.stringify(error).includes("private-fish-token"), false);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("429 and 5xx retry at most twice with bounded backoff", async () => {
  const calls = [], sleeps = [];
  const deps = {
    apiKey: "private",
    fetchImpl: async () => {
      calls.push(1);
      return calls.length < 3 ? new Response(null, { status: calls.length === 1 ? 429 : 503 }) : goodResponse();
    },
    sleep: async (ms) => { sleeps.push(ms); },
  };
  const result = await synthesizeFishBeat(request, deps);
  assert.equal(result.audio.length, 46);
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [250, 500]);
  let persistentCalls = 0;
  await assert.rejects(synthesizeFishBeat(request, { ...deps, fetchImpl: async () => { persistentCalls++; return new Response(null, { status: 503 }); } }), /unavailable/i);
  assert.equal(persistentCalls, 3);
});

test("refuses wrong MIME, malformed WAV, huge and truncated responses", async () => {
  const stub = (response) => ({ apiKey: "private", fetchImpl: async () => response });
  await assert.rejects(synthesizeFishBeat(request, stub(new Response("{}", { headers: { "content-type": "application/json" } }))), /content type/i);
  await assert.rejects(synthesizeFishBeat(request, stub(new Response(Buffer.from("RIFFbroken"), { headers: { "content-type": "audio/wav" } }))), /WAV/i);
  await assert.rejects(synthesizeFishBeat(request, stub(new Response(wav(), { headers: { "content-type": "audio/wav", "content-length": "999999999" } }))), /size/i);
  const incomplete = wav().subarray(0, 44);
  await assert.rejects(synthesizeFishBeat(request, stub(new Response(incomplete, { headers: { "content-type": "application/octet-stream" } }))), /WAV/i);
});

test("timeout aborts a stalled provider call", async () => {
  const stalled = (_, init) => new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  });
  await assert.rejects(synthesizeFishBeat(request, { apiKey: "private", fetchImpl: stalled, timeoutMs: 5, maxAttempts: 1 }), /timeout|aborted/i);
});
