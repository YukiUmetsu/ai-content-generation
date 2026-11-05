/** Words a viewer reads on screen.
 * They come from what the scene says, or from copy an author wrote for the screen.
 * Outline labels and direction notes are written for the author and never qualify.
 * Shared by the browser storyboard handoff and the Node compilers.
 */
import { isOutlineHeading } from "./script-contract.mjs";

export const HEADLINE_MAX = 68;
export const SUPPORT_MAX = 115;
export const KICKER_MAX = 28;

const CLOSERS = /["'”’)\]」』]/u;
const flat = (value) => String(value ?? "").replace(/\s+/gu, " ").trim();
const fold = (value) => flat(value).toLocaleLowerCase().replace(/[\s.。!！?？…:：]+$/u, "");

/** Two pieces of screen text that read the same, ignoring case, spacing and closing punctuation. */
export const sameScreenText = (a, b) => fold(a) === fold(b);

/** Split narration into sentences. Latin marks end a sentence only before a space; CJK marks always do. */
export function spokenSentences(narration) {
  const text = flat(narration), sentences = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const mark = text[index];
    const ends = "。！？".includes(mark) || (".!?".includes(mark) && (index + 1 === text.length || /[\s"'”’)\]]/u.test(text[index + 1])));
    if (!ends) continue;
    let end = index + 1;
    while (end < text.length && (CLOSERS.test(text[end]) || ".!?".includes(text[end]))) end++;
    const sentence = text.slice(start, end).trim();
    if (sentence) sentences.push(sentence);
    start = end;
    index = end - 1;
  }
  const rest = text.slice(start).trim();
  if (rest) sentences.push(rest);
  return sentences;
}

/** Shorten to a limit at a clause, then at a word. A cut is always marked. */
export function fitCopy(value, max) {
  const text = flat(value);
  if (text.length <= max) return text;
  const room = text.slice(0, max - 1);
  const clause = Math.max(...[",", ";", ":", " —", " –", "、", "，"].map(mark => room.lastIndexOf(mark)));
  if (clause >= 12) return `${room.slice(0, clause).trimEnd()}…`;
  const word = room.lastIndexOf(" ");
  return `${(word >= 12 ? room.slice(0, word) : room).trimEnd()}…`;
}

/** True when a line only repeats words already on screen: the same text, or one inside the other. */
export function repeatsScreenText(line, shown = []) {
  const text = fold(line);
  if (text.length < 8) return false;
  return shown.some(other => {
    const present = fold(other).replace(/…$/u, "").trimEnd();
    return present.length >= 8 && (present.includes(text) || text.includes(present));
  });
}

/** A sentence as a title: no closing full stop, but a question or exclamation keeps its mark. */
const asTitle = (sentence) => sentence.replace(/[.。]+$/u, "");

/** True when the text was written for the screen: present, and not a default outline heading. */
export function isAuthoredScreenText(value) {
  const text = flat(value);
  return text.length > 0 && !isOutlineHeading(text);
}

/** The headline and supporting line for one scene.
 * An authored headline is kept. Otherwise the first spoken sentence becomes the headline.
 * The supporting line is the next thing the scene says that the headline does not already show.
 * @param {string} narration
 * @param {{authoredHeadline?:string,authoredSupport?:string,fallbackSupport?:string,headlineMax?:number,supportMax?:number}} options
 * @returns {{headline:string,support:string,source:{headline:"authored"|"narration",support:"authored"|"narration"|"fallback"}}}
 */
export function audienceCopy(narration, options = {}) {
  const headlineMax = options.headlineMax ?? HEADLINE_MAX, supportMax = options.supportMax ?? SUPPORT_MAX;
  const sentences = spokenSentences(narration);
  if (!sentences.length) throw Error("A scene needs narration before it can show text.");
  const authored = isAuthoredScreenText(options.authoredHeadline);
  const headline = authored ? fitCopy(options.authoredHeadline, headlineMax) : fitCopy(asTitle(sentences[0]), headlineMax);
  if (isAuthoredScreenText(options.authoredSupport) && fold(options.authoredSupport) !== fold(headline))
    return { headline, support: fitCopy(options.authoredSupport, supportMax), source: { headline: authored ? "authored" : "narration", support: "authored" } };
  // A headline cut short leaves its own sentence as the best supporting line.
  const shown = headline.endsWith("…") ? null : fold(headline);
  const spoken = sentences.find(sentence => fold(sentence) !== shown && fold(asTitle(sentence)) !== shown);
  if (spoken) return { headline, support: fitCopy(spoken, supportMax), source: { headline: authored ? "authored" : "narration", support: "narration" } };
  const fallback = flat(options.fallbackSupport);
  if (!fallback || fold(fallback) === fold(headline)) throw Error("A scene with one short sentence needs a supporting line or a viewer question.");
  return { headline, support: fitCopy(fallback, supportMax), source: { headline: authored ? "authored" : "narration", support: "fallback" } };
}

/** Viewer-facing kickers above the headline, by a scene's place in the film.
 * Edit or extend per locale; `{index}` and `{total}` are filled in.
 */
export const AUDIENCE_KICKERS = Object.freeze({
  en: Object.freeze({ opening: "THE QUESTION", closing: "THE ANSWER", postscript: "ONE MORE THING", step: "{index} / {total}" }),
  ja: Object.freeze({ opening: "問い", closing: "答え", postscript: "もうひとつ", step: "{index} / {total}" }),
});

/** A scene's place in the film, from its position and declared purpose. */
export function scenePlace(shots, index) {
  const purpose = shots[index]?.purpose;
  if (index === 0) return "opening";
  if (purpose === "postscript") return "postscript";
  const answered = shots.some(shot => shot.purpose === "answer");
  return purpose === "answer" || (!answered && index === shots.length - 1) ? "closing" : "step";
}

/** The kicker for a scene. Internal words such as "mechanism" or "explain" never reach the screen.
 * @param {{place:"opening"|"closing"|"postscript"|"step",index:number,total:number,locale?:string,kickers?:Record<string,Record<string,string>>}} scene
 */
export function audienceKicker({ place, index, total, locale = "en", kickers = AUDIENCE_KICKERS }) {
  const table = kickers[String(locale).slice(0, 2).toLowerCase()] ?? kickers.en;
  const template = table[place] ?? table.step;
  return fitCopy(template.replace("{index}", String(index + 1)).replace("{total}", String(total)), KICKER_MAX);
}

/** Text that must not reach the screen: an outline label, or a direction note shown as it was written.
 * @param {string} shown
 * @param {string[]} directions private notes for this scene
 * @returns {"outline-label"|"direction-note"|null}
 */
export function editorialLeak(shown, directions = []) {
  const text = fold(shown);
  if (!text) return null;
  // "Opening hook: The invoice says…" carries an outline label in front of real words.
  if (isOutlineHeading(text) || isOutlineHeading(text.split(/[:：]/u)[0])) return "outline-label";
  const cut = text.replace(/…$/u, "").trimEnd();
  for (const note of directions) {
    const written = fold(note);
    if (written.length < 12) continue;
    if (written === text || (cut.length >= 24 && written.startsWith(cut))) return "direction-note";
  }
  return null;
}
