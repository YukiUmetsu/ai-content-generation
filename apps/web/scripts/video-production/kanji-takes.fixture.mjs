/** Test helpers for kanji takes: a config, a word-like tone, and a take put where the producer's request finds it. */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { wavBytes } from "./audio.mjs";
import { readKanjiConfig } from "./kanji-config.mjs";
import { kanjiSpeech } from "./kanji-short-producer.mjs";
import { narrationSignature } from "./speech.mjs";

export const VOICES = { ja: "34cfe2f12a8a4d9490e375fcb845642f", en: "59f85041c50240f08ba9b6fa2bff650d" };
export const takesConfig = (dir) => readKanjiConfig({
  schemaVersion: 1, dataset: "data.json", outputRoot: "out", voice: { voiceId: VOICES.ja, voiceIds: VOICES, pace: "slow" },
  music: { path: "bed.wav", sha256: "a".repeat(64), title: "Bed", source: "https://example.org/bed", license: "CC0 1.0" },
}, join(dir, "config.json"));

/** A voiced glide as 48 kHz PCM, like a short word. */
export function glideWav(seconds, from, to) {
  const n = Math.round(seconds * 48000), pcm = Buffer.alloc((n + 9600) * 2);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    phase += 2 * Math.PI * (from + (to - from) * i / n) / 48000;
    pcm.writeInt16LE(Math.round(9000 * (Math.sin(phase) + .5 * Math.sin(2 * phase))), (4800 + i) * 2);
  }
  return wavBytes(pcm);
}

/** Put a take in the cache exactly where the producer's request would find it. */
export async function cacheTake(config, text, locale, take, bytes) {
  const voicing = kanjiSpeech(config);
  const signature = narrationSignature(voicing.job(locale, []), voicing.beat({ id: "t", text, locale, ...(take > 1 ? { take } : {}) }), voicing.options(config.cacheDir));
  const key = createHash("sha256").update(JSON.stringify(signature)).digest("hex");
  const dir = join(config.cacheDir, "narration", key.slice(0, 2), key);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "speech.wav"), bytes);
  await writeFile(join(dir, "metadata.json"), JSON.stringify({ key, sha256: createHash("sha256").update(bytes).digest("hex"), providerRevision: "fish-api-v1", samples: (bytes.length - 44) / 2 }));
  return join(dir, "speech.wav");
}
