import type { BrandAppearance, BrandCopy, Locale } from "../model/types";
import { PreviewFrame, previewStyle } from "./PreviewFrame";
import { copy } from "../i18n";

interface VideoOpeningPreviewProps {
  appearance: BrandAppearance;
  copy: BrandCopy["video"];
  locale: Locale;
}

export function VideoOpeningPreview({
  appearance,
  copy: videoCopy,
  locale,
}: VideoOpeningPreviewProps) {
  const t = copy(locale);
  return (
    <PreviewFrame appearance={appearance} label={t.videoPreviewLabel}>
      <div
        className="ba-video"
        data-preset={appearance.presetId}
        data-testid="video-opening"
        style={previewStyle(appearance)}
      >
        <div className="ba-video-frame">
          <span className="ba-video-index" aria-hidden="true">01</span>
          <span className="ba-video-rule" aria-hidden="true" />
          <p className="ba-video-kicker">{videoCopy.kicker}</p>
          <h2 className="ba-video-title">{videoCopy.title}</h2>
          <p className="ba-video-dek">{videoCopy.dek}</p>
        </div>
      </div>
    </PreviewFrame>
  );
}
