import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { expandNarrationScript, placeOnAnchors, readNarrationScript } from "./anchored-narration.mjs";
import {
  KANJI_CARD_ANCHORS, kanjiCardAnchors, kanjiIntro, kanjiScriptData, kanjiShortContent, kanjiShortTiming, readKanjiDataset, readingKana, readingPairs,
  readingRomaji,
} from "./kanji-short.mjs";
import { DEFAULT_KANJI_SCRIPT } from "./kanji-short-producer.mjs";

const word = (w, ruby, romaji, meaning, reading = "on") => ({ word: w, ruby, romaji, meaning, reading });
const MIZU = {
  char: "水", jlpt: "N5",
  card: { meanings: "WATER", onyomi: "SUI (スイ)", kunyomi: "mizu (みず)", jlpt: "N5" },
  words: [word("水", "みず", "mizu", "water", "kun"), word("水道", "すいどう", "suidō", "water supply"), word("水泳", "すいえい", "suiei", "swimming"), word("下水", "げすい", "gesui", "drainage, ditch")],
};
const GAKU = {
  char: "学", jlpt: "N5",
  card: { meanings: "LEARN", onyomi: "GAKU (ガク)", kunyomi: "manabu (まな.ぶ)", jlpt: "N5" },
  words: [word("学校", "がっこう", "gakkō", "school"), word("今日", "きょう", "kyō", "today", "irregular")],
};

test("reads the kanji data and reports rows of the wrong type, and duplicates, instead of dropping them silently", () => {
  const { entries, problems } = readKanjiDataset({ kanji: [MIZU, { char: "火", card: { meanings: 3 }, words: [] }, { char: "木木", card: {} }, MIZU] });
  assert.deepEqual([...entries.keys()], ["水"]);
  assert.equal(problems.length, 3);
  assert.match(problems[0], /火.*card\.meanings/u);
  assert.match(problems[1], /one character/u);
  assert.match(problems[2], /\(水\): a second row/u);
  assert.throws(() => readKanjiDataset({}), /no `kanji` list/u);
});

test("useful words never include the bare kanji, and the kanji is named by its own word, else its on'yomi", () => {
  const mizu = kanjiShortContent(MIZU);
  assert.deepEqual(mizu.words.map(w => w.word), ["水道", "水泳", "下水"]);
  assert.deepEqual(mizu.name, { romaji: "mizu", kana: "みず" });
  assert.deepEqual(mizu.readings, { on: ["スイ"], kun: ["みず"], onRomaji: ["sui"], kunRomaji: ["mizu"] });
  const gaku = kanjiShortContent(GAKU, { speech: { 学校: "がっこう" } });
  assert.deepEqual(gaku.name, { romaji: "gaku", kana: "がく" });                     // katakana on'yomi typed as hiragana
  assert.deepEqual(gaku.wordSpeech, ["がっこう", "きょう"]);                         // override, then irregular reading from kana
  assert.deepEqual(gaku.readings.kun, ["まなぶ"]);                                     // okurigana dot dropped
  assert.throws(() => kanjiShortContent({ ...MIZU, words: [MIZU.words[0]] }), /no useful word other than itself/u);
});

test("parses card readings as romaji–kana pairs, so the name and its romaji come from one reading", () => {
  assert.deepEqual(readingKana("NICHI (ニチ), JITSU (ジツ)"), ["ニチ", "ジツ"]);
  assert.deepEqual(readingKana("-bi (-び)"), ["び"]);
  assert.deepEqual(readingRomaji("DŌ (ドウ), TŌ (トウ)"), ["dō", "tō"]);
  assert.deepEqual(readingPairs("ON, SUI (スイ)"), [{ romaji: "sui", kana: "スイ" }]);
  assert.deepEqual(readingKana(undefined), []);
});

test("gives a script the kanji's fields: name, readings, labels, words with their spoken text, and strokes", () => {
  const data = kanjiScriptData(kanjiShortContent(GAKU, { speech: { 学校: "がっこう" } }), { labels: { on: "オン", kun: "クン" }, strokeCount: 8 });
  assert.equal(data.onyomi, "ガク");
  assert.equal(data.kunyomi, "まなぶ");
  assert.deepEqual(data.labels, { on: "オン", kun: "クン" });
  assert.deepEqual(data.words.map(w => [w.word, w.speech]), [["学校", "がっこう"], ["今日", "きょう"]]);
  assert.equal(data.strokes.length, 8);
  assert.deepEqual(data.strokes[7], { n: 8 });
});

