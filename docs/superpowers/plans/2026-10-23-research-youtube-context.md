# Automatic YouTube Context in Studio Research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically surface related cached YouTube observations inside Studio Research, and carry creator-selected inspiration URLs into original video creation without mistaking them for factual evidence.

**Architecture:** Extend Rust SQLite market storage with bounded read-only cross-watchlist matching and a GET route. Add a typed frontend API and a self-contained React panel in Research, then extend editorial draft input to carry up to five URL-only references while preserving version-one drafts and the existing storyboard semantics.

**Tech Stack:** Rust, Axum, SQLite/rusqlite, TypeScript, React, Vitest/Testing Library, Vite.

**Spec:** `docs/superpowers/specs/2026-10-23-research-youtube-context-design.md`

## Global Constraints

- Existing local cached observations only. Opening the panel never triggers a YouTube API request or reserves quota.
- Expired data is excluded; only URLs, not titles/channel/stats, are persisted in editorials.
- No derived performance metrics or evidence claim promotion from YouTube data.
- No cloud LLM or dependency addition; preserve local projects and old editorial drafts.
- One user-facing PR, reproducible tests, and meaningful empty/error states.

## Review Focus

- Duplicate video IDs across multiple watchlists must appear once, with the newest unexpired observation. [Task 1]
- Short topic words, punctuation, and case differences must not leak unrelated videos; empty/invalid topics must fail cheaply. [Task 1]
- A changing topic while the previous request runs must not flash stale recommendations. [Task 2]
- With no cached videos or no API key, normal Research still works and explains collection setup accurately. [Task 2]
- Old drafts with a single inspiration URL must remain readable; neither URLs nor market stats may be promoted into claim references. [Task 3]

---

### Task 1: Bounded, read-only related-video endpoint

**Files:**
- Modify: `crates/server/src/research/market_store.rs`
- Modify: `crates/server/src/research/market_api.rs`
- Test: `crates/server/tests/market_store.rs`

**Interfaces:**
- `pub fn find_related_observations(db: &Connection, topic: &str, now: i64) -> Result<Vec<RelatedMarketVideo>, MarketError>` where `RelatedMarketVideo` contains flattened `MarketVideoRecord` fields, `watchlistName`, and `matchedTerms`.
- `GET /api/research/market/related?topic=...` returns `{ videos: RelatedMarketVideo[] }` up to 12 items or a validation error; no API key required.

- [ ] Add store tests creating two watchlists with overlapping recent video IDs, an unrelated video, expired record, case/punctuation variants, and no quota change; expect a single most-recent match with source attribution and only valid nonexpired rows.
- [ ] Run `cargo test -p contentgen-server --test market_store` and confirm the new tests fail because the function does not exist.
- [ ] Implement bounded normalization (drop stopwords, retain meaningful tokens), database query and deduplication, and GET route. Limit returned videos to 12 and input topic to 160 characters. Do not calculate a public relevance/performance score.
- [ ] Re-run Rust market tests; expect PASS.

### Task 2: Automatic Research context UI

**Files:**
- Modify: `apps/web/src/lib/api/market.ts`
- Create: `apps/web/src/app/related-youtube-panel.tsx`
- Create: `apps/web/src/app/related-youtube-panel.test.tsx`
- Modify: `apps/web/src/app/research-workspace.tsx`
- Modify: `apps/web/src/app/evidence-panel.tsx` (only if needed to share topic)
- Modify: `apps/web/src/app/shell.tsx` (pass active project topic)

**Interfaces:**
- `loadRelatedMarketVideos(topic: string, options?: {signal?: AbortSignal}): Promise<RelatedMarketVideo[]>` validates the provider response and aborts on topic changes.
- `RelatedYoutubePanel({ locale, topic, onSelectUrls, initialUrls? })` renders the read-only observations and bounded URL selections; `ResearchWorkspace` owns the selected links and topic.

- [ ] Write React tests: auto-request after debounce for a nonempty topic, no request on empty topic, latest topic wins, rendering source/provenance, unknown counts, no key needed, zero-result/server-error states, selecting at most five URLs, and source-only transfer.
- [ ] Run `pnpm --dir apps/web exec vitest run src/app/related-youtube-panel.test.tsx` and confirm failure.
- [ ] Add API parse/transport, automatic UI panel, separate disclaimer, loading/error/empty descriptions and sample topic suggestion; integrate it with the existing Research screen instead of adding a new required workflow.
- [ ] Run focused tests; expect PASS.

### Task 3: URL-only handoff into original-video creation

**Files:**
- Modify: `apps/web/src/app/editorial-brief.ts`
- Modify: `apps/web/src/app/editorial-project.ts`
- Modify: `apps/web/src/app/youtube-intelligence-panel.tsx`
- Modify: `apps/web/src/app/research-workspace.tsx`
- Modify: `apps/web/src/app/shell.tsx`
- Test: `apps/web/src/app/editorial-brief.test.ts`
- Test: `apps/web/src/app/editorial-project.test.ts`
- Test: `apps/web/src/app/youtube-intelligence-panel.test.tsx`

**Interfaces:**
- `EditorialInput.inspirationUrls?: string[]` compatible with existing `inspirationUrl: string` stored briefs; validator normalizes/validates HTTPS YouTube URLs, deduplicates and caps at five, retaining old notes.
- `onCreateStoryboard(draft)` continues to create an original project; selected links are included only in editorial assumptions/project notes, never claims.

- [ ] Write failing unit and UI tests for old one-link input, multi-link dedupe/cap, selection handoff, project note persistence and untouched unverified claims.
- [ ] Run focused Vitest; expect FAIL for new interface/behavior.
- [ ] Add a safe compatible optional field to v1 draft validator (normalize absent to `[]`) and pass selected URL-only references through project/storyboard. Research creator UI reuses editorial creation with links selected in Research.
- [ ] Run focused tests; expect PASS.

### Task 4: Full verification and handoff

**Files:**
- Modify: `docs/superpowers/specs/2026-10-23-research-youtube-context-design.md` (status only)
- Modify: relevant user-facing README/testing notes if needed

- [ ] Run `cargo test -p contentgen-server --test market_store` and relevant API tests.
- [ ] Run `pnpm --dir apps/web exec vitest run` and `pnpm --dir apps/web run build` (or repo's exact CI equivalents).
- [ ] Review `git diff` for accidental touched previous-PR changes and for any market-derived numbers embedded in scripts/storyboards.
- [ ] Create one PR against current GitHub `main`, including setup, manual verification steps, explicit remaining limitations, and passing test results.
