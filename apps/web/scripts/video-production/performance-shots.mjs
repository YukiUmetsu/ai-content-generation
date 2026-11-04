/** Render the 3D shots a storyboard asks for, using measured speech, and bind them to their scenes.
 * A scene that asks for a shot and cannot get one stops production. It never becomes a diagram.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import { foleyEvents } from "./shot-audio.mjs";
import { mouthCuesFor, visemeCues } from "./shot-lipsync.mjs";
import { renderPerformanceShot } from "./shot-render.mjs";

const fail = (message) => { throw new Error(`Performance shot failed: ${message}`); };

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

/** Spoken windows for one scene, relative to the scene's first frame. */
export function chapterSpeechWindows(chapter) {
  return Object.fromEntries((chapter.dialogue?.turns ?? []).filter(turn => Number.isSafeInteger(turn.startFrame)).map(turn =>
    [turn.id, { startFrame: turn.startFrame - chapter.startFrame, endFrame: turn.endFrame - chapter.startFrame }]));
}

/** @returns {Promise<{plan:object, assets:object[], sounds:object[], report:object[]}>} */
export async function applyPerformanceShots(plan, { shots = {}, speech = [], outputDir, signal, onProgress }, deps = {}) {
  const render = deps.renderShot ?? renderPerformanceShot;
  const mouth = deps.mouthCues ?? mouthCuesFor;
  const assets = [], sounds = [], report = [];
  const chapters = [];
  for (const chapter of plan.chapters) {
    if (!chapter.visual?.direction?.performance) { chapters.push(chapter); continue; }
    const shot = shots[chapter.id];
    if (!shot) fail(`scene ${chapter.id} asks for a 3D shot, but no staged shot was supplied`);
    const speechWindows = chapterSpeechWindows(chapter);
    const durationFrames = chapter.endFrame - chapter.startFrame;
    const intent = { ...shot.intent, durationFrames, fps: plan.manifest.fps };
    const turns = speech.find(beat => beat.id === chapter.id)?.turns ?? [];
    const lipSync = {};
    for (const turn of turns) {
      const id = turn.id.split(".").at(-1), window = speechWindows[id];
      const cues = window ? await mouth(turn.wavPath, { signal }) : null;
      if (cues) lipSync[id] = visemeCues(cues, window, plan.manifest.fps, shot.visemes?.[turn.speakerId] ?? []);
    }
    const complete = turns.length > 0 && Object.keys(lipSync).length === turns.length;
    await onProgress?.({ phase: "performance-shot", message: `Rendering the 3D shot for ${chapter.id}…` });
    const output = join(outputDir, chapter.id);
    const result = await render({ ...shot, intent, speechWindows, lipSync: complete ? lipSync : undefined, shotId: chapter.id,
      output, signal, width: plan.manifest.width, height: plan.manifest.height });
    if (result.manifest.frames !== durationFrames) fail(`scene ${chapter.id} rendered ${result.manifest.frames} frames, expected ${durationFrames}`);
    const path = join(output, "shot.mp4");
    const sha256 = await sha256File(path);
    if (sha256 !== result.manifest.video_sha256) fail(`scene ${chapter.id} video changed after render`);
    const url = `/__video_media/${sha256}.mp4`;
    const seconds = durationFrames * plan.manifest.fps.den / plan.manifest.fps.num;
    assets.push({ assetType: "video", sha256, url, path });
    for (const event of foleyEvents(result.contacts ?? [], shot.intent.materials ?? {}, plan.manifest.fps))
      sounds.push({ ...event, chapterId: chapter.id });
    report.push({ chapterId: chapter.id, sha256, profile: shot.profile, contactErrorM: result.manifest.contact_error_m,
      lipSync: complete ? "rhubarb" : "approximate cycle" });
    chapters.push({ ...chapter, visual: { ...chapter.visual,
      stockMedia: { assetType: "video", url, sha256, durationSeconds: seconds, title: chapter.id, focalPoint: { x: .5, y: .5 } },
      performanceClip: { ...(shot.label ? { label: shot.label } : {}) } } });
  }
  return { plan: { ...plan, chapters }, assets, sounds, report };
}
