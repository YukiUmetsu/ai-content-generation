import { createThumbnailDocument, HVAC_EXAMPLE_JA } from "./fixtures";
import { parseThumbnailDocument, serializeThumbnailDocument } from "./edit";
import type { Locale, ThumbnailDocument } from "./types";

const DOCUMENT_PREFIX = "contentgen:thumbnail-document:v1:";
const MAX_DOCUMENT_BYTES = 800_000;

export const thumbnailDocumentKey = (projectId: string) => DOCUMENT_PREFIX + projectId;

export function loadThumbnailDraft(projectId: string, locale: Locale): {
  document: ThumbnailDocument; blocked: boolean; warning: string;
} {
  const fallback = createThumbnailDocument({ projectId, ...(locale === "ja" ? HVAC_EXAMPLE_JA : {}) });
  try {
    const saved = localStorage.getItem(thumbnailDocumentKey(projectId));
    if (saved !== null) {
      if (saved.length > MAX_DOCUMENT_BYTES) return { document: fallback, blocked: true,
        warning: "Saved thumbnail is too large. It has not been overwritten." };
      let candidate: unknown;
      try { candidate = JSON.parse(saved); }
      catch { return { document: fallback, blocked: true, warning: "Saved thumbnail is unreadable. It has not been overwritten." }; }
      const parsed = parseThumbnailDocument(candidate);
      if (!parsed.document || parsed.document.projectId !== projectId) return { document: fallback, blocked: true,
        warning: "Saved thumbnail has invalid content or belongs to another production. It has not been overwritten." };
      return { document: parsed.document, blocked: false, warning: "" };
    }
    return { document: fallback, blocked: false, warning: "" };
  } catch {
    return { document: fallback, blocked: true,
      warning: "Browser storage is unavailable. Edits will not be saved until storage is restored." };
  }
}

export function saveThumbnailDraft(document: ThumbnailDocument): void {
  const serialized = serializeThumbnailDocument(document);
  if (serialized.length > MAX_DOCUMENT_BYTES) throw Error("Thumbnail document exceeds the local storage size limit.");
  localStorage.setItem(thumbnailDocumentKey(document.projectId), serialized);
}
