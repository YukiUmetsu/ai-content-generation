import { forwardRef, useId, useMemo } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import type { DiagramSpec } from "../infographic/types";
import type { MotionTimeline } from "./types";
import { evaluateDiagramStage } from "./diagram-stage";
import type { DiagramEdgePorts, DiagramNodeSample, DiagramPacket, DiagramPacketSample } from "./diagram-stage";
import { usePrefersReducedMotion } from "./react";

export interface DiagramStageTheme {
  surface: string;
  node: string;
  ink: string;
  mutedInk: string;
  edge: string;
  accent: string;
  packet: string;
  reversePacket: string;
  fontFamily: string;
  fontSize: number;
  radius: number;
  strokeWidth: number;
}

const DEFAULT_THEME: DiagramStageTheme = {
  surface: "var(--km-surface-default, #ffffff)", node: "var(--km-surface-elevated, #f4f5f7)",
  ink: "var(--km-text-primary, #202936)", mutedInk: "var(--km-text-secondary, #526174)",
  edge: "var(--km-border-strong, #748399)", accent: "var(--km-action-primary, #365d91)",
  packet: "var(--km-action-primary, #365d91)", reversePacket: "var(--km-text-primary, #202936)",
  fontFamily: "inherit", fontSize: 22, radius: 18, strokeWidth: 2,
};

export interface DiagramStageProps extends Omit<ComponentPropsWithoutRef<"svg">, "width" | "height" | "children"> {
  graph: DiagramSpec;
  timeline: MotionTimeline;
  frame: number;
  width: number;
  height: number;
  ports?: Record<string, DiagramEdgePorts>;
  packets?: readonly DiagramPacket[];
  focusedNodeIds?: readonly string[];
  theme?: Partial<DiagramStageTheme>;
  renderNode?: (sample: DiagramNodeSample & { focused: boolean; theme: DiagramStageTheme }) => ReactNode;
  renderPacket?: (sample: DiagramPacketSample & { theme: DiagramStageTheme }) => ReactNode;
  overlay?: ReactNode;
  ariaLabel: string;
  reducedMotion?: boolean;
}

/** Frame-driven graph rendering with attached routes and shared semantic identity. */
export const DiagramStage = forwardRef<SVGSVGElement, DiagramStageProps>(function DiagramStage({
  graph, timeline, frame, width, height, ports, packets, focusedNodeIds = [], theme: themeOverrides,
  renderNode, renderPacket, overlay, ariaLabel, reducedMotion, style, ...props
}, ref) {
  const prefersReduced = usePrefersReducedMotion();
  const resolvedFrame = (reducedMotion ?? prefersReduced) ? timeline.durationFrames - 1 : frame;
  const sample = useMemo(() => evaluateDiagramStage(graph, timeline, resolvedFrame, { ports, packets }), [graph, timeline, resolvedFrame, ports, packets]);
  const theme = { ...DEFAULT_THEME, ...themeOverrides };
  const markerId = useId().replace(/:/g, "-");
  const descriptionId = `${markerId}-description`;
  if (![width, height, theme.fontSize, theme.strokeWidth].every((value) => Number.isFinite(value) && value > 0) || !Number.isFinite(theme.radius) || theme.radius < 0) {
    throw new Error("DiagramStage needs positive output dimensions, font size and stroke width, and a nonnegative corner radius.");
  }
  const description = [
    ...graph.nodes.map((node) => `${node.label}${node.description ? `: ${node.description}` : ""}.`),
    ...graph.edges.map((edge) => `${graph.nodes.find((node) => node.id === edge.from)?.label} ${edge.directed === false ? "connects with" : "connects to"} ${graph.nodes.find((node) => node.id === edge.to)?.label}${edge.label ? ` (${edge.label})` : ""}.`),
  ].join(" ");
  return <svg ref={ref} role="img" aria-label={ariaLabel} aria-describedby={descriptionId} viewBox={`0 0 ${width} ${height}`}
    data-km-diagram-stage="" data-diagram-overlaps={sample.overlaps.length}
    style={{ display: "block", width: "100%", aspectRatio: `${width}/${height}`, background: theme.surface, ...style }} {...props}>
    <desc id={descriptionId}>{description}</desc>
    <defs><marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 1 1 L 9 5 L 1 9" fill="none" stroke={theme.edge} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></marker></defs>
    <g aria-hidden="true" fontFamily={theme.fontFamily}>
      {sample.edges.map(({ edge, svg, labelPosition }) => <g key={edge.id} data-diagram-edge={edge.id}>
        <path d={svg} fill="none" stroke={theme.edge} strokeWidth={theme.strokeWidth} markerEnd={edge.directed === false ? undefined : `url(#${markerId})`} />
        {edge.label ? <text x={labelPosition.x} y={labelPosition.y - 14} textAnchor="middle" fontSize={theme.fontSize * 0.72} fill={theme.mutedInk} stroke={theme.surface} strokeWidth="6" paintOrder="stroke">{edge.label}</text> : null}
      </g>)}
      {sample.nodes.map((nodeSample) => {
        const { node, bounds } = nodeSample;
        const focused = focusedNodeIds.includes(node.id);
        return <g key={node.id} data-diagram-node={node.id} transform={`translate(${bounds.x} ${bounds.y})`}>
          {renderNode ? renderNode({ ...nodeSample, focused, theme }) : <>
            {focused ? <rect x="-6" y="-6" width={bounds.width + 12} height={bounds.height + 12} rx={theme.radius + 5} fill="none" stroke={theme.accent} strokeWidth={theme.strokeWidth} opacity="0.4" /> : null}
            <rect width={bounds.width} height={bounds.height} rx={theme.radius} fill={theme.node} stroke={focused ? theme.accent : theme.edge} strokeWidth={focused ? theme.strokeWidth * 1.5 : theme.strokeWidth} />
            <foreignObject x="14" y="10" width={Math.max(1, bounds.width - 28)} height={Math.max(1, bounds.height - 20)}>
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", overflowWrap: "anywhere", fontFamily: theme.fontFamily, fontSize: theme.fontSize, lineHeight: 1.25, color: theme.ink }}>{node.label}</div>
            </foreignObject>
          </>}
        </g>;
      })}
      {sample.packets.map((packetSample) => <g key={packetSample.packet.id} data-diagram-packet={packetSample.packet.id} transform={`translate(${packetSample.position.x} ${packetSample.position.y})`}>
        {renderPacket ? renderPacket({ ...packetSample, theme }) : <>
          <circle r="9" fill={packetSample.packet.direction === "reverse" ? theme.reversePacket : theme.packet} stroke={theme.surface} strokeWidth="3" />
          {packetSample.packet.label ? <text y="-18" textAnchor="middle" fontSize={theme.fontSize * 0.7} fill={theme.ink} stroke={theme.surface} strokeWidth="5" paintOrder="stroke">{packetSample.packet.label}</text> : null}
        </>}
      </g>)}
      {overlay}
    </g>
  </svg>;
});
