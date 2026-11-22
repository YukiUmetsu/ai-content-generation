/** The kanji shorts' local settings file: reading and checking it, and where each release goes. Shared by the CLI and the Studio page. */
import { readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import presets from "../../src/components/video/platform-presets.json" with { type: "json" };
import { kanjiCardInset, kanjiCardInsetProblem, textKeyProblem } from "./kanji-short.mjs";
import { localSpeechEndpoint } from "./local.mjs";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
export const DEFAULT_CONFIG = join(repoRoot, "data", "kanji-shorts", "config.json");
const fail = (message) => { throw new Error(message); };

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
    // The local adapter's own endpoint rule, so a bad endpoint stops here, not at the first line.
    try { localSpeechEndpoint(voice.endpoint); } catch (error) { fail(`config: voice.endpoint: ${error.message}`); }
  } else fail("config: voice.provider must be fish or local");
  if (voice.pace !== undefined && !["slow", "measured", "fast"].includes(voice.pace)) fail("config: voice.pace must be slow, measured or fast");
  // A voice per language: { "ja": "<id>", "en": "<id>" }. Lines that mix scripts are read in runs, each by its language's voice.
  if (voice.voiceIds !== undefined && !(voice.voiceIds && typeof voice.voiceIds === "object" && !Array.isArray(voice.voiceIds) && Object.keys(voice.voiceIds).length > 0 &&
    Object.entries(voice.voiceIds).every(([lang, id]) => /^[a-z]{2,3}$/u.test(lang) && typeof id === "string" &&
      (provider === "fish" ? /^[a-z0-9]{8,64}$/iu.test(id) : id.trim() === id && id.length > 0 && id.length <= 128))))
    fail("config: voice.voiceIds maps a language (ja, en…) to a voice ID, for example { \"ja\": \"<id>\", \"en\": \"<id>\" }");
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
  const narrationKeys = ["script", "labels", "speech", "retakes", "reuse", "splitPhrases", "phraseGap"];
  for (const key of Object.keys(narration)) if (!narrationKeys.includes(key)) fail(`config: narration.${key} is not a setting (${narrationKeys.join(", ")})`);
  // Phrases said in every short are one recording each: a line is read in parts at its template's commas.
  if (narration.splitPhrases !== undefined && typeof narration.splitPhrases !== "boolean") fail("config: narration.splitPhrases must be true or false");
  if (narration.phraseGap !== undefined && !(Number.isFinite(narration.phraseGap) && narration.phraseGap >= 0 && narration.phraseGap <= 1)) fail("config: narration.phraseGap must be 0 to 1 seconds");
  // A key may name the kanji's fields, so one entry covers every kanji: { "{name.kana}": "kunyomi" }.
  for (const key of ["reuse", "retakes"]) for (const text of Object.keys(isObject(narration[key]) ? narration[key] : {})) {
    const problem = textKeyProblem(text);
    if (problem) fail(`config: narration.${key}: ${problem}`);
  }
  // Read a text as the last phrase of another line: { "ひと": "kunyomi" } reads the name as in "くんよみ、ひと。".
  if (narration.reuse !== undefined && !(narration.reuse && typeof narration.reuse === "object" && !Array.isArray(narration.reuse) &&
    Object.entries(narration.reuse).every(([text, line]) => text.trim() && text.length <= 400 && typeof line === "string" && /^[A-Za-z0-9_-]{1,60}$/u.test(line))))
    fail("config: narration.reuse maps a spoken text to the line whose last phrase it is read from, for example { \"ひと\": \"kunyomi\" }");
  // A new take of a text the voice flubbed: { "ひと": 2 }; raise the number for another take.
  if (narration.retakes !== undefined && !(narration.retakes && typeof narration.retakes === "object" && !Array.isArray(narration.retakes) &&
    Object.entries(narration.retakes).every(([text, take]) => text.trim() && text.length <= 400 && Number.isInteger(take) && take >= 2 && take <= 99)))
    fail("config: narration.retakes maps a spoken text to a take number from 2, for example { \"ひと\": 2 }");
  // The script: a file (relative to this config) or the script itself; checked when a short is made.
  if (narration.script !== undefined) {
    if (typeof narration.script === "string") narration.script = path(narration.script, "narration.script");
    else if (!isObject(narration.script)) fail("config: narration.script must be a file or an anchored-narration script");
  }
  if (narration.labels !== undefined && !(narration.labels && isText(narration.labels.on, 20) && isText(narration.labels.kun, 20)))
    fail("config: narration.labels needs both on and kun, for example { \"on\": \"おんよみ\", \"kun\": \"くんよみ\" }");
  if (narration.speech !== undefined && !(narration.speech && typeof narration.speech === "object" && !Array.isArray(narration.speech) &&
    Object.entries(narration.speech).every(([word, text]) => isText(word, 40) && isText(text, 40))))
    fail("config: narration.speech maps a word, or a part of a line, to the text the voice reads, for example { \"水泳\": \"すいえい\", \"いま。\": \"今。\" }");
  const card = json.card ?? {};
  for (const key of Object.keys(card)) if (!["heading", "density", "labels", "theme", "brushStyle", "typeStep", "strokeNumbers", "safeInset"].includes(key))
    fail(`config: card.${key} is not a setting (heading, density, labels, theme, brushStyle, typeStep, strokeNumbers, safeInset)`);
  if (card.safeInset !== undefined && !(isObject(card.safeInset) && Object.entries(card.safeInset).every(([k, v]) =>
    ["left", "right", "top", "bottom"].includes(k) && Number.isFinite(v) && v >= 0 && v <= .4)))
    fail("config: card.safeInset sets left, right, top or bottom to a share of the frame from 0 to 0.4");
  // Over the destination's bands, as the producer uses them, so a dry run catches it too.
  const insetProblem = kanjiCardInsetProblem(kanjiCardInset(presets.find(p => p.id === destination).safeInset, card.safeInset));
  if (insetProblem) fail(`config: card.safeInset: ${insetProblem}`);
  if (card.density !== undefined && !["regular", "compact"].includes(card.density)) fail("config: card.density must be regular or compact");
  if (card.heading !== undefined && !(typeof card.heading === "string" && card.heading.length <= 30)) fail("config: card.heading must be at most 30 characters");
  const labelKeys = ["onyomi", "kunyomi", "words", "jlpt", "heading", "cardName", "writingName"];
  if (card.labels !== undefined && !(isObject(card.labels) && Object.entries(card.labels).every(([k, v]) => labelKeys.includes(k) && isText(v, 80))))
    fail(`config: card.labels sets ${labelKeys.join(", ")} to texts of at most 80 characters`);
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
