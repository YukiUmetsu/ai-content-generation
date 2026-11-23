/**
 * What the CLI and the Studio page share for kanji shorts: the settings file (read, edited and
 * saved), a preview of what each short shows and says, and the releases already made.
 * No network, no render: making a short is produceKanjiShort.
 */
import { createHash } from "node:crypto";
import { lstat, open, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { expandNarrationScript } from "./anchored-narration.mjs";
import { readKanjiConfig } from "./kanji-config.mjs";
import { kanjiScriptData, kanjiShortContent, kanjiTextSettings, readKanjiDataset, retakeFor, reuseFor, reuseSources, spokenAs } from "./kanji-short.mjs";
import { kanjiNarrationScript, kanjiPartOptions, kanjiVgSvg, loadKanjiPlanner } from "./kanji-short-producer.mjs";
import { kanjiSpokenParts } from "./kanji-short.mjs";
import { voiceFor } from "./voice-runs.mjs";

const fail = (message) => { throw new Error(message); };
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/** The settings file and its kanji data. `revision` is the file's hash, so a save never overwrites an edit made meanwhile. */
export async function readKanjiStudio(configPath) {
  const text = await readFile(configPath, "utf8");
  const raw = JSON.parse(text);
  const config = readKanjiConfig(raw, configPath);
  const { entries, problems } = readKanjiDataset(JSON.parse(await readFile(config.dataset, "utf8")));
  return { configPath, revision: sha256(text), raw, config, entries, problems };
}

/**
 * Every kanji of the data, in its order: what the Studio's picker lists. A kanji the producer
 * cannot make (no useful word, no reading) is listed with its `problem`, never dropped silently.
 */
export function kanjiCatalog(entries, { names = {} } = {}) {
  return [...entries.values()].map(entry => {
    try {
      let content, nameProblem;
      try { content = kanjiShortContent(entry, { name: names[entry.char] }); }
      catch (error) { if (!names[entry.char]) throw error; content = kanjiShortContent(entry); nameProblem = String(error.message); }
      return { char: content.char, jlpt: content.jlpt ?? null, meanings: content.meanings, name: content.name, ...(nameProblem ? { nameProblem } : {}) };
    } catch (error) {
      return { char: entry.char, jlpt: entry.jlpt ?? null, meanings: String(entry.card?.meanings ?? ""), name: { kana: "", romaji: "" }, problem: String(error.message) };
    }
  });
}

/**
 * What one short shows and says, before any voice: its lines with the voice of each part, the
 * reuses and retakes that apply (and why a reuse does not), and its words. Stroke lines need the
 * stroke count, from cached KanjiVG data only, never the network.
 */
export async function previewKanjiShorts(studio, chars, deps = {}) {
  const { config, entries, problems } = studio;
  const script = await (deps.narrationScript ?? kanjiNarrationScript)(config);
  const previews = [];
  for (const char of chars) {
    const entry = entries.get(char);
    if (!entry) { previews.push({ char, found: false }); continue; }
    let content;
    try { content = kanjiShortContent(entry, { speech: config.narration.speech, maxWords: config.maxWords ?? 3, name: config.names?.[char] }); }
    catch (error) {
      // A name the kanji does not have (the data changed): the problem, with the names it can be called by.
      let nameChoices;
      if (config.names?.[char]) try { nameChoices = kanjiShortContent(entry, { speech: config.narration.speech, maxWords: config.maxWords ?? 3 }).nameChoices; } catch { /* another problem too */ }
      previews.push({ char, found: true, problem: String(error.message), ...(nameChoices ? { nameChoices, badName: config.names[char] } : {}) }); continue;
    }
    let strokeCount = null;
    try {
      const planner = await (deps.loadKanjiPlanner ?? loadKanjiPlanner)();
      const { svg } = await (deps.kanjiVgSvg ?? kanjiVgSvg)(char, { planner, cacheDir: config.cacheDir, allowNetwork: false });
      strokeCount = (await planner.glyphFromKanjiVg(char, svg)).strokes.length;
    } catch { /* not cached yet: the stroke lines are left out of the preview */ }
    const data = kanjiScriptData(content, { labels: config.narration.labels, strokeCount: strokeCount ?? 0 });
    const lines = expandNarrationScript(script, data);
    const voiceIds = config.voice.voiceIds;
    // What one recording reads: a line's parts, as the producer reads them (kanjiSpokenParts).
    const partsOf = (line) => kanjiSpokenParts(line, kanjiPartOptions(config));
    const reuse = kanjiTextSettings(config.narration.reuse, data), retakes = kanjiTextSettings(config.narration.retakes, data);
    const units = lines.flatMap(line => partsOf(line).map(part => ({ line: line.id, text: spokenAs(part.text, config.narration.speech) ?? part.text, written: part.text,
      locale: part.locale, phrase: part.phrase, reusedFrom: reuseFor(part.text, reuse) })));
    const reuses = reuseSources(units);
    previews.push({
      char, found: true, meanings: content.meanings, jlpt: content.jlpt ?? null, name: content.name, nameChoices: content.nameChoices,
      dataProblems: problems.filter(problem => problem.includes(`(${char})`)),
      strokeLinesLeftOut: strokeCount === null && script.steps.some(step => step.forEach === "strokes"),
      words: content.words.map(word => ({ word: word.word, ruby: word.ruby, meaning: word.meaning })),
      lines: lines.map(line => {
        const parts = units.filter(unit => unit.line === line.id);
        return {
          id: line.id, locale: line.locale, at: line.at, offset: line.offset ?? 0, say: line.say, caption: line.caption,
          // Split: read in runs by more than one voice, or by a voice of another language than the line's.
          split: parts.length > 1 || parts[0]?.locale !== line.locale,
          parts: parts.map(unit => {
            const found = reuses.get(unit), chosen = retakeFor(unit.text, retakes), take = chosen > 1 ? chosen : undefined;
            return {
              text: unit.written, ...(unit.text !== unit.written ? { spoken: unit.text } : {}),
              locale: unit.locale, voiceId: voiceFor(unit.locale, voiceIds, config.voice.voiceId), phrase: unit.phrase,
              ...(found?.cut ? { reuse: { from: found.from, whole: found.cut.whole, source: found.source.text } } : found ? { reuse: { from: [unit.reusedFrom].flat().join(", "), skipped: found.why } } : {}),
              ...(take && !found?.cut ? { retake: take } : {}),
              // The recording this part is heard from: its own, or for a reused part the other line's part.
              // `written` is the part as its line says it: the key a "read as" (narration.speech) is saved under.
              recording: found?.cut ? { text: found.source.text, written: found.source.written ?? found.source.text, locale: found.source.locale,
                take: Math.max(1, retakeFor(found.source.text, retakes) ?? 1) }
                : { text: unit.text, written: unit.written, locale: unit.locale, take: take ?? 1 },
            };
          }),
        };
      }),
    });
  }
  return previews;
}

/** The dry run's text for one preview, as `pnpm video:kanji -- 水 --dry-run` prints it. */
export function previewText(preview) {
  if (!preview.found) return [`${preview.char}: not in the kanji data`];
  if (preview.problem) return [`${preview.char}: ${preview.problem}`];
  const out = preview.dataProblems.map(problem => `${preview.char}: kanji data problem: ${problem}`);
  out.push(`${preview.char}  ${preview.meanings} · JLPT ${preview.jlpt ?? "-"} · typed ${preview.name.kana} → ${preview.char}` +
    (preview.nameChoices?.length > 1 ? `   (names it can be called by: ${preview.nameChoices.map(c => c.kana).join(", ")})` : ""));
  if (preview.strokeLinesLeftOut) out.push(`  (stroke lines are left out: ${preview.char}'s KanjiVG data is not cached yet)`);
  for (const line of preview.lines) {
    out.push(`  ${line.id.padEnd(9)} [${line.locale} @ ${line.at}${line.offset ? ` ${line.offset >= 0 ? "+" : ""}${line.offset} s` : ""}] ${line.say}${line.caption !== line.say ? `   (caption: ${line.caption})` : ""}`);
    if (!line.split && line.parts.length === 1 && line.parts[0].phrase) out.push("            phrase: one recording, used in every short");
    if (line.split) out.push(`            parts: ${line.parts.map(part => `"${part.text}" ${part.locale} (${part.voiceId.slice(0, 8)}…)${part.phrase ? " phrase" : ""}`).join(" + ")}`);
    for (const part of line.parts) {
      if (part.reuse && !part.reuse.skipped) out.push(`            reuse: "${part.text}" is read with line ${part.reuse.from}'s recording of "${part.reuse.source}"${part.reuse.whole ? "" : " (its part after the last comma)"}`);
      else if (part.reuse) out.push(`            reuse: not here (${part.reuse.skipped}); "${part.text}" is read on its own`);
      if (part.spoken) out.push(`            spoken as: "${part.text}" is read as "${part.spoken}"`);
      if (part.retake) out.push(`            retake: "${part.spoken ?? part.text}" take ${part.retake}`);
    }
  }
  out.push(`  words     ${preview.words.map(word => `${word.word} (${word.ruby}, ${word.meaning})`).join(" · ")}`);
  return out;
}

/** A release folder's name for a kanji: <char>-<code point in hex>, as nextOutputDir makes it. */
export const releaseFolder = (char) => `${char}-${char.codePointAt(0).toString(16)}`;
const FOLDER = /^(.+)-([0-9a-f]{2,6})$/u, VERSION = /^v(\d{1,5})$/u;
/** The kanji a release folder is for, or null for any other folder (upload-202611, 水-6c35). */
export function releaseChar(folder) {
  const match = FOLDER.exec(folder), code = match ? Number.parseInt(match[2], 16) : NaN;
  if (!(code <= 0x10ffff)) return null;
  const char = String.fromCodePoint(code);
  return match[1] === char ? char : null;
}

/** A small JSON file, or null when it is missing, too big or not JSON. */
async function readSmallJson(path, maxBytes = 2_000_000) {
  const handle = await open(path, "r").catch(() => null);
  if (!handle) return null;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes) return null;
    return JSON.parse(await handle.readFile("utf8"));
  } catch { return null; } finally { await handle.close(); }
}

