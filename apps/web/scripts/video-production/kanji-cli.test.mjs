import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, nextOutputDir, parseKanjiArgs, readKanjiConfig } from "./kanji-cli.mjs";
import { kanjiNarrationScript, kanjiVgSvg, loadKanjiPlanner, produceKanjiShort } from "./kanji-short-producer.mjs";

const VOICE = "984831ae0346415685b109090be3e798";
const config = (overrides = {}) => ({
  schemaVersion: 1, dataset: "data.json", outputRoot: "out", destination: "youtube-shorts",
  voice: { voiceId: VOICE }, music: { path: "bed.wav", sha256: "a".repeat(64), title: "Bed", source: "https://example.org/bed", license: "CC0 1.0" },
  ...overrides,
});
const MIZU = {
  char: "水", jlpt: "N5", card: { meanings: "WATER", onyomi: "SUI (スイ)", kunyomi: "mizu (みず)", jlpt: "N5" },
  words: [{ word: "水", ruby: "みず", romaji: "mizu", meaning: "water", reading: "kun" }, { word: "水道", ruby: "すいどう", romaji: "suidō", meaning: "water supply", reading: "on" }],
};

test("reads kanji from the arguments, one or many per argument, and refuses anything else", () => {
  const args = parseKanjiArgs(["--", "水火", "木", "水", "--allow-network", "--dry-run"]);
  assert.deepEqual(args.chars, ["水", "火", "木"]);
  assert.equal(args.allowNetwork, true);
  assert.equal(args.dryRun, true);
  assert.equal(args.voiceReferenceConsent, false);
  assert.deepEqual(parseKanjiArgs(["あ"]).chars, ["あ"]);                                // any character the data has, kana too
  assert.throws(() => parseKanjiArgs([]), /at least one character/u);
  assert.throws(() => parseKanjiArgs(["mizu"]), /one your data has/u);
  assert.throws(() => parseKanjiArgs(["水", "--fast"]), /Unknown option/u);
  assert.throws(() => parseKanjiArgs(["水", "--config"]), /needs a path/u);
});

