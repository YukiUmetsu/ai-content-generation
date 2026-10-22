/**
 * ProcessJourney (PJ1): a renderer-neutral route choreography recipe.
 *
 * Reuses DiagramStage's layout/path evaluator and MG1 camera tracks. It owns
 * no animation clock, renderer, audio, narration or content-specific vocabulary.
 */
import type { DiagramSpec } from "../infographic/types";
import type { DiagramEdgePorts, DiagramLayoutKeyframe, DiagramStageSample } from "./diagram-stage";
import { createDiagramTimeline, evaluateDiagramStage } from "./diagram-stage";
import { createCameraTimeline } from "./camera";
import { interpolateValue } from "./interpolate";
import { pointOnPath } from "./paths";
import type { MotionTimeline, RationalFps, Vec2 } from "./types";

export interface ProcessJourneyLeg {
  /** Existing graph edge ID; consecutive legs must meet at the same node. */
  edgeId: string;
  /** Inclusive first travel frame in the enclosing composition. */
  startFrame: number;
  /** Exclusive end of travel. Leaves a final arrival/hold interval. */
  endFrame: number;
  /** Reverse traversal is only legal on an undirected edge. */
  direction?: "forward" | "reverse";
}

export interface ProcessJourneyCameraOptions {
  /** Dimensions are output pixels; positions remain in diagram design pixels. */
  viewport: { width: number; height: number };
  /** Output pixels per world unit. @default 1.25 */
  zoom?: number;
  /** Look ahead to the subject's future position, without lag. @default 0 */
  leadFrames?: number;
  /** Camera samples are baked into existing MG1 keyframes. @default 4 */
  sampleEveryFrames?: number;
}

export interface ProcessJourneyOptions {
  id: string;
  graph: DiagramSpec;
  fps: RationalFps;
  durationFrames: number;
  /** An existing DiagramStage layout: each keyframe supplies every node's bounds. */
  layouts: readonly DiagramLayoutKeyframe[];
  /** Ordered legs of one semantic subject, with positive handoff intervals. */
  route: readonly ProcessJourneyLeg[];
  /** Stable name for the traveling subject, independent of the active edge. */
  subjectId: string;
  ports?: Record<string, DiagramEdgePorts>;
  /** Omit to leave camera planning to the consumer. */
  camera?: ProcessJourneyCameraOptions;
}

export type ProcessJourneyPhase = "ready" | "moving" | "handoff" | "arrived";
export interface ProcessJourneyFrame {
  frame: number;
  subjectId: string;
  position: Vec2;
  phase: ProcessJourneyPhase;
  /** Stage ID that owns the subject when not traversing an edge. */
  currentNodeId: string;
  activeEdgeId?: string;
  focusedNodeIds: string[];
  /** 0..1 progress during one edge traversal, otherwise undefined. */
  progress?: number;
  /** Existing DiagramStage display list: reusable for SVG, canvas or QA. */
  diagram: DiagramStageSample;
}

export interface ProcessJourneyPlan {
  id: string;
  graph: DiagramSpec;
  subjectId: string;
  fps: RationalFps;
  durationFrames: number;
  route: ProcessJourneyLeg[];
  ports?: Record<string, DiagramEdgePorts>;
  /** Same MG1 timeline expected by DiagramStage. */
  diagramTimeline: MotionTimeline;
  /** Optional MG1 camera timeline for CameraStage. */
  cameraTimeline?: MotionTimeline;
  cameraViewport?: { width: number; height: number };
}

function ends(graph: DiagramSpec, leg: ProcessJourneyLeg): { from: string; to: string } {
  const edge = graph.edges.find(item => item.id === leg.edgeId);
  if (!edge) throw Error('ProcessJourney refers to missing edge "' + leg.edgeId + '".');
  if (leg.direction === "reverse") {
    if (edge.directed !== false) throw Error('ProcessJourney cannot reverse directed edge "' + leg.edgeId + '".');
    return { from: edge.to, to: edge.from };
  }
  return { from: edge.from, to: edge.to };
}

function center(nodeId: string, diagram: DiagramStageSample): Vec2 {
  const node = diagram.nodes.find(item => item.node.id === nodeId);
  if (!node) throw Error('ProcessJourney cannot find node "' + nodeId + '".');
  return { x: node.bounds.x + node.bounds.width / 2, y: node.bounds.y + node.bounds.height / 2 };
}

