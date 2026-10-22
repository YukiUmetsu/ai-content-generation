/** Fish Audio text-to-speech provider. No live calls without explicit consent. */
const API_URL = "https://api.fish.audio/v1/tts";
const MAX_WAV_BYTES = 16 * 1024 * 1024;
const ACCEPTED_MODELS = new Set(["s1", "s2-pro", "s2.1-pro", "s2.1-pro-free", "drama-3"]);
const PAID_MODELS = new Set(["s1", "s2-pro", "s2.1-pro", "drama-3"]);
const PCM_TYPES = new Set(["audio/pcm", "audio/x-pcm", "audio/l16", "application/octet-stream"]);
const SAMPLE_RATE = 44100;

export class FishSynthesisError extends Error {
  constructor(code, message, status = null) {
    super(message);
    this.name = "FishSynthesisError";
    this.code = code;
    this.status = status;
  }

  toJSON() { return { name: this.name, code: this.code, status: this.status, message: this.message }; }
}

const fail = (code, message, status) => new FishSynthesisError(code, message, status);

/** Turn Fish's completed streaming WAV into a seekable PCM WAV.
 * Some streamed responses use unknown-length RIFF/data markers. Repair only
 * those explicit markers after the bounded HTTP stream has ended; never
 * forgive a finite declared size that exceeds the received bytes.
 */
function validateWave(bytes) {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.length < 46 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw fail("invalid-wav", "Fish returned an invalid or empty WAV file.");
  }
  const riffSize = buffer.readUInt32LE(4);
  const streamingRiff = riffSize === 0xffffffff || riffSize === 0x7fffeffc;
  const declaredLength = streamingRiff ? buffer.length : riffSize + 8;
  if (declaredLength > buffer.length || declaredLength < 46) throw fail("invalid-wav", "Fish returned an incomplete WAV payload.");
  let offset = 12, foundFormat = false, foundSamples = false, rewriteDataAt = -1, rewriteDataLength = 0;
  while (offset + 8 <= declaredLength) {
    const kind = buffer.toString("ascii", offset, offset + 4);
    const rawLength = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const unknownDataLength = kind === "data" && streamingRiff &&
      (rawLength === 0xffffffff || rawLength === 0x7fffeffc || rawLength === 0);
    const length = unknownDataLength ? declaredLength - dataStart : rawLength;
    if (dataStart + length > declaredLength) throw fail("invalid-wav", "Fish returned a truncated WAV chunk.");
    if (kind === "fmt " && length >= 16) {
      if (buffer.readUInt16LE(dataStart) !== 1 || buffer.readUInt16LE(dataStart + 2) !== 1 ||
        buffer.readUInt16LE(dataStart + 14) !== 16) {
        throw fail("unsupported-wav", "Fish WAV must be 16-bit mono PCM.");
      }
      foundFormat = true;
    }
    if (kind === "data" && length > 0) {
      if (unknownDataLength && length % 2 !== 0) throw fail("invalid-wav", "Fish returned an incomplete PCM sample.");
      foundSamples = true;
      if (unknownDataLength) { rewriteDataAt = offset + 4; rewriteDataLength = length; }
    }
    if (unknownDataLength) break;
    offset = dataStart + length + (length % 2);
  }
  if (!foundFormat || !foundSamples) throw fail("invalid-wav", "Fish returned a WAV without audio samples.");
  if (!streamingRiff) return bytes;
  const normalized = Buffer.from(buffer);
  normalized.writeUInt32LE(normalized.length - 8, 4);
  if (rewriteDataAt !== -1) normalized.writeUInt32LE(rewriteDataLength, rewriteDataAt);
  return normalized;
}

/** Assemble a seekable WAV from Fish's completed raw PCM16 stream.
 * The rest of ContentGen still consumes 44.1 kHz mono WAV bytes.
 */
