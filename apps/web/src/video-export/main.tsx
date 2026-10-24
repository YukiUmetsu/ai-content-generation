/** Headless-only browser entry; ContentGen serves the immutable compiled plan via loopback. */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/newsreader";
import { VideoExportStage } from "@/components/video/video-export-stage";
import type { HouseMathVisualPlan } from "../../scripts/video-production/visual-plan.mjs";
import type { GeneralVisualPlan } from "../../scripts/video-production/general-visual-plan.mjs";
import { HouseMathExportScene } from "./house-math-scene";
import { GeneralExportScene } from "./general-scene";
import { PortraitGeneralExportScene } from "./portrait-general-scene";
import { waitForChartStoryReadiness } from "./chart-story-preflight";
declare global { interface Window { __contentgenBuildHash?: string } }

/** Browser font/geometry validation; no screenshot analysis or AI vision costs. */
async function prepareVideoFrame(target: number, kind: "house-math-visual-plan" | "general-explainer-visual-plan", payoffFrame: number, portrait: boolean) {
  const start = performance.now();
  let stage: HTMLElement | null = null;
  while (performance.now() - start < 10000) {
    stage = document.querySelector<HTMLElement>("[data-km-video-capture]");
    if (stage?.dataset.frame === String(target)) break;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  if (!stage || stage.dataset.frame !== String(target)) throw new Error(`Video scene frame ${target} did not settle`);
  await document.fonts.ready;
  await waitForChartStoryReadiness(stage);
  const isHouse = kind === "house-math-visual-plan";
  const copy = stage.querySelectorAll<SVGGraphicsElement>(isHouse ? "[data-house-copy]" : "[data-general-copy]");
  if (!portrait && !copy.length && !(kind === "general-explainer-visual-plan" && target === payoffFrame)) throw new Error("Video scene has no verifiable title copy");
  if (portrait) {
    const portraitRoot = stage.querySelector<HTMLElement>("[data-portrait-general-scene]");
    if (!portraitRoot || portraitRoot.dataset.safeFrameStatus !== "ok") {
      throw new Error(`Kumiki portrait safe-area preflight failed at frame ${target}`);
    }
    for (const text of stage.querySelectorAll<SVGTextElement>("[data-portrait-copy]")) {
      const box = text.getBBox();
      if (![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
        box.width <= 0 || box.height <= 0 || box.x < 106 ||
        box.x + box.width > 942 || box.y < 195 || box.y + box.height > 1550) {
        throw new Error(`Portrait copy exceeds the authored safe frame at ${target}`);
      }
    }
    for (const group of stage.querySelectorAll<SVGGElement>("[data-portrait-node]")) {
      const rect = group.querySelector<SVGRectElement>("rect");
      if (!rect) throw new Error("Portrait diagram lacks a visible card");
      const bounds = rect.getBBox();
      for (const text of group.querySelectorAll<SVGTextElement>("text")) {
        const box = text.getBBox();
        if (![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
          box.width <= 0 || box.height <= 0 ||
          box.x < bounds.x + 22 || box.x + box.width > bounds.x + bounds.width - 12 ||
          box.y < bounds.y + 10 || box.y + box.height > bounds.y + bounds.height - 9) {
          throw new Error(`Portrait diagram text clips its card at frame ${target}`);
        }
      }
    }
    return;
  }
  for (const item of copy) {
    const box = item.getBBox();
    if (![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0 ||
      box.x < 116 || box.x + box.width > 950 || box.y < 250 || box.y + box.height > 965) {
      throw new Error(`Scene text is clipped or outside the authored column at frame ${target}`);
    }
  }
  if (!isHouse) {
    for (const item of stage.querySelectorAll<SVGGraphicsElement>("[data-general-chart-copy]")) {
      const box = item.getBBox();
      if (![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0 ||
        box.x < 1036 || box.x + box.width > 1805 || box.y < 813 || box.y + box.height > 962) {
        throw new Error(`Chart disclosure or source note is clipped at frame ${target}`);
      }
    }
    for (const diagram of stage.querySelectorAll<SVGSVGElement>("[data-km-diagram-stage]")) {
      const overlapAttr = diagram.getAttribute("data-diagram-overlaps");
      const count = Number(overlapAttr);
      if (overlapAttr === null || !Number.isSafeInteger(count) || count !== 0) {
        throw new Error(`Diagram nodes overlap at frame ${target}; correct the semantic layout before export`);
      }
    }
    for (const group of stage.querySelectorAll<SVGGElement>("[data-general-node]")) {
      const rect = group.querySelector<SVGRectElement>("rect");
      if (!rect) throw new Error("Diagram node is missing a visible frame");
      const bounds = rect.getBBox();
      const glyphBoxes = Array.from(group.querySelectorAll<SVGTextElement>("text"), (label) => label.getBBox());
      for (const box of glyphBoxes) {
        if (![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0 ||
          box.x < bounds.x + 20 || box.x + box.width > bounds.x + bounds.width - 15 ||
          box.y < bounds.y + 12 || box.y + box.height > bounds.y + bounds.height - 10) {
          throw new Error(`Diagram label is clipped at frame ${target}`);
        }
      }
      // Renderer math is only a preflight estimate. Chromium's measured glyph
      // boxes must also be disjoint on every captured frame.
      for (let i = 0; i < glyphBoxes.length; i++) {
        for (let j = i + 1; j < glyphBoxes.length; j++) {
          const a = glyphBoxes[i], b = glyphBoxes[j];
          if (a.x < b.x + b.width - 2 && b.x < a.x + a.width - 2 &&
              a.y < b.y + b.height - 2 && b.y < a.y + a.height - 2) {
            throw new Error(`Diagram title and explanation overlap at frame ${target}`);
          }
        }
      }
    }
  }
}

type ExportPlan = HouseMathVisualPlan | GeneralVisualPlan;
// eslint-disable-next-line react-refresh/only-export-components -- Dedicated headless bootstrap is not a Fast Refresh module.
function ExportApp({ plan }: { plan: ExportPlan }) {
  const [frame, setFrame] = useState(0);
  return <VideoExportStage manifest={plan.manifest} frame={frame} onSeek={(absoluteFrame) => setFrame(absoluteFrame)} prepareFrame={(target) => prepareVideoFrame(target, plan.kind, plan.events[plan.payoffEventId], plan.manifest.height > plan.manifest.width)}>
    {plan.kind === "house-math-visual-plan"
      ? <HouseMathExportScene plan={plan} frame={frame} />
      : plan.manifest.height > plan.manifest.width ? <PortraitGeneralExportScene plan={plan} frame={frame} /> : <GeneralExportScene plan={plan} frame={frame} />}
  </VideoExportStage>;
}

async function boot() {
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing browser-export root");
  const [response, buildResponse] = await Promise.all([
    fetch("/__video_job", { cache: "no-store", credentials: "omit" }),
    fetch("/__video_build", { cache: "no-store", credentials: "omit" }),
  ]);
  if (!response.ok) throw new Error(`Video plan is unavailable: HTTP ${response.status}`);
  if (!buildResponse.ok) throw new Error(`Video build fingerprint is unavailable: HTTP ${buildResponse.status}`);
  const build = await buildResponse.json() as { sha256?: string };
  if (!/^[a-f0-9]{64}$/i.test(build.sha256 ?? "")) throw new Error("Video build handshake returned an invalid fingerprint");
  window.__contentgenBuildHash = build.sha256;
  const plan = await response.json() as ExportPlan;
  if (plan?.schemaVersion !== 1 || !["house-math-visual-plan", "general-explainer-visual-plan"].includes(plan.kind) ||
    plan.manifest?.schemaVersion !== 1 || !(plan.manifest.width === 1920 && plan.manifest.height === 1080 ||
       plan.kind === "general-explainer-visual-plan" && plan.manifest.width === 1080 && plan.manifest.height === 1920 &&
       ["youtube-shorts","instagram-reels","tiktok"].includes(plan.manifest.preset)) ||
    !Number.isSafeInteger(plan.manifest.durationFrames) || plan.manifest.durationFrames < 1 ||
    !Array.isArray(plan.chapters) || plan.chapters.length === 0 ||
    typeof plan.events?.[plan.payoffEventId] !== "number") {
    throw new Error("Video plan has an unsupported or incomplete scene contract");
  }
  createRoot(root).render(<ExportApp plan={plan} />);
}

boot().catch((error: unknown) => {
  const root = document.getElementById("root");
  if (root) {
    root.setAttribute("role", "alert");
    root.setAttribute("data-km-explainer-fallback", "");
    root.textContent = error instanceof Error ? error.message : "Video export boot failed";
    root.style.cssText = "color:#eee;padding:40px;font:24px system-ui";
  }
});
