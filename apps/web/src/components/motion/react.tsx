/**
 * Motion React rendering layer — renderer-neutral 2D motion components.
 *
 * Every component is a pure function of an explicit `frame` prop. The only
 * clock-driven code lives in `MotionScrubber`, which uses `requestAnimationFrame`
 * solely to advance the integer frame by wall-clock delta and immediately calls
 * `onFrame(integerFrame)` so seeking and interruption stay deterministic.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  CSSProperties,
  ComponentPropsWithoutRef,
  ReactNode,
} from "react";

import type {
  AffineMatrix,
  EasingSpec,
  EvaluationResult,
  FrameRange,
  MotionSample,
  MotionTimeline,
  RationalFps,
  Rect,
  Vec2,
} from "./types";
import { normalizeFps } from "./constants";
import { evaluateTimeline, outputKey } from "./timeline";
import type { MotionPath } from "./paths";
import { pathBounds } from "./paths";
import { trimPath, trimRevealProgress } from "./trim";
import type { ContourShape, PathContour } from "./morph";
import { morphShapes } from "./morph";
import type { MaskSpecLocal } from "./masks";
import { evaluateMask, maskCapability } from "./masks";
import { SvgMaskDefinition } from "./svg-mask";
import { buildKineticTextTimeline, glyphTargetId } from "./kinetic-text";
import type { KineticTextSpec } from "./kinetic-text";

import { Button } from "../ui/button";
import { Slider } from "../ui/slider";

/* -------------------------------------------------------------------------- *
 * Utilities
 * -------------------------------------------------------------------------- */

function cx(
  ...classes: Array<string | false | undefined | null>
): string {
  return classes.filter(Boolean).join(" ");
}

const IDENTITY_MATRIX: AffineMatrix = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
};

function matrixToCss(matrix: AffineMatrix): string {
  const { a, b, c, d, e, f } = matrix;
  return `matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f})`;
}

function rectToViewBox(rect: Rect): string {
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  return `${rect.x} ${rect.y} ${w} ${h}`;
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
  const parts: string[] = [];
  for (const contour of shape.contours) {
    parts.push(contourToD(contour));
    for (const hole of contour.holes ?? []) {
      parts.push(contourToD(hole));
    }
  }
  return parts.join(" ");
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
}

function clampFrameIndex(frame: number, durationFrames: number): number {
  if (durationFrames <= 0) return 0;
  return Math.max(0, Math.min(durationFrames - 1, frame));
}

function fallbackKindFor(kind: "clip" | "alpha" | "luma"): "clip" | "alpha" | "luma" {
  if (kind === "clip") return "clip";
  if (kind === "alpha") return "clip";
  return "alpha";
}

function supportsMaskKind(kind: "clip" | "alpha" | "luma"): boolean {
  if (typeof window === "undefined") return true;
  if (kind === "clip") return true;
  if (typeof CSS === "undefined" || !CSS.supports) return false;
  if (kind === "alpha") {
    return CSS.supports("mask-image", "linear-gradient(#000, #fff)");
  }
  return CSS.supports("mask-mode", "luminance");
}

/* -------------------------------------------------------------------------- *
 * Reduced motion
 * -------------------------------------------------------------------------- */

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (callback) => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", callback);
      return () => mq.removeEventListener("change", callback);
    },
    () =>
      typeof window !== "undefined"
        ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
        : false,
    () => false,
  );
}

/* -------------------------------------------------------------------------- *
 * Evaluation context
 * -------------------------------------------------------------------------- */

interface MotionContextValue {
  evaluation: EvaluationResult;
  timeline: MotionTimeline;
}

const MotionContext = createContext<MotionContextValue | null>(null);

export function useMotionEvaluation(): EvaluationResult | null {
  return useContext(MotionContext)?.evaluation ?? null;
}

export function useMotionSample(
  targetId: string,
  property: string,
): MotionSample | null {
  const evaluation = useMotionEvaluation();
  if (!evaluation) return null;
  return evaluation.samples[outputKey(targetId, property)] ?? null;
}

/* -------------------------------------------------------------------------- *
 * MotionStage
 * -------------------------------------------------------------------------- */

export interface MotionStageProps
  extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
  timeline: MotionTimeline;
  frame: number;
  width: number;
  height: number;
  background?: string;
  children?: ReactNode;
  ariaLabel?: string;
  reducedMotion?: boolean;
  onEvaluation?: (result: EvaluationResult) => void;
}

