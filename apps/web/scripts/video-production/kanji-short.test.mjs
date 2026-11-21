import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KANJI_SHORT_PACING, SAMPLE_RATE, chooseMusicWindow, kanjiShortContent, kanjiShortLines, placeNarration, planKanjiIntro, planKanjiShort,
  readKanjiDataset, readingKana, readingRomaji, speechBounds, toFrameGrid, trimSpeech,
} from "./kanji-short.mjs";

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

test("reads the kanji data and reports rows of the wrong type instead of dropping them silently", () => {
  const { entries, problems } = readKanjiDataset({ kanji: [MIZU, { char: "火", card: { meanings: 3 }, words: [] }, { char: "木木", card: {} }] });
  assert.deepEqual([...entries.keys()], ["水"]);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /火.*card\.meanings/u);
  assert.match(problems[1], /one character/u);
  assert.throws(() => readKanjiDataset({}), /no `kanji` list/u);
});

test("useful words never include the bare kanji, and the kanji is named by its own word, else its on'yomi", () => {
  const mizu = kanjiShortContent(MIZU);
  assert.deepEqual(mizu.words.map(w => w.word), ["水道", "水泳", "下水"]);
  assert.deepEqual(mizu.name, { romaji: "mizu", kana: "みず" });
  assert.deepEqual(mizu.readings, { on: ["スイ"], kun: ["みず"] });
  const gaku = kanjiShortContent(GAKU, { speech: { 学校: "がっこう" } });
  assert.deepEqual(gaku.name, { romaji: "gaku", kana: "がく" });                     // katakana on'yomi typed as hiragana
  assert.deepEqual(gaku.wordSpeech, ["がっこう", "きょう"]);                         // override, then irregular reading from kana
  assert.deepEqual(gaku.readings.kun, ["まなぶ"]);                                     // okurigana dot dropped
  assert.throws(() => kanjiShortContent({ ...MIZU, words: [MIZU.words[0]] }), /no useful word other than itself/u);
});

test("the voice gets the name in kana, the captions in romaji, and the lines follow the card", () => {
  const lines = kanjiShortLines(kanjiShortContent({ ...MIZU, char: "日", card: { ...MIZU.card, kunyomi: "hi (ひ)" }, words: [word("日", "ひ", "hi", "day", "kun"), ...MIZU.words.slice(1)] }));
  assert.equal(lines[0].text, "Do you know how to write the kanji ひ?");
  assert.equal(lines[0].caption, "Do you know how to write the kanji hi?");
  assert.ok(lines[0].nameAt > .8 && lines[0].nameAt < 1);
  assert.deepEqual(lines.map(l => l.id), ["question", "onyomi", "kunyomi", "word-1", "word-2", "word-3"]);
  assert.equal(lines[1].text, "おんよみ、スイ。");
  assert.deepEqual(lines.filter(l => l.role === "word").map(l => l.word), [0, 1, 2]);
  const noKun = kanjiShortLines(kanjiShortContent({ ...MIZU, card: { ...MIZU.card, kunyomi: undefined } }));
  assert.ok(!noKun.some(l => l.id === "kunyomi"));
  assert.throws(() => kanjiShortLines(kanjiShortContent(MIZU), { question: "No name here" }), /\{name\}/u);
});

test("parses card readings with several kana, okurigana marks and macrons", () => {
  assert.deepEqual(readingKana("NICHI (ニチ), JITSU (ジツ)"), ["ニチ", "ジツ"]);
  assert.deepEqual(readingKana("-bi (-び)"), ["び"]);
  assert.deepEqual(readingRomaji("DŌ (ドウ), TŌ (トウ)"), ["dō", "tō"]);
  assert.deepEqual(readingKana(undefined), []);
});

/** Silence, a 200 Hz tone, silence. */
function take(before, tone, after) {
  const s = new Int16Array(Math.round((before + tone + after) * SAMPLE_RATE));
  const a = Math.round(before * SAMPLE_RATE), b = a + Math.round(tone * SAMPLE_RATE);
  for (let i = a; i < b; i++) s[i] = Math.round(8000 * Math.sin(2 * Math.PI * 200 * i / SAMPLE_RATE));
  return s;
}

test("finds the speech in a take and trims it to whole milliseconds with a short lead", () => {
  const bounds = speechBounds(take(.2, .5, .3));
  assert.ok(Math.abs(bounds.start / SAMPLE_RATE - .2) < .012);
  assert.ok(Math.abs(bounds.end / SAMPLE_RATE - .7) < .012);
  const trimmed = trimSpeech(take(.2, .5, .3));
  assert.equal(trimmed.clip.length % 48, 0);
  assert.ok(Math.abs(trimmed.lead - .03) < .002);
  assert.ok(Math.abs(trimmed.speech - .5) < .02);
  assert.equal(trimmed.clip[0], 0);                                                     // faded in from silence
  assert.equal(speechBounds(new Int16Array(4800)), null);
  assert.throws(() => trimSpeech(new Int16Array(4800)), /no speech/u);
});

