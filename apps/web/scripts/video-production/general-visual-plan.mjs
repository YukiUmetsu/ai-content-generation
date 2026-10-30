/** Pure semantic diagram plan and frame state. Narration timing remains owned by ContentGen. */
import { parseVideoProductionJob } from "./job.mjs";
import { motionRevealState } from "./scene-motion.mjs";
import { toFrame } from "./timeline.mjs";

const fail = (reason) => { throw new Error(`General explainer visual plan invalid: ${reason}`); };
const ease = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

/** Optional measured speech is required for mouth motion. Editor-only plans show the cast at rest. */
export function compileGeneralVisuals(job, timeline, speech) {
  const parsed = parseVideoProductionJob(job);
  if (!parsed.ok || job.visualFamily !== "general-explainer-v1") fail(parsed.findings?.map((f) => f.code).join(", ") || "visual family mismatch");
  const portrait = ["youtube-shorts", "instagram-reels", "tiktok"].includes(job.destination.presetId);
  if (!["youtube", "youtube-shorts", "instagram-reels", "tiktok"].includes(job.destination.presetId) ||
    job.destination.width !== (portrait ? 1080 : 1920) || job.destination.height !== (portrait ? 1920 : 1080)) fail("unsupported general video platform raster");
  if (timeline?.sampleRate !== 48000 || !Number.isSafeInteger(timeline.totalFrames) || timeline.totalFrames < 1) fail("measured 48 kHz audio timeline required");
  if (portrait && timeline.totalFrames * job.destination.fps.den > 180 * job.destination.fps.num) fail("portrait narration exceeds the 180-second short-form limit; shorten the script rather than cropping audio");
  if (timeline.fps?.num !== job.destination.fps.num || timeline.fps?.den !== job.destination.fps.den) fail("timeline FPS mismatch");
  const minimumSeconds = Math.max(job.mode === "youtube-long" ? 480 : 0, job.destination.minimumDurationSeconds ?? 0);
  if (timeline.totalSamples < minimumSeconds * 48000) fail(`video requires ${minimumSeconds} seconds of measured narration`);
  if (!Array.isArray(timeline.beats) || timeline.beats.length !== job.beats.length) fail("narrated beat count mismatch");
  if (speech !== undefined && (!Array.isArray(speech) || speech.length !== job.beats.length))
    fail("measured speech scene count mismatch");
  const claimsById = new Map(job.claims.map((claim) => [claim.id, claim]));
  const chapters = job.beats.map((beat, index) => {
    const range = timeline.beats[index];
    if (range?.id !== beat.id) fail(`beat ${beat.id} timeline mismatch`);
    const startFrame = range.startFrame;
    const endFrame = index === job.beats.length - 1 ? timeline.totalFrames : timeline.beats[index + 1].startFrame;
    if (endFrame <= startFrame) fail(`beat ${beat.id} is too short to render`);
    const evidenceRefs = [...new Set(beat.claimRefs.flatMap((id) => claimsById.get(id)?.sourceRefs ?? []))];
    let dialogue;
    if (beat.speechTurns) {
      const actual = speech?.[index];
      if (speech && (actual?.id !== beat.id || !Array.isArray(actual.turns) ||
        actual.turns.length !== beat.speechTurns.length || actual.samples !== range.endSample - range.startSample))
        fail(`beat ${beat.id} has mismatched measured dialogue`);
      let cursor = range.startSample;
      const turns = beat.speechTurns.map((turn, turnIndex) => {
        const measured = actual?.turns[turnIndex];
        const speaker = turn.speaker ?? { id: "narrator", role: "narrator", voiceId: job.voice.voiceId };
        if (speech && (measured?.id !== `${beat.id}.${turn.id}` ||
          measured.text !== turn.narration || measured.speakerId !== speaker.id ||
          measured.speakerRole !== speaker.role || measured.voiceId !== speaker.voiceId ||
          measured.pauseAfterMs !== turn.pauseAfterMs ||
          !Number.isSafeInteger(measured.samples) || measured.samples < 1))
          fail(`beat ${beat.id} turn ${turn.id} differs from measured voice identity or timing`);
        const timed = measured ? { startFrame: toFrame(cursor, timeline.fps),
          endFrame: toFrame(cursor + measured.samples, timeline.fps) } : {};
        if (measured) cursor += measured.samples + measured.pauseAfterMs * 48;
        return { id: turn.id, speakerId: speaker.id, role: speaker.role,
          ...(turn.animationAction?{animationAction:turn.animationAction}:{}),...timed };
      });
      if (actual && cursor !== range.endSample)
        fail(`beat ${beat.id} measured turns do not fill the scene speech range`);
      dialogue = { turns };
    } else if (speech?.[index]?.turns) fail(`beat ${beat.id} gained unexpected measured dialogue`);
    else if (beat.speaker?.role === "character") {
      // Single-speaker character scenes must also draw the performer; otherwise
      // saved Character Studio art would be pinned to a plan but never visible.
      const actual = speech?.[index];
      if (speech && (actual?.id !== beat.id || actual.text !== beat.narration ||
        actual.speakerId !== beat.speaker.id || actual.speakerRole !== "character" ||
        actual.voiceId !== beat.speaker.voiceId || !Number.isSafeInteger(actual.samples) ||
        actual.samples < 1 || actual.samples > range.endSample - range.startSample))
        fail(`beat ${beat.id} character speech differs from measured narration`);
      dialogue = { turns: [{ id: beat.id, speakerId: beat.speaker.id, role: "character",
        ...(actual ? { startFrame: toFrame(range.startSample, timeline.fps),
          endFrame: toFrame(range.startSample + actual.samples, timeline.fps) } : {}) }] };
    }
    return { id: beat.id, intent: beat.visualIntent, visual: structuredClone(beat.visual), startFrame, endFrame,
      ...(dialogue ? { dialogue } : {}),
      claimRefs: [...beat.claimRefs], evidenceRefs, eventIds: [...beat.eventIds] };
  });
  const payoffEventId = job.topic.payoffEventId;
  if (timeline.eventFrames?.[payoffEventId] !== chapters.at(-1).startFrame || !chapters.at(-1).eventIds.includes(payoffEventId)) fail("payoff event must start the final payoff beat");
  return {
    schemaVersion: 1, kind: "general-explainer-visual-plan", title: job.topic.title, locale: job.locale,
    manifest: { schemaVersion: 1, id: job.id, durationFrames: timeline.totalFrames, width: job.destination.width, height: job.destination.height, fps: { ...job.destination.fps }, preset: job.destination.presetId },
    chapters, claims: structuredClone(job.claims), evidence: structuredClone(job.evidence ?? []),
    events: { ...timeline.eventFrames }, payoffEventId,
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
  // Original frame sampling remains identical for older jobs without motion.
  // Authored controls are time-relative to measured narration in the real MP4.
  const visibleItems = chapter.visual.motion
    ? motionRevealState({frame:localFrame,frames:chapterFrames,
        itemCount:chapter.visual.items.length,intent:chapter.intent,
        motion:chapter.visual.motion}).visibleItems
    : !started ? 0 : isPayoff
      ? (revealOffset >= 24 ? chapter.visual.items.length : 1)
      : Math.min(chapter.visual.items.length,
        1 + Math.floor(revealOffset / Math.max(1, Math.min(24, Math.floor(chapterFrames / chapter.visual.items.length)))));
  return {
    frame: absoluteFrame, chapterIndex, chapterCount: plan.chapters.length,
    intent: chapter.intent, visual: chapter.visual, visibleItems, localFrame, enterProgress,
    progress: Math.min(1, localFrame / Math.max(1, chapterFrames - 1)), disclaimer: plan.disclaimer,
  };
}