export function MotionStage({
  timeline,
  frame,
  width,
  height,
  background,
  className,
  style,
  children,
  ariaLabel = "Motion stage",
  reducedMotion,
  onEvaluation,
  ...props
}: MotionStageProps) {
  const prefersReduced = usePrefersReducedMotion();
  const isReduced = reducedMotion ?? prefersReduced;

  const evaluation = useMemo<EvaluationResult>(() => {
    if (isReduced) {
      const end = evaluateTimeline(timeline, Math.max(0, timeline.durationFrames - 1));
      return { ...end, frame };
    }
    return evaluateTimeline(timeline, frame);
  }, [timeline, frame, isReduced]);

  useEffect(() => {
    onEvaluation?.(evaluation);
  }, [evaluation, onEvaluation]);

  const contextValue = useMemo<MotionContextValue>(
    () => ({ evaluation, timeline }),
    [evaluation, timeline],
  );

  const rootStyle: CSSProperties = {
    position: "relative",
    width,
    height,
    background: background ?? "transparent",
    overflow: "hidden",
    ...style,
  };

  return (
    <MotionContext.Provider value={contextValue}>
      <div
        role="img"
        aria-label={ariaLabel}
        className={cx(
          "rounded-surface border border-border bg-canvas",
          className,
        )}
        style={rootStyle}
        data-km-motion-stage=""
        {...props}
      >
        <svg
          className="pointer-events-none absolute inset-0"
          width={width}
          height={height}
          aria-hidden="true"
        >
          <defs />
        </svg>
        <div
          className="absolute inset-0"
          style={{ width, height }}
          data-km-motion-dom-layer=""
        >
          {children}
        </div>
      </div>
    </MotionContext.Provider>
  );
}

/* -------------------------------------------------------------------------- *
 * MotionBox
 * -------------------------------------------------------------------------- */

export interface MotionBoxProps
  extends Omit<ComponentPropsWithoutRef<"div">, "as"> {
  targetId: string;
  as?: "div" | "span";
}

export function MotionBox({
  targetId,
  children,
  className,
  style,
  as: Tag = "div",
  ...props
}: MotionBoxProps) {
  const ctx = useContext(MotionContext);
  const transformSample = ctx?.evaluation.samples[outputKey(targetId, "transform")];
  const opacitySample = ctx?.evaluation.samples[outputKey(targetId, "opacity")];

  const matrix =
    transformSample?.valueType === "transform" &&
    typeof transformSample.value === "object" &&
    transformSample.value !== null &&
    "a" in transformSample.value
      ? (transformSample.value as AffineMatrix)
      : IDENTITY_MATRIX;

  const opacity =
    opacitySample?.valueType === "opacity" &&
    typeof opacitySample.value === "number"
      ? opacitySample.value
      : 1;

  let pivot: { x: number; y: number } | undefined;
  if (ctx) {
    const node = ctx.timeline.transforms?.find((n) => n.id === targetId);
    if (node?.pivot) pivot = node.pivot;
  }

  const boxStyle: CSSProperties = {
    transform: matrixToCss(matrix),
    transformOrigin: pivot ? `${pivot.x}px ${pivot.y}px` : undefined,
    opacity,
    ...style,
  };

  return (
    <Tag
      className={cx("absolute", className)}
      style={boxStyle}
      data-km-motion-box={targetId}
      {...props}
    >
      {children}
    </Tag>
  );
}

/* -------------------------------------------------------------------------- *
 * KineticText
 * -------------------------------------------------------------------------- */

export interface KineticTextProps
  extends Omit<ComponentPropsWithoutRef<"span">, "as"> {
  spec: KineticTextSpec;
  frame: number;
  as?: "span" | "div" | "p";
  ariaLabel?: string;
  reducedMotion?: boolean;
}

const VISUALLY_HIDDEN: CSSProperties = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

