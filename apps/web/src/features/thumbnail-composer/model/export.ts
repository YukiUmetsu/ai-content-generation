import { documentToPng, documentToSvg, EXPORT_PROFILES, preflightExport } from "@/components/media/svg-export";
import type { Diagnostic, MediaDocument, Size } from "@/components/media/document";
import { composeThumbnail } from "./compose";
import type { Locale, ThumbnailDocument } from "./types";

/** Bundled families the export can actually rasterise. */
export const LOADED_FAMILIES: readonly string[] = ["Geist Variable", "Newsreader Variable"];

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
  const result = await documentToPng(media, { scale: options.scale ?? 1 });
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
