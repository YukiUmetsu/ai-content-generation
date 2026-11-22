import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyKanjiStudioSettings, kanjiReleases, kanjiStudioSettings, releaseFolder, saveKanjiConfig } from "./kanji-studio.mjs";
import { createHash } from "node:crypto";

const CONFIG = {
  schemaVersion: 1, dataset: "data.json", outputRoot: "out", voice: { voiceId: "984831ae0346415685b109090be3e798" },
  music: { path: "bed.wav", sha256: "a".repeat(64), title: "Bed", source: "https://example.org/bed", license: "CC0 1.0" },
};

test("the Studio's settings are read by path, and a change sets, removes or refuses them", () => {
  const settings = kanjiStudioSettings(CONFIG);
  assert.equal(settings["voice.voiceId"], CONFIG.voice.voiceId);
  assert.equal(settings["voice.voiceIds"], null);
  const next = applyKanjiStudioSettings(CONFIG, { "timing.write": 7, "voice.pace": "measured", "narration.speech": { 水泳: "すいえい" } }, "/c/config.json");
  assert.deepEqual([next.timing, next.voice.pace, next.narration.speech], [{ write: 7 }, "measured", { 水泳: "すいえい" }]);
  assert.equal(CONFIG.timing, undefined, "the input is not changed");
  assert.equal(applyKanjiStudioSettings(next, { "timing.write": null, "card.safeInset": null }, "/c/config.json").timing.write, undefined);
  assert.throws(() => applyKanjiStudioSettings(CONFIG, { dataset: "x.json" }, "/c/config.json"), /dataset is not a setting the Studio edits/u);
  assert.throws(() => applyKanjiStudioSettings(CONFIG, { "timing.write": 99 }, "/c/config.json"), /timing\.write must be 3 to 20/u);
  assert.throws(() => applyKanjiStudioSettings({ ...CONFIG, timing: 3 }, { "timing.write": 7 }, "/c/config.json"), /timing in the config file is not an object/u);
  assert.throws(() => applyKanjiStudioSettings(CONFIG, [], "/c/config.json"), /\{ path: value \}/u);
});

test("the settings file is replaced in one step, keeping its mode, and never over a newer edit", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "kanji-save-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "config.json"), text = `${JSON.stringify(CONFIG)}\n`;
  await writeFile(path, text, { mode: 0o600 });
  const revision = createHash("sha256").update(text).digest("hex");
  const next = await saveKanjiConfig(path, { ...CONFIG, maxWords: 4 }, revision);
  assert.equal(JSON.parse(await readFile(path, "utf8")).maxWords, 4);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  await assert.rejects(saveKanjiConfig(path, CONFIG, revision), /changed since it was loaded/u);
  assert.notEqual(next, revision);
  assert.deepEqual((await readdir(dir)).sort(), ["config.json"], "no temporary file is left");
});

test("releases are listed per kanji, newest first, skipping folders that are not a release", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "kanji-releases-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const make = async (folder, version, video = true) => {
    const release = join(root, folder, version, "release");
    await mkdir(release, { recursive: true });
    if (video) await writeFile(join(release, "video.mp4"), "mp4");
  };
  await make("水-6c34", "v1"); await make("水-6c34", "v10"); await make("水-6c34", "v2", false); await make("水-6c34", "draft");
  await make("火-6c34", "v1");                         // a name that does not match its code point
  await make("notes", "v1");
  await mkdir(join(root, "人-4eba"), { recursive: true });
  await symlink(join(root, "水-6c34"), join(root, "人-4eba", "v1"));   // a linked version folder
  assert.equal(releaseFolder("水"), "水-6c34");
  const all = await kanjiReleases(root);
  assert.deepEqual(all.map(r => [r.char, r.versions.map(v => v.version)]), [["水", [10, 1]]]);
  assert.equal(all[0].versions[0].qa, undefined, "the QA is read only for the kanji asked for");
  const one = await kanjiReleases(root, { chars: ["水"] });
  assert.equal(one[0].versions[0].qa, null, "a release without a QA report says so");
  assert.deepEqual(await kanjiReleases(join(root, "missing")), []);
});
