/** Versioned, browser-local storyboard drafts keyed by the selected local project.
 * This is an authoring cache, not a backend project, approved release, or media artifact.
 */
import { canonicalJson, parseStoryboardDraft, serializeStoryboard } from "./serialize";
import type { SemanticStoryboard } from "./types";

export const PROJECT_STORYBOARD_PREFIX = "contentgen:project-storyboard:v1:";
export const MAX_PROJECT_STORYBOARD_BYTES = 256 * 1024;
const PROJECT_ID = /^[a-z0-9][a-z0-9-]{1,79}$/i;

export function projectStoryboardKey(projectId: string): string {
  if (!PROJECT_ID.test(projectId)) throw new Error("Invalid local project ID.");
  return PROJECT_STORYBOARD_PREFIX + projectId;
}

function boundedJson(raw: string): void {
  if (new TextEncoder().encode(raw).length > MAX_PROJECT_STORYBOARD_BYTES) {
    throw new Error("Storyboard exceeds the 256 KB local draft limit. Export the storyboard as JSON.");
  }
}

export function loadProjectStoryboard(projectId: string): {
  board: SemanticStoryboard | null;
  warning: string | null;
} {
  try {
    const raw = localStorage.getItem(projectStoryboardKey(projectId));
    if (raw === null) return { board: null, warning: null };
    boundedJson(raw);
    const parsed = parseStoryboardDraft(raw);
    if (!parsed.ok) throw new Error("The saved document has an invalid storyboard schema.");
    // Reject unknown fields rather than silently dropping them on the next save.
    if (canonicalJson(JSON.parse(raw) as unknown) !== serializeStoryboard(parsed.board)) {
      throw new Error("The saved storyboard includes unrecognized fields.");
    }
    return { board: parsed.board, warning: null };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Storage unavailable.";
    return { board: null, warning: "Stored storyboard could not be loaded: " + detail };
  }
}

export function saveProjectStoryboard(projectId: string, board: SemanticStoryboard): void {
  const raw = serializeStoryboard(board);
  boundedJson(raw);
  const parsed = parseStoryboardDraft(raw);
  if (!parsed.ok || canonicalJson(board) !== serializeStoryboard(parsed.board)) {
    throw new Error("Draft failed schema validation. Export a copy before continuing.");
  }
  localStorage.setItem(projectStoryboardKey(projectId), raw);
}

export function clearProjectStoryboard(projectId: string): void {
  localStorage.removeItem(projectStoryboardKey(projectId));
}
