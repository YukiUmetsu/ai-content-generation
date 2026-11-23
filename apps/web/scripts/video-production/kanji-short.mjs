/** Kanji study shorts: what the card shows and what the narration's templates can say, from a
 * kanji data file, and the card's anchors and phases for the anchored narration. Pure.
 * The picture is Kumiki's `shodo-kanji-card`; the voice-over is an anchored-narration script
 * (default: kanji-short-script.json), so its wording, order and timing are data, not code.
 */
import { renderTemplate } from "./anchored-narration.mjs";
import { scriptRuns } from "./voice-runs.mjs";

export const KANJI_FPS = 30;
const LEVELS = new Set(["N5", "N4", "N3", "N2", "N1"]);
const fail = (message) => { throw new Error(`Kanji short: ${message}`); };
const text = (value, max) => typeof value === "string" && value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);

/**
 * Reads a kanji study-card data file: `{ kanji: [{ char, jlpt, words: [{ word, ruby, romaji,
 * meaning, reading? }], card: { meanings, onyomi, kunyomi, jlpt } }] }`. An entry with a field of
 * the wrong type is reported, not silently dropped, so a bad row never becomes a wrong video.
 * @returns {{ entries: Map<string, object>, problems: string[] }}
 */
export function readKanjiDataset(json) {
  const list = json && typeof json === "object" ? json.kanji : undefined;
  if (!Array.isArray(list) || !list.length) fail("the data file has no `kanji` list");
  const entries = new Map(), problems = [];
  list.forEach((item, index) => {
    const at = `kanji[${index}]`;
    const char = item?.char;
    if (typeof char !== "string" || [...char].length !== 1) { problems.push(`${at}.char: one character is required`); return; }
    const card = item.card;
    const bad = [];
    if (!card || typeof card !== "object") bad.push("card");
    else for (const key of ["meanings", "onyomi", "kunyomi"])
      if (card[key] !== undefined && !text(card[key], 200)) bad.push(`card.${key}`);
    const jlpt = card?.jlpt ?? item.jlpt;
    if (jlpt !== undefined && !LEVELS.has(jlpt)) bad.push("jlpt");
    const words = Array.isArray(item.words) ? item.words : [];
    words.forEach((word, i) => {
      for (const key of ["word", "ruby", "romaji", "meaning"]) if (!text(word?.[key], 80)) bad.push(`words[${i}].${key}`);
      if (word?.reading !== undefined && !["on", "kun", "irregular"].includes(word.reading)) bad.push(`words[${i}].reading`);
    });
    if (bad.length) { problems.push(`${at} (${char}): ${bad.join(", ")} has the wrong type`); return; }
    if (entries.has(char)) { problems.push(`${at} (${char}): a second row for this kanji; the first one is used`); return; }
    entries.set(char, { char, jlpt: jlpt ?? null, card: { meanings: card.meanings, onyomi: card.onyomi, kunyomi: card.kunyomi }, words });
  });
  return { entries, problems };
}

/**
 * The readings of a card reading text as romaji–kana pairs: "NICHI (ニチ), JITSU (ジツ)" →
 * [{ romaji: "nichi", kana: "ニチ" }, …]. A reading without kana in parentheses is left out, so the
 * spoken name and its romaji always come from the same reading. Okurigana marks are dropped.
 */
export function readingPairs(cardText) {
  if (typeof cardText !== "string") return [];
  return cardText.split(",").flatMap(part => {
    const m = /^\s*([^()]*?)\s*\(([^)]+)\)\s*$/u.exec(part);
    const romaji = m?.[1].replace(/[-.]/gu, "").trim().toLowerCase(), kana = m?.[2].replace(/[-.]/gu, "").trim();
    return romaji && kana ? [{ romaji, kana }] : [];
  });
}
/** Kana of a card reading text: "NICHI (ニチ), JITSU (ジツ)" → ["ニチ", "ジツ"]. */
export const readingKana = (cardText) => readingPairs(cardText).map(p => p.kana);
/** Romaji of a card reading text: "NICHI (ニチ), JITSU (ジツ)" → ["nichi", "jitsu"]. */
export const readingRomaji = (cardText) => readingPairs(cardText).map(p => p.romaji);

