/** Composite one rendered shot and its audio through the production capture path:
 * local stage, Chromium frame capture, verified H.264 segments, and a mux.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { muxVideo } from "./produce.mjs";
import { renderVideoSegments } from "./render.mjs";
import { startLocalStageServer } from "./stage-server.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/** A one-scene plan that holds a rendered shot. */
export function singleShotPlan({ id, title, locale = "en", fps, durationFrames, width, height, url, videoSha256, label }) {
  const seconds = durationFrames * fps.den / fps.num;
  return {
    schemaVersion: 1, kind: "general-explainer-visual-plan", title, locale,
    manifest: { schemaVersion: 1, id, durationFrames, width, height, fps, preset: "youtube" },
    chapters: [{ id, intent: "general-flow", narration: "", startFrame: 0, endFrame: durationFrames, claimRefs: [], evidenceRefs: [], eventIds: ["payoff"],
      visual: { headline: title, items: [title, title], stockMedia: { assetType: "video", url, sha256: videoSha256, durationSeconds: seconds, title: id, focalPoint: { x: .5, y: .5 } },
        performanceClip: { ...(label ? { label } : {}) } } }],
    events: { payoff: 0 }, payoffEventId: "payoff", disclaimer: "",
  };
}

export async function composeShotFilm({ clipPath, audioPath, out, browserExecutable, ...plan },
{ distRoot = fileURLToPath(new URL("../../dist", import.meta.url)) } = {}) {
  const bytes = await readFile(clipPath);
  const videoSha256 = sha256(bytes), url = `/__video_media/${videoSha256}.mp4`;
  const visualPlan = singleShotPlan({ ...plan, url, videoSha256 });
  await mkdir(out, { recursive: true, mode: 0o700 });
  const stage = await startLocalStageServer({ distRoot, validatedPlan: visualPlan,
    approvedMedia: [{ assetType: "video", sha256: videoSha256, url, path: resolve(clipPath) }] });
  let render;
  try {
    render = await renderVideoSegments({ stageUrl: stage.url, manifest: visualPlan.manifest, planHash: sha256(JSON.stringify(visualPlan)),
      buildHash: stage.buildHash, outDir: join(out, "render"), browserExecutable, maxBatchFrames: 150, visualPlan });
  } finally { await stage.close(); }
  const finalPath = join(out, "final.mp4");
  await muxVideo(render.videoOnlyPath, audioPath, finalPath);
  return { finalPath, frames: render.frameCount };
}
