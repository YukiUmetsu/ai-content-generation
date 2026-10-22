import { layoutText } from "@/components/media/text-layout";
import type { MeasureText } from "@/components/media/text-layout";
import type { Rect } from "@/components/media/document";
import { composeThumbnail } from "./compose";
import type { ComposedThumbnail, TextPlacement } from "./compose";
import type {
  Locale,
  ThumbnailDocument,
  ThumbnailIssue,
  ThumbnailIssueCode,
  ThumbnailQa,
} from "./types";
import { INSPECTION_WIDTHS } from "./types";

const LOCALES: readonly Locale[] = ["en", "ja"];

/** Authoring limits that keep a thumbnail a glance, not a paragraph. */
export const CONTENT_LIMITS = {
  headlineChars: 68,
  valueChars: 10,
  secondaryChars: 96,
} as const;

/** Japanese packs more meaning per character, so the same pixel budget allows fewer of them. */
function contentLimits(locale: Locale): { headline: number; secondary: number } {
  return locale === "ja"
    ? { headline: 34, secondary: 52 }
    : { headline: CONTENT_LIMITS.headlineChars, secondary: CONTENT_LIMITS.secondaryChars };
}

/**
 * Deterministic width estimate used for diagnostics.
 *
 * The browser measures with real loaded fonts. QA must not depend on whether a
 * canvas is available (jsdom has none), so it uses a fixed per-character model
 * with the same font shorthand string the layout passes in. The estimate is
 * deliberately slightly generous: warnings arrive a little early rather than
 * after clipping.
 */
