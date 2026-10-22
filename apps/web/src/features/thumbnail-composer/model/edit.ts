import { CONCEPT_ELEMENTS } from "./concepts";
import { defaultVariantCopy, EXAMPLE_PROMISE, EXAMPLE_TOPIC } from "./fixtures";
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

function isPaletteId(value: unknown): value is PaletteId {
  return PALETTES.includes(value as PaletteId);
}

function positiveInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/** Authoring canvases outside this range are not YouTube stills. */
const MIN_OUTPUT_EDGE = 320;
const MAX_OUTPUT_EDGE = 4096;
const MAX_SOURCES = 24;
const MAX_SOURCE_TEXT = 240;

function validateOutput(value: unknown, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push("output: expected dimensions");
    return;
  }
  const widthOk = positiveInteger(value.width, MIN_OUTPUT_EDGE, MAX_OUTPUT_EDGE);
  const heightOk = positiveInteger(value.height, MIN_OUTPUT_EDGE, MAX_OUTPUT_EDGE);
  if (!widthOk) {
    issues.push(`output.width: expected an integer between ${MIN_OUTPUT_EDGE} and ${MAX_OUTPUT_EDGE}`);
  }
  if (!heightOk) {
    issues.push(`output.height: expected an integer between ${MIN_OUTPUT_EDGE} and ${MAX_OUTPUT_EDGE}`);
  }
  if (widthOk && heightOk && Math.abs(Number(value.width) / Number(value.height) - 16 / 9) > 0.02) {
    issues.push("output: expected a 16:9 frame");
  }
  if (
    value.safeInset !== undefined &&
    (typeof value.safeInset !== "number" ||
      !Number.isFinite(value.safeInset) ||
      value.safeInset < 0 ||
      value.safeInset >= 0.5)
  ) {
    issues.push("output.safeInset: expected a ratio between 0 and 0.5");
  }
}

function validateTypeStyle(value: unknown, label: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${label}: expected a font family and weight`);
    return;
  }
  if (!nonEmptyString(value.family) || value.family.trim() === "" || value.family.length > 80) {
    issues.push(`${label}.family: expected a font family name`);
  }
  if (
    typeof value.weight !== "number" ||
    !Number.isFinite(value.weight) ||
    value.weight < 100 ||
    value.weight > 900
  ) {
    issues.push(`${label}.weight: expected a weight between 100 and 900`);
  }
}

function validateBrand(value: unknown, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push("brand: expected a brand style reference");
    return;
  }
  if (!nonEmptyString(value.brandId) || value.brandId.trim() === "") {
    issues.push("brand.brandId: expected a non-empty id");
  }
  if (!nonEmptyString(value.brandName) || value.brandName.trim() === "") {
    issues.push("brand.brandName: expected a non-empty name");
  }
  if (!isPaletteId(value.paletteId)) {
    issues.push("brand.paletteId: unknown palette");
  }
  if (!positiveInteger(value.revision, 1, 100000)) {
    issues.push("brand.revision: expected a positive integer");
  }
  if (!isRecord(value.typography)) {
    issues.push("brand.typography: expected display, numbers and body roles");
    return;
  }
  validateTypeStyle(value.typography.display, "brand.typography.display", issues);
  validateTypeStyle(value.typography.numbers, "brand.typography.numbers", issues);
  validateTypeStyle(value.typography.body, "brand.typography.body", issues);
}

function validateProvenance(value: unknown, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push("provenance: expected a provenance record");
    return;
  }
  if (value.origin !== "fixture" && value.origin !== "user") {
    issues.push('provenance.origin: expected "fixture" or "user"');
  }
  if (value.values !== "synthetic-demo") {
    issues.push('provenance.values: expected "synthetic-demo"');
  }
  if (!nonEmptyString(value.note) || value.note.length > MAX_SOURCE_TEXT) {
    issues.push(`provenance.note: expected text under ${MAX_SOURCE_TEXT} characters`);
  }
  if (!Array.isArray(value.sources)) {
    issues.push("provenance.sources: expected a list of references");
    return;
  }
  if (value.sources.length > MAX_SOURCES) {
    issues.push(`provenance.sources: at most ${MAX_SOURCES} references`);
  }
  value.sources.forEach((source, index) => {
    if (!isRecord(source)) {
      issues.push(`provenance.sources[${index}]: expected an object`);
      return;
    }
    if (!nonEmptyString(source.id) || source.id.trim() === "") {
      issues.push(`provenance.sources[${index}].id: expected a non-empty id`);
    }
    if (!nonEmptyString(source.label) || source.label.trim() === "") {
      issues.push(`provenance.sources[${index}].label: expected a non-empty label`);
    }
    if (source.note !== undefined && (!nonEmptyString(source.note) || source.note.length > MAX_SOURCE_TEXT)) {
      issues.push(`provenance.sources[${index}].note: expected text under ${MAX_SOURCE_TEXT} characters`);
    }
  });
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
  if (input.topic !== undefined && !nonEmptyString(input.topic)) {
    issues.push("topic: expected text");
  }
  if (input.promise !== undefined && !nonEmptyString(input.promise)) {
    issues.push("promise: expected text");
  }
  if (!Array.isArray(input.variants) || input.variants.length === 0) {
    issues.push("variants: expected at least one variant");
  }
  validateOutput(input.output, issues);
  if (!isPaletteId(input.paletteId)) {
    issues.push("paletteId: unknown palette");
  }
  validateBrand(input.brand, issues);
  validateProvenance(input.provenance, issues);
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
  const seenIds = new Set<string>();
  const seenConcepts = new Set<ConceptId>();
  for (const variant of variants) {
    if (seenIds.has(variant.id)) issues.push(`variants: duplicate id "${variant.id}"`);
    if (seenConcepts.has(variant.concept)) issues.push(`variants: duplicate concept "${variant.concept}"`);
    seenIds.add(variant.id);
    seenConcepts.add(variant.concept);
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
  const provenance = input.provenance as ThumbnailDocument["provenance"];

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
    revision: positiveInteger(input.revision, 1, 100000000) ? input.revision : 1,
  };
  return { document: refreshQa(document), issues: [] };
}

/**
 * Follow the interface language while the brief is still the shipped example.
 * A topic or promise the person has typed is never overwritten.
 */
export function localizeExampleDefaults(
  document: ThumbnailDocument,
  from: Locale,
  to: Locale
): ThumbnailDocument {
  if (from === to) return document;
  const topicIsExample = (Object.values(EXAMPLE_TOPIC) as string[]).includes(document.topic);
  const promiseIsExample = (Object.values(EXAMPLE_PROMISE) as string[]).includes(document.promise);
  const topic = topicIsExample ? EXAMPLE_TOPIC[to] : document.topic;
  const promise = promiseIsExample ? EXAMPLE_PROMISE[to] : document.promise;
  if (topic === document.topic && promise === document.promise) return document;
  return commit(document, { topic, promise });
}