export function KineticText({
  spec,
  frame,
  className,
  style,
  as: Tag = "span",
  ariaLabel,
  reducedMotion,
  ...props
}: KineticTextProps) {
  const prefersReduced = usePrefersReducedMotion();
  const isReduced = reducedMotion ?? prefersReduced;

  const built = useMemo(() => buildKineticTextTimeline(spec), [spec]);
  const evaluation = useMemo<EvaluationResult>(() => {
    if (isReduced) {
      const end = evaluateTimeline(
        built.timeline,
        Math.max(0, built.timeline.durationFrames - 1),
      );
      return { ...end, frame };
    }
    return evaluateTimeline(built.timeline, frame);
  }, [built.timeline, frame, isReduced]);

  const containerStyle: CSSProperties = {
    display: "inline",
    whiteSpace: "normal",
    wordBreak: "keep-all",
    overflowWrap: "break-word",
    ...style,
  };

  return (
    <Tag
      aria-label={ariaLabel}
      className={cx("text-foreground", className)}
      style={containerStyle}
      data-km-kinetic-text={spec.id}
      {...props}
    >
      <span style={VISUALLY_HIDDEN}>{spec.text}</span>
      {built.tokens.map((token, index) => {
        const id = glyphTargetId(spec.id, index);
        const position = evaluation.samples[outputKey(id, "position")];
        const opacitySample = evaluation.samples[outputKey(id, "opacity")];

        const translate: Vec2 =
          position?.valueType === "vec2" &&
          typeof position.value === "object" &&
          position.value !== null &&
          "x" in position.value
            ? (position.value as Vec2)
            : { x: 0, y: 0 };

        const opacity =
          opacitySample?.valueType === "opacity" &&
          typeof opacitySample.value === "number"
            ? opacitySample.value
            : 1;

        const tokenStyle: CSSProperties = {
          display: "inline-block",
          transform: `translate(${fmt(translate.x)}px, ${fmt(translate.y)}px)`,
          opacity,
          whiteSpace: "pre",
        };

        return (
          <span
            key={id}
            aria-hidden="true"
            style={tokenStyle}
            data-km-kinetic-token={index}
          >
            {token}
            {spec.granularity === "word" && index < built.tokens.length - 1
              ? "\u00A0"
              : null}
          </span>
        );
      })}
    </Tag>
  );
}

/* -------------------------------------------------------------------------- *
 * VectorDraw
 * -------------------------------------------------------------------------- */

export interface VectorDrawProps
  extends Omit<ComponentPropsWithoutRef<"svg">, "path"> {
  path: MotionPath;
  frame: number;
  range: FrameRange;
  easing?: EasingSpec;
  stroke: string;
  strokeWidth?: number;
  fill?: string;
  ariaLabel?: string;
  reducedMotion?: boolean;
}

