import { createArtboard, createDocument, normalizeDocument } from "@/components/media/document";
import type {
  FontAsset,
  Layer,
  LayerBase,
  MediaDocument,
  Size,
  TextSpec,
} from "@/components/media/document";
import { copyFor } from "../i18n";
import { CONCEPT_COMPOSITION, CONCEPT_ELEMENTS } from "./concepts";
import { paletteFor } from "./palettes";
import type {
  CompositionId,
  ConceptId,
  Locale,
  ThumbnailBrandStyle,
  ThumbnailCopy,
  ThumbnailDocument,
  ThumbnailPalette,
  ThumbnailVariant,
} from "./types";

const SANS_FALLBACK = [
  "ui-sans-serif",
  "system-ui",
  "-apple-system",
  "Hiragino Sans",
  "Yu Gothic",
  "Noto Sans JP",
  "sans-serif",
];

const SERIF_FALLBACK = [
  "Georgia",
  "Times New Roman",
  "Hiragino Mincho ProN",
  "Yu Mincho",
  "Noto Serif JP",
  "serif",
];

export interface ComposeOptions {
  variantId?: string;
  locale?: Locale;
}

export interface TextPlacement {
  layerId: string;
  spec: TextSpec;
  box: Size;
  /** Essential meaning that must stay readable at 160 px wide. */
  salient: boolean;
}

export interface ComposedThumbnail {
  media: MediaDocument;
  variant: ThumbnailVariant;
  concept: ConceptId;
  composition: CompositionId;
  locale: Locale;
  palette: ThumbnailPalette;
  text: {
    headline: TextPlacement;
    value: TextPlacement;
    secondary: TextPlacement;
    compare?: TextPlacement;
  };
  /** Full-bleed or decorative ids excluded from the safe-margin check. */
  exclusions: string[];
  elementIds: string[];
}

interface FontIds {
  display: string;
  numbers: string;
  body: string;
  label: string;
}

interface Context {
  palette: ThumbnailPalette;
  fonts: Record<string, FontAsset>;
  fontIds: FontIds;
  copy: ThumbnailCopy;
  kicker: string;
  footnote: string;
  language: string;
  brandName: string;
  partLabels: [string, string, string, string];
  panelLeft: string;
  panelRight: string;
  comparisonWord: string;
}

function fontAsset(
  id: string,
  family: string,
  weight: number
): FontAsset {
  const serif = /newsreader|serif/i.test(family);
  return {
    id,
    family,
    weight,
    style: "normal",
    fallback: serif ? SERIF_FALLBACK : SANS_FALLBACK,
    availability: "pinned",
    licenseId: "OFL-1.1",
  };
}

export function fontsForBrand(brand: ThumbnailBrandStyle): {
  fonts: Record<string, FontAsset>;
  fontIds: FontIds;
} {
  const fontIds: FontIds = {
    display: "font-display",
    numbers: "font-numbers",
    body: "font-body",
    label: "font-label",
  };
  return {
    fontIds,
    fonts: {
      [fontIds.display]: fontAsset(fontIds.display, brand.typography.display.family, brand.typography.display.weight),
      [fontIds.numbers]: fontAsset(fontIds.numbers, brand.typography.numbers.family, brand.typography.numbers.weight),
      [fontIds.body]: fontAsset(fontIds.body, brand.typography.body.family, brand.typography.body.weight),
      [fontIds.label]: fontAsset(fontIds.label, brand.typography.body.family, 600),
    },
  };
}

function base(
  id: string,
  name: string,
  kind: LayerBase["kind"],
  x: number,
  y: number,
  width: number,
  height: number,
  extra: Partial<LayerBase> = {}
): LayerBase {
  return {
    id,
    semanticId: id,
    name,
    kind,
    transform: { x, y, width, height },
    z: 0,
    visible: true,
    locked: false,
    opacity: 1,
    blend: "normal",
    clip: false,
    ...extra,
  };
}

interface RectInput {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
  opacity?: number;
  rotation?: number;
  anchorX?: number;
  anchorY?: number;
  summary?: string;
  background?: boolean;
}