/** One release's QA in short: what the Studio shows next to the video. */
export function kanjiQaSummary(qa) {
  if (!qa || typeof qa !== "object") return null;
  const name = qa.speech?.find(line => line.id === "question")?.voiceRuns?.find(run => run.reusedFrom);
  return {
    seconds: qa.video?.seconds ?? null, lufs: qa.audio?.integratedLufs ?? null, truePeak: qa.audio?.truePeakDbtp ?? null,
    longestStill: qa.pacing?.longestStillSeconds ?? null, warnings: Array.isArray(qa.warnings) ? qa.warnings.map(String) : [],
    technicalPass: qa.technicalPass === true, reviewStatus: typeof qa.reviewStatus === "string" ? qa.reviewStatus : "not-reviewed",
    ...(name ? { nameReusedFrom: name.reusedFrom } : {}),
  };
}

/**
 * The releases under the output root, newest version first: [{ char, folder, versions: [{ version,
 * releaseDir, video, createdAt, qa }] }]. With `chars`, only those kanji, and only they have their QA read.
 * Folders that are not a kanji's release folder, links and versions without a release are skipped.
 */
export async function kanjiReleases(outputRoot, { chars } = {}) {
  let folders;
  try { folders = await readdir(outputRoot, { withFileTypes: true }); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const wanted = chars ? new Set(chars) : null, out = [];
  for (const folder of folders) {
    const char = folder.isDirectory() ? releaseChar(folder.name) : null;
    if (!char || (wanted && !wanted.has(char))) continue;
    const versions = [];
    for (const version of await readdir(join(outputRoot, folder.name), { withFileTypes: true })) {
      const number = VERSION.exec(version.name)?.[1];
      if (!number || !version.isDirectory()) continue;
      const releaseDir = join(outputRoot, folder.name, version.name, "release");
      const video = await lstat(join(releaseDir, "video.mp4")).catch(() => null);
      if (!video?.isFile()) continue;
      versions.push({ version: Number(number), releaseDir, createdAt: video.mtime.toISOString(),
        ...(wanted ? { qa: kanjiQaSummary(await readSmallJson(join(releaseDir, "qa-report.json"))) } : {}) });
    }
    if (versions.length) out.push({ char, folder: folder.name, versions: versions.sort((a, b) => b.version - a.version) });
  }
  return out;
}

/**
 * The settings the Studio page edits, by their path in the config file. Everything else in the
 * file (data, music, script, card look) stays as it is, edited by hand.
 */
export const KANJI_STUDIO_SETTINGS = Object.freeze(["voice.voiceId", "voice.voiceIds", "voice.pace", "narration.reuse", "narration.retakes", "narration.speech",
  "maxWords", "card.safeInset", "timing.write", "timing.review"]);
const getPath = (object, path) => path.split(".").reduce((value, key) => value?.[key], object);

/** The Studio's settings from a config file's JSON: each path's value, or null when the file leaves it to the default. */
export function kanjiStudioSettings(raw) {
  return Object.fromEntries(KANJI_STUDIO_SETTINGS.map(path => [path, getPath(raw, path) ?? null]));
}

/**
 * The config file's JSON with the Studio's changes: { path: value } sets a setting, { path: null }
 * goes back to its default. Any other path is refused, and the result must pass readKanjiConfig.
 */
export function applyKanjiStudioSettings(raw, changes, configPath) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) fail("settings: send the changed settings as { path: value }");
  const next = structuredClone(raw);
  for (const [path, value] of Object.entries(changes)) {
    if (!KANJI_STUDIO_SETTINGS.includes(path)) fail(`settings: ${path} is not a setting the Studio edits (${KANJI_STUDIO_SETTINGS.join(", ")})`);
    const keys = path.split("."), last = keys.pop();
    let parent = next;
    for (const key of keys) {
      if (parent[key] === undefined) { if (value === null) { parent = null; break; } parent[key] = {}; }
      if (!parent[key] || typeof parent[key] !== "object" || Array.isArray(parent[key])) fail(`settings: ${keys.join(".")} in the config file is not an object`);
      parent = parent[key];
    }
    if (!parent) continue;
    if (value === null) delete parent[last]; else parent[last] = value;
  }
  readKanjiConfig(next, configPath);
  return next;
}

/**
 * Write the config file in one step (a temporary file in its folder, then a rename), only if it
 * still has the revision the changes were made on: an edit by hand meanwhile is never overwritten.
 */
export async function saveKanjiConfig(configPath, json, revision) {
  const target = await realpath(configPath);
  const current = await readFile(target, "utf8");
  if (sha256(current) !== revision) fail("settings: the config file changed since it was loaded; reload and make the change again");
  const info = await stat(target);
  const text = `${JSON.stringify(json, null, 2)}\n`;
  const temp = join(dirname(target), `.${basename(target)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(temp, text, { mode: info.mode & 0o777, flag: "wx" });
    await rename(temp, target);
  } catch (error) { await rm(temp, { force: true }); throw error; }
  return sha256(text);
}
