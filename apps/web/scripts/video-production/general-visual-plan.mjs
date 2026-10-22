/** Pure semantic diagram plan and frame state. Narration timing remains owned by ContentGen. */
import { parseVideoProductionJob } from "./job.mjs";

const fail = (reason) => { throw new Error(`General explainer visual plan invalid: ${reason}`); };
const ease = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

export function compileGeneralVisuals(job, timeline) {
  const parsed = parseVideoProductionJob(job);
  if (!parsed.ok || job.visualFamily !== "general-explainer-v1") fail(parsed.findings?.map((f) => f.code).join(", ") || "visual family mismatch");
  if (job.destination.presetId !== "youtube" || job.destination.width !== 1920 || job.destination.height !== 1080) fail("only landscape YouTube 1920 × 1080 is supported in G1");
  if (timeline?.sampleRate !== 48000 || !Number.isSafeInteger(timeline.totalFrames) || timeline.totalFrames < 1) fail("measured 48 kHz audio timeline required");
  if (timeline.fps?.num !== job.destination.fps.num || timeline.fps?.den !== job.destination.fps.den) fail("timeline FPS mismatch");
  const minimumSeconds = Math.max(job.mode === "youtube-long" ? 480 : 0, job.destination.minimumDurationSeconds ?? 0);
  if (timeline.totalSamples < minimumSeconds * 48000) fail(`video requires ${minimumSeconds} seconds of measured narration`);
  if (!Array.isArray(timeline.beats) || timeline.beats.length !== job.beats.length) fail("narrated beat count mismatch");
  const chapters = job.beats.map((beat, index) => {
    const range = timeline.beats[index];
    if (range?.id !== beat.id) fail(`beat ${beat.id} timeline mismatch`);
    const startFrame = range.startFrame;
    const endFrame = index === job.beats.length - 1 ? timeline.totalFrames : timeline.beats[index + 1].startFrame;
    if (endFrame <= startFrame) fail(`beat ${beat.id} is too short to render`);
    return { id: beat.id, intent: beat.visualIntent, visual: structuredClone(beat.visual), startFrame, endFrame, claimRefs: [...beat.claimRefs], eventIds: [...beat.eventIds] };
  });
  const payoffEventId = job.topic.payoffEventId;
  if (timeline.eventFrames?.[payoffEventId] !== chapters.at(-1).startFrame || !chapters.at(-1).eventIds.includes(payoffEventId)) fail("payoff event must start the final payoff beat");
  return {
    schemaVersion: 1, kind: "general-explainer-visual-plan", title: job.topic.title,
    manifest: { schemaVersion: 1, id: job.id, durationFrames: timeline.totalFrames, width: 1920, height: 1080, fps: { ...job.destination.fps }, preset: "youtube" },
    chapters, events: { ...timeline.eventFrames }, payoffEventId,
    disclaimer: "UNVERIFIED EDITORIAL DRAFT · REVIEW CLAIMS AND RIGHTS",
    commercialReady: false,
  };
}

export function getGeneralFrame(plan, absoluteFrame) {
  if (!Number.isSafeInteger(absoluteFrame) || absoluteFrame < 0 || absoluteFrame >= plan?.manifest?.durationFrames) fail("frame outside visual manifest");
  const chapterIndex = plan.chapters.findIndex((chapter) => absoluteFrame >= chapter.startFrame && absoluteFrame < chapter.endFrame);
  if (chapterIndex < 0) fail("frame has no chapter");
  const chapter = plan.chapters[chapterIndex];
  const localFrame = absoluteFrame - chapter.startFrame;
  const chapterFrames = chapter.endFrame - chapter.startFrame;
  const isPayoff = chapter.intent === "general-payoff";
  const started = !isPayoff || absoluteFrame > plan.events[plan.payoffEventId];
  const revealOffset = isPayoff ? Math.max(0, absoluteFrame - plan.events[plan.payoffEventId]) : localFrame;
  const enterProgress = started ? ease(revealOffset / 24) : 0;
  const visibleItems = !started ? 0 : isPayoff
    ? (revealOffset >= 24 ? chapter.visual.items.length : 1)
    : Math.min(chapter.visual.items.length,
      1 + Math.floor(revealOffset / Math.max(1, Math.min(24, Math.floor(chapterFrames / chapter.visual.items.length)))));
  return {
    frame: absoluteFrame, chapterIndex, chapterCount: plan.chapters.length,
    intent: chapter.intent, visual: chapter.visual, visibleItems, localFrame, enterProgress,
    progress: Math.min(1, localFrame / Math.max(1, chapterFrames - 1)), disclaimer: plan.disclaimer,
  };
}