test("names the card's moments for the narration, from the card's timeline and strokes", () => {
  const timeline = { fps: 30, intro: [0, 99], write: [99, 294], review: [294, 489], info: [489, 612], frames: 612 };
  const strokes = { write: [[4.4, 5.4], [5.9, 6.5]], review: [[10.9, 11.9], [12.4, 14.9]] };
  const anchors = kanjiCardAnchors(timeline, strokes);
  assert.deepEqual(Object.keys(anchors).sort(), [...KANJI_CARD_ANCHORS].sort());
  assert.equal(anchors["write.start"], 3.3);
  assert.equal(anchors["write.firstStroke"], 4.4);
  assert.equal(anchors["review.end"], 14.9);
  assert.deepEqual(anchors["review.strokes"], [10.9, 12.4]);
});

test("the intro lasts until its lines end, on a whole frame, and is 0 without intro lines; the phases end on a frame count divisible by 3", () => {
  const intro = kanjiIntro({ placed: ["question"], end: 2.85, emphasis: [{ id: "question", at: 2.6 }] }, { readingLength: 2 });
  assert.equal(intro.intro, 99 / 30);                                                    // 2.85 + 0.45 s is exactly 99 frames
  assert.equal(intro.convertAt, .59);
  assert.equal(intro.emphasizeAt, 2.6);
  assert.deepEqual(kanjiIntro({ placed: [], end: 0, emphasis: [] }, { readingLength: 2 }), { intro: 0, convertAt: undefined, emphasizeAt: undefined });
  const timing = kanjiShortTiming({ intro: intro.intro, write: 6.5, review: 6.5, end: 18.96 });
  assert.equal(timing.frames % 3, 0);
  assert.equal(timing.totalSamples, timing.frames * 1600);
  assert.equal(["intro", "write", "review", "info"].reduce((sum, k) => sum + Math.round(timing.timing[k] * 30), 0), timing.frames);
  assert.ok(timing.frames / 30 >= 18.96 + 1.4);
  assert.throws(() => kanjiShortTiming({ intro: 3.31, write: 6.5, review: 6.5, end: 10 }), /whole number of frames/u);
});

test("the default script makes the approved short: the question while the kanji is typed, readings from the first stroke, words after the review", async () => {
  const script = readNarrationScript(JSON.parse(await readFile(DEFAULT_KANJI_SCRIPT, "utf8")));
  const lines = expandNarrationScript(script, kanjiScriptData(kanjiShortContent(MIZU), {}));
  assert.deepEqual(lines.map(l => [l.id, l.locale, l.say, l.caption]), [
    ["question", "en", "Do you know how to write the kanji みず?", "Do you know how to write the kanji mizu?"],
    ["onyomi", "ja", "おんよみ、スイ。", "おんよみ、スイ。"],
    ["kunyomi", "ja", "くんよみ、みず。", "くんよみ、みず。"],
    ["word-1", "ja", "水道。", "水道"], ["word-2", "ja", "水泳。", "水泳"], ["word-3", "ja", "下水。", "下水"],
  ]);
  const speech = { question: 2.5, onyomi: 1.07, kunyomi: 1.08, "word-1": .56, "word-2": .66, "word-3": .51 };
  const intro = kanjiIntro(placeOnAnchors({ lines, anchors: { start: 0 }, speech, partial: true }), { readingLength: 2 });
  const anchors = { start: 0, "write.firstStroke": 4.4, "review.end": 14.9 };
  const placed = placeOnAnchors({ lines, anchors, speech, highlightTail: script.highlightTail });
  assert.equal(intro.intro, 99 / 30);
  assert.ok(Math.abs(intro.emphasizeAt - (.35 + 2.5 * 35 / 38)) < .001);             // as "みず" is spoken
  assert.deepEqual(placed.onsets, { question: .35, onyomi: 4.4, kunyomi: 5.92, "word-1": 15.2, "word-2": 16.76, "word-3": 18.42 });
  assert.deepEqual(placed.highlights.map(h => h.item), [0, 1, 2]);
  assert.ok(Math.abs(placed.highlights[0].at + placed.highlights[0].hold - placed.highlights[1].at) < .001);   // each word stays lit until the next
});
