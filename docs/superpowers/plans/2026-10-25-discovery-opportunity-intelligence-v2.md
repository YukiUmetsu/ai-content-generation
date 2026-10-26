# Discovery Opportunity Intelligence v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development. Apply TDD to each code task; no provider is called live during tests.

**Goal:** Make ContentGen's market scoring useful for narrow video ideas through intent-based official YouTube research, time-series/channel comparisons, optional Google Ads keyword intelligence and confidence-labeled v2 scoring.

**Architecture:** Extend existing Rust research adapters, Discovery's persistent market worker/lease and SQLite observations, not a second browser collector or task runner. First-class generic Jobs nodes will be addressed by the separate unified-Jobs migration.

**Tech Stack:** Rust/Axum/SQLite/reqwest, YouTube Data API, Google Ads REST/OAuth, React/TypeScript/Vitest.

**Spec:** `docs/superpowers/specs/2026-10-25-discovery-opportunity-intelligence-v2-design.md`

## Global constraints

- Preserve old assessments, read-only UI fetches and 20-per-day shared YouTube search budget; never invent API results or market volume.
- Google Ads authorization is optional, secret-backed and off by default until configured; no browser scraping, no external calls in tests.
- Reuse the current Discovery market worker, existing watchlists, source-validation patterns and versioned migrations; do not add an ad hoc market runner.
- Keep score and confidence independent; numeric provisional scores require observed evidence and a meaningful comparison baseline.
- Run all tests locally; GitHub Actions are not a verification source. Target one PR with independently tested commits.

## Review focus

1. Search query broadening must not spend an uncontrolled number of quota reservations or collapse into general house/math or bookkeeping videos.
2. Ads denied/missing credentials, rate-limit and malformed metrics must retain YouTube results and no synthetic zeroes.
3. One-channel or one-idea data cannot become a confident score; duplicate videos cannot inflate the sample.
4. Snapshot growth uses actual observation intervals and excludes earlier/later invalid counters; channel baseline excludes the source video.
5. Cancellation/restart cannot leave a stuck active run or repeat paid/limited provider requests after reservation.

---

### Task 1: Query planning and multi-query official YouTube collection

**Files:** `crates/server/src/research/discovery_market_worker.rs`, `youtube_api.rs`, `idea_market.rs`, relevant unit/integration tests and additive migration.

**Interfaces:** versioned `IdeaSearchPlan { queries, language, region, format }`; official collector accepts a bounded query plan, returns unique `VideoObservation`s with per-query provenance and relevance/exclusion information.

- [x] Test editorial-title expansion, dedup, channel/format checks and exhausted budget.
- [x] Implement deterministic planner, stored query provenance and existing-measurement reuse (not a cross-session query cache).
- [x] Extend official YouTube collector for bounded two-query searches and stop conditions.
- [ ] Commit as part of the final one-PR change.

### Task 2: Channel benchmarks and dated video growth

**Files:** `youtube_api.rs`, `idea_market.rs`, `market_store.rs`, new additive migration, relevant tests.

**Interfaces:** bounded channel-upload observation; immutable `VideoViewSnapshot` keyed by video/observation; `growth_between_snapshots` returns optional measured deltas and exact intervals.

- [x] Test unknown growth before second observation, real dated deltas and channel self-exclusion.
- [x] Implement immutable snapshots, refresh reservations and official low-quota channel uploads.
- [x] Expose benchmark sample size and comparison scope; source video provenance remains in saved observation identifiers.
- [ ] Commit as part of the final one-PR change.

### Task 3: Optional Google Ads Keyword Planner

**Files:** new `crates/server/src/research/google_ads.rs`, credential/settings adapter, additive migration and provider fixture tests.

**Interfaces:** `KeywordResearchProvider` returns `KeywordIdeaObservation` (canonical term, close variants, locale, monthly Google Search estimates, advertiser competition, observed time); HTTP client uses OAuth/approved Cloud project and sanitized errors.

- [x] Test valid metrics, missing auth, access denial, malformed responses, dedup and no secret leakage, with local REST fixtures.
- [x] Implement off-by-default OAuth refresh and bounded official Keyword Planner calls.
- [x] Persist versioned observations, cooldown and separate Google Search status.
- [ ] Commit as part of the final one-PR change.

### Task 4: Audience questions, opportunity scoring and Jobs orchestration

**Files:** `youtube_api.rs`, new audience-question module, `viral_potential.rs`, `discovery_market_worker.rs`, `jobs/*`, `sessions_store.rs`, tests.

**Interfaces:** bounded comment-question evidence; `OpportunityV2 { score, confidence, state, breakdown, coverage, sources }`; schedule/attempt/cancel via existing generic Jobs only.

- [x] Test unknown/provisional/measured states, same-format baseline, missing Trends, attribution and sanitized questions.
- [x] Implement conservative v2 scoring and optional official public-comment adapter.
- [ ] Defer provider-level generic Jobs DAG nodes to the unified-Jobs implementation. The existing persistent Discovery market lease handles this release.
- [ ] Commit as part of the final one-PR change.

### Task 5: Minimal UI, compatibility and verification

**Files:** `apps/web/src/lib/api/*`, `apps/web/src/app/{viral-score,idea-market-evidence,discovery-idea-selection}.tsx`, tests and docs.

**Interfaces:** single compact Opportunity score, confidence and evidence disclosure, with independent Google Search/YouTube status and automatic Job progress.

- [x] Test legacy API compatibility, provisional badge, provider separation and evidence labels.
- [x] Implement compact evidence UI using the existing design components/tokens.
- [x] Full Rust workspace tests and Clippy, frontend typecheck, ESLint, complete Vitest suite and production build pass locally. Browser-based manual visual inspection has not been performed.
- [x] Skeptical review fixed premature search-stop decisions, excessive Ads requeue, weak source provenance and legacy UI fallback behavior.
- [ ] Publish one PR after the final local diff check.

