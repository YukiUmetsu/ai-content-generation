import { test } from "node:test";
import assert from "node:assert/strict";
import { expandNarrationScript, placeOnAnchors, readNarrationScript, renderTemplate, scriptAnchors } from "./anchored-narration.mjs";

const script = (steps, extra = {}) => ({ schemaVersion: 1, kind: "anchored-narration-script", locale: "ja", steps, ...extra });
const DATA = { name: { kana: "みず", romaji: "mizu" }, on: "スイ", kun: "", words: [{ word: "水道", speech: "水道" }, { word: "今日", speech: "きょう" }], strokes: [{ n: 1 }, { n: 2 }] };

test("reads a script and names the step of every problem", () => {
  const read = readNarrationScript(script([{ id: "q", say: "Hello {name.romaji}", at: "start" }]));
  assert.deepEqual(read.steps[0], { id: "q", say: "Hello {name.romaji}", at: "start", gap: .45, offset: 0 });
  assert.equal(read.highlightTail, 1);
  assert.equal(read.highlightLead, .08);
  const bad = (step, pattern) => assert.throws(() => readNarrationScript(script([step])), pattern);
  bad({ id: "q", say: "x", at: "start", volume: 3 }, /steps\[0\] \(q\)\.volume is not a step setting/u);
  bad({ id: "w-{n}", say: "x", at: "start" }, /uses \{n\} without forEach/u);
  bad({ id: "w", say: "x", forEach: "words", at: "start" }, /must contain \{n\} or \{index\}/u);
  bad({ id: "q", say: "x", at: "start", highlight: true }, /highlight needs forEach/u);
  bad({ id: "q", say: "x {a b}", at: "start" }, /\{a b\} that is not a data path/u);
  bad({ id: "q", say: "x", at: "start", gap: -1 }, /gap must be 0 to 10/u);
  bad({ id: "q", say: "x", at: "start", locale: "ja_JP" }, /locale must be a BCP 47 tag/u);
  bad({ id: "m-{meanings}", say: "x", at: "start" }, /id must be letters, digits/u);           // ids take only {n} or {index}
  bad({ id: "q", say: "Hello", at: "start", emphasize: "{name.kana}" }, /emphasize must be a part of say/u);
  assert.throws(() => readNarrationScript({ ...script([{ id: "q", say: "x", at: "start" }]), locale: "ja_JP" }), /default locale/u);
  assert.throws(() => readNarrationScript({ ...script([]), steps: [] }), /one to 40 steps/u);
  assert.throws(() => readNarrationScript({ kind: "other" }), /schemaVersion 1/u);
  assert.deepEqual(scriptAnchors(readNarrationScript(script([{ id: "a", say: "x", at: "start" }, { id: "b", say: "y", at: "after" }, { id: "c", say: "z", at: "review.end" }]))), ["start", "review.end"]);
});

test("fills templates from the data and refuses a missing field or a list", () => {
  assert.equal(renderTemplate("{name.kana} ({name.romaji}) {count}", { ...DATA, count: 4 }), "みず (mizu) 4");
  assert.throws(() => renderTemplate("{name.reading}", DATA), /\{name\.reading\} is missing/u);
  assert.throws(() => renderTemplate("{words}", DATA), /not a text or a number/u);
});

test("expands steps: conditions, one line per item, captions, locales, highlights and the emphasized text", () => {
  const lines = expandNarrationScript(readNarrationScript(script([
    { id: "question", say: "Do you know {name.kana}?", caption: "Do you know {name.romaji}?", locale: "en", at: "start", offset: .35, emphasize: "{name.kana}" },
    { id: "on", when: "on", say: "おんよみ、{on}。", at: "write.firstStroke" },
    { id: "kun", when: "kun", say: "くんよみ、{kun}。", at: "write.firstStroke" },
    { id: "word-{n}", forEach: "words", say: "{item.speech}。", caption: "{item.word}", highlight: true, at: "review.end", offset: .3, gap: 1 },
    { id: "stroke-{n}", forEach: "strokes", say: "{n}", at: "review.strokes", gap: .1 },
  ])), DATA);
  assert.deepEqual(lines.map(l => l.id), ["question", "on", "word-1", "word-2", "stroke-1", "stroke-2"]);   // empty kun'yomi: no line
  assert.deepEqual(lines[0], { id: "question", say: "Do you know みず?", caption: "Do you know mizu?", locale: "en", at: "start", offset: .35, gap: .45, emphasizeAt: 12 / 15 });   // "Do you know " is 12 of 15 characters
  assert.deepEqual(lines.slice(2, 4).map(l => [l.say, l.caption, l.index, l.list, l.highlight, l.locale]), [["水道。", "水道", 0, "words", true, "ja"], ["きょう。", "今日", 1, "words", true, "ja"]]);
  // The emphasized part is found where the template puts it, not at an earlier copy of its text.
  const ki = expandNarrationScript(readNarrationScript(script([{ id: "q", say: "き書き方は{name.kana}", at: "start", emphasize: "{name.kana}" }])), { name: { kana: "き" } });
  assert.equal(ki[0].emphasizeAt, 5 / 6);
  assert.throws(() => expandNarrationScript(readNarrationScript(script([{ id: "q", say: "x", at: "start", when: "kunYomi" }])), DATA), /when kunYomi is not a field/u);
  assert.throws(() => expandNarrationScript(readNarrationScript(script([{ id: "a", say: "x", at: "start" }, { id: "a", say: "y", at: "after" }])), DATA), /share an id \(a\)/u);
});

