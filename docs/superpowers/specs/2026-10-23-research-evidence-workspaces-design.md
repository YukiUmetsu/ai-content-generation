# Research and Evidence Workspace Redesign

## Intent

Make the ContentGen Studio research area understandable and professionally organized for a solo video creator. Today, stored-passage search, YouTube inspiration, AI research, and storyboard authoring occupy the same Evidence view despite differing data sources and outcomes. An empty stored-passage index is also presented as a degraded search experience.

## Selected approach

**A — separate Research and Evidence Library** within the existing Studio Research workspace. Keep Packaging and YouTube Intelligence as neighboring tabs. Do not introduce a new top-level sidebar or nested tab hierarchy.

Alternatives considered:

- **B — one unified page with collapsible sections:** preserves the current navigation but still combines distinct tasks in one scrolling view.
- **A — distinct tabs (selected):** gives each task a clear purpose, cleaner layout, and independent input state with a modest navigation change.

## Experience

1. Tabs, in order: **Research**, **Evidence Library**, **Packaging**, **YouTube Intelligence**. Research is the default tab. Use existing tab semantics and responsive behavior; localize English and Japanese labels and descriptions.
2. **Research:** concise header describing the draft-generation workflow, one visible topic input, YouTube inspiration, research options, the generation action, and evidence/claim review when a draft exists. Preserve existing research-draft restoration, local-model routing, selection and storyboard creation. Use clear section rhythm rather than piling boxes on the page.
3. **Evidence Library:** a focused header, prominent source-passage search, concise index-health strip, and ranked excerpt cards. Separate the library search query from the Research project topic; searching must not invalidate an in-progress research draft or mutate its topic. Keep all truthful source/version/license/locator information available in a collapsed details area, with titles and citations legible first.
4. **Index empty:** friendly neutral empty state that says there are no saved source passages. Explain that AI Research drafts and the persisted passage index are different stores. Do not show a warning-colored `Search degraded` panel for a normal empty index. Reserve degraded/warning treatment for truly stale or failed states. No fabricated samples or unsupported `Import`/`Index now` action.
5. **Other states:** no query, loading/cancel, genuine no-match, error/retry, actual results, numeric values and contradictions remain accessible and clearly distinguishable. Preserve semantic labels, safe outbound source links, keyboard access and readable mobile layout.

## Non-goals

- Automatic ingestion of AI-generated research drafts into SQLite; that requires separate persistence and attribution design.
- Backend evidence API or database changes.
- New YouTube collection logic, storyboard generation logic, or Packaging authoring.
- Placeholder evidence, misleading index counts, or invented verification claims.

## Acceptance checks

- Four tabs have distinct named panels and the Research flow still restores/creates storyboards.
- Evidence search changes only the evidence query; it never edits the project topic or cancels research.
- Empty, no matches, stale, network failure and populated data render distinct, honest states.
- Result excerpts and source titles lead; provenance metadata, numbers and contradictions remain inspectable.
- Existing English/Japanese localization and relevant UI/API tests remain valid, with focused regressions for the new behavior.

## Builder decisions

- Reuse current Tailwind tokens, `Tabs`, `Button`, `Surface`, `EmptyState`, and `ApiErrorNotice` where suitable.
- Prefer CSS and native disclosure elements to new dependencies or animation libraries.
- Keep all unrelated project and API behavior intact.