export const estimateMeasure: MeasureText = (font, text) => {
  const sizeMatch = /(\d+(?:\.\d+)?)px/.exec(font);
  const size = sizeMatch ? Number(sizeMatch[1]) : 16;
  let units = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x2e80) {
      units += 1;
    } else if (char === " ") {
      units += 0.26;
    } else if ("iljI.,:;!'|".includes(char)) {
      units += 0.26;
    } else if (/[A-Z0-9$%]/.test(char)) {
      units += 0.62;
    } else {
      units += 0.52;
    }
  }
  return units * size;
};

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function relativeLuminance(hex: string): number | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG relative contrast ratio, or `null` when a colour is not a plain hex. */
export function contrastRatio(foreground: string, background: string): number | null {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  if (a === null || b === null) return null;
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Bounds of a text placement in artboard coordinates, read from its own layer. */
function placementBounds(composed: ComposedThumbnail, placement: TextPlacement): Rect | null {
  const layer = composed.media.layers.find((candidate) => candidate.id === placement.layerId);
  if (!layer) return null;
  return {
    x: layer.transform.x,
    y: layer.transform.y,
    width: layer.transform.width,
    height: layer.transform.height,
  };
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function textLength(text: string): number {
  return [...text.trim()].length;
}

function issue(
  code: ThumbnailIssueCode,
  severity: ThumbnailIssue["severity"],
  variantId: string,
  locale: Locale,
  extra: { layerId?: string; detail?: string } = {}
): ThumbnailIssue {
  return { code, severity, variantId, locale, ...extra };
}

interface CheckContext {
  document: ThumbnailDocument;
  composed: ComposedThumbnail;
  variantId: string;
  locale: Locale;
}

function copyChecks({ composed, variantId, locale }: CheckContext): ThumbnailIssue[] {
  const issues: ThumbnailIssue[] = [];
  const { headline, value, secondary, compare } = composed.text;

  if (textLength(headline.spec.spans.map((span) => span.text).join("")) === 0) {
    issues.push(issue("headline-empty", "error", variantId, locale, { layerId: headline.layerId }));
  }
  if (textLength(value.spec.spans.map((span) => span.text).join("")) === 0) {
    issues.push(issue("value-empty", "error", variantId, locale, { layerId: value.layerId }));
  }

  const limits = contentLimits(locale);
  const headlineText = headline.spec.spans.map((span) => span.text).join("");
  const headlineLength = textLength(headlineText);
  const headlineLayout = layoutText(headline.spec, headline.box, composed.media.fonts, estimateMeasure);
  if (headlineLength > limits.headline || headlineLayout.overflow) {
    issues.push(
      issue("headline-too-long", "warning", variantId, locale, {
        layerId: headline.layerId,
        detail: `chars=${headlineLength};lines=${headlineLayout.lineCount};overflow=${headlineLayout.overflow}`,
      })
    );
  }

  const valueText = value.spec.spans.map((span) => span.text).join("");
  const valueLayout = layoutText(value.spec, value.box, composed.media.fonts, estimateMeasure);
  if (textLength(valueText) > CONTENT_LIMITS.valueChars || valueLayout.overflow) {
    issues.push(
      issue("value-too-long", "warning", variantId, locale, {
        layerId: value.layerId,
        detail: `chars=${textLength(valueText)};overflow=${valueLayout.overflow}`,
      })
    );
  }

  const secondaryText = secondary.spec.spans.map((span) => span.text).join("");
  const secondaryLayout = layoutText(secondary.spec, secondary.box, composed.media.fonts, estimateMeasure);
  if (
    textLength(secondaryText) > limits.secondary ||
    secondaryLayout.overflow ||
    secondaryLayout.truncated ||
    secondaryLayout.width > secondary.box.width
  ) {
    issues.push(
      issue("secondary-too-long", "warning", variantId, locale, {
        layerId: secondary.layerId,
        detail: `chars=${textLength(secondaryText)};lines=${secondaryLayout.lineCount};width=${secondaryLayout.width}/${secondary.box.width};overflow=${secondaryLayout.overflow};truncated=${secondaryLayout.truncated}`,
      })
    );
  }

  if (compare) {
    const compareText = compare.spec.spans.map((span) => span.text).join("");
    const compareLayout = layoutText(compare.spec, compare.box, composed.media.fonts, estimateMeasure);
    const authoredCompare = composed.variant.copy[locale]?.compareValue?.trim() ?? "";
    if (authoredCompare === "") {
      issues.push(
        issue("compare-empty", "error", variantId, locale, {
          layerId: compare.layerId,
          detail: "compareValue=",
        })
      );
    } else if (textLength(compareText) > CONTENT_LIMITS.valueChars || compareLayout.overflow) {
      issues.push(
        issue("value-too-long", "warning", variantId, locale, {
          layerId: compare.layerId,
          detail: `chars=${textLength(compareText)};overflow=${compareLayout.overflow}`,
        })
      );
    }
  }

  return issues;
}

function safeMarginChecks({ document, composed, variantId, locale }: CheckContext): ThumbnailIssue[] {
  const inset = Math.max(0, Math.round(document.output.width * document.output.safeInset));
  const insetY = Math.max(0, Math.round(document.output.height * document.output.safeInset));
  const safe: Rect = {
    x: inset,
    y: insetY,
    width: document.output.width - inset * 2,
    height: document.output.height - insetY * 2,
  };
  const excluded = new Set(composed.exclusions);
  const issues: ThumbnailIssue[] = [];
  for (const layer of composed.media.layers) {
    if (excluded.has(layer.id) || layer.id.endsWith("-bg")) continue;
    const box: Rect = {
      x: layer.transform.x,
      y: layer.transform.y,
      width: layer.transform.width,
      height: layer.transform.height,
    };
    if (box.x < safe.x || box.y < safe.y || box.x + box.width > safe.x + safe.width || box.y + box.height > safe.y + safe.height) {
      issues.push(
        issue("safe-margin", "warning", variantId, locale, {
          layerId: layer.id,
          detail: `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)}`,
        })
      );
    }
  }
  return issues;
}

function contrastChecks({ composed, variantId, locale }: CheckContext): ThumbnailIssue[] {
  const p = composed.palette.roles;
  const surfaceLayers = new Set(["c-label-left", "c-label-right", "c-value-left", "c-value-right"]);
  const placements: TextPlacement[] = Object.values(composed.text).filter(Boolean) as TextPlacement[];
  const issues: ThumbnailIssue[] = [];
  for (const placement of placements) {
    const span = placement.spec.spans[0];
    if (!span?.color) continue;
    const background = surfaceLayers.has(placement.layerId) ? p.surface : p.background;
    const ratio = contrastRatio(span.color, background);
    if (ratio !== null && ratio < 4.5) {
      issues.push(
        issue("low-contrast", "warning", variantId, locale, {
          layerId: placement.layerId,
          detail: `ratio=${ratio.toFixed(2)}`,
        })
      );
    }
  }
  return issues;
}

function smallSizeChecks({ composed, variantId, locale }: CheckContext): ThumbnailIssue[] {
  const issues: ThumbnailIssue[] = [];
  const [medium, small] = INSPECTION_WIDTHS;
  const placements: Array<{ placement: TextPlacement; role: "headline" | "value" | "compare" }> = [
    { placement: composed.text.headline, role: "headline" },
    { placement: composed.text.value, role: "value" },
  ];
  if (composed.text.compare) {
    placements.push({ placement: composed.text.compare, role: "compare" });
  }
  for (const { placement, role } of placements) {
    const layout = layoutText(placement.spec, placement.box, composed.media.fonts, estimateMeasure);
    const atMedium = (layout.size * medium) / 1280;
    if (atMedium < 10) {
      issues.push(
        issue("small-size-legibility", "warning", variantId, locale, {
          layerId: placement.layerId,
          detail: `${role}@${medium}px=${atMedium.toFixed(1)}`,
        })
      );
    }
    if (role === "value" || role === "compare") {
      const atSmall = (layout.size * small) / 1280;
      if (atSmall < 12) {
        issues.push(
          issue("small-size-legibility", "warning", variantId, locale, {
            layerId: placement.layerId,
            detail: `${role}@${small}px=${atSmall.toFixed(1)}`,
          })
        );
      }
    }
  }
  return issues;
}

function overlapChecks({ composed, variantId, locale }: CheckContext): ThumbnailIssue[] {
  const placements: TextPlacement[] = Object.values(composed.text).filter(Boolean) as TextPlacement[];
  const bounds = placements
    .map((placement) => ({ placement, box: placementBounds(composed, placement) }))
    .filter((entry): entry is { placement: TextPlacement; box: Rect } => entry.box !== null);
  const issues: ThumbnailIssue[] = [];
  for (let i = 0; i < bounds.length; i += 1) {
    for (let j = i + 1; j < bounds.length; j += 1) {
      if (intersects(bounds[i].box, bounds[j].box)) {
        issues.push(
          issue("text-overlap", "warning", variantId, locale, {
            layerId: bounds[i].placement.layerId,
            detail: `${bounds[i].placement.layerId}/${bounds[j].placement.layerId}`,
          })
        );
      }
    }
  }
  return issues;
}

/**
 * Deterministic QA for every variant in both locales. The composer stores this
 * snapshot on the document so export code and tests see the same result.
 */
export function collectIssues(document: ThumbnailDocument): ThumbnailIssue[] {
  const issues: ThumbnailIssue[] = [];
  for (const variant of document.variants) {
    for (const locale of LOCALES) {
      let composed: ComposedThumbnail;
      try {
        composed = composeThumbnail(document, { variantId: variant.id, locale });
      } catch (error) {
        // A failed composition is never a pass: surface it as a blocking issue
        // with the machine reason, so export cannot silently ship nothing.
        issues.push(
          issue("composition-failed", "error", variant.id, locale, {
            detail: error instanceof Error ? error.message : String(error),
          })
        );
        continue;
      }
      const context: CheckContext = { document, composed, variantId: variant.id, locale };
      issues.push(...copyChecks(context));
      issues.push(...safeMarginChecks(context));
      issues.push(...contrastChecks(context));
      issues.push(...smallSizeChecks(context));
      issues.push(...overlapChecks(context));
    }
  }
  return issues;
}

export function qaStatus(issues: readonly ThumbnailIssue[]): ThumbnailQa["status"] {
  if (issues.some((entry) => entry.severity === "error")) return "blocked";
  if (issues.length > 0) return "warnings";
  return "pass";
}

export function refreshQa(document: ThumbnailDocument): ThumbnailDocument {
  const issues = collectIssues(document);
  return {
    ...document,
    qa: {
      status: qaStatus(issues),
      checkedRevision: document.revision,
      issues,
    },
  };
}

/** Issues for the variant + locale currently on screen. */
export function issuesFor(
  document: ThumbnailDocument,
  variantId: string,
  locale: Locale
): ThumbnailIssue[] {
  return document.qa.issues.filter((entry) => entry.variantId === variantId && entry.locale === locale);
}