const STROKES = { write: [[4.4, 5.4], [5.9, 6.5], [7.2, 7.5], [7.8, 8.4]], review: [[10.9, 11.9], [12.4, 13], [13.7, 14], [14.3, 14.9]] };
const LINES = [
  { id: "question", role: "question", speech: 2.5 }, { id: "onyomi", role: "reading", speech: 1.07 }, { id: "kunyomi", role: "reading", speech: 1.08 },
  { id: "word-1", role: "word", word: 0, speech: .56 }, { id: "word-2", role: "word", word: 1, speech: .66 }, { id: "word-3", role: "word", word: 2, speech: .51 },
];

test("times the intro on whole frames: the reading is typed at once and the name pulses as it is spoken", () => {
  const intro = planKanjiIntro({ speech: 2.5, nameAt: .9 }, KANJI_SHORT_PACING, 2);
  assert.equal(Math.round(intro.intro * 30), intro.intro * 30);
  assert.ok(intro.intro >= .35 + 2.5 + .45);
  assert.equal(intro.convertAt, .59);                                                   // two kana from 0.15 s
  assert.equal(intro.emphasizeAt, .35 + 2.25);
  assert.throws(() => planKanjiIntro({ speech: 0, nameAt: .5 }), /measured question/u);
});

test("puts the readings on the first stroke, the words after the review, and ends on a frame count divisible by 3", () => {
  const intro = planKanjiIntro({ speech: 2.5, nameAt: .9 }, KANJI_SHORT_PACING, 2);
  const plan = planKanjiShort({ lines: LINES, strokes: STROKES, intro });
  assert.equal(plan.onsets.question, .35);
  assert.equal(plan.onsets.onyomi, 4.4);                                                // as the brush lands
  assert.equal(plan.onsets.kunyomi, round(4.4 + 1.07 + .45));
  assert.equal(plan.onsets["word-1"], round(14.9 + .3));                                     // as the review writing ends
  assert.equal(plan.onsets["word-2"], round(plan.onsets["word-1"] + .56 + 1));
  assert.equal(plan.frames % 3, 0);
  assert.equal(plan.totalSamples, plan.frames * 1600);
  const phases = ["intro", "write", "review", "info"].reduce((sum, k) => sum + Math.round(plan.timing[k] * 30), 0);
  assert.equal(phases, plan.frames);                                                    // the card's phases add up to the video
  assert.ok(plan.frames / 30 >= plan.onsets["word-3"] + .51 + KANJI_SHORT_PACING.tail - 1e-9);
  // Each word is highlighted from just before it is spoken until the next one starts.
  assert.deepEqual(plan.wordHighlights.map(c => c.word), [0, 1, 2]);
  assert.ok(plan.wordHighlights[0].at < plan.onsets["word-1"]);
  assert.ok(plan.wordHighlights[0].at + plan.wordHighlights[0].hold > plan.wordHighlights[1].at);
  assert.throws(() => planKanjiShort({ lines: LINES.map(l => l.role === "reading" ? { ...l, speech: 4 } : l), strokes: STROKES, intro }), /lengthen the writing/u);
  assert.throws(() => planKanjiShort({ lines: LINES, strokes: STROKES, intro: { ...intro, intro: 3.31 } }), /whole number of frames/u);
  assert.equal(toFrameGrid(6.51), 6.5);
  assert.equal(toFrameGrid(6.52), 196 / 30);
});
const round = (v) => Math.round(v * 1000) / 1000;

test("places each line so its speech starts on its onset, with whole-millisecond pauses that end on the last frame", () => {
  const clip = (seconds) => ({ clip: new Int16Array(Math.round(seconds * 1000) * 48).fill(1000), lead: .03 });
  const takes = [{ id: "a", ...clip(1) }, { id: "b", ...clip(.5) }];
  const beats = placeNarration(takes, { a: .35, b: 2 }, 3 * 1600 * 30);
  assert.equal(beats[0].samples.length, Math.round((.35 - .03) * 1000) * 48 + 48000);   // leading silence + clip
  assert.equal(beats[0].samples[0], 0);
  const pauseEnd = beats[0].samples.length + beats[0].pauseAfterMs * 48;
  assert.equal(pauseEnd, Math.round((2 - .03) * 1000) * 48);                              // b's speech starts at 2 s
  assert.equal(pauseEnd + beats[1].samples.length + beats[1].pauseAfterMs * 48, 3 * 1600 * 30);
  assert.ok(beats.every(b => Number.isInteger(b.pauseAfterMs) && b.pauseAfterMs >= 0));
  assert.throws(() => placeNarration(takes, { a: .35, b: .8 }, 144000), /before the previous line ends/u);
  assert.throws(() => placeNarration(takes, { a: .35, b: 2 }, 48000), /past the end/u);
});

test("chooses the music window without a silent stretch where nobody speaks", () => {
  // Ten seconds of soft music with a two-second hole at 5–7 s.
  const music = new Int16Array(10 * SAMPLE_RATE);
  for (let i = 0; i < music.length; i++) if (i < 5 * SAMPLE_RATE || i > 7 * SAMPLE_RATE) music[i] = Math.round(3000 * Math.sin(2 * Math.PI * 220 * i / SAMPLE_RATE));
  const window = chooseMusicWindow(music, 3, [{ onset: 2, end: 2.5 }], { from: 0, step: .5 });
  const end = window.start + 3;
  assert.ok(end <= 5 || window.start >= 7, `window ${window.start}–${end} overlaps the hole`);
  assert.equal(window.longestQuietSeconds, 0);
  assert.throws(() => chooseMusicWindow(music, 20, []), /shorter than the video/u);
});
