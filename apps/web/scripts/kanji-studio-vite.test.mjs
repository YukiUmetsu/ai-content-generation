import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { createKanjiStudioApi, kanjiFromText } from "./kanji-studio-vite.mjs";

const MIZU = {
  char: "水", jlpt: "N5", card: { meanings: "WATER", onyomi: "SUI (スイ)", kunyomi: "mizu (みず)", jlpt: "N5" },
  words: [{ word: "水", ruby: "みず", romaji: "mizu", meaning: "water", reading: "kun" }, { word: "水道", ruby: "すいどう", romaji: "suidō", meaning: "water supply", reading: "on" }],
};
const HITO = {
  char: "人", jlpt: "N5", card: { meanings: "PERSON", onyomi: "JIN (ジン)", kunyomi: "hito (ひと)", jlpt: "N5" },
  words: [{ word: "人", ruby: "ひと", romaji: "hito", meaning: "person", reading: "kun" }, { word: "人間", ruby: "にんげん", romaji: "ningen", meaning: "human", reading: "on" }],
};
const CONFIG = {
  schemaVersion: 1, dataset: "data.json", outputRoot: "out", destination: "youtube-shorts",
  voice: { voiceId: "984831ae0346415685b109090be3e798", pace: "slow" },
  music: { path: "bed.wav", sha256: "a".repeat(64), title: "Bed", source: "https://example.org/bed", license: "CC0 1.0" },
  credits: ["Kanji data: example"],
};
const CONSENT = { allowNetwork: true, voiceConsent: true, transmitText: true };
const QA = { video: { seconds: 24.8 }, audio: { integratedLufs: -16.7, truePeakDbtp: -1.8 }, pacing: { longestStillSeconds: 1.8 }, warnings: [], technicalPass: true,
  reviewStatus: "not-reviewed", speech: [{ id: "question", voiceRuns: [{ text: "ひと", reusedFrom: "kunyomi" }] }] };

