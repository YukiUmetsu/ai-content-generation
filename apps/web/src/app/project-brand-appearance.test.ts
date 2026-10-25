import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROJECT_PALETTE,
  resolveProjectAppearance,
  snapshotProjectAppearance,
  toBrandPalette,
  toKumikiPalette,
  toThumbnailPalette,
  validateProjectAppearance,
  type ProjectAppearance,
} from "./project-brand-appearance";
import type { LocalProject } from "./catalog-model";

describe("Project brand appearance", () => {
  const createdAt = "2026-10-25T00:00:00.000Z";
  function fixture(): ProjectAppearance {
    return {
      revision: 1,
      updatedAt: createdAt,
      typographyPreset: "modern-analytical",
      palette: { ...DEFAULT_PROJECT_PALETTE, custom: [{ name: "Key data", hex: "#245D79" }] },
    };
  }

  it("resolves a safe branded default for older projects without appearance settings", () => {
    const legacyProject: LocalProject = {id: "project-legacy",name: "Margin Atlas",notes:"",createdAt};
    const appearance = resolveProjectAppearance(legacyProject);
    expect(appearance.revision).toBe(0);
    expect(appearance.palette.primary).toMatch(/^#[0-9A-F]{6}$/);
    expect(appearance.palette.custom).toEqual([]);
  });

  it("accepts a normalized five-role palette, bounded custom colors and a pinned revision", () => {
    const appearance = validateProjectAppearance({
      ...fixture(), palette: { ...fixture().palette, primary: "#abc", custom: [{name:"Key data",hex:"#245d79"}] },
    });
    expect(appearance.palette.primary).toBe("#AABBCC");
    expect(appearance.palette.custom[0].hex).toBe("#245D79");
    expect(appearance.revision).toBe(1);
  });

  it("rejects malicious, duplicate and malformed palette fields instead of silently erasing them", () => {
    expect(() => validateProjectAppearance({...fixture(), accessToken:"x"})).toThrow(/Unexpected/i);
    expect(() => validateProjectAppearance({...fixture(), palette:{...fixture().palette, accent:"transparent"}})).toThrow(/hex/i);
    expect(() => validateProjectAppearance({...fixture(), palette:{...fixture().palette, custom:[{name:"Primary",hex:"#123456"}]}})).toThrow(/reserved/i);
    expect(() => validateProjectAppearance({...fixture(), palette:{...fixture().palette, custom:[{name:"Gold",hex:"#123456"},{name:"gold",hex:"#654321"}]}})).toThrow(/duplicate/i);
    expect(() => validateProjectAppearance({...fixture(), revision:-1})).toThrow(/revision/i);
  });

  it("supplies semantic defaults to existing brand-preview and thumbnail consumers", () => {
    const appearance = fixture();
    const brand = toBrandPalette(appearance.palette);
    const thumbnail = toThumbnailPalette(appearance.palette);
    expect(brand.canvas).toBe(appearance.palette.background);
    expect(brand.accent).toBe(appearance.palette.accent);
    expect(thumbnail.roles.background).toBe(appearance.palette.primary);
    expect(thumbnail.roles.text).toBe(appearance.palette.background);
    expect(thumbnail.roles.accent).toBe(appearance.palette.accent);
    expect(toKumikiPalette(appearance.palette)).toEqual({
      background:appearance.palette.background,
      foreground:appearance.palette.text,
      accent:appearance.palette.accent,
      surface:appearance.palette.primary,
    });
  });

  it("pins an independent palette snapshot for an output without mutating project colors", () => {
    const appearance = fixture();
    const snapshot = snapshotProjectAppearance({brandAppearance:appearance});
    snapshot.palette.custom[0].hex="#123456";
    expect(appearance.palette.custom[0].hex).toBe("#245D79");
    expect(snapshot.revision).toBe(appearance.revision);
  });
});

