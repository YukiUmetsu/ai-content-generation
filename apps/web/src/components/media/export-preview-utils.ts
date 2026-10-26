/** Shared pure geometry and browser download utilities for the export preview. */
import type { ExportProfile, Size } from "./document";
import { ASPECT_PRESETS, presetForDimensions } from "./document";
import { EXPORT_PROFILES } from "./svg-export";

/** Replace unsafe filename characters so a document id cannot inject a path. */
function sanitizeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Human-readable aspect label and a compact suffix for filenames. */
export function aspectParts(size: Size): { label: string; suffix: string } {
  const preset = presetForDimensions(size.width, size.height);
  if (preset === "custom") {
    return {
      label: `${size.width}×${size.height}`,
      suffix: `${size.width}x${size.height}`,
    };
  }
  return {
    label: ASPECT_PRESETS[preset].label,
    suffix: preset.replace(":", "x"),
  };
}

/** Build a download filename from the document id, size aspect and profile. */
export function exportFilename(documentId: string, size: Size, profile: ExportProfile): string {
  const safeId = sanitizeFilename(documentId) || "export";
  const extension = EXPORT_PROFILES[profile].extension;
  return `${safeId}-${aspectParts(size).suffix}.${extension}`;
}

/** Trigger a browser download for a blob and clean up the object URL. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

