import assert from "node:assert/strict";
import test from "node:test";
import { synthesizeFishBeat } from "./fish.mjs";

const samplePcm = () => Buffer.from([1, 0, 254, 255]);
const wavOf = (samples) => {
  const b = Buffer.alloc(44 + samples.length);
  b.write("RIFF", 0); b.writeUInt32LE(b.length - 8, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22); b.writeUInt32LE(44100, 24); b.writeUInt32LE(88200, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36);
  b.writeUInt32LE(samples.length, 40); samples.copy(b, 44);
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
const goodResponse = () => new Response(samplePcm(), { status: 200, headers: {
  "content-type": "audio/pcm", "x-request-id": "fish-request-001",
} });
const stub = (response, extras = {}) => ({ apiKey: "private-fish-token", maxAttempts: 1,
  fetchImpl: async () => response, ...extras });

test("requests PCM, builds an exact standard WAV locally and never uploads audio", async () => {
  let seen;
  const result = await synthesizeFishBeat(request, {
    apiKey: "secret-do-not-log",
    fetchImpl: async (url, init) => { seen = { url, init }; return goodResponse(); },
  });
  assert.equal(seen.url, "https://api.fish.audio/v1/tts");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers.model, "s2.1-pro-free");
  assert.equal(seen.init.headers.Authorization, "Bearer secret-do-not-log");
  assert.equal(seen.init.headers.Accept, "audio/pcm");
  const body = JSON.parse(seen.init.body);
  assert.equal(body.text, request.text);
  assert.equal(body.reference_id, request.voiceId);
  assert.equal(body.format, "pcm");
  assert.equal(body.sample_rate, 44100);
  assert.equal(body.prosody.speed, 1);
  assert.equal("references" in body, false);
  assert.equal(result.provider, "fish");
  assert.equal(result.encoding, "wav");
  assert.deepEqual(Buffer.from(result.audio), wavOf(samplePcm()));
});

test("raw PCM bytes can contain arbitrary sample values without format guessing", async () => {
  for (const pcm of [Buffer.from([0, 0]), Buffer.from([255, 255, 1, 128]), Buffer.alloc(1024)]) {
    const result = await synthesizeFishBeat(request, stub(new Response(pcm, {
      headers: { "content-type": "application/octet-stream" },
    })));
    assert.deepEqual(Buffer.from(result.audio), wavOf(pcm));
  }
});

test("diagnostics include safe request, response, completion metadata, never credentials, text or raw payload", async () => {
  const events = [];
  const result = await synthesizeFishBeat(request, stub(goodResponse(), {
    onDiagnostic: (event) => events.push(event),
  }));
  assert.equal(result.encoding, "wav");
  assert.deepEqual(events.map((event) => event.event), ["request", "response", "complete"]);
  assert.equal(events[0].requestedFormat, "pcm");
  assert.equal(events[0].model, request.modelId);
  assert.equal(events[0].sampleRate, 44100);
  assert.equal(events[1].httpStatus, 200);
  assert.equal(events[1].contentType, "audio/pcm");
  assert.equal(events[1].requestId, "fish-request-001");
  assert.equal(events[2].receivedBytes, 4);
  assert.equal(events[2].audioSignature, "unrecognized-or-raw-PCM");
  assert.equal(events[2].wavBytes, 48);
  assert.ok(events.every((event) => Number.isSafeInteger(event.elapsedMs)));
  const serialized = JSON.stringify(events);
  for (const secret of ["private-fish-token", request.voiceId, request.text, "Authorization", "reference_id"]) {
    assert.equal(serialized.includes(secret), false, "diagnostic unexpectedly contains private request details");
  }
});

test("HTTP diagnostics preserve error status and request ID but never provider response bodies", async () => {
  for (const status of [401, 402, 403, 429, 503]) {
    const events = [];
    const response = new Response('{"api_key":"private-fish-token","message":"private-fish-token"}', {
      status, headers: { "content-type": "application/json", "x-request-id": "provider-trace-123" },
    });
    await assert.rejects(synthesizeFishBeat(request, stub(response, {
      onDiagnostic: (event) => events.push(event),
    })), (error) => {
      assert.equal(error.status, status);
      assert.equal(JSON.stringify(error).includes("private-fish-token"), false);
      assert.equal(JSON.stringify(error).includes(request.text), false);
      assert.equal(error.diagnostic.httpStatus, status);
      assert.equal(error.diagnostic.requestId, "provider-trace-123");
      return true;
    });
    assert.deepEqual(events.map((x) => x.event), ["request", "response", "failure"]);
    assert.equal(events[2].httpStatus, status);
    assert.equal(events[2].contentType, "application/json");
  }
});

