# ContentGen Project Knowledge Graph & Discover 5 Ideas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Maintain a project-scoped, evidence-backed SQLite topic graph and return up to five fresh, nonduplicative, explainable content ideas only when the user clicks “Discover 5 Ideas.”

**Architecture:** Rust/Axum owns the canonical graph, project discovery mirror, market observations, and recommendation history in additive SQLite tables. The React catalog remains the user's existing local project editor and synchronizes a bounded project/content index into Rust; the Node/Vite local-AI bridge reuses the configured research model and existing safe, resumable job patterns for graph enrichment and click-triggered discovery. Source ingestion can run while local servers run; only an explicit click starts the five-idea job.

**Tech Stack:** Rust 2024, Axum 0.8, rusqlite 0.37, SQLite FTS5, Node >=22.12, Vite 8, React 19, TypeScript 5.9, Vitest and `node:test`, local OpenAI-compatible model, existing SearXNG + YouTube integrations.

**Spec:** `docs/superpowers/specs/2026-10-23-contentgen-project-knowledge-graph-design.md` (approved; currently available as a separate design artifact).

**Repository inspected:** `YukiUmetsu/ai-content-generation`, initial `main` tree SHA `f5701ab1f2aa5af5b904499fbc63dc3b8bc8b50f`. Work proceeds in an isolated local source snapshot and must be compared against current GitHub main before preparing the pull request. The approved spec is committed alongside this plan.

## Global Constraints

- Keep browser catalog `contentgen:studio-catalog:v1` intact; do not silently migrate/delete users' project data. Browser project `notes` is the current description field.
- Preserve SQLite migration checksum compatibility: current latest is v4; add v5/v6/v7, never rewrite prior migration SQL.
- Existing YouTube watchlists are global and unbound to projects; add an explicit mapping, never silently relabel them. Retain the collector's 20-call rolling-24h cap, 10 enabled watchlists and one-search-per-run behavior.
- `apps/web/scripts/video-production/studio-search.mjs` saves **SearXNG leads**, not verified claim citations. News/web leads are not source-grounded facts until passages are captured and validated.
- Existing Rust `jobs` store is a DAG state API, not a general local-AI worker. Existing Node `research-job-queue.mjs` owns actual local inference for story jobs. Reuse compatible patterns and introduce a shared heavy-inference gate; do not pretend that submitting to the Rust DAG executes local inference.
- One heavy local model request at a time on a 24 GB workstation. No model download or paid/cloud inference, hidden API use, automatic publishing, or automatic five-idea generation.
- Source facts, causal edges and numerical trends need provenance. Missing metric or source is unknown, never zero or a guessed “viral” value. Google Trends API stays optional until alpha access is configured.
- The server listens on loopback; mutations require existing same-origin/non-simple-header guards. Untrusted source text remains data, not instructions. Logs carry error categories and identifiers, never raw source text or secrets.
- Preserve Japanese/English UI, keyboard access and reduced motion. No new dependencies without a demonstrated need. Prefer one coherent PR after all slices are verified.

## Review Focus

1. **Browser/server divergence:** Catalog saves while Rust is stopped must remain local and sync later; an old server response cannot overwrite a newer local edit. Task 2 tests offline/recovery and revision ordering.
2. **False relationships:** An AI statement about insurance rates without a cited captured passage must remain hypothesized, never enter the supported causal graph. Tasks 3–4 test source/edge linkage and rejection.
3. **Double discovery/worker restart:** Fast double-click returns the same active run; a new click after completion starts a new run; restart pauses/resumes without repeating expensive provider calls. Task 5 tests all three.
4. **Semantic duplicates:** Different titles for essentially the same existing storyboard/published video must be excluded; dismissed ideas must not immediately recur. Task 5 tests project content and dismissal matching.
5. **Incomplete providers:** No Google Trends access, low-view new YouTube videos, stale news/search leads or model JSON failure must yield explicit evidence gaps or fewer ideas—not fabricated growth. Tasks 4–6 test these cases.

---

## File map

