/** Preview the exact React scene component that Chromium captures for MP4 output.
 * Only the timeline is estimated; visuals use the ordinary renderer plan and data.
 * No TTS, browser process, FFmpeg, network, downloads, or persistent media output.
 */
import { compilePreproductionRenderJob } from "./preproduction-render-bridge.mjs";
import { buildSampleTimeline } from "./timeline.mjs";
import { compileGeneralVisuals } from "./general-visual-plan.mjs";
import { createHash } from "node:crypto";

const sha=o=>createHash("sha256").update(JSON.stringify(o)).digest("hex");
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
/** Frame-accurate editor mock timeline; NOT measured narration. */
export function estimateNarrationSamples(narration,locale="en-US",wpm=145){
  if(typeof narration!=="string"||!narration.trim()||
    !Number.isFinite(wpm)||wpm<95||wpm>210)throw Error("Invalid preview narration pace.");
  const units=locale==="ja-JP"
    ? Math.ceil([...narration.replace(/\s/gu,"")].length/2.1)
    : narration.trim().split(/\s+/u).filter(Boolean).length;
  const seconds=clamp(units*60/wpm+0.45,3,36);
  return Math.round(seconds*48000);
}
export function compileLiveVisualPreview(dossier,bundle,{spokenWpm=145}={}){
  const source=compilePreproductionRenderJob(dossier,bundle,{platform:"youtube"});
  const job=source.job;
  const timeline=buildSampleTimeline(job.beats.map(beat=>({
    id:beat.id,samples:estimateNarrationSamples(beat.narration,job.locale,spokenWpm),
    pauseAfterMs:beat.pauseAfterMs,eventIds:beat.eventIds
  })),{fps:job.destination.fps,events:job.events});
  const visualPlan=compileGeneralVisuals(job,timeline);
  if(visualPlan.chapters.length!==source.shotMap.length)throw Error("Visual preview scene count mismatch.");
  return {
    schemaVersion:1,kind:"live-renderer-preview/v1",
    plan:visualPlan,
    shotMap:source.shotMap.map((s,index)=>({...s,startFrame:visualPlan.chapters[index].startFrame,
      endFrame:visualPlan.chapters[index].endFrame})),
    sourcePlanSha256:source.sourcePlanSha256,
    renderPlanSha256:sha(visualPlan),
    timing:{basis:"estimated-text-only",spokenWpm,measuredNarration:false,
      note:"Scenes use the actual export React renderer. Durations are estimated until narration is generated; final audio can change shot boundaries."},
    visualLimits:source.warnings,
    privacy:"No narration generation, paid API request, or file export performed."
  };
}