async function fixture(t, config = CONFIG) {
  const dir = await mkdtemp(join(tmpdir(), "kanji-studio-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "data.json"), JSON.stringify({ kanji: [MIZU, HITO] }));
  if (config) await writeFile(join(dir, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
  return dir;
}
const unavailableJobs = { fetcher: async () => { throw Error("connection refused"); } };
function api(dir, deps = {}) {
  const runs = [];
  const studio = createKanjiStudioApi({ runs: { run: null, controller: null }, configPath: join(dir, "config.json"), providerKey: async () => "key-0123456789", findBrowser: async () => "/bin/chrome",
    jobs: unavailableJobs, preview: { loadKanjiPlanner: async () => { throw Error("not built"); } }, onRun: (run) => runs.push(run), ...deps });
  return { ...studio, settled: () => Promise.all(runs) };
}
async function call(studio, method, path, payload, headers = {}) {
  const req = Readable.from(payload === undefined ? [] : [Buffer.from(JSON.stringify(payload))]);
  Object.assign(req, { method, url: path, headers: { host: "127.0.0.1:5173",
    ...(method === "POST" ? { origin: "http://127.0.0.1:5173", "x-contentgen-kanji": "local-only" } : {}), ...headers } });
  const chunks = [];
  let status = 0, head = {};
  const res = Object.assign(new Writable({ write(chunk, _encoding, done) { chunks.push(chunk); done(); } }), {
    headersSent: false, writeHead(code, values) { status = code; head = values; this.headersSent = true; return this; },
  });
  const finished = new Promise(resolve => res.on("finish", resolve).on("close", resolve));
  await studio.handle(req, res);
  await finished;
  const body = Buffer.concat(chunks);
  return { status, head, body, json: () => JSON.parse(body.toString("utf8")) };
}

test("the kanji to make are read as the CLI reads them", () => {
  assert.deepEqual(kanjiFromText("水、火 水,人"), ["水", "火", "人"]);
  assert.throws(() => kanjiFromText("mizu"), /one your data has/u);
  assert.throws(() => kanjiFromText(""), /Name the kanji/u);
  assert.throws(() => kanjiFromText("一二三四五六七八九十百"), /at most 10/u);
});

test("only the same-origin local Studio may call it, and changes need its header", async (t) => {
  const studio = api(await fixture(t));
  assert.equal((await call(studio, "GET", "/state", undefined, { host: "example.org:5173" })).status, 403);
  assert.equal((await call(studio, "GET", "/state", undefined, { origin: "http://evil.example" })).status, 403);
  assert.equal((await call(studio, "POST", "/preview", { kanji: "水" }, { "x-contentgen-kanji": "" })).status, 403);
  assert.equal((await call(studio, "GET", "/nope")).status, 404);
});

test("the state says how to start when there is no settings file, and lists the kanji and settings when there is", async (t) => {
  const empty = await call(api(await fixture(t, null)), "GET", "/state");
  assert.equal(empty.json().configured, false);
  assert.match(empty.json().problem, /There is no settings file yet/u);
  const dir = await fixture(t);
  await mkdir(join(dir, "out", "水-6c34", "v1", "release"), { recursive: true });
  await writeFile(join(dir, "out", "水-6c34", "v1", "release", "video.mp4"), "mp4");
  const state = (await call(api(dir), "GET", "/state")).json();
  assert.equal(state.configured, true);
  assert.deepEqual(state.catalog.map(k => [k.char, k.versions, k.name.kana]), [["水", 1, "みず"], ["人", 0, "ひと"]]);
  assert.equal(state.settings["voice.voiceId"], CONFIG.voice.voiceId);
  assert.equal(state.settings["narration.reuse"], null);
  assert.equal(state.provider, "fish");
  assert.match(state.revision, /^[a-f0-9]{64}$/u);
});

test("a preview shows each line, its voices and the reuses that apply, with no network", async (t) => {
  const dir = await fixture(t, { ...CONFIG, voice: { ...CONFIG.voice, voiceIds: { ja: "34cfe2f12a8a4d9490e375fcb845642f", en: "59f85041c50240f08ba9b6fa2bff650d" } },
    narration: { reuse: { "{name.kana}": "kunyomi" } } });
  const { previews } = (await call(api(dir), "POST", "/preview", { kanji: "人火" })).json();
  const hito = previews[0];
  assert.equal(hito.found, true);
  const question = hito.lines.find(line => line.id === "question");
  assert.equal(question.split, true);
  assert.deepEqual(question.parts.map(p => [p.text, p.locale, p.voiceId.slice(0, 4)]), [["Do you know how to write the kanji", "en", "59f8"], ["ひと", "ja", "34cf"]]);
  assert.deepEqual(question.parts[1].reuse, { from: "kunyomi", whole: false });
  assert.deepEqual(previews[1], { char: "火", found: false });
});

test("settings are saved into the file, keep what the page does not edit, and never overwrite an edit made meanwhile", async (t) => {
  const dir = await fixture(t), studio = api(dir), path = join(dir, "config.json");
  const { revision } = (await call(studio, "GET", "/state")).json();
  const changes = { "voice.voiceIds": { ja: "34cfe2f12a8a4d9490e375fcb845642f", en: "59f85041c50240f08ba9b6fa2bff650d" }, "narration.reuse": { "{name.kana}": "kunyomi" },
    "card.safeInset": { bottom: .19 }, "voice.pace": null };
  const saved = await call(studio, "POST", "/settings", { revision, changes });
  assert.equal(saved.status, 200);
  const file = JSON.parse(await readFile(path, "utf8"));
  assert.deepEqual(file.music, CONFIG.music);
  assert.deepEqual(file.credits, CONFIG.credits);
  assert.deepEqual(file.narration.reuse, { "{name.kana}": "kunyomi" });
  assert.equal(file.voice.pace, undefined);
  assert.equal(file.voice.voiceId, CONFIG.voice.voiceId);
  assert.notEqual(saved.json().revision, revision);
  // The old revision is stale now: the save is refused and the file stays.
  const before = await readFile(path, "utf8");
  assert.equal((await call(studio, "POST", "/settings", { revision, changes: { maxWords: 4 } })).status, 409);
  // A setting the page does not edit, and a value the config refuses, change nothing.
  const fresh = saved.json().revision;
  const other = await call(studio, "POST", "/settings", { revision: fresh, changes: { "music.path": "other.wav" } });
  assert.equal(other.status, 422);
  assert.match(other.json().error, /not a setting the Studio edits/u);
  const bad = await call(studio, "POST", "/settings", { revision: fresh, changes: { maxWords: 9 } });
  assert.match(bad.json().error, /maxWords must be 1 to 6/u);
  const field = await call(studio, "POST", "/settings", { revision: fresh, changes: { "narration.reuse": { "{name.kanji}": "kunyomi" } } });
  assert.match(field.json().error, /names \{name\.kanji\}/u);
  assert.equal(await readFile(path, "utf8"), before);
});

test("making shorts needs the confirmation, the consents, the key and kanji the data has", async (t) => {
  const dir = await fixture(t);
  assert.equal((await call(api(dir), "POST", "/start", { kanji: "水", consent: CONSENT })).status, 400);
  assert.match((await call(api(dir), "POST", "/start", { kanji: "水", confirm: true, consent: { allowNetwork: true } })).json().error, /sends the narration text to Fish Audio/u);
  const keyless = await call(api(dir, { providerKey: async () => undefined }), "POST", "/start", { kanji: "水", confirm: true, consent: CONSENT });
  assert.equal(keyless.status, 422);
  assert.match(keyless.json().error, /Settings → Connections/u);
  assert.match((await call(api(dir), "POST", "/start", { kanji: "水火", confirm: true, consent: CONSENT })).json().error, /Not in the kanji data: 火/u);
});

test("a run makes the kanji one after another with their progress, keeps going after a failure, and records the releases", async (t) => {
  const dir = await fixture(t), calls = [];
  const studio = api(dir, { produce: async (request) => {
    calls.push(request);
    request.onProgress({ phase: "narration", char: request.char, message: "Synthesizing…" });
    if (request.char === "水") throw Error("the music file changed");
    return { videoPath: join(request.out, "release", "video.mp4"), qa: QA };
  } });
  const started = await call(studio, "POST", "/start", { kanji: "水人", confirm: true, consent: CONSENT });
  assert.equal(started.status, 202);
  assert.equal(started.json().run.items.length, 2);
  await studio.settled();
  const { run } = (await call(studio, "GET", "/status")).json();
  assert.equal(run.state, "finished");
  assert.deepEqual(run.items.map(item => [item.char, item.state]), [["水", "failed"], ["人", "done"]]);
  assert.match(run.items[0].error, /music file changed/u);
  assert.deepEqual([run.items[1].folder, run.items[1].version, run.items[1].tracked], ["人-4eba", 1, false]);
  assert.equal(run.items[1].qa.nameReusedFrom, "kunyomi");
  assert.equal(run.items[1].qa.lufs, -16.7);
  assert.ok(calls.every(c => c.allowNetwork && c.voiceReferenceConsent && c.textTransmissionApproved && c.apiKey === "key-0123456789" && c.browserExecutable === "/bin/chrome"));
  assert.equal(calls[1].out, join(dir, "out", "人-4eba", "v1"));
});

test("one run at a time, and Cancel stops the short being made and the ones after it", async (t) => {
  const dir = await fixture(t);
  const studio = api(dir, { produce: (request) => new Promise((_resolve, reject) => {
    request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
  }) });
  assert.equal((await call(studio, "POST", "/start", { kanji: "水人", confirm: true, consent: CONSENT })).status, 202);
  assert.equal((await call(studio, "POST", "/start", { kanji: "水", confirm: true, consent: CONSENT })).status, 409);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await call(studio, "POST", "/cancel", {})).status, 200);
  await studio.settled();
  const { run } = (await call(studio, "GET", "/status")).json();
  assert.equal(run.state, "cancelled");
  assert.deepEqual(run.items.map(item => item.state), ["cancelled", "cancelled"]);
  assert.equal((await call(studio, "POST", "/cancel", {})).status, 409);
});

test("with the local Jobs server running, each short is a tracked job that records its release", async (t) => {
  const dir = await fixture(t), jobCalls = [];
  const fetcher = async (url, opts) => {
    const path = new URL(url).pathname, body = JSON.parse(opts.body);
    jobCalls.push({ path, body });
    const reply = path === "/api/jobs" ? { created: true, job: { id: "job-1", state: "RUNNING" }, nodes: [{ id: "node-1", nodeKey: "kanji-short", state: "READY" }] }
      : path.endsWith("/start") ? { attempt: { id: "claim-1" } } : { success: true };
    return { ok: true, json: async () => reply };
  };
  const studio = api(dir, { jobs: { fetcher }, produce: async (request) => ({ videoPath: join(request.out, "release", "video.mp4"), qa: QA }) });
  await call(studio, "POST", "/start", { kanji: "人", confirm: true, consent: CONSENT });
  await studio.settled();
  const { run } = (await call(studio, "GET", "/status")).json();
  assert.deepEqual([run.items[0].state, run.items[0].tracked, run.items[0].jobId], ["done", true, "job-1"]);
  assert.equal(jobCalls[0].body.jobKind, "video-kanji-short");
  assert.deepEqual(jobCalls.find(c => c.path.endsWith("/succeed")).body.output, { char: "人", folder: "人-4eba", version: 1 });
});

test("a release's video plays with byte ranges, and only real release files under the output root are served", async (t) => {
  const dir = await fixture(t), release = join(dir, "out", "水-6c34", "v2", "release");
  await mkdir(join(release, "stills"), { recursive: true });
  await writeFile(join(release, "video.mp4"), Buffer.from("0123456789"));
  await writeFile(join(release, "stills", "frame-000030.png"), "early");
  await writeFile(join(release, "stills", "frame-000743.png"), "last");
  await writeFile(join(release, "qa-report.json"), JSON.stringify(QA));
  const studio = api(dir);
  const ranged = await call(studio, "GET", `/media/${encodeURIComponent("水-6c34")}/v2/video.mp4`, undefined, { range: "bytes=2-5" });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.body.toString(), "2345");
  const poster = await call(studio, "GET", `/media/${encodeURIComponent("水-6c34")}/v2/poster.png`);
  assert.equal(poster.body.toString(), "last");
  assert.equal((await call(studio, "GET", `/media/${encodeURIComponent("水-6c35")}/v2/video.mp4`)).status, 404);
  assert.equal((await call(studio, "GET", `/media/${encodeURIComponent("水-6c34")}/..%2Fv2/video.mp4`)).status, 404);
  assert.equal((await call(studio, "GET", `/media/${encodeURIComponent("水-6c34")}/v2/qa-report.json`)).status, 404);
  // A link to a file outside is never followed.
  const linked = join(dir, "out", "人-4eba", "v1", "release");
  await mkdir(linked, { recursive: true });
  await writeFile(join(dir, "secret.mp4"), "secret");
  await symlink(join(dir, "secret.mp4"), join(linked, "video.mp4"));
  assert.equal((await call(studio, "GET", `/media/${encodeURIComponent("人-4eba")}/v1/video.mp4`)).status, 404);
  const { releases } = (await call(studio, "GET", `/releases?kanji=${encodeURIComponent("水人")}`)).json();
  assert.deepEqual(releases.map(r => [r.char, r.versions.map(v => v.version)]), [["水", [2]]]);
  assert.equal(releases[0].versions[0].qa.longestStill, 1.8);
});

test("the plugin mounts the API under its prefix and gives Vite no post-middleware hook", async () => {
  const { kanjiStudioPlugin, KANJI_STUDIO_PREFIX } = await import("./kanji-studio-vite.mjs");
  const mounted = [];
  const server = { middlewares: { use: (prefix, handler) => { mounted.push([prefix, typeof handler]); return () => {}; } } };
  const plugin = kanjiStudioPlugin();
  assert.equal(plugin.configureServer(server), undefined);
  assert.equal(plugin.configurePreviewServer(server), undefined);
  assert.deepEqual(mounted, [[KANJI_STUDIO_PREFIX, "function"], [KANJI_STUDIO_PREFIX, "function"]]);
});

test("two Make presses at once (two tabs) start one run, and the other is refused", async (t) => {
  const dir = await fixture(t);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const studio = api(dir, { providerKey: async () => { await gate; return "key-0123456789"; },
    produce: async (request) => ({ videoPath: join(request.out, "release", "video.mp4"), qa: QA }) });
  const first = call(studio, "POST", "/start", { kanji: "水", confirm: true, consent: CONSENT });
  const second = call(studio, "POST", "/start", { kanji: "水", confirm: true, consent: CONSENT });
  await new Promise(resolve => setTimeout(resolve, 20));
  release();
  const statuses = [(await first).status, (await second).status].sort();
  assert.deepEqual(statuses, [202, 409]);
  await studio.settled();
  // When the run ends, a new one may start; a refused start before it never blocked it.
  assert.equal((await call(studio, "POST", "/start", { kanji: "人", confirm: true, consent: CONSENT })).status, 202);
  await studio.settled();
});

test("a kanji the producer cannot make is listed with its problem, and stray folders are skipped", async (t) => {
  const dir = await fixture(t);
  const lone = { char: "乙", jlpt: "N1", card: { meanings: "SECOND", onyomi: "OTSU (オツ)", kunyomi: "kinoto (きのと)" }, words: [{ word: "乙", ruby: "おつ", romaji: "otsu", meaning: "second", reading: "on" }] };
  await writeFile(join(dir, "data.json"), JSON.stringify({ kanji: [MIZU, lone] }));
  await mkdir(join(dir, "out", "upload-202611", "v1", "release"), { recursive: true });
  const state = await call(api(dir), "GET", "/state");
  assert.equal(state.status, 200);
  const entry = state.json().catalog.find(k => k.char === "乙");
  assert.match(entry.problem, /no useful word/u);
  const { previews } = (await call(api(dir), "POST", "/preview", { kanji: "乙水" })).json();
  assert.deepEqual([previews[0].char, !!previews[0].problem, previews[1].found && !!previews[1].lines], ["乙", true, true]);
  assert.equal((await call(api(dir), "GET", `/releases?kanji=${encodeURIComponent("水")}`)).status, 200);
});

test("a short that was made stays made when Jobs cannot record it, and Jobs never marks it failed", async (t) => {
  const dir = await fixture(t), paths = [];
  const fetcher = async (url) => {
    const path = new URL(url).pathname;
    paths.push(path.split("/").at(-1));
    if (path.endsWith("/succeed")) return { ok: false, status: 500, json: async () => ({ error: "database is locked" }) };
    const reply = path === "/api/jobs" ? { created: true, job: { id: "job-1", state: "RUNNING" }, nodes: [{ id: "node-1", nodeKey: "kanji-short", state: "READY" }] }
      : path.endsWith("/start") ? { attempt: { id: "claim-1" } } : { success: true };
    return { ok: true, json: async () => reply };
  };
  const studio = api(dir, { jobs: { fetcher }, produce: async (request) => ({ videoPath: join(request.out, "release", "video.mp4"), qa: QA }) });
  await call(studio, "POST", "/start", { kanji: "人", confirm: true, consent: CONSENT });
  await studio.settled();
  const { run } = (await call(studio, "GET", "/status")).json();
  assert.equal(run.items[0].state, "done");
  assert.match(run.items[0].note, /Jobs could not record it: database is locked/u);
  assert.equal(paths.includes("fail"), false);
});

test("Cancel while Jobs is slow to answer never starts the producer", async (t) => {
  const dir = await fixture(t);
  let produced = 0;
  const fetcher = (_url, opts) => new Promise((_resolve, reject) => setTimeout(() => reject(Error("timeout")), 60));
  const studio = api(dir, { jobs: { fetcher }, produce: async () => { produced++; return { qa: QA }; } });
  await call(studio, "POST", "/start", { kanji: "人", confirm: true, consent: CONSENT });
  await call(studio, "POST", "/cancel", {});
  await studio.settled();
  assert.equal(produced, 0);
  assert.equal((await call(studio, "GET", "/status")).json().run.items[0].state, "cancelled");
});

test("two saves on the same revision: one is saved, the other is refused", async (t) => {
  const dir = await fixture(t), studio = api(dir);
  const { revision } = (await call(studio, "GET", "/state")).json();
  const results = await Promise.all([call(studio, "POST", "/settings", { revision, changes: { maxWords: 4 } }),
    call(studio, "POST", "/settings", { revision, changes: { maxWords: 5 } })]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const saved = results.find(r => r.status === 200).json().settings.maxWords;
  assert.equal(JSON.parse(await readFile(join(dir, "config.json"), "utf8")).maxWords, saved);
});

test("a linked settings file is changed where it points, and the link stays", async (t) => {
  const dir = await fixture(t);
  await mkdir(join(dir, "real"));
  // Relative paths are read from the link's folder, as the CLI reads them.
  await writeFile(join(dir, "real", "config.json"), JSON.stringify(CONFIG));
  await symlink(join(dir, "real", "config.json"), join(dir, "linked.json"));
  const studio = api(dir, { configPath: join(dir, "linked.json") });
  const { revision } = (await call(studio, "GET", "/state")).json();
  assert.equal((await call(studio, "POST", "/settings", { revision, changes: { maxWords: 2 } })).status, 200);
  assert.equal(JSON.parse(await readFile(join(dir, "real", "config.json"), "utf8")).maxWords, 2);
  assert.equal((await (await import("node:fs/promises")).lstat(join(dir, "linked.json"))).isSymbolicLink(), true);
});

test("a run belongs to the process: a restarted API (same process) still reports it and refuses a second one", async (t) => {
  const dir = await fixture(t), runs = { run: null, controller: null };
  let finish;
  const produce = () => new Promise(resolve => { finish = () => resolve({ qa: QA }); });
  const first = createKanjiStudioApi({ runs, configPath: join(dir, "config.json"), providerKey: async () => "k".repeat(16), findBrowser: async () => "/bin/chrome",
    jobs: unavailableJobs, produce });
  assert.equal((await call(first, "POST", "/start", { kanji: "水", confirm: true, consent: CONSENT })).status, 202);
  const restarted = createKanjiStudioApi({ runs, configPath: join(dir, "config.json"), providerKey: async () => "k".repeat(16), findBrowser: async () => "/bin/chrome",
    jobs: unavailableJobs, produce });
  assert.equal((await call(restarted, "GET", "/status")).json().run.state, "running");
  assert.equal((await call(restarted, "POST", "/start", { kanji: "人", confirm: true, consent: CONSENT })).status, 409);
  await new Promise(resolve => setTimeout(resolve, 20));
  finish();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await call(restarted, "GET", "/status")).json().run.state, "finished");
});
