/**
 * Intent-led still-image recipes compiled into the existing M0 MediaDocument.
 * No thumbnail renderer, platform SDK, implicit assets or hidden content model.
 * The consumer supplies the subjects and truthful wording; all layers remain editable.
 */
import {
  createDocument,
  defaultSafeRegion,
  round,
  type Diagnostic,
  type FontAsset,
  type ImageAsset,
  type Layer,
  type MediaDocument,
  type MediaLayer,
  type Rect,
  type ShapeLayer,
  type Size,
  type TextLayer,
  validateDocument,
} from "./document";

export type ThumbnailRecipeId =
  | "hero-fact"
  | "comparison"
  | "hidden-mechanism"
  | "before-after"
  | "scale-surprise";

export interface ThumbnailPalette {
  background: string;
  foreground: string;
  accent: string;
  surface: string;
}

export interface ThumbnailCompositionInput {
  id: string;
  recipe: ThumbnailRecipeId;
  primary: ImageAsset;
  secondary?: ImageAsset;
  headline: string;
  /** Optional large *supplied* cue, such as a verified figure; never generated. */
  cue?: string;
  font: FontAsset;
  /** Landscape 16:9 authoring size, default 1280×720. */
  size?: Size;
  palette?: Partial<ThumbnailPalette>;
  /** `cover` fills the slot and crops around the focal point; `contain` shows the entire visual. */
  primaryFit?: "contain" | "cover";
  secondaryFit?: "contain" | "cover";
  primaryFocalPoint?: { x: number; y: number };
  secondaryFocalPoint?: { x: number; y: number };
}

export interface ThumbnailCompositionRoles {
  primaryId: string;
  secondaryId?: string;
  headlineId: string;
  cueId?: string;
}

export interface ThumbnailCompositionResult {
  document: MediaDocument;
  roles: ThumbnailCompositionRoles;
  recipe: ThumbnailRecipeId;
}

const DEFAULT_PALETTE: ThumbnailPalette = {
  background: "#101a25",
  foreground: "#f7f8f5",
  accent: "#f5bd55",
  surface: "#223443",
};

const TWO_SUBJECT_RECIPES: readonly ThumbnailRecipeId[] = ["comparison", "before-after"];
const RECIPES: readonly ThumbnailRecipeId[] = [
  "hero-fact", "comparison", "hidden-mechanism", "before-after", "scale-surprise",
];
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export class ThumbnailCompositionError extends Error {
  readonly diagnostics: Diagnostic[];
  constructor(diagnostics: Diagnostic[]) {
    super(diagnostics.map((diagnostic) => diagnostic.message).join("; "));
    this.name = "ThumbnailCompositionError";
    this.diagnostics = diagnostics;
  }
}

function problem(code: string, message: string): Diagnostic {
  return { code, message, severity: "error" };
}

function validAsset(asset: ImageAsset | undefined): boolean {
  return Boolean(asset && typeof asset.id === "string" && ID_PATTERN.test(asset.id) &&
    typeof asset.uri === "string" && asset.uri.trim() &&
    typeof asset.mediaType === "string" && asset.mediaType.startsWith("image/") &&
    asset.alt?.trim() && (asset.width === undefined || (Number.isFinite(asset.width) && asset.width > 0)) &&
    (asset.height === undefined || (Number.isFinite(asset.height) && asset.height > 0)));
}

function validFocalPoint(point: { x: number; y: number } | undefined): boolean {
  return point === undefined || [point.x, point.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1);
}

