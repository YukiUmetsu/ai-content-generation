import type { BrandPalette, BrandState, Locale } from "../model/types";
import { copy } from "../i18n";
import { VideoOpening } from "./VideoOpening";
import { MetricReveal } from "./MetricReveal";
import { ThumbnailPreview } from "./ThumbnailPreview";

interface PreviewStageProps {
  brand: BrandState;
  palette: BrandPalette;
  locale: Locale;
}

export function PreviewStage({ brand, palette, locale }: PreviewStageProps) {
  const t = copy(locale);
  return (
    <section className="ba-preview-stage-section" aria-label={t.previewLabel}>
      <div className="ba-preview" data-preview-surface>
        <span className="ba-preview-label">{t.videoPreviewLabel}</span>
        <div className="ba-preview-frame">
          <VideoOpening brand={brand} palette={palette} />
        </div>
      </div>
      <div className="ba-preview" data-preview-surface>
        <span className="ba-preview-label">{t.metricPreviewLabel}</span>
        <div className="ba-preview-frame">
          <MetricReveal brand={brand} palette={palette} />
        </div>
      </div>
      <div className="ba-preview" data-preview-surface>
        <span className="ba-preview-label">{t.thumbnailPreviewLabel}</span>
        <div className="ba-preview-frame">
          <ThumbnailPreview brand={brand} palette={palette} locale={locale} />
        </div>
      </div>
    </section>
  );
}
