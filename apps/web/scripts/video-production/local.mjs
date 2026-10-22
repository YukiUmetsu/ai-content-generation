/**
 * Opt-in local text-to-speech bridge adapter. The bridge is a user-installed
 * service; this module never installs a model or claims an engine is running.
 */
const MAX_WAV_BYTES = 16 * 1024 * 1024;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export class LocalSynthesisError extends Error {
  constructor(code, message, status = null) {
    super(message);
    this.name = "LocalSynthesisError";
    this.code = code;
    this.status = status;
  }

  toJSON() { return { name: this.name, code: this.code, status: this.status, message: this.message }; }
}

const fail = (code, message, status) => new LocalSynthesisError(code, message, status);
const nonempty = (v) => typeof v === "string" && v.trim().length > 0;

/** Only a bare HTTP loopback origin with an explicit port is accepted. */
export function localSpeechEndpoint(endpoint) {
  if (!nonempty(endpoint)) throw fail("local-endpoint-missing", "Configure the loopback TTS endpoint.");
  let url;
  try { url = new URL(endpoint); }
  catch { throw fail("invalid-local-endpoint", "Invalid loopback TTS endpoint URL."); }
  if (url.protocol !== "http:" || !LOOPBACK.has(url.hostname) || !url.port ||
    (url.pathname !== "/" && url.pathname !== "") || url.username || url.password || url.search || url.hash) {
    throw fail("unsafe-local-endpoint", "Local TTS endpoint must be an HTTP loopback origin with an explicit port.");
  }
  return new URL("/v1/speech", url).href;
}

function validateWave(bytes) {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.length < 46 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE" ||
      buffer.readUInt32LE(4) + 8 > buffer.length) {
    throw fail("invalid-wav", "Local TTS returned an empty, invalid or truncated WAV payload.");
  }
  let offset = 12, format = false, data = false;
  const size = buffer.readUInt32LE(4) + 8;
  while (offset + 8 <= size) {
    const kind = buffer.toString("ascii", offset, offset + 4);
    const bytesInChunk = buffer.readUInt32LE(offset + 4);
    if (offset + 8 + bytesInChunk > size) throw fail("invalid-wav", "Local WAV audio chunk was truncated.");
    if (kind === "fmt " && bytesInChunk >= 16) {
      if (buffer.readUInt16LE(offset + 8) !== 1 || buffer.readUInt16LE(offset + 10) !== 1 ||
          buffer.readUInt16LE(offset + 22) !== 16) {
        throw fail("unsupported-wav", "Local TTS must return mono 16-bit PCM WAV audio.");
      }
      format = true;
    }
    if (kind === "data" && bytesInChunk > 0) data = true;
    offset += 8 + bytesInChunk + (bytesInChunk % 2);
  }
  if (!format || !data) throw fail("invalid-wav", "Local WAV did not contain playable PCM samples.");
}

async function readWave(response, signal) {
  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!["audio/wav", "audio/x-wav", "application/octet-stream"].includes(type)) {
    throw fail("invalid-content-type", "Local TTS returned an unexpected WAV content type.");
  }
  const lengthHeader = response.headers.get("content-length");
  if (lengthHeader && Number(lengthHeader) > MAX_WAV_BYTES) throw fail("wav-too-large", "Local TTS WAV exceeds the per-beat size limit.");
  if (!response.body) throw fail("invalid-wav", "Local TTS response has no WAV body.");
  const chunks = [];
  const reader = response.body.getReader();
  let length = 0;
  try {
    while (true) {
      if (signal.aborted) throw fail("local-timeout", "Local synthesis timed out or was aborted.");
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_WAV_BYTES) throw fail("wav-too-large", "Local TTS WAV exceeds the per-beat size limit.");
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof LocalSynthesisError) throw error;
    throw fail("local-stream", "Local TTS audio stream failed.");
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  validateWave(result);
  return result;
}

/**
 * @param {{text:string,locale:string,voiceId:string,modelId:string,direction?:object,endpoint:string,rightsContext:{localVoiceAuthorized:boolean,commercialRightsVerified?:boolean}}} request
 * @param {{fetchImpl?:typeof fetch,signal?:AbortSignal,timeoutMs?:number}} dependencies
 */
export async function synthesizeLocalBeat(request, dependencies = {}) {
  const url = localSpeechEndpoint(request?.endpoint);
  if (!request?.rightsContext?.localVoiceAuthorized) throw fail("voice-not-authorized", "Local voice use requires explicit consent or authorization.");
  if (!nonempty(request?.modelId)) throw fail("missing-model", "An installed local TTS model ID is required.");
  if (!nonempty(request?.voiceId)) throw fail("missing-voice", "A local voice profile ID is required.");
  if (!nonempty(request?.text) || request.text.length > 5000) throw fail("invalid-text", "A non-empty beat up to 5,000 characters is required.");
  if (!nonempty(request?.locale)) throw fail("invalid-locale", "Narration locale is required.");

  const body = JSON.stringify({
    schema_version: 1,
    text: request.text,
    locale: request.locale,
    voice_id: request.voiceId,
    model_id: request.modelId,
    direction: request.direction ?? {},
    format: "wav",
  });
  const controller = new AbortController();
  const timeout = Math.max(1, Math.min(120000, dependencies.timeoutMs ?? 90000));
  const timer = setTimeout(() => controller.abort(), timeout);
  const signal = dependencies.signal
    ? AbortSignal.any([controller.signal, dependencies.signal])
    : controller.signal;
  try {
    const response = await (dependencies.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "audio/wav" },
      body,
      signal,
      redirect: "error",
    });
    if (response.status >= 300 && response.status < 400) throw fail("unsafe-redirect", "Local TTS redirect is forbidden.", response.status);
    if (response.status !== 200) throw fail("local-unavailable", "Local TTS engine is unavailable or refused the request.", response.status);
    const engineVersion = response.headers.get("x-tts-engine-version")?.trim();
    if (!engineVersion || engineVersion.length > 128) throw fail("unknown-engine", "Local TTS engine must report a version identifier.");
    const audio = await readWave(response, signal);
    return {
      audio,
      provider: "local",
      modelId: request.modelId,
      voiceId: request.voiceId,
      encoding: "wav",
      engineVersion,
      commercialRightsVerified: request.rightsContext.commercialRightsVerified === true,
    };
  } catch (error) {
    if (error instanceof LocalSynthesisError) throw error;
    if (signal.aborted) throw fail("local-timeout", "Local TTS request timed out or was aborted.");
    throw fail("local-unavailable", "Configured local TTS engine could not be reached.");
  } finally {
    clearTimeout(timer);
  }
}
