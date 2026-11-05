/** What a spoken phrase mentions: objects, amounts, and the signal words that imply an action.
 * Plain data tables drive it, so a term, unit or locale is added without changing the director.
 */
const SMALL = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALE = { hundred: 100, thousand: 1e3, million: 1e6, billion: 1e9 };

/** Each unit is data: the words that name it and how a value is shown. */
export const STORY_UNITS = Object.freeze([
  { id: "usd", words: ["dollar", "dollars", "bucks"], symbol: "$", format: { kind: "currency", currency: "USD", precision: 0 } },
  { id: "eur", words: ["euro", "euros"], symbol: "€", format: { kind: "currency", currency: "EUR", precision: 0 } },
  { id: "gbp", words: ["pound", "pounds"], symbol: "£", format: { kind: "currency", currency: "GBP", precision: 0 } },
  { id: "jpy", words: ["yen", "円"], symbol: "¥", format: { kind: "currency", currency: "JPY", precision: 0 } },
  { id: "percent", words: ["percent", "%"], symbol: "%", format: { kind: "percent", precision: 0 }, fraction: true },
]);
const BY_SYMBOL = new Map(STORY_UNITS.map(unit => [unit.symbol, unit]));
const BY_WORD = new Map(STORY_UNITS.flatMap(unit => unit.words.map(word => [word, unit])));

