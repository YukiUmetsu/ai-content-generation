/** Export page scene for a kanji study short: Kumiki's `shodo-kanji-card`, driven frame by frame.
 * The plan carries the glyph, so the page loads nothing and plans the same strokes as Node did.
 */
import { useRef, useState } from "react";
import { VideoExportStage } from "@/components/video/video-export-stage";
import { ShodoKanjiCard } from "@/components/video/shodo/shodo-kanji-card";
import { sameStrokes, shodoCanvasesReady } from "./kanji-plan";
import type { KanjiStudyVisualPlan } from "./kanji-plan";

const nextPaint = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

/**
 * A frame is ready when the card shows it, its canvases are ready and no card text is cut.
 * It fails when the card plans other strokes than the ones the narration was timed to.
 */
async function prepareKanjiFrame(root: HTMLElement | null, target: number, plan: KanjiStudyVisualPlan) {
  const start = performance.now();
  for (;;) {
    const card = root?.querySelector<HTMLElement>("[data-km-kanji-card]");
    if (card?.dataset.kmKanjiFrame === String(target) && shodoCanvasesReady(root)) break;
    if (performance.now() - start > 15000) throw new Error(`The kanji card did not reach frame ${target}.`);
    await nextPaint();
  }
  await document.fonts.ready;
  const card = root?.querySelector<HTMLElement>("[data-km-kanji-card]");
  let drawn: unknown = null;
  try { drawn = JSON.parse(card?.dataset.kmStrokeTimes ?? "null"); } catch { drawn = null; }
  if (!sameStrokes(drawn, plan.strokes)) throw new Error("The card plans other brush strokes than the narration was timed to; rebuild (pnpm build) and render again.");
  const info = root?.querySelector<HTMLElement>("aside[data-km-kanji-density]");
  if (info?.dataset.kmOverflow === "true") throw new Error(`The reading card's text does not fit at frame ${target}.`);
}

export function KanjiStudyExport({ plan }: { plan: KanjiStudyVisualPlan }) {
  const [frame, setFrame] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  return <div ref={root}>
    <VideoExportStage manifest={plan.manifest} frame={frame} onSeek={setFrame} prepareFrame={target => prepareKanjiFrame(root.current, target, plan)}>
      <ShodoKanjiCard {...plan.card} frame={frame} pixelRatio={plan.manifest.width / 720} />
    </VideoExportStage>
  </div>;
}
