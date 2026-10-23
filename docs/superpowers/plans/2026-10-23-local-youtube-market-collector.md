# Local YouTube Niche Intelligence Collector — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one working, opt-in YouTube market-data collector inside the existing local ContentGen server; show verified observations in Research and save an original video idea to the Studio catalog.

**Architecture:** Extend ContentGen's existing Rust/Axum/SQLite server and React Studio. A bounded Tokio worker checks persisted due watchlists while the server is alive. YouTube Data API calls are never issued until the user has enabled a watchlist and configured a key. An additive SQLite migration stores watchlists, observations, runs and API call budget; a new Research tab displays them with provenance and a genuine Content-catalog handoff.

**Tech Stack:** Rust edition 2024, Axum 0.8, Tokio, rusqlite, serde, reqwest (minimal async JSON + rustls features), React 19, TypeScript, Vitest.

**Spec:** [Local YouTube Market Collector Design](../specs/2026-10-23-local-youtube-market-collector-design.md)

## Global constraints

- Repository: `YukiUmetsu/ai-content-generation`, branch `feat/local-youtube-market-collector`. Keep one PR and one genuine vertical slice; do not introduce a second daemon/cloud job, paid service, live fixture network call or background auto-publication.
- Before coding read `AGENTS.md`, `docs/INDEX.md`, `docs/10-build-plan.md`, `docs/01-system.md`, `docs/02-runtime.md`, `docs/03-data.md`, `docs/04-research-seo.md`, `docs/15-video-performance-system.md`. Preserve existing public endpoint contracts and style.
- All public competitor metrics are **provider observations at a dated time**, not inferences. Omitted counter ≠ 0; no internally computed viral/outlier score, CTR, retention, RPM, search-volume estimate or view-growth forecast.
- Treat opt-in, policy/compliance TTL, quota reservations, source provenance and authenticated-secret hygiene as executable test contracts. Use `CONTENTGEN_YOUTUBE_API_KEY` exclusively server-side; never echo its value. Do not store raw API JSON indefinitely.
- Capture a failing test before implementing each user-facing behavior. Prefer deterministic fake HTTP endpoints and clock control over live API requests. Avoid dependencies above the repository's approval threshold.
- The existing `jobs/scheduler.rs` persists a DAG but does not execute nodes. Do not claim it is a running executor; wire this scoped worker to server lifetime directly.

## Review focus

1. **No accidental network:** with no key, no enabled watchlists, or server shut down, prove zero YouTube requests; disabling a watchlist immediately prevents new runs.
2. **Bounded quota/retries:** two concurrent requests cannot double-book a watchlist; daily quota is persisted across restarts; 403/429 trigger backoff; never spin.
3. **Truthful data:** public counters may be absent; labels include observed timestamp/source; no "probability of going viral"; do not present public views as audience retention.
4. **TTL:** >30-day YouTube observations are unavailable even when the app was offline throughout the retention period; prune on startup and before query.
5. **Genuine handoff:** save-idea produces a validated local `LocalContent` with stage `idea` and source link, not a fake completed research dossier/video.

---

### Task 1 — Add a robust SQLite market store

**Files**
- Create `migrations/0002_youtube_market_watchlists.sql`.
- Modify `crates/server/src/db.rs` to append migration v2.
- Create `crates/server/src/research/market_store.rs` and `market_types.rs`.
- Create `crates/server/tests/market_store.rs`.

**Behavior**
- `market_watchlists`: `id`, user label, query, region/language, enabled boolean, created/updated timestamps, next_due, last_finished, failure/backoff tracking; max 10 enabled; daily cadence (minimum 24h).
- `market_runs`: unique run ID, watchlist FK, queued/running/succeeded/failed/skipped, observed start/end, provider request count, safe failure code/message; reconcile abandoned states.
- `market_video_observations`: provider/video ID/watchlist FK, source URL, title, channel ID/name, published date, optional views/likes/comments/duration/subs, observed_at, expires_at, result position; uniqueness is enforced at the run or collection granularity; deleted watchlists cascade their cached observations.
- `market_api_budget`: daily or rolling-window `search.list` reservations; durable across process restarts. Use transactional lease/claim semantics.
- Expose store methods `create_watchlist`, `update_watchlist`, `delete_watchlist`, `list_watchlists`, `claim_due`, `claim_manual`, `commit_observations`, `fail_run`, `list_fresh_observations`, `prune_expired` and `reconcile_orphaned_runs`. They return typed domain values; never return raw SQLite rows to Axum.

