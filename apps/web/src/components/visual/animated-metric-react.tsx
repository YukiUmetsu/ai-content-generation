/** `AnimatedMetricView` — renders an `AnimatedMetricFrame` with stable width, tabular digits,
 * an optional change badge and labeled in-between values. Screen readers get the
 * value being shown at rest (or the target while counting), not every tick.
 */
import { forwardRef } from "react";
import type { CSSProperties, HTMLAttributes } from "react";
import { evaluateAnimatedMetric } from "./animated-metric";
import type { AnimatedMetricPlan } from "./animated-metric";

export interface AnimatedMetricViewProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  plan: AnimatedMetricPlan;
  frame: number;
  /** @default "md" */
  size?: "sm" | "md" | "lg" | "hero";
  /** Which change is good, for coloring the delta (costs: "down"). @default "neutral" */
  goodDirection?: "up" | "down" | "neutral";
  /** How in-between values look: `dim` lowers contrast, `none` leaves them as is. @default "dim" */
  transitions?: "dim" | "none";
  /** Semantic colors (CSS variables by default). */
  colors?: Partial<{ ink: string; sub: string; positive: string; negative: string; neutral: string }>;
  /** Hide the label line (when an outer layout labels the metric). */
  hideLabel?: boolean;
}

const SIZES = { sm: [13, 26, 13], md: [15, 40, 14], lg: [17, 60, 16], hero: [20, 96, 20] } as const;

export const AnimatedMetricView = forwardRef<HTMLDivElement, AnimatedMetricViewProps>(function AnimatedMetricView(
  { plan, frame, size = "md", goodDirection = "neutral", transitions = "dim", colors, hideLabel, style, ...rest }, ref) {
  const f = evaluateAnimatedMetric(plan, frame);
  const c = { ink: "var(--km-ink, currentColor)", sub: "var(--km-ink-muted, #6b7280)", positive: "var(--km-positive, #0b7a52)", negative: "var(--km-negative, #c0392b)", neutral: "var(--km-ink-muted, #6b7280)", ...colors };
  const [labelSize, valueSize, deltaSize] = SIZES[size];
  const good = f.delta && goodDirection !== "neutral" && f.delta.direction !== "flat" ? (f.delta.direction === goodDirection) : null;
  const stack: CSSProperties = { display: "inline-grid", justifyItems: "start" };
  const cell: CSSProperties = { gridArea: "1 / 1" };
  const spoken = `${plan.spec.label}: ${f.transitioning ? f.target : f.display}${f.delta ? `, change ${f.delta.display}` : ""}${f.label ? `, ${f.label}` : ""}`;
  return <div ref={ref} role="group" aria-label={spoken} data-km-metric={plan.spec.id} data-km-metric-status={f.status} data-km-metric-transitioning={f.transitioning || undefined}
    style={{ display: "grid", gap: 4, fontVariantNumeric: "tabular-nums", ...style }} {...rest}>
    {hideLabel ? null : <div aria-hidden style={{ fontSize: labelSize, color: c.sub, fontWeight: 550 }}>{plan.spec.label}</div>}
    <div aria-hidden style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
      <span style={{ ...stack, fontSize: valueSize, fontWeight: 700, lineHeight: 1.05, letterSpacing: "-0.01em", color: f.status === "unknown" ? c.sub : c.ink }}>
        <span style={{ ...cell, visibility: "hidden" }}>{plan.reserve}</span>
        <span style={{ ...cell, opacity: f.transitioning && transitions === "dim" ? 0.72 : 1, fontStyle: f.status === "unknown" ? "italic" : undefined }}>{f.display}</span>
      </span>
      {plan.spec.delta ? <span style={{ ...stack, fontSize: deltaSize, fontWeight: 650 }}>
        <span style={{ ...cell, visibility: "hidden", padding: "2px 8px" }}>{`↑ ${plan.reserveDelta}`}</span>
        {f.delta ? <span style={{ ...cell, padding: "2px 8px", borderRadius: 999, color: good === null ? c.neutral : good ? c.positive : c.negative, border: "1px solid currentColor" }}>
          {`${f.delta.direction === "up" ? "↑" : f.delta.direction === "down" ? "↓" : "→"} ${f.delta.display}`}</span> : null}
      </span> : null}
    </div>
    {f.label || plan.spec.source ? <div aria-hidden style={{ fontSize: deltaSize - 1, color: c.sub }}>{[f.label, plan.spec.source].filter(Boolean).join(" · ")}</div> : null}
  </div>;
});
