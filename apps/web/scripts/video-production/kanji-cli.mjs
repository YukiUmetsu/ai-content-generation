#!/usr/bin/env node
/** Make kanji study shorts from the command line.
 *
 *   pnpm video:kanji -- 水 火 木 --allow-network --voice-consent --transmit-text   # Fish voice
 *   pnpm video:kanji -- 水 --local-voice-consent                                   # a local voice (voice.provider "local")
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
import { expandNarrationScript } from "./anchored-narration.mjs";
import { kanjiScriptData, kanjiShortContent, readKanjiDataset } from "./kanji-short.mjs";
import { kanjiNarrationScript, kanjiVgSvg, loadKanjiPlanner, produceKanjiShort } from "./kanji-short-producer.mjs";
import { productionProviderKey } from "./provider-keychain.mjs";
import { findChromium } from "./try.mjs";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
export const DEFAULT_CONFIG = join(repoRoot, "data", "kanji-shorts", "config.json");
const fail = (message) => { throw new Error(message); };

export function parseKanjiArgs(argv) {
  const options = { chars: [], config: DEFAULT_CONFIG, out: null, dryRun: false, allowNetwork: false, voiceReferenceConsent: false, textTransmissionApproved: false,
    localVoiceAuthorized: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--allow-network") options.allowNetwork = true;
    else if (arg === "--voice-consent") options.voiceReferenceConsent = true;
    else if (arg === "--transmit-text") options.textTransmissionApproved = true;
    else if (arg === "--local-voice-consent") options.localVoiceAuthorized = true;
    else if (arg === "--config" || arg === "--out") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) fail(`${arg} needs a path`);
      options[arg.slice(2)] = resolve(value);
    } else if (arg.startsWith("--")) fail(`Unknown option ${arg}`);
    else for (const char of [...arg].filter(c => c.trim() && c !== "," && c !== "、")) options.chars.push(char);
  }
  if (!options.chars.length) fail("Name at least one character, for example: pnpm video:kanji -- 水 火");
  options.chars = [...new Set(options.chars)];
  // Any character the data has works (kanji or kana); only letters, digits and marks are refused here.
  if (options.chars.some(char => /[\p{ASCII}\p{P}\p{S}]/u.test(char))) fail("Each character must be one your data has, such as a kanji");
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
  const provider = voice.provider ?? "fish";
  if (provider === "fish") {
    if (typeof voice.voiceId !== "string" || !/^[a-z0-9]{8,64}$/iu.test(voice.voiceId)) fail("config: voice.voiceId must be a Fish voice ID");
    if ((voice.modelId ?? "s2.1-pro-free") !== "s2.1-pro-free") fail("config: only the free Fish model s2.1-pro-free is supported");
  } else if (provider === "local") {
    for (const key of ["voiceId", "modelId", "engineRevision"]) if (typeof voice[key] !== "string" || !voice[key].trim() || voice[key].length > 128) fail(`config: a local voice needs voice.${key}`);
    if (typeof voice.endpoint !== "string" || !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+(\/|$)/u.test(voice.endpoint)) fail("config: voice.endpoint must be a loopback http URL with a port");
  } else fail("config: voice.provider must be fish or local");
  if (voice.pace !== undefined && !["slow", "measured", "fast"].includes(voice.pace)) fail("config: voice.pace must be slow, measured or fast");
  if (voice.licenseStatus !== undefined && !["unknown", "verified"].includes(voice.licenseStatus)) fail("config: voice.licenseStatus must be unknown or verified");
  const music = json.music ?? {};
  if (!/^[a-f0-9]{64}$/u.test(music.sha256 ?? "")) fail("config: music.sha256 must be the SHA-256 of the reviewed music file");
  for (const key of ["title", "source", "license"]) if (typeof music[key] !== "string" || !music[key].trim()) fail(`config: music.${key} is required`);
  if (music.startSeconds !== undefined && !(Number.isFinite(music.startSeconds) && music.startSeconds >= 0)) fail("config: music.startSeconds must be a number of seconds");
  if (music.belowVoiceDb !== undefined && !(music.belowVoiceDb >= 6 && music.belowVoiceDb <= 30)) fail("config: music.belowVoiceDb must be 6 to 30");
  const timing = json.timing ?? {};
  // The writing passes and the holds; the lines' own timing is in the narration script.
  const ranges = { write: [3, 20], review: [3, 20], tail: [.5, 5], introTail: [0, 2] };
  for (const key of Object.keys(timing)) {
    if (!Object.hasOwn(ranges, key)) fail(`config: timing.${key} is not a setting (${Object.keys(ranges).join(", ")})`);
    const [min, max] = ranges[key];
    if (!(Number.isFinite(timing[key]) && timing[key] >= min && timing[key] <= max)) fail(`config: timing.${key} must be ${min} to ${max} seconds`);
  }
  const narration = { ...json.narration };
  const isText = (value, max) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  for (const key of Object.keys(narration)) if (!["script", "labels", "speech"].includes(key)) fail(`config: narration.${key} is not a setting (script, labels, speech)`);
  // The script: a file (relative to this config) or the script itself; checked when a short is made.
  if (narration.script !== undefined) {
    if (typeof narration.script === "string") narration.script = path(narration.script, "narration.script");
    else if (!isObject(narration.script)) fail("config: narration.script must be a file or an anchored-narration script");
  }
  if (narration.labels !== undefined && !(narration.labels && isText(narration.labels.on, 20) && isText(narration.labels.kun, 20)))
    fail("config: narration.labels needs both on and kun, for example { \"on\": \"おんよみ\", \"kun\": \"くんよみ\" }");
  if (narration.speech !== undefined && !(narration.speech && typeof narration.speech === "object" && !Array.isArray(narration.speech) &&
    Object.entries(narration.speech).every(([word, text]) => isText(word, 40) && isText(text, 40))))
    fail("config: narration.speech maps a word to the text the voice reads, for example { \"水泳\": \"すいえい\" }");
  const card = json.card ?? {};
  for (const key of Object.keys(card)) if (!["heading", "density", "labels", "theme", "brushStyle", "typeStep", "strokeNumbers"].includes(key))
    fail(`config: card.${key} is not a setting (heading, density, labels, theme, brushStyle, typeStep, strokeNumbers)`);
  if (card.density !== undefined && !["regular", "compact"].includes(card.density)) fail("config: card.density must be regular or compact");
  if (card.heading !== undefined && !(typeof card.heading === "string" && card.heading.length <= 30)) fail("config: card.heading must be at most 30 characters");
  if (card.labels !== undefined && !(isObject(card.labels) && Object.entries(card.labels).every(([k, v]) => ["onyomi", "kunyomi", "words", "jlpt"].includes(k) && isText(v, 30))))
    fail("config: card.labels sets onyomi, kunyomi, words and jlpt to texts of at most 30 characters");
  if (card.theme !== undefined && !(isObject(card.theme) && Object.values(card.theme).every(v => isText(v, 200))))
    fail("config: card.theme sets colours (#RRGGBB) and font stacks as texts");
  if (card.brushStyle !== undefined && !isObject(card.brushStyle)) fail("config: card.brushStyle must be an object of brush, ink, paper and hand settings");
  if (card.typeStep !== undefined && !(Number.isFinite(card.typeStep) && card.typeStep >= .05 && card.typeStep <= .6)) fail("config: card.typeStep must be 0.05 to 0.6 seconds");
  if (card.strokeNumbers !== undefined && typeof card.strokeNumbers !== "boolean") fail("config: card.strokeNumbers must be true or false");
  if (json.credits !== undefined && !(Array.isArray(json.credits) && json.credits.every(line => typeof line === "string" && line.length <= 400))) fail("config: credits must be lines of text");
  if (json.maxWords !== undefined && !(Number.isInteger(json.maxWords) && json.maxWords >= 1 && json.maxWords <= 6)) fail("config: maxWords must be 1 to 6 (the card shows up to 6)");
  for (const [key, min, max] of [["fadeInMs", 0, 5000], ["fadeOutMs", 0, 5000]])
    if (music[key] !== undefined && !(Number.isInteger(music[key]) && music[key] >= min && music[key] <= max)) fail(`config: music.${key} must be ${min} to ${max} ms`);
  const qa = json.qa ?? {};
  for (const key of Object.keys(qa)) if (!["stillBudgetSeconds", "anchorDriftSeconds"].includes(key)) fail(`config: qa.${key} is not a setting (stillBudgetSeconds, anchorDriftSeconds)`);
  for (const key of Object.keys(qa)) if (!(Number.isFinite(qa[key]) && qa[key] > 0 && qa[key] <= 30)) fail(`config: qa.${key} must be 0 to 30 seconds`);
  const captions = json.captions ?? {};
  for (const key of Object.keys(captions)) if (key !== "tailSeconds") fail(`config: captions.${key} is not a setting (tailSeconds)`);
  if (captions.tailSeconds !== undefined && !(Number.isFinite(captions.tailSeconds) && captions.tailSeconds >= 0 && captions.tailSeconds <= 3)) fail("config: captions.tailSeconds must be 0 to 3");
  return {
    dataset: path(json.dataset, "dataset"), outputRoot: path(json.outputRoot, "outputRoot"),
    cacheDir: json.cacheDir ? path(json.cacheDir, "cacheDir") : join(dirname(configPath), "cache"),
    destination, voice: { ...voice, provider }, music: { ...music, path: path(music.path, "music.path") }, narration, timing, card, credits: json.credits ?? [],
    ...(json.maxWords !== undefined ? { maxWords: json.maxWords } : {}), qa, captions,
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
    const script = await kanjiNarrationScript(config);
    for (const char of args.chars) {
      const entry = entries.get(char);
      if (!entry) { log(`${char}: not in the kanji data`); continue; }
      for (const problem of problems.filter(p => p.includes(`(${char})`))) log(`${char}: kanji data problem: ${problem}`);
      const content = kanjiShortContent(entry, { speech: config.narration.speech, maxWords: config.maxWords ?? 3 });
      log(`${char}  ${content.meanings} · JLPT ${content.jlpt ?? "-"} · typed ${content.name.kana} → ${char}`);
      // Stroke lines need the stroke count: from cached KanjiVG data only, never the network.
      let strokeCount = 0;
      try {
        const planner = await (deps.loadKanjiPlanner ?? loadKanjiPlanner)();
        const { svg } = await (deps.kanjiVgSvg ?? kanjiVgSvg)(char, { planner, cacheDir: config.cacheDir, allowNetwork: false });
        strokeCount = (await planner.glyphFromKanjiVg(char, svg)).strokes.length;
      } catch { if (script.steps.some(step => step.forEach === "strokes")) log(`  (stroke lines are left out: ${char}'s KanjiVG data is not cached yet)`); }
      for (const line of expandNarrationScript(script, kanjiScriptData(content, { labels: config.narration.labels, strokeCount })))
        log(`  ${line.id.padEnd(9)} [${line.locale} @ ${line.at}${line.offset ? ` ${line.offset >= 0 ? "+" : ""}${line.offset} s` : ""}] ${line.say}${line.caption !== line.say ? `   (caption: ${line.caption})` : ""}`);
      log(`  words     ${content.words.map(w => `${w.word} (${w.ruby}, ${w.meaning})`).join(" · ")}`);
    }
    return [];
  }
  // The Fish key only for a Fish voice; a local voice needs none.
  const apiKey = config.voice.provider === "fish" ? await (deps.providerKey ?? productionProviderKey)("fish", { env }) : undefined;
  const browserExecutable = await (deps.findBrowser ?? findChromium)(env);
  const results = [];
  for (const char of args.chars) {
    const out = await nextOutputDir(config.outputRoot, char);
    log(`${char}: ${out}`);
    const result = await (deps.produce ?? produceKanjiShort)({
      char, config, out, apiKey, browserExecutable, allowNetwork: args.allowNetwork,
      voiceReferenceConsent: args.voiceReferenceConsent, textTransmissionApproved: args.textTransmissionApproved, localVoiceAuthorized: args.localVoiceAuthorized,
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
