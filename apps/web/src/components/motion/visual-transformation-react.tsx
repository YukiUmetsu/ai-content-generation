import { forwardRef, useId, useMemo } from "react";
import type { ReactNode, SVGProps } from "react";
import { formatColor } from "./interpolate";
import { SvgMaskDefinition } from "./svg-mask";
import { usePrefersReducedMotion } from "./react";
import { evaluateVisualTransformation, evaluateVisualTransformationProgram } from "./visual-transformation";
import type { CompiledVisualTransformation, VisualLayer, VisualTransformationProgram } from "./visual-transformation-types";
import type { PathContour } from "./morph";
import type { EvaluationResult } from "./types";

export interface VisualTransformationProps extends Omit<SVGProps<SVGSVGElement>, "children" | "width" | "height"> {
  transformation: CompiledVisualTransformation | VisualTransformationProgram;
  frame: number;
  width: number;
  height: number;
  label: string;
  description?: string;
  /** Defaults to the system preference. Shows the final destination when true. */
  reducedMotion?: boolean;
  /** Slot receives local geometry; the adapter still owns transform, paint and mattes. */
  renderLayer?: (layer: VisualLayer) => ReactNode;
  /** Compiled fragments can consume the director's single MG1 evaluation. */
  evaluation?: EvaluationResult;
}

function contourPath(contour: PathContour): string {
  const [first, ...rest] = contour.points;
  if (!first) return "";
  return `M${first.x},${first.y}${rest.map(p => `L${p.x},${p.y}`).join("")}${contour.closed ? "Z" : ""}${(contour.holes ?? []).map(contourPath).join("")}`;
}
export function VisualGeometry({ layer }: { layer: VisualLayer }) {
  const content = layer.content;
  if (content.kind === "shape") return <path d={content.shape.contours.map(contourPath).join("")} fillRule="evenodd" />;
  if (content.kind === "svg-path") return <path d={content.d} fillRule="evenodd" />;
  const { x, y, width } = content.bounds;
  const fontSize = content.fontSize ?? 24;
  const lineHeight = content.lineHeight ?? 1.4;
  return <text x={content.direction === "rtl" ? x + width : x} y={y} dominantBaseline="hanging" fontFamily={content.fontFamily ?? "sans-serif"} fontSize={fontSize} direction={content.direction} textAnchor="start" xmlSpace="preserve">
    {content.text.split("\n").map((line, i) => <tspan key={i} x={content.direction === "rtl" ? x + width : x} dy={i ? fontSize * lineHeight : 0}>{line || " "}</tspan>)}
  </text>;
}

/** An SVG adapter over explicit frame samples. It never creates a playback clock. */
export const VisualTransformation = forwardRef<SVGSVGElement, VisualTransformationProps>(function VisualTransformation({ transformation, frame, width, height, label, description, reducedMotion, renderLayer, evaluation, style, ...props }, ref) {
  const systemReducedMotion = usePrefersReducedMotion();
  const prefix = `vt-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const sample = useMemo(() => {
    const duration = "segments" in transformation ? transformation.durationFrames : transformation.spec.durationFrames;
    const resolvedFrame = (reducedMotion ?? systemReducedMotion) ? duration - 1 : frame;
    if (evaluation && "segments" in transformation) throw new Error("Share director samples with one compiled transformation fragment; select the active segment before rendering.");
    return "segments" in transformation ? evaluateVisualTransformationProgram(transformation, resolvedFrame) : evaluateVisualTransformation(transformation, resolvedFrame, evaluation);
  }, [transformation, frame, reducedMotion, systemReducedMotion, evaluation]);
  if (![width, height].every(v => Number.isFinite(v) && v > 0)) throw new Error("VisualTransformation: width and height must be positive finite design dimensions.");
  return <svg {...props} ref={ref} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-labelledby={props["aria-label"] ? undefined : `${prefix}-title`} aria-describedby={description ? `${prefix}-description` : props["aria-describedby"]} data-frame={sample.frame} style={{ display: "block", maxWidth: "100%", height: "auto", ...style }}>
    <title id={`${prefix}-title`}>{label}</title>
    {description ? <desc id={`${prefix}-description`}>{description}</desc> : null}
    {sample.layers.map((layer, index) => {
      const matrix = layer.transform;
      const ids = layer.clips.map((_, i) => `${prefix}-${index}-${i}`);
      let geometry: ReactNode = <g transform={`matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`} fill={formatColor(layer.fill)} stroke={formatColor(layer.stroke)} strokeWidth={layer.strokeWidth}>
        {renderLayer ? renderLayer(layer) : <VisualGeometry layer={layer} />}
      </g>;
      for (let i = layer.clips.length - 1; i >= 0; i--) {
        const mask = layer.clips[i];
        geometry = <g key={ids[i]} {...(mask.kind === "clip" && mask.feather === 0 ? { clipPath: `url(#${ids[i]})` } : { mask: `url(#${ids[i]})` })}>{geometry}</g>;
      }
      return <g key={layer.id} data-semantic-id={layer.semanticId} data-visual-layer={layer.id} opacity={layer.opacity}>
        {layer.clips.length ? <defs>{layer.clips.map((mask, i) => <SvgMaskDefinition key={ids[i]} id={ids[i]} sample={mask} />)}</defs> : null}
        {geometry}
      </g>;
    })}
  </svg>;
});
