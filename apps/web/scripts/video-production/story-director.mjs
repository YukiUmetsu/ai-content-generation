/** From spoken phrases to an OS1 object story: what is on stage and what changes on each phrase.
 * Rules run with no model and give the same film for the same words.
 * The stage carries across scenes, so a video is one continuous set of objects, not a slide per section.
 */
import { captionFor, compileVocabulary, deniedTerm, formatAmount, labelNamesMotion, mentionedObjects, phraseConcepts, phraseKeyword, phraseSignals, spokenAmounts, spokenFlow, spokenTime, wordBefore } from "./story-language.mjs";
import { STORY_CUES } from "./story-sound.mjs";

/** How long each motion plays. Change a number here to retime it. */
export const STORY_MOTION_SECONDS = Object.freeze({ walk: 1.4, spin: 1, shake: .8, explode: 1.1, pop: .7, print: 1.5, stamp: .7, split: 1, vanish: .8, melt: 1.3, burn: 1.4,
  inflate: .9, deflate: 1.1, pulse: 1.2, wobble: 1, slide: .9, rain: 1.4, stack: 1.3, flip: .8, burst: .9, doze: 1.8 });
/** These end with the object gone, so it leaves the stage afterwards. */
const FINAL_MOTIONS = new Set(["explode", "pop", "vanish"]);

/** Tunable staging. Change these numbers, not the director. */
export const STORY_STAGING = Object.freeze({
  /** Most objects a viewer tracks at once. */
  maxOnStage: 3,
  /** A phrase longer than this gets a second change. */
  secondChangeSeconds: 2.2,
  /** Share of a phrase a value spends counting. */
  countShare: .6,
  /** Frames an entering object needs before an operation can use it. */
  settleSeconds: .45,
  /** How far a meter moves when the words say something rises or falls. */
  levelStep: .3,
  /** Object beats between two full-frame breaks, so a statement stays an event. */
  beatsBetweenBreaks: 3,
  /** Longest caption for a full-frame statement. */
  statementWords: 14,
  /** An object seen for less than this reads as a glitch, so the stage holds instead. */
  minObjectSeconds: 1.4,
  /** How long a clock's hands take to reach a spoken time. */
  clockSeconds: 1.4,
});

/** The art that a spoken time puts on stage. Kumiki draws its hands. */
const CLOCK_ART = "icon:Clock";

const slug = (value) => String(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 40) || "idea";
const arrangementKind = (count) => (count <= 1 ? "solo" : count === 2 ? "pair" : "row");
const artIdOf = (entry) => entry.art.split(":")[1];

function newStage() { return { order: [], held: [], objects: new Map(), unit: undefined, sinceBreak: Infinity, time: null, links: new Set(), flows: new Map() }; }

const objectId = (entry) => (entry.art ? artIdOf(entry) : `word-${slug(entry.label)}`);

/** Add a vocabulary object or a word to the stage's cast. */
function castObject(stage, entry, locale) {
  const id = objectId(entry);
  // The label is the word the narrator used: "Books", not the art's catalogue name.
  const spoken = entry.term ? entry.term.charAt(0).toLocaleUpperCase() + entry.term.slice(1) : entry.label;
  if (!stage.objects.has(id)) stage.objects.set(id, { id, label: spoken, ...(entry.art ? { art: entry.art } : {}), ...(entry.wordShape ? { wordShape: entry.wordShape } : {}), ...(entry.motion ? { motion: entry.motion } : {}), value: null });
  else if (entry.term) stage.objects.get(id).label = spoken;
  return id;
}

/** Put the clock on stage. Its hands start from the last time the words gave, otherwise a few hours back. */
function castClock(stage, time, locale) {
  const id = castObject(stage, { art: CLOCK_ART, label: time.label }, locale), object = stage.objects.get(id);
  object.label = time.label;
  if (!object.clock) {
    const { hour, minute } = stage.time ?? { hour: (time.hour + 21) % 24, minute: time.minute };
    object.clock = object.clockStart = { hour, minute };
  }
  return id;
}