| Unit | Responsibility |
| --- | --- |
| `migrations/0005_project_discovery.sql` | Shadow project registry, content index, editable keywords, project↔watchlist binding |
| `crates/server/src/research/discovery_projects.rs` | Project/keyword storage, snapshot sync, catalog-index ownership |
| `crates/server/src/research/discovery_api.rs` | Strict loopback HTTP contract for project, keyword, graph and run operations |
| `migrations/0006_project_graph.sql` | Nodes, aliases, typed edges, edge evidence, temporal metrics, searchable projection |
| `crates/server/src/research/graph_store.rs` | Idempotent deterministic ingestion, provenance and graph read/traversal |
| `apps/web/scripts/video-production/project-keyword-generator.mjs` | Small bounded AI suggestion + strict output validation |
| `apps/web/scripts/video-production/graph-extractor.mjs` | Small captured-passage batches and validated supported vs hypothesized relationships |
| `apps/web/scripts/video-production/discovery-job-queue.mjs` | Durable, click-only, single-heavy-model discovery worker and stage checkpoints |
| `migrations/0007_discovery_ideas.sql` and `crates/server/src/research/discovery_store.rs` | Runs, candidate evidence, decisions, novelty and deterministic ranking |
| `apps/web/src/lib/api/discovery.ts` | Typed/validated API client and payload adapters |
| `apps/web/src/app/project-discovery-panel.tsx` | Keyword review and inspectable graph |
| `apps/web/src/app/discovery-ideas-panel.tsx` | Five ideas, evidence, progress, decisions and research handoff |

## Task 1: Add durable project mirror and keyword storage

**Files:**
- Create: `migrations/0005_project_discovery.sql`, `crates/server/src/research/discovery_projects.rs`, `crates/server/src/research/discovery_api.rs`, `crates/server/tests/discovery_projects.rs`
- Modify: `crates/server/src/db.rs`, `crates/server/src/research/mod.rs`

**Interfaces:**
- `ProjectSnapshot { id, name, notes, updated_at, content: Vec<ProjectContentSnapshot> }` uses existing browser IDs unchanged; content items include `id`, `kind`, `stage`, `name`, `notes` and `created_at`.
- `discovery_projects::sync_project(db: &mut Connection, snapshot: &ProjectSnapshot, now: i64) -> Result<ProjectSummary, DiscoveryError>` upserts only the specified project and replaces the *current* content index transactionally; missing content is marked inactive, not rewritten as never created.
- `discovery_projects::set_keywords(db: &mut Connection, project_id: &str, changes: KeywordPatch, now: i64) -> Result<Vec<ProjectKeyword>, DiscoveryError>` enforces normalized uniqueness and manual locks; `KeywordKind = topic | query | exclusion`, `KeywordOrigin = manual | model`.
- `POST /api/research/discovery/projects/{id}/sync`, `GET/PATCH /projects/{id}/keywords`, `PUT/GET /projects/{id}/watchlists` under `discovery_api::router()`; strict JSON limits and `X-Contentgen-Discovery: local-only` on mutations.

- [ ] **Step 1: Write failing migration/store tests.** Assert v4→v5 retains watchlists/observations, rejects wrong-project IDs, manual keyword survives model refresh, content sync does not destroy history, watchlist binding is explicit, and FKs are valid.
- [ ] **Step 2: Run `cargo test -p contentgen-server discovery_projects -- --nocapture`.** Confirm new cases fail from absent API/types.
- [ ] **Step 3: Implement migration, DB registry, store and HTTP routes.** Keep existing project catalog in the browser as the editing source of truth; server is a searchable shadow, not a competing catalog editor.
- [ ] **Step 4: Run the focused Rust tests plus `cargo test -p contentgen-server market_`.** Both must pass.
- [ ] **Step 5: Commit Task 1 files in an isolated branch.** No changes to existing migrations.

## Task 2: Sync existing browser catalog without data loss; show manual keywords

