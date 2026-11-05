/** Node access to the object story compiler, so a story is checked before any frame is captured.
 * Caption widths here are a cautious estimate. The export page compiles again with real font metrics.
 */
import { compileObjectStory } from "@/components/video/object-story";
import type { ObjectStorySpec } from "@/components/video/object-story";

/** Slightly wider than Geist's bold average, so a caption that fits here also fits in the browser. */
const measure = (font: string, text: string) => {
  const size = Number(/(\d+(?:\.\d+)?)px/u.exec(font)?.[1] ?? 16);
  return [...text].reduce((width, character) => width + (/[\u3000-\u9fff\uff00-\uffef]/u.test(character) ? 1 : character === " " ? .28 : .58) * size, 0);
};

export function checkObjectStory(spec: ObjectStorySpec) {
  const result = compileObjectStory(spec, { measure });
  return { ok: result.ok, diagnostics: result.diagnostics, pacing: result.ok ? result.plan.pacing : null };
}
