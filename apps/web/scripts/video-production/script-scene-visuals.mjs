/** Labels taken from the words a scene actually speaks.
 * Kumiki animates these phrases; they are not a second scene clock.
 */
import { isVisualElements } from "./visual-elements.mjs";

const STOP = new Set(["the","a","an","of","for","from","to","and","with","on","in","by","how","why","that","this","its","into","over","than","then","their","there","what","when","where","which","while","about","after","before","each","same","your","you","are","was","were","will","can","may","not","but","or","as","at","be","is","it","show","shows","compare","explain","avoid","section"]);
const GENERIC = /^(?:house|categories|main idea|how it changes|step\s*\d+|item\s*\d+|node\s*\d+|thing|topic|concept|answer|problem|summary|topic focus)$/iu;

/** Spread reveals across the spoken scene and keep Kumiki's camera moving. */
export const SCRIPT_SCENE_MOTION = Object.freeze({
  revealDelayPercent: 8, revealPace: "deliberate", camera: "cinematic", transition: "cut",
});

function detailFor(sentence, label) {
  let detail = sentence.replace(/\s+/gu, " ").trim();
  if (detail.toLocaleLowerCase() === label.toLocaleLowerCase())
    detail = `The narration names ${label} in this scene.`;
  // The render job stores each note beside its label and allows 44 characters.
  if (detail.length > 44) detail = `${detail.slice(0, 43).trimEnd()}…`;
  return detail;
}

/** @returns {Array<{label:string,detail:string}>|null} */
export function scriptSceneVisuals(narration) {
  const text = String(narration ?? "").replace(/\s+/gu, " ").trim();
  if (text.length < 20) return null;
  const clauses = text.split(/[,、;；.!?。！？]/u).map(part => part.trim()).filter(part => part.length >= 8);
  const elements = [];
  const seen = new Set();
  const consider = (label, sentence) => {
    if (elements.length >= 5) return;
    const clean = label.replace(/\s+/gu, " ").trim();
    if (clean.length < 3 || clean.length > 44 || GENERIC.test(clean)) return;
    const key = clean.toLocaleLowerCase();
    if (seen.has(key) || !text.toLocaleLowerCase().includes(key)) return;
    const detail = detailFor(sentence, clean);
    if (detail.length < 8 || detail.toLocaleLowerCase() === key) return;
    if (/[\u0000-\u001f<>]/u.test(clean) || /[\u0000-\u001f<>]/u.test(detail) || /\s{3,}/u.test(detail)) return;
    seen.add(key);
    elements.push({ label: clean, detail });
  };
  for (const sentence of (clauses.length ? clauses : [text])) {
    const words = [...sentence.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2,12}/gu)].map(match => match[0]);
    const content = [];
    for (const word of words) {
      if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(word)) {
        consider(word, sentence);
        continue;
      }
      if (word.length < 4 || STOP.has(word.toLocaleLowerCase())) continue;
      content.push(word);
      if (content.length >= 2) consider(`${content.at(-2)} ${content.at(-1)}`, sentence);
    }
    if (content.length === 1) consider(content[0], sentence);
  }
  return isVisualElements(elements) ? elements : null;
}
