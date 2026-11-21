/** Kanji study shorts: what the card shows and what the narration's templates can say, from a
 * kanji data file, and the card's anchors and phases for the anchored narration. Pure.
 * The picture is Kumiki's `shodo-kanji-card`; the voice-over is an anchored-narration script
 * (default: kanji-short-script.json), so its wording, order and timing are data, not code.
 */

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
 *   otherwise its first on'yomi (学 → gaku), otherwise its first kun'yomi.
 * - A word is spoken as written, so the voice reads it in context; an irregular reading (今日)
 *   is spoken from its kana. `speech` overrides the text for a word, for a voice that misreads it.
 */
export function kanjiShortContent(entry, { maxWords = 3, speech = {} } = {}) {
  if (!entry?.char) fail("a kanji entry is required");
  const words = entry.words.filter(word => word.word !== entry.char).slice(0, maxWords);
  if (!words.length) fail(`${entry.char} has no useful word other than itself`);
  const own = entry.words.find(word => word.word === entry.char);
  const onPairs = readingPairs(entry.card.onyomi), kunPairs = readingPairs(entry.card.kunyomi);
  const on = onPairs.map(p => p.kana), kun = kunPairs.map(p => p.kana);
  const name = own ? { romaji: own.romaji, kana: own.ruby } : onPairs[0] ?? kunPairs[0] ?? null;
  if (!name || !plainRomaji(name.romaji)) fail(`${entry.char} has no reading to name it by`);
  return {
    char: entry.char, jlpt: entry.jlpt, meanings: entry.card.meanings, onyomi: entry.card.onyomi, kunyomi: entry.card.kunyomi,
    words: words.map(({ word, ruby, romaji, meaning }) => ({ word, ruby, romaji, meaning })),
    wordSpeech: words.map(word => typeof speech[word.word] === "string" && speech[word.word].trim() ? speech[word.word].trim()
      : word.reading === "irregular" ? word.ruby : word.word),
    name: { romaji: plainRomaji(name.romaji).toLowerCase(), kana: toHiragana(name.kana) },
    readings: { on, kun, onRomaji: onPairs.map(p => p.romaji), kunRomaji: kunPairs.map(p => p.romaji) },
  };
}

/** Default pacing, seconds. `write` and `review` are the two writing passes; `introTail` the hold after the intro's last line; `tail` after the last line. */
export const KANJI_SHORT_PACING = Object.freeze({ write: 6.5, review: 6.5, introTail: .45, tail: 1.4 });

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
