import type { BrandPalette, PaletteRole } from "./types";

export const FALLBACK_NEUTRAL = "#808080";

export function normalizeHex(value: string): string | null {
  const trimmed = value.trim();
  if (/^#[0-9A-Fa-f]{3}$/.test(trimmed)) {
    const [, r, g, b] = trimmed.split("");
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  if (/^#[0-9A-Fa-f]{6}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  return null;
}

export function isValidHex(value: string): boolean {
  return normalizeHex(value) !== null;
}

export function safeHex(value: string): string {
  return normalizeHex(value) ?? FALLBACK_NEUTRAL;
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): RGB | null {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  const raw = normalized.slice(1);
  return {
    r: parseInt(raw.slice(0, 2), 16),
    g: parseInt(raw.slice(2, 4), 16),
    b: parseInt(raw.slice(4, 6), 16),
  };
}

function channelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const r = channelToLinear(rgb.r);
  const g = channelToLinear(rgb.g);
  const b = channelToLinear(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number | null {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  if (l1 == null || l2 == null) return null;
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export interface ContrastIssue {
  foreground: PaletteRole;
  background: PaletteRole;
  ratio: number;
  required: number;
}

export function findContrastIssues(palette: BrandPalette): ContrastIssue[] {
  const issues: ContrastIssue[] = [];
  const pairs: Array<[PaletteRole, PaletteRole, number]> = [
    ["textPrimary", "canvas", 4.5],
    ["textPrimary", "surface", 4.5],
    ["textSecondary", "canvas", 4.5],
    ["textSecondary", "surface", 4.5],
    ["accent", "canvas", 3],
    ["positive", "surface", 4.5],
    ["negative", "surface", 4.5],
  ];

  for (const [fg, bg, required] of pairs) {
    const ratio = contrastRatio(palette[fg], palette[bg]);
    if (ratio != null && ratio < required) {
      issues.push({ foreground: fg, background: bg, ratio, required });
    }
  }
  return issues;
}

export function hasInvalidPaletteValues(
  input: Record<PaletteRole, string>
): boolean {
  return Object.values(input).some((value) => !isValidHex(value));
}