test("reads the local config, resolving relative paths against its folder", () => {
  const read = readKanjiConfig(config(), "/home/me/kanji/config.json");
  assert.equal(read.dataset, "/home/me/kanji/data.json");
  assert.equal(read.music.path, "/home/me/kanji/bed.wav");
  assert.equal(read.cacheDir, "/home/me/kanji/cache");
  assert.throws(() => readKanjiConfig(config({ voice: { voiceId: "x" } }), "/c.json"), /Fish voice ID/u);
  assert.throws(() => readKanjiConfig(config({ voice: { voiceId: VOICE, modelId: "s2-pro" } }), "/c.json"), /only the free Fish model/u);
  assert.throws(() => readKanjiConfig(config({ music: { ...config().music, sha256: "nope" } }), "/c.json"), /music\.sha256/u);
  assert.throws(() => readKanjiConfig(config({ music: { ...config().music, license: "" } }), "/c.json"), /music\.license/u);
  assert.throws(() => readKanjiConfig(config({ destination: "youtube" }), "/c.json"), /1080 × 1920 short/u);
  assert.throws(() => readKanjiConfig(config({ timing: { write: 1 } }), "/c.json"), /timing\.write/u);
  assert.throws(() => readKanjiConfig({ ...config(), schemaVersion: 2 }, "/c.json"), /schemaVersion/u);
  assert.throws(() => readKanjiConfig(config({ timing: { wordGap: 1 } }), "/c.json"), /timing\.wordGap is not a setting/u);   // lines are timed by the script
  assert.throws(() => readKanjiConfig(config({ maxWords: 7 }), "/c.json"), /maxWords must be 1 to 6/u);
  assert.throws(() => readKanjiConfig(config({ qa: { stillBudget: 3 } }), "/c.json"), /qa\.stillBudget is not a setting/u);
  assert.throws(() => readKanjiConfig(config({ captions: { tailSeconds: 9 } }), "/c.json"), /captions\.tailSeconds/u);
  assert.throws(() => readKanjiConfig(config({ voice: { provider: "local", voiceId: "v", modelId: "m", engineRevision: "1", endpoint: "http://example.com:80" } }), "/c.json"), /voice\.endpoint/u);
  assert.throws(() => readKanjiConfig(config({ voice: { provider: "local", voiceId: "v", modelId: "m", engineRevision: "1", endpoint: "http://127.0.0.1:5002/v1" } }), "/c.json"), /voice\.endpoint/u);
  assert.equal(readKanjiConfig(config({ card: { labels: { heading: "{heading}：{char}", cardName: "{char}の読み" } } }), "/c.json").card.labels.heading, "{heading}：{char}");
  assert.equal(readKanjiConfig(config({ voice: { provider: "local", voiceId: "v", modelId: "m", engineRevision: "1", endpoint: "http://127.0.0.1:8123" } }), "/c.json").voice.provider, "local");
  assert.throws(() => readKanjiConfig(config({ timing: { writing: 5 } }), "/c.json"), /timing\.writing is not a setting/u);
  assert.throws(() => readKanjiConfig(config({ narration: { labels: { on: "オンよみ" } } }), "/c.json"), /both on and kun/u);
  assert.throws(() => readKanjiConfig(config({ narration: { speech: null } }), "/c.json"), /narration\.speech/u);
  assert.throws(() => readKanjiConfig(config({ narration: { question: "Q {name}?" } }), "/c.json"), /narration\.question is not a setting \(script, labels, speech, retakes, reuse, splitPhrases, phraseGap\)/u);
  assert.deepEqual(readKanjiConfig(config({ narration: { reuse: { "ひと": "kunyomi" } } }), "/c.json").narration.reuse, { "ひと": "kunyomi" });
  assert.throws(() => readKanjiConfig(config({ narration: { reuse: { "ひと": "kun yomi" } } }), "/c.json"), /narration\.reuse/u);
  assert.deepEqual(readKanjiConfig(config({ narration: { retakes: { "ひと": 2 } } }), "/c.json").narration.retakes, { "ひと": 2 });
  assert.throws(() => readKanjiConfig(config({ narration: { retakes: { "ひと": 1 } } }), "/c.json"), /narration\.retakes/u);
  assert.throws(() => readKanjiConfig(config({ narration: { script: 3 } }), "/c.json"), /narration\.script must be a file or/u);
  assert.equal(readKanjiConfig(config({ narration: { script: "my-script.json" } }), "/home/me/c.json").narration.script, "/home/me/my-script.json");
  assert.throws(() => readKanjiConfig(config({ card: { colour: "red" } }), "/c.json"), /card\.colour is not a setting/u);
  assert.throws(() => readKanjiConfig(config({ card: { labels: { title: "X" } } }), "/c.json"), /card\.labels/u);
  assert.throws(() => readKanjiConfig(config({ card: { typeStep: 2 } }), "/c.json"), /card\.typeStep/u);
  assert.throws(() => readKanjiConfig(config({ card: { brushStyle: [] } }), "/c.json"), /card\.brushStyle/u);
  assert.deepEqual(readKanjiConfig(config({ card: { safeInset: { bottom: .19 } } }), "/c.json").card.safeInset, { bottom: .19 });
  const voices = { ja: "34cfe2f12a8a4d9490e375fcb845642f", en: "59f85041c50240f08ba9b6fa2bff650d" };
  assert.deepEqual(readKanjiConfig(config({ voice: { voiceId: VOICE, voiceIds: voices } }), "/c.json").voice.voiceIds, voices);
  assert.throws(() => readKanjiConfig(config({ voice: { voiceId: VOICE, voiceIds: { japanese: voices.ja } } }), "/c.json"), /voice\.voiceIds/u);
  assert.throws(() => readKanjiConfig(config({ voice: { voiceId: VOICE, voiceIds: { ja: "x" } } }), "/c.json"), /voice\.voiceIds/u);
  assert.throws(() => readKanjiConfig(config({ card: { safeInset: { bottom: .5 } } }), "/c.json"), /card\.safeInset/u);
  assert.throws(() => readKanjiConfig(config({ card: { safeInset: { botom: .1 } } }), "/c.json"), /card\.safeInset/u);
  assert.throws(() => readKanjiConfig(config({ card: { safeInset: { top: .3, bottom: .3 } } }), "/c.json"), /top and bottom together cover 0\.6 of the frame/u);   // a dry run catches it too
});