/** A renderer-safe palette: literal SVG-compatible hex, not unresolved CSS variables. */
function resolvePalette(overrides: Partial<ThumbnailPalette> | undefined): ThumbnailPalette {
  const palette = { ...DEFAULT_PALETTE, ...overrides };
  if (Object.values(palette).some((color) => !/^#(?:[a-f\d]{3}|[a-f\d]{6})$/i.test(color))) {
    throw new ThumbnailCompositionError([problem("thumbnail-palette-invalid", "Use literal hex colors for portable still-image export.")]);
  }
  return palette;
}

/** Geometry for 1280×720 design space; re-author to different 16:9 sizes, never distort. */
function layout(recipe: ThumbnailRecipeId): {
  primary: SlotRect; secondary?: SlotRect; headline: TextSlot; cue: TextSlot;
} {
  switch (recipe) {
    case "hero-fact": return {
      primary: [575, 62, 655, 588], headline: [64, 118, 495, 255, 82], cue: [66, 486, 490, 155, 104],
    };
    case "comparison": return {
      primary: [52, 180, 542, 430], secondary: [686, 180, 542, 430],
      headline: [68, 46, 1144, 120, 78], cue: [470, 622, 340, 70, 48],
    };
    case "hidden-mechanism": return {
      primary: [452, 72, 762, 568], headline: [62, 102, 376, 277, 76], cue: [62, 482, 365, 165, 93],
    };
    case "before-after": return {
      primary: [54, 174, 554, 440], secondary: [672, 174, 554, 440],
      headline: [64, 45, 1152, 116, 78], cue: [66, 623, 475, 68, 48],
    };
    case "scale-surprise": return {
      primary: [50, 198, 447, 452], headline: [532, 117, 668, 245, 91],
      cue: [535, 420, 665, 177, 126],
    };
  }
}

type SlotRect = readonly [number, number, number, number];
type TextSlot = readonly [number, number, number, number, number];

/** Public output coordinates are positive design pixels, not proportions or screenshots. */
function rect(slot: SlotRect | TextSlot, factor: number): Rect {
  return { x: round(slot[0] * factor), y: round(slot[1] * factor),
    width: round(slot[2] * factor), height: round(slot[3] * factor) };
}

function base(id: string, name: string, transform: Rect, z: number) {
  return { id, semanticId: id, name, transform, z, visible: true, locked: false, opacity: 1,
    blend: "normal" as const, clip: false };
}

function subject(id: string, asset: ImageAsset, slot: SlotRect, factor: number,
  focalPoint?: { x: number; y: number }, fit: "contain" | "cover" = "contain"): MediaLayer {
  return { ...base(id, id === "subject-primary" ? "Primary visual" : "Secondary visual", rect(slot, factor), 20),
    kind: "media", summary: asset.alt,
    media: { assetId: asset.id, fit, focalPoint: focalPoint ?? { x: .5, y: .5 },
      mask: { kind: "none" }, alt: asset.alt } };
}

function text(id: string, value: string, slot: TextSlot, factor: number,
  font: FontAsset): TextLayer {
  return { ...base(id, id === "headline" ? "Primary claim" : "Evidence cue", rect(slot, factor), 50),
    kind: "text", text: { spans: [{ text: value }], fontId: font.id,
      size: round(slot[4] * factor), minSize: round(slot[4] * factor * .52),
      lineHeight: 1.05, letterSpacing: -1.6 * factor, align: "start", direction: "auto",
      fit: "shrink", as: "div" } ,
    summary: value,
    // Text paint is owned by span colors; it survives SVG export outside the app's CSS.
  };
}

function panel(id: string, placement: SlotRect, factor: number, fill: string, z: number): ShapeLayer {
  return { ...base(id, "Visual backing", rect(placement, factor), z), kind: "shape",
    shape: { kind: "rect", fill, radius: 20 * factor } };
}

function colorText(layer: TextLayer, color: string): TextLayer {
  return { ...layer, text: { ...layer.text,
    spans: layer.text.spans.map((span) => ({ ...span, color })) } };
}

/** Compile an authored message into normal, editable MediaDocument layers. */
export function composeThumbnail(input: ThumbnailCompositionInput): ThumbnailCompositionResult {
  const issues: Diagnostic[] = [];
  const size = input.size ?? { width: 1280, height: 720 };
  if (typeof input.id !== "string" || !input.id.trim()) issues.push(problem("thumbnail-id-required", "Supply a nonempty composition id."));
  else if (!ID_PATTERN.test(input.id)) issues.push(problem("thumbnail-id-invalid", "Composition id must be a valid document slug."));
  if (!RECIPES.includes(input.recipe)) issues.push(problem("thumbnail-recipe-unknown", "Unknown thumbnail recipe."));
  if (typeof input.headline !== "string" || !input.headline.trim()) issues.push(problem("thumbnail-headline-required", "Supply a meaningful headline; no copy will be invented."));
  if (!validAsset(input.primary)) issues.push(problem("thumbnail-asset-invalid", "Primary visual needs a valid id, URI, type, alt and optional positive dimensions."));
  if (TWO_SUBJECT_RECIPES.includes(input.recipe) && !input.secondary)
    issues.push(problem("thumbnail-secondary-required", "This recipe needs a distinct second visual."));
  else if (input.secondary && !validAsset(input.secondary))
    issues.push(problem("thumbnail-secondary-invalid", "The supplied secondary visual must be a supported image with valid id, URI and alt text."));
  if (input.secondary && input.primary?.id === input.secondary.id)
    issues.push(problem("thumbnail-asset-id-duplicate", "Primary and secondary visuals must have different asset IDs."));
  if (!input.font?.id?.trim() || !input.font.family?.trim())
    issues.push(problem("thumbnail-font-invalid", "A declared display font is required for editable text export."));
  if (![size.width, size.height].every((value) => Number.isSafeInteger(value) && value > 0) ||
      Math.abs(size.width / size.height - 16 / 9) > .001)
    issues.push(problem("thumbnail-aspect-invalid", "Use a positive integer-pixel 16:9 authoring canvas (for example, 1280×720)."));
  if ([input.primaryFit, input.secondaryFit].some((fit) => fit !== undefined && fit !== "contain" && fit !== "cover"))
    issues.push(problem("thumbnail-fit-invalid", "Subjects support `contain` or `cover` (focal cropping), not distortion."));
  if (!validFocalPoint(input.primaryFocalPoint) || !validFocalPoint(input.secondaryFocalPoint))
    issues.push(problem("thumbnail-focal-point-invalid", "Normalized focal coordinates must fall in [0,1]."));
  if (issues.length) throw new ThumbnailCompositionError(issues);

  const palette = resolvePalette(input.palette);
  const factor = size.width / 1280;
  const template = layout(input.recipe);
  const layers: Layer[] = [];
  // Backing panels visibly separate independent subjects, without altering their source imagery.
  if (template.secondary) {
    layers.push(panel("backing-primary", template.primary, factor, palette.surface, 5));
    layers.push(panel("backing-secondary", template.secondary, factor, palette.surface, 5));
  }
  layers.push(subject("subject-primary", input.primary, template.primary, factor, input.primaryFocalPoint, input.primaryFit));
  if (template.secondary && input.secondary)
    layers.push(subject("subject-secondary", input.secondary, template.secondary, factor, input.secondaryFocalPoint, input.secondaryFit));
  layers.push(colorText(text("headline", input.headline, template.headline, factor, input.font), palette.foreground));
  if (input.cue?.trim() && template.cue)
    layers.push(colorText(text("cue", input.cue, template.cue, factor, input.font), palette.accent));
  // A single editorial accent carries visual identity without hard-coding a channel theme.
  layers.push(panel("accent-mark", [64, 20, 108, 8],
    factor, palette.accent, 35));

  const assets: Record<string, ImageAsset> = { [input.primary.id]: { ...input.primary } };
  if (template.secondary && input.secondary) assets[input.secondary.id] = { ...input.secondary };
  const roles: ThumbnailCompositionRoles = {
    primaryId: "subject-primary", headlineId: "headline",
    ...(template.secondary ? { secondaryId: "subject-secondary" } : {}),
    ...(input.cue?.trim() ? { cueId: "cue" } : {}),
  };
  const document = createDocument({ id: input.id,
      artboard: { id: `${input.id}-artboard`, width: size.width, height: size.height,
        background: palette.background, safeRegion: defaultSafeRegion(size) },
      fonts: { [input.font.id]: { ...input.font } }, assets, layers,
      metadata: { title: input.headline, locale: "und" },
    });
  const schemaIssues = validateDocument(document).filter((diagnostic) => diagnostic.severity === "error");
  if (schemaIssues.length) throw new ThumbnailCompositionError(schemaIssues);
  return { recipe: input.recipe, roles, document };
}