**Files:**
- Create: `apps/web/src/lib/api/discovery.ts`, `apps/web/src/lib/api/discovery.test.ts`, `apps/web/src/app/project-discovery-panel.tsx`, `apps/web/src/app/project-discovery-panel.test.tsx`
- Modify: `apps/web/src/app/shell.tsx`, `apps/web/src/app/catalog-workspace.tsx`, `apps/web/src/app/catalog-workspace.test.tsx` (if present), `apps/web/src/app/shell.test.tsx`

**Interfaces:**
- `syncDiscoveryProject(project: LocalProject, content: LocalContent[], signal?: AbortSignal): Promise<ProjectSummary>` sends a bounded idempotent snapshot; it never writes to localStorage.
- `loadProjectKeywords(projectId: string): Promise<ProjectKeyword[]>`, `patchProjectKeywords(projectId: string, patch: KeywordPatch): Promise<ProjectKeyword[]>`. Graph overview is introduced in Task 4, so the first user-facing slice works without graph ingestion.
- `ProjectDiscoveryPanel({project,content,locale}: Props)` displays manual add/edit/disable/exclusion; AI suggestions are Task 3. `Shell` debounces sync on local catalog changes, retries on revisit, and displays nonblocking unsynced state.

- [ ] **Step 1: Write failing Vitest coverage** for a preexisting local catalog, offline Rust server, delayed/reordered responses, two projects, deleted/archived project and server-only graph changes not overwriting local project data.
- [ ] **Step 2: Run `pnpm --dir apps/web exec vitest run src/lib/api/discovery.test.ts src/app/project-discovery-panel.test.tsx src/app/shell.test.tsx`; verify RED.**
- [ ] **Step 3: Implement typed parsers, same-origin client, sync effect and manual keyword UI.** Keep the current `CATALOG_KEY` schema and `persistCatalog` synchronous behavior; a failed mirror sync cannot block a local save.
- [ ] **Step 4: Re-run focused tests and `pnpm --dir apps/web run typecheck`.** Must pass.
- [ ] **Step 5: Commit Task 2 files.**

## Task 3: Suggest editable, relevant project keywords with local AI

**Files:**
- Create: `apps/web/scripts/video-production/project-keyword-generator.mjs`, `apps/web/scripts/video-production/project-keyword-generator.test.mjs`
- Modify: `apps/web/scripts/director-studio-vite.mjs`, `apps/web/scripts/video-production/director-studio.test.mjs`, `apps/web/src/app/project-discovery-panel.tsx`, `apps/web/src/app/project-discovery-panel.test.tsx`

**Interfaces:**
- `generateProjectKeywords({name,description,keywords,locale}, {modelSettings,transport,signal}) -> Promise<{suggestions: KeywordSuggestion[]}>` proposes up to 20 bounded entries of `text,kind,rationale`, preserving project intent; model output is validated and deduped, never automatically activated.
- `POST /api/contentgen-director/project-keyword-suggestions` uses `resolveModelForTask("research")` and existing local-only header/Origin guard. Failure is a reviewable error; manual keywords remain usable.

- [ ] **Step 1: Write failing Node/Vitest tests:** “House Math”+homeownership description excludes generic arithmetic, empty description yields honest need-for-context, malformed JSON/duplicates/oversized phrases are rejected with bounded retry, accepted suggestions do not overwrite user edits.
- [ ] **Step 2: Run `node --test apps/web/scripts/video-production/project-keyword-generator.test.mjs apps/web/scripts/video-production/director-studio.test.mjs` and focused Vitest; verify RED.**
- [ ] **Step 3: Implement generator, protected route, pending suggestion review/accept controls.** Reuse installed local model settings and model-response parsing helpers; never download a model.
- [ ] **Step 4: Re-run the focused tests, frontend typecheck and build.** Must pass.
- [ ] **Step 5: Commit Task 3 files.**

## Task 4: Persist source-backed graph and ingest existing research safely

