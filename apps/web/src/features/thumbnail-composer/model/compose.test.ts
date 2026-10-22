import { describe, expect, it } from "vitest";
import { documentHash } from "@/components/media/document";
import { documentToSvg } from "@/components/media/svg-export";
import { CONCEPT_ELEMENTS } from "./concepts";
import { composeThumbnail } from "./compose";
import { selectConcept, updateCopy } from "./edit";
import { createThumbnailDocument, VARIANT_ID_BY_CONCEPT } from "./fixtures";
import type { ConceptId } from "./types";

const CONCEPTS: ConceptId[] = ["price-shock", "hidden-cost", "quote-gap"];

describe("composeThumbnail", () => {
  it("builds exactly the documented element map for each concept", () => {
    const document = createThumbnailDocument();
    for (const concept of CONCEPTS) {
      const composed = composeThumbnail(document, {
        variantId: VARIANT_ID_BY_CONCEPT[concept],
        locale: "en",
      });
      expect(composed.concept).toBe(concept);
      expect(composed.media.artboard.width).toBe(1280);
      expect(composed.media.artboard.height).toBe(720);
      expect(composed.media.metadata?.locale).toBe("en");
      expect(composed.elementIds).toHaveLength(CONCEPT_ELEMENTS[concept].length);
      for (const element of CONCEPT_ELEMENTS[concept]) {
        expect(composed.media.layers.some((layer) => layer.id === element.id)).toBe(true);
      }
    }
  });

  it("switching concept changes composition, not just colour", () => {
    const document = createThumbnailDocument();
    const signatures = CONCEPTS.map((concept) => {
      const composed = composeThumbnail(document, {
        variantId: VARIANT_ID_BY_CONCEPT[concept],
        locale: "en",
      });
      return {
        ids: composed.media.layers.map((layer) => layer.id).join(","),
        count: composed.media.layers.length,
        composition: composed.composition,
      };
    });

    expect(signatures[0].composition).toBe("number-reversal");
    expect(signatures[1].composition).toBe("exploded-cutaway");
    expect(signatures[2].composition).toBe("a-vs-b");
    expect(new Set(signatures.map((entry) => entry.ids)).size).toBe(3);
    expect(new Set(signatures.map((entry) => entry.count)).size).toBeGreaterThan(1);
  });

  it("produces byte-identical SVG for the same input", () => {
    const document = createThumbnailDocument();
    const first = composeThumbnail(document, { variantId: VARIANT_ID_BY_CONCEPT["price-shock"], locale: "en" });
    const second = composeThumbnail(document, { variantId: VARIANT_ID_BY_CONCEPT["price-shock"], locale: "en" });
    const svgA = documentToSvg(first.media).svg;
    const svgB = documentToSvg(second.media).svg;
    expect(svgA).toBe(svgB);
    expect(documentHash(first.media)).toBe(documentHash(second.media));
  });

  it("exports at 1280 × 720 and scales without changing layout", () => {
    const document = createThumbnailDocument();
    const media = composeThumbnail(document, { locale: "en" }).media;
    const full = documentToSvg(media);
    const half = documentToSvg(media, { scale: 0.5 });
    expect(full.size).toEqual({ width: 1280, height: 720 });
    expect(half.size).toEqual({ width: 640, height: 360 });
    expect(half.svg).toContain('viewBox="0 0 1280 720"');
  });

  it("reflects headline and figure edits in the exported SVG", () => {
    const document = createThumbnailDocument();
    const edited = updateCopy(document, "en", {
      headline: "The quote hides four costs",
      value: "$14,900",
    });
    const composed = composeThumbnail(edited, { locale: "en" });
    const svg = documentToSvg(composed.media).svg;
    expect(composed.text.headline.spec.spans[0].text).toBe("The quote hides four costs");
    expect(composed.text.value.spec.spans[0].text).toBe("$14,900");
    expect(svg).toContain("$14,900");
    expect(svg).not.toContain("12,400");
  });

  it("draws an explicit placeholder instead of an invented figure when the comparison is empty", () => {
    const quote = selectConcept(createThumbnailDocument(), VARIANT_ID_BY_CONCEPT["quote-gap"]);
    const cleared = updateCopy(quote, "en", { compareValue: "" });
    const composed = composeThumbnail(cleared, {
      variantId: VARIANT_ID_BY_CONCEPT["quote-gap"],
      locale: "en",
    });
    expect(composed.text.compare?.spec.spans[0].text).toBe("—");
    const svg = documentToSvg(composed.media).svg;
    expect(svg).not.toContain("4,800");
    expect(composed.variant.copy.en.compareValue).toBe("");
  });

  it("renders English and Japanese copy with the right language tag", () => {
    const document = createThumbnailDocument();
    const english = composeThumbnail(document, { locale: "en" });
    const japanese = composeThumbnail(document, { locale: "ja" });
    expect(english.text.headline.spec.spans[0].text).toContain("Same house");
    expect(japanese.text.headline.spec.spans[0].text).toBe("同じ家、同じ広さ。変わるのは金額だけ。");
    expect(japanese.text.headline.spec.language).toBe("ja");
    expect(japanese.media.layers.some((layer) => layer.kind === "text" && layer.text.spans[0]?.text.includes("空調"))).toBe(true);
    expect(japanese.media.layers.every((layer) => layer.kind !== "text" || layer.text.language === "ja")).toBe(true);
  });
});