/** The model can pick a stand-in, such as a press for "the bank prints". The narrator's subject still belongs on stage.
 * So does anything spoken that has its own motion, such as a burst word.
 */
function withSpokenSubject(proposed, spoken, text, maxOnStage) {
  const verbAt = wordIndex(text, proposed.verb);
  const same = (a, b) => (a.art ?? a.label) === (b.art ?? b.label);
  const subject = spoken.find(entry => entry.motion) ?? (verbAt > 0 ? spoken.find(entry => entry.start < verbAt) : null);
  if (!subject || proposed.objects.some(entry => same(entry, subject))) return proposed.objects;
  const standIn = proposed.objects.find(entry => !spoken.some(other => same(other, entry)));
  return [subject, ...proposed.objects.filter(entry => entry !== standIn)].slice(0, maxOnStage);
}

/** Where a word starts in a phrase. The ending can differ, as "printed" does from "prints". */
function wordIndex(text, word) {
  return word ? text.toLocaleLowerCase().indexOf(word.toLocaleLowerCase().slice(0, Math.max(3, word.length - 3))) : -1;
}

const opObjects = (op) => [op.object, op.from, op.to, op.a, op.b, op.into].filter(Boolean);

/** An object that would flash past leaves the stage as it was. Objects that do something are exempt. */
function holdBriefArrivals(beats, carried, frameRate, minSeconds) {
  for (const [index, beat] of beats.entries()) {
    const before = index ? beats[index - 1].arrangement.objects : carried;
    if (!before.length) continue;
    const brief = beat.arrangement.objects.filter(id => {
      if (before.includes(id)) return false;
      const gone = beats.slice(index).find(later => !later.arrangement.objects.includes(id));
      return gone && (gone.startFrame - beat.startFrame) / frameRate < minSeconds;
    });
    const looks = new Set(["highlight", "mark"]);
    if (!brief.length || beat.ops.some(op => !looks.has(op.kind) && opObjects(op).some(id => brief.includes(id)))) continue;
    const left = beat.arrangement.objects.filter(id => !brief.includes(id)), objects = left.length ? left : [...before];
    beat.arrangement = { kind: arrangementKind(objects.length), objects };
    beat.ops = beat.ops.filter(op => !opObjects(op).some(id => brief.includes(id)));
    if (brief.includes(beat.focus)) delete beat.focus;
    if (!beat.ops.length) beat.ops = [{ kind: "highlight", object: objects[0], atFrame: beat.startFrame, durationFrames: Math.max(1, Math.min(beat.endFrame - beat.startFrame, Math.round(.6 * frameRate))) }];
  }
}

/** The stage for a phrase. Objects it names lead. Earlier ones stay only while the words still need them. */
function arrange(previous, wanted, keepPrevious, maxOnStage, between = false) {
  if (!wanted.length) return [...previous];
  const keep = keepPrevious ? [...previous] : previous.filter(id => wanted.includes(id));
  // What both sides share stands between them, so its links do not cross anything.
  const joining = wanted.filter(id => !keep.includes(id));
  if (between && joining.length === 1 && keep.length === 2) keep.splice(1, 0, joining[0]);
  else keep.push(...joining);
  while (keep.length > maxOnStage) {
    const drop = keep.find(id => !wanted.includes(id));
    keep.splice(keep.indexOf(drop ?? keep[0]), 1);
  }
  return keep;
}

/** Words that still lean on what is already on stage. */
const continues = (text, signals, hasValues, saysAmount) => signals.both || signals.contrast || signals.question || (hasValues && saysAmount) ||
  /^[\p{Ll}]/u.test(text) || /^(?:it|they|this|these|those)\b/iu.test(text) || (hasValues && /\b(?:it|they|them|this|that|these|those)\b/iu.test(text));

function valueTarget(mentioned, stage, order) {
  const named = mentioned.find(id => order.includes(id));
  if (named) return named;
  return [...order].reverse().find(id => stage.objects.get(id)?.value === null) ?? order[order.length - 1];
}

