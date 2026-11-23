#!/usr/bin/env node
/** Make kanji study shorts from the command line.
 *
 *   pnpm video:kanji -- 水 火 木 --allow-network --voice-consent --transmit-text   # Fish voice
 *   pnpm video:kanji -- 水 --local-voice-consent                                   # a local voice (voice.provider "local")
 *   pnpm video:kanji -- 水 --dry-run          # what each short shows and says; no network, no render
 *   pnpm video:kanji -- 水 --dry-run --json   # the same as JSON
 *   pnpm video:kanji -- 年 --takes            # every recorded part's takes, with their pitch, and the take in use
 *   pnpm video:kanji -- 年 --new-take "とし。" --allow-network --voice-consent --transmit-text   # record one more take
 *
 * Settings live in a local config file (default: <repo>/data/kanji-shorts/config.json; see
 * fixtures/kanji-short/config.example.json). Each kanji gets its own output folder with a
 * numbered version, so a new run never overwrites an earlier release.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { produceKanjiShort } from "./kanji-short-producer.mjs";
import { productionProviderKey } from "./provider-keychain.mjs";
import { DEFAULT_CONFIG, nextOutputDir, readKanjiConfig } from "./kanji-config.mjs";
import { previewKanjiShorts, previewText, readKanjiStudio } from "./kanji-studio.mjs";
import { kanjiTakes, recordKanjiTake, takeMeasure } from "./kanji-takes.mjs";
import { findChromium } from "./try.mjs";

// The settings file's reader and the release folders, for callers that import them from here.
export { DEFAULT_CONFIG, nextOutputDir, readKanjiConfig };

const fail = (message) => { throw new Error(message); };
/** A measured take in one line: its length and how its pitch moves. */
const takeLine = (m) => m.silent ? "silent: the voice returned no speech; record another take" : `${m.seconds} s · pitch ${m.shape === null ? "not measured (too little voiced)" : `${m.shape} (start to end ${m.rise > 0 ? "+" : ""}${m.rise} st, peak to end ${m.fall} st)`}`;

export function parseKanjiArgs(argv) {
  const options = { chars: [], config: DEFAULT_CONFIG, out: null, dryRun: false, json: false, takes: false, newTake: null, allowNetwork: false, voiceReferenceConsent: false, textTransmissionApproved: false,
    localVoiceAuthorized: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--takes") options.takes = true;
    else if (arg === "--new-take") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) fail("--new-take needs the text to record, as --takes lists it, for example \"とし。\"");
      options.newTake = value;
    }
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
  if (options.json && !options.dryRun) fail("--json is for --dry-run: it prints the preview as JSON");
  if ([options.dryRun, options.takes, options.newTake !== null].filter(Boolean).length > 1) fail("Choose one of --dry-run, --takes and --new-take");
  options.chars = [...new Set(options.chars)];
  // Any character the data has works (kanji or kana); only letters, digits and marks are refused here.
  if (options.chars.some(char => /[\p{ASCII}\p{P}\p{S}]/u.test(char))) fail("Each character must be one your data has, such as a kanji");
  return options;
}

export async function main(argv = process.argv.slice(2), env = process.env, deps = {}) {
  const args = parseKanjiArgs(argv);
  const config = readKanjiConfig(JSON.parse(await readFile(args.config, "utf8")), args.config);
  if (args.out) config.outputRoot = args.out;
  const log = deps.log ?? ((line) => process.stdout.write(`${line}\n`));
  if (args.dryRun) {
    const studio = await readKanjiStudio(args.config);
    const previews = await previewKanjiShorts({ ...studio, config }, args.chars, deps);
    if (args.json) log(JSON.stringify(previews, null, 2));
    else for (const preview of previews) for (const line of previewText(preview)) log(line);
    // Every kanji is shown first; one that cannot be made then fails the run, as it would fail making it.
    const unusable = previews.filter(preview => preview.problem);
    if (unusable.length) fail(unusable.map(preview => `${preview.char}: ${preview.problem}`).join("; "));
    return [];
  }
  if (args.takes || args.newTake !== null) {
    const studio = await readKanjiStudio(args.config);
    const previews = await previewKanjiShorts({ ...studio, config }, args.chars, deps);
    // A kanji that is not in the data, or cannot be made, has no recordings: say why, and fail after listing the others.
    const unusable = previews.filter(preview => !preview.lines);
    for (const preview of unusable) for (const line of previewText(preview)) log(line);
    if (args.newTake !== null && unusable.length) fail(unusable.map(preview => previewText(preview)[0]).join("; "));
    // Each recording once (a phrase is the same recording in every short), in the order it is heard.
    const recordings = new Map();
    for (const preview of previews.filter(p => p.lines)) for (const line of preview.lines) for (const part of line.parts) {
      const key = `${part.recording.locale}:${part.recording.text}`;
      if (!recordings.has(key)) recordings.set(key, { ...part.recording, phrase: part.phrase, chars: new Set() });
      recordings.get(key).chars.add(preview.char);
    }
    if (args.newTake !== null) {
      const wanted = [...recordings.values()].find(r => r.text === args.newTake);
      if (!wanted) fail(`"${args.newTake}" is not a recorded part of ${args.chars.join(" ")}; --takes lists them`);
      const apiKey = config.voice.provider === "fish" ? await (deps.providerKey ?? productionProviderKey)("fish", { env }) : undefined;
      if (config.voice.provider === "fish" && !(args.allowNetwork && args.voiceReferenceConsent && args.textTransmissionApproved))
        fail("Recording a take with Fish sends the text to Fish Audio: add --allow-network --voice-consent --transmit-text");
      if (config.voice.provider === "local" && !args.localVoiceAuthorized) fail("Recording a take with the local voice needs --local-voice-consent");
      const made = await (deps.recordTake ?? recordKanjiTake)(config, wanted, { apiKey });
      const measured = await (deps.measureTake ?? takeMeasure)(made.wavPath);
      log(`"${wanted.text}" take ${made.take}: ${takeLine(measured)}`);
      log(`  to use it: narration.retakes { ${JSON.stringify(wanted.text)}: ${made.take} } in the settings file, or choose it on the Studio's Kanji shorts page`);
      return [];
    }
    for (const recording of recordings.values()) {
      const takes = await (deps.listTakes ?? kanjiTakes)(config, recording);
      log(`"${recording.text}" ${recording.locale}${recording.phrase ? " · phrase, used in every short" : ` · ${[...recording.chars].join(" ")}`} · take ${recording.take} in use`);
      if (!takes.length) log("    not recorded yet");
      for (const take of takes) log(`    take ${take.take}${take.take === recording.take ? " (in use)" : ""}: ${takeLine(await (deps.measureTake ?? takeMeasure)(take.wavPath))}`);
    }
    if (unusable.length) fail(unusable.map(preview => previewText(preview)[0]).join("; "));
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