function wrapPcmAsWave(pcm) {
  if (pcm.byteLength < 2 || pcm.byteLength % 2 !== 0) {
    throw fail("invalid-pcm", "Fish returned empty or incomplete 16-bit PCM samples.");
  }
  if (pcm.byteLength > MAX_WAV_BYTES - 44) {
    throw fail("response-too-large", "Fish PCM exceeded the per-beat size limit.");
  }
  const output = Buffer.allocUnsafe(44 + pcm.byteLength);
  output.write("RIFF", 0);
  output.writeUInt32LE(output.length - 8, 4);
  output.write("WAVE", 8);
  output.write("fmt ", 12);
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(SAMPLE_RATE, 24);
  output.writeUInt32LE(SAMPLE_RATE * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write("data", 36);
  output.writeUInt32LE(pcm.byteLength, 40);
  Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(output, 44);
  validateWave(output);
  return output;
}

async function readBounded(response, signal) {
  const mediaType = (response.headers?.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!PCM_TYPES.has(mediaType)) throw fail("wrong-content-type", `Fish returned ${mediaType || "no content type"}, not the requested raw PCM format.`);
  const declared = response.headers?.get("content-length");
  if (declared && Number(declared) > MAX_WAV_BYTES - 44) throw fail("response-too-large", "Fish PCM exceeded the per-beat size limit.");
  if (!response.body) throw fail("invalid-pcm", "Fish response had no PCM audio body.");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      if (signal.aborted) throw fail("provider-timeout", "Fish audio request timed out or was aborted.");
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > MAX_WAV_BYTES - 44) throw fail("response-too-large", "Fish PCM exceeded the per-beat size limit.");
      chunks.push(part.value);
    }
  } catch (error) {
    if (error instanceof FishSynthesisError) throw error;
    throw fail("provider-stream", "Fish audio stream was interrupted before completion.");
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let written = 0;
  for (const chunk of chunks) { result.set(chunk, written); written += chunk.byteLength; }
  if (result.length >= 4 && Buffer.from(result).toString("ascii", 0, 4) === "RIFF") {
    throw fail("wrong-audio-format", "Fish returned WAV despite the requested PCM format; check the provider response format.");
  }
  return wrapPcmAsWave(result);
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {{text:string,locale:string,voiceId:string,modelId:string,direction?:{pace?:string,emotion?:string},allowNetwork:boolean,rightsContext:{voiceReferenceConsent:boolean,textTransmissionApproved:boolean,commercialRightsVerified?:boolean}}} request
 * @param {{fetchImpl?:typeof fetch,apiKey?:string,signal?:AbortSignal,sleep?:(ms:number)=>Promise<void>,maxAttempts?:number,timeoutMs?:number,paidUsageApproved?:boolean,budgetUsd?:number}} dependencies
 */
export async function synthesizeFishBeat(request, dependencies = {}) {
  if (!request?.allowNetwork) throw fail("network-not-approved", "Explicit --allow-network permission is required for Fish synthesis.");
  if (!request?.rightsContext?.voiceReferenceConsent || !request?.rightsContext?.textTransmissionApproved) {
    throw fail("missing-consent", "Voice-reference consent and permission to transmit text are required.");
  }
  if (typeof dependencies.apiKey !== "string" || !dependencies.apiKey.trim()) throw fail("missing-api-key", "FISH_AUDIO_API_KEY is required.");
  if (typeof request.text !== "string" || !request.text.trim() || request.text.length > 5000) throw fail("invalid-text", "One non-empty speech beat of at most 5,000 characters is required.");
  if (typeof request.voiceId !== "string" || !request.voiceId.trim() || request.voiceId === "configure-a-licensed-reference") {
    throw fail("missing-voice", "Configure an authorized Fish voice reference before synthesis.");
  }
  if (!ACCEPTED_MODELS.has(request.modelId)) throw fail("unsupported-model", "Unrecognized Fish model blocked to prevent a silent paid fallback.");
  if (PAID_MODELS.has(request.modelId) && (!dependencies.paidUsageApproved || !(dependencies.budgetUsd > 0))) {
    throw fail("paid-model-not-approved", "This paid Fish model requires an approved nonzero budget.");
  }
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(request.locale)) throw fail("invalid-locale", "Locale must be a BCP-47 language tag.");

  const pace = { slow: 0.9, measured: 1, fast: 1.1 }[request.direction?.pace ?? "measured"];
  if (pace === undefined) throw fail("unsupported-direction", "Unsupported narration pace; no silent prosody substitution.");
  const payload = {
    text: request.text,
    reference_id: request.voiceId,
    language: request.locale,
    normalize: true,
    format: "pcm",
    sample_rate: 44100,
    prosody: { speed: pace, volume: 0, normalize_loudness: true },
  };
  const headers = {
    Authorization: `Bearer ${dependencies.apiKey}`,
    "Content-Type": "application/json",
    Accept: "audio/pcm",
    model: request.modelId,
  };

  const attempts = Math.max(1, Math.min(3, dependencies.maxAttempts ?? 3));
  const timeoutMs = Math.max(1, Math.min(120000, dependencies.timeoutMs ?? 90000));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const signal = dependencies.signal
      ? AbortSignal.any([controller.signal, dependencies.signal])
      : controller.signal;
    let error;
    try {
      if (signal.aborted) throw fail("provider-timeout", "Fish audio request timed out or was aborted.");
      const response = await (dependencies.fetchImpl ?? fetch)(API_URL, {
        method: "POST", headers, body: JSON.stringify(payload), signal, redirect: "error",
      });
      if (!response.ok) {
        const status = response.status;
        if (status === 401) throw fail("unauthorized", "Fish rejected API authorization.", status);
        if (status === 402) throw fail("payment-required", "Fish account lacks the required quota or billing permission.", status);
        if (status === 403) throw fail("usage-denied", "Fish denied usage or rights permission.", status);
        if (status === 429) throw fail("rate-limited", "Fish is rate limiting requests.", status);
        if (status >= 500) throw fail("provider-unavailable", "Fish speech service is unavailable.", status);
        throw fail("provider-rejected", "Fish rejected the TTS request.", status);
      }
      const audio = await readBounded(response, signal);
      return {
        audio,
        provider: "fish",
        modelId: request.modelId,
        voiceId: request.voiceId,
        encoding: "wav",
        sampleRate: 44100,
        prosodyApplied: { pace: request.direction?.pace ?? "measured" },
        commercialRightsVerified: request.rightsContext.commercialRightsVerified === true,
      };
    } catch (caught) {
      if (caught instanceof FishSynthesisError) error = caught;
      else if (signal.aborted) error = fail("provider-timeout", "Fish request timed out or was aborted.");
      else error = fail("provider-network", "Fish request failed before audio was received.");
    } finally {
      clearTimeout(timer);
    }
    const transient = ["rate-limited", "provider-unavailable", "provider-network", "provider-timeout"].includes(error.code);
    if (!transient || attempt === attempts - 1 || dependencies.signal?.aborted) throw error;
    await (dependencies.sleep ?? defaultSleep)(Math.min(2000, 250 * (2 ** attempt)));
  }
  throw fail("provider-unavailable", "Fish synthesis did not return audio.");
}
