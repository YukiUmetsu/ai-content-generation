#!/usr/bin/env node
/** Make kanji study shorts from the command line.
 *
 *   pnpm video:kanji -- 水 火 木 --allow-network --voice-consent --transmit-text
 *   pnpm video:kanji -- 水 --dry-run          # what each short shows and says; no network, no render
 *
 * Settings live in a local config file (default: <repo>/data/kanji-shorts/config.json; see
 * fixtures/kanji-short/config.example.json). Each kanji gets its own output folder with a
 * numbered version, so a new run never overwrites an earlier release.
 */
import { readFile, readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import presets from "../../src/components/video/platform-presets.json" with { type: "json" };
import { kanjiShortContent, kanjiShortLines, readKanjiDataset } from "./kanji-short.mjs";
import { produceKanjiShort } from "./kanji-short-producer.mjs";
import { productionProviderKey } from "./provider-keychain.mjs";
import { findChromium } from "./try.mjs";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
export const DEFAULT_CONFIG = join(repoRoot, "data", "kanji-shorts", "config.json");
const fail = (message) => { throw new Error(message); };

export function parseKanjiArgs(argv) {
  const options = { chars: [], config: DEFAULT_CONFIG, out: null, dryRun: false, allowNetwork: false, voiceReferenceConsent: false, textTransmissionApproved: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--allow-network") options.allowNetwork = true;
    else if (arg === "--voice-consent") options.voiceReferenceConsent = true;
    else if (arg === "--transmit-text") options.textTransmissionApproved = true;
    else if (arg === "--config" || arg === "--out") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) fail(`${arg} needs a path`);
      options[arg.slice(2)] = resolve(value);
    } else if (arg.startsWith("--")) fail(`Unknown option ${arg}`);
    else for (const char of [...arg].filter(c => c.trim() && c !== "," && c !== "、")) options.chars.push(char);
  }
  if (!options.chars.length) fail("Name at least one kanji, for example: pnpm video:kanji -- 水 火");
  options.chars = [...new Set(options.chars)];
  if (options.chars.some(char => !/\p{Script=Han}/u.test(char))) fail("Every character must be a kanji");
  return options;
}

/** The local settings, with relative paths resolved against the config file's folder. */
export function readKanjiConfig(json, configPath) {
  const base = dirname(configPath);
  const path = (value, name) => {
    if (typeof value !== "string" || !value.trim()) fail(`config: ${name} is required`);
    return isAbsolute(value) ? value : resolve(base, value);
  };
  if (json?.schemaVersion !== 1) fail("config: schemaVersion 1 is required");
  const destination = json.destination ?? "youtube-shorts";
  if (!presets.some(p => p.id === destination && p.width === 1080 && p.height === 1920)) fail("config: destination must be a 1080 × 1920 short preset");
  const voice = json.voice ?? {};
  if (typeof voice.voiceId !== "string" || !/^[a-z0-9]{8,64}$/iu.test(voice.voiceId)) fail("config: voice.voiceId must be a Fish voice ID");
  if ((voice.modelId ?? "s2.1-pro-free") !== "s2.1-pro-free") fail("config: only the free Fish model s2.1-pro-free is supported");
  if (voice.pace !== undefined && !["slow", "measured", "fast"].includes(voice.pace)) fail("config: voice.pace must be slow, measured or fast");
  if (voice.licenseStatus !== undefined && !["unknown", "verified"].includes(voice.licenseStatus)) fail("config: voice.licenseStatus must be unknown or verified");
  const music = json.music ?? {};
  if (!/^[a-f0-9]{64}$/u.test(music.sha256 ?? "")) fail("config: music.sha256 must be the SHA-256 of the reviewed music file");
  for (const key of ["title", "source", "license"]) if (typeof music[key] !== "string" || !music[key].trim()) fail(`config: music.${key} is required`);
  if (music.startSeconds !== undefined && !(Number.isFinite(music.startSeconds) && music.startSeconds >= 0)) fail("config: music.startSeconds must be a number of seconds");
  if (music.belowVoiceDb !== undefined && !(music.belowVoiceDb >= 6 && music.belowVoiceDb <= 30)) fail("config: music.belowVoiceDb must be 6 to 30");
  const timing = json.timing ?? {};
  const ranges = { write: [3, 20], review: [3, 20], wordGap: [.3, 3], tail: [.5, 5], readingGap: [.2, 2], wordLead: [0, 2], questionStart: [.05, 2], introTail: [0, 2] };
  for (const key of Object.keys(timing)) {
    if (!Object.hasOwn(ranges, key)) fail(`config: timing.${key} is not a setting (${Object.keys(ranges).join(", ")})`);
    const [min, max] = ranges[key];
    if (!(Number.isFinite(timing[key]) && timing[key] >= min && timing[key] <= max)) fail(`config: timing.${key} must be ${min} to ${max} seconds`);
  }
  const narration = json.narration ?? {};
  const isText = (value, max) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
  for (const key of Object.keys(narration)) if (!["question", "questionLocale", "labels", "speech"].includes(key)) fail(`config: narration.${key} is not a setting`);
  if (narration.question !== undefined && !(isText(narration.question, 160) && narration.question.split("{name}").length === 2))
    fail("config: narration.question must contain {name} exactly once");
  if (narration.questionLocale !== undefined && !["en", "ja"].includes(narration.questionLocale)) fail("config: narration.questionLocale must be en or ja");
  if (narration.labels !== undefined && !(narration.labels && isText(narration.labels.on, 20) && isText(narration.labels.kun, 20)))
    fail("config: narration.labels needs both on and kun, for example { \"on\": \"おんよみ\", \"kun\": \"くんよみ\" }");
  if (narration.speech !== undefined && !(narration.speech && typeof narration.speech === "object" && !Array.isArray(narration.speech) &&
    Object.entries(narration.speech).every(([word, text]) => isText(word, 40) && isText(text, 40))))
    fail("config: narration.speech maps a word to the text the voice reads, for example { \"水泳\": \"すいえい\" }");
  const card = json.card ?? {};
  if (card.density !== undefined && !["regular", "compact"].includes(card.density)) fail("config: card.density must be regular or compact");
  if (card.heading !== undefined && !(typeof card.heading === "string" && card.heading.length <= 30)) fail("config: card.heading must be at most 30 characters");
  if (json.credits !== undefined && !(Array.isArray(json.credits) && json.credits.every(line => typeof line === "string" && line.length <= 400))) fail("config: credits must be lines of text");
  return {
    dataset: path(json.dataset, "dataset"), outputRoot: path(json.outputRoot, "outputRoot"),
    cacheDir: json.cacheDir ? path(json.cacheDir, "cacheDir") : join(dirname(configPath), "cache"),
    destination, voice, music: { ...music, path: path(music.path, "music.path") }, narration, timing, card, credits: json.credits ?? [],
  };
}

