/**
 * Graphic composition renderer — a deterministic, frame-driven SVG scene that
 * turns a MG1 timeline into a coordinated geometric diagram reveal.
 *
 * The component is a pure function of its `frame` prop. It reads the timeline
 * samples produced by `evaluateTimeline` and renders them as overlapping SVG
 * layers: a path-driven data route, a traveling packet, staggered stations, a
 * shape morph in a masked detail panel, and a pulsing end-state accent. All
 * motion is evaluated from the integer frame; the only clock lives in the
 * parent scrubber.
 *
 * The renderer is intentionally abstract and anonymous: no product names,
 * industry copy, brand palettes or consumer-specific shapes.
 */

import { useId, useMemo } from "react";
import type { ComponentPropsWithoutRef, CSSProperties } from "react";

import type { MotionSample, MotionTimeline, Vec2 } from "./types";
import { evaluateTimeline, outputKey } from "./timeline";
import type { MaskSpecLocal } from "./masks";
import { evaluateMask } from "./masks";
import type { ContourShape, PathContour } from "./morph";
import { morphShapes } from "./morph";
import type { MotionPath } from "./paths";
import { pathToSvgD, samplePath } from "./paths";
import type { PathTrimSpec } from "./trim";
import { trimPath } from "./trim";
import { applyMatrixToPoint, composeMatrix } from "./matrix";
import { springValue } from "./springs";
import { usePrefersReducedMotion } from "./react";
import { SvgMaskDefinition } from "./svg-mask";

/* -------------------------------------------------------------------------- *
 * Layout constants (1920 × 1080 design-px space, docs/07 shared contracts)
 * -------------------------------------------------------------------------- */

const VIEWBOX = { width: 1920, height: 1080 };
const SAMPLES_PER_SEGMENT = 16;

/** A slight vertical squash applied to the route for a subtle perspective. */
const ROUTE_MATRIX = composeMatrix({
  scale: { x: 1, y: 0.9 },
  origin: { x: VIEWBOX.width / 2, y: VIEWBOX.height / 2 },
});

const STATION_POP_SPRING = { mass: 1, stiffness: 220, damping: 16 };
const PACKET_POP_SPRING = { mass: 1, stiffness: 120, damping: 14 };

/* -------------------------------------------------------------------------- *
 * Utilities
 * -------------------------------------------------------------------------- */

function cx(...classes: Array<string | false | undefined | null>): string {
  return classes.filter(Boolean).join(" ");
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function readDiscrete<T>(
  samples: Record<string, MotionSample>,
  targetId: string,
  property: string,
): T | null {
  const sample = samples[outputKey(targetId, property)];
  if (!sample) return null;
  return sample.value as unknown as T;
}

function readNumber(
  samples: Record<string, MotionSample>,
  targetId: string,
  property: string,
): number | null {
  const sample = samples[outputKey(targetId, property)];
  if (!sample || typeof sample.value !== "number") return null;
  return sample.value;
}

function readVec2(
  samples: Record<string, MotionSample>,
  targetId: string,
  property: string,
): Vec2 | null {
  const sample = samples[outputKey(targetId, property)];
  if (!sample || typeof sample.value !== "object" || sample.value === null) return null;
  const v = sample.value as Vec2;
  if (typeof v.x !== "number" || typeof v.y !== "number") return null;
  return v;
}

function contourToD(contour: PathContour): string {
  const pts = contour.points;
  if (pts.length === 0) return "";
  const parts: string[] = [];
  parts.push(`M ${fmt(pts[0].x)} ${fmt(pts[0].y)}`);
  for (let i = 1; i < pts.length; i += 1) {
    parts.push(`L ${fmt(pts[i].x)} ${fmt(pts[i].y)}`);
  }
  if (contour.closed) parts.push("Z");
  return parts.join(" ");
}

function shapeToSvgD(shape: ContourShape): string {
  return shape.contours.map(contourToD).join(" ");
}

function stationScale(threshold: number, reveal: number): number {
  if (reveal >= 1) return 1;
  const age = clamp01((reveal - threshold) / 0.12);
  if (age <= 0) return 0;
  return springValue(age * 2.5, STATION_POP_SPRING);
}

/* -------------------------------------------------------------------------- *
 * Props
 * -------------------------------------------------------------------------- */

export interface GraphicCompositionProps
  extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
  timeline: MotionTimeline;
  frame: number;
  reducedMotion?: boolean;
  ariaLabel?: string;
}

/* -------------------------------------------------------------------------- *
 * Component
 * -------------------------------------------------------------------------- */

