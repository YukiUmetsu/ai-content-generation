import geistWoff2 from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url";
import newsreaderWoff2 from "@fontsource-variable/newsreader/files/newsreader-latin-wght-normal.woff2?url";
import { documentToPng, documentToSvg, EXPORT_PROFILES, preflightExport } from "@/components/media/svg-export";
import type { Diagnostic, MediaDocument, Size } from "@/components/media/document";
import { composeThumbnail } from "./compose";
import type { Locale, ThumbnailDocument } from "./types";

/** Bundled families the export can actually rasterise. */
export const LOADED_FAMILIES: readonly string[] = ["Geist Variable", "Newsreader Variable"];

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

let exportFontCss: Promise<string> | null = null;

/**
 * Embedded faces for rasterisation. An SVG loaded into an `<img>` cannot read
 * the page's font-face rules, so the PNG path fetches the bundled faces and
 * embeds them. Japanese glyphs still fall back to the platform CJK font.
 * Failure is non-fatal: the exporter then reports its normal font-substitution
 * diagnostic instead of blocking the image.
 */
export function loadExportFontCss(): Promise<string> {
  if (!exportFontCss) {
    const faces: Array<[string, string]> = [
      ["Geist Variable", geistWoff2],
      ["Newsreader Variable", newsreaderWoff2],
    ];
    exportFontCss = Promise.all(
      faces.map(async ([family, url]) => {
        try {
          const response = await fetch(url);
          if (!response.ok) return "";
          const data = await response.arrayBuffer();
          return `@font-face{font-family:'${family}';font-style:normal;font-weight:100 900;src:url(data:font/woff2;base64,${toBase64(data)}) format('woff2');}`;
        } catch {
          return "";
        }
      })
    ).then((parts) => parts.join(""));
  }
  return exportFontCss;
}

export interface ThumbnailExportOptions {
  variantId?: string;
  locale?: Locale;
  scale?: number;
}

export interface ThumbnailSvgResult {
  svg: string;
  size: Size;
  diagnostics: Diagnostic[];
  filename: string;
}

export interface ThumbnailPngResult {
  blob: Blob;
  size: Size;
  diagnostics: Diagnostic[];
  filename: string;
  /** The exact SVG that was rasterised. */
  svg: string;
}

export function exportMedia(
  document: ThumbnailDocument,
  options: ThumbnailExportOptions = {}
): MediaDocument {
  return composeThumbnail(document, {
    variantId: options.variantId,
    locale: options.locale,
  }).media;
}

function safeSlug(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "thumbnail";
}

export function thumbnailFileName(
  document: ThumbnailDocument,
  options: ThumbnailExportOptions,
  format: "svg" | "png",
  size: Size
): string {
  const variant =
    document.variants.find((candidate) => candidate.id === (options.variantId ?? document.activeVariantId)) ??
    document.variants[0];
  const concept = variant?.concept ?? "concept";
  return `${safeSlug(document.id)}-${safeSlug(concept)}-${size.width}x${size.height}.${EXPORT_PROFILES[`still-${format}`].extension}`;
}

export function thumbnailSvg(
  document: ThumbnailDocument,
  options: ThumbnailExportOptions = {}
): ThumbnailSvgResult {
  const media = exportMedia(document, options);
  const scale = options.scale ?? 1;
  const { svg, size } = documentToSvg(media, { scale });
  const diagnostics = preflightExport(media, {
    scale,
    availableFontFamilies: LOADED_FAMILIES,
  });
  return {
    svg,
    size,
    diagnostics,
    filename: thumbnailFileName(document, options, "svg", size),
  };
}

export async function thumbnailPng(
  document: ThumbnailDocument,
  options: ThumbnailExportOptions = {}
): Promise<ThumbnailPngResult> {
  const media = exportMedia(document, options);
  const fontCss = await loadExportFontCss();
  const result = await documentToPng(media, {
    scale: options.scale ?? 1,
    ...(fontCss ? { fontCss } : {}),
  });
  return {
    blob: result.blob,
    size: result.size,
    diagnostics: result.diagnostics,
    filename: thumbnailFileName(document, options, "png", result.size),
    svg: result.svg,
  };
}

/** Browser-only export action; kept out of render so jsdom tests can inspect it. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadSvg(result: ThumbnailSvgResult): void {
  downloadBlob(new Blob([result.svg], { type: EXPORT_PROFILES["still-svg"].mimeType }), result.filename);
}