/** The operations of one phrase, in the order they happen.
 * @returns {object[]} operations with frames relative to the phrase
 */
function phraseOps({ facts, frames, frameRate, stage, order, previous, entered, staging }) {
  const { mentioned, amounts, signals, denied, verb, text, flow, clock, time } = facts;
  const settle = entered.length ? Math.min(Math.round(staging.settleSeconds * frameRate), Math.floor(frames * .4)) : 0;
  const room = Math.max(1, frames - settle);
  const ops = [];
  const add = (op, share = 0, durationSeconds = .67, at = null) => {
    const atFrame = at ?? settle + Math.floor(room * share);
    ops.push({ ...op, atFrame, durationFrames: Math.max(1, Math.min(frames - atFrame, Math.round(durationSeconds * frameRate))) });
  };
  // A motion lands on its spoken word: `hit` is the share of the motion before the moment it strikes.
  const onWord = (word, seconds, hit = 0) => {
    const index = wordIndex(text, word);
    if (index < 0) return null;
    const length = Math.round(seconds * frameRate), spoken = Math.floor(frames * index / text.length);
    return Math.max(settle, Math.min(spoken - Math.round(length * hit), frames - length));
  };
  // Arrows follow the words and keep that direction later. A pair linked once stays linked.
  const directed = (a, b) => {
    const key = [a, b].sort().join("|");
    const said = flow.source === b || flow.destination === a ? [b, a] : flow.source === a || flow.destination === b ? [a, b] : stage.flows.get(key) ?? [a, b];
    stage.flows.set(key, said);
    return said;
  };
  const link = (a, b, share) => {
    const key = [a, b].sort().join("|");
    if (stage.links.has(key)) return;
    stage.links.add(key);
    const [from, to] = directed(a, b);
    add({ kind: "connect", from, to }, share, .6);
  };
  const onStage = (id) => order.includes(id);
  const focus = mentioned.find(onStage) ?? entered[0] ?? order[order.length - 1];
  const valued = order.filter(id => stage.objects.get(id)?.value !== null);

  // A new value counts up while it is being said.
  const amount = amounts[0];
  if (amount) {
    const known = valued.filter(id => stage.objects.get(id).value.amount === amount.value);
    if (signals.question && valued.length >= 2 && !mentioned.some(id => !valued.includes(id))) {
      add({ kind: "measure-gap", a: valued[0], b: valued[1], label: amount.text }, 0, 1);
      add({ kind: "mark", object: valued[1], mark: "question" }, .55, .4);
      return ops;
    }
    if (!known.length) {
      const target = valueTarget(mentioned, stage, order);
      const object = stage.objects.get(target);
      const carried = object.value?.amount;
      object.value = { amount: amount.value, unit: amount.unit, from: carried };
      add({ kind: "set-value", object: target, value: amount.unit?.fraction ? amount.value / 100 : amount.value }, 0, (room * staging.countShare) / frameRate);
    }
  }
  // A verb the viewer can picture gets that motion, not a generic highlight.
  // The mover is the object named by the verb, otherwise the phrase's subject.
  let graphed = null;
  const motionTarget = mentioned.find(id => onStage(id) && labelNamesMotion(stage.objects.get(id)?.label, signals.motion)) ?? mentioned.find(onStage) ?? focus;
  const shape = signals.shape ?? (signals.rising ? "rise" : signals.falling ? "fall" : null);
  if (signals.motion && motionTarget) {
    const seconds = STORY_MOTION_SECONDS[signals.motion] ?? .8;
    // A walker who has just arrived walks in from the edge, so the motion starts with the beat.
    if (signals.motion === "walk" && entered.includes(motionTarget)) ops.push({ kind: "act", object: motionTarget, motion: "walk", atFrame: 0, durationFrames: Math.min(frames, Math.round(seconds * frameRate)) });
    else {
      const emits = signals.motion === "print" ? order.find(id => id !== motionTarget) : undefined;
      add({ kind: "act", object: motionTarget, motion: signals.motion, ...(emits ? { emits } : {}) }, 0, seconds, onWord(verb, seconds, STORY_CUES[signals.motion]?.offset));
    }
  }
  // A graph shows what happened and "builds up" fills a meter. Neither invents a figure.
  else if (shape && focus && !amount) {
    // "The pressure keeps rising" follows its subject. "Your brain builds up a chemical" follows its object.
    // The subject is the nearest name before the verb: "one morning the stock market crashes" is about the market.
    const present = mentioned.filter(onStage), verbAt = wordIndex(text, verb);
    const before = present.filter(id => { const at = wordIndex(text, stage.objects.get(id)?.label); return at >= 0 && at < verbAt; });
    const subject = (facts.transitive ? present.at(-1) : before.at(-1) ?? present[0]) ?? focus;
    const object = stage.objects.get(subject);
    // Something with its own motion shows the words itself, and a graph would replace it.
    graphed = object.motion ? null : subject;
    if (object.motion) { /* its own motion runs below */ }
    else if ((signals.accumulating || object.level !== undefined) && (shape === "rise" || shape === "fall")) {
      const from = object.level ?? (shape === "rise" ? .2 : .8);
      const to = Math.round(Math.max(.05, Math.min(1, from + (shape === "rise" ? staging.levelStep : -staging.levelStep * 1.5))) * 100) / 100;
      object.level = to;
      object.levelFrom ??= from;
      add({ kind: "level", object: subject, to }, 0, (room * .8) / frameRate);
    } else {
      const seconds = Math.min((room * .9) / frameRate, shape === "crash" ? 2.6 : 3);
      add({ kind: "trend", object: subject, shape }, 0, seconds, onWord(verb, seconds, STORY_CUES[`trend-${shape}`]?.land?.at));
    }
  }
  if (clock) add({ kind: "set-time", object: clock, hour: time.hour, minute: time.minute }, 0, staging.clockSeconds, onWord(time.spoken, staging.clockSeconds));
  // Some objects say what they do as they arrive: a burst word on its word, a sleepy person dozing.
  for (const id of entered) {
    const object = stage.objects.get(id), motion = object?.motion;
    if (!motion || ops.some(op => (op.kind === "act" || op.kind === "trend") && op.object === id)) continue;
    const seconds = STORY_MOTION_SECONDS[motion] ?? .8;
    add({ kind: "act", object: id, motion }, 0, seconds, onWord(object.label, seconds));
  }
  // New objects join the ones already on stage when the words link them.
  if (entered.length && previous.length) {
    const sources = (signals.both ? previous : previous.slice(-1)).filter(onStage);
    if (signals.moving && sources.length) {
      const [from, to] = directed(sources[sources.length - 1], entered[0]);
      add({ kind: "transfer", from, to }, .1, .8);
    } else if (signals.both || signals.sequence || signals.cause) for (const [index, from] of sources.entries()) link(from, entered[0], index * .14);
  } else if (!entered.length && order.length >= 2 && mentioned.length >= 2 && (signals.sequence || signals.moving)) {
    const [from, to] = directed(mentioned[0], mentioned[1]);
    // Something moving is a token in flight. "Attach this to that" is a lasting link.
    if (signals.moving || !(flow.source || flow.destination)) add({ kind: "transfer", from, to }, 0, .8);
    else link(from, to, 0);
  } else if (!entered.length && signals.both && order.length >= 2) {
    link(order[0], order[1], 0);
  }
  // Words that say where something goes draw that link, even when nothing else moves.
  const [first, second] = mentioned.filter(onStage);
  if (second && (flow.source || flow.destination) && !ops.some(op => op.kind === "connect" || op.kind === "transfer")) link(first, second, .2);
  // Questions, problems and fixes end on a verdict the viewer can read at a glance.
  // "Never missing" denies a problem, so it is good news.
  const deniedProblem = signals.deniedProblem;
  const pointed = denied && !deniedProblem && onStage(denied) ? denied : null;
  const target = pointed ?? graphed ?? focus;
  const verdict = deniedProblem ? "check" : signals.question ? "question" : pointed ? "cross" : signals.problem || signals.negation ? "cross" : signals.resolved ? "check" : null;
  if (verdict && target) add({ kind: "mark", object: target, mark: verdict }, ops.length ? .6 : .35, .4);
  if (!ops.length && focus) add({ kind: "highlight", object: focus }, .15, .7);
  // No stretch of a phrase goes unchanged for long: each gap gets a look at something the words name.
  const limit = Math.round(staging.secondChangeSeconds * frameRate);
  const looks = [...new Set([...mentioned.filter(onStage), ...order])];
  for (let pass = 0, look = 0; pass < 6 && focus; pass++) {
    const spans = ops.map(op => [op.atFrame, op.atFrame + op.durationFrames]).sort((a, b) => a[0] - b[0]);
    let cursor = 0, gapStart = -1, gapSize = 0;
    for (const [start, end] of [...spans, [frames, frames]]) {
      if (start - cursor > gapSize) { gapSize = start - cursor; gapStart = cursor; }
      cursor = Math.max(cursor, end);
    }
    if (gapSize <= limit) break;
    const atFrame = gapStart + Math.floor(Math.min(gapSize / 2, limit * .8));
    ops.push({ kind: "highlight", object: looks[look++ % looks.length], atFrame, durationFrames: Math.max(1, Math.min(frames - atFrame, Math.round(.6 * frameRate))) });
  }
  return ops;
}