function rect(id: string, name: string, x: number, y: number, width: number, height: number, input: RectInput = {}): Layer {
  const { opacity, rotation, anchorX, anchorY, summary, background, ...shape } = input;
  const layer = base(id, name, "shape", x, y, width, height, {
    opacity: opacity ?? 1,
    summary: summary ?? (background ? undefined : name),
    ...(rotation ? { transform: { x, y, width, height, rotation, anchorX, anchorY } } : {}),
  });
  return {
    ...layer,
    kind: "shape",
    shape: { kind: "rect", ...shape },
    clip: false,
  } as Layer;
}

interface EllipseInput {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
  rotation?: number;
  anchorX?: number;
  anchorY?: number;
  summary?: string;
}

function ellipse(id: string, name: string, x: number, y: number, width: number, height: number, input: EllipseInput = {}): Layer {
  const { opacity, rotation, anchorX, anchorY, summary, ...shape } = input;
  const layer = base(id, name, "shape", x, y, width, height, {
    opacity: opacity ?? 1,
    summary: summary ?? name,
    ...(rotation ? { transform: { x, y, width, height, rotation, anchorX, anchorY } } : {}),
  });
  return { ...layer, kind: "shape", shape: { kind: "ellipse", ...shape }, clip: false } as Layer;
}

interface TextInput {
  id: string;
  name: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontId: string;
  size: number;
  lineHeight?: number;
  letterSpacing?: number;
  align?: TextSpec["align"];
  color: string;
  as?: TextSpec["as"];
  fit?: TextSpec["fit"];
  maxLines?: number;
  minSize?: number;
  maxSize?: number;
  language: string;
  summary?: string;
}

function textLayer(input: TextInput): { layer: Layer; spec: TextSpec; box: Size } {
  const spec: TextSpec = {
    spans: [{ text: input.text, color: input.color }],
    fontId: input.fontId,
    size: input.size,
    lineHeight: input.lineHeight ?? 1.18,
    letterSpacing: input.letterSpacing ?? 0,
    align: input.align ?? "start",
    direction: "auto",
    language: input.language,
    fit: input.fit ?? "wrap",
    as: input.as ?? "p",
    ...(input.maxLines !== undefined ? { maxLines: input.maxLines } : {}),
    ...(input.minSize !== undefined ? { minSize: input.minSize } : {}),
    ...(input.maxSize !== undefined ? { maxSize: input.maxSize } : {}),
  };
  const layer = base(input.id, input.name, "text", input.x, input.y, input.width, input.height, {
    summary: input.summary ?? input.text,
  });
  return {
    layer: { ...layer, kind: "text", text: spec, clip: false } as Layer,
    spec,
    box: { width: input.width, height: input.height },
  };
}

function pack(layers: Layer[]): Layer[] {
  return layers.map((layer, index) => ({ ...layer, z: index }));
}

function contextFor(
  document: ThumbnailDocument,
  variant: ThumbnailVariant,
  locale: Locale
): Context {
  const copy = copyFor(locale);
  const artwork = variant.copy[locale] ?? variant.copy.en;
  const { fonts, fontIds } = fontsForBrand(document.brand);
  return {
    palette: paletteFor(document.paletteId),
    fonts,
    fontIds,
    copy: artwork,
    kicker: copy.kickers[variant.concept],
    footnote: copy.footnotes[variant.concept],
    language: locale === "ja" ? "ja" : "en",
    brandName: document.brand.brandName,
    partLabels: copy.partLabels,
    panelLeft: copy.panelLeftLabel,
    panelRight: copy.panelRightLabel,
    comparisonWord: copy.comparisonWord,
  };
}

