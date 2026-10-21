import { describe, expect, it } from "vitest";
import { importBrandKitAppearance, exportBrandKitAppearance } from "./json";
import { createBrandState } from "./brands";

describe("importBrandKitAppearance", () => {
  const base = createBrandState(
    "brand_test",
    "Test Brand",
    1,
    "modern-analytical",
    {
      video: { kicker: "", title: "", dek: "" },
      metric: {
        label: "",
        value: "",
        delta: "",
        positiveLabel: "",
        positiveValue: "",
        negativeLabel: "",
        negativeValue: "",
        source: "",
      },
      thumbnail: { kicker: "", title: "", badge: "", footer: "" },
    }
  );

  it("rejects invalid JSON", () => {
    const result = importBrandKitAppearance("not json", base);
    expect("errors" in result).toBe(true);
    if ("errors" in result) {
      expect(result.errors[0].path).toBe("");
    }
  });

  it("rejects unsupported schema versions", () => {
    const doc = exportBrandKitAppearance(base);
    const result = importBrandKitAppearance(
      JSON.stringify({ ...doc, schemaVersion: 2 }),
      base
    );
    expect("errors" in result).toBe(true);
    if ("errors" in result) {
      expect(result.errors.some((e) => e.path === "schemaVersion")).toBe(true);
    }
  });

  it("rejects unapproved font families with path", () => {
    const doc = exportBrandKitAppearance(base);
    const broken = {
      ...doc,
      visual: {
        ...doc.visual,
        typography: {
          ...doc.visual.typography,
          display: { family: "Comic Sans", weight: 400 },
        },
      },
    };
    const result = importBrandKitAppearance(JSON.stringify(broken), base);
    expect("errors" in result).toBe(true);
    if ("errors" in result) {
      expect(
        result.errors.some(
          (e) =>
            e.path === "visual.typography.display.family" &&
            e.message.includes("Unapproved")
        )
      ).toBe(true);
    }
  });

  it("rejects unsupported weights with path", () => {
    const doc = exportBrandKitAppearance(base);
    const broken = {
      ...doc,
      visual: {
        ...doc.visual,
        typography: {
          ...doc.visual.typography,
          body: { family: "Geist", weight: 999 },
        },
      },
    };
    const result = importBrandKitAppearance(JSON.stringify(broken), base);
    expect("errors" in result).toBe(true);
    if ("errors" in result) {
      expect(
        result.errors.some(
          (e) =>
            e.path === "visual.typography.body.weight" &&
            e.message.includes("Unsupported weight")
        )
      ).toBe(true);
    }
  });

  it("rejects invalid hex with path", () => {
    const doc = exportBrandKitAppearance(base);
    const broken = {
      ...doc,
      visual: { ...doc.visual, palette: { ...doc.visual.palette, accent: "#GGG" } },
    };
    const result = importBrandKitAppearance(JSON.stringify(broken), base);
    expect("errors" in result).toBe(true);
    if ("errors" in result) {
      expect(
        result.errors.some(
          (e) =>
            e.path === "visual.palette.accent" && e.message.includes("Invalid hex")
        )
      ).toBe(true);
    }
  });

  it("accepts a valid round-trip document and preserves id/name", () => {
    const doc = exportBrandKitAppearance(base);
    const result = importBrandKitAppearance(JSON.stringify(doc), base);
    expect("brand" in result).toBe(true);
    if ("brand" in result) {
      expect(result.brand.id).toBe("brand_test");
      expect(result.brand.name).toBe("Test Brand");
      expect(result.brand.appearance.palette.canvas).toBe("#101A22");
      expect(result.brand.appearance.typography.display.family).toBe("Newsreader");
    }
  });

  it("accepts a brand-kit kind document", () => {
    const doc = {
      ...exportBrandKitAppearance(base),
      kind: "brand-kit",
      strategy: { audience: "test" },
    };
    const result = importBrandKitAppearance(JSON.stringify(doc), base);
    expect("brand" in result).toBe(true);
  });
});
