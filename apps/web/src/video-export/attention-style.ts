/** Layout-safe, absolute-frame sampling of upstream Kumiki attention-editing plans.
 * No user-supplied JS or CSS, audio timing guesses, external sources or private clock.
 * Source: YukiUmetsu/kumiki-ui@f0c227a58227a87004000eb2bb324ea7e298ce8a
 * registry/motion/attention-editing-recipes.ts.
 */
import { compileHookVariant, compileImpactTypography } from "./vendor/kumiki-attention-editing-recipes";
import type { GeneralVisualPlan } from "../../scripts/video-production/general-visual-plan.mjs";

type Chapter = GeneralVisualPlan["chapters"][number];
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => { const x = clamp(n); return x * x * (3 - 2 * x); };

export function compileChapterAttention(chapter: Chapter, plan: GeneralVisualPlan) {
  const frames = chapter.endFrame - chapter.startFrame;
  if (!chapter.visual.typographyStyle && !chapter.visual.hookStrategy) return null;
  const typography = chapter.visual.typographyStyle
    ? compileImpactTypography({ id: `${chapter.id}/type`, fps: plan.manifest.fps,
      durationFrames: frames, targetId: "headline", text: chapter.visual.headline,
      style: chapter.visual.typographyStyle, safeZoneId: "landscape-heading" }) : null;
  const hook = chapter.intent === "general-intro" && chapter.visual.hookStrategy
    ? compileHookVariant({ id: `${chapter.id}/hook`, fps: plan.manifest.fps,
      durationFrames: frames, strategy: chapter.visual.hookStrategy,
      claimId: chapter.claimRefs[0] ?? "editorial-unverified", payoffId: plan.payoffEventId,
      subjectIds: ["headline", "diagram"], surprise: chapter.visual.subhead }) : null;
  const diagnostics = [...(typography?.diagnostics ?? []), ...(hook?.diagnostics ?? [])];
  if (diagnostics.some(x => x.severity === "error")) {
    throw new Error("Kumiki attention recipe rejected: " + diagnostics.filter(x => x.severity === "error").map(x => x.code).join(", "));
  }
  return { typography, hook };
}

export function sampleChapterAttention(
  compiled: NonNullable<ReturnType<typeof compileChapterAttention>>,
  frame: number,
  chapterFrames: number,
  reducedMotion = false,
) {
  const entryFrames = Math.max(1, compiled.typography?.beats[0]?.endFrame ?? 8);
  const progress = smooth(frame / entryFrames);
  const style = compiled.typography?.metadata.style ?? "snap";
  const scale = reducedMotion ? 1 : style === "overshoot"
    ? 1 + Math.sin(clamp(frame / Math.max(1, entryFrames * 2)) * Math.PI) * .045
    : style === "snap" ? .93 + .07 * progress : 1;
  const revealStart = compiled.hook?.beats.find(x => x.purpose === "reveal")?.startFrame ??
    compiled.hook?.beats.find(x => x.purpose === "question")?.startFrame ?? 0;
  const hookStyle = compiled.hook?.metadata.strategy;
  const showDiagram = hookStyle !== "unexpected-reveal" || frame >= revealStart;
  const startOpacity = hookStyle === "action-first" || hookStyle === "transformation" ? .72 : .45;
  return {
    titleOpacity: reducedMotion ? 1 : startOpacity + (1 - startOpacity) * progress,
    titleScale: scale,
    wipeWidth: reducedMotion || style !== "wipe" ? 780 : Math.max(2, Math.round(780 * progress)),
    showDiagram,
    recipe: hookStyle ?? null,
    chapterFrames,
  };
}
