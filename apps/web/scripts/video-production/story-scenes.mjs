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

/**
 * @param {object} plan general explainer plan
 * @param {{speech:object[],ffmpeg?:string,signal?:AbortSignal,enabled?:boolean}} options
 * @returns {Promise<{plan:object,report:object[],cues?:object[]}>}
 */
export async function applyObjectStories(plan, { speech = [], ffmpeg, signal, enabled = true } = {}, deps = {}) {
  // Portrait layouts are authored separately and do not draw stories yet.
  if (!enabled || plan?.kind !== "general-explainer-visual-plan" || plan.manifest.width < plan.manifest.height) return { plan, report: [] };
  const vocabulary = deps.vocabulary ?? await loadStoryVocabulary();
  const check = deps.check ?? await loadStoryChecker();
  const pausesOf = deps.detectPauses ?? detectPauses;
  const { fps, width, height } = plan.manifest;
  let stage = newStoryStage();
  const chapters = [], report = [];
  for (const chapter of plan.chapters) {
    if (!sceneNeedsStory(chapter)) { stage = newStoryStage(); chapters.push(chapter); continue; }
    const frames = chapter.endFrame - chapter.startFrame;
    const measured = speech.find(item => item.id === chapter.id);
    // Pauses refine the timing. Without them phrases keep their text-based estimate, and the report says so.
    let pauses = [], timing = "estimated";
    if (measured?.wavPath) {
      try { pauses = await pausesOf(measured.wavPath, { ffmpeg, signal }); timing = "measured-pauses"; }
      catch (error) { if (signal?.aborted) throw error; }
    }
    const spokenSeconds = measured?.samples ? measured.samples / (measured.sampleRate ?? 48000) : undefined;
    const phrases = phraseWindows({ phrases: speechPhrases(chapter.narration), frames, fps, spokenSeconds, pauses });
    const directed = directSceneStory({ id: chapter.id, fps, width, height, frames, phrases, locale: plan.locale }, { vocabulary, stage });
    stage = directed.stage;
    const verdict = check(directed.spec);
    if (!verdict.ok) throw Error(`The story for scene ${chapter.id} is invalid: ${verdict.diagnostics.filter(item => item.severity === "error").map(item => item.message).join(" ")}`);
    report.push({ chapterId: chapter.id, phrases: phrases.length, timing, pausesFound: pauses.length, pacing: verdict.pacing,
      warnings: verdict.diagnostics.filter(item => item.severity === "warning").map(item => item.code) });
    chapters.push({ ...chapter, visual: { ...chapter.visual, story: directed.spec } });
  }
  const cues = chapters.filter(chapter => chapter.visual?.story).flatMap(chapter => storyCues(chapter.visual.story).map(cue => ({ ...cue, chapterId: chapter.id, absolute: chapter.startFrame + cue.frame })));
  return { plan: { ...plan, chapters }, report, cues: thinCues(cues, { fps }) };
}
