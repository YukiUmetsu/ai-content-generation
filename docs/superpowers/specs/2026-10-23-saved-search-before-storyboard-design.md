# Saved search before storyboard design (2026-10-23)

## Intent
A successful Studio Research SearXNG search must be visible and persist locally even when webpage capture, the local model, quote validation, or storyboard generation fails. Users may search without loading any model, inspect the source leads, return to previous searches, and retry story generation from a chosen saved search.

## Approaches
- A. Keep the latest search in browser state/localStorage: few changes, but browser reloads, large data, and later server failures can lose provenance.
- **B. Chosen for this implementation:** add a versioned immutable *search-only* snapshot beside existing Studio research snapshots, with separate Search and Generate UI actions. Reuse the exact saved leads on retries. This meets offline restoration without a new database.
- C. Ingest search leads directly into Evidence Library SQLite: enables global FTS but inaccurately elevates uncaptured search snippets into source passages and requires a migration/indexing contract. Deferred.

## Experience
1. In **Research**, **Search & save sources** performs one explicit local SearXNG query, stores up to ten deduplicated public HTTPS leads and returns them immediately. No model call. The source list displays title, link, concise provider excerpt if supplied, retrieval time, and an explicit “Search lead — not verified evidence” distinction.
2. **Research & generate storyboard** uses an already-saved search that matches the current topic/question/audience/locale. If none matches, it searches and saves first and displays the sources before starting capture/claim extraction/story planning. The original action remains one-click.
3. A bad/non-verbatim model quote, planning timeout, or cancellation must never delete the saved search; show an actionable error and keep source links visible. **Retry generation** uses the same saved result list, without repeating SearXNG.
4. A compact **Saved searches** disclosure lists recent local snapshots. Selecting one restores the brief fields and links. Changing any brief field invalidates the selected search for generation, never deletes it.
5. Search is available when the search service is ready even if local models are missing; generation remains gated on the required local model settings.

## Data and security
- Store versioned JSON locally under the existing ignored `data/studio-research` root. A saved search has an immutable timestamped, SHA-256-addressed ID; bounded title/query/audience/locale, provider, search timestamp and at most ten {title,url,snippet} leads. No raw page content or claims are stored in this search-only artifact.
- Reuse the existing SearXNG loopback and public HTTPS URL guards. Reject mismatched saved-search brief and tampered filenames/content. Same-origin explicit POST and strict size limits; GET returns only validated non-secret fields.
- Search results are discovery leads, not captured text, factual evidence, verified claims or Evidence Library FTS entries. Existing exact quote/capture hash gates remain unchanged.

## Test and acceptance
- SearXNG succeeds, local model fails: search response is visible, snapshot survives server restart/reload and can be retrieved.
- Standalone Search succeeds without looking up any AI model.
- A saved snapshot drives story generation with **zero new search calls**. Mismatch and digest tampering fail safely.
- A model quotation failure leaves the saved search intact and visible; retry uses same search.
- Empty results, unsafe URLs, malformed/cross-origin requests, abort, missing artifact, race with edited topic, EN/JA and accessible source links all have clear behavior.
- Relevant Node tests run and frontend test/build are attempted; actual runner limitations must be reported without invented passes.

## Non-goals
Full Evidence Library ingestion/FTS, claim-level fact-checking, automatic correction of hallucinated quotes, remote sync, auto publishing, scraping all results, or unbounded search history.
