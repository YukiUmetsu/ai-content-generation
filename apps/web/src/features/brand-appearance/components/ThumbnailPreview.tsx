import type { BrandAppearance, BrandCopy, Locale } from "../model/types";
import { PreviewFrame, previewStyle } from "./PreviewFrame";
import { copy } from "../i18n";

interface ThumbnailPreviewProps {
  appearance: BrandAppearance;
  copy: BrandCopy["thumbnail"];
  locale: Locale;
}

export function ThumbnailPreview({
  appearance,
  copy: thumbnailCopy,
  locale,
}: ThumbnailPreviewProps) {
  const t = copy(locale);
  return (
    <PreviewFrame appearance={appearance} label={t.thumbnailPreviewLabel}>
      <div
        className="ba-thumbnail"
        data-preset={appearance.presetId}
        data-testid="thumbnail-preview"
        style={previewStyle(appearance)}
      >
        <div className="ba-thumbnail-frame">
          <span className="ba-thumbnail-export-label" aria-hidden="true">
            1280 × 720
          </span>
          <p className="ba-thumbnail-kicker">{thumbnailCopy.kicker}</p>
          <div className="ba-thumbnail-main">
            <h2 className="ba-thumbnail-title">{thumbnailCopy.title}</h2>
            <span className="ba-thumbnail-badge">{thumbnailCopy.badge}</span>
          </div>
          <p className="ba-thumbnail-footer">{thumbnailCopy.footer}</p>

          <div className="ba-thumbnail-mobile-card">
            <div className="ba-thumbnail-mobile-frame">
              <p className="ba-thumbnail-mobile-kicker">{thumbnailCopy.kicker}</p>
              <h3 className="ba-thumbnail-mobile-title">{thumbnailCopy.title}</h3>
              <span className="ba-thumbnail-mobile-badge">{thumbnailCopy.badge}</span>
              <p className="ba-thumbnail-mobile-footer">{thumbnailCopy.footer}</p>
            </div>
            <span className="ba-thumbnail-mobile-label">{t.mobileCardLabel}</span>
          </div>
        </div>
      </div>
    </PreviewFrame>
  );
}
