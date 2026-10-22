import { describe, expect, it } from "vitest";
import {
  parseThumbnailDocument,
  resetVariantCopy,
  selectConcept,
  serializeThumbnailDocument,
  setPalette,
  updateCopy,
} from "./edit";
import { createThumbnailDocument, VARIANT_ID_BY_CONCEPT } from "./fixtures";

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
});
