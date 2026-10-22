/** ContentGen layout adapter for Kumiki's semantic graph/route primitives. */
import { createProcessJourney } from "@/components/motion/process-journey";
import type { ProcessJourneyPlan } from "@/components/motion/process-journey";
import type { RationalFps } from "@/components/motion/types";

export const GENERAL_JOURNEY_VIEWPORT = { width: 770, height: 640 } as const;

/** A too-short beat retains the existing still diagram instead of rushing a route. */
export function createGeneralJourney(items: readonly string[], durationFrames: number, fps: RationalFps): ProcessJourneyPlan | null {
  if (items.length < 2 || items.length > 5 || !Number.isSafeInteger(durationFrames)) return null;
  const edges = items.length - 1;
  if (durationFrames < 8 + edges * 4 + (edges - 1) * 4) return null;

  const nodeHeight = items.length >= 5 ? 84 : items.length === 4 ? 100 : 116;
  const gap = Math.min(90, Math.floor((GENERAL_JOURNEY_VIEWPORT.height - 80 - items.length * nodeHeight) / edges));
  const stackHeight = items.length * nodeHeight + edges * gap;
  const top = Math.round((GENERAL_JOURNEY_VIEWPORT.height - stackHeight) / 2);
  const nodes = items.map((label, index) => ({ id: `step-${index}`, label }));
  const graph = {
    direction: "vertical" as const,
    nodes,
    edges: Array.from({ length: edges }, (_, index) => ({
      id: `leg-${index}`, from: `step-${index}`, to: `step-${index + 1}`,
    })),
  };
  const hold = Math.min(14, Math.max(4, Math.floor(durationFrames * 0.08)));
  const handoff = Math.min(12, Math.max(4, Math.floor(durationFrames / (edges * 4 + 4))));
  const movingFrames = durationFrames - hold * 2 - (edges - 1) * handoff;
  if (movingFrames < edges * 2) return null;
  const shortLeg = Math.floor(movingFrames / edges);
  let cursor = hold;
  const route = graph.edges.map((edge, index) => {
    const legFrames = shortLeg + (index < movingFrames % edges ? 1 : 0);
    const leg = { edgeId: edge.id, startFrame: cursor, endFrame: cursor + legFrames };
    cursor = leg.endFrame + handoff;
    return leg;
  });
  return createProcessJourney({
    id: "contentgen-general-flow", subjectId: "topic-flow", graph, fps, durationFrames,
    layouts: [{ frame: 0, bounds: Object.fromEntries(nodes.map((node, index) => [
      node.id, { x: 60, y: top + index * (nodeHeight + gap), width: 650, height: nodeHeight },
    ])) }],
    route,
  });
}