const toHiragana = (kana) => kana.replace(/[\u30a1-\u30f6]/gu, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
/** Plain ASCII romaji for an English sentence: macrons become plain vowels (dō → do). */
export const plainRomaji = (romaji) => romaji.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").replace(/[^a-z' -]/giu, "").trim();

/**
 * What one kanji's short shows and says.
 * - Useful words never include the bare character (水 alone is not a "useful word" for 水): the
 *   first `maxWords` other words of the entry, in the data's order.
 * - The character's spoken name is the reading of its own word when it has one (水 → mizu),
 *   otherwise its first on'yomi (学 → gaku), otherwise its first kun'yomi. `name` chooses another
 *   of its readings by its kana (年: "ねん" in place of とし); its romaji comes from the data.
 *   `nameChoices` lists the readings it can be called by.
 * - A word is spoken as written, so the voice reads it in context; an irregular reading (今日)
 *   is spoken from its kana. `speech` overrides the text for a word, for a voice that misreads it.
 */
export function kanjiShortContent(entry, { maxWords = 3, speech = {}, name: chosen } = {}) {
  if (!entry?.char) fail("a kanji entry is required");
  const words = entry.words.filter(word => word.word !== entry.char).slice(0, maxWords);
  if (!words.length) fail(`${entry.char} has no useful word other than itself`);
  const own = entry.words.find(word => word.word === entry.char);
  const onPairs = readingPairs(entry.card.onyomi), kunPairs = readingPairs(entry.card.kunyomi);
  const on = onPairs.map(p => p.kana), kun = kunPairs.map(p => p.kana);
  const choices = [];
  for (const [kind, pair] of [...(own ? [["word", { romaji: own.romaji, kana: own.ruby }]] : []), ...onPairs.map(p => ["on", p]), ...kunPairs.map(p => ["kun", p])]) {
    const kana = toHiragana(pair.kana), romaji = plainRomaji(pair.romaji).toLowerCase();
    if (kana && romaji && !choices.some(c => c.kana === kana)) choices.push({ kana, romaji, kind });
  }
  const wanted = typeof chosen === "string" && chosen.trim() ? toHiragana(chosen.normalize("NFC").trim()) : null;
  const name = wanted ? choices.find(c => c.kana === wanted) : choices[0];
  if (wanted && !name) fail(`${entry.char} has no reading ${chosen} to name it by (its readings: ${choices.map(c => c.kana).join(", ") || "none"})`);
  if (!name) fail(`${entry.char} has no reading to name it by`);
  return {
    char: entry.char, jlpt: entry.jlpt, meanings: entry.card.meanings, onyomi: entry.card.onyomi, kunyomi: entry.card.kunyomi,
    words: words.map(({ word, ruby, romaji, meaning }) => ({ word, ruby, romaji, meaning })),
    wordSpeech: words.map(word => typeof speech[word.word] === "string" && speech[word.word].trim() ? speech[word.word].trim()
      : word.reading === "irregular" ? word.ruby : word.word),
    name: { romaji: name.romaji, kana: name.kana }, nameChoices: choices,
    readings: { on, kun, onRomaji: onPairs.map(p => p.romaji), kunRomaji: kunPairs.map(p => p.romaji) },
  };
}

/**
 * Default pacing, seconds. `write` and `review` are the two writing passes (6.6 s keeps the hand
 * pace the user approved in the 水 short, now that the brush also flies in from outside the frame
 * and out again); `introTail` the hold after the intro's last line; `tail` after the last line.
 */
export const KANJI_SHORT_PACING = Object.freeze({ write: 6.6, review: 6.6, introTail: .45, tail: 1.4 });

/**
 * The safe bands the card keeps clear, over the destination preset's. By default the card runs
 * down to its own margin (bottom 0), so the frame has no empty band at the bottom; the platform's
 * title and channel name then lie over the lower part of the card. `card.safeInset` overrides any
 * band (0..0.4 of the frame), for example `{ "bottom": 0.19 }` to keep the card above them.
 */
export const KANJI_SHORT_CARD_INSET = Object.freeze({ bottom: 0 });
export const kanjiCardInset = (presetInset, override = {}) => ({ ...presetInset, ...KANJI_SHORT_CARD_INSET, ...override });

/** Why the card's bands cannot be used as they are, or null: the card would shrink opposite bands that cover more than 0.45 of the frame together. */
export function kanjiCardInsetProblem(inset) {
  for (const [a, b] of [["top", "bottom"], ["left", "right"]])
    if (inset[a] + inset[b] > .45 + 1e-9) return `${a} and ${b} together cover ${+(inset[a] + inset[b]).toFixed(3)} of the frame; the card allows at most 0.45`;
  return null;
}

/**
 * The fields an anchored-narration script can use for one kanji:
 * `char`, `name.kana`, `name.romaji`, `meanings`, `jlpt`, `onyomi` and `kunyomi` (kana, joined with
 * 、), `onyomiRomaji`, `kunyomiRomaji`, `labels.on`, `labels.kun`, `words` (each `word`, `ruby`,
 * `romaji`, `meaning`, `speech`) and `strokes` (each `n`).
 */
export function kanjiScriptData(content, { labels = { on: "おんよみ", kun: "くんよみ" }, strokeCount = 0 } = {}) {
  return {
    char: content.char, name: content.name, meanings: content.meanings ?? "", jlpt: content.jlpt ?? "",
    onyomi: content.readings.on.join("、"), kunyomi: content.readings.kun.map(toHiragana).join("、"),
    onyomiRomaji: content.readings.onRomaji.join(", "), kunyomiRomaji: content.readings.kunRomaji.join(", "),
    labels: { on: labels.on, kun: labels.kun },
    words: content.words.map((word, i) => ({ ...word, speech: content.wordSpeech[i] })),
    strokes: Array.from({ length: strokeCount }, (_, i) => ({ n: i + 1 })),
  };
}

/**
 * The card's moments an anchored-narration line can be placed on, seconds of the video:
 * start, write.start, write.firstStroke, write.lastStroke, review.start, review.firstStroke,
 * review.end (the last review stroke lifts), info.start, and the lists write.strokes and
 * review.strokes (each stroke's start), from Kumiki's `kanjiCardWriting` timeline and strokes.
 */
export function kanjiCardAnchors(timeline, strokes) {
  const s = (frame) => frame / timeline.fps;
  return {
    start: 0, "write.start": s(timeline.write[0]), "write.firstStroke": strokes.write[0]?.[0], "write.lastStroke": strokes.write.at(-1)?.[1],
    "review.start": s(timeline.review[0]), "review.firstStroke": strokes.review[0]?.[0], "review.end": strokes.review.at(-1)?.[1],
    "info.start": s(timeline.info[0]), "write.strokes": strokes.write.map(p => p[0]), "review.strokes": strokes.review.map(p => p[0]),
  };
}
/** The anchor names `kanjiCardAnchors` gives (taken from it, so the two never differ), for checking a script before any work. */
export const KANJI_CARD_ANCHORS = Object.freeze(Object.keys(kanjiCardAnchors(
  { fps: KANJI_FPS, intro: [0, 0], write: [0, 1], review: [1, 2], info: [2, 3], frames: 3 }, { write: [[0, 1]], review: [[1, 2]] })));

/**
 * The typed intro from the lines placed before the writing (all anchored on "start" or after it):
 * the intro lasts until they end plus `introTail`, on a whole frame; it is 0 when there are none.
 * The typed character is emphasized at the script's first emphasis. (When the reading converts is
 * Kumiki's `kanjiCardConvertAt`.)
 */
export function kanjiIntro(placed, { introTail = KANJI_SHORT_PACING.introTail } = {}) {
  if (!placed.placed.length) return { intro: 0, emphasizeAt: undefined };
  return {
    // Round up to a whole frame; the tolerance keeps a float like 98.99999999999999 + ε from costing a frame.
    intro: Math.ceil((placed.end + introTail) * KANJI_FPS - 1e-6) / KANJI_FPS,
    emphasizeAt: placed.emphasis[0]?.at,
  };
}

/**
 * The card's four phases for a narration that ends at `end` seconds: the info phase lasts until
 * `tail` after it, at least 0.5 s, on a frame count divisible by 3 (so the length is a whole number
 * of milliseconds and of 48 kHz samples per frame).
 */
export function kanjiShortTiming({ intro, write, review, end, tail = KANJI_SHORT_PACING.tail }) {
  for (const [name, value] of [["intro", intro], ["write", write], ["review", review]])
    if (!(value >= 0) || Math.abs(value * KANJI_FPS - Math.round(value * KANJI_FPS)) > 1e-6) fail(`the ${name} length must be a whole number of frames`);
  const before = Math.round((intro + write + review) * KANJI_FPS);
  const frames = Math.ceil(Math.max(end + tail, before / KANJI_FPS + .5) * KANJI_FPS / 3 - 1e-6) * 3;
  return { timing: { intro, write, review, info: (frames - before) / KANJI_FPS }, frames, totalSamples: frames * 1600 };
}

/**
 * A per-text setting of the config (`narration.retakes`, `narration.reuse`): the key must be the exact text one voice reads, compared after Unicode normalization and trimming; only the config's own keys count.
 * `settings` is the config's object, or the [text, value] pairs of `kanjiTextSettings`.
 */
export function textSetting(text, settings) {
  if (!settings) return undefined;
  const key = text.normalize("NFC").trim();
  for (const [wanted, value] of Array.isArray(settings) ? settings : Object.entries(settings)) if (wanted.normalize("NFC").trim() === key) return value;
  return undefined;
}

/** The pause between a phrase and the rest of its line (with each clip's own silence, about a comma's 0.26 s). */
export const PHRASE_GAP = 0.15;

/**
 * What one line is read as: its parts in order, `{ text, locale, from, to, phrase, gapBefore? }`.
 * - At each of the template's own commas (おんよみ、{onyomi}。) a line is read in parts, so a part
 *   that is the same in every short (a label, a fixed sentence: `phrase`) is one recording, made
 *   once and used in every short, and only the kanji's own text is new. `split: false` reads a line whole.
 * - With a voice per language, each part is read in runs by its language's voice (scriptRuns).
 * - `gapBefore` is the pause before a part that follows a comma; runs of one sentence keep theirs.
 * - A part is a phrase when none of the kanji's own fields falls in it (labels are settings, the same everywhere).
 */
export function kanjiSpokenParts(line, { voiceIds, split = true, phraseGap = PHRASE_GAP } = {}) {
  const ends = split ? (line.breaks ?? []).filter(at => at > 0 && at < line.say.length) : [];
  const bounds = [0, ...ends, line.say.length], parts = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const from = bounds[i], text = line.say.slice(from, bounds[i + 1]);
    if (!text.trim()) continue;
    const runs = voiceIds ? scriptRuns(text, line.locale) : [{ text, locale: line.locale, from: 0, to: text.length }];
    runs.forEach((run, k) => {
      const at = from + run.from, to = from + run.to;
      const own = (line.fields ?? []).some(field => !field.path.startsWith("labels.") && field.from < to && field.to > at);
      parts.push({ text: run.text, locale: run.locale, from: at, to, phrase: !own, ...(parts.length && k === 0 ? { gapBefore: phraseGap } : {}) });
    });
  }
  // A part that is only punctuation (a "、" between an English label and its reading) is never read alone:
  // it joins the part before it in its language, else the part after it.
  const spoken = /[\p{L}\p{N}]/u;
  for (let i = 0; i < parts.length; i++) {
    if (spoken.test(parts[i].text) || parts.length === 1) continue;
    const [lone] = parts.splice(i, 1);
    const before = parts[i - 1], after = parts[i];
    if (before && (before.locale === lone.locale || !after)) { before.text += lone.text; before.to = lone.to; }
    else if (after) { after.text = lone.text + after.text; after.from = lone.from; after.phrase = after.phrase && lone.phrase; if (lone.gapBefore !== undefined) after.gapBefore = lone.gapBefore; }
    i--;
  }
  return parts.length ? parts : [{ text: line.say, locale: line.locale, from: 0, to: line.say.length, phrase: !(line.fields ?? []).some(f => !f.path.startsWith("labels.")) }];
}

