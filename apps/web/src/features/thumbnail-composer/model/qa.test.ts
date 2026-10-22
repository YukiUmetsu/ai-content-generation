import { describe, expect, it } from "vitest";
import { updateCopy } from "./edit";
import { createThumbnailDocument, VARIANT_ID_BY_CONCEPT } from "./fixtures";
import { collectIssues, contrastRatio, issuesFor, refreshQa } from "./qa";

describe("thumbnail QA", () => {
  it("passes the deterministic fixture without inventing problems", () => {
    const document = createThumbnailDocument();
    expect(document.qa.status).toBe("pass");
    expect(document.qa.issues).toEqual([]);
    expect(document.qa.checkedRevision).toBe(document.revision);
  });

  it("warns when the headline wraps past the line budget", () => {
    const document = createThumbnailDocument();
    const long =
      "Why a replacement quote bundles equipment labour ductwork permits and disposal into a single number that hides the real installed cost";
    const edited = updateCopy(document, "en", { headline: long });
    const issues = issuesFor(edited, VARIANT_ID_BY_CONCEPT["price-shock"], "en");
    const warning = issues.find((issue) => issue.code === "headline-too-long");
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe("warning");
    expect(warning?.detail).toContain("chars=");
    expect(edited.qa.status).toBe("warnings");
  });

  it("warns for an over-long key figure and empty essential copy", () => {
    const document = createThumbnailDocument();
    const longValue = updateCopy(document, "en", { value: "$12,400 installed + tax" });
    expect(
      issuesFor(longValue, VARIANT_ID_BY_CONCEPT["price-shock"], "en").some(
        (issue) => issue.code === "value-too-long"
      )
    ).toBe(true);

    const empty = updateCopy(document, "en", { headline: "   " });
    const emptyIssues = issuesFor(empty, VARIANT_ID_BY_CONCEPT["price-shock"], "en");
    expect(emptyIssues.some((issue) => issue.code === "headline-empty" && issue.severity === "error")).toBe(true);
    expect(empty.qa.status).toBe("blocked");
  });

  it("checks both locales independently", () => {
    const document = createThumbnailDocument();
    const longJa =
      "エアコン交換の見積もりがなぜここまで高くなるのか、機器代と工事費とダクトと許認可の四つの層に分けて説明します";
    const edited = updateCopy(document, "ja", { headline: longJa });
    const enIssues = issuesFor(edited, VARIANT_ID_BY_CONCEPT["price-shock"], "en");
    const jaIssues = issuesFor(edited, VARIANT_ID_BY_CONCEPT["price-shock"], "ja");
    expect(enIssues).toEqual([]);
    expect(jaIssues.some((issue) => issue.code === "headline-too-long")).toBe(true);
  });

  it("flags content that leaves the safe region when the output size changes", () => {
    const document = createThumbnailDocument();
    const resized = refreshQa({
      ...document,
      output: { ...document.output, width: 1000, height: 562 },
    });
    expect(resized.qa.issues.some((issue) => issue.code === "safe-margin")).toBe(true);
  });

  it("is deterministic and locale-scoped", () => {
    const document = createThumbnailDocument();
    const first = collectIssues(document);
    const second = collectIssues(document);
    expect(first).toEqual(second);
    for (const issue of first) {
      expect(["en", "ja"]).toContain(issue.locale);
      expect(document.variants.some((variant) => variant.id === issue.variantId)).toBe(true);
    }
  });

  it("computes WCAG contrast for plain colours", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("rgb(0,0,0)", "#ffffff")).toBeNull();
  });
});
