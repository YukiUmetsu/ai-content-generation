/** Kanji study shorts: the data, narration and timing decisions, as pure functions.
 * The picture is Kumiki's `shodo-kanji-card`; this module decides what the card shows, what the
 * voice says and when, from a kanji data file and measured speech. No network, no files.
 */

export const KANJI_FPS = 30;
export const SAMPLE_RATE = 48000;
const SAMPLES_PER_FRAME = SAMPLE_RATE / KANJI_FPS;
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
    entries.set(char, { char, jlpt: jlpt ?? null, card: { meanings: card.meanings, onyomi: card.onyomi, kunyomi: card.kunyomi }, words });
  });
  return { entries, problems };
}

/** Kana inside parentheses of a card reading text: "NICHI (ニチ), JITSU (ジツ)" → ["ニチ", "ジツ"]. Okurigana marks are dropped. */
export function readingKana(cardText) {
  if (typeof cardText !== "string") return [];
  return [...cardText.matchAll(/\(([^)]+)\)/gu)].map(m => m[1].replace(/[-.]/gu, "").trim()).filter(Boolean);
}

/** Romaji of a card reading text: "NICHI (ニチ), JITSU (ジツ)" → ["nichi", "jitsu"]. */
export function readingRomaji(cardText) {
  if (typeof cardText !== "string") return [];
  return cardText.split(",").map(part => part.replace(/\([^)]*\)/gu, "").replace(/[-.]/gu, "").trim().toLowerCase()).filter(Boolean);
}

