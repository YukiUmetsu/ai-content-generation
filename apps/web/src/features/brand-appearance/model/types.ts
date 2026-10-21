export type Locale = "en" | "ja";

export const PALETTE_ROLES = [
  "canvas",
  "surface",
  "textPrimary",
  "textSecondary",
  "accent",
  "positive",
  "negative",
] as const;

export type PaletteRole = (typeof PALETTE_ROLES)[number];

export type PresetId =
  | "modern-analytical"
  | "calm-editorial"
  | "cinematic-investigative";

export type FontFamily =
  | "Geist"
  | "Newsreader"
  | "System Sans"
  | "System Mono";

export const APPROVED_FAMILIES: readonly FontFamily[] = [
  "Geist",
  "Newsreader",
  "System Sans",
  "System Mono",
];

export const APPROVED_WEIGHTS = [400, 450, 500, 600, 650, 700] as const;
export type ApprovedWeight = (typeof APPROVED_WEIGHTS)[number];

export type SpacingDensity = "spacious" | "comfortable" | "compact";
export type CornerRadius = "low" | "medium" | "high";

export interface BrandPalette {
  canvas: string;
  surface: string;
  textPrimary: string;
  textSecondary: string;
  accent: string;
  positive: string;
  negative: string;
}

export interface TypeRole {
  family: FontFamily;
  weight: ApprovedWeight;
}

export interface BrandTypography {
  display: TypeRole;
  body: TypeRole;
  numbers: TypeRole;
}

export interface Preset {
  id: PresetId;
  name: string;
  description: Record<Locale, string>;
  traits: string[];
  materialLanguage: Record<Locale, string>;
  palette: BrandPalette;
  typography: BrandTypography;
  texture: string;
  spacing: SpacingDensity;
  cornerRadius: CornerRadius;
}

export interface BrandAppearance {
  presetId: PresetId;
  palette: BrandPalette;
  typography: BrandTypography;
  texture: string;
  spacing: SpacingDensity;
  cornerRadius: CornerRadius;
  customized: boolean;
}

export interface VideoCopy {
  kicker: string;
  title: string;
  dek: string;
}

export interface MetricCopy {
  label: string;
  value: string;
  delta: string;
  positiveLabel: string;
  positiveValue: string;
  negativeLabel: string;
  negativeValue: string;
  source: string;
}

export interface ThumbnailCopy {
  kicker: string;
  title: string;
  badge: string;
  footer: string;
}

export interface BrandCopy {
  video: VideoCopy;
  metric: MetricCopy;
  thumbnail: ThumbnailCopy;
}

export interface BrandState {
  id: string;
  name: string;
  revision: number;
  appearance: BrandAppearance;
  paletteInput: Record<PaletteRole, string>;
  copy: BrandCopy;
  importSourceId?: string;
  importSourceName?: string;
}

export interface ImportError {
  path: string;
  message: string;
}

export interface ExportDocument {
  schemaVersion: 1;
  kind: "brand-kit-appearance";
  id: string;
  revision: number;
  name: string;
  artDirection: {
    presetId: PresetId;
    traits: string[];
    materialLanguage: string;
  };
  visual: {
    tokenVersion: "dtcg-example-v1";
    palette: BrandPalette;
    typography: BrandTypography;
    texture: string;
    spacing: SpacingDensity;
    cornerRadius: CornerRadius;
  };
}
