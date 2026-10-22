/** Headless-only browser entry; ContentGen serves the immutable compiled plan via loopback. */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/newsreader";
import { VideoExportStage } from "@/components/video/video-export-stage";
import type { HouseMathVisualPlan } from "../../scripts/video-production/visual-plan.mjs";
import { HouseMathExportScene } from "./house-math-scene";

function ExportApp({ plan }: { plan: HouseMathVisualPlan }) {
  const [frame, setFrame] = useState(0);
  return <VideoExportStage manifest={plan.manifest} frame={frame} onSeek={(absoluteFrame) => setFrame(absoluteFrame)}>
    <HouseMathExportScene plan={plan} frame={frame} />
  </VideoExportStage>;
}

async function boot() {
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing browser-export root");
  const response = await fetch("/__video_job", { cache: "no-store", credentials: "omit" });
  if (!response.ok) throw new Error(`Video plan is unavailable: HTTP ${response.status}`);
  const plan = await response.json() as HouseMathVisualPlan;
  if (plan?.schemaVersion !== 1 || plan.kind !== "house-math-visual-plan" ||
    plan.manifest?.schemaVersion !== 1 || plan.manifest.width !== 1920 || plan.manifest.height !== 1080 ||
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
