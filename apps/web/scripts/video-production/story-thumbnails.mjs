/** Three different thumbnail hypotheses, read from what a film actually shows.
 * Every word and number comes from the film. Nothing is invented, and no performance is predicted.
 */
const MAX_HEADLINE_WORDS = 7;
const DURATION = /\b(?:minutes?|hours?|days?|weeks?|months?|years?)\b/iu;
/** The side-panel recipes have a narrow text box. */
const MAX_NARROW_WORDS = 5;
const shorten = (text) => {
  const words = String(text ?? "").replace(/\s+/gu, " ").trim().split(" ");
  return words.length <= MAX_HEADLINE_WORDS ? words.join(" ") : `${words.slice(0, MAX_HEADLINE_WORDS).join(" ")}…`;
};

/** A headline has to stand alone: no dangling "It" or "That", and complete if it can be. */
const standsAlone = (caption) => !/^(?:it|that|this|they|these|those)\b/iu.test(caption ?? "");
const fits = (caption) => String(caption ?? "").split(/\s+/u).length <= MAX_HEADLINE_WORDS;
const bestHeadline = (items) => [...items].sort((a, b) => (standsAlone(b.caption) + fits(b.caption)) - (standsAlone(a.caption) + fits(a.caption)))[0];
const narrow = (caption) => String(caption ?? "").split(/\s+/u).length <= MAX_NARROW_WORDS;

function storyFacts(plan) {
  const facts = { gaps: [], values: [], problems: [], resolved: [], heroes: [], pairs: [] };
  for (const chapter of plan.chapters) {
    const spec = chapter.visual?.story;
    if (!spec) continue;
    const art = new Map(spec.objects.filter(item => item.art).map(item => [item.id, item]));
    for (const beat of spec.beats) {
      const caption = beat.caption?.text;
      for (const op of beat.ops ?? []) {
        if (op.kind === "measure-gap" && art.has(op.a) && art.has(op.b)) facts.gaps.push({ caption, label: op.label, a: art.get(op.a), b: art.get(op.b) });
        if (op.kind === "set-value" && art.has(op.object)) facts.values.push({ caption, object: art.get(op.object), text: beat.caption?.emphasis?.[0] });
        if (op.kind === "mark" && art.has(op.object) && op.mark === "cross") facts.problems.push({ caption, object: art.get(op.object) });
        if (op.kind === "mark" && art.has(op.object) && op.mark === "check") facts.resolved.push({ caption, object: art.get(op.object) });
      }
      for (const id of beat.arrangement.objects) if (art.has(id) && !facts.heroes.some(item => item.id === id)) facts.heroes.push(art.get(id));
      const shown = beat.arrangement.objects.filter(id => art.has(id));
      if (shown.length >= 2) facts.pairs.push({ caption, a: art.get(shown[0]), b: art.get(shown[1]) });
    }
  }
  return facts;
}

/** Up to three concepts: the contradiction, the headline fact, and the hidden cause.
 * @returns {Array<{id:string,label:string,recipe:string,headline:string,cue?:string,primaryArt:string,secondaryArt?:string}>}
 */
export function storyThumbnailConcepts(plan, { title }) {
  const facts = storyFacts(plan);
  const concepts = [];
  const seen = new Set();
  const add = (concept) => {
    const key = concept.headline.toLocaleLowerCase();
    if (seen.has(key) || concepts.some(item => item.recipe === concept.recipe)) return;
    seen.add(key);
    concepts.push(concept);
  };
  const gap = facts.gaps[0];
  if (gap) add({ id: "story-contradiction", label: "The contradiction", recipe: "comparison", headline: shorten(gap.caption), ...(gap.caption?.includes(gap.label) ? {} : { cue: gap.label }), primaryArt: gap.a.art, secondaryArt: gap.b.art });
  else if (facts.pairs.length) {
    const pair = bestHeadline(facts.pairs);
    add({ id: "story-contradiction", label: "The comparison", recipe: "comparison", headline: shorten(pair.caption), primaryArt: pair.a.art, secondaryArt: pair.b.art });
  }
  // A money or percent figure belongs to the object it sits beside. A duration next to the title
  // would read as a claim about the title, so it is never used as a cue.
  const value = facts.values.find(item => item.text && !DURATION.test(item.text)) ?? facts.values[0];
  if (value) add({ id: "story-fact", label: "The headline fact", recipe: "hero-fact", headline: shorten(title), ...(value.text && !DURATION.test(value.text) ? { cue: value.text } : {}), primaryArt: value.object.art });
  else if (facts.heroes[0]) add({ id: "story-fact", label: "The headline fact", recipe: "hero-fact", headline: shorten(title), primaryArt: facts.heroes[0].art });
  // A concept must say something the other two do not.
  const fresh = (items) => items.filter(item => item.object?.art && !seen.has(shorten(item.caption).toLocaleLowerCase()));
  const usable = (items) => fresh(items).filter(item => standsAlone(item.caption) && narrow(item.caption));
  const hidden = bestHeadline(usable(facts.problems)) ?? bestHeadline(usable(facts.resolved)) ?? bestHeadline(usable(facts.values));
  const third = hidden ?? null;
  if (third) add({ id: "story-hidden", label: "The hidden cause", recipe: "hidden-mechanism", headline: shorten(third.caption), primaryArt: third.object.art });
  return concepts;
}
