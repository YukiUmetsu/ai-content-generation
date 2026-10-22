import { forwardRef, useId, useMemo } from "react";
import type { CSSProperties, HTMLAttributes } from "react";

import { baselineOffset } from "./measure";
import { cornerRadius, resolvePaint, textAnchorX } from "./paint";
import type { PaintDef, ResolvedPaint } from "./paint";
import { round, strokeDashArray } from "./primitives";
import type {
  DashPattern,
  EllipsePrimitive,
  InfographicLayout,
  InfographicPrimitive,
  LinePrimitive,
  PathPrimitive,
  PolylinePrimitive,
  RectPrimitive,
  TextPrimitive,
} from "./types";

function joinClasses(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

/**
 * Shared paint attributes for stroked primitives.
 *
 * Dash geometry comes from {@link strokeDashArray} and the cap/join rule mirrors
 * `svg.ts` exactly: a round cap and join are emitted whenever a stroke width is
 * present, so the preview and the static export produce the same
 * `stroke-dasharray`, `stroke-linecap` and `stroke-linejoin` for every primitive.
 */
function strokeProps(
  primitive: { stroke?: string; strokeWidth?: number; dash?: DashPattern; opacity?: number },
): Record<string, string | number | undefined> {
  const width = primitive.strokeWidth ?? 1;
  const stroked = Boolean(primitive.stroke);
  const roundCap = stroked && primitive.strokeWidth !== undefined;
  return {
    stroke: primitive.stroke ?? "none",
    strokeWidth: width,
    strokeDasharray: stroked ? strokeDashArray(primitive.dash, width) ?? undefined : undefined,
    strokeLinecap: roundCap ? "round" : undefined,
    strokeLinejoin: roundCap ? "round" : undefined,
    opacity: primitive.opacity,
  };
}

interface ShapeProps<P> {
  primitive: P;
  fill?: string;
  filter?: string;
}

function RectShape({ primitive, fill, filter }: ShapeProps<RectPrimitive>) {
  return (
    <rect
      filter={filter}
      x={primitive.x}
      y={primitive.y}
      width={Math.max(primitive.width, 0)}
      height={Math.max(primitive.height, 0)}
      rx={cornerRadius(primitive)}
      ry={cornerRadius(primitive)}
      fill={fill ?? "none"}
      {...strokeProps(primitive)}
    />
  );
}

function EllipseShape({ primitive, fill, filter }: ShapeProps<EllipsePrimitive>) {
  return (
    <ellipse
      filter={filter}
      cx={primitive.x + primitive.width / 2}
      cy={primitive.y + primitive.height / 2}
      rx={Math.max(primitive.width / 2, 0)}
      ry={Math.max(primitive.height / 2, 0)}
      fill={fill ?? "none"}
      {...strokeProps(primitive)}
    />
  );
}

function LineShape({ primitive }: { primitive: LinePrimitive }) {
  return (
    <line
      x1={primitive.x1}
      y1={primitive.y1}
      x2={primitive.x2}
      y2={primitive.y2}
      fill="none"
      {...strokeProps({
        stroke: primitive.stroke,
        strokeWidth: primitive.strokeWidth,
        dash: primitive.dash,
        opacity: primitive.opacity,
      })}
    />
  );
}

function PolylineShape({ primitive }: { primitive: PolylinePrimitive }) {
  const points = primitive.points.map(([x, y]) => `${x},${y}`).join(" ");
  return (
    <polyline
      points={points}
      fill={primitive.fill ?? "none"}
      {...strokeProps({
        stroke: primitive.stroke,
        strokeWidth: primitive.strokeWidth,
        dash: primitive.dash,
        opacity: primitive.opacity,
      })}
    />
  );
}

function PathShape({ primitive, fill, filter }: ShapeProps<PathPrimitive>) {
  return (
    <path
      filter={filter}
      d={primitive.d}
      fill={fill ?? "none"}
      {...strokeProps({
        stroke: primitive.stroke,
        strokeWidth: primitive.strokeWidth,
        dash: primitive.dash,
        opacity: primitive.opacity,
      })}
    />
  );
}

function TextShape({ primitive }: { primitive: TextPrimitive }) {
  const anchor = primitive.align === "center" ? "middle" : primitive.align === "end" ? "end" : "start";
  const x = textAnchorX(primitive);
  return (
    <text
      x={x}
      y={primitive.y}
      fill={primitive.color}
      fontFamily={primitive.family}
      fontSize={primitive.fontSize}
      fontWeight={primitive.weight}
      fontStyle={primitive.italic ? "italic" : undefined}
      letterSpacing={primitive.letterSpacing}
      textAnchor={anchor}
      opacity={primitive.opacity}
      style={{ whiteSpace: "pre", fontVariantNumeric: primitive.tabular ? "tabular-nums" : undefined }}
    >
      {primitive.lines.map((line, index) => (
        <tspan
          key={`line-${index}`}
          x={x}
          y={round(primitive.y + baselineOffset(index, primitive.fontSize, primitive.lineHeight))}
        >
          {line}
        </tspan>
      ))}
    </text>
  );
}

/**
 * Render a single infographic primitive as SVG.
 *
 * Kept structurally parallel to the static exporter so that the on-screen
 * preview and the exported file cannot render different geometry. Any primitive
 * kind added to the IR must be handled here as well.
 */
export function PrimitiveShape({ primitive, paint }: { primitive: InfographicPrimitive; paint?: ResolvedPaint }) {
  const fill = paint ? paint.fillFor(primitive) : "fill" in primitive ? primitive.fill : undefined;
  const filter = paint?.filterFor(primitive);
  switch (primitive.kind) {
    case "rect":
      return <RectShape primitive={primitive} fill={fill} filter={filter} />;
    case "ellipse":
      return <EllipseShape primitive={primitive} fill={fill} filter={filter} />;
    case "line":
      return <LineShape primitive={primitive} />;
    case "polyline":
      return <PolylineShape primitive={primitive} />;
    case "path":
      return <PathShape primitive={primitive} fill={fill} filter={filter} />;
    case "text":
      return <TextShape primitive={primitive} />;
    default:
      return null;
  }
}

/** Gradient and shadow definitions; the static exporter emits the same markup. */
export function PaintDefs({ defs }: { defs: readonly PaintDef[] }) {
  if (defs.length === 0) return null;
  return (
    <defs>
      {defs.map((def) =>
        def.kind === "gradient" ? (
          <linearGradient key={def.id} id={def.id} gradientUnits="userSpaceOnUse" x1={def.x1} y1={def.y1} x2={def.x2} y2={def.y2}>
            <stop offset={0} stopColor={def.from} />
            <stop offset={1} stopColor={def.to} stopOpacity={def.toOpacity} />
          </linearGradient>
        ) : (
          <filter
            key={def.id}
            id={def.id}
            filterUnits="userSpaceOnUse"
            x={def.x}
            y={def.y}
            width={def.width}
            height={def.height}
            colorInterpolationFilters="sRGB"
          >
            {def.layers.map((layer, index) => (
              <feDropShadow
                key={index}
                dx={0}
                dy={layer.dy}
                stdDeviation={layer.blur / 2}
                floodColor={def.color}
                floodOpacity={layer.opacity}
              />
            ))}
          </filter>
        ),
      )}
    </defs>
  );
}

export type InfographicFit = "none" | "contain" | "width";

export interface InfographicViewProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /**
   * The resolved layout produced by `buildInfographic`. Rendering takes a
   * layout rather than a source so that authors can inspect and diff exactly
   * what was laid out instead of silently re-solving during render.
   */
  layout: InfographicLayout;
  /** `contain` scales the artboard to the container, `width` fills the width, `none` uses design pixels. @default "contain" */
  fit?: InfographicFit;
  /** Additional multiplier applied on top of `fit`. @default 1 */
  zoom?: number;
  /** Render the accessible title/description. @default true */
  accessible?: boolean;
  /** Draw the artboard background rectangle. @default true */
  includeBackground?: boolean;
}