/** The fields a text setting's key may name, so one entry covers every kanji: { "{name.kana}": "kunyomi" }. */
export const KANJI_TEXT_FIELDS = Object.freeze(["char", "name.kana", "name.romaji", "meanings", "jlpt", "onyomi", "kunyomi", "labels.on", "labels.kun"]);
const FIELD = /\{([^}]*)\}/gu;

/** Why a text setting's key cannot be used, or null: it may name only KANJI_TEXT_FIELDS. */
export function textKeyProblem(key) {
  const unknown = [...key.matchAll(FIELD)].map(match => match[1]).filter(field => !KANJI_TEXT_FIELDS.includes(field));
  return unknown.length ? `"${key}" names ${unknown.map(field => `{${field}}`).join(", ")}; a key can name ${KANJI_TEXT_FIELDS.map(field => `{${field}}`).join(", ")}` : null;
}

/**
 * One short's text settings as [text, value] pairs (for textSetting): a key that names fields is
 * filled from the short's script data (kanjiScriptData). An exact text wins over a filled key that
 * comes out the same, and a key that comes out empty (a kanji with no kun'yomi) is left out.
 */
export function kanjiTextSettings(settings, data) {
  if (!settings) return undefined;
  const entries = Object.entries(settings), named = ([key]) => /\{[^}]*\}/u.test(key);
  const exact = entries.filter(entry => !named(entry)), texts = new Set(exact.map(([key]) => key.normalize("NFC").trim()));
  const filled = entries.filter(named).map(([key, value]) => [renderTemplate(key, data), value])
    .filter(([text]) => text.trim() && !texts.has(text.normalize("NFC").trim()));
  return [...exact, ...filled];
}

