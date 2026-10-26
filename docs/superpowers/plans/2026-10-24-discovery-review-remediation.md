# Project Discovery Strict-Review Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development. Follow the approved 2026-10-23 project knowledge graph spec and its original implementation plan.

**Goal:** Repair the reviewed discovery feature so the real Projects UI works, the local model remains serialized, the graph and ideas have honest provenance, jobs survive interruption, and recommendations exclude existing content.

**Architecture:** Retain the existing Rust/SQLite ownership, browser catalog and click-only Node worker. Add additive migrations for durable stage artifacts and referential integrity; use bounded local model extraction and verified source states. Google Trends stays an explicitly unavailable optional adapter until official access exists.

**Constraints:** Preserve the dirty user-owned feature worktree and previous migrations, no external or paid calls during tests, no model downloads. Write and run a failing regression test before changing production behavior. Do not merge or publish without explicit approval.

## Task 1: Restore UI integration and current evidence links

**Files:** `apps/web/src/app/shell.test.tsx`, `apps/web/src/app/catalog-workspace.tsx`, `apps/web/src/app/project-discovery-panel.tsx`, `apps/web/src/app/discovery-ideas-panel.tsx`.

1. Add a Shell-to-Projects integration test with a successful sync; verify Discover and manual keyword controls become operable (RED).
2. Forward sync state across CatalogWorkspace and rerun the test (GREEN).
3. Add a panel test proving newly imported source links become clickable when a run completes (RED).
4. Refresh the graph on completion and validate the regression (GREEN).

## Task 2: Keep heavy local inference serialized and retry safely

**Files:** `apps/web/scripts/video-production/local-inference-gate.{mjs,test.mjs}`, `discovery-candidates.{mjs,test.mjs}`, `project-keyword-generator.{mjs,test.mjs}`.

1. Test queued cancellation, active cancellation with uncooperative provider, independent inference jobs (RED).
2. Implement a FIFO serial gate with per-waiter cancellation; verify (GREEN).
3. Test transient HTTP/transport/timeout retry and known fallback settings (RED).
4. Implement bounded backoff and sanitized error states without increasing simultaneous model requests (GREEN).

## Task 3: Establish actual graph provenance and protect project boundaries

**Files:** `graph-extractor.{mjs,test.mjs}`, `discovery-job-queue.{mjs,test.mjs}`, `crates/server/src/research/graph_store.rs`, `crates/server/tests/project_graph.rs`, additive SQL migration.

1. Tests first: extract supported relation from captured quote; reject unquoted causal assertion, wrong node direction, foreign source/project, duplicate extraction (RED).
2. Extract small, bounded graph batches from actual stored captured sources using local AI; treat lead-only sources as hypotheses; import only validated relationships (GREEN).
3. Add graph evidence inspection/correction, alias/search facilities, and project-scoped SQLite constraints with upgrade tests.

## Task 4: Durable runs, immutable inputs, and cancellation

**Files:** `discovery-job-queue.{mjs,test.mjs}`, `crates/server/src/research/discovery_{api,store}.rs`, `crates/server/tests/discovery_ideas.rs`, additive SQL migration.

1. Test resume after source refresh and graph extraction, preserving original input and not re-consuming searches (RED).
2. Persist immutable run inputs and checkpoint artifacts transactionally; execute only missing stages and make finish idempotent (GREEN).
3. Test cancel, concurrent starts, crash recovery and bounded retries (RED/GREEN).

## Task 5: Honest evidence, project relevance, novelty and ranking

**Files:** `crates/server/src/research/discovery_store.rs`, `crates/server/tests/discovery_ideas.rs`, `discovery-candidates.mjs`, discovery panel tests.

1. Test no evidence-backed completion with lead-only sources; never mark old rediscovered news as fresh (RED).
2. Distinguish preliminary leads from factual citations and verify provenance before publishing (GREEN).
3. Add deterministic intent/exclusion filters, topic/premise duplicate signatures and historical content coverage (RED/GREEN).
4. Rank with published age and real comparable momentum only; label missing signals unknown, diversify parents, show confidence as heuristic.

## Task 6: User lifecycle and final integration

**Files:** project catalog/UI + research handoff, server project deletion route, integration tests, documentation.

1. Test idea-to-Research/Create prefill and project-deletion synchronization without silent data loss (RED).
2. Implement handoff, deletion/reconciliation and explicit failure states (GREEN).
3. Run available Node/Vitest/typecheck/lint/build plus Rust fmt/clippy/tests if toolchain available; report any unavailable verification. Test House Math relevance and server-restart fixture. Independently review the diff, and leave merge/push to user approval.

## Progress — 2026-10-24