/**
 * Deterministic, dependency-free preview of an infographic layout.
 *
 * The component is a thin renderer: it owns no layout logic, no measurement and
 * no art direction. Everything it draws comes from the layout document, which is
 * what makes the preview safe to use inside a composition, a print sheet or an
 * export pipeline without visual drift.
 */
export const InfographicView = forwardRef<HTMLDivElement, InfographicViewProps>(function InfographicView(
  { layout, fit = "contain", zoom = 1, accessible = true, includeBackground = true, className, style, ...rest },
  ref,
) {
  const generatedId = useId();
  const titleId = `${generatedId}-title`;
  const descId = `${generatedId}-desc`;

  const primitives = useMemo(() => {
    if (includeBackground) return layout.primitives;
    return layout.primitives.filter((primitive) => !(primitive.kind === "rect" && primitive.role === "infographic-background"));
  }, [includeBackground, layout.primitives]);

  const paint = useMemo(() => resolvePaint(primitives, `${generatedId}-paint`), [generatedId, primitives]);

  // `layout.summary` already carries the page marker for paginated profiles, so
  // it is used verbatim as the description rather than re-assembled here.
  const description = layout.summary;

  const widthAttr = fit === "none" ? round(layout.canvas.width * zoom) : "100%";
  // `"auto"` is not a valid SVG length; the intrinsic aspect sizing already
  // comes from `viewBox` + the inline `height: "auto"` style, so when `fit` is
  // not `"none"` the attribute is omitted entirely rather than set to "auto".
  const heightAttr = fit === "none" ? round(layout.canvas.height * zoom) : undefined;

  const containerStyle: CSSProperties = {
    ...style,
  };

  return (
    <div
      ref={ref}
      data-km-infographic="view"
      data-km-infographic-fit={fit}
      data-km-infographic-zoom={zoom}
      className={joinClasses(
        "relative w-full",
        fit === "none" ? "overflow-auto" : "overflow-hidden",
        className,
      )}
      style={containerStyle}
      {...rest}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-labelledby={accessible ? `${titleId} ${descId}` : undefined}
        aria-hidden={accessible ? undefined : true}
        viewBox={`0 0 ${layout.canvas.width} ${layout.canvas.height}`}
        preserveAspectRatio="xMidYMid meet"
        width={widthAttr}
        height={heightAttr}
        style={{
          display: "block",
          width: fit === "none" ? round(layout.canvas.width * zoom) : `${round(zoom * 100)}%`,
          height: "auto",
          background: includeBackground ? undefined : layout.canvas.background,
        }}
        data-km-infographic-template={layout.template}
        data-km-infographic-art-direction={layout.artDirection}
      >
        {accessible ? (
          <>
            <title id={titleId}>{layout.metadata?.title ?? layout.sourceId}</title>
            <desc id={descId}>{description}</desc>
          </>
        ) : null}
        <PaintDefs defs={paint.defs} />
        {primitives.map((primitive) => (
          <g
            key={primitive.id}
            id={primitive.id}
            data-km-primitive={primitive.kind}
            data-km-role={primitive.role}
            data-km-semantic-id={primitive.semanticId}
          >
            <PrimitiveShape primitive={primitive} paint={paint} />
          </g>
        ))}
      </svg>
    </div>
  );
});

InfographicView.displayName = "InfographicView";

export default InfographicView;