export function VectorDraw({
  path,
  frame,
  range,
  easing,
  stroke,
  strokeWidth = 2,
  fill = "none",
  className,
  ariaLabel = "Vector drawing",
  reducedMotion,
  style,
  ...props
}: VectorDrawProps) {
  const prefersReduced = usePrefersReducedMotion();
  const isReduced = reducedMotion ?? prefersReduced;

  const progress = isReduced
    ? 1
    : trimRevealProgress(frame, range, easing ?? "linear");
  const trimmed = useMemo(
    () => trimPath(path, { start: 0, end: progress }),
    [path, progress],
  );
  const bounds = useMemo(() => pathBounds(path), [path]);

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      className={cx("overflow-visible", className)}
      style={{ width: "100%", height: "100%", ...style }}
      viewBox={rectToViewBox(bounds)}
      data-km-vector-draw=""
      data-progress={fmt(progress)}
      {...props}
    >
      <path
        d={trimmed.svg}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- *
 * ShapeMorphView
 * -------------------------------------------------------------------------- */

export interface ShapeMorphViewProps
  extends Omit<ComponentPropsWithoutRef<"svg">, "from" | "to"> {
  from: ContourShape;
  to: ContourShape;
  frame: number;
  range: FrameRange;
  fill?: string;
  stroke?: string;
  ariaLabel?: string;
  reducedMotion?: boolean;
}

export function ShapeMorphView({
  from,
  to,
  frame,
  range,
  fill = "none",
  stroke,
  className,
  ariaLabel = "Shape morph",
  reducedMotion,
  style,
  ...props
}: ShapeMorphViewProps) {
  const prefersReduced = usePrefersReducedMotion();
  const isReduced = reducedMotion ?? prefersReduced;
  const t = isReduced ? 1 : trimRevealProgress(frame, range, "linear");

  const result = useMemo(() => morphShapes(from, to, t), [from, to, t]);
  const bounds = useMemo<Rect>(() => {
    const all = [...from.contours, ...to.contours];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const contour of all) {
      for (const p of contour.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }
    if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 100, height: 100 };
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }, [from, to]);

  const pathD = useMemo(() => shapeToSvgD({ contours: result.contours }), [result.contours]);
  const fromD = useMemo(() => shapeToSvgD(from), [from]);
  const toD = useMemo(() => shapeToSvgD(to), [to]);

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      className={cx("overflow-visible", className)}
      style={{ width: "100%", height: "100%", ...style }}
      viewBox={rectToViewBox(bounds)}
      data-morph-mode={result.mode}
      data-km-shape-morph=""
      {...props}
    >
      {result.mode === "morph" ? (
        <path
          d={pathD}
          fill={fill}
          stroke={stroke}
          fillRule="evenodd"
          strokeLinejoin="round"
        />
      ) : result.mode === "dissolve" ? (
        <g>
          <path
            d={fromD}
            fill={fill}
            stroke={stroke}
            fillRule="evenodd"
            strokeLinejoin="round"
            opacity={1 - t}
          />
          <path
            d={toD}
            fill={fill}
            stroke={stroke}
            fillRule="evenodd"
            strokeLinejoin="round"
            opacity={t}
          />
        </g>
      ) : (
        <path
          d={t >= 1 ? toD : fromD}
          fill={fill}
          stroke={stroke}
          fillRule="evenodd"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

function polygonToClipPath(points: Vec2[]): string {
  return `polygon(${points
    .map((point) => `${fmt(point.x)}px ${fmt(point.y)}px`)
    .join(", ")})`;
}

/* -------------------------------------------------------------------------- *
 * MaskRevealView
 * -------------------------------------------------------------------------- */

export interface MaskRevealViewProps
  extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
  spec: MaskSpecLocal;
  progress: number;
  children: ReactNode;
  reducedMotion?: boolean;
}

export function MaskRevealView({
  spec,
  progress,
  children,
  className,
  style,
  reducedMotion,
  ...props
}: MaskRevealViewProps) {
  const prefersReduced = usePrefersReducedMotion();
  const isReduced = reducedMotion ?? prefersReduced;
  const sample = useMemo(
    () => evaluateMask(spec, isReduced ? 1 : progress),
    [spec, progress, isReduced],
  );
  const maskId = useId().replace(/:/g, "-");

  const { capability } = maskCapability(spec);
  let effectiveKind: "clip" | "alpha" | "luma" = spec.kind;
  if (!supportsMaskKind(effectiveKind)) {
    effectiveKind = fallbackKindFor(effectiveKind);
  }

  // `clip-path` cannot express a soft edge, so a feathered clip is composited
  // through an SVG alpha matte instead. When alpha masking is unavailable the
  // declared clip still renders, with the feather honestly dropped.
  const wantsFeather = sample.feather > 0;
  const softEdgeApplied =
    wantsFeather && (effectiveKind !== "clip" || supportsMaskKind("alpha"));
  const usesSvgMask = effectiveKind !== "clip" || softEdgeApplied;
  const maskType: "luminance" | "alpha" =
    usesSvgMask && effectiveKind === "luma" ? "luminance" : "alpha";

  const maskStyle: CSSProperties = usesSvgMask
    ? {
        maskImage: `url(#${maskId})`,
        WebkitMaskImage: `url(#${maskId})`,
      }
    : { clipPath: polygonToClipPath(sample.polygon) };

  // `order` is compositing order (docs/08 §3 `mask-reveal`): lower draws first.
  // For stacked masked siblings the positioned wrapper maps it to paint order.
  const orderStyle: CSSProperties =
    sample.order !== 0 ? { zIndex: sample.order } : {};

  return (
    <div
      className={cx("relative", className)}
      style={{ ...maskStyle, ...orderStyle, ...style }}
      data-mask-kind={effectiveKind}
      data-mask-capability={capability}
      data-mask-mode={usesSvgMask ? maskType : "clip"}
      data-mask-order={fmt(sample.order)}
      data-mask-feather={fmt(sample.feather)}
      data-mask-feather-applied={softEdgeApplied ? "true" : "false"}
      data-km-mask-reveal=""
      {...props}
    >
      {children}
      {usesSvgMask ? (
        <svg width="0" height="0" className="absolute" aria-hidden="true">
          <defs>
            <SvgMaskDefinition
              id={maskId}
              sample={{
                ...sample,
                kind: maskType === "luminance" ? "luma" : "alpha",
                feather: softEdgeApplied ? sample.feather : 0,
              }}
            />
          </defs>
        </svg>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- *
 * MotionScrubber
 * -------------------------------------------------------------------------- */

export interface MotionScrubberProps
  extends Omit<ComponentPropsWithoutRef<"div">, "onChange"> {
  timeline: MotionTimeline;
  playing?: boolean;
  onFrame: (frame: number) => void;
  frame?: number;
  fps?: RationalFps;
  label?: string;
}

export function MotionScrubber({
  timeline,
  playing: playingProp,
  onFrame,
  frame: frameProp,
  fps,
  label = "Frame",
  className,
  ...props
}: MotionScrubberProps) {
  const durationFrames = Math.max(1, timeline.durationFrames);
  const normalizedFps = useMemo(
    () => normalizeFps(fps ?? timeline.fps),
    [fps, timeline.fps],
  );

  const [internalFrame, setInternalFrame] = useState(0);
  const [internalPlaying, setInternalPlaying] = useState(false);

  const isFrameControlled = frameProp !== undefined;
  const isPlayingControlled = playingProp !== undefined;
  const frame = isFrameControlled
    ? clampFrameIndex(frameProp, durationFrames)
    : internalFrame;
  const playing = isPlayingControlled ? playingProp ?? false : internalPlaying;

  const frameRef = useRef(frame);
  frameRef.current = frame;

  const setFrame = useCallback(
    (next: number) => {
      const clamped = clampFrameIndex(next, durationFrames);
      if (!isFrameControlled) setInternalFrame(clamped);
      if (clamped !== frameRef.current) onFrame(clamped);
    },
    [durationFrames, isFrameControlled, onFrame],
  );

  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);

  const stopRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    lastTimeRef.current = null;
  }, []);

  useEffect(() => {
    if (!playing) {
      stopRaf();
      return;
    }

    const tick = (now: number) => {
      if (lastTimeRef.current === null) lastTimeRef.current = now;
      const elapsed = now - lastTimeRef.current;
      const frameDurationMs = (1000 * normalizedFps.den) / normalizedFps.num;
      const deltaFrames = Math.floor(elapsed / frameDurationMs);

      if (deltaFrames >= 1) {
        setFrame(frameRef.current + deltaFrames);
        lastTimeRef.current = now - (elapsed % frameDurationMs);
      }

      if (frameRef.current >= durationFrames - 1) {
        if (!isPlayingControlled) setInternalPlaying(false);
        stopRaf();
        return;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => stopRaf();
  }, [playing, normalizedFps, durationFrames, setFrame, stopRaf, isPlayingControlled]);

  const seconds = (frame * normalizedFps.den) / normalizedFps.num;
  const valueText = `${seconds.toFixed(2)}s`;

  return (
    <div
      className={cx(
        "flex flex-col gap-3 rounded-surface border border-border bg-surface p-4 text-foreground",
        className,
      )}
      data-km-motion-scrubber=""
      {...props}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          disabled={isPlayingControlled}
          onClick={() => {
            setInternalPlaying((p) => !p);
          }}
          aria-label={playing ? "Pause" : "Play"}
          aria-pressed={playing}
        >
          {playing ? "Pause" : "Play"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setFrame(0);
            if (!isPlayingControlled) setInternalPlaying(true);
          }}
          aria-label="Restart timeline"
        >
          Restart
        </Button>
        <span className="text-caption text-muted-foreground">
          {frame} / {durationFrames - 1} frames · {valueText}
        </span>
      </div>
      <Slider
        label={label}
        value={frame}
        min={0}
        max={durationFrames - 1}
        step={1}
        formatValue={() => valueText}
        showValue
        onValueChange={(next) => setFrame(Array.isArray(next) ? next[0] ?? 0 : next)}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- *
 * Component manifest
 * -------------------------------------------------------------------------- */

export const MOTION_COMPONENT_NAMES = [
  "MotionStage",
  "MotionBox",
  "KineticText",
  "VectorDraw",
  "ShapeMorphView",
  "MaskRevealView",
  "MotionScrubber",
] as const;
