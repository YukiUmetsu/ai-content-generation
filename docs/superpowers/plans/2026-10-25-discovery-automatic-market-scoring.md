# Automatic Discovery Market Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discovery automatically attempts source-backed YouTube and Google Trends measurements before presenting ready ideas, with no initial per-idea measurement clicks.

**Architecture:** Rust persists a nonterminal `measure_market` Discovery stage after candidate generation and owns a restart-safe, bounded enrichment coordinator. Existing YouTube collection and a new guarded Google Trends provider feed versioned observation rows. Studio reads progress and saved results; provider failures finish as partial instead of blocking.

**Tech Stack:** Rust/Axum/SQLite, YouTube Data API, `gtrend-rs`, Node discovery worker, React/TypeScript/Vitest.

**Spec:** `docs/superpowers/specs/2026-10-25-discovery-automatic-market-scoring-design.md`

## Global Constraints

- Use the existing 20-search rolling daily YouTube budget, and never query a provider from Select Idea render.
- Missing/blocked providers produce explicit unknown or partial values; never invent search volume or market scores.
- Persist attempts and checkpoints so restarting cannot re-spend provider quota indiscriminately.
- Keep API keys server-side; never log provider bodies or sensitive input.
- No GitHub Actions for verification; run local Rust and web checks.

## Review Focus

- An existing duplicate candidate is skipped: no wasted provider calls for nonexistent ideas.
- A provider error or missing YouTube key advances Discovery to a terminal partial result.
- Restart during measurement does not replay a reserved YouTube search.
- Legacy discovery runs remain compatible with their prior completion semantics.
- A reopened Select Idea screen renders snapshots without sending new provider requests.

---

### Task 1: Durable Discovery enrichment phase

**Files:** `crates/server/src/research/discovery_store.rs`, `crates/server/src/research/discovery_api.rs`, `crates/server/src/research/market_worker.rs`, `crates/server/tests/discovery_sessions_api.rs`, `crates/server/tests/discovery_ideas.rs`.

**Interfaces:** candidate persistence enters `stage='measure_market', status='running'` for named sessions; `finish_market_stage(db,run_id,now)` ends the phase idempotently; legacy and insufficient-evidence runs remain unchanged.

- [ ] Write API/store tests for nonterminal measurement stage, idempotent finalization, legacy compatibility, and interruption/resumption.
- [ ] Run targeted Rust tests; confirm the expected stage assertion fails.
- [ ] Implement the guarded stage transition/finalization and periodic restart pickup.
- [ ] Re-run targeted Rust tests to green.

### Task 2: Automatic source adapters, persistence and scoring

**Files:** `migrations/0012_discovery_google_trends.sql`, `crates/server/src/db.rs`, `crates/server/src/research/idea_market.rs`, new `crates/server/src/research/idea_trends.rs`, new `crates/server/src/research/discovery_market_worker.rs`, `crates/server/src/research/sessions_store.rs`, tests.

**Interfaces:** `enrich_discovery_run(state,run_id)` selects only persisted ideas, attempts at most one eligible automatic YouTube reservation each, saves bounded Google Trends observations, and finalizes the Discovery stage. It treats unavailable providers as partial without lying about search volumes.

- [ ] Write failing SQLite/worker tests: saved idea picks, no duplicate reservations, partial/unavailable provider, momentum calculation from fixtures, and idempotent resume.
- [ ] Run targeted tests to confirm RED.
- [ ] Add migration and versioned Trends observations; implement bounded Rust adapter, orchestration, and score provenance.
- [ ] Run tests to GREEN; run Clippy with denied warnings.

### Task 3: UI automatically displays results and follows job lifecycle

**Files:** `apps/web/src/app/discovery-idea-selection.tsx`, `apps/web/src/app/idea-market-evidence.tsx`, `apps/web/src/app/discovery-session-workspace.tsx`, corresponding tests and API models.

**Interfaces:** no required Measure button on new ideas; Discovery remains active through `measure_market` and Select Idea auto-opens only after finalization. Read-only compact source-specific metrics surface partial/unavailable states with hover/focus provenance; explicit recheck is optional.

- [ ] Write failing tests: no initial click, persisted automatic market data, no mount-triggered requests, partial provider status, transition only after scoring.
- [ ] Run focused tests to RED.
- [ ] Implement UI/API parsing and progress copy without restoring removed headers.
- [ ] Run focused frontend tests to GREEN.

### Task 4: Integration, adversarial review, and PR

**Files:** specs and docs affected by finalized contracts, Rust/TS integration tests.

- [ ] Run full `cargo test --workspace --offline`, `cargo clippy -p contentgen-server --all-targets --offline -- -D warnings`, `pnpm --dir apps/web run typecheck`, `lint`, `test`, and `build`.
- [ ] Review recent upstream changes; inspect the diff for quota, interrupted runs, misleading scores, stale UI and provider failure modes.
- [ ] Commit and publish one PR; report only checks actually run and any blocked live-provider/visual tests.
