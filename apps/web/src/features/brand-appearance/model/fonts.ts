import type { FontFamily } from "./types";

export const FONT_STACKS: Record<FontFamily, string> = {
  Geist: "var(--km-font-sans)",
  Newsreader: "var(--km-font-serif)",
  "System Sans":
    "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable', 'Segoe UI', Roboto, 'Helvetica Neue', 'Noto Sans', sans-serif",
  "System Mono":
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
};

export function cssFontStack(family: FontFamily): string {
  return FONT_STACKS[family];
}