function readPhrase(window, compiled, stage, locale) {
  const objects = mentionedObjects(window.text, compiled);
  const signals = phraseSignals(window.text, locale);
  const amounts = spokenAmounts(window.text, { defaultUnit: stage.unit });
  if (amounts[0]?.unit && !amounts[0].unit.suffix) stage.unit = amounts[0].unit;
  // Money words name the amount, not an object on stage.
  const things = objects.filter(entry => (!amounts.length || !/^(?:dollars?|cash|money)$/iu.test(entry.term)) && !amounts.some(amount => entry.start >= amount.start && entry.start < amount.end));
  const flow = spokenFlow(window.text, objects, locale);
  return { objects: things, signals, amounts, deniedEntry: deniedTerm(window.text, compiled), flow: { source: flow.source && objectId(flow.source), destination: flow.destination && objectId(flow.destination) } };
}

/** Everything an object must declare to appear in a scene spec. */
function declare(stage, id, valuesAtStart, levelsAtStart, locale) {
  const object = stage.objects.get(id);
  const value = object.value ?? null;
  const startLevel = levelsAtStart.get(id);
  return { id, ...(object.label ? { label: object.label } : {}), ...(object.art ? { art: object.art } : {}), ...(startLevel === undefined ? {} : { level: startLevel }),
    ...(object.clockStart ? { clock: object.clockStart } : {}), ...(object.wordShape ? { wordShape: object.wordShape } : {}),
    ...(value ? { value: { format: value.unit?.format ?? { kind: "number", precision: 0 }, language: locale,
      ...(valuesAtStart.has(id) ? { initial: valuesAtStart.get(id), shownFromStart: true } : {}) } } : {}) };
}