test("untrusted request IDs, content-types and bodies cannot echo a secret in telemetry", async () => {
  const events = [];
  const response = new Response('private-fish-token', { status: 403, headers: {
    "x-request-id": "private-fish-token",
    "content-type": "private-fish-token",
  } });
  await assert.rejects(synthesizeFishBeat(request, stub(response, {
    onDiagnostic: (event) => events.push(event),
  })), /denied/i);
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes("private-fish-token"), false);
  assert.equal(events[1].requestId, null);
  assert.equal(events[1].contentType, "missing-or-invalid");
});

test("provider diagnostics callback failure cannot interrupt successful speech synthesis", async () => {
  const result = await synthesizeFishBeat(request, stub(goodResponse(), {
    onDiagnostic: () => { throw new Error("do not interrupt speech"); },
  }));
  assert.deepEqual(Buffer.from(result.audio), wavOf(samplePcm()));
});

test("provider consent, key and model are checked before any HTTP request", async () => {
  let calls = 0;
  const deps = { apiKey: "private", fetchImpl: async () => { calls++; return goodResponse(); } };
  await assert.rejects(synthesizeFishBeat({ ...request, allowNetwork: false }, deps), /network/i);
  await assert.rejects(synthesizeFishBeat(request, { ...deps, apiKey: "" }), /key/i);
  await assert.rejects(synthesizeFishBeat({
    ...request, rightsContext: { voiceReferenceConsent: false, textTransmissionApproved: true },
  }, deps), /consent/i);
  await assert.rejects(synthesizeFishBeat({
    ...request, voiceId: "configure-a-licensed-reference",
  }, deps), /voice/i);
  await assert.rejects(synthesizeFishBeat({ ...request, modelId: "unreviewed-model" }, deps), /model/i);
  await assert.rejects(synthesizeFishBeat({ ...request, modelId: "s2.1-pro" }, deps), /paid/i);
  assert.equal(calls, 0);
});

test("429 and 5xx retry at most twice with safe per-attempt traces", async () => {
  const events = [], sleeps = [], calls = [];
  const deps = {
    apiKey: "private-fish-token",
    fetchImpl: async () => {
      calls.push(1);
      return calls.length < 3 ? new Response(null, { status: calls.length === 1 ? 429 : 503 }) : goodResponse();
    },
    sleep: async (ms) => sleeps.push(ms),
    onDiagnostic: (event) => events.push(event),
  };
  const result = await synthesizeFishBeat(request, deps);
  assert.deepEqual(Buffer.from(result.audio), wavOf(samplePcm()));
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [250, 500]);
  assert.deepEqual(events.filter((x) => x.event === "failure").map((x) => x.attempt), [1, 2]);
  assert.equal(events.at(-1).event, "complete");
  let attempts = 0;
  await assert.rejects(synthesizeFishBeat(request, { ...deps,
    fetchImpl: async () => { attempts++; return new Response(null, { status: 503 }); },
  }), /unavailable/i);
  assert.equal(attempts, 3);
});

test("refuses wrong MIME, RIFF masquerading as PCM, odd sample counts, empty and huge responses", async () => {
  await assert.rejects(synthesizeFishBeat(request, stub(new Response("{}", {
    headers: { "content-type": "application/json" },
  }))), /content type/i);
  await assert.rejects(synthesizeFishBeat(request, stub(new Response(wavOf(samplePcm()), {
    headers: { "content-type": "audio/pcm" },
  }))), /WAV despite/i);
  const disguised = new Response(Buffer.from('{"error":"not-a-voice"} '), {
    headers: { "content-type": "audio/pcm" },
  });
  await assert.rejects(synthesizeFishBeat(request, stub(disguised)), /JSON-like despite/i);
  const wrongSize = new Response(samplePcm(), {
    headers: { "content-type": "audio/pcm", "content-length": "32" },
  });
  await assert.rejects(synthesizeFishBeat(request, stub(wrongSize)), /declared Content-Length/i);
  await assert.rejects(synthesizeFishBeat(request, stub(new Response(Buffer.from([0, 1, 2]), {
    headers: { "content-type": "audio/pcm" },
  }))), /incomplete/i);
  await assert.rejects(synthesizeFishBeat(request, stub(new Response(null, {
    headers: { "content-type": "audio/pcm" },
  }))), /no PCM audio body/i);
  await assert.rejects(synthesizeFishBeat(request, stub(new Response(samplePcm(), {
    headers: { "content-type": "audio/pcm", "content-length": "999999999" },
  }))), /size/i);
});

test("timeout aborts a stalled provider call with a safe failure event", async () => {
  const events = [];
  const stalled = (_, init) => new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  });
  await assert.rejects(synthesizeFishBeat(request, {
    apiKey: "private", fetchImpl: stalled, timeoutMs: 5, maxAttempts: 1,
    onDiagnostic: (x) => events.push(x),
  }), /timeout|aborted/i);
  assert.equal(events.at(-1).event, "failure");
  assert.equal(events.at(-1).errorCode, "provider-timeout");
});
