/**
 * Colour math shared by charts, blocks and visualizers. Pure and token-aware:
 * every helper falls back gracefully when a colour is not a hex literal (for
 * example a CSS custom property supplied by a consumer theme).
 */

import { clamp } from "./primitives";
import type { ResolvedStyle } from "./types";

export function parseHex(hex: string): [number, number, number] | null {
  const value = hex.trim().replace("#", "");
  if (!/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return null;
  const full =
    value.length === 3
      ? value
          .split("")
          .map((char) => char + char)
          .join("")
      : value;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

/** Blend two hex colours. Falls back to `from` when either side is not hex (e.g. a token var). */
export function mixHex(from: string, to: string, t: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  if (!a || !b) return from;
  const amount = clamp(t, 0, 1);
  const channel = (index: number) => Math.round(a[index] + (b[index] - a[index]) * amount);
  const hex = (value: number) => value.toString(16).padStart(2, "0");
  return `#${hex(channel(0))}${hex(channel(1))}${hex(channel(2))}`;
}

/** Relative luminance of a hex colour (sRGB), or `null` for non-hex tokens. */
export function luminance(hex: string): number | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colours, or `null` for non-hex tokens. */
export function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Ink or on-accent text, whichever contrasts more with `fill`. */
export function readableOn(fill: string, style: ResolvedStyle): string {
  const dark = contrastRatio(fill, style.color.ink);
  const light = contrastRatio(fill, style.color.onAccent);
  if (dark === null || light === null) return style.color.ink;
  return dark >= light ? style.color.ink : style.color.onAccent;
}
