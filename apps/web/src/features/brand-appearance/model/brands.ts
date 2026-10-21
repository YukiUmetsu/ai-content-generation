import type { BrandAppearance, BrandCopy, BrandState, PresetId } from "./types";
import { PRESETS } from "./presets";

export function createBrandAppearance(presetId: PresetId): BrandAppearance {
  const preset = PRESETS[presetId];
  return {
    presetId,
    palette: { ...preset.palette },
    typography: {
      display: { ...preset.typography.display },
      body: { ...preset.typography.body },
      numbers: { ...preset.typography.numbers },
    },
    texture: preset.texture,
    spacing: preset.spacing,
    cornerRadius: preset.cornerRadius,
    customized: false,
  };
}

export function createPaletteInput(palette: BrandAppearance["palette"]) {
  return { ...palette };
}

export function createBrandState(
  id: string,
  name: string,
  revision: number,
  presetId: PresetId,
  copy: BrandCopy
): BrandState {
  const appearance = createBrandAppearance(presetId);
  return {
    id,
    name,
    revision,
    appearance,
    paletteInput: createPaletteInput(appearance.palette),
    copy,
  };
}

const houseMathCopy: BrandCopy = {
  video: {
    kicker: "HOUSE MATH · EPISODE 12",
    title: "The $84,000 question",
    dek: "Two identical kitchens. Two very different bills.",
  },
  metric: {
    label: "20-YEAR COST GAP",
    value: "$84,200",
    delta: "31% over the original quote",
    positiveLabel: "Quoted",
    positiveValue: "$64,000",
    negativeLabel: "Actual",
    negativeValue: "$84,200",
    source: "Illustrative example — verify before publishing.",
  },
  thumbnail: {
    kicker: "KITCHEN RENOVATION",
    title: "THE $84,000 KITCHEN",
    badge: "31% OVER",
    footer: "House Math",
  },
};

const tidelineCopy: BrandCopy = {
  video: {
    kicker: "TIDELINE · FIELD NOTE 04",
    title: "The 30 cm shift",
    dek: "What a small rise in sea level costs one coastal town.",
  },
  metric: {
    label: "PROJECTED SEA-LEVEL RISE · 2060",
    value: "30 cm",
    delta: "1 in 8 homes in the floodplain",
    positiveLabel: "Today",
    positiveValue: "12 cm",
    negativeLabel: "2060",
    negativeValue: "30 cm",
    source: "Illustrative example — verify before publishing.",
  },
  thumbnail: {
    kicker: "COASTAL RISK",
    title: "THE 30 CM SHIFT",
    badge: "1 IN 8",
    footer: "Tideline",
  },
};

export const DEFAULT_BRANDS: BrandState[] = [
  createBrandState(
    "brand_house_math",
    "House Math",
    1,
    "modern-analytical",
    houseMathCopy
  ),
  createBrandState(
    "brand_tideline",
    "Tideline",
    1,
    "calm-editorial",
    tidelineCopy
  ),
];

export function applyPresetToBrand(
  brand: BrandState,
  presetId: PresetId
): BrandState {
  const next = createBrandAppearance(presetId);
  return {
    ...brand,
    appearance: next,
    paletteInput: createPaletteInput(next.palette),
  };
}