/** Concept A — one dominant unit and one unresolved figure. */
function composePriceShock(ctx: Context): { layers: Layer[]; text: ComposedThumbnail["text"]; exclusions: string[] } {
  const p = ctx.palette.roles;
  const layers: Layer[] = [];
  const exclusions = ["a-bg", "a-edge"];

  layers.push(rect("a-bg", "Ground", 0, 0, 1280, 720, { fill: p.background, background: true, summary: "Background" }));
  layers.push(rect("a-edge", "Accent edge", 0, 0, 14, 720, { fill: p.accent, opacity: 0.9, summary: "Accent edge" }));

  layers.push(rect("a-unit-body", "Condenser cabinet", 84, 282, 384, 332, {
    fill: p.surface,
    radius: 22,
    summary: "Outdoor condenser unit",
  }));
  layers.push(ellipse("a-fan-ring", "Fan shroud", 140, 312, 272, 272, {
    fill: p.background,
    stroke: p.muted,
    strokeWidth: 6,
    summary: "Fan opening",
  }));
  [0, 60, 120].forEach((rotation, index) => {
    layers.push(rect(`a-blade-${index + 1}`, "Fan blade", 156, 442, 240, 12, {
      fill: p.muted,
      radius: 6,
      opacity: 0.75,
      rotation,
      anchorX: 0.5,
      anchorY: 0.5,
      summary: "Fan blade",
    }));
  });
  [0, 1, 2].forEach((index) => {
    layers.push(rect(`a-grille-${index + 1}`, "Discharge grille", 120, 288 + index * 11, 320, 5, {
      fill: p.muted,
      opacity: 0.4,
      radius: 2.5,
      summary: "Discharge grille",
    }));
  });
  layers.push(ellipse("a-fan-hub", "Fan hub", 246, 418, 60, 60, { fill: p.accent, summary: "Fan hub" }));
  layers.push(rect("a-pipe", "Refrigerant line", 472, 212, 16, 96, { fill: p.accent, radius: 8, summary: "Refrigerant line" }));
  layers.push(rect("a-pipe-elbow", "Line elbow", 472, 212, 72, 16, { fill: p.accent, radius: 8, summary: "Line elbow" }));
  layers.push(rect("a-foot-left", "Cabinet foot", 120, 614, 64, 18, { fill: p.muted, opacity: 0.8, radius: 3, summary: "Cabinet foot" }));
  layers.push(rect("a-foot-right", "Cabinet foot", 368, 614, 64, 18, { fill: p.muted, opacity: 0.8, radius: 3, summary: "Cabinet foot" }));
  layers.push(rect("a-ground", "Ground line", 84, 640, 540, 4, { fill: p.muted, opacity: 0.35, summary: "Ground line" }));

  const kicker = textLayer({
    id: "a-kicker",
    name: "Kicker",
    text: ctx.kicker,
    x: 524,
    y: 188,
    width: 620,
    height: 36,
    fontId: ctx.fontIds.label,
    size: 28,
    letterSpacing: 7,
    color: p.muted,
    as: "span",
    fit: "wrap",
    maxLines: 1,
    language: ctx.language,
    summary: ctx.kicker,
  });
  layers.push(kicker.layer);

  const value = textLayer({
    id: "a-value",
    name: "Key figure",
    text: ctx.copy.value,
    x: 520,
    y: 236,
    width: 660,
    height: 206,
    fontId: ctx.fontIds.display,
    size: 156,
    lineHeight: 1,
    color: p.accent,
    as: "p",
    fit: "shrink",
    maxLines: 1,
    minSize: 92,
    maxSize: 156,
    language: ctx.language,
    summary: `Key figure ${ctx.copy.value}`,
  });
  layers.push(value.layer);

  layers.push(rect("a-rule", "Accent rule", 524, 452, 132, 8, { fill: p.accent, radius: 4, summary: "Accent rule" }));

  const headline = textLayer({
    id: "a-headline",
    name: "Headline",
    text: ctx.copy.headline,
    x: 524,
    y: 470,
    width: 640,
    height: 124,
    fontId: ctx.fontIds.display,
    size: 48,
    lineHeight: 1.08,
    color: p.text,
    as: "p",
    fit: "shrink",
    maxLines: 3,
    minSize: 32,
    maxSize: 52,
    language: ctx.language,
    summary: ctx.copy.headline,
  });
  layers.push(headline.layer);

  const secondary = textLayer({
    id: "a-secondary",
    name: "Secondary line",
    text: ctx.copy.secondary,
    x: 524,
    y: 600,
    width: 640,
    height: 44,
    fontId: ctx.fontIds.body,
    size: 23,
    lineHeight: 1.3,
    color: p.muted,
    as: "p",
    fit: "wrap",
    maxLines: 2,
    language: ctx.language,
    summary: ctx.copy.secondary,
  });
  layers.push(secondary.layer);

  const footnote = textLayer({
    id: "a-footnote",
    name: "Synthetic value note",
    text: ctx.footnote,
    x: 84,
    y: 652,
    width: 600,
    height: 24,
    fontId: ctx.fontIds.body,
    size: 20,
    lineHeight: 1.2,
    color: p.muted,
    as: "span",
    fit: "wrap",
    maxLines: 1,
    language: ctx.language,
    summary: ctx.footnote,
  });
  layers.push(footnote.layer);

  layers.push(
    textLayer({
      id: "a-brand",
      name: "Channel mark",
      text: ctx.brandName,
      x: 84,
      y: 44,
      width: 260,
      height: 22,
      fontId: ctx.fontIds.label,
      size: 18,
      letterSpacing: 2,
      color: p.muted,
      as: "span",
      fit: "wrap",
      maxLines: 1,
      language: ctx.language,
      summary: `Channel: ${ctx.brandName}`,
    }).layer
  );

  return {
    layers: pack(layers),
    exclusions,
    text: {
      headline: { layerId: "a-headline", spec: headline.spec, box: headline.box, salient: true },
      value: { layerId: "a-value", spec: value.spec, box: value.box, salient: true },
      secondary: { layerId: "a-secondary", spec: secondary.spec, box: secondary.box, salient: false },
    },
  };
}