**Files:**
- Create: `migrations/0006_project_graph.sql`, `crates/server/src/research/graph_store.rs`, `crates/server/tests/project_graph.rs`, `apps/web/scripts/video-production/graph-extractor.mjs`, `apps/web/scripts/video-production/graph-extractor.test.mjs`
- Modify: `crates/server/src/db.rs`, `crates/server/src/research/mod.rs`, `crates/server/src/research/discovery_api.rs`, `crates/server/src/research/market_worker.rs`, `apps/web/scripts/director-studio-vite.mjs`, its tests

**Interfaces:**
- `graph_store::import_market_observations(db: &mut Connection, project_id: &str, now: i64) -> Result<IngestionReport, GraphError>` derives source/video/topic associations only for explicitly bound watchlists; no second YouTube call.
- `graph_store::import_search_leads(db: &mut Connection, project_id: &str, source_snapshot: SearchLeadBatch, now: i64) -> Result<IngestionReport, GraphError>` stores SearXNG leads with `evidence_state=lead_only` and unknown published date unless corroborated.
- `graph_store::apply_extraction(db: &mut Connection, project_id: &str, batch: ValidatedGraphBatch, now: i64) -> Result<GraphRevision, GraphError>` validates typed endpoint kinds and `kg_edge_evidence` source/passage references; facts without captured evidence remain `hypothesized`.
- `extractGraphBatch({project, sources, capturedPassages}, {modelSettings,transport,signal})` returns small bounded candidates, each `node/edge/sourceRef/confidence` with validated source IDs. No arbitrary external text can alter allowed relation types.
- `GET /api/research/discovery/projects/{id}/graph[?nodeId]` returns paged graph summaries/details with provenance and coverage; `POST /.../sources/import`, `POST /.../graph/batches` accept validated batches. The frontend client adds `loadProjectGraphOverview(projectId: string): Promise<GraphOverview>` here.

- [ ] **Step 1: Write failing Rust/Node tests** for a 4→5→6 migration, alias normalization, project isolation, repeated ingestion idempotence, source-lead vs verified passage, unsupported causal edge, stale/unknown trend observation, and market-worker completion fanout.
- [ ] **Step 2: Run `cargo test -p contentgen-server project_graph` and `node --test apps/web/scripts/video-production/graph-extractor.test.mjs`; verify RED.**
- [ ] **Step 3: Implement graph migration/store/routes and deterministic YouTube/source imports; then bounded model extraction.** Add FTS5 topic lookup and a normal list-based graph explorer read model. Background deterministic source import may run with collection; model extraction can initially run during a manual discovery job to conserve RAM.
- [ ] **Step 4: Run graph, collector and existing research tests plus SQLite integrity checks.** No extra API quota consumption.
- [ ] **Step 5: Commit Task 4 files.**

## Task 5: Store, deduplicate and deterministically rank opportunities

**Files:**
- Create: `migrations/0007_discovery_ideas.sql`, `crates/server/src/research/discovery_store.rs`, `crates/server/tests/discovery_ideas.rs`
- Modify: `crates/server/src/db.rs`, `crates/server/src/research/mod.rs`, `crates/server/src/research/discovery_api.rs`

**Interfaces:**
- `discovery_store::start_or_get_active(db: &mut Connection, project_id: &str, input_revision: &str, now: i64) -> Result<DiscoveryRun, DiscoveryError>` guarantees one active run/project, but a deliberate new request after completion creates a new run.
- `discovery_store::checkpoint(db: &mut Connection, run_id: &str, stage: DiscoveryStage, artifact_refs: &[String], now: i64) -> Result<(), DiscoveryError>` writes durable stage boundaries transactionally; final publication happens in one transaction.
- `discovery_store::rank(db: &Connection, project_id: &str, run_id: &str, candidates: &[OpportunityCandidate]) -> Result<Vec<RankedIdea>, DiscoveryError>` rejects covered/dismissed topic overlap using normalized title + topic/entity signatures + FTS5; optional embedding/AI comparison resolves borderline cases, never the sole duplicate check.
- `POST /api/research/discovery/projects/{id}/runs`, `GET /.../runs/{runId}`, `POST /.../runs/{runId}/checkpoint`, `POST /.../runs/{runId}/finish`, `POST /.../ideas/{ideaId}/decision` exposed for loopback job manager.