function portPosition(leg: ProcessJourneyLeg, diagram: DiagramStageSample, end: "start" | "end"): Vec2 {
  const route = diagram.edges.find(item => item.edge.id === leg.edgeId);
  if (!route) throw Error('ProcessJourney cannot resolve route "' + leg.edgeId + '".');
  const reverse = leg.direction === "reverse";
  const progress = end === "start" ? (reverse ? 1 : 0) : (reverse ? 0 : 1);
  return pointOnPath(route.path, progress, { arcLength: true });
}

function blend(a: Vec2, b: Vec2, t: number): Vec2 {
  return interpolateValue("vec2", a, b, Math.min(1, Math.max(0, t))) as Vec2;
}

/**
 * Deterministic random-access evaluation.
 * While dwelling at a junction, the same subject passes through the node's
 * center instead of teleporting between its incoming/outgoing ports.
 */
export function evaluateProcessJourney(plan: ProcessJourneyPlan, frame: number): ProcessJourneyFrame {
  if (!Number.isSafeInteger(frame)) throw Error("ProcessJourney requires an integer frame.");
  const at = Math.min(plan.durationFrames - 1, Math.max(0, frame));
  const diagram = evaluateDiagramStage(plan.graph, plan.diagramTimeline, at, { ports: plan.ports });
  const first = plan.route[0], last = plan.route[plan.route.length - 1];
  const origin = ends(plan.graph, first).from;
  const destination = ends(plan.graph, last).to;
  const base = { frame: at, subjectId: plan.subjectId, diagram };
  if (at < first.startFrame) return {
    ...base, position: portPosition(first, diagram, "start"),
    currentNodeId: origin, phase: "ready", focusedNodeIds: [origin],
  };
  for (let index = 0; index < plan.route.length; index++) {
    const leg = plan.route[index];
    const { from, to } = ends(plan.graph, leg);
    if (at >= leg.startFrame && at < leg.endFrame) {
      const progress = (at - leg.startFrame) / (leg.endFrame - leg.startFrame - 1);
      const route = diagram.edges.find(item => item.edge.id === leg.edgeId)!;
      const along = leg.direction === "reverse" ? 1 - progress : progress;
      return {
        ...base, position: pointOnPath(route.path, along, { arcLength: true }),
        currentNodeId: from, phase: "moving", activeEdgeId: leg.edgeId,
        focusedNodeIds: [from, to], progress,
      };
    }
    const next = plan.route[index + 1];
    if (next && at >= leg.endFrame && at < next.startFrame) {
      const gap = next.startFrame - leg.endFrame;
      const progress = (at - leg.endFrame + 1) / (gap + 1);
      const incoming = portPosition(leg, diagram, "end");
      const outgoing = portPosition(next, diagram, "start");
      const midpoint = center(to, diagram);
      // 30% arrival, a 40% readable hold, 30% departure.
      const position = progress < .3
        ? blend(incoming, midpoint, progress / .3)
        : progress <= .7 ? midpoint
          : blend(midpoint, outgoing, (progress - .7) / .3);
      return { ...base, position, currentNodeId: to,
        phase: "handoff", focusedNodeIds: [to] };
    }
  }
  return {
    ...base, position: portPosition(last, diagram, "end"),
    currentNodeId: destination, phase: "arrived", focusedNodeIds: [destination],
  };
}

/**
 * Produce reusable DiagramStage inputs and optional camera tracks. No renderer,
 * network call, playback state or separate timeline engine is introduced.
 */
