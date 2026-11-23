import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VOICES, cacheTake, glideWav, takesConfig } from "./kanji-takes.fixture.mjs";
import { kanjiTakes, recordKanjiTake, takeMeasure, takeText } from "./kanji-takes.mjs";

test("a text's takes are found where the producer's requests put them, in order, and only whole ones", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "kanji-takes-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const config = takesConfig(dir);
  await cacheTake(config, "とし。", "ja", 1, glideWav(.4, 140, 150));
  await cacheTake(config, "とし。", "ja", 3, glideWav(.4, 150, 120));
  const broken = await cacheTake(config, "とし。", "ja", 4, glideWav(.4, 150, 120));
  await writeFile(broken, "changed bytes");                              // a changed file is no take
  await cacheTake(config, "とし。", "en", 2, glideWav(.4, 150, 120));   // another voice's take is not this one's
  assert.deepEqual((await kanjiTakes(config, { text: "とし。", locale: "ja" })).map(take => take.take), [1, 3]);
  assert.deepEqual(await kanjiTakes(config, { text: "いま。", locale: "ja" }), []);
  assert.throws(() => takeText({ text: "", locale: "ja" }), /1 to 400 characters/u);
  assert.throws(() => takeText({ text: "とし。", locale: "../ja" }), /language such as ja/u);
});

test("recording a take asks for the next number, as the producer asks, and measures it", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "kanji-take-record-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const config = takesConfig(dir);
  await cacheTake(config, "いま。", "ja", 1, glideWav(.4, 120, 110));
  await cacheTake(config, "いま。", "ja", 2, glideWav(.4, 120, 110));
  const asked = [];
  const made = await recordKanjiTake(config, { text: "いま。", locale: "ja" }, { apiKey: "key-0123456789",
    synthesize: async (job, options) => {
      asked.push({ job, options });
      return [{ id: job.beats[0].id, wavPath: await cacheTake(config, "いま。", "ja", job.beats[0].take, glideWav(.5, 125, 165)) }];
    } });
  assert.equal(made.take, 3);
  assert.equal(asked[0].job.beats[0].take, 3);
  assert.deepEqual(asked[0].job.beats[0].speaker, { id: "voice-ja", role: "narrator", voiceId: VOICES.ja });
  assert.equal(asked[0].options.apiKey, "key-0123456789");
  assert.equal(asked[0].options.direction.pace, "slow");
  const measured = await takeMeasure(made.wavPath);
  assert.ok(measured.seconds > .4 && measured.seconds < .7, String(measured.seconds));
  assert.equal(measured.shape, "rises");                                   // a glide up to its end
  assert.ok(measured.pitch.length > 10 && measured.pitch.length <= 48);
});