/** The next free version folder for a kanji: <root>/<char>-<code point>/v1, v2, … */
export async function nextOutputDir(root, char) {
  const dir = join(root, `${char}-${char.codePointAt(0).toString(16)}`);
  let names = [];
  try { names = await readdir(dir); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const used = names.map(name => /^v(\d+)$/u.exec(name)?.[1]).filter(Boolean).map(Number);
  return join(dir, `v${used.length ? Math.max(...used) + 1 : 1}`);
}

export async function main(argv = process.argv.slice(2), env = process.env, deps = {}) {
  const args = parseKanjiArgs(argv);
  const config = readKanjiConfig(JSON.parse(await readFile(args.config, "utf8")), args.config);
  if (args.out) config.outputRoot = args.out;
  const log = deps.log ?? ((line) => process.stdout.write(`${line}\n`));
  if (args.dryRun) {
    const { entries, problems } = readKanjiDataset(JSON.parse(await readFile(config.dataset, "utf8")));
    for (const char of args.chars) {
      const entry = entries.get(char);
      if (!entry) { log(`${char}: not in the kanji data`); continue; }
      for (const problem of problems.filter(p => p.includes(`(${char})`))) log(`${char}: kanji data problem: ${problem}`);
      const content = kanjiShortContent(entry, { speech: config.narration.speech });
      log(`${char}  ${content.meanings} · JLPT ${content.jlpt ?? "-"} · typed ${content.name.kana} → ${char}`);
      for (const line of kanjiShortLines(content, config.narration)) log(`  ${line.id.padEnd(9)} ${line.text}${line.caption !== line.text ? `   [caption: ${line.caption}]` : ""}`);
      log(`  words     ${content.words.map(w => `${w.word} (${w.ruby}, ${w.meaning})`).join(" · ")}`);
    }
    return [];
  }
  const apiKey = await (deps.providerKey ?? productionProviderKey)("fish", { env });
  const browserExecutable = await (deps.findBrowser ?? findChromium)(env);
  const results = [];
  for (const char of args.chars) {
    const out = await nextOutputDir(config.outputRoot, char);
    log(`${char}: ${out}`);
    const result = await (deps.produce ?? produceKanjiShort)({
      char, config, out, apiKey, browserExecutable, allowNetwork: args.allowNetwork,
      voiceReferenceConsent: args.voiceReferenceConsent, textTransmissionApproved: args.textTransmissionApproved,
      onProgress: (event) => { if (event.message) log(`  ${event.message}`); },
    });
    const { pacing, audio } = result.qa;
    log(`  ${result.videoPath}`);
    log(`  ${result.qa.video.seconds} s · ${audio.integratedLufs} LUFS · longest still ${pacing.longestStillSeconds} s · ${result.qa.pronunciation}`);
    results.push(result);
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(`video:kanji: ${error.message}\n`); process.exitCode = 1; });
}