test("places lines on their anchors or after the previous line, whichever is later, and reports drift, highlights and emphasis", () => {
  const lines = [
    { id: "q", at: "start", offset: .35, gap: .45, emphasizeAt: .75 },
    { id: "on", at: "write.firstStroke", offset: 0, gap: .45 },
    { id: "kun", at: "write.firstStroke", offset: 0, gap: .45 },
    { id: "w1", at: "review.end", offset: .3, gap: 1, index: 0, highlight: true },
    { id: "w2", at: "review.end", offset: .3, gap: 1, index: 1, highlight: true },
    { id: "s2", at: "review.strokes", offset: 0, gap: .1, index: 1 },
  ];
  const speech = { q: 2.5, on: 1, kun: 1, w1: .5, w2: .6, s2: .3 };
  // Only the intro's lines are known before the card is planned: placement stops at the first unknown anchor.
  const intro = placeOnAnchors({ lines, anchors: { start: 0 }, speech, partial: true });
  assert.deepEqual(intro.placed, ["q"]);
  assert.equal(intro.end, 2.85);
  assert.deepEqual(intro.emphasis, [{ id: "q", at: .35 + 2.5 * .75 }]);
  const anchors = { start: 0, "write.firstStroke": 4, "review.end": 12, "review.strokes": [9, 10, 11] };
  const all = placeOnAnchors({ lines, anchors, speech, highlightTail: 1 });
  assert.deepEqual(all.onsets, { q: .35, on: 4, kun: 5.45, w1: 12.3, w2: 13.8, s2: 14.5 });
  assert.equal(all.drift.on, 0);
  assert.ok(!("kun" in all.drift));                                                      // it follows on'yomi on the same anchor on purpose
  assert.ok(!("w2" in all.drift));
  assert.equal(all.drift.s2, 4.5);                                                      // review stroke 2 is at 10 s; w2 ends at 14.4
  assert.deepEqual(all.highlights, [{ item: 0, at: 12.22, hold: 1.5 }, { item: 1, at: 13.72, hold: .6 + .08 + 1 }]);
  assert.equal(all.end, 14.8);
  assert.throws(() => placeOnAnchors({ lines, anchors: { start: 0 }, speech }), /needs the anchor write\.firstStroke/u);
  assert.throws(() => placeOnAnchors({ lines: [{ id: "a", at: "after", gap: 0 }], anchors: {}, speech: { a: 1 } }), /it is the first/u);
  assert.throws(() => placeOnAnchors({ lines: [lines[0]], anchors: { start: 0 }, speech: {} }), /no measured speech/u);
  assert.throws(() => placeOnAnchors({ lines: [{ id: "s", at: "review.strokes", offset: 0, gap: 0, index: 5 }], anchors, speech: { s: 1 } }), /for item 6/u);
});

test("keeps a host's floor for every gap and the first start, such as the silence around recorded clips", () => {
  const lines = [{ id: "a", at: "start", offset: 0, gap: 0 }, { id: "b", at: "start", offset: 0, gap: .05 }];
  const placed = placeOnAnchors({ lines, anchors: { start: 0 }, speech: { a: 1, b: 1 }, minGap: .12, minStart: .04 });
  assert.deepEqual(placed.onsets, { a: .04, b: 1.16 });
});


test("a line's pauseAfter is the silence before the next line, in place of that line's own gap", () => {
  const read = readNarrationScript(script([
    { id: "intro", say: "Some words are", locale: "en", at: "review", pauseAfter: .5 },
    { id: "w{n}", forEach: "words", say: "{item.speech}", at: "review", gap: 1 },
  ]));
  const lines = expandNarrationScript(read, DATA);
  assert.deepEqual(lines.map(l => [l.id, l.pauseAfter]), [["intro", .5], ["w1", undefined], ["w2", undefined]]);
  const placed = placeOnAnchors({ lines, anchors: { review: 10 }, speech: { intro: 2, w1: .6, w2: .7 } });
  assert.deepEqual(placed.onsets, { intro: 10, w1: 12.5, w2: 14.1 });       // half a second after the intro, then the words' own 1 s gap
  // The host's floor still applies; an anchor later than the pause still wins.
  assert.equal(placeOnAnchors({ lines, anchors: { review: 10 }, speech: { intro: 2, w1: .6, w2: .7 }, minGap: .8 }).onsets.w1, 12.8);
  const short = readNarrationScript(script([{ id: "a", say: "x", at: "start", pauseAfter: 0 }, { id: "b", say: "y", at: "late", gap: 2 }]));
  assert.equal(placeOnAnchors({ lines: expandNarrationScript(short, DATA), anchors: { start: 0, late: 5 }, speech: { a: 1, b: 1 } }).onsets.b, 5);
  assert.throws(() => readNarrationScript(script([{ id: "a", say: "x", at: "start", pauseAfter: -1 }])), /steps\[0\] \(a\)\.pauseAfter must be 0 to 10 seconds/u);
});
