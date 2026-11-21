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
  assert.throws(() => readKanjiConfig(config({ timing: { questionStart: -1 } }), "/c.json"), /timing\.questionStart/u);
  assert.throws(() => readKanjiConfig(config({ timing: { questionStart: 0 } }), "/c.json"), /timing\.questionStart must be 0\.05/u);
  assert.throws(() => readKanjiConfig(config({ timing: { writing: 5 } }), "/c.json"), /timing\.writing is not a setting/u);
  assert.throws(() => readKanjiConfig(config({ narration: { labels: { on: "オンよみ" } } }), "/c.json"), /both on and kun/u);
  assert.throws(() => readKanjiConfig(config({ narration: { speech: null } }), "/c.json"), /narration\.speech/u);
  assert.throws(() => readKanjiConfig(config({ narration: { question: "Q {name}?" } }), "/c.json"), /narration\.question is not a setting \(script, labels, speech\)/u);
  assert.throws(() => readKanjiConfig(config({ narration: { script: 3 } }), "/c.json"), /narration\.script must be a file or/u);
  assert.equal(readKanjiConfig(config({ narration: { script: "my-script.json" } }), "/home/me/c.json").narration.script, "/home/me/my-script.json");
  assert.throws(() => readKanjiConfig(config({ card: { colour: "red" } }), "/c.json"), /card\.colour is not a setting/u);
  assert.throws(() => readKanjiConfig(config({ card: { labels: { title: "X" } } }), "/c.json"), /card\.labels/u);
  assert.throws(() => readKanjiConfig(config({ card: { typeStep: 2 } }), "/c.json"), /card\.typeStep/u);
  assert.throws(() => readKanjiConfig(config({ card: { brushStyle: [] } }), "/c.json"), /card\.brushStyle/u);
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
      loadKanjiPlanner: async () => ({ KANJI_SHORT_PRESETS: ["youtube-shorts", "instagram-reels", "tiktok"] }),
      kanjiVgSvg: async () => touched.push("kanjivg"), synthesizeNarration: async () => touched.push("fish"),
    };
    const base = { char: "水", config: read, out: join(dir, "out"), browserExecutable: "/bin/chrome", apiKey: "key-0123456789" };
    await assert.rejects(produceKanjiShort({ ...base, allowNetwork: true, voiceReferenceConsent: true }, deps), /--transmit-text/u);
    await assert.rejects(produceKanjiShort({ ...base, allowNetwork: true, voiceReferenceConsent: true, textTransmissionApproved: true, apiKey: "" }, deps), /FISH_AUDIO_API_KEY/u);
    await assert.rejects(produceKanjiShort({ ...base, allowNetwork: true, voiceReferenceConsent: true, textTransmissionApproved: true }, deps), /music file changed/u);
    // A destination the export page would refuse stops here too.
    await assert.rejects(produceKanjiShort({ ...base, config: { ...read, destination: "facebook-reels" }, allowNetwork: true, voiceReferenceConsent: true, textTransmissionApproved: true }, deps), /destination must be one of youtube-shorts/u);
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
      loadKanjiPlanner: async () => ({ KANJI_SHORT_PRESETS: ["youtube-shorts"] }),
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
      loadKanjiPlanner: async () => ({ KANJI_SHORT_PRESETS: ["youtube-shorts"], KANJI_WORD_LIMITS: { word: 40, ruby: 60, romaji: 60, meaning: 80 } }),
      kanjiVgSvg: async () => touched.push("kanjivg"), synthesizeNarration: async () => touched.push("fish"),
    };
    const run = (cfg) => produceKanjiShort({ char: "水", config: readKanjiConfig(cfg, join(dir, "config.json")), out: join(dir, "out"), browserExecutable: "/bin/chrome",
      apiKey: "key-0123456789", allowNetwork: true, voiceReferenceConsent: true, textTransmissionApproved: true }, deps);
    await assert.rejects(run(config({ music })), /has a word longer than the card shows|the word 水{41} has a word/u);
    await writeFile(join(dir, "data.json"), JSON.stringify({ kanji: [MIZU] }));
    await assert.rejects(run(config({ music, timing: { write: 20, review: 20 } })), /needs at least 48 s/u);
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

