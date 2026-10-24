import { makeCatalogId, persistCatalog, type LocalContent, type StudioCatalog } from "./catalog-model";
import { draftToStoryboard, validateEditorialDraft, type EditorialDraft } from "./editorial-brief";
import { clearProjectStoryboard, saveProjectStoryboard } from "@/features/storyboard-planner/model/project-storage";
import type { Locale } from "@/features/registry";
import { researchToStoryboard, type ResearchDraftResult } from "./researched-storyboard";

/** Create a fresh video workspace; no existing project's storyboard is ever replaced. */
export function createEditorialProject(catalog: StudioCatalog, candidate: EditorialDraft, locale: Locale, research?: ResearchDraftResult): StudioCatalog {
  const draft = validateEditorialDraft(candidate);
  const projectId = makeCatalogId("project");
  const approach = draft.approaches.find(x=>x.id===draft.selectedId)!;
  const board = research?researchToStoryboard(research,projectId,locale):draftToStoryboard(draft, projectId, locale);
  const now = new Date().toISOString();
  const notes = ["Unverified editorial draft — fact-check before publishing.",
    ...(research?[`Research snapshot: ${research.snapshotId}; evidence citations and gaps are retained in the storyboard.`]:[]),
    `Audience: ${draft.input.audience}`, `Question: ${draft.input.viewerQuestion}`,
    `Intended payoff: ${draft.input.payoff}`,
    ...[...new Set([draft.input.inspirationUrl,...draft.input.inspirationUrls].filter(Boolean))].map(url=>`Inspiration only, NOT evidence: ${url}`),
  ].join("\n").slice(0, 2000);
  const content: LocalContent = {id:makeCatalogId("item"),projectId,name:research?board.title:approach.title,
    notes,kind:"video",stage:"draft",createdAt:now};
  const next: StudioCatalog = {...catalog, activeProjectId:projectId,
    projects:[...catalog.projects,{id:projectId,name:research?board.title:approach.title,notes:research?"Research-grounded editorial draft requiring factual review.":"Video storyboard draft from original niche brief.",createdAt:now}],
    content:[...catalog.content,content]};
  // Validate/store the new storyboard first, then catalog. Only the newly-created
  // storyboard is cleared on failure; active project state is unchanged.
  saveProjectStoryboard(projectId,board);
  try { persistCatalog(next); }
  catch (error) {
    try { clearProjectStoryboard(projectId); } catch { /* Preserve original failure. */ }
    throw error;
  }
  return next;
}
