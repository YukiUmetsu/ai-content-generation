import { CONCEPT_ELEMENTS } from "./concepts";
import { defaultVariantCopy } from "./fixtures";
import { refreshQa } from "./qa";
import type {
  ConceptId,
  Locale,
  PaletteId,
  ThumbnailCopy,
  ThumbnailDocument,
  ThumbnailParseResult,
  ThumbnailVariant,
} from "./types";
import { THUMBNAIL_KIND, THUMBNAIL_SCHEMA_VERSION } from "./types";

const CONCEPTS: readonly ConceptId[] = ["price-shock", "hidden-cost", "quote-gap"];
const PALETTES: readonly PaletteId[] = ["blueprint", "ledger", "signal"];
const LOCALES: readonly Locale[] = ["en", "ja"];

/** Every edit bumps the revision and recomputes the QA snapshot. */
export function commit(document: ThumbnailDocument, patch: Partial<ThumbnailDocument>): ThumbnailDocument {
  return refreshQa({ ...document, ...patch, revision: document.revision + 1 });
}

export function selectConcept(document: ThumbnailDocument, variantId: string): ThumbnailDocument {
  if (!document.variants.some((variant) => variant.id === variantId)) return document;
  if (document.activeVariantId === variantId) return document;
  return commit(document, { activeVariantId: variantId });
}

export function updateCopy(
  document: ThumbnailDocument,
  locale: Locale,
  patch: Partial<ThumbnailCopy>
): ThumbnailDocument {
  const variants = document.variants.map((variant) =>
    variant.id === document.activeVariantId
      ? {
          ...variant,
          copy: {
            ...variant.copy,
            [locale]: { ...variant.copy[locale], ...patch },
          },
        }
      : variant
  );
  return commit(document, { variants });
}

export function setPalette(document: ThumbnailDocument, paletteId: PaletteId): ThumbnailDocument {
  if (document.paletteId === paletteId) return document;
  return commit(document, { paletteId });
}

export function setTopic(document: ThumbnailDocument, topic: string): ThumbnailDocument {
  return commit(document, { topic });
}

export function setPromise(document: ThumbnailDocument, promise: string): ThumbnailDocument {
  return commit(document, { promise });
}

export function resetVariantCopy(document: ThumbnailDocument, variantId = document.activeVariantId): ThumbnailDocument {
  const variants = document.variants.map((variant) =>
    variant.id === variantId
      ? {
          ...variant,
          copy: {
            en: defaultVariantCopy(variant.concept, "en"),
            ja: defaultVariantCopy(variant.concept, "ja"),
          },
        }
      : variant
  );
  return commit(document, { variants });
}

export function recordExport(
  document: ThumbnailDocument,
  record: ThumbnailDocument["lastExport"]
): ThumbnailDocument {
  return { ...document, lastExport: record };
}