**TDD and commands**
- [ ] Write and run failing tests for v1→v2 migration, fresh DB, restart idempotency and FK cleanup: `cargo test -p contentgen-server --test market_store migration`.
- [ ] Write failing tests for create/update/disable/delete validation, duplicate-lease rejection, persisted quota after re-open, and TTL filter after clock advance.
- [ ] Implement schema + store, with a clock parameter for deterministic boundary tests and transactionally claimed work.
- [ ] Run `cargo test -p contentgen-server --test market_store`, `cargo fmt --all -- --check`, and ensure pre-existing migration tests remain green.
- [ ] Self-review: SQLite CHECK/STRICT clauses, indices, no destructive alteration of migration v1, no metrics copied permanently to saved ideas.

### Task 2 — Implement bounded YouTube API adapter

**Files**
- Modify root `Cargo.toml` and `crates/server/Cargo.toml` for minimal HTTP client dependency (if not already present).
- Create `crates/server/src/research/youtube_api.rs` and `crates/server/tests/youtube_api.rs` (or unit tests local to adapter).

**Behavior**
- Define `YoutubeClient` with injectable base URL and reqwest client for tests, while production forces `https://www.googleapis.com/youtube/v3` and never accepts user-provided arbitrary URLs.
- Request `search.list` once per due query with encoded language/region/maxResults 25, filter to `video`; batch `videos.list` for content details. Optional `channels.list` batch for publicly available subscriber counts. Validate video IDs; skip malformed/removed results.
- Produce `MarketObservation` with `provider = youtube-data-api`, original video URL, observed_at, search phrase, and truly nullable public counters.
- Use timeouts, controlled response-size limits and sanitized error classes: auth_missing, permission, quota_exceeded, rate_limited, provider_unavailable, payload_invalid.
- API key comes from environment only and is excluded from debug formatting, exception strings and persisted errors.

**TDD and commands**
- [ ] Add tests with a local ephemeral Axum HTTP fixture server for valid 2-video discovery, missing counts, deleted video, empty search, malformed JSON, 403/429 and timeout. Assert the API key is never present in returned/logged errors.
- [ ] Run the failing targeted test, implement parsing/request batching, re-run `cargo test -p contentgen-server --test youtube_api`.
- [ ] Confirm test suite never touches live YouTube and no production hostname is configurable from a public REST input.
- [ ] Self-review provider fields, missing-value semantics, URL encoding, no key in errors.

### Task 3 — Wire actual local collection worker and Research HTTP API

**Files**
- Modify `crates/server/src/research/mod.rs`, `crates/server/src/main.rs`, and `crates/server/src/state.rs` as needed; preserve `GET /api/research/evidence` behavior.
- Create `crates/server/src/research/market_api.rs` and `market_worker.rs`.
- Create `crates/server/tests/market_api.rs` and `market_worker.rs`.

**Behavior**
- Add `GET /api/research/market/status`, CRUD `/watchlists`, `POST /watchlists/{id}/collect`, `GET /watchlists/{id}/videos`, all validating bounds and returning standard error envelope. Mutating endpoints must be loopback-only and guard against cross-site browser POST misuse with the repository's existing local mutation patterns.
- Main creates one worker task only after database migration. It wakes periodically while server is running, prunes stale observations, claims due work, and calls adapter with a bounded concurrency of 1. On startup it recovers stale run leases and due work; on shutdown it stops promptly. Manual collect enters same queue/lease mechanism.
- Budget: no more than 20 `search.list` reservations per rolling 24h across all watchlists, including manual clicks; no more than 10 enabled watchlists, only one active request per watchlist, no flood after downtime.
- Status distinctly reports disabled, api_key_missing, idle, collecting, backoff, quota_exhausted and last failure without leaking env values.