Implemented with focused passing Node/Vitest tests: active Projects controls, on-completion source refresh, inference gate cancellation, transient provider retries, bounded public capture and quoted graph extraction, persisted passage reuse, a server evidence-quality guard, published-date-based ranking, historical content duplicate checks, short candidate batches using configurable local AI limits, local job cancellation plus superseded-run safety, source-quote display, idea-to-Research prefill, and retryable browser-to-server deletion tombstones.

Completed in the follow-up repair pass:

- Rust migrations 8 and 9 freeze the discovery run's server inputs, add append-only per-stage artifacts, and enforce cross-project graph integrity with triggers. Node resume checkpoints bounded source queries, graph proposals/batches, and four-source candidate batches.
- Creator-facing graph search, reversible aliases, and explicit relationship reject/reopen/approve controls have API, storage, and UI regression tests.
- Historical novelty checks now honor user-curated topic aliases and rank across recognized topic families before filling extra slots from the same family. Measurements remain dated observations, never invented velocity.
- The optional `CONTENTGEN_DISCOVERY_FALLBACK_PROFILE_ID` reuses a selected local Studio profile for invalid/retryable graph/candidate inference. The generation token and timeout settings also apply to discovery research tasks.
- Final verification passed: full Rust workspace, 358 headless Node tests, 376 React tests plus browser proxy smoke tests, web build, warning-free ESLint, strict Clippy, and workspace rustfmt. The temporary Rust test build cache (2.3 GiB) and the separate repository `target/` cache (2.7 GiB) were both safely cleared with `cargo clean` after verification, reclaiming about 5.0 GiB. Rust dev/test profiles now disable incremental compilation and debug symbols; retained toolchain/registry total approximately 820 MiB.

Limits requiring real provider data or outside authorization:

- True comparable video momentum needs two or more observations for the same video at different collection times, and news publish dates must be independently verified. Ranking deliberately does not claim either from a single search result.
- Official Google Trends access is restricted. The adapter remains marked unavailable; no scraping or fabricated trend scores were added.

Merge or release must remain an explicit user choice. Local verification does not imply GitHub Actions ran; hosted CI is intentionally not required while Actions credits are exhausted.

## Continued verification and reliability work

### Task 7: Headless regressions and bounded build cache

- [x] Reproduce all nine video headless failures with localhost access; distinguish obsolete fixtures/defaults from behavior defects.
- [x] Correct payoff frame off-by-one and keep the new 30%-delay regression; update fixtures for explicit visual states/mechanic and configured model limits.
- [x] Rerun the full headless suite (350/350).
- [x] Pruned temporary Cargo artifacts and the repository's own rebuildable Cargo `target/` cache after final Rust verification (about 5.0 GiB); preserved pinned dependencies/toolchain and all source/project data.

### Task 8: Frozen discovery inputs and restartable stage artifacts

**Files:** `migrations/0008_discovery_run_artifacts.sql`, `crates/server/src/db.rs`, `crates/server/src/research/{discovery_store,discovery_api}.rs`, `crates/server/tests/discovery_ideas.rs`, `apps/web/scripts/video-production/{discovery-job-queue.mjs,discovery-job-queue.test.mjs}`, TypeScript discovery API.

- [x] RED: Rust test proves a run captures the server's project metadata, active keywords, content, graph revision and excludes later edits; artifacts are scoped, idempotent, persist across pause/resume, and are immutable after completion.
- [x] GREEN: Migration plus transactional frozen run input and JSON stage-artifact API.
- [x] RED: Node job test proves Resume ignores changed browser inputs, skips completed search and model stages, reuses frozen candidate drafts to finish.
- [x] GREEN: Consume server run snapshot; checkpoint completed bounded source-query and graph-extraction units; cache candidate inputs, batches and pool before final commit.
- [x] Verify Rust integration, Node targeted and broad suites; perform final pass after latest edits.

### Task 9: Strict independent review and compatibility with concurrent main work

- [x] Reject forged browser Host/Origin headers on every discovery route, including read endpoints; exercise an actual API request and verify denials.
- [x] Preserve manually approved/rejected graph evidence when captured sources are imported again; reject invalid relation types/directions and cross-project references.
- [x] Keep the shared local-inference gate acquired until the complete HTTP response body has been consumed. Add a delayed-body regression, cancel/queue isolation, and preserve per-test injected gates.
- [x] Reuse project-owned captured source metadata that may be missing from a bounded overview response; test extraction eligibility.
- [x] Integrate upstream scene microjobs and subsequent opt-in debugging/state-repair improvements without losing their new tests. Preserve the local-AI serialization boundary around debug-scoped inference.
- [x] Verify against the integrated code: Rust workspace tests; 425 headless video tests; 376 Vitest cases; new queue/planner/debug/probe tests; web lint/build; strict Clippy; rustfmt; `git diff --check`.

PR remains unmerged for review. Real end-to-end inference with the user's Magnitude model, real YouTube data, and hosted Actions are not represented as tested.
