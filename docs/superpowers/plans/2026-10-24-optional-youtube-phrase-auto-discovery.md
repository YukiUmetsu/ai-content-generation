# Optional YouTube Phrase and Automatic Niche Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let ContentGen monitor a YouTube niche without a manual phrase, generating editable local-model query plans and rotating searches without increasing the existing API budget.

**Architecture:** Persist automatic/manual search mode, a bounded query plan, the next-query cursor, and each run's effective query in an additive SQLite migration. The Rust collector executes exactly one phrase per eligible run; a separate opt-in local-model endpoint proposes queries; the React UI owns creating/editing the plan and presents a transparent no-model fallback.

**Tech Stack:** Rust/Axum/rusqlite, SQLite migrations, React/TypeScript/Vitest, Node/Vite and Node test runner, local OpenAI-compatible model adapter.

**Spec:** `docs/superpowers/specs/2026-10-23-optional-youtube-phrase-auto-discovery-design.md`

## Global Constraints

- Keep existing manual watchlists and observed videos intact; migrate additively from schema v2 to v3.
- One `search.list` call per eligible run; retain 20 calls/rolling 24 hours, 10 enabled watchlists, and daily refresh.
- No cloud inference, hidden YouTube calls, scraping, unsupported performance claims, credential exposure, or live external calls in tests.
- A local model is optional: an automatic watchlist must still save and collect using a clearly labeled niche-name fallback.
- Touch only the YouTube Intelligence feature, its market API, shared database migration registry, model query helper, relevant documentation and tests. Preserve all unrelated local work.
- One coherent PR; no new npm or Rust dependency without a demonstrated need.

## Review Focus

1. A 1–2-character niche name in automatic mode cannot violate the existing SQLite query-length check. Task 1 tests a safe 3+-character compatibility fallback.
2. Switching manual→automatic→manual must not silently resurrect an old phrase or leave the worker running the wrong mode. Tasks 1 and 4 test switches.
3. A failed or interrupted run must not advance a query cursor; a successful run advances exactly once. Task 2 tests all three states.
4. Model output with duplicate, empty, off-limits or oversized queries must not poison persisted plans; auto collection remains available. Task 3 tests rejection and fallback.
5. Concurrent manual/scheduled claims and server restarts must retain the existing quota, lease and retry guarantees; Task 2 runs existing race/limit tests.

---

### Task 1: Backward-compatible search-mode storage and API

**Files:**
- Create: `migrations/0003_youtube_auto_discovery.sql`
- Modify: `crates/server/src/db.rs`
- Modify: `crates/server/src/research/market_store.rs`
- Modify: `crates/server/src/research/market_api.rs`
- Test: `crates/server/tests/market_store.rs`, `crates/server/tests/market_api.rs`, `crates/server/src/db.rs` tests

**Interfaces:**
- Input: existing `MarketWatchlistDraft` with optional `queryMode: "manual" | "auto"` and optional bounded `queryPlan: string[]`. Missing `queryMode` means manual for backward compatibility.
- Output: `MarketWatchlist` carrying `query_mode`, editable `query_plan`, `query_index`, `last_search_query` / `next_search_query` projections. Manual mode accepts a 3–160-character phrase; auto mode accepts an empty manual phrase and stores a 3+-character compatibility fallback independently.
- Storage: additive `market_watchlists` columns for mode, plan JSON and rotation index; `market_runs` effective query column. Existing schema-v2 rows default to manual.

- [ ] **Step 1: Write failing migration/store/API tests.** Cover schema-v2 upgrade preserving rows, empty auto phrase, 1-character niche fallback, invalid plans, manual-required phrase, and mode switching.
- [ ] **Step 2: Run `cargo test -p contentgen-server market_ -- --nocapture` and confirm the new tests fail for missing behavior.**
- [ ] **Step 3: Add migration, migration registry and focused domain/API validation.** Preserve existing APIs for callers that omit optional fields; never rewrite an applied migration.
- [ ] **Step 4: Re-run focused Rust tests; ensure they pass and the schema integrity check succeeds.**
- [ ] **Step 5: Commit only Task 1 files to the isolated branch when permitted.**

### Task 2: Per-run query rotation and provenance

