/** From spoken phrases to an OS1 object story: what is on stage and what changes on each phrase.
 * Rules run with no model and give the same film for the same words.
 * The stage carries across scenes, so a video is one continuous set of objects, not a slide per section.
 */
import { captionFor, compileVocabulary, deniedTerm, formatAmount, mentionedObjects, phraseKeyword, phraseSignals, spokenAmounts } from "./story-language.mjs";

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
});

const slug = (value) => String(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 40) || "idea";
const arrangementKind = (count, signals) => (count <= 1 ? "solo" : count === 2 ? "pair" : "row");
const artIdOf = (entry) => entry.art.split(":")[1];

function newStage() { return { order: [], objects: new Map(), unit: undefined }; }

/** Add a vocabulary object or a word to the stage's cast. */
function castObject(stage, entry, locale) {
  const id = entry.art ? artIdOf(entry) : `word-${slug(entry.label)}`;
  // The label is the word the narrator used: "Books", not the art's catalogue name.
  const spoken = entry.term ? entry.term.charAt(0).toLocaleUpperCase() + entry.term.slice(1) : entry.label;
  if (!stage.objects.has(id)) stage.objects.set(id, { id, label: spoken, ...(entry.art ? { art: entry.art } : {}), value: null });
  else if (entry.term) stage.objects.get(id).label = spoken;
  return id;
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
  /^[\p{Ll}]/u.test(text) || (hasValues && /\b(?:it|they|them|this|that|these|those)\b/iu.test(text));

function valueTarget(mentioned, stage, order) {
  const named = mentioned.find(id => order.includes(id));
  if (named) return named;
  return [...order].reverse().find(id => stage.objects.get(id)?.value === null) ?? order[order.length - 1];
}

/** The operations of one phrase, in the order they happen.
 * @returns {object[]} operations with frames relative to the phrase
 */
function phraseOps({ facts, frames, frameRate, stage, order, previous, entered, staging }) {
  const { mentioned, amounts, signals, denied } = facts;
  const settle = entered.length ? Math.min(Math.round(staging.settleSeconds * frameRate), Math.floor(frames * .4)) : 0;
  const room = Math.max(1, frames - settle);
  const ops = [];
  const add = (op, share = 0, durationSeconds = .67) => {
    const atFrame = settle + Math.floor(room * share);
    ops.push({ ...op, atFrame, durationFrames: Math.max(1, Math.min(frames - atFrame, Math.round(durationSeconds * frameRate))) });
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
  // New objects join the ones already on stage when the words link them.
  if (entered.length && previous.length) {
    const sources = (signals.both ? previous : previous.slice(-1)).filter(onStage);
    if (signals.both || signals.sequence || signals.cause) for (const [index, from] of sources.entries()) add({ kind: "connect", from, to: entered[0] }, index * .14, .6);
  } else if (!entered.length && order.length >= 2 && mentioned.length >= 2 && signals.sequence) {
    add({ kind: "transfer", from: mentioned[0], to: mentioned[1] }, 0, .8);
  } else if (!entered.length && signals.both && order.length >= 2) {
    add({ kind: "connect", from: order[0], to: order[1] }, 0, .6);
  }
  // Questions, problems and fixes end on a verdict the viewer can read at a glance.
  // "Never missing" denies a problem, so it is good news.
  const deniedProblem = signals.negation && signals.problem;
  const pointed = denied && !deniedProblem && onStage(denied) ? denied : null;
  const target = pointed ?? focus;
  const verdict = signals.question ? "question" : pointed ? "cross" : deniedProblem ? "check" : signals.problem || signals.negation ? "cross" : signals.resolved ? "check" : null;
  if (verdict && target) add({ kind: "mark", object: target, mark: verdict }, ops.length ? .6 : .35, .4);
  if (!ops.length && focus) add({ kind: "highlight", object: focus }, .15, .7);
  // A long phrase needs a second change, tied to something else it names.
  if (frames / frameRate > staging.secondChangeSeconds && ops.length < 2 && focus) {
    const other = mentioned.find(id => id !== focus && onStage(id)) ?? order.find(id => id !== focus);
    add({ kind: "highlight", object: other ?? focus }, .62, .6);
  }
  return ops;
}

function readPhrase(window, compiled, stage, locale) {
  const objects = mentionedObjects(window.text, compiled);
  const signals = phraseSignals(window.text, locale);
  const amounts = spokenAmounts(window.text, { defaultUnit: stage.unit });
  if (amounts[0]?.unit) stage.unit = amounts[0].unit;
  // Money words name the amount, not an object on stage.
  const things = objects.filter(entry => !amounts.length || !/^(?:dollars?|cash|money)$/iu.test(entry.term));
  return { objects: things, signals, amounts, deniedEntry: deniedTerm(window.text, compiled) };
}

/** Everything an object must declare to appear in a scene spec. */
function declare(stage, id, valuesAtStart, locale) {
  const object = stage.objects.get(id);
  const value = object.value ?? null;
  return { id, ...(object.label ? { label: object.label } : {}), ...(object.art ? { art: object.art } : {}),
    ...(value ? { value: { format: value.unit?.format ?? { kind: "number", precision: 0 }, language: locale,
      ...(valuesAtStart.has(id) ? { initial: valuesAtStart.get(id), shownFromStart: true } : {}) } } : {}) };
}

/** Direct one scene, continuing the stage from the previous scene.
 * @param {{id:string,fps:{num:number,den:number},width:number,height:number,frames:number,phrases:{text:string,startFrame:number,endFrame:number}[],locale?:string}} scene
 * @param {{vocabulary:object,stage?:object,staging?:typeof STORY_STAGING}} context
 * @returns {{spec:object,stage:object}}
 */
export function directSceneStory(scene, { vocabulary, stage = newStage(), staging = STORY_STAGING }) {
  const locale = scene.locale ?? "en";
  const compiled = compileVocabulary(vocabulary, locale);
  const frameRate = scene.fps.num / scene.fps.den;
  const carriedOrder = [...stage.order];
  const valuesAtStart = new Map(carriedOrder.filter(id => stage.objects.get(id)?.value).map(id => [id, stage.objects.get(id).value.amount]));
  const beats = [];
  let order = carriedOrder, firstFacts = null;
  for (const window of scene.phrases) {
    const facts = readPhrase(window, compiled, stage, locale);
    firstFacts ??= facts;
    let mentioned = facts.objects.map(entry => castObject(stage, entry, locale));
    // A word stands in for a picture only on an empty stage. Otherwise the objects already there react.
    if (!mentioned.length && !order.length) {
      const label = phraseKeyword(window.text, locale);
      if (label) mentioned = [castObject(stage, { label }, locale)];
    }
    const previous = order;
    const denied = facts.deniedEntry ? castObject(stage, facts.deniedEntry, locale) : null;
    const hasValues = previous.some(id => stage.objects.get(id)?.value);
    order = arrange(previous, mentioned, continues(window.text, facts.signals, hasValues, facts.amounts.length > 0), staging.maxOnStage, facts.signals.both);
    // A question about an amount brings the two values together, so the gap between them can be measured.
    const valuedNow = order.filter(id => stage.objects.get(id)?.value);
    if (facts.signals.question && facts.amounts.length && valuedNow.length >= 2) order = valuedNow.slice(0, 2);
    if (!order.length) throw Error(`Scene ${scene.id} has nothing to show for "${window.text}".`);
    const entered = order.filter(id => !previous.includes(id));
    const frames = window.endFrame - window.startFrame;
    const ops = phraseOps({ facts: { ...facts, mentioned, denied }, frames, frameRate, stage, order, previous, entered, staging });
    const onlySome = mentioned.length === 1 && order.length > 1 && !entered.length;
    beats.push({ id: `${scene.id}-${beats.length + 1}`, startFrame: window.startFrame, endFrame: window.endFrame,
      arrangement: { kind: arrangementKind(order.length, facts.signals), objects: [...order] },
      ops: ops.map(({ atFrame, ...op }) => ({ ...op, atFrame: window.startFrame + atFrame })),
      caption: { text: captionFor(window.text, facts.amounts), ...(facts.amounts.length ? { emphasis: facts.amounts.map(item => item.text) } : {}) },
      ...(onlySome ? { focus: mentioned[0] } : {}) });
    stage.order = order;
  }
  const used = new Set([...carriedOrder, ...beats.flatMap(beat => beat.arrangement.objects)]);
  const spec = { schemaVersion: 1, id: scene.id, fps: scene.fps, durationFrames: scene.frames, width: scene.width, height: scene.height, language: locale,
    objects: [...used].map(id => declare(stage, id, valuesAtStart, locale)), beats,
    ...(carriedOrder.length ? { carried: { kind: arrangementKind(carriedOrder.length), objects: carriedOrder } } : {}) };
  return { spec, stage };
}

export { newStage as newStoryStage, formatAmount };