/** Concept B — the equipment pulled apart into the layers a quote bundles. */
function composeHiddenCost(ctx: Context): { layers: Layer[]; text: ComposedThumbnail["text"]; exclusions: string[] } {
  const p = ctx.palette.roles;
  const layers: Layer[] = [];
  const exclusions = ["b-bg", "b-edge"];

  layers.push(rect("b-bg", "Ground", 0, 0, 1280, 720, { fill: p.background, background: true, summary: "Background" }));
  layers.push(rect("b-edge", "Accent edge", 0, 0, 1280, 10, { fill: p.accent, summary: "Accent edge" }));

  layers.push(
    textLayer({
      id: "b-brand",
      name: "Channel mark",
      text: ctx.brandName,
      x: 84,
      y: 44,
      width: 260,
      height: 22,
      fontId: ctx.fontIds.label,
      size: 18,
      letterSpacing: 2,
      color: p.muted,
      as: "span",
      fit: "wrap",
      maxLines: 1,
      language: ctx.language,
      summary: `Channel: ${ctx.brandName}`,
    }).layer
  );

  const kicker = textLayer({
    id: "b-kicker",
    name: "Kicker",
    text: ctx.kicker,
    x: 84,
    y: 76,
    width: 520,
    height: 32,
    fontId: ctx.fontIds.label,
    size: 24,
    letterSpacing: 6,
    color: p.muted,
    as: "span",
    fit: "wrap",
    maxLines: 1,
    language: ctx.language,
    summary: ctx.kicker,
  });
  layers.push(kicker.layer);

  const value = textLayer({
    id: "b-value",
    name: "Key figure",
    text: ctx.copy.value,
    x: 84,
    y: 116,
    width: 470,
    height: 110,
    fontId: ctx.fontIds.display,
    size: 100,
    lineHeight: 1,
    color: p.accent,
    as: "p",
    fit: "shrink",
    maxLines: 1,
    minSize: 62,
    maxSize: 100,
    language: ctx.language,
    summary: `Key figure ${ctx.copy.value}`,
  });
  layers.push(value.layer);

  const headline = textLayer({
    id: "b-headline",
    name: "Headline",
    text: ctx.copy.headline,
    x: 84,
    y: 232,
    width: 500,
    height: 148,
    fontId: ctx.fontIds.display,
    size: 46,
    lineHeight: 1.1,
    color: p.text,
    as: "p",
    fit: "shrink",
    maxLines: 3,
    minSize: 32,
    maxSize: 46,
    language: ctx.language,
    summary: ctx.copy.headline,
  });
  layers.push(headline.layer);

  const secondary = textLayer({
    id: "b-secondary",
    name: "Secondary line",
    text: ctx.copy.secondary,
    x: 84,
    y: 392,
    width: 520,
    height: 92,
    fontId: ctx.fontIds.body,
    size: 23,
    lineHeight: 1.35,
    color: p.muted,
    as: "p",
    fit: "wrap",
    maxLines: 3,
    language: ctx.language,
    summary: ctx.copy.secondary,
  });
  layers.push(secondary.layer);

  layers.push(rect("b-rule", "Divider", 84, 524, 360, 3, { fill: p.muted, opacity: 0.45, summary: "Divider" }));

  const segmentYs = [92, 228, 364, 500];
  const segmentX = 680;
  const segmentW = 340;
  const segmentH = 96;
  const detailTints = [p.accent, p.evidence, p.muted, p.positive];

  segmentYs.forEach((y, index) => {
    const n = index + 1;
    layers.push(
      rect(`b-seg-${n}`, `${ctx.partLabels[index]} layer`, segmentX, y, segmentW, segmentH, {
        fill: p.surface,
        radius: 16,
        summary: `${ctx.partLabels[index]} layer`,
      })
    );
    const tint = detailTints[index] ?? p.muted;
    if (index === 0) {
      layers.push(ellipse("b-seg-1-detail", "Fan opening", segmentX + 30, y + 18, 60, 60, {
        fill: p.background,
        stroke: tint,
        strokeWidth: 3,
        summary: "Fan opening",
      }));
      layers.push(ellipse("b-seg-1-detail-2", "Fan hub", segmentX + 47, y + 35, 26, 26, { fill: tint, summary: "Fan hub" }));
      layers.push(rect("b-seg-1-fins", "Coil fins", segmentX + 112, y + 26, 188, 8, { fill: p.muted, opacity: 0.5, radius: 4, summary: "Coil fins" }));
      layers.push(rect("b-seg-1-fins-2", "Coil fins", segmentX + 112, y + 44, 148, 8, { fill: p.muted, opacity: 0.5, radius: 4, summary: "Coil fins" }));
      layers.push(rect("b-seg-1-fins-3", "Coil fins", segmentX + 112, y + 62, 108, 8, { fill: p.muted, opacity: 0.5, radius: 4, summary: "Coil fins" }));
    } else if (index === 1) {
      layers.push(ellipse("b-seg-2-detail", "Compressor", segmentX + 30, y + 20, 56, 56, { fill: tint, summary: "Compressor" }));
      layers.push(ellipse("b-seg-2-detail-2", "Service valve", segmentX + 47, y + 37, 22, 22, { fill: p.surface, summary: "Service valve" }));
      layers.push(rect("b-seg-2-detail-3", "Refrigerant lines", segmentX + 116, y + 30, 172, 6, { fill: tint, opacity: 0.85, radius: 3, summary: "Refrigerant line" }));
      layers.push(rect("b-seg-2-detail-4", "Refrigerant lines", segmentX + 116, y + 46, 128, 6, { fill: tint, opacity: 0.6, radius: 3, summary: "Refrigerant line" }));
      layers.push(rect("b-seg-2-detail-5", "Service panel", segmentX + 116, y + 62, 72, 14, { fill: p.muted, opacity: 0.28, radius: 4, summary: "Service panel" }));
    } else if (index === 2) {
      layers.push(rect("b-seg-3-detail", "Duct trunk", segmentX + 30, y + 16, 196, 46, {
        fill: p.background,
        stroke: tint,
        strokeWidth: 2,
        radius: 8,
        summary: "Duct trunk",
      }));
      layers.push(rect("b-seg-3-detail-2", "Duct opening", segmentX + 48, y + 31, 160, 16, { fill: tint, opacity: 0.3, radius: 4, summary: "Duct opening" }));
      layers.push(rect("b-seg-3-detail-3", "Duct branch", segmentX + 30, y + 62, 112, 18, { fill: p.background, stroke: tint, strokeWidth: 2, radius: 6, summary: "Duct branch" }));
    } else {
      layers.push(rect("b-seg-4-detail", "Base pan", segmentX + 30, y + 52, 196, 12, { fill: tint, opacity: 0.55, radius: 4, summary: "Base pan" }));
      layers.push(rect("b-seg-4-detail-2", "Cabinet foot", segmentX + 48, y + 68, 32, 12, { fill: p.muted, opacity: 0.5, radius: 3, summary: "Cabinet foot" }));
      layers.push(rect("b-seg-4-detail-3", "Cabinet foot", segmentX + 176, y + 68, 32, 12, { fill: p.muted, opacity: 0.5, radius: 3, summary: "Cabinet foot" }));
      layers.push(rect("b-seg-4-detail-4", "Line-set port", segmentX + 244, y + 24, 8, 48, { fill: tint, opacity: 0.7, radius: 4, summary: "Line-set port" }));
      layers.push(rect("b-seg-4-detail-5", "Permit slip", segmentX + 30, y + 18, 112, 24, { fill: p.surface, stroke: p.muted, strokeWidth: 1.5, radius: 4, summary: "Permit slip" }));
    }

    layers.push(rect(`b-leader-${n}`, "Leader line", 1024, y + 47, 14, 2, { fill: p.muted, opacity: 0.6, summary: "Leader line" }));
    layers.push(
      textLayer({
        id: `b-label-${n}`,
        name: `${ctx.partLabels[index]} label`,
        text: ctx.partLabels[index],
        x: 1046,
        y: y + 32,
        width: 170,
        height: 32,
        fontId: ctx.fontIds.label,
        size: 23,
        color: p.text,
        as: "span",
        fit: "wrap",
        maxLines: 2,
        language: ctx.language,
        summary: ctx.partLabels[index],
      }).layer
    );
  });

  layers.push(
    rect("b-seg-1-highlight", "Highlighted layer", segmentX - 3, segmentYs[0] - 3, segmentW + 6, segmentH + 6, {
      fill: "transparent",
      stroke: p.accent,
      strokeWidth: 3,
      radius: 18,
      summary: "Highlighted equipment layer",
    })
  );

  const footnote = textLayer({
    id: "b-footnote",
    name: "Synthetic value note",
    text: ctx.footnote,
    x: 84,
    y: 650,
    width: 600,
    height: 24,
    fontId: ctx.fontIds.body,
    size: 20,
    lineHeight: 1.2,
    color: p.muted,
    as: "span",
    fit: "wrap",
    maxLines: 1,
    language: ctx.language,
    summary: ctx.footnote,
  });
  layers.push(footnote.layer);

  return {
    layers: pack(layers),
    exclusions,
    text: {
      headline: { layerId: "b-headline", spec: headline.spec, box: headline.box, salient: true },
      value: { layerId: "b-value", spec: value.spec, box: value.box, salient: true },
      secondary: { layerId: "b-secondary", spec: secondary.spec, box: secondary.box, salient: false },
    },
  };
}

