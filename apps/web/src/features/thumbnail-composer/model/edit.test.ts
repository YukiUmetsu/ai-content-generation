import { describe, expect, it } from "vitest";
import {
  localizeExampleDefaults,
  parseThumbnailDocument,
  resetVariantCopy,
  selectConcept,
  serializeThumbnailDocument,
  setPalette,
  setTopic,
  updateCopy,
} from "./edit";
import {
  createThumbnailDocument,
  HVAC_EXAMPLE_JA,
  VARIANT_ID_BY_CONCEPT,
} from "./fixtures";

describe("thumbnail document editing", () => {
  it("keeps per-concept edits when switching concepts", () => {
    const document = createThumbnailDocument();
    const priceEdit = updateCopy(document, "en", { headline: "The quote is not the price" });
    const hidden = selectConcept(priceEdit, VARIANT_ID_BY_CONCEPT["hidden-cost"]);
    const hiddenEdit = updateCopy(hidden, "en", { headline: "Four layers, one line" });
    const back = selectConcept(hiddenEdit, VARIANT_ID_BY_CONCEPT["price-shock"]);

    const price = back.variants.find((variant) => variant.concept === "price-shock");
    const hiddenVariant = back.variants.find((variant) => variant.concept === "hidden-cost");
    expect(price?.copy.en.headline).toBe("The quote is not the price");
    expect(hiddenVariant?.copy.en.headline).toBe("Four layers, one line");
    expect(price?.copy.ja.headline).toBe("同じ家、同じ広さ。変わるのは金額だけ。");
  });

  it("bumps the revision and refreshes the QA snapshot on every edit", () => {
    const document = createThumbnailDocument();
    const edited = updateCopy(document, "en", { value: "$13,200" });
    expect(edited.revision).toBe(document.revision + 1);
    expect(edited.qa.checkedRevision).toBe(edited.revision);
    expect(edited.variants[0].copy.en.value).toBe("$13,200");
  });

  it("changes palette without rewriting copy", () => {
    const document = createThumbnailDocument();
    const edited = setPalette(document, "ledger");
    expect(edited.paletteId).toBe("ledger");
    expect(edited.variants.map((variant) => variant.copy)).toEqual(
      document.variants.map((variant) => variant.copy)
    );
  });

  it("restores the fixture copy for both locales", () => {
    const document = createThumbnailDocument();
    const edited = updateCopy(updateCopy(document, "en", { headline: "local" }), "ja", { headline: "ローカル" });
    const restored = resetVariantCopy(edited);
    expect(restored.variants[0].copy.en.headline).toBe(document.variants[0].copy.en.headline);
    expect(restored.variants[0].copy.ja.headline).toBe(document.variants[0].copy.ja.headline);
  });

  it("round-trips through JSON without losing authoring data", () => {
    const document = createThumbnailDocument();
    const edited = updateCopy(document, "en", { headline: "A new headline", value: "$9,999" });
    const parsed = parseThumbnailDocument(JSON.parse(serializeThumbnailDocument(edited)));
    expect(parsed.issues).toEqual([]);
    expect(parsed.document).not.toBeNull();
    expect(parsed.document?.variants).toEqual(edited.variants);
    expect(parsed.document?.activeVariantId).toBe(edited.activeVariantId);
    expect(parsed.document?.qa).toEqual(edited.qa);
  });

  it("rejects invalid content safely", () => {
    const document = createThumbnailDocument();

    expect(parseThumbnailDocument(null).document).toBeNull();
    expect(parseThumbnailDocument("{not json").document).toBeNull();

    const wrongVersion = parseThumbnailDocument({ ...document, schemaVersion: 99 });
    expect(wrongVersion.document).toBeNull();
    expect(wrongVersion.issues.join(" ")).toMatch(/schemaVersion/);

    const noVariants = parseThumbnailDocument({ ...document, variants: [] });
    expect(noVariants.document).toBeNull();
    expect(noVariants.issues.length).toBeGreaterThan(0);

    const badCopy = parseThumbnailDocument({
      ...document,
      variants: [{ ...document.variants[0], copy: { en: { headline: 5 } } }],
    });
    expect(badCopy.document).toBeNull();

    const badConcept = parseThumbnailDocument({
      ...document,
      variants: [{ ...document.variants[0], concept: "not-a-concept" }],
    });
    expect(badConcept.document).toBeNull();
  });

  it("falls back to the first variant when the active id is unknown", () => {
    const document = createThumbnailDocument();
    const parsed = parseThumbnailDocument({ ...document, activeVariantId: "missing" });
    expect(parsed.document?.activeVariantId).toBe(document.variants[0].id);
  });

  it("validates brand typography and provenance references", () => {
    const document = createThumbnailDocument();

    const badWeight = parseThumbnailDocument({
      ...document,
      brand: {
        ...document.brand,
        typography: { ...document.brand.typography, display: { family: "X", weight: 5000 } },
      },
    });
    expect(badWeight.document).toBeNull();
    expect(badWeight.issues.join(" ")).toMatch(/brand\.typography\.display\.weight/);

    const badFamily = parseThumbnailDocument({
      ...document,
      brand: {
        ...document.brand,
        typography: { ...document.brand.typography, body: { family: "  ", weight: 400 } },
      },
    });
    expect(badFamily.document).toBeNull();

    const badSource = parseThumbnailDocument({
      ...document,
      provenance: { ...document.provenance, sources: [{ id: "only-an-id" }] },
    });
    expect(badSource.document).toBeNull();
    expect(badSource.issues.join(" ")).toMatch(/provenance\.sources\[0\]\.label/);

    const badProvenance = parseThumbnailDocument({ ...document, provenance: "nope" });
    expect(badProvenance.document).toBeNull();
  });

  it("bounds output dimensions and requires a 16:9 frame", () => {
    const document = createThumbnailDocument();

    const tiny = parseThumbnailDocument({
      ...document,
      output: { ...document.output, width: 10, height: 10 },
    });
    expect(tiny.document).toBeNull();
    expect(tiny.issues.join(" ")).toMatch(/output\.width/);

    const square = parseThumbnailDocument({
      ...document,
      output: { ...document.output, width: 1280, height: 1280 },
    });
    expect(square.document).toBeNull();
    expect(square.issues.join(" ")).toMatch(/16:9/);
  });

  it("rejects duplicate variant ids and concepts", () => {
    const document = createThumbnailDocument();
    const duplicateId = parseThumbnailDocument({
      ...document,
      variants: [
        document.variants[0],
        { ...document.variants[1], id: document.variants[0].id },
      ],
    });
    expect(duplicateId.document).toBeNull();
    expect(duplicateId.issues.join(" ")).toMatch(/duplicate id/);

    const duplicateConcept = parseThumbnailDocument({
      ...document,
      variants: [document.variants[0], { ...document.variants[1], concept: document.variants[0].concept }],
    });
    expect(duplicateConcept.document).toBeNull();
    expect(duplicateConcept.issues.join(" ")).toMatch(/duplicate concept/);
  });

  it("round-trips an empty comparison figure without inventing a value", () => {
    const quote = selectConcept(createThumbnailDocument(), VARIANT_ID_BY_CONCEPT["quote-gap"]);
    const cleared = updateCopy(quote, "en", { compareValue: "" });
    const parsed = parseThumbnailDocument(JSON.parse(serializeThumbnailDocument(cleared)));
    expect(parsed.issues).toEqual([]);
    expect(parsed.document?.variants.find((variant) => variant.concept === "quote-gap")?.copy.en.compareValue).toBe("");
    expect(parsed.document?.qa.status).toBe("blocked");
  });

  it("localizes untouched example copy on a language switch but keeps edits", () => {
    const document = createThumbnailDocument();
    const switched = localizeExampleDefaults(document, "en", "ja");
    expect(switched.topic).toBe(HVAC_EXAMPLE_JA.topic);
    expect(switched.promise).toBe(HVAC_EXAMPLE_JA.promise);
    expect(switched.revision).toBe(document.revision + 1);
    expect(localizeExampleDefaults(document, "en", "en")).toBe(document);

    const edited = setTopic(document, "My own working title");
    const kept = localizeExampleDefaults(edited, "en", "ja");
    expect(kept.topic).toBe("My own working title");
    expect(kept.promise).toBe(HVAC_EXAMPLE_JA.promise);
  });
});