/** Stable key order keeps serialized documents diffable and round-trippable. */
export function serializeThumbnailDocument(document: ThumbnailDocument): string {
  return JSON.stringify(document, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string";
}

function parseCopy(value: unknown, label: string, issues: string[]): ThumbnailCopy | null {
  if (!isRecord(value)) {
    issues.push(`${label}: expected an object`);
    return null;
  }
  if (!nonEmptyString(value.headline)) issues.push(`${label}.headline: expected text`);
  if (!nonEmptyString(value.value)) issues.push(`${label}.value: expected text`);
  if (!nonEmptyString(value.secondary)) issues.push(`${label}.secondary: expected text`);
  if (value.compareValue !== undefined && !nonEmptyString(value.compareValue)) {
    issues.push(`${label}.compareValue: expected text when present`);
  }
  if (
    !nonEmptyString(value.headline) ||
    !nonEmptyString(value.value) ||
    !nonEmptyString(value.secondary)
  ) {
    return null;
  }
  return {
    headline: value.headline,
    value: value.value,
    secondary: value.secondary,
    ...(nonEmptyString(value.compareValue) ? { compareValue: value.compareValue } : {}),
  };
}

function parseVariant(value: unknown, index: number, issues: string[]): ThumbnailVariant | null {
  if (!isRecord(value)) {
    issues.push(`variants[${index}]: expected an object`);
    return null;
  }
  if (!nonEmptyString(value.id) || value.id.trim() === "") {
    issues.push(`variants[${index}].id: expected a non-empty id`);
    return null;
  }
  if (!CONCEPTS.includes(value.concept as ConceptId)) {
    issues.push(`variants[${index}].concept: unknown concept`);
    return null;
  }
  if (!isRecord(value.copy)) {
    issues.push(`variants[${index}].copy: expected locale copy`);
    return null;
  }
  const copy = {} as Record<Locale, ThumbnailCopy>;
  for (const locale of LOCALES) {
    const parsed = parseCopy(value.copy[locale], `variants[${index}].copy.${locale}`, issues);
    if (!parsed) return null;
    copy[locale] = parsed;
  }
  const concept = value.concept as ConceptId;
  return {
    id: value.id,
    concept,
    copy,
    elements: CONCEPT_ELEMENTS[concept].map((element) => ({ ...element })),
  };
}

/**
 * Validates untrusted JSON and returns a normalized document, or `null` with
 * readable reasons. Blocking problems never reach the renderer.
 */
export function parseThumbnailDocument(input: unknown): ThumbnailParseResult {
  const issues: string[] = [];
  if (!isRecord(input)) {
    return { document: null, issues: ["Expected a thumbnail document object."] };
  }
  if (input.schemaVersion !== THUMBNAIL_SCHEMA_VERSION) {
    issues.push(`Unsupported schemaVersion: ${String(input.schemaVersion)}`);
  }
  if (input.kind !== THUMBNAIL_KIND) {
    issues.push(`Unsupported kind: ${String(input.kind)}`);
  }
  if (!nonEmptyString(input.id) || input.id.trim() === "") {
    issues.push("id: expected a non-empty id");
  }
  if (!Array.isArray(input.variants) || input.variants.length === 0) {
    issues.push("variants: expected at least one variant");
  }
  if (!isRecord(input.output)) {
    issues.push("output: expected dimensions");
  } else if (
    typeof input.output.width !== "number" ||
    typeof input.output.height !== "number" ||
    !(input.output.width > 0) ||
    !(input.output.height > 0)
  ) {
    issues.push("output: width and height must be positive numbers");
  }
  if (!PALETTES.includes(input.paletteId as PaletteId)) {
    issues.push("paletteId: unknown palette");
  }
  if (!isRecord(input.brand) || !nonEmptyString((input.brand as Record<string, unknown>).brandName)) {
    issues.push("brand: expected a brand style reference");
  }
  if (issues.length > 0) {
    return { document: null, issues };
  }

  const variants = (input.variants as unknown[])
    .map((variant, index) => parseVariant(variant, index, issues))
    .filter((variant): variant is ThumbnailVariant => variant !== null);
  if (variants.length === 0) {
    issues.push("variants: no valid variants");
    return { document: null, issues };
  }
  if (issues.length > 0) {
    return { document: null, issues };
  }

  const activeVariantId =
    nonEmptyString(input.activeVariantId) && variants.some((variant) => variant.id === input.activeVariantId)
      ? input.activeVariantId
      : variants[0].id;

  const brand = input.brand as ThumbnailDocument["brand"];
  const output = input.output as ThumbnailDocument["output"];
  const provenance = isRecord(input.provenance)
    ? (input.provenance as unknown as ThumbnailDocument["provenance"])
    : {
        origin: "user" as const,
        values: "synthetic-demo" as const,
        note: "Imported document.",
        sources: [],
      };

  const document: ThumbnailDocument = {
    schemaVersion: THUMBNAIL_SCHEMA_VERSION,
    kind: THUMBNAIL_KIND,
    id: input.id as string,
    projectId: nonEmptyString(input.projectId) ? input.projectId : "local-project",
    topic: nonEmptyString(input.topic) ? input.topic : "",
    promise: nonEmptyString(input.promise) ? input.promise : "",
    brand,
    paletteId: input.paletteId as PaletteId,
    output: {
      width: output.width,
      height: output.height,
      aspect: "16:9",
      safeInset:
        typeof output.safeInset === "number" && output.safeInset >= 0 && output.safeInset < 0.5
          ? output.safeInset
          : 0.05,
    },
    activeVariantId,
    variants,
    provenance,
    qa: { status: "pass", checkedRevision: 1, issues: [] },
    lastExport: null,
    revision: typeof input.revision === "number" && input.revision > 0 ? Math.round(input.revision) : 1,
  };
  return { document: refreshQa(document), issues: [] };
}