/** Concept C — advertised equipment price beside the installed total. */
function composeQuoteGap(ctx: Context): { layers: Layer[]; text: ComposedThumbnail["text"]; exclusions: string[] } {
  const p = ctx.palette.roles;
  const layers: Layer[] = [];
  const exclusions = ["c-bg"];

  layers.push(rect("c-bg", "Ground", 0, 0, 1280, 720, { fill: p.background, background: true, summary: "Background" }));

  layers.push(
    textLayer({
      id: "c-brand",
      name: "Channel mark",
      text: ctx.brandName,
      x: 64,
      y: 36,
      width: 220,
      height: 22,
      fontId: ctx.fontIds.label,
      size: 18,
      letterSpacing: 2,
      color: p.muted,
      as: "span",
      fit: "wrap",
      maxLines: 1,
      language: ctx.language,
      summary: `Channel: ${ctx.brandName}`,
    }).layer
  );

  const kicker = textLayer({
    id: "c-kicker",
    name: "Kicker",
    text: ctx.kicker,
    x: 300,
    y: 40,
    width: 900,
    height: 30,
    fontId: ctx.fontIds.label,
    size: 24,
    letterSpacing: 6,
    color: p.muted,
    as: "span",
    align: "end",
    fit: "wrap",
    maxLines: 1,
    language: ctx.language,
    summary: ctx.kicker,
  });
  layers.push(kicker.layer);

  const headline = textLayer({
    id: "c-headline",
    name: "Headline",
    text: ctx.copy.headline,
    x: 80,
    y: 84,
    width: 1120,
    height: 80,
    fontId: ctx.fontIds.display,
    size: 44,
    lineHeight: 1.1,
    color: p.text,
    as: "p",
    align: "center",
    fit: "shrink",
    maxLines: 2,
    minSize: 30,
    maxSize: 44,
    language: ctx.language,
    summary: ctx.copy.headline,
  });
  layers.push(headline.layer);

  layers.push(rect("c-rule", "Accent rule", 608, 172, 64, 4, { fill: p.accent, radius: 2, summary: "Accent rule" }));
  layers.push(rect("c-panel-left", "Advertised panel", 80, 196, 544, 400, { fill: p.surface, radius: 20, summary: "Advertised price panel" }));
  layers.push(
    rect("c-panel-right", "Installed panel", 656, 196, 544, 400, {
      fill: p.surface,
      stroke: p.accent,
      strokeWidth: 3,
      radius: 20,
      summary: "Installed cost panel",
    })
  );

  const labelLeft = textLayer({
    id: "c-label-left",
    name: "Left label",
    text: ctx.panelLeft,
    x: 112,
    y: 220,
    width: 480,
    height: 30,
    fontId: ctx.fontIds.label,
    size: 21,
    letterSpacing: 4,
    color: p.muted,
    as: "span",
    fit: "wrap",
    maxLines: 1,
    language: ctx.language,
    summary: ctx.panelLeft,
  });
  layers.push(labelLeft.layer);

  const labelRight = textLayer({
    id: "c-label-right",
    name: "Right label",
    text: ctx.panelRight,
    x: 688,
    y: 220,
    width: 480,
    height: 30,
    fontId: ctx.fontIds.label,
    size: 21,
    letterSpacing: 4,
    color: p.accent,
    as: "span",
    fit: "wrap",
    maxLines: 1,
    language: ctx.language,
    summary: ctx.panelRight,
  });
  layers.push(labelRight.layer);

  const compare = textLayer({
    id: "c-value-left",
    name: "Equipment figure",
    text: ctx.copy.compareValue ?? "$4,800",
    x: 112,
    y: 262,
    width: 480,
    height: 170,
    fontId: ctx.fontIds.display,
    size: 112,
    lineHeight: 1,
    color: p.muted,
    as: "p",
    fit: "shrink",
    maxLines: 1,
    minSize: 62,
    maxSize: 112,
    language: ctx.language,
    summary: `Equipment price ${ctx.copy.compareValue ?? ""}`,
  });
  layers.push(compare.layer);

  const value = textLayer({
    id: "c-value-right",
    name: "Installed figure",
    text: ctx.copy.value,
    x: 688,
    y: 262,
    width: 480,
    height: 170,
    fontId: ctx.fontIds.display,
    size: 132,
    lineHeight: 1,
    color: p.accent,
    as: "p",
    fit: "shrink",
    maxLines: 1,
    minSize: 64,
    maxSize: 132,
    language: ctx.language,
    summary: `Installed cost ${ctx.copy.value}`,
  });
  layers.push(value.layer);

  layers.push(rect("c-glyph-left-body", "Equipment silhouette", 268, 424, 168, 136, { fill: p.background, radius: 14, summary: "Equipment silhouette" }));
  [0, 1, 2].forEach((index) => {
    layers.push(rect(`c-glyph-left-vent-${index + 1}`, "Discharge grille", 292, 438 + index * 9, 120, 4, {
      fill: p.muted,
      opacity: 0.4,
      radius: 2,
      summary: "Discharge grille",
    }));
  });
  layers.push(ellipse("c-glyph-left-fan", "Equipment fan", 308, 454, 88, 88, { fill: p.background, stroke: p.muted, strokeWidth: 4, summary: "Equipment fan" }));
  layers.push(ellipse("c-glyph-left-hub", "Equipment hub", 338, 484, 28, 28, { fill: p.muted, summary: "Equipment hub" }));

  layers.push(rect("c-glyph-right-body", "Installed silhouette", 844, 424, 168, 136, { fill: p.background, radius: 14, summary: "Installed system silhouette" }));
  [0, 1, 2].forEach((index) => {
    layers.push(rect(`c-glyph-right-vent-${index + 1}`, "Discharge grille", 868, 438 + index * 9, 120, 4, {
      fill: p.accent,
      opacity: 0.45,
      radius: 2,
      summary: "Discharge grille",
    }));
  });
  layers.push(ellipse("c-glyph-right-fan", "Installed fan", 884, 454, 88, 88, { fill: p.background, stroke: p.accent, strokeWidth: 4, summary: "Installed system fan" }));
  layers.push(ellipse("c-glyph-right-hub", "Installed hub", 914, 484, 28, 28, { fill: p.accent, summary: "Installed system hub" }));
  layers.push(rect("c-glyph-right-pipe", "Line set", 1028, 424, 14, 88, { fill: p.accent, radius: 7, summary: "Line set" }));
  layers.push(rect("c-glyph-right-pipe-elbow", "Line set elbow", 1028, 424, 48, 14, { fill: p.accent, radius: 7, summary: "Line set elbow" }));

  layers.push(ellipse("c-vs-ring", "Comparison marker", 608, 366, 64, 64, {
    fill: p.background,
    stroke: p.muted,
    strokeWidth: 2,
    summary: "Comparison marker",
  }));
  layers.push(
    textLayer({
      id: "c-vs",
      name: "Comparison word",
      text: ctx.comparisonWord,
      x: 608,
      y: 382,
      width: 64,
      height: 32,
      fontId: ctx.fontIds.label,
      size: 22,
      color: p.muted,
      as: "span",
      align: "center",
      fit: "wrap",
      maxLines: 1,
      language: ctx.language,
      summary: ctx.comparisonWord,
    }).layer
  );

  const secondary = textLayer({
    id: "c-secondary",
    name: "Secondary line",
    text: ctx.copy.secondary,
    x: 80,
    y: 612,
    width: 1120,
    height: 36,
    fontId: ctx.fontIds.body,
    size: 23,
    lineHeight: 1.3,
    color: p.muted,
    as: "p",
    align: "center",
    fit: "wrap",
    maxLines: 1,
    language: ctx.language,
    summary: ctx.copy.secondary,
  });
  layers.push(secondary.layer);

  const footnote = textLayer({
    id: "c-footnote",
    name: "Synthetic value note",
    text: ctx.footnote,
    x: 80,
    y: 656,
    width: 1120,
    height: 24,
    fontId: ctx.fontIds.body,
    size: 19,
    lineHeight: 1.2,
    color: p.muted,
    as: "span",
    align: "center",
    fit: "wrap",
    maxLines: 1,
    language: ctx.language,
    summary: ctx.footnote,
  });
  layers.push(footnote.layer);

  return {
    layers: pack(layers),
    exclusions,
    text: {
      headline: { layerId: "c-headline", spec: headline.spec, box: headline.box, salient: true },
      value: { layerId: "c-value-right", spec: value.spec, box: value.box, salient: true },
      secondary: { layerId: "c-secondary", spec: secondary.spec, box: secondary.box, salient: false },
      compare: { layerId: "c-value-left", spec: compare.spec, box: compare.box, salient: true },
    },
  };
}

