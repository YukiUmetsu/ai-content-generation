/**
 * Authoring model for the Thumbnail Composer.
 *
 * This is deliberately *not* a second Kumiki media schema. It is the small,
 * versioned document a person edits (topic, concept, copy, palette, brand
 * reference) plus the QA/export record. `composeThumbnail` adapts it to the
 * vendored `MediaDocument` contract, which stays the single source of truth for
 * geometry, layers, fonts and export.
 */

export const THUMBNAIL_SCHEMA_VERSION = 1 as const;
export const THUMBNAIL_KIND = "thumbnail-document" as const;

/** Authoring canvas: YouTube's 16:9 video thumbnail. */
export const AUTHORING_SIZE = { width: 1280, height: 720 } as const;

/** Readability inspection widths required by the creative docs. */
export const INSPECTION_WIDTHS = [320, 160] as const;

/** 5% safe inset on every edge, matching the Kumiki artboard default. */
export const SAFE_INSET_RATIO = 0.05;

export type Locale = "en" | "ja";

/**
 * Composition grammar ids from docs/16 §3. Each concept is a genuinely
 * different information structure, not a palette swap.
 */
export type CompositionId = "number-reversal" | "exploded-cutaway" | "a-vs-b";

export type ConceptId = "price-shock" | "hidden-cost" | "quote-gap";

export type PaletteId = "blueprint" | "ledger" | "signal";

/** Semantic colour roles in the spirit of the DTCG roles in docs/15. */
export interface ThumbnailPaletteRoles {
  background: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  danger: string;
  positive: string;
  evidence: string;
}

export interface ThumbnailPalette {
  id: PaletteId;
  /** Neutral name shown in both locales. */
  name: string;
  /** Short description of the intended use, localized in the UI copy. */
  roles: ThumbnailPaletteRoles;
}

export interface ThumbnailTypeStyle {
  /** Real loaded family. Bundled families are "Geist Variable"/"Newsreader Variable". */
  family: string;
  weight: number;
}

/**
 * Local brand-style boundary. An approved BrandKit can replace this record
 * later; the editor only needs a palette id plus three type roles.
 */
export interface ThumbnailBrandStyle {
  brandId: string;
  brandName: string;
  revision: number;
  /** Brand-approved default palette; the document may override it. */
  paletteId: PaletteId;
  typography: {
    display: ThumbnailTypeStyle;
    numbers: ThumbnailTypeStyle;
    body: ThumbnailTypeStyle;
  };
}

/** Editable on-screen copy. `compareValue` is only used by the a-vs-b concept. */
export interface ThumbnailCopy {
  headline: string;
  value: string;
  secondary: string;
  /** Supporting figure for the side-by-side comparison concept. */
  compareValue?: string;
}

export type ElementRole =
  | "background"
  | "subject"
  | "part"
  | "figure"
  | "panel"
  | "rule"
  | "label"
  | "highlight"
  | "brand"
  | "footnote";

/** Stable ids for the visual elements a concept authors. */
export interface ThumbnailElementRef {
  id: string;
  role: ElementRole;
  /** Why the element exists; shown in the detail disclosure. */
  note: string;
}

export interface ThumbnailVariant {
  id: string;
  concept: ConceptId;
  /** Authoring copy per locale, so editing English never rewrites Japanese. */
  copy: Record<Locale, ThumbnailCopy>;
  /** Stable visual element ids this concept renders. */
  elements: ThumbnailElementRef[];
}

export type ThumbnailIssueCode =
  | "headline-too-long"
  | "value-too-long"
  | "secondary-too-long"
  | "headline-empty"
  | "value-empty"
  | "compare-empty"
  | "safe-margin"
  | "small-size-legibility"
  | "low-contrast"
  | "text-overlap"
  | "composition-failed";

export interface ThumbnailIssue {
  code: ThumbnailIssueCode;
  severity: "warning" | "error";
  variantId: string;
  locale: Locale;
  layerId?: string;
  /** Machine detail (measured values), never a localized sentence. */
  detail?: string;
}

export interface ThumbnailQa {
  status: "pass" | "warnings" | "blocked";
  /** Document revision the snapshot was computed for. */
  checkedRevision: number;
  issues: ThumbnailIssue[];
}

export interface ThumbnailExportRecord {
  format: "svg" | "png";
  width: number;
  height: number;
  fileName: string;
  revision: number;
}

export interface ThumbnailSourceRef {
  id: string;
  label: string;
  note?: string;
}

export interface ThumbnailProvenance {
  origin: "fixture" | "user";
  /** Every figure in the fixture is made up; the UI must say so. */
  values: "synthetic-demo";
  note: string;
  sources: ThumbnailSourceRef[];
}

export interface ThumbnailDocument {
  schemaVersion: typeof THUMBNAIL_SCHEMA_VERSION;
  kind: typeof THUMBNAIL_KIND;
  id: string;
  projectId: string;
  topic: string;
  /** The promise the thumbnail makes to the viewer. */
  promise: string;
  brand: ThumbnailBrandStyle;
  /** Document-level palette override of the brand default. */
  paletteId: PaletteId;
  output: {
    width: number;
    height: number;
    aspect: "16:9";
    safeInset: number;
  };
  activeVariantId: string;
  variants: ThumbnailVariant[];
  provenance: ThumbnailProvenance;
  qa: ThumbnailQa;
  lastExport: ThumbnailExportRecord | null;
  /** Monotonic edit counter; used for QA snapshots and export records. */
  revision: number;
}

export interface ThumbnailIssueCopy {
  title: string;
  /** Optional actionable next step. */
  hint?: string;
}

export interface ThumbnailParseResult {
  document: ThumbnailDocument | null;
  issues: string[];
}
