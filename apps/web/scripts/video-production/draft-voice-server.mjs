/** A loopback draft voice for test renders: an operating-system speech command behind the local TTS contract.
 * It lets a render run with no model, no network and no provider account.
 * The voice is test-only. Its output must never be published.
 */
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const MAX_TEXT = 5000;
const MAX_BODY = 64 * 1024;

/** Each engine is data: how to detect it and how to speak a text file into an audio file.
 * Add an engine here; nothing else needs to change.
 */
export const DRAFT_VOICE_ENGINES = Object.freeze([
  { id: "say", extension: "aiff",
    probe: { command: "say", args: ["-v", "?"] },
    speak: ({ textFile, audioFile, voice }) => ({ command: "say", args: [...(voice ? ["-v", voice] : []), "-f", textFile, "-o", audioFile] }) },
  { id: "espeak-ng", extension: "wav",
    probe: { command: "espeak-ng", args: ["--version"] },
    speak: ({ textFile, audioFile, voice }) => ({ command: "espeak-ng", args: [...(voice ? ["-v", voice] : []), "-f", textFile, "-w", audioFile] }) },
  { id: "flite", extension: "wav",
    probe: { command: "flite", args: ["--version"] },
    speak: ({ textFile, audioFile, voice }) => ({ command: "flite", args: [...(voice ? ["-voice", voice] : []), "-f", textFile, "-o", audioFile] }) },
]);

/** The first engine whose probe command runs, or the named one. */
export async function findDraftVoiceEngine({ engine, engines = DRAFT_VOICE_ENGINES, run = exec } = {}) {
  const candidates = engine ? engines.filter(item => item.id === engine) : engines;
  if (!candidates.length) throw Error(`Unknown draft voice engine "${engine}". Known engines: ${engines.map(item => item.id).join(", ")}.`);
  for (const candidate of candidates) {
    try {
      await run(candidate.probe.command, candidate.probe.args, { timeout: 5000, maxBuffer: 1 << 20 });
      return candidate;
    } catch { /* This engine is not installed; try the next one. */ }
  }
  throw Error(`No draft voice engine is installed. Install one of: ${candidates.map(item => item.id).join(", ")}, or pass a local TTS endpoint instead.`);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw Error("request too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Speak one text and return mono 16-bit 48 kHz WAV bytes, the format the narration stage accepts. */
export async function speakDraft(text, { engine, voice, ffmpeg = "ffmpeg", run = exec }) {
  const dir = await mkdtemp(join(tmpdir(), "contentgen-draft-voice-"));
  try {
    const textFile = join(dir, "line.txt"), spoken = join(dir, `spoken.${engine.extension}`), wav = join(dir, "line.wav");
    // The text travels in a file, never on a command line, so no shell or option parsing can read it.
    await writeFile(textFile, text, "utf8");
    const { command, args } = engine.speak({ textFile, audioFile: spoken, voice });
    await run(command, args, { timeout: 60000, maxBuffer: 1 << 20 });
    await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", spoken,
      "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", "-map_metadata", "-1", wav], { timeout: 60000, maxBuffer: 1 << 20 });
    return await readFile(wav);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * @param {{engine?:string,voice?:string,port?:number,ffmpeg?:string,engines?:object[],run?:Function}} options
 * @returns {Promise<{origin:string,engineVersion:string,engineId:string,close:()=>Promise<void>}>}
 */
export async function startDraftVoiceServer(options = {}) {
  const run = options.run ?? exec;
  const engine = await findDraftVoiceEngine({ engine: options.engine, engines: options.engines, run });
  const engineVersion = `draft-${engine.id}${options.voice ? `-${options.voice.replace(/[^A-Za-z0-9._-]/gu, "_").slice(0, 40)}` : ""}/1`;
  const server = createServer(async (request, response) => {
    const reply = (status, message) => { response.writeHead(status, { "Content-Type": "text/plain" }); response.end(message); };
    // A browser page must not be able to drive a local speech command.
    if (request.headers.origin) return reply(403, "Browser requests are not accepted.");
    if (request.method !== "POST" || request.url !== "/v1/speech") return reply(404, "Not found.");
    try {
      const body = await readJsonBody(request);
      if (typeof body?.text !== "string" || !body.text.trim() || body.text.length > MAX_TEXT) return reply(400, "A text of 1 to 5,000 characters is required.");
      const audio = await speakDraft(body.text, { engine, voice: options.voice, ffmpeg: options.ffmpeg, run });
      response.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": audio.length, "x-tts-engine-version": engineVersion });
      response.end(audio);
    } catch {
      reply(500, "The draft voice engine failed.");
    }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(options.port ?? 0, "127.0.0.1", resolve); });
  return {
    origin: `http://127.0.0.1:${server.address().port}`, engineVersion, engineId: engine.id,
    close: () => new Promise(resolve => server.close(() => resolve())),
  };
}