**Files:**
- Modify: `crates/server/src/research/market_store.rs`
- Modify: `crates/server/src/research/market_worker.rs`
- Modify: `crates/server/src/research/market_api.rs`
- Test: `crates/server/tests/market_store.rs`, `crates/server/src/research/market_worker.rs`

**Interfaces:**
- `claim_watchlist` resolves exactly one nonempty effective phrase and persists it in the claimed run.
- `run_claim_with` passes that frozen phrase, never a mutable watchlist query, to `YoutubeClient::collect`.
- `finish_success` advances the plan cursor modulo plan length exactly once; failed/interrupted claims leave it unchanged.

- [ ] **Step 1: Write failing tests for two successful runs rotating phrases, failure/restart retaining the same phrase, and unchanged budget/lease controls.**
- [ ] **Step 2: Run focused Rust tests; verify RED is caused by missing rotation.**
- [ ] **Step 3: Implement atomic query selection, run provenance and successful-only cursor advancement.** Keep manual mode's exact phrase unchanged.
- [ ] **Step 4: Re-run market store/worker/API tests including the 20/24h cap and 10-enabled-watchlist limit.**
- [ ] **Step 5: Commit only Task 2 files when permitted.**

### Task 3: Bounded local-model search-plan suggestions

**Files:**
- Create: `apps/web/scripts/video-production/market-query-generator.mjs`
- Create: `apps/web/scripts/video-production/market-query-generator.test.mjs`
- Modify: `apps/web/scripts/director-studio-vite.mjs`
- Modify: `apps/web/scripts/video-production/director-studio.test.mjs`

**Interfaces:**
- `generateMarketQueries({name, description?}, {modelSettings, transport?, signal?})` returns 4–8 distinct search phrases, each 3–160 characters, from an installed local Research model.
- `POST /api/contentgen-director/market-queries` requires existing loopback Host/Origin and `X-Contentgen-Director: local-only`; responds `{queries}` or an honest actionable error. It never receives the YouTube key or competitor video records.

- [ ] **Step 1: Write failing tests covering local-only request enforcement, structured JSON parsing, duplicate/oversize/output-shape rejection, and no outbound request when model settings are absent.**
- [ ] **Step 2: Run `node --test apps/web/scripts/video-production/market-query-generator.test.mjs apps/web/scripts/video-production/director-studio.test.mjs`; verify RED.**
- [ ] **Step 3: Build the generator from existing bounded local-model utilities and connect the director route; no cloud or non-loopback endpoint.**
- [ ] **Step 4: Re-run the focused Node tests; confirm all pass.**
- [ ] **Step 5: Commit only Task 3 files when permitted.**

### Task 4: Optional form, transparent plan editor and end-to-end verification

**Files:**
- Modify: `apps/web/src/lib/api/market.ts`
- Modify: `apps/web/src/app/youtube-intelligence-panel.tsx`
- Modify: `apps/web/src/app/youtube-intelligence-panel.test.tsx`
- Modify: `docs/02-runtime.md` and the YouTube Intelligence usage docs
- Test: relevant existing UI/API tests

**Interfaces:**
- `MarketWatchlistDraft` conveys mode and plan with typed runtime validation.
- UI shows optional input, explicit mode, query plan, source, effective last/next search, and "Generate with local AI" / edit controls; exposes niche-name fallback when suggestions are unavailable.

- [ ] **Step 1: Write failing Vitest cases for name-only creation, mode editing, generated plans, unavailable-model fallback, and exact manual phrase; preserve Japanese UI.**
- [ ] **Step 2: Run `pnpm --dir apps/web exec vitest run src/app/youtube-intelligence-panel.test.tsx`; verify RED.**
- [ ] **Step 3: Implement typed API changes and UI, then document how to generate/edit a plan and how the daily rotation works.**
- [ ] **Step 4: Run focused Vitest cases, full `pnpm --dir apps/web test`, typecheck, lint, build, and `cargo test -p contentgen-server`. Report any pre-existing test failures separately.**
- [ ] **Step 5: Verify the precise diff against the approved spec and create ONE GitHub PR against up-to-date `main`, without committing unrelated local changes.**

## Self-review notes

- All acceptance criteria from the spec map to Tasks 1–4.
- Rust query selection and persistent rotation finish before UI relies on them.
- No model is required for basic collecting; generated plans are opt-in and inspectable.
- Full existing suites supplement targeted red-green tests. No live API key is required.
