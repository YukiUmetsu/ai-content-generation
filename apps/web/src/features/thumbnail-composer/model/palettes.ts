import type { PaletteId, ThumbnailPalette } from "./types";

/**
 * Three bounded, editorial palettes. Values are deliberately low-chroma except
 * for a single attention accent; the contrast pairings are checked by the QA
 * pass rather than assumed.
 */
export const THUMBNAIL_PALETTES: Record<PaletteId, ThumbnailPalette> = {
  blueprint: {
    id: "blueprint",
    name: "Blueprint",
    roles: {
      background: "#0c1620",
      surface: "#17262f",
      text: "#f5f2ea",
      muted: "#a9b8c4",
      accent: "#f0a24a",
      danger: "#e06a44",
      positive: "#79c99a",
      evidence: "#6cbfe0",
    },
  },
  ledger: {
    id: "ledger",
    name: "Ledger",
    roles: {
      background: "#f4f0e6",
      surface: "#e7e0d1",
      text: "#1b262c",
      muted: "#56656d",
      accent: "#b0432b",
      danger: "#9a3728",
      positive: "#2c6a4a",
      evidence: "#275d7c",
    },
  },
  signal: {
    id: "signal",
    name: "Signal",
    roles: {
      background: "#0f1a15",
      surface: "#172721",
      text: "#f1f6f2",
      muted: "#a4b8ac",
      accent: "#9bd48c",
      danger: "#e6a352",
      positive: "#9bd48c",
      evidence: "#86cbd6",
    },
  },
};

export const PALETTE_IDS = ["blueprint", "ledger", "signal"] as const;

export function paletteFor(id: PaletteId): ThumbnailPalette {
  return THUMBNAIL_PALETTES[id] ?? THUMBNAIL_PALETTES.blueprint;
}