/** Adapt the authoring document to the Kumiki `MediaDocument` contract. */
export function composeThumbnail(
  document: ThumbnailDocument,
  options: ComposeOptions = {}
): ComposedThumbnail {
  const locale = options.locale ?? "en";
  const variant =
    document.variants.find((candidate) => candidate.id === (options.variantId ?? document.activeVariantId)) ??
    document.variants[0];
  if (!variant) {
    throw new Error("A thumbnail document needs at least one variant.");
  }

  const ctx = contextFor(document, variant, locale);
  const composed =
    variant.concept === "price-shock"
      ? composePriceShock(ctx)
      : variant.concept === "hidden-cost"
        ? composeHiddenCost(ctx)
        : composeQuoteGap(ctx);

  const artboard = createArtboard({
    id: `${variant.id}-artboard`,
    width: document.output.width,
    height: document.output.height,
    preset: "16:9",
    background: ctx.palette.roles.background,
    safeRegion: document.output.safeInset,
  });

  const media = normalizeDocument(
    createDocument({
      id: variant.id,
      artboard,
      fonts: ctx.fonts,
      assets: {},
      layers: composed.layers,
      guides: [],
      metadata: {
        title: `${document.topic} — ${variant.concept}`,
        authoringTool: "content-gen/thumbnail-composer",
        aspectVariant: "16:9",
        locale,
        notes: [
          "Synthetic demonstration values; not a real quote.",
          "Adapted from the thumbnail authoring document; Kumiki MediaDocument is the render contract.",
        ],
      },
    })
  );

  const expected = CONCEPT_ELEMENTS[variant.concept].map((element) => element.id);
  const actual = new Set(composed.layers.map((layer) => layer.id));

  return {
    media,
    variant,
    concept: variant.concept,
    composition: CONCEPT_COMPOSITION[variant.concept],
    locale,
    palette: ctx.palette,
    text: composed.text,
    exclusions: composed.exclusions,
    elementIds: expected.filter((id) => actual.has(id)),
  };
}
