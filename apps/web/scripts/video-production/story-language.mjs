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
  ...["minute", "hour", "day", "week", "month", "year"].map(name => ({ id: name, words: [name, `${name}s`], suffix: ` ${name}s`, format: { kind: "number", unit: `${name}s`, precision: 0 } })),
]);
const BY_SYMBOL = new Map(STORY_UNITS.filter(unit => unit.symbol).map(unit => [unit.symbol, unit]));
const TIME_WORDS = "minutes?|hours?|days?|weeks?|months?|years?";
const BY_WORD = new Map(STORY_UNITS.flatMap(unit => unit.words.map(word => [word, unit])));

/** Signal words by meaning, per language. English word lists and Japanese fragments. */
export const STORY_SIGNALS = Object.freeze({
  en: {
    negation: /\b(?:not|never|no|nothing|nobody|none|without|doesn['’]t|isn['’]t|aren['’]t|can['’]t|won['’]t|don['’]t|didn['’]t)\b/iu,
    problem: /\b(?:wrong|missing|mismatch(?:es)?|fails?|failed|hide|hides|hidden|lost|duplicate|short payment|error|mistake|problem|risk|gap|blocks?|blocked|crash(?:es)?)\b/iu,
    rising: /\b(?:ris(?:es|ing)|builds?|building|grows?|growing|increases?|increasing|climbs?|climbing|more of|piles? up|spikes?)\b/iu,
    /** Something collecting, which fills a meter. Plain rising climbs a graph. */
    accumulating: /\b(?:builds?|building|piles? up|fills?|filling|more of|collects?|accumulat\w+)\b/iu,
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
    rising: /増え|上が|高ま|たま/u, accumulating: /たま|蓄/u, falling: /減|下が|消え/u, moving: /移|送|届|流れ/u,
    deniedProblem: /問題ない|失っていない/u, contrast: /しかし|でも|一方|ではなく/u, cause: /なぜ|だから|ので|ため|その結果/u, sequence: /まず|次に|そして|あとで|から/u, both: /両方|どちらも|並べ/u,
  },
});

/** Verbs a viewer expects to see, per language. These are the fallback when no model is available,
 * and they read words, not meaning. The first match wins, so list specific motions first.
 */
export const STORY_MOTIONS = Object.freeze({
  en: [["explode", /\b(?:explod\w+|blows? up|blew up|bursts? apart)\b/iu], ["pop", /\b(?:pops?|popped|popping|bursts?)\b/iu],
    ["print", /\b(?:prints?|printing|printed)\b/iu], ["stamp", /\b(?:stamps?|stamped|stamping)\b/iu],
    ["split", /\b(?:splits?|splitting|divides?|divided|cuts? in half)\b/iu], ["vanish", /\b(?:vanish\w*|disappears?|disappeared)\b/iu],
    ["melt", /\b(?:melts?|melted|melting|dissolves?|dissolving)\b/iu], ["burn", /\b(?:burns?|burned|burnt|burning)\b/iu],
    ["inflate", /\b(?:inflates?|inflating|swells?|swelling|balloons?)\b/iu], ["deflate", /\b(?:deflat\w+)\b/iu],
    ["pulse", /\b(?:heartbeats?|pulses?|pulsing|throbs?)\b/iu], ["wobble", /\b(?:wobbl\w+|teeters?|teetering)\b/iu],
    ["slide", /\b(?:slides?|sliding|slips?|slipping)\b/iu], ["rain", /\b(?:rains? down|raining|pours? in|pouring in|floods? in)\b/iu],
    ["stack", /\b(?:stacks?|stacking|piles? up|piling up)\b/iu], ["flip", /\b(?:flips?|flipped|flipping)\b/iu],
    ["walk", /\b(?:walks?|walking|strolls?|strolling|marches|marching|jogs?|jogging)\b/iu],
    ["hop", /\b(?:jumps?|jumping|hops?|hopping|bounces?|bouncing|leaps?|leaping)\b/iu],
    ["spin", /\b(?:spins?|spinning|rotates?|rotating|cycles?|cycling|loops?|looping|turns? around)\b/iu],
    ["shake", /\b(?:shakes?|shaking|trembles?|trembling|panics?)\b/iu],
    ["lift", /\b(?:lifts?|lifting|flies|flying|launch(?:es)?|takes? off|floats?|floating|soars?|soaring)\b/iu],
    ["drop", /\b(?:lands?|landing)\b/iu], ["grow", /\b(?:expands?|expanding|gets? bigger|getting bigger)\b/iu],
    ["shrink", /\b(?:shrinks?|shrinking|gets? smaller|getting smaller)\b/iu]],
  ja: [["explode", /爆発/u], ["pop", /弾け/u], ["print", /印刷/u], ["stamp", /押印|判を押/u], ["split", /分かれ|分割/u], ["vanish", /消え/u], ["melt", /溶け/u], ["burn", /燃え/u],
    ["inflate", /膨ら/u], ["deflate", /しぼ/u], ["pulse", /鼓動/u], ["wobble", /ぐらつ/u], ["slide", /滑/u], ["rain", /降り注/u], ["stack", /積み重/u], ["flip", /裏返/u],
    ["walk", /歩|走/u], ["hop", /跳/u], ["spin", /回転|回る/u], ["shake", /揺れ|震え/u], ["lift", /飛|浮/u], ["drop", /落ち/u], ["shrink", /縮/u]],
});

/** Graph shapes by the same rules. Plain rising and falling are read from their own signals. */
export const STORY_TREND_WORDS = Object.freeze({
  en: [["crash", /\b(?:crash(?:es|ed)?|crashing|collapses?|collapsed|collapsing|plummets?|plummeted|plunges?|plunged|nosedives?)\b/iu],
    ["recover", /\b(?:recovers?|recovered|recovering|rebounds?|rebounded|bounces? back|comes? back)\b/iu],
    ["spike", /\b(?:spikes?|spiked|spiking|shoots? up)\b/iu], ["plateau", /\b(?:plateaus?|plateaued|levels? off|levelled off|leveled off|flattens? out)\b/iu]],
  ja: [["crash", /暴落|崩壊/u], ["recover", /回復/u], ["spike", /急騰/u], ["plateau", /頭打ち/u]],
});

/** Which way a link runs, per language. The word beside an object says whether it gives or receives. */
const DETERMINER = "(?:(?:the|a|an|your|our|their|its|my|this|that|these|those)\\s+)?";
export const STORY_FLOW_WORDS = Object.freeze({
  en: { sourceBefore: new RegExp(`\\b(?:from|out of|off)\\s+${DETERMINER}$`, "iu"), destinationBefore: new RegExp(`\\b(?:to|into|onto|toward|towards)\\s+${DETERMINER}$`, "iu") },
  ja: { sourceAfter: /^(?:から|より)/u, destinationAfter: /^(?:に|へ)/u },
});

/** The objects a phrase names as the start and the end of a link: "attach the receipt to the invoice" ends at the invoice. */
export function spokenFlow(phrase, objects, locale = "en") {
  const text = flatten(phrase), words = STORY_FLOW_WORDS[language(locale)];
  const named = (before, after) => objects.find(({ start, term }) => before?.test(text.slice(0, start)) || after?.test(text.slice(start + term.length))) ?? null;
  return { source: named(words.sourceBefore, words.sourceAfter), destination: named(words.destinationBefore, words.destinationAfter) };
}

const HOUR_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const HOUR = `(?:${Object.keys(HOUR_WORDS).join("|")}|\\d{1,2})`;
const hourOf = (word) => HOUR_WORDS[word.toLocaleLowerCase()] ?? Number(word);
const padded = (minute) => String(minute).padStart(2, "0");

/** A time of day the words state. `explicit` means the time is plainly the point, as in "one o'clock".
 * "At nine" is only explicit enough to set where a later clock starts from.
 * @returns {{hour:number,minute:number,explicit:boolean,spoken:string,label:string}|null}
 */
export function spokenTime(phrase, locale = "en") {
  const text = flatten(phrase);
  if (language(locale) === "ja") {
    const match = /(午前|午後)?(\d{1,2})時(?:(\d{1,2})分)?/u.exec(text);
    if (!match) return null;
    const hour = Number(match[2]) + (match[1] === "午後" && Number(match[2]) < 12 ? 12 : 0), minute = Number(match[3] ?? 0);
    return hour > 23 || minute > 59 ? null : { hour, minute, explicit: true, spoken: match[0], label: match[0] };
  }
  const named = /\b(noon|midday|midnight)\b/iu.exec(text);
  if (named) return { hour: /midnight/iu.test(named[1]) ? 0 : 12, minute: 0, explicit: true, spoken: named[0], label: named[1].charAt(0).toLocaleUpperCase() + named[1].slice(1) };
  const meridiem = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\b/iu.exec(text);
  if (meridiem) {
    const shown = Number(meridiem[1]), minute = Number(meridiem[2] ?? 0), after = meridiem[3].toLocaleLowerCase() === "p";
    if (shown < 1 || shown > 12 || minute > 59) return null;
    return { hour: (shown % 12) + (after ? 12 : 0), minute, explicit: true, spoken: meridiem[0], label: `${shown}${minute ? `:${padded(minute)}` : ""} ${after ? "PM" : "AM"}` };
  }
  const clock = new RegExp(`\\b(${HOUR})\\s+o['’]clock\\b`, "iu").exec(text);
  if (clock && hourOf(clock[1]) >= 1 && hourOf(clock[1]) <= 12) return { hour: hourOf(clock[1]), minute: 0, explicit: true, spoken: clock[0], label: `${hourOf(clock[1])} o'clock` };
  const digital = /\b(\d{1,2}):(\d{2})\b/u.exec(text);
  if (digital && Number(digital[1]) < 24 && Number(digital[2]) < 60) return { hour: Number(digital[1]), minute: Number(digital[2]), explicit: true, spoken: digital[0], label: digital[0] };
  // A bare number is a time only after a time word and with nothing measured after it.
  const bare = new RegExp(`\\b(?:at|by|until|around|before|after)\\s+(${HOUR})(?=\\s*(?:$|[.,;!?]|and\\b|or\\b|then\\b|in the\\b))`, "iu").exec(text);
  if (bare && hourOf(bare[1]) >= 1 && hourOf(bare[1]) <= 12) return { hour: hourOf(bare[1]), minute: 0, explicit: false, spoken: bare[1], label: `${hourOf(bare[1])} o'clock` };
  return null;
}

/** Does this label name the motion itself, as "Walk" names walking? */
export function labelNamesMotion(label, motion, locale = "en") {
  return STORY_MOTIONS[language(locale)].find(([name]) => name === motion)?.[1].test(label ?? "") ?? false;
}

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
  return found.sort((a, b) => a.start - b.start).map(item => ({ ...item.entry, term: item.term, start: item.start }));
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
  for (const match of text.matchAll(/([$€£¥])\s?(\d[\d,]*(?:\.\d+)?)(?:\s?(k|m|thousand|million|billion))?|(\d[\d,]*(?:\.\d+)?)\s?(%|percent|dollars?|euros?|pounds?|yen|円|minutes?|hours?|days?|weeks?|months?|years?)/gu)) {
    const digits = (match[2] ?? match[4]).replaceAll(",", "");
    const scale = { k: 1e3, m: 1e6, thousand: 1e3, million: 1e6, billion: 1e9 }[match[3]] ?? 1;
    const unit = match[1] ? BY_SYMBOL.get(match[1]) : BY_WORD.get(match[5]);
    found.push({ start: match.index, end: match.index + match[0].length, value: Number(digits) * scale, unit });
  }
  const numberWord = [...Object.keys(SMALL), ...Object.keys(TENS), ...Object.keys(SCALE)].join("|");
  for (const match of text.matchAll(new RegExp(`\\b((?:${numberWord})(?:(?:[ -]|\\s+and\\s+)(?:${numberWord}))*)\\b(?:\\s+(dollars?|bucks|euros?|pounds?|yen|percent|${TIME_WORDS}))?`, "gu"))) {
    const words = match[1].split(/[ -]+/u).filter(Boolean);
    const unit = match[2] ? BY_WORD.get(match[2]) : undefined;
    // "one tool" is a count. A spelled number alone is an amount only when it is big enough to be one.
    const big = words.some(word => word in SCALE || word in TENS);
    if (!unit && !(big && defaultUnit)) continue;
    const value = spelledValue(words);
    if (value === null || found.some(item => match.index < item.end && item.start < match.index + match[0].length)) continue;
    found.push({ start: match.index, end: match.index + match[0].length, value, unit: unit ?? defaultUnit });
  }
  // "One day" is an expression. "Ninety minutes" is a quantity.
  return found.filter(item => !item.unit?.suffix || item.value >= 2).sort((a, b) => a.start - b.start).map(item => ({ ...item, text: formatAmount(item.value, item.unit) }));
}

/** The object a negation points at: "a habit, not a tool" denies the tool, not the habit. */
export function deniedTerm(phrase, compiled) {
  const after = /\b(?:not|never|no|without|rather than)\s+(?:a |an |the |your |just )?(.+)$/iu.exec(flatten(phrase));
  return after ? mentionedObjects(after[1], compiled)[0] ?? null : null;
}

export function formatAmount(value, unit) {
  if (unit?.fraction) return `${value}%`;
  if (unit?.suffix) return `${new Intl.NumberFormat("en").format(value)}${unit.suffix}`;
  const number = new Intl.NumberFormat("en").format(value);
  return unit ? `${unit.symbol}${number}` : number;
}

export function phraseSignals(phrase, locale = "en") {
  const table = STORY_SIGNALS[language(locale)];
  const text = flatten(phrase);
  const motion = STORY_MOTIONS[language(locale)].find(([, pattern]) => pattern.test(text)) ?? null;
  const shape = STORY_TREND_WORDS[language(locale)].find(([, pattern]) => pattern.test(text)) ?? null;
  return { question: /[?？]\s*$/u.test(text), motion: motion?.[0] ?? null, shape: shape?.[0] ?? null, word: (motion?.[1] ?? shape?.[1] ?? table.rising ?? null)?.exec(text)?.[0] ?? table.falling?.exec(text)?.[0] ?? null, ...Object.fromEntries(Object.entries(table).map(([name, pattern]) => [name, pattern.test(text)])) };
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
  for (const match of text.matchAll(/\b(?:a|an|the|your|our|their|this|that|these|those|its|my|every|each)\s+((?:[\p{L}'’-]+\s+)?[\p{L}'’-]+)/giu)) {
    const words = match[1].split(/\s+/u);
    // "the signal keeps going" reads two words past the noun, so a verb-like second word is dropped.
    const second = words[1]?.toLocaleLowerCase() ?? "";
    add(match.index, STOP.has(second) || /(?:s|ing|ed)$/u.test(second) && !/ss$/u.test(second) ? words.slice(0, 1) : words);
  }
  return found.sort((a, b) => a.index - b.index).map(item => item.label);
}

/** The word just before a verb, which is usually what the verb is about: "prices" in "prices climb". */
export function wordBefore(phrase, index) {
  const words = [...flatten(phrase).slice(0, index).matchAll(/[\p{L}][\p{L}'’-]*/gu)].map(match => match[0]);
  const word = words.at(-1);
  // "It finally pops" is about what is on stage, so an adverb names nothing new.
  if (!word || word.length < 3 || /ly$/iu.test(word) || STOP.has(word.toLocaleLowerCase()) || VAGUE.has(word.toLocaleLowerCase())) return null;
  return word.charAt(0).toLocaleUpperCase() + word.slice(1);
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