/** The text a voice reads for a part that `narration.speech` reads as another text ({ "いま。": "今。" }), or undefined. */
export const spokenAs = (text, speech) => {
  const value = textSetting(text, speech);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

/** The retake asked for a text one voice reads (`narration.retakes`, for example { "ひと": 5 }), or undefined. */
export const retakeFor = (text, retakes) => textSetting(text, retakes);

/**
 * The line whose last phrase a text one voice reads is taken from (`narration.reuse`, for example
 * { "ひと": "kunyomi" }: the question's name is read as in "くんよみ、ひと。"), or undefined.
 */
export const reuseFor = (text, reuse) => textSetting(text, reuse);

// Katakana reads as its hiragana (ネン。 says ねん), so a name in kana is found in a reading in katakana.
const unpunctuated = (text) => toHiragana(text.normalize("NFC")).replace(/[\s。．.!?！？、,，「」『』"'()（）]/gu, "");
/**
 * How a reused text comes out of a source line's text (what one voice reads): the whole of it, or
 * its part after the last comma, with how many commas (pauses) the source has. Null when the source
 * does not say exactly that text there, so a config shared by many kanji never makes one read
 * another kanji's word.
 */
export function reuseCut(sourceText, text) {
  const key = unpunctuated(text);
  if (!key) return null;
  if (unpunctuated(sourceText) === key) return { whole: true, pauses: 0 };
  const parts = sourceText.split(/[、,，]/u);
  if (parts.length < 2 || unpunctuated(parts[parts.length - 1]) !== key) return null;
  return { whole: false, pauses: parts.length - 1 };
}

/**
 * Where each reused text of a short is heard from (narration.reuse). Units are what one voice reads,
 * in order: { line, text, reusedFrom? }. A reuse applies only where its source line is in this short,
 * is another line, has no reused part itself (decided from the config, so the order does not matter)
 * and says the text after its last comma (reuseCut): then { source (the line's last unit), cut }.
 * Otherwise the text is read on its own, and { why } says so.
 */
export function reuseSources(units) {
  const asked = units.filter(unit => unit.reusedFrom), reusing = new Set(asked.map(unit => unit.line));
  return new Map(asked.map(unit => {
    // A list of lines is tried in order: the first that says the text gives it ({ "{name.kana}": ["kunyomi", "onyomi"] }).
    const whys = [];
    for (const from of [unit.reusedFrom].flat()) {
      const source = units.filter(u => u.line === from).at(-1);
      const why = !source ? `this short has no line ${from}` : from === unit.line ? "it is the text's own line" : reusing.has(from) ? `line ${from} is itself reused` : null;
      // Matched on what the lines say, also where a part is spoken as another text.
      const cut = why ? null : reuseCut(source.written ?? source.text, unit.written ?? unit.text);
      if (cut) return [unit, { source, cut, from }];
      whys.push(why ?? `line ${from} does not say "${unit.written ?? unit.text}" after a comma`);
    }
    return [unit, { why: whys.join("; ") }];
  }));
}