/** Signal words by meaning, per language. English word lists and Japanese fragments. */
export const STORY_SIGNALS = Object.freeze({
  en: {
    negation: /\b(?:not|never|no|nothing|nobody|none|without|doesn['’]t|isn['’]t|aren['’]t|can['’]t|won['’]t|don['’]t|didn['’]t)\b/iu,
    problem: /\b(?:wrong|missing|mismatch(?:es)?|fails?|failed|hide|hides|hidden|lost|duplicate|short payment|error|mistake|problem|risk|gap|blocks?|blocked|crash(?:es)?)\b/iu,
    rising: /\b(?:ris(?:es|ing)|builds?|building|grows?|growing|increases?|increasing|climbs?|climbing|more of|piles? up|spikes?)\b/iu,
    falling: /\b(?:falls?|falling|drops?|dropping|shrinks?|fades?|fading|wears? off|declines?|less of|clears?|decreases?|runs? out)\b/iu,
    moving: /\b(?:moves?|sends?|flows?|passes?|arrives?|reaches|travels?|goes to|delivers?|carr(?:y|ies)|borrow(?:s|ed)?|pays?|comes? due)\b/iu,
    resolved: /\b(?:correct|right|fix(?:ed)?|solved|resolves?|matches|match|balanced?|balances|verified|works?|done|clean)\b/iu,
    /** A problem word directly denied: "never missing" is good news. */
    deniedProblem: /\b(?:not|never|no|isn['’]t|wasn['’]t|without)\s+(?:\w+\s+)?(?:wrong|missing|lost|hidden|broken|failed|a problem|an error)\b/iu,
    contrast: /\b(?:but|however|instead|versus|vs\.?|while|whereas|not a|rather than)\b/iu,
    cause: /\b(?:because|so|therefore|which means|leads? to|causes?|as a result|that is why|why)\b/iu,
    sequence: /\b(?:then|next|later|after|before|when|first|finally|from|into|through|to the)\b/iu,
    both: /\b(?:both|together|each other|the two|side by side|next to)\b/iu,
  },
  ja: {
    negation: /ない|ません|なし/u, problem: /間違|不足|問題|失敗|隠|消え|ずれ/u, resolved: /解決|正し|一致|完了/u,
    rising: /増え|上が|高ま|たま/u, falling: /減|下が|消え/u, moving: /移|送|届|流れ/u,
    deniedProblem: /問題ない|失っていない/u, contrast: /しかし|でも|一方|ではなく/u, cause: /なぜ|だから|ので|ため|その結果/u, sequence: /まず|次に|そして|あとで|から/u, both: /両方|どちらも|並べ/u,
  },
});

const STOP = new Set("a an and are as at be been but by can could did do does each for from get gets go goes got had has have here how i if in into is it its just keep keeps let like make makes may more most much my no nor not nothing now of off on one only or our out over put puts same says see set she should so some such take takes than that the their them then there these they thing things this those through to too two under up very was we were what when where which while who why will with would you your about after again all also because before both down even every few first found gets given goes going know last later made many might must need needs never new next once other own right said say still sure tell tells time until use used uses way well whether".split(" "));
const flatten = (value) => String(value ?? "").replace(/\s+/gu, " ").trim();
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const language = (locale) => (String(locale ?? "en").toLowerCase().startsWith("ja") ? "ja" : "en");

/** Index a vocabulary once. Longer terms win over shorter ones inside them. */
export function compileVocabulary(vocabulary, locale = "en") {
  const key = language(locale) === "ja" ? "termsJa" : "terms";
  const terms = vocabulary.objects.flatMap(entry => (entry[key] ?? []).map(term => ({ term, entry }))).sort((a, b) => b.term.length - a.term.length);
  return { terms, locale: language(locale), patterns: terms.map(({ term, entry }) => ({ entry, term,
    pattern: language(locale) === "ja" ? new RegExp(escape(term), "u") : new RegExp(`(?:^|[^\\p{L}\\p{N}])${escape(term)}(?=$|[^\\p{L}\\p{N}])`, "iu") })) };
}

/** Vocabulary objects a phrase names, in spoken order, each once. */
export function mentionedObjects(phrase, compiled) {
  const text = flatten(phrase), taken = [], found = [];
  for (const { entry, term, pattern } of compiled.patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const start = text.toLocaleLowerCase().indexOf(term.toLocaleLowerCase(), match.index), end = start + term.length;
    if (taken.some(([from, to]) => start < to && from < end) || found.some(item => item.entry === entry)) continue;
    taken.push([start, end]);
    found.push({ entry, term, start });
  }
  return found.sort((a, b) => a.start - b.start).map(item => ({ ...item.entry, term: item.term }));
}

function spelledValue(words) {
  let total = 0, current = 0;
  for (const word of words) {
    if (word === "and") continue;
    if (word in SMALL) current += SMALL[word];
    else if (word in TENS) current += TENS[word];
    else if (SCALE[word] === 100) current = (current || 1) * 100;
    else if (word in SCALE) { total += (current || 1) * SCALE[word]; current = 0; }
    else return null;
  }
  return total + current;
}

/** Amounts in a phrase, digit or spelled. A bare number takes `defaultUnit` only when it is clearly a quantity. */
export function spokenAmounts(phrase, { defaultUnit } = {}) {
  const text = flatten(phrase).toLocaleLowerCase();
  const found = [];
  for (const match of text.matchAll(/([$€£¥])\s?(\d[\d,]*(?:\.\d+)?)(?:\s?(k|m|thousand|million|billion))?|(\d[\d,]*(?:\.\d+)?)\s?(%|percent|dollars?|euros?|pounds?|yen|円)/gu)) {
    const digits = (match[2] ?? match[4]).replaceAll(",", "");
    const scale = { k: 1e3, m: 1e6, thousand: 1e3, million: 1e6, billion: 1e9 }[match[3]] ?? 1;
    const unit = match[1] ? BY_SYMBOL.get(match[1]) : BY_WORD.get(match[5]);
    found.push({ start: match.index, end: match.index + match[0].length, value: Number(digits) * scale, unit });
  }
  const numberWord = [...Object.keys(SMALL), ...Object.keys(TENS), ...Object.keys(SCALE)].join("|");
  for (const match of text.matchAll(new RegExp(`\\b((?:${numberWord})(?:(?:[ -]|\\s+and\\s+)(?:${numberWord}))*)\\b(?:\\s+(dollars?|bucks|euros?|pounds?|yen|percent))?`, "gu"))) {
    const words = match[1].split(/[ -]+/u).filter(Boolean);
    const unit = match[2] ? BY_WORD.get(match[2]) : undefined;
    // "one tool" is a count. A spelled number alone is an amount only when it is big enough to be one.
    const big = words.some(word => word in SCALE || word in TENS);
    if (!unit && !(big && defaultUnit)) continue;
    const value = spelledValue(words);
    if (value === null || found.some(item => match.index < item.end && item.start < match.index + match[0].length)) continue;
    found.push({ start: match.index, end: match.index + match[0].length, value, unit: unit ?? defaultUnit });
  }
  return found.sort((a, b) => a.start - b.start).map(item => ({ ...item, text: formatAmount(item.value, item.unit) }));
}

/** The object a negation points at: "a habit, not a tool" denies the tool, not the habit. */
export function deniedTerm(phrase, compiled) {
  const after = /\b(?:not|never|no|without|rather than)\s+(?:a |an |the |your |just )?(.+)$/iu.exec(flatten(phrase));
  return after ? mentionedObjects(after[1], compiled)[0] ?? null : null;
}

export function formatAmount(value, unit) {
  if (unit?.fraction) return `${value}%`;
  const number = new Intl.NumberFormat("en").format(value);
  return unit ? `${unit.symbol}${number}` : number;
}

export function phraseSignals(phrase, locale = "en") {
  const table = STORY_SIGNALS[language(locale)];
  const text = flatten(phrase);
  return { question: /[?？]\s*$/u.test(text), ...Object.fromEntries(Object.entries(table).map(([name, pattern]) => [name, pattern.test(text)])) };
}

/** Generic nouns that name no idea a viewer could picture. */
const VAGUE = new Set("amount bit case day end fact half kind lot matter moment part place point reason rest side sort start stuff way".split(" "));

/** Noun phrases a phrase talks about, in spoken order: "a chemical called adenosine", "the signal".
 * A cheap reader, not a parser: a noun usually follows a determiner, and "called" names a thing.
 */
export function phraseConcepts(phrase) {
  const text = flatten(phrase);
  const found = [];
  const add = (index, words) => {
    const clean = words.filter(word => !STOP.has(word.toLocaleLowerCase()));
    const head = clean[clean.length - 1];
    if (!head || head.length < 3 || VAGUE.has(head.toLocaleLowerCase()) || /(?:ly|ed|ier)$/iu.test(head)) return;
    found.push({ index, label: clean.slice(-2).join(" ").replace(/^\p{Ll}/u, letter => letter.toLocaleUpperCase()) });
  };
  for (const match of text.matchAll(/\bcalled\s+([\p{L}-]+)/giu)) add(match.index, [match[1]]);
  for (const match of text.matchAll(/\b(?:a|an|the|your|our|their|this|that|these|those|its|my)\s+((?:[\p{L}'’-]+\s+)?[\p{L}'’-]+)/giu)) {
    const words = match[1].split(/\s+/u);
    // "the signal keeps going" reads two words past the noun, so a verb-like second word is dropped.
    const second = words[1]?.toLocaleLowerCase() ?? "";
    add(match.index, STOP.has(second) || /(?:s|ing|ed)$/u.test(second) && !/ss$/u.test(second) ? words.slice(0, 1) : words);
  }
  return found.sort((a, b) => a.index - b.index).map(item => item.label);
}

/** The word or two a phrase is about, for an idea with no picture. */
export function phraseKeyword(phrase, locale = "en") {
  const text = flatten(phrase);
  if (language(locale) === "ja") return [...text.matchAll(/[\p{Script=Han}\p{Script=Katakana}ー]{2,}/gu)].map(match => match[0]).sort((a, b) => b.length - a.length)[0] ?? null;
  const words = [...text.matchAll(/[\p{L}][\p{L}'’-]*/gu)].map(match => match[0]);
  const content = words.filter(word => word.length > 2 && !STOP.has(word.toLocaleLowerCase()) && !/ed$/iu.test(word));
  if (!content.length) return null;
  const pick = content.reduce((best, word) => (word.length > best.length ? word : best), content[0]);
  return pick.charAt(0).toLocaleUpperCase() + pick.slice(1);
}

/** Short on-screen words for a phrase: digits for amounts, no filler at the start, nine words at most. */
export function captionFor(phrase, amounts = [], maxWords = 9) {
  let text = flatten(phrase).replace(/[.。]+$/u, "");
  for (const amount of [...amounts].sort((a, b) => b.start - a.start)) {
    const lower = text.toLocaleLowerCase();
    const end = Math.min(amount.end, lower.length);
    if (amount.start < end) text = `${text.slice(0, amount.start)}${amount.text}${text.slice(end)}`;
  }
  text = text.replace(/^(?:so|and|but|then|now|well|here is how|here's how)[,\s]+/iu, "").trim();
  text = text.charAt(0).toLocaleUpperCase() + text.slice(1);
  const words = text.split(" ");
  if (words.length <= maxWords) return text;
  const clause = text.split(/[,;:、]/u)[0].trim();
  if (clause.split(" ").length >= 3 && clause.split(" ").length <= maxWords) return clause;
  let kept = words.slice(0, maxWords);
  while (kept.length > 3 && STOP.has(kept[kept.length - 1].toLocaleLowerCase().replace(/[^\p{L}]/gu, ""))) kept = kept.slice(0, -1);
  return kept.join(" ").replace(/[,;:]$/u, "");
}
