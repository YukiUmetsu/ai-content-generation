import type { BrandAppearance } from "../model/types";
import { FONT_STACKS } from "../model/fonts";

export interface PreviewFrameProps {
  appearance: BrandAppearance;
  label: string;
  children: React.ReactNode;
}

export function previewStyle(appearance: BrandAppearance): React.CSSProperties {
  const { palette, typography } = appearance;
  return {
    "--ba-canvas": palette.canvas,
    "--ba-surface": palette.surface,
    "--ba-text-primary": palette.textPrimary,
    "--ba-text-secondary": palette.textSecondary,
    "--ba-accent": palette.accent,
    "--ba-positive": palette.positive,
    "--ba-negative": palette.negative,
    "--ba-font-display": FONT_STACKS[typography.display.family],
    "--ba-font-body": FONT_STACKS[typography.body.family],
    "--ba-font-numbers": FONT_STACKS[typography.numbers.family],
    "--ba-weight-display": String(typography.display.weight),
    "--ba-weight-body": String(typography.body.weight),
    "--ba-weight-numbers": String(typography.numbers.weight),
  } as React.CSSProperties;
}

export function PreviewFrame({ appearance, label, children }: PreviewFrameProps) {
  return (
    <div className="ba-preview">
      <div className="ba-preview-label">{label}</div>
      <div
        className="ba-preview-frame"
        style={previewStyle(appearance)}
        data-preset={appearance.presetId}
        data-spacing={appearance.spacing}
        data-radius={appearance.cornerRadius}
        data-texture={appearance.texture}
      >
        <div className="ba-preview-stage">{children}</div>
      </div>
    </div>
  );
}