export function createProcessJourney(spec: ProcessJourneyOptions): ProcessJourneyPlan {
  if (!spec.id?.trim() || !spec.subjectId?.trim()) {
    throw Error("ProcessJourney needs nonempty id and subjectId.");
  }
  if (!Array.isArray(spec.route) || !spec.route.length)
    throw Error("ProcessJourney needs at least one route leg.");
  if (!Number.isSafeInteger(spec.durationFrames) || spec.durationFrames < 4)
    throw Error("ProcessJourney needs at least four composition frames.");
  // Copy author data so subsequent caller changes cannot change an existing plan.
  const graph: DiagramSpec = {
    ...spec.graph,
    nodes: spec.graph.nodes.map(node => ({ ...node })),
    edges: spec.graph.edges.map(edge => ({ ...edge })),
  };
  const route = spec.route.map(leg => ({ ...leg }));
  const ports = spec.ports ? Object.fromEntries(Object.entries(spec.ports).map(
    ([id, port]) => [id, { ...port, from: port.from && { ...port.from }, to: port.to && { ...port.to } }],
  )) : undefined;
  const layouts = spec.layouts.map(layout => ({
    ...layout, bounds: Object.fromEntries(Object.entries(layout.bounds).map(
      ([id, box]) => [id, { ...box }],
    )),
  }));
  const diagramTimeline = createDiagramTimeline({
    id: spec.id + "-diagram", graph, fps: spec.fps,
    durationFrames: spec.durationFrames, layouts,
  });
  const edgeIds = new Set<string>();
  for (const [index, leg] of route.entries()) {
    if (!leg.edgeId?.trim() || !Number.isSafeInteger(leg.startFrame) ||
      !Number.isSafeInteger(leg.endFrame) || leg.startFrame < 0 ||
      leg.endFrame - leg.startFrame < 2 || leg.endFrame > spec.durationFrames - 2 ||
      (leg.direction !== undefined && leg.direction !== "forward" && leg.direction !== "reverse")) {
      throw Error("ProcessJourney leg " + index + " needs a valid edge, integer [start,end) range of >=2 frames, and >=2 final arrival frames.");
    }
    if (edgeIds.has(leg.edgeId))
      throw Error("ProcessJourney requires unique edge IDs per journey. Split repeated visits into a separately authored route.");
    edgeIds.add(leg.edgeId);
    const path = ends(graph, leg);
    if (index) {
      const previous = route[index - 1];
      if (leg.startFrame - previous.endFrame < 2)
        throw Error("ProcessJourney needs at least two handoff frames between consecutive legs.");
      if (ends(graph, previous).to !== path.from)
        throw Error("ProcessJourney legs are disconnected at \"" + leg.edgeId + "\".");
    }
  }
  // Port geometry is validated by the existing DiagramStage evaluator.
  const plan: ProcessJourneyPlan = {
    id: spec.id, graph, subjectId: spec.subjectId, fps: { ...spec.fps },
    durationFrames: spec.durationFrames, route, ports, diagramTimeline,
  };
  evaluateProcessJourney(plan, 0);
  evaluateProcessJourney(plan, spec.durationFrames - 1);
  if (spec.camera) {
    const { viewport, zoom = 1.25, leadFrames = 0, sampleEveryFrames = 4 } = spec.camera;
    if (!viewport || !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) ||
      viewport.width <= 0 || viewport.height <= 0 ||
      !Number.isFinite(zoom) || zoom <= 0 ||
      !Number.isSafeInteger(leadFrames) || leadFrames < 0 ||
      !Number.isSafeInteger(sampleEveryFrames) || sampleEveryFrames < 1) {
      throw Error("ProcessJourney camera requires positive viewport/zoom, nonnegative integer leadFrames and positive integer sampleEveryFrames.");
    }
    const frames = new Set<number>([0, spec.durationFrames - 1]);
    for (let f = 0; f < spec.durationFrames; f += sampleEveryFrames) frames.add(f);
    for (const leg of route) for (const f of [leg.startFrame, leg.endFrame - 1, leg.endFrame])
      if (f >= 0 && f < spec.durationFrames) frames.add(f);
    if (frames.size > 3000) throw Error("ProcessJourney camera has over 3000 samples; increase sampleEveryFrames.");
    const keyframes = [...frames].sort((a, b) => a - b).map(f => ({
      frame: f,
      center: evaluateProcessJourney(plan, Math.min(spec.durationFrames - 1, f + leadFrames)).position,
      zoom,
      easing: "linear" as const,
    }));
    plan.cameraViewport = { ...viewport };
    plan.cameraTimeline = createCameraTimeline({
      id: spec.id + "-camera", fps: spec.fps,
      durationFrames: spec.durationFrames, keyframes,
    });
  }
  return plan;
}
