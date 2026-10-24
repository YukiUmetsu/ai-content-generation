/** Standalone non-component React hook: Vite Fast Refresh treats component modules consistently. */
import { useCallback, useMemo } from "react";
import type { Diagnostic, MediaDocument, Size } from "./document";
import type { PngExportResult } from "./svg-export";
import { documentToPng, documentToSvg, EXPORT_PROFILES, preflightExport } from "./svg-export";
import type { ExportPreviewProps } from "./export-preview";
import { downloadBlob, exportFilename } from "./export-preview-utils";

const EMPTY_FAMILIES: readonly string[] = [];

/**
 * Reactive view of the exporter for a document, so consumers can drive their own UI.
 *
 * The returned `svg` and `diagnostics` are memoised by value-stable inputs:
 * `document` identity, `outputSize` width/height, `resolveAssetHref` identity,
 * `fontCss`, `scale`, and a sorted copy of `availableFontFamilies`. Callers should
 * treat the document as immutable data and replace it as a whole rather than
 * mutating nested fields, otherwise the export will rerun on every render.
 */
export function useExportPreview(
  document: MediaDocument,
  options?: Pick<
    ExportPreviewProps,
    "outputSize" | "availableFontFamilies" | "resolveAssetHref" | "fontCss" | "scale"
  >
): {
  size: Size;
  svg: string;
  diagnostics: Diagnostic[];
  blocking: readonly Diagnostic[];
  canExport: boolean;
  exportPng: () => Promise<PngExportResult>;
  downloadSvg: () => void;
  downloadPng: () => Promise<void>;
} {
  const {
    outputSize,
    availableFontFamilies = EMPTY_FAMILIES,
    resolveAssetHref,
    fontCss,
    scale = 1,
  } = options ?? {};

  const sortedFamilies = useMemo(
    () => [...availableFontFamilies].sort(),
    [availableFontFamilies]
  );

  /**
   * The export scale is the caller's preview scale multiplied by the ratio
   * between the requested output width and the artboard width. Height follows
   * automatically so the artwork is never stretched.
   */
  const exportScale = useMemo(() => {
    const base = scale ?? 1;
    if (!outputSize || document.artboard.width <= 0) return base;
    return base * (outputSize.width / document.artboard.width);
  }, [scale, outputSize, document.artboard.width]);

  /**
   * The small-format strip and the download both use this exact SVG string.
   * `documentToSvg` is pure and deterministic: the same inputs always produce
   * the same bytes, so the preview and the deliverable cannot drift.
   */
  const { svg, size } = useMemo(() => {
    return documentToSvg(document, {
      scale: exportScale,
      resolveAssetHref,
      fontCss,
    });
  }, [document, exportScale, resolveAssetHref, fontCss]);

  const diagnostics = useMemo(() => {
    return preflightExport(document, {
      scale: exportScale,
      resolveAssetHref,
      fontCss,
      availableFontFamilies: sortedFamilies,
    });
  }, [document, exportScale, resolveAssetHref, fontCss, sortedFamilies]);

  const blocking = useMemo(
    () => diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
    [diagnostics]
  );

  const canExport = blocking.length === 0;

  const exportPng = useCallback(() => {
    return documentToPng(document, {
      scale: exportScale,
      resolveAssetHref,
      fontCss,
    });
  }, [document, exportScale, resolveAssetHref, fontCss]);

  const downloadSvg = useCallback(() => {
    const blob = new Blob([svg], { type: EXPORT_PROFILES["still-svg"].mimeType });
    downloadBlob(blob, exportFilename(document.id, size, "still-svg"));
  }, [svg, size, document.id]);

  const downloadPng = useCallback(async () => {
    const result = await exportPng();
    downloadBlob(result.blob, exportFilename(document.id, result.size, "still-png"));
  }, [exportPng, document.id]);

  return {
    size,
    svg,
    diagnostics,
    blocking,
    canExport,
    exportPng,
    downloadSvg,
    downloadPng,
  };
}