export function GraphicComposition({
  timeline,
  frame,
  reducedMotion,
  ariaLabel = "Graphic composition",
  className,
  style,
  ...props
}: GraphicCompositionProps) {
  const prefersReduced = usePrefersReducedMotion();
  const isReduced = reducedMotion ?? prefersReduced;
  const durationFrames = Math.max(1, timeline.durationFrames);
  const evalFrame = isReduced ? durationFrames - 1 : frame;

  const evaluation = useMemo(
    () => evaluateTimeline(timeline, evalFrame),
    [timeline, evalFrame],
  );
  const samples = evaluation.samples;

  /* -- timeline samples ---------------------------------------------------- */
  const path = readDiscrete<MotionPath>(samples, "graphic-path", "data");
  const trimSpec = readDiscrete<PathTrimSpec>(samples, "graphic-trim", "data");
  const revealLength = readNumber(samples, "reveal-length", "revealLength") ?? 0;
  const packetPosition = readVec2(samples, "packet", "position");
  const morphFrom = readDiscrete<ContourShape>(samples, "graphic-morph", "from");
  const morphTo = readDiscrete<ContourShape>(samples, "graphic-morph", "to");
  const morphProgress = readNumber(samples, "morph", "progress") ?? 0;
  const maskClip = readDiscrete<MaskSpecLocal>(samples, "graphic-mask", "clip");
  const maskAlpha = readDiscrete<MaskSpecLocal>(samples, "graphic-mask", "alpha");
  const maskProgress = readNumber(samples, "mask", "progress") ?? 0;
  const accentOpacity = readNumber(samples, "accent-dot", "opacity") ?? 0.25;

  /* -- derived geometry ---------------------------------------------------- */
  const pathSamples = useMemo(() => (path ? samplePath(path, SAMPLES_PER_SEGMENT) : null), [path]);

  const stationThresholds = useMemo(() => {
    if (!path || !pathSamples || pathSamples.points.length === 0) return [];
    const total = pathSamples.totalLength;
    const thresholds: number[] = [];
    for (let i = 0; i < path.anchors.length; i += 1) {
      const idx = i * SAMPLES_PER_SEGMENT;
      const clampedIdx = Math.min(idx, pathSamples.points.length - 1);
      const t = total > 0 ? pathSamples.cumulativeLengths[clampedIdx] / total : 0;
      thresholds.push(clamp01(t));
    }
    return thresholds;
  }, [path, pathSamples]);

  const transformedAnchors = useMemo(() => {
    if (!path) return [];
    return path.anchors.map((anchor) => applyMatrixToPoint(ROUTE_MATRIX, anchor));
  }, [path]);

  const routeTerminus =
    transformedAnchors.length > 0 ? transformedAnchors[transformedAnchors.length - 1] : null;

  const routeTransform = `matrix(${fmt(ROUTE_MATRIX.a)}, ${fmt(ROUTE_MATRIX.b)}, ${fmt(
    ROUTE_MATRIX.c,
  )}, ${fmt(ROUTE_MATRIX.d)}, ${fmt(ROUTE_MATRIX.e)}, ${fmt(ROUTE_MATRIX.f)})`;

  const trimmedRoute = useMemo(() => {
    if (!path) return null;
    const spec: PathTrimSpec = {
      start: 0,
      end: clamp01(revealLength),
      direction: trimSpec?.direction ?? "forward",
    };
    return trimPath(path, spec, { samplesPerSegment: SAMPLES_PER_SEGMENT });
  }, [path, revealLength, trimSpec]);

  const morphResult = useMemo(() => {
    if (!morphFrom || !morphTo) return null;
    return morphShapes(morphFrom, morphTo, morphProgress);
  }, [morphFrom, morphTo, morphProgress]);

  const clipSample = useMemo(
    () => (maskClip ? evaluateMask(maskClip, maskProgress) : null),
    [maskClip, maskProgress],
  );
  const alphaSample = useMemo(
    () => (maskAlpha ? evaluateMask(maskAlpha, maskProgress) : null),
    [maskAlpha, maskProgress],
  );

  /* -- secondary, deterministic emphasis ----------------------------------- */
  const packetAge = clamp01((evalFrame - 60) / 30);
  const packetScale = springValue(packetAge * 2, PACKET_POP_SPRING);
  // The sampled opacity modulates the pulse cluster inside a legible band; the
  // raw track is dimmed to 0.25 at its quietest beat, which reads as noise.
  // The cluster also fades in only as the draw reaches the terminus, so the
  // dots can never float ahead of the stroke they are meant to celebrate.
  const terminusReveal = clamp01((clamp01(revealLength) - 0.92) / 0.08);
  const pulseOpacity = (0.65 + 0.35 * clamp01(accentOpacity)) * terminusReveal;

  const clipId = useId().replace(/:/g, "-");
  const alphaId = useId().replace(/:/g, "-");

  const rootStyle: CSSProperties = {
    position: "relative",
    width: "100%",
    height: "100%",
    ...style,
  };

  return (
    <div
      className={cx("relative overflow-hidden", className)}
      style={rootStyle}
      data-km-graphic-composition=""
      {...props}
    >
      <svg
        role="img"
        aria-label={ariaLabel}
        className="absolute inset-0 h-full w-full"
        viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {clipSample ? <SvgMaskDefinition id={clipId} sample={clipSample} /> : null}
          {alphaSample ? <SvgMaskDefinition id={alphaId} sample={alphaSample} /> : null}
        </defs>

        {/* Subtle background scaffolding */}
        <g opacity="0.5">
          <line
            x1={120}
            y1={300}
            x2={1800}
            y2={300}
            stroke="var(--km-border-subtle)"
            strokeWidth={1}
            strokeDasharray="8 12"
          />
          <line
            x1={120}
            y1={540}
            x2={1800}
            y2={540}
            stroke="var(--km-border-subtle)"
            strokeWidth={1}
            strokeDasharray="8 12"
          />
          <line
            x1={120}
            y1={780}
            x2={1800}
            y2={780}
            stroke="var(--km-border-subtle)"
            strokeWidth={1}
            strokeDasharray="8 12"
          />
        </g>

        {/* Route guide: the scene's "establish" beat. It is deliberately kept
            outside the reveal clip so the plan of the route is readable before
            the draw starts instead of the frame opening on an empty canvas. */}
        {path ? (
          <g transform={routeTransform}>
            <path
              d={pathToSvgD(path)}
              fill="none"
              stroke="var(--km-border-subtle)"
              strokeWidth={2}
              opacity={0.35}
            />
          </g>
        ) : null}

        {/* Main route group: clipped by the left-to-right mask reveal */}
        <g
          clipPath={clipSample?.kind === "clip" && clipSample.feather === 0 ? `url(#${clipId})` : undefined}
          mask={clipSample && (clipSample.kind !== "clip" || clipSample.feather > 0) ? `url(#${clipId})` : undefined}
        >
          <g transform={routeTransform}>
            {/* Revealed route stroke */}
            {trimmedRoute ? (
              <path
                d={trimmedRoute.svg}
                fill="none"
                stroke="var(--km-action-primary)"
                strokeWidth={6}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
          </g>

          {/* Stations revealed in staggered lock-step with the route draw */}
          {transformedAnchors.map((anchor, index) => {
            const threshold = stationThresholds[index] ?? index / Math.max(1, transformedAnchors.length - 1);
            const scale = stationScale(threshold, revealLength);
            return (
              <g key={index} transform={`translate(${fmt(anchor.x)}, ${fmt(anchor.y)})`}>
                <circle
                  r={fmt(18 * scale)}
                  fill="var(--km-surface-default)"
                  stroke="var(--km-action-primary)"
                  strokeWidth={3}
                  opacity={fmt(scale)}
                />
                <circle
                  r={fmt(7 * scale)}
                  fill="var(--km-action-primary)"
                  opacity={fmt(scale)}
                />
              </g>
            );
          })}

          {/* Packet traveling in transformed route space */}
          {packetPosition ? (
            <g transform={`translate(${fmt(packetPosition.x)}, ${fmt(packetPosition.y)})`}>
              <circle
                r={fmt(14 * packetScale)}
                fill="var(--km-action-primary)"
                stroke="var(--km-surface-elevated)"
                strokeWidth={3}
                opacity={fmt(packetScale)}
              />
              <circle
                r={fmt(22 * packetScale)}
                fill="none"
                stroke="var(--km-action-primary)"
                strokeWidth={2}
                opacity={fmt(packetScale * 0.45)}
              />
            </g>
          ) : null}

          {/* End-state pulse cluster, anchored to the resolved route terminus
              so it stays attached to the path for any route. */}
          {routeTerminus ? (
            <g
              transform={`translate(${fmt(routeTerminus.x)}, ${fmt(routeTerminus.y)})`}
              opacity={fmt(pulseOpacity)}
            >
              <circle cx={-60} cy={32} r={12} fill="var(--km-action-primary)" />
              <circle cx={-20} cy={72} r={9} fill="var(--km-action-primary)" />
              <circle cx={20} cy={32} r={10} fill="var(--km-action-primary)" />
            </g>
          ) : null}
        </g>

        {/* Detail panel: revealed by the top-to-bottom alpha matte */}
        {morphFrom && morphTo ? (
          /* A mask is resolved in the user space of the element that references
             it, so it lives on an untransformed wrapper and the panel is
             positioned inside it. */
          <g
            clipPath={alphaSample?.kind === "clip" && alphaSample.feather === 0 ? `url(#${alphaId})` : undefined}
            mask={alphaSample && (alphaSample.kind !== "clip" || alphaSample.feather > 0) ? `url(#${alphaId})` : undefined}
          >
            {/* The panel must sit inside the authored alpha matte: the matte's
                content rect ends at x = 1680, so a panel reaching past it loses
                its right rounded corner to the matte edge on every frame. */}
            <g transform="translate(1120, 720)">
            <rect
              x={0}
              y={0}
              width={520}
              height={160}
              rx={16}
              fill="var(--km-surface-elevated)"
              stroke="var(--km-border-strong)"
              strokeWidth={2}
            />
            {morphResult ? (
              <g transform="translate(260, 80)">
                <path
                  d={shapeToSvgD({ contours: morphResult.contours })}
                  fill="var(--km-action-primary)"
                  fillRule="evenodd"
                  opacity={0.9}
                  transform="translate(-70, -70) scale(0.583)"
                />
              </g>
            ) : null}
            </g>
          </g>
        ) : null}
      </svg>
    </div>
  );
}
