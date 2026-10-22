import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { BrandPalette, BrandState, Locale, PaletteRole } from "../model/types";
import { PALETTE_ROLES } from "../model/types";
import { ROLE_LABELS, copy } from "../i18n";
import { VideoOpening } from "./VideoOpening";
import { MetricReveal } from "./MetricReveal";
import { ThumbnailPreview } from "./ThumbnailPreview";

interface PreviewStageProps {
  brand: BrandState;
  palette: BrandPalette;
  locale: Locale;
}

type PreviewView = "all" | "video" | "metric" | "thumbnail";

export function PreviewStage({ brand, palette, locale }: PreviewStageProps) {
  const t = copy(locale);
  const [view, setView] = useState<PreviewView>("all");
  const options: { id: PreviewView; label: string }[] = [
    { id: "all", label: t.allPreviews },
    { id: "video", label: t.videoView },
    { id: "metric", label: t.metricView },
    { id: "thumbnail", label: t.thumbnailView },
  ];
  const type = brand.appearance.typography;

  return (
    <section className="ba-preview-stage-section" aria-label={t.previewLabel}>
      <div className="ba-preview-toolbar">
        <span className="ba-preview-label">{t.previewViewsLabel}</span>
        <div className="ba-preview-view-controls" role="group" aria-label={t.previewViewsLabel}>
          {options.map((option) => (
            <Button
              key={option.id}
              variant={view === option.id ? "secondary" : "subtle"}
              size="sm"
              className="ba-preview-view-button"
              aria-label={t.previewViewsLabel + ": " + option.label}
              aria-pressed={view === option.id}
              onClick={() => setView(option.id)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="ba-preview-active-style" aria-label={t.activeStyleLabel}>
        <div className="ba-preview-token-row">
          <span className="ba-preview-label">{t.paletteLabel}</span>
          {PALETTE_ROLES.map((role: PaletteRole) => (
            <span
              key={role}
              className="ba-preview-color-key"
              data-testid={"preview-palette-" + role}
              title={ROLE_LABELS[locale][role] + ": " + palette[role]}
            >
              <span className="ba-preview-color-key-swatch" style={{ backgroundColor: palette[role] }} aria-hidden="true" />
              <span className="ba-preview-color-key-name">{ROLE_LABELS[locale][role]}</span>
            </span>
          ))}
        </div>
        <div className="ba-preview-font-row" aria-label={t.activeTypographyLabel}>
          <span className="ba-preview-label">{t.typographyLabel}</span>
          <span>{t.displayRole}: {type.display.family} {type.display.weight}</span>
          <span>{t.bodyRole}: {type.body.family} {type.body.weight}</span>
          <span>{t.numbersRole}: {type.numbers.family} {type.numbers.weight}</span>
        </div>
      </div>

      <div className="ba-preview-list" data-testid="brand-preview-list">
        {(view === "all" || view === "video") && (
          <div className="ba-preview" data-preview-surface>
            <span className="ba-preview-label">{t.videoPreviewLabel}</span>
            <div className="ba-preview-frame">
              <VideoOpening brand={brand} palette={palette} />
            </div>
          </div>
        )}
        {(view === "all" || view === "metric") && (
          <div className="ba-preview" data-preview-surface>
            <span className="ba-preview-label">{t.metricPreviewLabel}</span>
            <div className="ba-preview-frame">
              <MetricReveal brand={brand} palette={palette} />
            </div>
          </div>
        )}
        {(view === "all" || view === "thumbnail") && (
          <div className="ba-preview" data-preview-surface>
            <span className="ba-preview-label">{t.thumbnailPreviewLabel}</span>
            <div className="ba-preview-frame">
              <ThumbnailPreview brand={brand} palette={palette} locale={locale} />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
