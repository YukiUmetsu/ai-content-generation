import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { expandNarrationScript, placeOnAnchors, readNarrationScript } from "./anchored-narration.mjs";
import {
  KANJI_CARD_ANCHORS, kanjiCardAnchors, kanjiCardInset, retakeFor, reuseCut, reuseFor, reuseSources, kanjiTextSettings, textKeyProblem, kanjiSpokenParts, spokenAs, PHRASE_GAP, kanjiIntro, kanjiScriptData, kanjiShortContent, kanjiShortTiming, readKanjiDataset, readingKana, readingPairs,
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

test("the card fills down to its margin unless a config keeps the platform's caption band clear", () => {
  const shorts = { left: .08, right: .12, top: .09, bottom: .19 };
  assert.deepEqual(kanjiCardInset(shorts), { left: .08, right: .12, top: .09, bottom: 0 });
  assert.deepEqual(kanjiCardInset(shorts, { bottom: .19 }), shorts);
  assert.deepEqual(kanjiCardInset(shorts, { right: 0 }), { left: .08, right: 0, top: .09, bottom: 0 });
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
  const intro = kanjiIntro({ placed: ["question"], end: 2.85, emphasis: [{ id: "question", at: 2.6 }] });
  assert.equal(intro.intro, 99 / 30);                                                    // 2.85 + 0.45 s is exactly 99 frames
  assert.equal(intro.emphasizeAt, 2.6);
  assert.deepEqual(kanjiIntro({ placed: [], end: 0, emphasis: [] }), { intro: 0, emphasizeAt: undefined });
  const timing = kanjiShortTiming({ intro: intro.intro, write: 6.5, review: 6.5, end: 18.96 });
  assert.equal(timing.frames % 3, 0);
  assert.equal(timing.totalSamples, timing.frames * 1600);
  assert.equal(["intro", "write", "review", "info"].reduce((sum, k) => sum + Math.round(timing.timing[k] * 30), 0), timing.frames);
  assert.ok(timing.frames / 30 >= 18.96 + 1.4);
  assert.throws(() => kanjiShortTiming({ intro: 3.31, write: 6.5, review: 6.5, end: 10 }), /whole number of frames/u);
});

test("the default script makes the approved short: the question while the kanji is typed, readings from the first stroke, an introduction and the words after the review", async () => {
  const script = readNarrationScript(JSON.parse(await readFile(DEFAULT_KANJI_SCRIPT, "utf8")));
  const lines = expandNarrationScript(script, kanjiScriptData(kanjiShortContent(MIZU), {}));
  assert.deepEqual(lines.map(l => [l.id, l.locale, l.say, l.caption]), [
    ["question", "en", "Do you know how to write the kanji みず?", "Do you know how to write the kanji mizu?"],
    ["onyomi", "ja", "おんよみ、スイ。", "おんよみ、スイ。"],
    ["kunyomi", "ja", "くんよみ、みず。", "くんよみ、みず。"],
    ["words-intro", "en", "Some common words using this kanji are", "Some common words using this kanji are"],
    ["word-1", "ja", "水道。", "水道"], ["word-2", "ja", "水泳。", "水泳"], ["word-3", "ja", "下水。", "下水"],
  ]);
  const speech = { question: 2.5, onyomi: 1.07, kunyomi: 1.08, "words-intro": 2.2, "word-1": .56, "word-2": .66, "word-3": .51 };
  const intro = kanjiIntro(placeOnAnchors({ lines, anchors: { start: 0 }, speech, partial: true }));
  const anchors = { start: 0, "write.firstStroke": 4.4, "review.end": 14.9 };
  const placed = placeOnAnchors({ lines, anchors, speech, highlightTail: script.highlightTail });
  assert.equal(intro.intro, 99 / 30);
  assert.ok(Math.abs(intro.emphasizeAt - (.35 + 2.5 * 35 / 38)) < .001);             // as "みず" is spoken
  // The introduction starts 0.3 s after the review; the first word follows half a second after it, the others 1 s apart.
  assert.deepEqual(placed.onsets, { question: .35, onyomi: 4.4, kunyomi: 5.92, "words-intro": 15.2, "word-1": 17.9, "word-2": 19.46, "word-3": 21.12 });
  assert.deepEqual(placed.highlights.map(h => h.item), [0, 1, 2]);
  // While the introduction plays, the card draws attention to its words, until the first word lights.
  assert.deepEqual(placed.cues, [{ id: "words-intro", cue: "words", at: 15.12, hold: 2.7 }]);
  assert.ok(Math.abs(placed.highlights[0].at + placed.highlights[0].hold - placed.highlights[1].at) < .001);   // each word stays lit until the next
});

test("a retake matches the exact text one voice reads, after normalization, and only the config's own keys", () => {
  assert.equal(retakeFor("ひと", { "ひと": 5 }), 5);
  assert.equal(retakeFor(" ひと ", { "ひと": 5 }), 5);
  assert.equal(retakeFor("ひと".normalize("NFD"), { "ひと": 5 }), 5);
  assert.equal(retakeFor("くんよみ、ひと。", { "ひと": 5 }), undefined);                     // a whole line is another text
  assert.equal(retakeFor("toString", {}), undefined);                                         // not an inherited property
  assert.equal(retakeFor("ひと", undefined), undefined);
  assert.equal(reuseFor(" ひと", { "ひと": "kunyomi" }), "kunyomi");                          // reuse matches the same way
  assert.equal(reuseFor("みず", { "ひと": "kunyomi" }), undefined);
});

test("a reused text comes only from where the source line says exactly it after a comma", () => {
  assert.deepEqual(reuseCut("くんよみ、ひと。", "ひと"), { whole: false, pauses: 1 });
  assert.deepEqual(reuseCut("おんよみ、ゲツ、ガツ。", "ガツ"), { whole: false, pauses: 2 });
  assert.deepEqual(reuseCut("ひと。", "ひと"), { whole: true, pauses: 0 });                     // a split run that is just the word
  assert.equal(reuseCut("くんよみ、ついやす。", "ひ"), null);                                    // another kanji's line: not reused
  assert.equal(reuseCut("くんよみ、ひと。", "と"), null);                                         // only the whole last part counts
  assert.equal(reuseCut("くんよみひと", "ひと"), null);                                          // no comma, no pause to cut at
  // Where a reuse applies in a short: a source line of this short, not its own, not itself reused, saying the text.
  const unit = (line, text, reusedFrom) => ({ line, text, ...(reusedFrom ? { reusedFrom } : {}) });
  const name = unit("question", "ひと", "kunyomi"), kun = unit("kunyomi", "くんよみ、ひと。");
  const intro = unit("question", "Do you know how to write the kanji");
  assert.deepEqual(reuseSources([intro, name, unit("onyomi", "おんよみ、ジン、ニン。"), kun]).get(name), { source: kun, cut: { whole: false, pauses: 1 }, from: "kunyomi" });
  assert.deepEqual(reuseSources([name, unit("onyomi", "おんよみ、ジン。")]).get(name), { why: "this short has no line kunyomi" });
  const own = unit("kunyomi", "ひと", "kunyomi");
  assert.deepEqual(reuseSources([own]).get(own), { why: "it is the text's own line" });
  const other = unit("kunyomi", "くんよみ、ついやす。");                                              // 費: the shared config does not apply
  assert.deepEqual(reuseSources([name, other]).get(name), { why: "line kunyomi does not say \"ひと\" after a comma" });
  // A chain is refused in either order: the source line has a reused part of its own.
  const chainA = unit("question", "ひと", "kunyomi"), chainB = unit("kunyomi", "くんよみ、ひと。", "question");
  for (const units of [[chainA, chainB], [chainB, chainA]]) {
    const found = reuseSources(units);
    assert.deepEqual([found.get(chainA).why, found.get(chainB).why], ["line kunyomi is itself reused", "line question is itself reused"]);
  }
  assert.equal(reuseSources([intro, kun]).size, 0);                                                 // nothing reused, nothing decided
  // A key may name the kanji's fields, so one entry covers every kanji; an exact text wins over a filled key.
  const hitoData = { char: "人", name: { kana: "ひと", romaji: "hito" }, kunyomi: "ひと", onyomi: "ジン、ニン", labels: { on: "おんよみ", kun: "くんよみ" } };
  const filled = kanjiTextSettings({ "{name.kana}": "kunyomi", " ひと": "onyomi", "{char}です": "question" }, hitoData);
  assert.equal(reuseFor("ひと", filled), "onyomi");
  assert.equal(reuseFor("人です", filled), "question");
  assert.equal(reuseFor("ひと", kanjiTextSettings({ "{name.kana}": "kunyomi" }, hitoData)), "kunyomi");
  assert.equal(retakeFor("くんよみ、ひと。", kanjiTextSettings({ "{labels.kun}、{kunyomi}。": 3 }, hitoData)), 3);
  assert.deepEqual(kanjiTextSettings({ "{kunyomi}": "kunyomi" }, { ...hitoData, kunyomi: "" }), []);   // no kun'yomi: no entry
  assert.equal(kanjiTextSettings(undefined, hitoData), undefined);
  assert.equal(textKeyProblem("{name.kana}"), null);
  assert.match(textKeyProblem("{item.word}と{name}"), /names \{item\.word\}, \{name\}/u);
});

test("a line is read in parts at its template's commas: phrases said in every short are their own recordings", async () => {
  const { expandNarrationScript } = await import("./anchored-narration.mjs");
  const script = { steps: [
    { id: "question", say: "Do you know how to write the kanji {name.kana}?", at: "start", locale: "en" },
    { id: "onyomi", say: "{labels.on}、{onyomi}。", at: "write.firstStroke" },
    { id: "intro", say: "Some common words using this kanji are", at: "review.end", locale: "en" },
  ], locale: "ja" };
  const data = { name: { kana: "ひと" }, labels: { on: "おんよみ" }, onyomi: "ジン、ニン" };
  const [question, on, intro] = expandNarrationScript(script, data);
  const voiceIds = { ja: "j".repeat(16), en: "e".repeat(16) };
  assert.deepEqual(kanjiSpokenParts(on, { voiceIds }).map(p => [p.text, p.phrase, p.gapBefore]),
    [["おんよみ、", true, undefined], ["ジン、ニン。", false, PHRASE_GAP]]);         // the reading's own comma does not split it
  assert.deepEqual(kanjiSpokenParts(question, { voiceIds }).map(p => [p.text, p.locale, p.phrase, p.gapBefore]),
    [["Do you know how to write the kanji", "en", true, undefined], ["ひと", "ja", false, undefined]]);
  assert.deepEqual(kanjiSpokenParts(intro, { voiceIds }).map(p => [p.text, p.phrase]), [["Some common words using this kanji are", true]]);
  // Without a voice per language a line still splits at its commas; with split: false it is read whole.
  assert.deepEqual(kanjiSpokenParts(on, { phraseGap: .3 }).map(p => [p.text, p.gapBefore]), [["おんよみ、", undefined], ["ジン、ニン。", .3]]);
  assert.deepEqual(kanjiSpokenParts(on, { split: false }).map(p => p.text), ["おんよみ、ジン、ニン。"]);
  // Each part knows where it lies in the line (for the name's pulse).
  assert.deepEqual(kanjiSpokenParts(on, { voiceIds }).map(p => [p.from, p.to]), [[0, 5], [5, 11]]);
});

test("a part can be spoken as another text (narration.speech), matched on what the line says", () => {
  assert.equal(spokenAs("いま。", { "いま。": "今。" }), "今。");
  assert.equal(spokenAs("いま。", { "水泳": "すいえい" }), undefined);
  assert.equal(spokenAs("いま。", { "いま。": "  " }), undefined);
  // A reuse is matched on what the lines say, so a reading spoken as its kanji still gives the name its audio.
  const name = { line: "question", text: "いま", reusedFrom: "kunyomi" }, kun = { line: "kunyomi", text: "今。", written: "いま。" };
  assert.deepEqual(reuseSources([name, kun]).get(name).cut, { whole: true, pauses: 0 });
});

test("a part of punctuation only is never read alone", async () => {
  const { expandNarrationScript } = await import("./anchored-narration.mjs");
  const [line] = expandNarrationScript({ steps: [{ id: "onyomi", say: "{labels.on}、{onyomi}。", at: "start" }], locale: "ja" },
    { labels: { on: "On'yomi" }, onyomi: "コン" });
  const parts = kanjiSpokenParts(line, { voiceIds: { ja: "j".repeat(16), en: "e".repeat(16) } });
  assert.deepEqual(parts.map(p => [p.text, p.locale, p.gapBefore]), [["On'yomi", "en", undefined], ["、コン。", "ja", PHRASE_GAP]]);
  assert.ok(parts.every(p => /[\p{L}\p{N}]/u.test(p.text)));
});

test("a kanji can be called by any of its readings; the romaji comes from the data", () => {
  const nen = { char: "年", jlpt: "N5", card: { meanings: "YEAR", onyomi: "NEN (ネン)", kunyomi: "toshi (とし)", jlpt: "N5" },
    words: [{ word: "年", ruby: "とし", romaji: "toshi", meaning: "year", reading: "kun" }, { word: "来年", ruby: "らいねん", romaji: "rainen", meaning: "next year", reading: "on" }] };
  assert.deepEqual(kanjiShortContent(nen).name, { romaji: "toshi", kana: "とし" });                 // its own word's reading
  assert.deepEqual(kanjiShortContent(nen).nameChoices.map(c => [c.kana, c.romaji, c.kind]), [["とし", "toshi", "word"], ["ねん", "nen", "on"]]);
  assert.deepEqual(kanjiShortContent(nen, { name: "ねん" }).name, { romaji: "nen", kana: "ねん" });
  assert.deepEqual(kanjiShortContent(nen, { name: "ネン" }).name, { romaji: "nen", kana: "ねん" });  // katakana is the same reading
  assert.throws(() => kanjiShortContent(nen, { name: "ねんど" }), /年 has no reading ねんど to name it by \(its readings: とし, ねん\)/u);
});

test("a reuse can try several lines in order, and katakana matches its hiragana", () => {
  const name = { line: "question", text: "ねん", reusedFrom: ["kunyomi", "onyomi"] };
  const kun = { line: "kunyomi", text: "とし。" }, on = { line: "onyomi", text: "ネン。" };
  const found = reuseSources([name, { line: "kunyomi", text: "くんよみ、" }, kun, { line: "onyomi", text: "おんよみ、" }, on]).get(name);
  assert.deepEqual([found.source, found.from, found.cut], [on, "onyomi", { whole: true, pauses: 0 }]);
  const none = reuseSources([{ ...name, text: "とん" }, kun, on]);
  assert.match([...none.values()][0].why, /line kunyomi does not say "とん" after a comma; line onyomi does not say "とん"/u);
});
