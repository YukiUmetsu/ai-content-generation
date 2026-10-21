/**
 * `EconomicChartView` — accessible SVG preview of an economic chart result
 * (`renderCostWaterfall`, `renderLifecycleCostTimeline`, `renderBreakEvenComparison`).
 * It owns no layout: every mark comes from the result, which the static exporter
 * (`economicChartToSvg`) draws identically.
 */
import { forwardRef, useId, useMemo } from "react";
import type { HTMLAttributes } from "react";
import { resolvePaint } from "./paint";
import { PaintDefs, PrimitiveShape } from "./react";
import { paintDefsToSvg, primitiveToSvg } from "./svg";
import type { EconomicChartResult } from "./economic";

export interface EconomicChartViewProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  chart: EconomicChartResult;
  /** Render `<title>` / `<desc>` from the chart's title and summary. @default true */
  accessible?: boolean;
}

export const EconomicChartView = forwardRef<HTMLDivElement, EconomicChartViewProps>(function EconomicChartView({ chart, accessible = true, style, ...rest }, ref) {
  const id = useId();
  const paint = useMemo(() => resolvePaint(chart.primitives, `${id}-paint`), [chart.primitives, id]);
  return <div ref={ref} data-km-economic-chart="" style={{ width: "100%", ...style }} {...rest}>
    <svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby={accessible ? `${id}-t ${id}-d` : undefined} aria-hidden={accessible ? undefined : true}
      viewBox={`0 0 ${chart.width} ${chart.height}`} preserveAspectRatio="xMidYMid meet" style={{ display: "block", width: "100%", height: "auto" }}>
      {accessible ? <><title id={`${id}-t`}>{chart.title}</title><desc id={`${id}-d`}>{chart.summary}</desc></> : null}
      <PaintDefs defs={paint.defs} />
      {chart.primitives.map(p => <g key={p.id} data-km-role={p.role} data-km-semantic-id={p.semanticId}><PrimitiveShape primitive={p} paint={paint} /></g>)}
    </svg>
  </div>;
});

/** Static SVG markup for export pipelines (same geometry as the preview). */
export function economicChartToSvg(chart: EconomicChartResult, precision = 2): string {
  const paint = resolvePaint(chart.primitives, "km-econ");
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c] as string));
  const ignored: EconomicChartResult["diagnostics"] = [];
  const body = chart.primitives.map(p => primitiveToSvg(p, precision, ignored, paint)).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${chart.width} ${chart.height}" width="${chart.width}" height="${chart.height}" role="img"><title>${esc(chart.title)}</title><desc>${esc(chart.summary)}</desc>${paintDefsToSvg(paint.defs, precision)}${body}</svg>`;
}
