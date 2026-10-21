import type { BrandPalette, BrandState } from "../model/types";
import { FONT_STACKS } from "../model/fonts";

interface MetricRevealProps {
  brand: BrandState;
  palette: BrandPalette;
}

export function MetricReveal({ brand, palette }: MetricRevealProps) {
  const type = brand.appearance.typography;
  const copy = brand.copy.metric;

  return (
    <div
      className="ba-preview-stage ba-metric"
      data-preset={brand.appearance.presetId}
      data-testid="metric-reveal"
      style={{
        "--ba-canvas": palette.canvas,
        "--ba-surface": palette.surface,
        "--ba-text-primary": palette.textPrimary,
        "--ba-text-secondary": palette.textSecondary,
        "--ba-accent": palette.accent,
        "--ba-positive": palette.positive,
        "--ba-negative": palette.negative,
        "--ba-font-display": FONT_STACKS[type.display.family],
        "--ba-font-body": FONT_STACKS[type.body.family],
        "--ba-font-numbers": FONT_STACKS[type.numbers.family],
        "--ba-weight-display": type.display.weight,
        "--ba-weight-body": type.body.weight,
        "--ba-weight-numbers": type.numbers.weight,
      } as React.CSSProperties}
    >
      <div className="ba-metric-frame">
        <span className="ba-metric-label">{copy.label}</span>
        <div className="ba-metric-value-wrap">
          <span className="ba-metric-value">{copy.value}</span>
          <span className="ba-metric-delta">{copy.delta}</span>
        </div>
        <div className="ba-metric-bars">
          <div className="ba-metric-bar-row">
            <span className="ba-metric-bar-label">{copy.positiveLabel}</span>
            <div className="ba-metric-bar-track">
              <div className="ba-metric-bar ba-metric-bar-positive" style={{ width: "60%" }} />
            </div>
            <span className="ba-metric-bar-value">{copy.positiveValue}</span>
          </div>
          <div className="ba-metric-bar-row">
            <span className="ba-metric-bar-label">{copy.negativeLabel}</span>
            <div className="ba-metric-bar-track">
              <div className="ba-metric-bar ba-metric-bar-negative" style={{ width: "80%" }} />
            </div>
            <span className="ba-metric-bar-value">{copy.negativeValue}</span>
          </div>
        </div>
        <p className="ba-metric-source">{copy.source}</p>
      </div>
    </div>
  );
}