- [ ] **Step 1: Write failing tests** for double-click idempotency, new-after-complete run, interrupted stage resume, evidence-snapshot retention, two topics with the same premise, dismissed suggestion suppression, and returning three credible ideas instead of five invented ones.
- [ ] **Step 2: Run `cargo test -p contentgen-server discovery_ideas`; verify RED.**
- [ ] **Step 3: Implement migration, run state, duplicate filters, weights and diversity selection.** Initial deterministic weight contract: relevance 0.25, evidence/freshness 0.20, measured momentum 0.15, novelty 0.20, curiosity 0.05, production feasibility 0.05, advertiser relevance heuristic 0.10. Missing measurements score as unknown/low confidence, not synthetic zeros. Select at most two ideas per parent topic.
- [ ] **Step 4: Re-run targeted Rust and migration regression tests.** Must pass.
- [ ] **Step 5: Commit Task 5 files.**

## Task 6: Run discovery as an explicit, resumable local-AI job

**Files:**
- Create: `apps/web/scripts/video-production/discovery-job-queue.mjs`, `apps/web/scripts/video-production/discovery-job-queue.test.mjs`, `apps/web/scripts/video-production/local-inference-gate.mjs`
- Modify: `apps/web/scripts/director-studio-vite.mjs`, `apps/web/scripts/video-production/director-studio.test.mjs`, `apps/web/scripts/video-production/research-job-queue.mjs` (share one heavy-inference gate), `apps/web/scripts/video-production/research-job-queue.test.mjs`

**Interfaces:**
- `createDiscoveryJobManager({storage,search,model,graphApi,clock}) -> {create,get,resume,cancel}` with model settings resolved through `resolveModelForTask("research")`. Stages: frozen project snapshot → selected graph branches → cached/bounded SearXNG + YouTube refresh → validated graph extraction → 10–20 distinct candidate angles → deterministic duplicate/rank → fact-checked packaging → atomic result publish.
- `POST /api/contentgen-director/discovery-runs` `{projectId}`, `GET /discovery-runs/{id}`, `POST /discovery-runs/{id}/resume`, `POST /discovery-runs/{id}/cancel` use existing director same-origin guard and return persisted run progress; Node orchestrator calls Rust discovery APIs through the locally configured backend origin, never an arbitrary URL supplied by model/source input.
- Shared local-inference gate prevents concurrent heavy model invocations across existing storyboard jobs and discovery; bounded invalid-output/timeout retries with optional already-configured local fallback; no automatic continuation after process restart unless user resumes.

- [ ] **Step 1: Write failing Node tests** for no model calls before click, source stage checkpoint reuse, invalid JSON retry, timeout/fallback, cancellation, restart-paused state, double-click dedup and no concurrent story/discovery inference.
- [ ] **Step 2: Run `node --test apps/web/scripts/video-production/discovery-job-queue.test.mjs apps/web/scripts/video-production/research-job-queue.test.mjs`; verify RED.**
- [ ] **Step 3: Implement job orchestration, explicit routes and shared local inference gate.** Persist stage/candidate metadata through Rust; never log prompts, raw pages or keys. Continue with partial providers and honestly report unavailable Google Trends.
- [ ] **Step 4: Re-run focused Node tests and director route guards.** Must pass, including failure-injection/resume tests.
- [ ] **Step 5: Commit Task 6 files.**

## Task 7: Surface graph explorer, five cards, history and handoff

**Files:**
- Create: `apps/web/src/app/discovery-ideas-panel.tsx`, `apps/web/src/app/discovery-ideas-panel.test.tsx`
- Modify: `apps/web/src/app/project-discovery-panel.tsx`, `apps/web/src/app/project-discovery-panel.test.tsx`, `apps/web/src/app/research-workspace.tsx`, `apps/web/src/app/research-workspace.test.tsx`, `apps/web/src/app/shell.tsx`, `apps/web/src/lib/api/discovery.ts`, `apps/web/src/lib/api/discovery.test.ts`

