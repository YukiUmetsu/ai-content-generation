import { describe, expect, it } from "vitest";
import { selectConcept, updateCopy } from "./edit";
import { createThumbnailDocument, VARIANT_ID_BY_CONCEPT } from "./fixtures";
import { collectIssues, contrastRatio, issuesFor, qaStatus, refreshQa } from "./qa";
import type { ThumbnailDocument } from "./types";

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

  it("blocks the comparison concept when its comparison figure is empty", () => {
    const document = createThumbnailDocument();
    const quote = selectConcept(document, VARIANT_ID_BY_CONCEPT["quote-gap"]);
    const cleared = updateCopy(quote, "en", { compareValue: "" });
    const issues = issuesFor(cleared, VARIANT_ID_BY_CONCEPT["quote-gap"], "en");
    const empty = issues.find((issue) => issue.code === "compare-empty");
    expect(empty).toBeDefined();
    expect(empty?.severity).toBe("error");
    expect(cleared.qa.status).toBe("blocked");
    // The Japanese locale is untouched and stays valid.
    expect(issuesFor(cleared, VARIANT_ID_BY_CONCEPT["quote-gap"], "ja")).toEqual([]);
  });

  it("detects a secondary line that overflows its box, not just its character budget", () => {
    const document = createThumbnailDocument();
    // 95 characters is under the English budget but needs two lines at 640 px
    // wide, which exceeds the 44 px single-line box.
    const dense = "costs ".repeat(16).trim();
    expect(dense.length).toBeLessThanOrEqual(96);
    const edited = updateCopy(document, "en", { secondary: dense });
    const warning = issuesFor(edited, VARIANT_ID_BY_CONCEPT["price-shock"], "en").find(
      (issue) => issue.code === "secondary-too-long"
    );
    expect(warning).toBeDefined();
    expect(warning?.detail).toContain("overflow=true");
  });

  it("reports a failed composition as a blocking issue instead of passing silently", () => {
    const document = createThumbnailDocument();
    const broken = {
      ...document,
      variants: document.variants.map((variant) => ({ ...variant, copy: {} as never })),
    } as ThumbnailDocument;
    const issues = collectIssues(broken);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((issue) => issue.code === "composition-failed")).toBe(true);
    expect(issues.every((issue) => issue.severity === "error")).toBe(true);
    expect(qaStatus(issues)).toBe("blocked");
  });

  it("keeps validation failures visible in the refreshed QA snapshot", () => {
    const document = createThumbnailDocument();
    const broken = refreshQa({
      ...document,
      variants: document.variants.map((variant) => ({ ...variant, copy: {} as never })),
    });
    expect(broken.qa.status).toBe("blocked");
    expect(broken.qa.issues.some((issue) => issue.code === "composition-failed")).toBe(true);
  });
});
