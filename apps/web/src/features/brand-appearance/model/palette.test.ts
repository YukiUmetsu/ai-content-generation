import { describe, expect, it } from "vitest";
import {
  normalizeHex,
  isValidHex,
  safeHex,
  contrastRatio,
  findContrastIssues,
  FALLBACK_NEUTRAL,
} from "./palette";
import type { BrandPalette } from "../model/types";

describe("palette utilities", () => {
  it("expands and normalizes shorthand hex", () => {
    expect(normalizeHex("#abc")).toBe("#AABBCC");
    expect(normalizeHex("#AABBCC")).toBe("#AABBCC");
    expect(normalizeHex("  #aabbcc  ")).toBe("#AABBCC");
    expect(normalizeHex("not a color")).toBeNull();
  });

  it("validates hex colors", () => {
    expect(isValidHex("#123")).toBe(true);
    expect(isValidHex("#123456")).toBe(true);
    expect(isValidHex("#12G")).toBe(false);
    expect(isValidHex("123456")).toBe(false);
  });

  it("falls back to a safe neutral for invalid input", () => {
    expect(safeHex("#abc")).toBe("#AABBCC");
    expect(safeHex("bad")).toBe(FALLBACK_NEUTRAL);
  });

  it("computes WCAG contrast ratios", () => {
    // White vs black should be 21:1.
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 1);
    // Same color should be 1:1.
    expect(contrastRatio("#808080", "#808080")).toBeCloseTo(1, 1);
  });

  it("reports contrast issues for low-contrast pairs", () => {
    const palette: BrandPalette = {
      canvas: "#FFFFFF",
      surface: "#FFFFFF",
      textPrimary: "#FFFFFF",
      textSecondary: "#DDDDDD",
      accent: "#FFFFFF",
      positive: "#FFFFFF",
      negative: "#FFFFFF",
    };
    const issues = findContrastIssues(palette);
    expect(issues.length).toBeGreaterThan(0);
    const textPrimaryVsCanvas = issues.find(
      (i) => i.foreground === "textPrimary" && i.background === "canvas"
    );
    expect(textPrimaryVsCanvas).toBeDefined();
    expect(textPrimaryVsCanvas!.required).toBe(4.5);
  });
});