**Interfaces:**
- `DiscoveryIdeasPanel({projectId,locale,onSaveIdea,onResearchAngle})` starts a run only from its button and polls the existing job; presents up to five evidence-linked cards, warnings and provider availability, saved/dismissed/history state. A pending idea handoff prefills existing Research Workspace inputs; it must **not** silently create a source-verified storyboard from mere SearXNG leads.
- `ProjectDiscoveryPanel` adds compact graph node search and detail view with badges for *supported*, *hypothesized*, *stale* and *already covered*. An elaborate force-layout canvas is not required.

- [ ] **Step 1: Write failing Vitest flows** for manual click, opening prior run after reload, accepting/dismissing idea, source/metric disclosure, keyboard/Japanese labels, offline provider and starting focused research from an idea.
- [ ] **Step 2: Run focused `pnpm --dir apps/web exec vitest run src/app/discovery-ideas-panel.test.tsx src/app/research-workspace.test.tsx`; verify RED.**
- [ ] **Step 3: Implement the UI and handoff, preserving the current left navigation and research/storyboard workflow.** On save, append an existing `LocalContent` item with `stage: "idea"` and sync the catalog mirror; on research, pass a prefilled title/audience/question to the existing evidence capture workflow.
- [ ] **Step 4: Run focused tests, `pnpm --dir apps/web run typecheck`, lint and build.** Must pass.
- [ ] **Step 5: Commit Task 7 files.**

## Task 8: Full integration, safety and one-PR delivery

**Files:**
- Modify: `docs/04-research-seo.md`, `docs/03-data.md`, `docs/08-assurance.md`, optionally `README.md`
- Test: representative Rust API/SQLite tests, Node discovery-job tests, React interaction tests and one offline end-to-end fixture

**Interfaces:**
- Fixture: “House Math” described as homeowner economics; keywords `home insurance`, `property tax`, `mortgage costs` plus manual `roof replacement costs`; two duplicate existing videos, one stale lead, one unavailable Trends adapter, and measured YouTube observations.

- [ ] **Step 1: Add one failing end-to-end fixture assertion** that a fresh installation with the described project produces supported, nonduplicate recommendation cards and respects rejected/manual terms and unavailable provider states.
- [ ] **Step 2: Run fixture and confirm the expected failure only.**
- [ ] **Step 3: Wire any missing integration points and document exact startup steps, source status, model selection, keyword review and job recovery.** Update spec deviations, with reasoning, rather than changing old design silently.
- [ ] **Step 4: Run `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, `pnpm --dir apps/web test`, `pnpm --dir apps/web run test:video:headless`, `pnpm --dir apps/web run typecheck`, `pnpm --dir apps/web run lint`, `pnpm --dir apps/web run build`.** Record exact pass/fail; do not claim unrun QA. Verify ordinary-speed desktop/mobile layout, keyboard navigation and saved-run refresh; no live paid/Google/YouTube calls are required in CI.
- [ ] **Step 5: Compare diff against spec, validate migrations on an existing v4 DB, report model/API permissions and disk footprint, and open one reviewed PR.** Do not publish or merge automatically.

## Self-review

- **Spec coverage:** Project keywords (Tasks 1–3), source graph/provenance (4), novelty/history (5), click-only durable local AI work (6), ideas/graph UI and saved content (7), providers/failures/QA (4–8).
- **Integration risk:** The browser's catalog and Rust database are separate; Task 1 mirror + Task 2 sync must ship before graph imports. The current Rust scheduler does not execute Node inference; Task 6 uses its own locally persisted orchestrator and shared gate.
- **Scope discipline:** No new graph DB, no invented Google Trends numbers, no new vector dependency, no automatic generation, no auto-posting. A future provider adapter can be added without changing graph identity.
- **Review focus:** Each listed failure has named assertions in Tasks 2, 4, 5 and 6. All interface names and request paths are consistent within this plan; implementation should lock them through Rust/TypeScript contract tests.