const toHiragana = (kana) => kana.replace(/[ァ-ヶ]/gu, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
/** Plain ASCII romaji for an English sentence: macrons become plain vowels (dō → do). */
export const plainRomaji = (romaji) => romaji.normalize("NFD").replace(/[̀-ͯ]/gu, "").replace(/[^a-z' -]/giu, "").trim();

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
  const on = readingKana(entry.card.onyomi), kun = readingKana(entry.card.kunyomi);
  const onRomaji = readingRomaji(entry.card.onyomi), kunRomaji = readingRomaji(entry.card.kunyomi);
  const name = own ? { romaji: own.romaji, kana: own.ruby }
    : on.length ? { romaji: onRomaji[0], kana: on[0] }
    : kun.length ? { romaji: kunRomaji[0], kana: kun[0] } : null;
  if (!name || !plainRomaji(name.romaji)) fail(`${entry.char} has no reading to name it by`);
  return {
    char: entry.char, jlpt: entry.jlpt, meanings: entry.card.meanings, onyomi: entry.card.onyomi, kunyomi: entry.card.kunyomi,
    words: words.map(({ word, ruby, romaji, meaning }) => ({ word, ruby, romaji, meaning })),
    wordSpeech: words.map(word => typeof speech[word.word] === "string" && speech[word.word].trim() ? speech[word.word].trim()
      : word.reading === "irregular" ? word.ruby : word.word),
    name: { romaji: plainRomaji(name.romaji).toLowerCase(), kana: toHiragana(name.kana) },
    readings: { on, kun },
  };
}

/**
 * The narration lines, in the order they are spoken: the question, then on'yomi and kun'yomi,
 * then each useful word. The question template must contain `{name}` once.
 * - `text` is what the voice reads. The name goes into the question in kana: a voice reads
 *   romaji such as "hi" (日) or "me" (目) as English words.
 * - `caption` is what the captions file shows: the name in romaji, for English-speaking learners.
 */
export function kanjiShortLines(content, { question = "Do you know how to write the kanji {name}?", labels = { on: "おんよみ", kun: "くんよみ" } } = {}) {
  if (typeof question !== "string" || question.split("{name}").length !== 2 || question.length > 160) fail("the question needs `{name}` exactly once");
  const spoken = question.replace("{name}", content.name.kana);
  const lines = [{ id: "question", role: "question", text: spoken, caption: question.replace("{name}", content.name.romaji),
    nameAt: question.indexOf("{name}") / spoken.length }];
  const say = (id, role, text, extra = {}) => lines.push({ id, role, text, caption: text, ...extra });
  if (content.readings.on.length) say("onyomi", "reading", `${labels.on}、${content.readings.on.join("、")}。`);
  if (content.readings.kun.length) say("kunyomi", "reading", `${labels.kun}、${content.readings.kun.map(toHiragana).join("、")}。`);
  content.wordSpeech.forEach((speech, i) => say(`word-${i + 1}`, "word", `${speech}。`, { word: i }));
  return lines;
}

/**
 * Where the speech in a mono 16-bit take starts and ends: a 10 ms RMS envelope above -42 dB of the
 * take's own peak. Returns sample indices, or null for a take with no speech.
 * @param {Int16Array} samples
 */
export function speechBounds(samples, { sampleRate = SAMPLE_RATE, floorDb = -42 } = {}) {
  const win = Math.max(1, Math.round(sampleRate * .01));
  const env = new Float64Array(samples.length);
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
    if (i >= win) sum -= samples[i - win] * samples[i - win];
    env[i] = Math.sqrt(Math.max(0, sum) / Math.min(i + 1, win));
  }
  let peak = 0;
  for (const v of env) if (v > peak) peak = v;
  if (peak < 1) return null;
  const floor = peak * 10 ** (floorDb / 20);
  let a = -1, b = -1;
  for (let i = 0; i < env.length; i++) if (env[i] > floor) { if (a < 0) a = i; b = i; }
  // The envelope trails its window: the speech starts one window earlier than its first loud value.
  return { start: Math.max(0, a - win), end: b };
}

/**
 * The trimmed clip of a take: 30 ms before the speech and 80 ms after it, faded over 12 ms, padded
 * to a whole number of milliseconds so the sample timeline stays exact.
 * @param {Int16Array} samples
 */
export function trimSpeech(samples, { sampleRate = SAMPLE_RATE } = {}) {
  const bounds = speechBounds(samples, { sampleRate });
  if (!bounds) fail("a narration take has no speech");
  const pre = Math.round(.03 * sampleRate), post = Math.round(.08 * sampleRate), fade = Math.round(.012 * sampleRate);
  const a = Math.max(0, bounds.start - pre), b = Math.min(samples.length, bounds.end + post);
  const ms = sampleRate / 1000;
  const length = Math.ceil((b - a) / ms) * ms;
  const clip = new Int16Array(length);
  for (let i = 0; i < b - a; i++) {
    const gain = Math.min(1, i / fade, (b - a - 1 - i) / fade);
    clip[i] = Math.round(samples[a + i] * Math.max(0, gain));
  }
  return { clip, lead: (bounds.start - a) / sampleRate, speech: (bounds.end - bounds.start) / sampleRate };
}

/** Seconds on the 30 fps frame grid, so the card's phases and the planned times agree exactly. */
export const toFrameGrid = (seconds) => Math.round(seconds * KANJI_FPS) / KANJI_FPS;

/** Default pacing of a kanji short, in seconds. */
export const KANJI_SHORT_PACING = Object.freeze({
  questionStart: .35, introTail: .45, write: 6.5, review: 6.5, readingGap: .45, wordLead: .3, wordGap: 1, tail: 1.4,
});

/** Seconds per typed kana in Kumiki's typed intro, and the pause before the conversion. */
const TYPE_STEP = .16, TYPE_SETTLE = .12, TYPE_START = .15;

/**
 * The intro's timing from the measured question. The reading is typed from the first moment
 * and converts to the character at once, so the subject is on screen while the question is
 * asked. The typed character is emphasized when its name is spoken: the name's share of the
 * sentence text gives its place in the speech.
 */
export function planKanjiIntro(question, pacing = KANJI_SHORT_PACING, readingLength = 0) {
  if (!(question?.speech > 0) || !(question.nameAt >= 0 && question.nameAt < 1)) fail("the measured question is required");
  const start = pacing.questionStart;
  // The intro ends on a whole frame, so the writing starts exactly where the card starts it.
  const intro = Math.ceil((start + question.speech + pacing.introTail) * KANJI_FPS) / KANJI_FPS;
  return { intro, questionAt: start, convertAt: round3(TYPE_START + TYPE_SETTLE + readingLength * TYPE_STEP), emphasizeAt: round3(start + question.speech * question.nameAt) };
}

/**
 * When each line is spoken and when each word is highlighted, from the card's stroke times
 * (seconds of the video, from Kumiki's `kanjiCardWriting`) and the measured lines.
 * - The question opens the intro.
 * - The readings start as the brush lands for the first stroke and follow one another.
 * - The words start as the review writing ends; each stays highlighted until the next one is spoken.
 * - The video ends `tail` seconds after the last word, on a whole number of frames divisible by 3,
 *   so its length is a whole number of milliseconds and of 48 kHz samples per frame.
 * @param {{lines:{id:string,role:string,speech:number,word?:number}[],strokes:{write:[number,number][],review:[number,number][]},intro:{intro:number,questionAt:number},pacing?:object}} input
 */
export function planKanjiShort({ lines, strokes, intro, pacing = KANJI_SHORT_PACING }) {
  if (!strokes?.write?.length || !strokes?.review?.length) fail("both writing passes need strokes");
  for (const [name, value] of [["intro", intro.intro], ["write", pacing.write], ["review", pacing.review]])
    if (!(value > 0) || Math.abs(value * KANJI_FPS - Math.round(value * KANJI_FPS)) > 1e-6) fail(`the ${name} length must be a whole number of frames (toFrameGrid)`);
  const writeStart = intro.intro, reviewStart = writeStart + pacing.write, infoStart = reviewStart + pacing.review;
  const onsets = new Map();
  onsets.set("question", intro.questionAt);
  let t = strokes.write[0][0];
  for (const line of lines.filter(line => line.role === "reading")) {
    onsets.set(line.id, t);
    t += line.speech + pacing.readingGap;
  }
  if (t - pacing.readingGap > reviewStart) fail(`the readings end at ${(t - pacing.readingGap).toFixed(2)} s, after the first writing (${reviewStart.toFixed(2)} s); lengthen the writing`);
  t = Math.max(t, strokes.review.at(-1)[1] + pacing.wordLead);
  const cues = [];
  for (const line of lines.filter(line => line.role === "word")) {
    onsets.set(line.id, t);
    cues.push({ word: line.word, at: round3(t - .08), hold: round3(line.speech + .08 + pacing.wordGap) });
    t += line.speech + pacing.wordGap;
  }
  const end = t - pacing.wordGap + pacing.tail;
  const frames = Math.ceil(Math.max(end, infoStart + .5) * KANJI_FPS / 3) * 3;
  const before = Math.round(infoStart * KANJI_FPS);
  return {
    timing: { intro: intro.intro, write: pacing.write, review: pacing.review, info: (frames - before) / KANJI_FPS },
    frames, totalSamples: frames * SAMPLES_PER_FRAME,
    onsets: Object.fromEntries([...onsets].map(([id, at]) => [id, round3(at)])), wordHighlights: cues,
  };
}
const round3 = (v) => Math.round(v * 1000) / 1000;

/**
 * Narration beats for ContentGen's sample timeline: each line's trimmed clip, placed so its speech
 * starts at its planned onset. Pauses are whole milliseconds; the first beat carries the silence
 * before the question, and the last pause ends the audio exactly on the last video frame.
 * @param {{id:string,clip:Int16Array,lead:number}[]} takes in spoken order
 * @param {Record<string, number>} onsets seconds
 */
export function placeNarration(takes, onsets, totalSamples) {
  const ms = SAMPLE_RATE / 1000;
  const beats = [];
  let cursor = 0;
  takes.forEach((take, i) => {
    const at = onsets[take.id];
    if (!Number.isFinite(at)) fail(`line ${take.id} has no onset`);
    // Start of the clip, on a whole millisecond.
    const start = Math.round((at - take.lead) * 1000) * ms;
    if (start < cursor) fail(`line ${take.id} would start before the previous line ends`);
    let samples = take.clip;
    if (i === 0) {
      samples = new Int16Array(start + take.clip.length);
      samples.set(take.clip, start);
    } else beats.at(-1).pauseAfterMs = (start - cursor) / ms;
    beats.push({ id: take.id, samples, pauseAfterMs: 0 });
    cursor = i === 0 ? samples.length : start + samples.length;
  });
  if (cursor > totalSamples) fail("the narration runs past the end of the video");
  if ((totalSamples - cursor) % ms) fail("the video length is not a whole number of milliseconds");
  beats.at(-1).pauseAfterMs = (totalSamples - cursor) / ms;
  return beats;
}

/**
 * The start of the music window with the fewest near-silent stretches where no voice speaks
 * (a near-silent stretch under the voice matters less). Samples: mono 48 kHz Int16.
 * @param {Int16Array} music
 * @param {{onset:number,end:number}[]} speech seconds
 */
export function chooseMusicWindow(music, length, speech, { from = 1, step = .1 } = {}) {
  const hop = Math.round(.05 * SAMPLE_RATE), win = Math.round(.4 * SAMPLE_RATE);
  const count = Math.floor(music.length / hop);
  const db = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    const centre = k * hop, a = Math.max(0, centre - win / 2), b = Math.min(music.length, centre + win / 2);
    let sum = 0;
    for (let i = a; i < b; i++) sum += music[i] * music[i];
    db[k] = 10 * Math.log10(sum / Math.max(1, b - a) + 1e-9);
  }
  const sorted = [...db.slice(Math.round(from / .05))].sort((x, y) => x - y);
  if (!sorted.length) fail("the music is too short");
  const quiet = sorted[Math.floor(sorted.length / 2)] - 18;
  const n = Math.round(length / .05);
  const voiced = Array.from({ length: n }, (_, k) => speech.some(s => k * .05 >= s.onset - .1 && k * .05 <= s.end + .3));
  let best = null;
  for (let start = from; start * SAMPLE_RATE + length * SAMPLE_RATE <= music.length; start = round3(start + step)) {
    const k0 = Math.round(start / .05);
    let run = 0, longest = 0, weighted = 0;
    for (let k = 0; k < n; k++) {
      const q = db[k0 + k] < quiet;
      run = q && !voiced[k] ? run + 1 : 0;
      longest = Math.max(longest, run);
      weighted += q ? (voiced[k] ? .25 : 1) : 0;
    }
    const score = [longest * .05, weighted / n];
    if (!best || score[0] < best.score[0] - 1e-9 || Math.abs(score[0] - best.score[0]) < 1e-9 && score[1] < best.score[1]) best = { start, score };
  }
  if (!best) fail(`the music is shorter than the video (${length.toFixed(1)} s from ${from} s)`);
  return { start: best.start, longestQuietSeconds: round3(best.score[0]) };
}
