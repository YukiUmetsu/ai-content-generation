import type { DiagramSpec, DiagramNode, DiagramEdge } from "../infographic/types";
import type { EasingSpec, FrameRange, MotionTimeline, RationalFps, Rect, Vec2 } from "./types";
import type { MotionPath } from "./paths";
import { pathToSvgD, pointOnPath } from "./paths";
import { evaluateTimeline, outputKey } from "./timeline";

export interface DiagramLayoutKeyframe {
  frame: number;
  /** Every semantic node has an authored box at every layout keyframe. */
  bounds: Record<string, Rect>;
  easing?: EasingSpec;
  cut?: boolean;
}

export interface DiagramTimelineOptions {
  id: string;
  graph: DiagramSpec;
  fps: RationalFps;
  durationFrames: number;
  layouts: readonly DiagramLayoutKeyframe[];
}

export interface DiagramPort { side: "left" | "right" | "top" | "bottom"; offset?: number }
export interface DiagramEdgePorts { from?: DiagramPort; to?: DiagramPort; curvature?: number }
export interface DiagramPacket {
  id: string;
  edgeId: string;
  range: FrameRange;
  direction?: "forward" | "reverse";
  label?: string;
}
export interface DiagramNodeSample { node: DiagramNode; bounds: Rect }
export interface DiagramEdgeSample { edge: DiagramEdge; path: MotionPath; svg: string; labelPosition: Vec2 }
export interface DiagramPacketSample { packet: DiagramPacket; position: Vec2; progress: number }
export interface DiagramStageSample {
  nodes: DiagramNodeSample[];
  edges: DiagramEdgeSample[];
  packets: DiagramPacketSample[];
  overlaps: Array<{ firstId: string; secondId: string }>;
}

const PROPERTIES = ["x", "y", "width", "height"] as const;

/** Compile layout changes into existing numeric MG1 tracks; IDs never change on reflow. */
export function createDiagramTimeline({ id, graph, fps, durationFrames, layouts }: DiagramTimelineOptions): MotionTimeline {
  if (!id.trim() || !Number.isInteger(durationFrames) || durationFrames < 1 ||
      !Number.isInteger(fps.num) || !Number.isInteger(fps.den) || fps.num <= 0 || fps.den <= 0) {
    throw new Error("Cannot create diagram motion. Supply an ID, positive integer duration, and positive integer rational FPS.");
  }
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  if (nodeIds.size !== graph.nodes.length || graph.nodes.some((node) => !node.id.trim() || !node.label.trim())) {
    throw new Error("Diagram nodes need unique non-empty IDs and labels. Keep these IDs stable between layouts.");
  }
  const edgeIds = new Set<string>();
  for (const edge of graph.edges) {
    if (!edge.id.trim() || edgeIds.has(edge.id) || !nodeIds.has(edge.from) || !nodeIds.has(edge.to) || edge.from === edge.to) {
      throw new Error(`Diagram edge "${edge.id}" is invalid. Use a unique ID and two distinct existing node IDs; self-loops need a separate authored route.`);
    }
    edgeIds.add(edge.id);
  }
  if (!layouts.length || layouts[0].frame !== 0) throw new Error("A diagram needs an initial layout at frame 0.");
  for (let index = 0; index < layouts.length; index++) {
    const layout = layouts[index];
    if (!Number.isInteger(layout.frame) || layout.frame < 0 || layout.frame >= durationFrames ||
        (index > 0 && layout.frame <= layouts[index - 1].frame)) {
      throw new Error(`Diagram layout ${index} needs a unique ascending integer frame inside the composition.`);
    }
    for (const node of graph.nodes) {
      const box = layout.bounds[node.id];
      if (!box || !PROPERTIES.every((key) => Number.isFinite(box[key])) || box.width <= 0 || box.height <= 0) {
        throw new Error(`Diagram layout ${index} is missing valid bounds for "${node.id}". Supply finite x/y and positive width/height.`);
      }
    }
    for (const suppliedId of Object.keys(layout.bounds)) {
      if (!nodeIds.has(suppliedId)) throw new Error(`Diagram layout ${index} references unknown node "${suppliedId}". Reuse an ID from the graph.`);
    }
  }
  return {
    schemaVersion: 1, id, fps: { ...fps }, durationFrames,
    nodes: graph.nodes.flatMap((node) => PROPERTIES.map((property) => ({
      kind: "track" as const, id: `${node.id}-diagram-${property}`,
      track: {
        id: `${node.id}-diagram-${property}`, targetId: node.id, property: `diagram-${property}`, valueType: "number" as const,
        keyframes: layouts.map((layout) => ({ frame: layout.frame, value: layout.bounds[node.id][property], easing: layout.cut ? "step-end" as const : layout.easing ?? "ease-in-out-cubic" })),
      },
    }))),
  };
}

