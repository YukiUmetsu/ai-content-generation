# Idea Market Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace indistinguishable editorial-readiness-only picks with optional source-linked numerical comparisons from public YouTube data.

**Architecture:** Rust persists an opt-in per-idea collection and bounded observation snapshots. The existing YouTube API client and quota semaphore remain the sole network path. React displays measured statistics and only ranks comparable adequately sampled ideas.

**Tech Stack:** Rust/Axum/rusqlite, existing YouTube Data API client, React/TypeScript/Vitest.

**Spec:** `docs/superpowers/specs/2026-10-25-idea-market-evidence-design.md`

## Global Constraints

- Preserve `evidence-readiness-v1` and immutable historical runs.
- No network calls without a UI action, no provider key in client JSON, no headless YouTube scraping.
- 20 searches/rolling 24h shared with watchlists; 30-day observation TTL.
- Unknown is distinct from zero and no public-views metric is called CTR, growth velocity, RPM, or a forecast.

## Review Focus

- Wrong project/session/idea combination → 404 and zero search reservations.
- Parallel quota reservations → no overspend or duplicate active idea runs.
- A single prolific channel → no spurious high-confidence ranking.
- Missing dates/views and format mismatch → excluded with coverage shown.
- Expired, interrupted, or failed collection → honest stale/error UI and safe retry.

### Task 1: Durable bounded per-idea collector

**Files:** `migrations/0011_idea_market_assessments.sql`, `crates/server/src/db.rs`, `crates/server/src/research/idea_market.rs`, `crates/server/src/research/sessions_api.rs`.

**Interfaces:** `claim_assessment(db,idea,session,query,format,now)`, `complete_assessment(db,run,videos,now)`, `latest_assessment(db,idea,now)`, POST `ideas/{idea_id}/market`.

- [ ] Add failing Rust tests for ownership, shared quota, retries and evidence filters; run `cargo test -p contentgen-server idea_market` and confirm failures.
- [ ] Add schema, validated claim/complete/fail/recover and a worker reusing `YoutubeClient::collect` and the existing collection semaphore.
- [ ] Run the targeted Rust tests and migration fixtures until green.

### Task 2: Measured comparisons alongside legacy readiness

**Files:** `crates/server/src/research/sessions_store.rs`, `crates/server/src/research/idea_market.rs`, Rust session tests.

**Interfaces:** `SessionIdea.market_assessment` containing dated metrics, sample details and optional session-relative comparison score.

- [ ] Test <8 samples, fewer than three channels/ideas, ties, mixed formats and expiry as unknown.
- [ ] Compute median/P75 public views, observed videos, channels, lifetime views/day; enrich idea responses without touching v1 fields.
- [ ] Rerun targeted Rust tests.

### Task 3: Accessible Select Idea integration

**Files:** `apps/web/src/lib/api/discovery-sessions.ts`, `apps/web/src/app/discovery-idea-selection.tsx`, React tests.

**Interfaces:** opt-in market collect request, response parser, polling, format-aware measured details, comparative sort/recommendations.

- [ ] Add UI tests for missing key, progress, failed collection, numerical display and source links; confirm initial failures.
- [ ] Implement UI/typed client with preserved per-session state and no automatic provider calls.
- [ ] Run frontend typecheck, lint, Vitest, Rust fmt/clippy/tests; report outstanding browser-only QA.
