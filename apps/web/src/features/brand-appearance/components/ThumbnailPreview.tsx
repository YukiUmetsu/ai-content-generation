import type { BrandPalette, BrandState, Locale } from "../model/types";
import { FONT_STACKS } from "../model/fonts";
import { copy } from "../i18n";

interface ThumbnailPreviewProps {
  brand: BrandState;
  palette: BrandPalette;
  locale: Locale;
}

export function ThumbnailPreview({ brand, palette, locale }: ThumbnailPreviewProps) {
  const t = copy(locale);
  const type = brand.appearance.typography;
  const c = brand.copy.thumbnail;

  const stageStyle = {
    "--ba-canvas": palette.canvas,
    "--ba-surface": palette.surface,
    "--ba-text-primary": palette.textPrimary,
    "--ba-text-secondary": palette.textSecondary,
    "--ba-accent": palette.accent,
    "--ba-font-display": FONT_STACKS[type.display.family],
    "--ba-font-body": FONT_STACKS[type.body.family],
    "--ba-weight-display": type.display.weight,
    "--ba-weight-body": type.body.weight,
  } as React.CSSProperties;

  return (
    <div
      className="ba-preview-stage ba-thumbnail"
      data-preset={brand.appearance.presetId}
      data-testid="thumbnail-preview"
      style={stageStyle}
    >
      <div className="ba-thumbnail-frame">
        <span className="ba-thumbnail-kicker">{c.kicker}</span>
        <div className="ba-thumbnail-main">
          <h2 className="ba-thumbnail-title">{c.title}</h2>
          <span className="ba-thumbnail-badge">{c.badge}</span>
        </div>
        <span className="ba-thumbnail-footer">{c.footer}</span>
        <span className="ba-thumbnail-export-label" aria-hidden="true">
          1280 × 720
        </span>
      </div>
      <div className="ba-thumbnail-mobile-card" aria-hidden="true">
        <div className="ba-thumbnail-mobile-frame" style={stageStyle}>
          <span className="ba-thumbnail-mobile-kicker">{c.kicker}</span>
          <h3 className="ba-thumbnail-mobile-title">{c.title}</h3>
          <span className="ba-thumbnail-mobile-badge">{c.badge}</span>
          <span className="ba-thumbnail-mobile-footer">{c.footer}</span>
        </div>
        <span className="ba-thumbnail-mobile-label">{t.mobileCardLabel}</span>
      </div>
    </div>
  );
}
