import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import test from "node:test";
import { DRAFT_VOICE_ENGINES, findDraftVoiceEngine, startDraftVoiceServer } from "./draft-voice-server.mjs";
import { synthesizeLocalBeat } from "./local.mjs";

/** A minimal mono 16-bit PCM WAV, as the conversion step would write it. */
function wav(samples = 480) {
  const data = Buffer.alloc(samples * 2), header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(48000, 24); header.writeUInt32LE(96000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** Stand in for the speech command and FFmpeg: record the calls and write the converted file. */
function fakeTools(calls, { installed = ["say"] } = {}) {
  return async (command, args) => {
    calls.push([command, ...args]);
    if (!installed.includes(command) && command !== "ffmpeg") throw Object.assign(Error("not found"), { code: "ENOENT" });
    if (command === "ffmpeg") await writeFile(args.at(-1), wav());
    return { stdout: "", stderr: "" };
  };
}

test("picks the first installed engine and reports the ones it tried", async () => {
  const calls = [];
  const engine = await findDraftVoiceEngine({ run: fakeTools(calls, { installed: ["espeak-ng"] }) });
  assert.equal(engine.id, "espeak-ng");
  await assert.rejects(findDraftVoiceEngine({ run: fakeTools([], { installed: [] }) }), /No draft voice engine is installed/u);
  await assert.rejects(findDraftVoiceEngine({ engine: "unknown", run: fakeTools([]) }), /Unknown draft voice engine/u);
});

test("every engine speaks from a text file, never from a command-line argument", () => {
  for (const engine of DRAFT_VOICE_ENGINES) {
    const { args } = engine.speak({ textFile: "/tmp/line.txt", audioFile: "/tmp/out", voice: "Voice Name" });
    assert.ok(args.includes("/tmp/line.txt"), engine.id);
    assert.ok(args.includes("/tmp/out"), engine.id);
  }
});

test("serves the local TTS contract that the narration stage already uses", async () => {
  const calls = [];
  const server = await startDraftVoiceServer({ run: fakeTools(calls), voice: "Test Voice" });
  try {
    assert.match(server.origin, /^http:\/\/127\.0\.0\.1:\d+$/u);
    assert.equal(server.engineVersion, "draft-say-Test_Voice/1");
    const text = "A line with \"quotes\"; $(nothing) -o /etc/passwd";
    const result = await synthesizeLocalBeat({ text, locale: "en-US", voiceId: "default", modelId: "draft-voice",
      endpoint: server.origin, rightsContext: { localVoiceAuthorized: true } });
    assert.equal(result.engineVersion, server.engineVersion);
    assert.equal(Buffer.from(result.audio).toString("ascii", 0, 4), "RIFF");
    const spoken = calls.find(call => call[0] === "say" && call.includes("-f"));
    assert.ok(spoken, "the speech command ran");
    assert.ok(!spoken.some(part => part.includes("passwd")), "the text is not on the command line");
    assert.deepEqual(spoken.slice(1, 3), ["-v", "Test Voice"]);
  } finally { await server.close(); }
});

test("refuses browser requests, other routes and empty text", async () => {
  const server = await startDraftVoiceServer({ run: fakeTools([]) });
  try {
    const post = (path, body, headers = {}) => fetch(server.origin + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
    assert.equal((await post("/v1/speech", { text: "hello" }, { Origin: "http://localhost:5173" })).status, 403);
    assert.equal((await post("/v1/other", { text: "hello" })).status, 404);
    assert.equal((await post("/v1/speech", { text: " " })).status, 400);
    assert.equal((await fetch(server.origin + "/v1/speech")).status, 404);
  } finally { await server.close(); }
});

test("a failing engine is a 500, not a crash or a silent WAV", async () => {
  const run = async (command, args) => {
    if (args.includes("-f")) throw Error("speech failed");
    return { stdout: "", stderr: "" };
  };
  const server = await startDraftVoiceServer({ run });
  try {
    const response = await fetch(server.origin + "/v1/speech", { method: "POST", body: JSON.stringify({ text: "hello" }) });
    assert.equal(response.status, 500);
  } finally { await server.close(); }
});
