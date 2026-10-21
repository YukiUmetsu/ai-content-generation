import type { BrandPalette, BrandState } from "../model/types";
import { FONT_STACKS } from "../model/fonts";

interface VideoOpeningProps {
  brand: BrandState;
  palette: BrandPalette;
}

export function VideoOpening({ brand, palette }: VideoOpeningProps) {
  const type = brand.appearance.typography;
  const copyText = brand.copy.video;

  return (
    <div
      className="ba-preview-stage ba-video"
      data-preset={brand.appearance.presetId}
      data-testid="video-opening"
      style={{
        "--ba-canvas": palette.canvas,
        "--ba-surface": palette.surface,
        "--ba-text-primary": palette.textPrimary,
        "--ba-text-secondary": palette.textSecondary,
        "--ba-accent": palette.accent,
        "--ba-font-display": FONT_STACKS[type.display.family],
        "--ba-font-body": FONT_STACKS[type.body.family],
        "--ba-weight-display": type.display.weight,
        "--ba-weight-body": type.body.weight,
      } as React.CSSProperties}
    >
      <div className="ba-video-frame">
        <div className="ba-video-index" aria-hidden="true">01</div>
        <div className="ba-video-rule" aria-hidden="true" />
        <p className="ba-video-kicker">{copyText.kicker}</p>
        <h2 className="ba-video-title">{copyText.title}</h2>
        <p className="ba-video-dek">{copyText.dek}</p>
      </div>
    </div>
  );
}