/** Direct one scene, continuing the stage from the previous scene.
 * @param {{id:string,fps:{num:number,den:number},width:number,height:number,frames:number,phrases:{text:string,startFrame:number,endFrame:number}[],locale?:string}} scene
 * @param {{vocabulary:object,stage?:object,staging?:typeof STORY_STAGING,proposal?:object[]|null}} context
 * @returns {{spec:object,stage:object}}
 */
export function directSceneStory(scene, { vocabulary, stage = newStage(), staging = STORY_STAGING, proposal = null }) {
  const locale = scene.locale ?? "en";
  const compiled = compileVocabulary(vocabulary, locale);
  const frameRate = scene.fps.num / scene.fps.den;
  const carriedOrder = [...stage.order];
  const valuesAtStart = new Map(carriedOrder.filter(id => stage.objects.get(id)?.value).map(id => [id, stage.objects.get(id).value.amount]));
  const levelsAtStart = new Map(carriedOrder.filter(id => stage.objects.get(id)?.level !== undefined).map(id => [id, stage.objects.get(id).level]));
  // A link lasts for its scene, so each scene starts with none.
  stage.links = new Set();
  for (const object of stage.objects.values()) if (object.clock) object.clockStart = object.clock;
  const beats = [];
  let order = carriedOrder, firstFacts = null;
  for (const [phraseIndex, window] of scene.phrases.entries()) {
    const read = readPhrase(window, compiled, stage, locale);
    // Amounts are facts, so counts and measured gaps stay with the rules.
    const proposed = read.amounts.length ? null : proposal?.[phraseIndex];
    // A checked model proposal replaces what the rules read. Amounts still come from the words.
    // The model decides what a word means here: "runs a business" is not a run.
    // `look` says nothing physical happens, so the rules keep their verdicts but not their motions.
    const quiet = { motion: null, shape: null, rising: false, falling: false, moving: false, accumulating: false };
    const proposedSignals = proposed?.signals ? { ...Object.fromEntries(Object.keys(read.signals).map(key => [key, false])), ...proposed.signals } : proposed?.signals === null ? { ...read.signals, ...quiet } : read.signals;
    const facts = proposed ? { ...read, objects: withSpokenSubject(proposed, read.objects, window.text, staging.maxOnStage), deniedEntry: null, signals: proposedSignals } : read;
    firstFacts ??= facts;
    const finalLine = scene.final && phraseIndex === scene.phrases.length - 1;
    const breakDue = finalLine || stage.sinceBreak >= staging.beatsBetweenBreaks;
    const beatId = `${scene.id}-${beats.length + 1}`;
    const clearStage = () => { stage.held = order.length ? order : stage.held; order = []; stage.order = []; stage.sinceBreak = 0; };
    // A question or the film's last line fills the frame. A statement is an event, so it stays rare.
    if (breakDue && (finalLine || (facts.signals.question && !facts.amounts.length && (proposed || !facts.objects.length)))) {
      beats.push({ id: beatId, startFrame: window.startFrame, endFrame: window.endFrame, arrangement: { kind: "statement", objects: [] }, ops: [],
        caption: { text: captionFor(window.text, facts.amounts, staging.statementWords), ...(facts.amounts.length ? { emphasis: facts.amounts.map(item => item.text) } : {}) } });
      clearStage();
      continue;
    }
    // An amount with nothing to belong to is itself the subject.
    const valuedOnStage = order.filter(id => stage.objects.get(id)?.value).length;
    if (breakDue && facts.amounts.length && !facts.objects.length && valuedOnStage < 2 && !facts.signals.question) {
      const amount = facts.amounts[0], id = `figure-${slug(amount.text)}`, frames = window.endFrame - window.startFrame;
      stage.objects.set(id, { id, label: phraseConcepts(window.text)[0] ?? "", value: { amount: amount.value, unit: amount.unit } });
      beats.push({ id: beatId, startFrame: window.startFrame, endFrame: window.endFrame, arrangement: { kind: "figure", objects: [id] },
        ops: [{ kind: "set-value", object: id, value: amount.unit?.fraction ? amount.value / 100 : amount.value, atFrame: window.startFrame, durationFrames: Math.max(1, Math.round(frames * staging.countShare)) }],
        caption: { text: captionFor(window.text, facts.amounts), emphasis: [amount.text] } });
      clearStage();
      continue;
    }
    stage.sinceBreak += 1;
    let mentioned = facts.objects.map(entry => castObject(stage, entry, locale));
    const time = spokenTime(window.text, locale);
    const clock = time?.explicit ? castClock(stage, time, locale) : null;
    if (clock && !mentioned.includes(clock)) mentioned = [clock, ...mentioned].slice(0, staging.maxOnStage);
    if (time) stage.time = { hour: time.hour, minute: time.minute };
    // An idea with no picture becomes a word, so the stage still follows the narration.
    if (!proposed && !mentioned.length && !facts.amounts.length) {
      const taken = (order.length ? order : stage.held).map(id => stage.objects.get(id)?.label?.toLocaleLowerCase());
      const concept = phraseConcepts(window.text).find(label => !taken.includes(label.toLocaleLowerCase()));
      const acted = facts.signals.motion || facts.signals.shape || facts.signals.rising || facts.signals.falling ? wordBefore(window.text, wordIndex(window.text, read.signals.word)) : null;
      const label = concept ?? acted ?? (order.length || stage.held.length ? null : phraseKeyword(window.text, locale));
      if (label) mentioned = [castObject(stage, { label }, locale)];
    }
    // After a break the earlier objects can come back, but they are not on stage yet.
    const onStageBefore = order;
    const previous = order.length ? order : stage.held;
    stage.held = [];
    const denied = facts.deniedEntry ? castObject(stage, facts.deniedEntry, locale) : null;
    const hasValues = previous.some(id => stage.objects.get(id)?.value);
    order = proposed ? [...mentioned] : arrange(previous, mentioned, continues(window.text, facts.signals, hasValues, facts.amounts.length > 0), staging.maxOnStage, facts.signals.both);
    // A question about an amount brings the two values together, so the gap between them can be measured.
    const valuedNow = order.filter(id => stage.objects.get(id)?.value);
    if (facts.signals.question && facts.amounts.length && valuedNow.length >= 2) order = valuedNow.slice(0, 2);
    // Nothing to picture and nothing to return to: the words themselves are the scene.
    if (!order.length) {
      beats.push({ id: beatId, startFrame: window.startFrame, endFrame: window.endFrame, arrangement: { kind: "statement", objects: [] }, ops: [], caption: { text: captionFor(window.text, facts.amounts, staging.statementWords) } });
      stage.sinceBreak = 0;
      stage.order = order;
      continue;
    }
    const entered = order.filter(id => !onStageBefore.includes(id));
    const frames = window.endFrame - window.startFrame;
    const ops = phraseOps({ facts: { ...facts, mentioned, denied, transitive: /\b(?:builds? up|fills?|raises?|adds?|produces?|makes?)\b/iu.test(window.text),
      verb: proposed?.verb ?? read.signals.word, text: window.text, clock, time }, frames, frameRate, stage, order, previous: onStageBefore, entered, staging });
    if (clock) stage.objects.get(clock).clock = { hour: time.hour, minute: time.minute };
    const onlySome = mentioned.length === 1 && order.length > 1 && !entered.length;
    beats.push({ id: `${scene.id}-${beats.length + 1}`, startFrame: window.startFrame, endFrame: window.endFrame,
      arrangement: { kind: arrangementKind(order.length, facts.signals), objects: [...order] },
      ops: ops.map(({ atFrame, ...op }) => ({ ...op, atFrame: window.startFrame + atFrame })),
      caption: { text: proposed?.caption ?? captionFor(window.text, facts.amounts), ...(facts.amounts.length ? { emphasis: facts.amounts.map(item => item.text) } : {}) },
      ...(onlySome ? { focus: mentioned[0] } : {}) });
    const gone = new Set(ops.filter(op => op.kind === "act" && FINAL_MOTIONS.has(op.motion)).map(op => op.object));
    if (gone.size) order = order.filter(id => !gone.has(id));
    stage.order = order;
  }
  holdBriefArrivals(beats, carriedOrder, frameRate, staging.minObjectSeconds);
  const used = new Set([...carriedOrder, ...beats.flatMap(beat => beat.arrangement.objects)]);
  const spec = { schemaVersion: 1, id: scene.id, fps: scene.fps, durationFrames: scene.frames, width: scene.width, height: scene.height, language: locale,
    objects: [...used].map(id => declare(stage, id, valuesAtStart, levelsAtStart, locale)), beats,
    ...(carriedOrder.length ? { carried: { kind: arrangementKind(carriedOrder.length), objects: carriedOrder } } : {}) };
  return { spec, stage };
}

export { newStage as newStoryStage, formatAmount };