**TDD and commands**
- [ ] Write failing HTTP integration tests for CRUD validation, missing key, status, manual run, and observed-results schema.
- [ ] Write worker tests with a fake provider and controllable time proving: no opt-in→zero calls; restart→one due run; double click→one lease; quota persists; 429/403 backoff; TTL prune; disabled→no further calls; graceful shutdown.
- [ ] Implement endpoints, task and startup/shutdown ownership. Run `cargo test -p contentgen-server --test market_api` and `cargo test -p contentgen-server --test market_worker`.
- [ ] Run full `cargo test -p contentgen-server`; review cancellation, locking duration, queue limits and API budget accounting.

### Task 4 — Ship an actual Research tab and save-to-content action

**Files**
- Modify `apps/web/src/app/research-workspace.tsx` and `apps/web/src/app/shell.tsx`.
- Create `apps/web/src/app/youtube-intelligence-panel.tsx`.
- Modify `apps/web/src/lib/api/{client,types}.ts` with runtime validators.
- Create `apps/web/src/app/youtube-intelligence-panel.test.tsx`; update `shell.test.tsx` and relevant `client` tests.

**Behavior**
- New **YouTube Intelligence** Research tab: easy explanation, API key configured/missing banner with setup instructions, empty-state watchlist form, enabled toggle, query and market, latest/next run, last failure, last 24h quota, **Collect now**, basic filters, measured candidate cards linking to YouTube with observed_at and null metric placeholders.
- The list presents video title/channel/public views/duration/published date/source with no unpermitted derived score, no fabricated search-volume bar. Do not copy thumbnails or full video text.
- **Use for video** opens an editable working-title form that defaults to an original topic framing (not direct competitor title duplication). A confirmed action calls a `Shell` callback to save a `LocalContent` entry (`kind: video`, `stage: idea`, associated active project, source URL in notes) through existing `saveCatalog`; on success navigate to **Content**, on failure show the existing catalog-storage error. Do not claim a script/video was generated.
- Use the project's compact design system: coherent spacing, narrow sidebar, no redundant breadcrumbs/header, readable text; English/Japanese strings for new UI or clear fallback pattern. The UI must say when data is stale or absent and how to enable collection.

**TDD and commands**
- [ ] Write failing component tests for missing key, empty list, async loading and error, manual run feedback, disable, null counter rendering, stale data and true saved-content handoff.
- [ ] Write failing API client validation tests rejecting malformed observations and missing provenance, then implement typed functions and UI.
- [ ] Run `pnpm --dir apps/web test`, `pnpm --dir apps/web typecheck`, `pnpm --dir apps/web build`.
- [ ] Visually inspect the Research tab with fixture data and on a narrow viewport. Confirm "Use for video" really adds a Content entry.

### Task 5 — End-to-end acceptance and one PR

**Files**
- Modify `docs/04-research-seo.md`, `docs/02-runtime.md` and/or `docs/INDEX.md` only where required to document actual behavior.
- Add focused setup guidance to `README.md`: Google Cloud API key, local env example, start server, create/enable watchlist, how to stop (stop process), policy limitations and 30-day data expiry. Do not include a real key.
- Add/update deterministic fixture test documentation or CI checks only if needed by the slice.

**Acceptance and commands**
- [ ] Simulate clean DB → start server with fixture provider → enable House Math query → collect one batch → browse exact source-linked records → save original idea → view Content entry → restart → no duplicate automatic run before due.
- [ ] Confirm no key/no opt-in means zero network calls; manual collection respects quota; expired records hidden; errors visible.
- [ ] Run `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`.
- [ ] Run `pnpm --dir apps/web test`, `pnpm --dir apps/web typecheck`, `pnpm --dir apps/web build`.
- [ ] Check `git diff --check`; self-review against five Review Focus items; seek code review using `superpowers:requesting-code-review`, then re-run affected tests.
- [ ] Create **one** PR on the feature branch summarizing functionality, configuration, measured test results, limitations, and any unrun real-API smoke test. Never claim collection is live without credentials and opt-in.

## Execution and handoff

After human review of this plan, implement it task by task with `superpowers:executing-plans` and `superpowers:test-driven-development`; verify with `superpowers:verification-before-completion`. Do not spawn other agents unless explicitly requested. If GitHub access succeeds but local checkout, dependency retrieval, or CI verification is blocked, stop at that boundary and report the unverified state rather than marking the slice complete.