function resolvePort(box: Rect, port: DiagramPort): { point: Vec2; normal: Vec2 } {
  const fraction = port.offset ?? 0.5;
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) throw new Error("Diagram port offsets must be finite fractions from 0 to 1.");
  switch (port.side) {
    case "left": return { point: { x: box.x, y: box.y + box.height * fraction }, normal: { x: -1, y: 0 } };
    case "right": return { point: { x: box.x + box.width, y: box.y + box.height * fraction }, normal: { x: 1, y: 0 } };
    case "top": return { point: { x: box.x + box.width * fraction, y: box.y }, normal: { x: 0, y: -1 } };
    case "bottom": return { point: { x: box.x + box.width * fraction, y: box.y + box.height }, normal: { x: 0, y: 1 } };
  }
}

/** Recompute attached geometry from current node bounds, then place packets by arc length. */
export function evaluateDiagramStage(
  graph: DiagramSpec, timeline: MotionTimeline, frame: number,
  options: { ports?: Record<string, DiagramEdgePorts>; packets?: readonly DiagramPacket[] } = {},
): DiagramStageSample {
  if (!Number.isInteger(frame)) throw new Error("DiagramStage requires a finite integer frame.");
  const resolvedFrame = Math.max(0, Math.min(timeline.durationFrames - 1, frame));
  const evaluation = evaluateTimeline(timeline, resolvedFrame);
  const nodes = graph.nodes.map((node): DiagramNodeSample => {
    const values = PROPERTIES.map((property) => evaluation.samples[outputKey(node.id, `diagram-${property}`)]?.value);
    if (!values.every((value) => typeof value === "number" && Number.isFinite(value)) || Number(values[2]) <= 0 || Number(values[3]) <= 0) {
      throw new Error(`Cannot position diagram node "${node.id}" at frame ${frame}. Use createDiagramTimeline with complete positive bounds.`);
    }
    const [x, y, width, height] = values as number[];
    return { node, bounds: { x, y, width, height } };
  });
  const byId = new Map(nodes.map((node) => [node.node.id, node.bounds]));
  const edges = graph.edges.map((edge): DiagramEdgeSample => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) throw new Error(`Cannot route edge "${edge.id}". Its source and destination must exist in the diagram.`);
    // Keep port ownership stable while nodes move. Inferring the nearest side
    // every frame makes connectors jump when a diagonal crosses an axis.
    const horizontal = graph.direction === "horizontal";
    const authored = options.ports?.[edge.id];
    const source = resolvePort(from, authored?.from ?? { side: horizontal ? "right" : "bottom" });
    const destination = resolvePort(to, authored?.to ?? { side: horizontal ? "left" : "top" });
    const curvature = authored?.curvature ?? 0.45;
    if (!Number.isFinite(curvature) || curvature < 0 || curvature > 2) throw new Error(`Edge "${edge.id}" needs curvature from 0 to 2.`);
    const reach = Math.max(24, Math.hypot(destination.point.x - source.point.x, destination.point.y - source.point.y) * curvature);
    const path: MotionPath = {
      id: edge.id, kind: "cubic", closed: false,
      anchors: [
        { ...source.point, out: { x: source.point.x + source.normal.x * reach, y: source.point.y + source.normal.y * reach } },
        { ...destination.point, in: { x: destination.point.x + destination.normal.x * reach, y: destination.point.y + destination.normal.y * reach } },
      ],
    };
    return { edge, path, svg: pathToSvgD(path), labelPosition: pointOnPath(path, 0.5, { arcLength: true }) };
  });
  const edgeById = new Map(edges.map((edge) => [edge.edge.id, edge]));
  const packetIds = new Set<string>();
  const packets: DiagramPacketSample[] = [];
  for (const packet of options.packets ?? []) {
    const edge = edgeById.get(packet.edgeId);
    const { startFrame, endFrame } = packet.range;
    if (!packet.id.trim() || packetIds.has(packet.id) || !edge || !Number.isInteger(startFrame) || !Number.isInteger(endFrame) ||
        startFrame < 0 || endFrame - startFrame < 2 || endFrame > timeline.durationFrames) {
      throw new Error(`Packet "${packet.id}" needs a unique ID, an existing edge, and an end-exclusive frame range of at least two frames inside the composition.`);
    }
    packetIds.add(packet.id);
    if (resolvedFrame < startFrame || resolvedFrame >= endFrame) continue;
    const progress = (resolvedFrame - startFrame) / (endFrame - startFrame - 1);
    const position = pointOnPath(edge.path, packet.direction === "reverse" ? 1 - progress : progress, { arcLength: true });
    packets.push({ packet, position, progress });
  }
  const overlaps: DiagramStageSample["overlaps"] = [];
  for (let first = 0; first < nodes.length; first++) for (let second = first + 1; second < nodes.length; second++) {
    const a = nodes[first].bounds; const b = nodes[second].bounds;
    if (a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y) {
      overlaps.push({ firstId: nodes[first].node.id, secondId: nodes[second].node.id });
    }
  }
  return { nodes, edges, packets, overlaps };
}
