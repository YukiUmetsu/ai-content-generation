import type { BrandAppearance, BrandCopy, Locale } from "../model/types";
import { PreviewFrame, previewStyle } from "./PreviewFrame";
import { copy } from "../i18n";

interface MetricRevealPreviewProps {
  appearance: BrandAppearance;
  copy: BrandCopy["metric"];
  locale: Locale;
}

function parseNumericValue(value: string): number | null {
  const cleaned = value.replace(/[^0-9.\-]/g, "");
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function barWidth(value: string, max: number): string {
  const parsed = parseNumericValue(value);
  if (parsed == null || max <= 0) return "0%";
  const pct = (parsed / max) * 100;
  return `${Math.min(100, Math.max(5, pct)).toFixed(1)}%`;
}

export function MetricRevealPreview({
  appearance,
  copy: metricCopy,
  locale,
}: MetricRevealPreviewProps) {
  const t = copy(locale);
  const positive = parseNumericValue(metricCopy.positiveValue) ?? 0;
  const negative = parseNumericValue(metricCopy.negativeValue) ?? 0;
  const max = Math.max(positive, negative, 1);

  return (
    <PreviewFrame appearance={appearance} label={t.metricPreviewLabel}>
      <div
        className="ba-metric"
        data-preset={appearance.presetId}
        data-testid="metric-reveal"
        style={previewStyle(appearance)}
      >
        <div className="ba-metric-frame">
          <p className="ba-metric-label">{metricCopy.label}</p>
          <div className="ba-metric-value-wrap">
            <span className="ba-metric-value">{metricCopy.value}</span>
            <span className="ba-metric-delta">{metricCopy.delta}</span>
          </div>
          <div className="ba-metric-bars">
            <div className="ba-metric-bar-row">
              <span className="ba-metric-bar-label">{metricCopy.positiveLabel}</span>
              <div className="ba-metric-bar-track">
                <div
                  className="ba-metric-bar ba-metric-bar-positive"
                  style={{ width: barWidth(metricCopy.positiveValue, max) }}
                />
              </div>
              <span className="ba-metric-bar-value">{metricCopy.positiveValue}</span>
            </div>
            <div className="ba-metric-bar-row">
              <span className="ba-metric-bar-label">{metricCopy.negativeLabel}</span>
              <div className="ba-metric-bar-track">
                <div
                  className="ba-metric-bar ba-metric-bar-negative"
                  style={{ width: barWidth(metricCopy.negativeValue, max) }}
                />
              </div>
              <span className="ba-metric-bar-value">{metricCopy.negativeValue}</span>
            </div>
          </div>
          <p className="ba-metric-source">{metricCopy.source}</p>
        </div>
      </div>
    </PreviewFrame>
  );
}