test("gives each run of a kanji a new version folder, so a release is never overwritten", async () => {
  const root = await mkdtemp(join(tmpdir(), "kanji-out-"));
  try {
    assert.equal(await nextOutputDir(root, "水"), join(root, "水-6c34", "v1"));
    await mkdir(join(root, "水-6c34", "v1"), { recursive: true });
    await mkdir(join(root, "水-6c34", "v3"), { recursive: true });
    assert.equal(await nextOutputDir(root, "水"), join(root, "水-6c34", "v4"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a dry run shows what each short says, with no network, key or browser", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kanji-dry-"));
  try {
    await writeFile(join(dir, "data.json"), JSON.stringify({ kanji: [MIZU] }));
    await writeFile(join(dir, "config.json"), JSON.stringify(config()));
    const lines = [];
    const fail = () => { throw Error("must not be called in a dry run"); };
    await main(["水", "火", "--dry-run", "--config", join(dir, "config.json")], {}, { log: line => lines.push(line), providerKey: fail, findBrowser: fail, produce: fail });
    assert.match(lines[0], /^水 {2}WATER · JLPT N5 · typed みず → 水/u);
    assert.ok(lines.some(line => line.includes("[en @ start +0.35 s] Do you know how to write the kanji みず?") && line.includes("(caption: Do you know how to write the kanji mizu?)")));
    assert.ok(lines.some(line => line.includes("[ja @ review.end +0.3 s] 水道。")));
    assert.ok(lines.some(line => line.includes("words") && line.includes("水道") && !line.includes("水 (みず")));
    assert.ok(lines.includes("火: not in the kanji data"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("--takes lists each recording once with its takes; --new-take records one with the consents", async () => {
  assert.throws(() => parseKanjiArgs(["水", "--takes", "--dry-run"]), /Choose one of --dry-run, --takes and --new-take/u);
  assert.throws(() => parseKanjiArgs(["水", "--new-take"]), /--new-take needs the text/u);
  const dir = await mkdtemp(join(tmpdir(), "kanji-takes-cli-"));
  try {
    await writeFile(join(dir, "data.json"), JSON.stringify({ kanji: [MIZU] }));
    await writeFile(join(dir, "config.json"), JSON.stringify(config({ narration: { retakes: { "みず。": 2 } } })));
    const lines = [], measured = { seconds: .5, pitch: [], shape: "falls", rise: -2, fall: -3 };
    const deps = { log: line => lines.push(line), measureTake: async () => measured,
      listTakes: async (_config, recording) => recording.text === "みず。" ? [{ take: 1, wavPath: "a" }, { take: 2, wavPath: "b" }] : [] };
    await main(["水", "--takes", "--config", join(dir, "config.json")], {}, deps);
    assert.ok(lines.includes(`"おんよみ、" ja · phrase, used in every short · take 1 in use`), lines.join("\n"));
    assert.ok(lines.includes(`"みず。" ja · 水 · take 2 in use`));
    assert.ok(lines.includes("    take 2 (in use): 0.5 s · pitch falls (start to end -2 st, peak to end -3 st)"));
    assert.ok(lines.includes("    not recorded yet"));
    // Recording needs the consents, and a text that is one of the kanji's recordings.
    const recorded = [];
    const record = { ...deps, providerKey: async () => "key-0123456789", recordTake: async (_config, recording, options) => { recorded.push([recording, options]); return { take: 3, wavPath: "c" }; } };
    await assert.rejects(main(["水", "--new-take", "みず。", "--config", join(dir, "config.json")], {}, record), /--allow-network --voice-consent --transmit-text/u);
    await assert.rejects(main(["水", "--new-take", "ひと。", "--allow-network", "--voice-consent", "--transmit-text", "--config", join(dir, "config.json")], {}, record), /not a recorded part of 水/u);
    lines.length = 0;
    await main(["水", "--new-take", "みず。", "--allow-network", "--voice-consent", "--transmit-text", "--config", join(dir, "config.json")], {}, record);
    assert.deepEqual([recorded[0][0].text, recorded[0][0].locale, recorded[0][1].apiKey], ["みず。", "ja", "key-0123456789"]);
    assert.match(lines[0], /^"みず。" take 3: 0\.5 s · pitch falls/u);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a dry run shows every kanji it can, then fails for one the producer cannot make", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kanji-dry-bad-"));
  try {
    const lone = { char: "乙", jlpt: "N1", card: { meanings: "SECOND", onyomi: "OTSU (オツ)", kunyomi: "kinoto (きのと)" }, words: [{ word: "乙", ruby: "おつ", romaji: "otsu", meaning: "second", reading: "on" }] };
    await writeFile(join(dir, "data.json"), JSON.stringify({ kanji: [lone, MIZU] }));
    await writeFile(join(dir, "config.json"), JSON.stringify(config()));
    const lines = [];
    await assert.rejects(main(["乙", "水", "--dry-run", "--config", join(dir, "config.json")], {}, { log: line => lines.push(line) }), /乙: .*no useful word/u);
    assert.match(lines[0], /^乙: .*no useful word/u);
    assert.ok(lines.some(line => line.startsWith("水  WATER")), "the kanji after it is still shown");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a dry run prints its preview as JSON with --json, which needs --dry-run", async () => {
  assert.throws(() => parseKanjiArgs(["水", "--json"]), /--json is for --dry-run/u);
  const dir = await mkdtemp(join(tmpdir(), "kanji-json-"));
  try {
    await writeFile(join(dir, "data.json"), JSON.stringify({ kanji: [MIZU] }));
    await writeFile(join(dir, "config.json"), JSON.stringify(config({ narration: { reuse: { "{name.kana}": "kunyomi" } } })));
    const lines = [];
    await main(["水", "--dry-run", "--json", "--config", join(dir, "config.json")], {}, { log: line => lines.push(line) });
    const [preview] = JSON.parse(lines.join("\n"));
    assert.equal(preview.name.kana, "みず");
    const question = preview.lines.find(line => line.id === "question");
    assert.equal(question.parts[0].voiceId, VOICE);
    // One voice reads the whole question here, so the name is not a part of its own and nothing is reused.
    assert.equal(question.parts.some(part => part.reuse), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("passes the consents through to the producer and makes the kanji one after another", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kanji-run-"));
  try {
    await writeFile(join(dir, "config.json"), JSON.stringify(config({ outputRoot: join(dir, "out") })));
    const calls = [];
    const qa = { video: { seconds: 20 }, audio: { integratedLufs: -16 }, pacing: { longestStillSeconds: 1.3 }, pronunciation: "not machine-checked" };
    await main(["水火", "--allow-network", "--voice-consent", "--transmit-text", "--config", join(dir, "config.json")], {}, {
      log: () => {}, providerKey: async () => "key-0123456789", findBrowser: async () => "/bin/chrome",
      produce: async (request) => { calls.push(request); return { videoPath: join(request.out, "release", "video.mp4"), qa }; },
    });
    assert.deepEqual(calls.map(c => c.char), ["水", "火"]);
    assert.ok(calls.every(c => c.allowNetwork && c.voiceReferenceConsent && c.textTransmissionApproved && c.apiKey === "key-0123456789"));
    assert.equal(calls[0].out, join(dir, "out", "水-6c34", "v1"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("the producer stops before any network or render work when a consent, the key or the reviewed music is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kanji-gate-"));
  try {
    const bed = join(dir, "bed.wav");
    await writeFile(bed, "reviewed bytes");
    await writeFile(join(dir, "data.json"), JSON.stringify({ kanji: [MIZU] }));
    const read = readKanjiConfig(config({ music: { ...config().music, sha256: createHash("sha256").update("other bytes").digest("hex") } }), join(dir, "config.json"));
    const touched = [];
    const deps = {
      fingerprintBuiltStage: async () => "b".repeat(64), probeBrowserExecutable: async () => {},
      loadKanjiPlanner: async () => ({ KANJI_SHORT_PRESETS: ["youtube-shorts", "instagram-reels", "tiktok"], KANJI_CARD_CUE_SECTIONS: ["readings", "words"] }),
      kanjiVgSvg: async () => touched.push("kanjivg"), synthesizeNarration: async () => touched.push("fish"),
    };
    const base = { char: "水", config: read, out: join(dir, "out"), browserExecutable: "/bin/chrome", apiKey: "key-0123456789" };
    await assert.rejects(produceKanjiShort({ ...base, allowNetwork: true, voiceReferenceConsent: true }, deps), /--transmit-text/u);
    await assert.rejects(produceKanjiShort({ ...base, allowNetwork: true, voiceReferenceConsent: true, textTransmissionApproved: true, apiKey: "" }, deps), /FISH_AUDIO_API_KEY/u);
    await assert.rejects(produceKanjiShort({ ...base, allowNetwork: true, voiceReferenceConsent: true, textTransmissionApproved: true }, deps), /music file changed/u);
    // A script cue the card cannot draw stops here too.
    const cueScript = { schemaVersion: 1, kind: "anchored-narration-script", locale: "ja", steps: [{ id: "x", say: "y", at: "start", cue: "title" }] };
    await assert.rejects(produceKanjiShort({ ...base, config: { ...read, narration: { script: cueScript } }, allowNetwork: true, voiceReferenceConsent: true, textTransmissionApproved: true }, deps),
      /step x cues "title"; the card can draw attention to readings, words/u);
    // Opposite bands the card would shrink stop here too, with the numbers.
    await assert.rejects(produceKanjiShort({ ...base, config: { ...read, card: { safeInset: { top: .3, bottom: .3 } } }, allowNetwork: true, voiceReferenceConsent: true, textTransmissionApproved: true }, deps), /top and bottom together cover 0\.6 of the frame/u);
    // A destination the export page would refuse stops here too.
    await assert.rejects(produceKanjiShort({ ...base, config: { ...read, destination: "facebook-reels" }, allowNetwork: true, voiceReferenceConsent: true, textTransmissionApproved: true }, deps), /destination must be one of youtube-shorts/u);
    // An unbuilt export page names the fix instead of a raw file error.
    const unbuilt = { ...deps, fingerprintBuiltStage: async () => { throw Object.assign(new Error("ENOENT: no such file or directory, realpath 'dist'"), { code: "ENOENT" }); } };
    await assert.rejects(produceKanjiShort({ ...base, allowNetwork: true, voiceReferenceConsent: true, textTransmissionApproved: true }, unbuilt), /export page is not built\. Run pnpm build/u);
    await mkdir(join(dir, "out", "release"), { recursive: true });
    await assert.rejects(produceKanjiShort({ ...base, allowNetwork: true, voiceReferenceConsent: true, textTransmissionApproved: true }, deps), /already exists/u);
    assert.deepEqual(touched, []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("KanjiVG stroke data comes from the cache when its hash still matches, and needs --allow-network otherwise", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kanji-kvg-"));
  const planner = { kanjiVgFileName: () => "06c34.svg", SHODO_KANJIVG_RELEASE: "r1", SHODO_KANJIVG_BASE: "https://example.org/kanji/" };
  try {
    await assert.rejects(kanjiVgSvg("水", { planner, cacheDir: dir, allowNetwork: false }), /needs --allow-network/u);
    let fetched = 0;
    const fetchImpl = async (url) => { fetched++; assert.equal(url, "https://example.org/kanji/06c34.svg"); return new Response("<svg>水</svg>"); };
    const first = await kanjiVgSvg("水", { planner, cacheDir: dir, allowNetwork: true, fetchImpl });
    assert.equal(first.cached, false);
    const second = await kanjiVgSvg("水", { planner, cacheDir: dir, allowNetwork: false, fetchImpl });
    assert.equal(second.cached, true);
    assert.equal(second.sha256, first.sha256);
    assert.equal(fetched, 1);
    // A changed cache file is not trusted: it is fetched again.
    await writeFile(join(dir, "kanjivg", "r1", "06c34.svg"), "<svg>tampered</svg>");
    await kanjiVgSvg("水", { planner, cacheDir: dir, allowNetwork: true, fetchImpl });
    assert.equal(fetched, 2);
    assert.equal(await readFile(join(dir, "kanjivg", "r1", "06c34.svg"), "utf8"), "<svg>水</svg>");
    await assert.rejects(kanjiVgSvg("水", { planner, cacheDir: join(dir, "x"), allowNetwork: true, fetchImpl: async () => new Response("nope", { status: 404 }) }), /HTTP 404/u);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("music shorter than a short stops production before KanjiVG or Fish", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kanji-music-"));
  try {
    // Two seconds of 48 kHz mono silence: far too short.
    const pcm = Buffer.alloc(2 * 48000 * 2);
    const header = Buffer.alloc(44);
    header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8); header.write("fmt ", 12);
    header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(48000, 24);
    header.writeUInt32LE(96000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
    const bytes = Buffer.concat([header, pcm]);
    await writeFile(join(dir, "bed.wav"), bytes);
    await writeFile(join(dir, "data.json"), JSON.stringify({ kanji: [MIZU] }));
    const read = readKanjiConfig(config({ music: { ...config().music, sha256: createHash("sha256").update(bytes).digest("hex") } }), join(dir, "config.json"));
    const touched = [];
    const deps = {
      fingerprintBuiltStage: async () => "b".repeat(64), probeBrowserExecutable: async () => {},
      loadKanjiPlanner: async () => ({ KANJI_SHORT_PRESETS: ["youtube-shorts"], KANJI_CARD_CUE_SECTIONS: ["readings", "words"] }),
      kanjiVgSvg: async () => touched.push("kanjivg"), synthesizeNarration: async () => touched.push("fish"),
    };
    await assert.rejects(produceKanjiShort({ char: "水", config: read, out: join(dir, "out"), browserExecutable: "/bin/chrome", apiKey: "key-0123456789",
      allowNetwork: true, voiceReferenceConsent: true, textTransmissionApproved: true }, deps), /needs at least 30 s/u);
    assert.deepEqual(touched, []);
    // The run's own scratch folder is gone, and with nothing released the output folder too.
    await assert.rejects(readdir(join(dir, "out")), /ENOENT/u);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a word longer than the card shows, and music too short for long writing passes, stop before KanjiVG or Fish", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kanji-limits-"));
  try {
    const pcm = Buffer.alloc(35 * 48000 * 2);                                            // 35 s of silence
    const header = Buffer.alloc(44);
    header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8); header.write("fmt ", 12);
    header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(48000, 24);
    header.writeUInt32LE(96000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
    const bytes = Buffer.concat([header, pcm]);
    await writeFile(join(dir, "bed.wav"), bytes);
    const long = { ...MIZU, words: [...MIZU.words, { word: "水".repeat(41), ruby: "みず", romaji: "mizu", meaning: "water", reading: "on" }] };
    await writeFile(join(dir, "data.json"), JSON.stringify({ kanji: [long] }));
    const music = { ...config().music, sha256: createHash("sha256").update(bytes).digest("hex") };
    const touched = [];
    const deps = {
      fingerprintBuiltStage: async () => "b".repeat(64), probeBrowserExecutable: async () => {},
      loadKanjiPlanner: async () => ({ KANJI_SHORT_PRESETS: ["youtube-shorts"], KANJI_CARD_CUE_SECTIONS: ["readings", "words"], KANJI_WORD_LIMITS: { word: 40, ruby: 60, romaji: 60, meaning: 80 } }),
      kanjiVgSvg: async () => touched.push("kanjivg"), synthesizeNarration: async () => touched.push("fish"),
    };
    const run = (cfg) => produceKanjiShort({ char: "水", config: readKanjiConfig(cfg, join(dir, "config.json")), out: join(dir, "out"), browserExecutable: "/bin/chrome",
      apiKey: "key-0123456789", allowNetwork: true, voiceReferenceConsent: true, textTransmissionApproved: true }, deps);
    await assert.rejects(run(config({ music })), /has a word longer than the card shows|the word 水{41} has a word/u);
    await writeFile(join(dir, "data.json"), JSON.stringify({ kanji: [MIZU] }));
    await assert.rejects(run(config({ music, timing: { write: 20, review: 20 } })), /needs at least 52 s/u);
    assert.deepEqual(touched, []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("the planner's recorded hash is the hash of the bytes it was imported from", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kanji-planner-"));
  try {
    const source = "export const KANJI_SHORT_PRESETS = ['tiktok'];\nexport const answer = 42;\n";
    await writeFile(join(dir, "planner.mjs"), source);
    const planner = await loadKanjiPlanner(join(dir, "planner.mjs"));
    assert.equal(planner.answer, 42);
    assert.equal(planner.plannerSha256, createHash("sha256").update(source).digest("hex"));
    await assert.rejects(loadKanjiPlanner(join(dir, "missing.mjs")), /not built/u);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a config's own narration script replaces the default, and must only use the card's anchors", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kanji-script-"));
  try {
    const counting = { schemaVersion: 1, kind: "anchored-narration-script", locale: "ja", steps: [
      { id: "stroke-{n}", forEach: "strokes", say: "{n}", at: "review.strokes", gap: .1 },
    ] };
    await writeFile(join(dir, "count.json"), JSON.stringify(counting));
    const script = await kanjiNarrationScript(readKanjiConfig(config({ narration: { script: "count.json" } }), join(dir, "config.json")));
    assert.equal(script.steps[0].at, "review.strokes");
    await assert.rejects(kanjiNarrationScript({ narration: { script: { ...counting, steps: [{ id: "x", say: "y", at: "outro.start" }] } } }),
      /anchors the kanji card does not have: outro\.start/u);
    assert.equal((await kanjiNarrationScript({ narration: {} })).steps[0].id, "question");                  // the default
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a local voice needs its own consent and no Fish key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kanji-local-"));
  try {
    const local = { provider: "local", voiceId: "voice-a", modelId: "model-a", engineRevision: "1.0", endpoint: "http://127.0.0.1:8123" };
    await writeFile(join(dir, "config.json"), JSON.stringify(config({ outputRoot: join(dir, "out"), voice: local })));
    const calls = [];
    const qa = { video: { seconds: 20 }, audio: { integratedLufs: -16 }, pacing: { longestStillSeconds: 1.3 }, pronunciation: "not machine-checked" };
    await main(["水", "--local-voice-consent", "--config", join(dir, "config.json")], {}, {
      log: () => {}, providerKey: async () => { throw Error("no Fish key for a local voice"); }, findBrowser: async () => "/bin/chrome",
      produce: async (request) => { calls.push(request); return { videoPath: "v.mp4", qa }; },
    });
    assert.equal(calls[0].localVoiceAuthorized, true);
    assert.equal(calls[0].apiKey, undefined);
    const read = readKanjiConfig(config({ voice: local }), join(dir, "config.json"));
    await assert.rejects(produceKanjiShort({ char: "水", config: read, out: join(dir, "o2"), browserExecutable: "/bin/chrome" }, {}), /needs --local-voice-consent/u);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

/** KanjiVG's 一: one horizontal stroke. */
const ICHI_SVG = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:kvg="http://kanjivg.tagaini.net" width="109" height="109" viewBox="0 0 109 109">
<g id="kvg:StrokePaths_04e00"><g id="kvg:04e00" kvg:element="一" kvg:radical="general"><path id="kvg:04e00-s1" kvg:type="㇐" d="M11,54.25c3.19,0.62,6.25,0.75,9.73,0.5c20.64-1.5,50.39-5.12,68.58-5.24c3.6-0.02,5.77,0.24,7.57,0.49"/></g></g></svg>`;

test("a script line with no moment in the picture, or a highlight the card cannot show, stops before any voice", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kanji-script-check-"));
  try {
    const pcm = Buffer.alloc(35 * 48000 * 2);
    const header = Buffer.alloc(44);
    header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8); header.write("fmt ", 12);
    header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(48000, 24);
    header.writeUInt32LE(96000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
    const bytes = Buffer.concat([header, pcm]);
    await writeFile(join(dir, "bed.wav"), bytes);
    const ichi = { char: "一", jlpt: "N5", card: { meanings: "ONE", onyomi: "ICHI (イチ)", kunyomi: "hito (ひと)", jlpt: "N5" }, words: [
      { word: "一つ", ruby: "ひとつ", romaji: "hitotsu", meaning: "one", reading: "kun" }, { word: "一月", ruby: "いちがつ", romaji: "ichigatsu", meaning: "January", reading: "on" },
      { word: "一人", ruby: "ひとり", romaji: "hitori", meaning: "one person", reading: "irregular" }] };
    await writeFile(join(dir, "data.json"), JSON.stringify({ kanji: [ichi] }));
    const music = { ...config().music, sha256: createHash("sha256").update(bytes).digest("hex") };
    const touched = [];
    const deps = {
      fingerprintBuiltStage: async () => "b".repeat(64), probeBrowserExecutable: async () => {},
      kanjiVgSvg: async () => ({ svg: ICHI_SVG, url: "kanjivg:04e00", sha256: "c".repeat(64), cached: true }),
      synthesizeNarration: async () => { touched.push("voice"); return []; },
    };
    const steps = (extra) => ({ schemaVersion: 1, kind: "anchored-narration-script", locale: "ja", steps: [{ id: "q", say: "{name.kana}", at: "start" }, extra] });
    const run = (script) => produceKanjiShort({ char: "一", config: readKanjiConfig(config({ music, narration: { script } }), join(dir, "config.json")), out: join(dir, "out"),
      browserExecutable: "/bin/chrome", apiKey: "key-0123456789", allowNetwork: true, voiceReferenceConsent: true, textTransmissionApproved: true }, deps);
    // A theme typo is refused, not ignored (the card itself would ignore it).
    await assert.rejects(produceKanjiShort({ char: "一", config: readKanjiConfig(config({ music, card: { theme: { accnt: "#000000" } } }), join(dir, "config.json")),
      out: join(dir, "out"), browserExecutable: "/bin/chrome", apiKey: "key-0123456789", allowNetwork: true, voiceReferenceConsent: true, textTransmissionApproved: true }, deps),
      /card\.theme: accnt is not a theme key/u);
    // 一 has one stroke but three words: word 2 has no review stroke to start on.
    await assert.rejects(run(steps({ id: "w-{n}", forEach: "words", say: "{item.speech}", at: "review.strokes" })), /needs the anchor review\.strokes for item 2/u);
    // The card highlights words, not strokes.
    await assert.rejects(run(steps({ id: "s-{n}", forEach: "strokes", say: "{n}", at: "review.strokes", highlight: true })), /highlights an item of strokes/u);
    // A narration much longer than the 35 s of music stops before any voice, with the estimate.
    await assert.rejects(run(steps({ id: "long", say: "This is a very long closing sentence. ".repeat(10).trim(), locale: "en", at: "review.end" })),
      /this short's narration needs about \d+ s/u);
    // A text reused from a line the short does not have is read on its own: the voice is asked for it.
    await assert.rejects(produceKanjiShort({ char: "一", config: readKanjiConfig(config({ music, narration: { reuse: { "Do you know how to write the kanji いち?": "outro" } } }), join(dir, "config.json")),
      out: join(dir, "out"), browserExecutable: "/bin/chrome", apiKey: "key-0123456789", allowNetwork: true, voiceReferenceConsent: true, textTransmissionApproved: true }, deps),
      /out of order/u);
    assert.deepEqual(touched, ["voice"]);
    touched.length = 0;
    // A cue on a line at the very start is placed at 0 s, not before the video: the early checks pass and the voice is asked for.
    await assert.rejects(run({ schemaVersion: 1, kind: "anchored-narration-script", locale: "ja", steps: [{ id: "q", say: "{name.kana}", at: "start", cue: "words" }] }),
      /out of order/u);
    assert.deepEqual(touched, ["voice"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

