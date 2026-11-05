/** Production step: direct an object story for every narrated scene that has no authored picture.
 * It runs after narration, so beats follow measured speech, and before capture, so a bad story stops early.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { detectPauses, phraseWindows, speechPhrases } from "./speech-phrases.mjs";
import { directSceneStory, newStoryStage } from "./story-director.mjs";
import { storyCues, thinCues } from "./story-sound.mjs";

const vocabularyPath = new URL("./story-vocabulary.json", import.meta.url);
const checkerPath = fileURLToPath(new URL("../../dist-shot/story-entry.mjs", import.meta.url));

export async function loadStoryVocabulary(path = vocabularyPath) {
  return JSON.parse(await readFile(path, "utf8"));
}

/** The compiler bundle. A missing bundle stops production: stories must not reach capture unchecked. */
export async function loadStoryChecker(path = checkerPath) {
  try { return (await import(path)).checkObjectStory; }
  catch { throw Error("The object story checker is not built. Run pnpm build, then start the video again."); }
}

/** A scene with its own picture keeps it: a chart, footage, a recipe, a character performance or dialogue. */
export function sceneNeedsStory(chapter) {
  const { visual } = chapter;
  return Boolean(chapter.narration?.trim()) && !chapter.dialogue && !visual?.stockMedia && !visual?.performanceClip && !visual?.sceneRecipe && !visual?.chart &&
    !visual?.direction?.visualMechanic && !visual?.direction?.transformation && !visual?.direction?.performance;
}

/** Direct every eligible scene. Pure, so the Studio preview shows the same stories before any voice exists.
 * @param {object} plan general explainer plan
 * @param {{vocabulary:object,timings?:Map<string,{pauses?:object[],spokenSeconds?:number}>}} context
 */
export function directPlanStories(plan, { vocabulary, timings = new Map() }) {
  // Portrait layouts are authored separately and do not draw stories yet.
  if (plan?.kind !== "general-explainer-visual-plan" || plan.manifest.width < plan.manifest.height) return plan;
  const { fps, width, height } = plan.manifest;
  let stage = newStoryStage();
  const chapters = plan.chapters.map(chapter => {
    if (!sceneNeedsStory(chapter)) { stage = newStoryStage(); return chapter; }
    const frames = chapter.endFrame - chapter.startFrame;
    const phrases = phraseWindows({ phrases: speechPhrases(chapter.narration), frames, fps, ...timings.get(chapter.id) });
    const directed = directSceneStory({ id: chapter.id, fps, width, height, frames, phrases, locale: plan.locale }, { vocabulary, stage });
    stage = directed.stage;
    return { ...chapter, visual: { ...chapter.visual, story: directed.spec } };
  });
  return { ...plan, chapters };
}

/** The production step: measured timing, a compile check and cues.
 * @param {object} plan general explainer plan
 * @param {{speech:object[],ffmpeg?:string,signal?:AbortSignal,enabled?:boolean}} options
 * @returns {Promise<{plan:object,report:object[],cues?:object[]}>}
 */
export async function applyObjectStories(plan, { speech = [], ffmpeg, signal, enabled = true } = {}, deps = {}) {
  if (!enabled || plan?.kind !== "general-explainer-visual-plan" || plan.manifest.width < plan.manifest.height) return { plan, report: [] };
  const vocabulary = deps.vocabulary ?? await loadStoryVocabulary();
  const check = deps.check ?? await loadStoryChecker();
  const pausesOf = deps.detectPauses ?? detectPauses;
  const timings = new Map(), timingLabel = new Map();
  for (const chapter of plan.chapters.filter(sceneNeedsStory)) {
    const measured = speech.find(item => item.id === chapter.id);
    // Pauses refine the timing. Without them phrases keep their text-based estimate, and the report says so.
    let pauses = [];
    timingLabel.set(chapter.id, "estimated");
    if (measured?.wavPath) {
      try { pauses = await pausesOf(measured.wavPath, { ffmpeg, signal }); timingLabel.set(chapter.id, "measured-pauses"); }
      catch (error) { if (signal?.aborted) throw error; }
    }
    timings.set(chapter.id, { pauses, ...(measured?.samples ? { spokenSeconds: measured.samples / (measured.sampleRate ?? 48000) } : {}) });
  }
  const directed = directPlanStories(plan, { vocabulary, timings });
  const report = [], cues = [];
  for (const chapter of directed.chapters) {
    const spec = chapter.visual?.story;
    if (!spec) continue;
    const verdict = check(spec);
    if (!verdict.ok) throw Error(`The story for scene ${chapter.id} is invalid: ${verdict.diagnostics.filter(item => item.severity === "error").map(item => item.message).join(" ")}`);
    report.push({ chapterId: chapter.id, phrases: spec.beats.length, timing: timingLabel.get(chapter.id), pausesFound: timings.get(chapter.id).pauses.length, pacing: verdict.pacing,
      warnings: verdict.diagnostics.filter(item => item.severity === "warning").map(item => item.code) });
    cues.push(...storyCues(spec).map(cue => ({ ...cue, chapterId: chapter.id, absolute: chapter.startFrame + cue.frame })));
  }
  return { plan: directed, report, cues: thinCues(cues, { fps: plan.manifest.fps }) };
}
