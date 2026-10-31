/** Spoken-scene interactions on the existing frame clock.
 * ContentGen only chooses which Kumiki layout is active. It does not add a second timeline.
 */
const NATIVE_STYLE = {
  "general-intro": "question-lens",
  "general-flow": "journey",
  "general-comparison": "contrast",
  "general-breakdown": "decomposition",
  "general-payoff": "synthesis",
};
/** Specific sentence jobs win over a vague verb. The same job keeps the same picture. */
const CLAUSE_LAYOUT = [
  ["warning", /(?:\b(?:avoid|do not|don't|never|mistake|fails?|failure|risk|warning)\b)|避け|注意|失敗/u],
  ["example", /(?:\b(?:for example|for instance|imagine|picture this|such as)\b)|例えば/u],
  ["contrast", /(?:\b(?:versus|vs\.?|unlike|instead of|rather than|compared (?:with|to)|whereas|on the other hand)\b)|一方|対して|ではなく|と比べ/u],
  ["cause", /(?:\b(?:because|causes?|leads to|so that|depends on)\b)|なぜなら|によって/u],
  ["question-lens", /(?:(?:^|[\s、])(?:why|how|what|which|who|when|where)\b)|[?？]|なぜ|どうして|何が|どうなる/u],
  ["decomposition", /(?:\b(?:includes?|including|consists of|made of|broken into|types of|kinds of)\b)|種類|内訳|のうち/u],
  ["synthesis", /(?:\b(?:therefore|as a result|which means|the result|in the end|leaves|becomes|finally)\b)|つまり|だから|その結果|ようになる/u],
  ["journey", /(?:\b(?:then|next|after that|through|sends?|moves?|files|passes|followed by)\b)|そして|次に|へ渡/u],
];
export function layoutIntent(style) {
  return INTENT[style] ?? null;
}
export const SCRIPT_LAYOUTS = Object.freeze([
  "question-lens", "journey", "contrast", "decomposition", "synthesis", "example", "cause", "warning",
]);
const INTENT = {
  "question-lens": "general-intro",
  journey: "general-flow",
  contrast: "general-comparison",
  decomposition: "general-breakdown",
  synthesis: "general-payoff",
  example: "general-intro",
  cause: "general-intro",
  warning: "general-intro",
};

function phrasesFrom(text) {
  const clean = String(text ?? "").replace(/\s+/gu, " ").trim();
  const parts = clean.split(/[,、;；.!?。！？]/u).map(part => part.trim()).filter(part => part.length >= 8);
  const usable = parts.length ? parts : (clean.length >= 8 ? [clean] : []);
  return usable.slice(0, 12).map(part => part.length > 80 ? `${part.slice(0, 79).trimEnd()}…` : part);
}

function layoutForClause(phrase, fallback) {
  const text = String(phrase ?? "").replace(/…$/u, "").trim().toLocaleLowerCase();
  // A comma-separated label list such as "Send, Route, Deliver" is not a sentence.
  const spoken = text.length >= 8 && (
    /\b(?:the|a|an|to|into|through|each|then|of|for|from|with)\b|[?？]|[をがはにへとでの]|例えば|なぜなら|避け/u.test(text)
  );
  if (!spoken) return fallback;
  for (const [style, pattern] of CLAUSE_LAYOUT) {
    if (pattern.test(text)) return style;
  }
  return fallback;
}

/** A new window starts at least every 10 seconds, and no sooner than 5, unless the scene is shorter.
 * The layout follows the clause: question, comparison, parts, result, or a step. */
export function planScriptInteractions({ text = "", frames, fps = { num: 30, den: 1 }, intent = "general-intro" } = {}) {
  if (!Number.isSafeInteger(frames) || frames < 1) throw Error("An interaction schedule needs a positive frame count.");
  if (!Number.isSafeInteger(fps?.num) || !Number.isSafeInteger(fps?.den) || fps.num < 1 || fps.den < 1)
    throw Error("An interaction schedule needs a rational frame rate.");
  const minFrames = Math.max(1, Math.round(5 * fps.num / fps.den));
  const maxFrames = Math.max(minFrames, Math.round(10 * fps.num / fps.den));
  let count = Math.max(1, Math.ceil(frames / maxFrames));
  while (count > 1 && Math.floor(frames / count) < minFrames) count -= 1;
  const fallback = NATIVE_STYLE[intent] ?? NATIVE_STYLE["general-intro"];
  const phrases = phrasesFrom(text);
  const base = Math.floor(frames / count);
  let remainder = frames - base * count;
  let cursor = 0;
  const slots = [];
  for (let index = 0; index < count; index += 1) {
    const length = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    const style = layoutForClause(phrases[index % Math.max(1, phrases.length)] ?? "", fallback);
    slots.push({
      index, style, intent: INTENT[style],
      phrase: phrases[index % Math.max(1, phrases.length)] ?? "",
      startFrame: cursor, endFrame: cursor + length,
    });
    cursor += length;
  }
  return { slots, source: "rules" };
}

/** Use a validated model schedule when the draft stored one. Otherwise cut the narration here. */
export function chapterInteractions(chapter, fps = { num: 30, den: 1 }) {
  const frames = chapter.endFrame - chapter.startFrame;
  const stored = chapter?.interactions;
  const slots = stored?.slots;
  const contiguous = Array.isArray(slots) && slots.length > 0 && slots[0].startFrame === 0 && slots.at(-1).endFrame === frames &&
    slots.every((slot, index) => SCRIPT_LAYOUTS.includes(slot.style) && slot.intent === INTENT[slot.style] &&
      Number.isSafeInteger(slot.startFrame) && Number.isSafeInteger(slot.endFrame) && slot.endFrame > slot.startFrame &&
      (index === 0 || slot.startFrame === slots[index - 1].endFrame));
  if (contiguous) return stored;
  return planScriptInteractions({
    text: chapter?.narration || (chapter?.visual?.items ?? []).join(", "),
    frames, fps, intent: chapter?.intent,
  });
}

/** Drop a phrase that would print a diagram label the viewer has not seen yet. */
export function visibleScriptPhrase(phrase, items = [], visibleCount = 0) {
  const text = String(phrase ?? "").trim();
  if (!text) return "";
  const shown = new Set(items.slice(0, Math.max(0, visibleCount)).map(item => String(item).toLocaleLowerCase()));
  const hidden = items.map(item => String(item).trim()).filter(name => name && !shown.has(name.toLocaleLowerCase()));
  const lower = text.toLocaleLowerCase();
  for (const name of hidden) {
    const escaped = name.toLocaleLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "iu").test(lower)) return "";
  }
  return text;
}

export function interactionAt(schedule, localFrame) {
  if (!Number.isSafeInteger(localFrame) || localFrame < 0) throw Error("Interaction frame is outside the scene.");
  const slot = schedule?.slots?.find(item => localFrame >= item.startFrame && localFrame < item.endFrame);
  if (!slot) throw Error("Interaction frame is outside the scene.");
  const durationFrames = slot.endFrame - slot.startFrame;
  return {
    ...slot, durationFrames, localFrame: localFrame - slot.startFrame,
    progress: (localFrame - slot.startFrame) / Math.max(1, durationFrames - 1),
  };
}

/** Photo or footage shift for the active interaction. Values stay small enough to remain inside the inset. */
export function assetMotion(style, progress) {
  const p = Math.min(1, Math.max(0, Number(progress) || 0));
  if (style === "journey") return { x: -16 + 32 * p, y: 0, scale: 1.08 };
  if (style === "contrast") return { x: 0, y: -12 + 24 * p, scale: 1.06 };
  if (style === "decomposition") return { x: 8 - 16 * p, y: 6, scale: 1.04 + 0.08 * p };
  if (style === "synthesis") return { x: (1 - p) * 14, y: (1 - p) * 10, scale: 1.12 - 0.06 * p };
  if (style === "example") return { x: 0, y: -10 + 14 * p, scale: 1.02 + 0.08 * p };
  if (style === "cause") return { x: -18 + 36 * p, y: 0, scale: 1.06 };
  if (style === "warning") return { x: 0, y: Math.sin(p * Math.PI) * 10, scale: 1.04 + 0.04 * (1 - p) };
  return { x: Math.sin(p * Math.PI) * 12, y: -6 * p, scale: 1.05 + 0.04 * p };
}
