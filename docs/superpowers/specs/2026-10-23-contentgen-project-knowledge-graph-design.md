# ContentGen: Project Knowledge Graph & Discover 5 Ideas

**Status:** Approved for implementation by the user  
**Date:** 2026-10-23  
**Target:** Existing local-first ContentGen application (Rust/Axum, SQLite, React/TypeScript, local AI)

## 1. Intent

Help a creator repeatedly find five **new, channel-relevant, evidence-backed content ideas** without spending time manually piecing together YouTube performance, search trends, news, and the project's existing content. Each project owns a persistent, evolving knowledge graph of topics, entities, questions, relationships, supporting sources, and coverage. The graph makes research cumulative instead of starting from scratch for every request.

The creator chooses when to generate recommendations: **only clicking “Discover 5 Ideas” initiates an idea-discovery run.** Existing source collection and bounded source-to-graph extraction may continue automatically while the ContentGen server is running; those background jobs must not silently generate a new batch of five ideas. When the server is off, neither collection nor graph extraction runs.

## 2. Decisions and constraints

- **Chosen:** An evidence-backed property graph stored in ContentGen's existing SQLite database. No separate graph service.
- **Chosen:** Project name and description seed local-AI keyword suggestions, and users may add/edit/disable/delete keywords and search phrases manually.
- **Chosen:** Google/YouTube/news data contribute external evidence; local AI extracts, connects, and interprets, but does not invent metrics or source facts.
- **Chosen:** Exactly one user-initiated discovery job per click (idempotent repeat submissions); aim to suggest five ideas, but fewer are acceptable when evidence is insufficient.
- **Chosen:** Exclude materially duplicated topics already produced or in progress; track dismissed prior suggestions to prevent immediate resurfacing.
- **Preserve:** Local AI runs in small, durable, bounded jobs with retries for malformed structured output/timeouts. Partial research survives failure.
- **Preserve:** YouTube search relevance and quality filtering. Broad project/channel names, such as “House Math,” are not treated as literal generic token searches for “house” plus “math.”
- **Preserve:** Collection is local-only while the server is running, consistent with existing YouTube Intelligence behavior; no cloud scheduler required.
- **Preserve:** Backend-only API keys and existing saved-source/search/research semantics; do not introduce automatic posting or paid-provider calls.
- **Provider caveat:** Google's official Trends API currently requires limited alpha access. Trends is an optional adapter; an absent API must be shown as unavailable rather than masquerading as verified trend data. News/search adapter(s) use the project's existing configured providers where possible.

## 3. User experience

### Project → Discover

1. **Project profile:** Name, description, target audience and geographic/language context where already supported. The project description is authoritative; do not infer an unrelated niche from its name.
2. **Keywords:** “Suggest Keywords” asks local AI for approximately 10–20 focused topic/phrase candidates, including distinct intents/questions. Suggestions enter a review state, not the active set until accepted. Manual keywords are independently editable and are never automatically overwritten. Allow exclusions/negative terms.
3. **Knowledge:** Show a browsable topic explorer with counts of source evidence, freshness, subtopics, related questions, and content coverage; support node/relationship detail and linked source inspection. A force-directed graph visualization can be progressive enhancement, not the sole way to understand or edit data. Users can inspect or remove mistaken AI relationships.
4. **Discover 5 Ideas:** Button starts one persisted job. UI shows progress by stage (select relevant graph branches → refresh sources → analyze signals → check duplicates → rank & package). Opening another page or restarting the app does not lose work. Repeated clicks while the same project has an active discovery job reopen that job rather than initiating another run.
5. **Results:** Up to five cards, each with a title, audience-specific hook, concise premise, evidence and source links/dates, relevant signals, why-now explanation, freshness/confidence, differentiation from existing content, estimated production difficulty, and opportunity rationale. Ad value can be a labeled heuristic, not fabricated RPM/CPM. Actions: save as idea, create storyboard, dismiss with reason, or rerun discovery.
6. **History:** Preserve each run, inputs, provider health, generated ideas, decisions, and evidence snapshot. Saved/dismissed choices influence future novelty ranking. Results do not disappear after refresh.

## 4. Knowledge graph model

Each graph node and edge is scoped by `project_id`; a source record may be deduplicated globally internally, but only project-authorized information is attached to that project's graph.

**Node kinds** (minimal v1):

| Kind | Example | Purpose |
| --- | --- | --- |
| `topic` | Home insurance | Durable subject, with alias/synonym names and parent topics |
| `entity` | Oklahoma / an insurer | Named people, places, organizations, products, policies |
| `question` | Why did my premium rise? | Audience demand or explanatory gap |
| `event` | A newly announced rate change | Time-bound news and factual developments |
| `source` | YouTube video or news article | Canonical URL/provider ID, publication and collection timestamps |
| `content` | Idea, draft, storyboard, export, published video | Existing project coverage and lifecycle/status |

**Typed edges:** `subtopic_of`, `related_to`, `affects`, `raises_question`, `mentions`, `covered_by`. `kg_edge_evidence` carries `supports`/`contradicts` assessments and references the exact edge ID plus a source/captured passage; evidence does not ambiguously point at a whole topic. Direction and allowed endpoint kinds are validated. A reversible merge/alias operation prevents duplicate nodes such as “homeowners insurance” vs “home insurance.”

**Every AI-proposed relation** includes `origin` (manual, imported, AI-inferred), confidence, creation/update timestamps, extraction model/version, and references to captured passages or observations. A relation lacking source support stays explicitly *hypothesized* and does **not** become an asserted fact. Manual corrections can lock a relation against automatic reintroduction until reviewed.

**Temporal signals live separately** from durable graph structure. Each observation stores provider, observed metric, units, geography, date/window, collected timestamp, and associated topic/source. Do not flatten a multi-week time series into a permanent “trending” label; ranking should calculate momentum from current comparable observations. If comparable data is absent, mark growth unknown.

**SQLite design units** (names illustrative until the real migrations are inspected):

- `project_keywords`: `project_id`, text, type (topic/query/exclusion), origin, approval/active state, locked/manual flag, normalized key.
- `kg_nodes`, `kg_node_aliases`, `kg_edges`, `kg_edge_evidence`: normalized identities, typed relations and provenance.
- `trend_observations`: measured source-specific values with windows and geography.
- `discovery_runs`, `discovery_candidates`, `discovery_candidate_sources`: resumable jobs, scoring components, explanations and stable evidence IDs.
- Existing research sources, YouTube watchlists/videos and created-content tables remain canonical; add references rather than duplicate their data where possible.

SQLite foreign keys, project-scoped uniqueness constraints and transaction boundaries must prevent dangling evidence, cross-project leakage, and duplicate active runs. Add FTS5-based topic/source lookup, with vector/semantic comparison optional where local embeddings already exist.

## 5. Research and graph-building pipeline

### A. Keyword bootstrap (explicit user action)

Supply project name, description, audience and accepted seed terms to a bounded local-AI task. Require schema-validated candidate phrases with category and rationale. Normalize whitespace/case, reject generic unrelated expansions, dedupe exact/near duplicates, and let users accept/edit/delete. An empty project description should ask for more context or rely on explicitly chosen manual keywords; do not hallucinate a niche from the brand name.

### B. Evidence collection (existing background collectors)

Reuse saved searches, YouTube Intelligence watchlists and stored public video statistics. Existing niche watchlists can associate with one or more relevant projects through an explicit project↔watchlist mapping instead of silently reassigning watchlists. Issue focused keyword queries, rotating explicit phrases under a per-project/global daily budget. Capture results from configured news/search providers. Treat Google Trends as an optional provider with independently identifiable provenance, a “not configured/limited access” state and no unofficial bypass dependency. Persist retrieved source records even if a later AI step fails. The collector only operates while the local server is running.

Relevance requires matching **project intent**, not simply a keyword token. Apply deterministic lexical/entity/topic filters before local-AI relevance evaluation where needed. Preserve both established high-performing videos and promising recent videos as distinct evidence classes; never equate low views with zero opportunity, but do not elevate them based solely on recency.

### C. Incremental graph extraction (bounded jobs)

Process newly collected source summaries/captured passages in small batches. Extract candidate nodes, typed relations, audience questions and supported statements in structured JSON. Validate schema and evidence offsets/identifiers. Perform alias matching and project relevance checks before transactional insertion. Failed inference retries with bounded backoff and smaller context/fallback model where already configured; after exhaustion, record a safe error and retain raw research for later reprocessing. Never treat arbitrary source text as an instruction to the model or log source bodies/secrets in errors.

### D. Discover 5 Ideas (click only)

1. Freeze run inputs: project description, active keyword set, graph revision, research freshness, provider availability and content snapshot.
2. Traverse relevant subtopics/questions/events, favoring undercovered branches and recent supported changes. Expand bounded candidate queries; reuse cached evidence first and perform limited on-demand refresh under API budgets.
3. Generate a pool of roughly 10–20 distinct candidate angles using small local-AI jobs from compact, cited evidence bundles, not an entire corpus/context.
4. Detect duplicate/near-duplicate coverage against saved ideas, in-progress scripts/storyboards, rendered/exported and published videos, and previously dismissed recommendations. Use canonical topic/entity overlap plus lexical/FTS similarity, with semantic similarity and a small AI adjudication prompt for borderline cases. A changed title alone is not a novel idea. Keep the exclusion reason in the run record.
5. Score *relevance*, *evidence/freshness*, *relative YouTube performance or measured momentum*, *novelty/coverage gap*, *audience curiosity*, *production feasibility*, and an explicitly heuristic *advertiser relevance*. Penalize weak evidence, unrelated viral videos and oversaturated copies. Normalize source-specific measurements; do not compare Google Trends index directly with YouTube view counts.
6. Select a diverse top five, avoiding five variations on the same parent topic; generate title, hook, angle, evidence, and why-now statements. Validate any sourced number and all source links against stored records. If only three credible candidates remain, return three with an explanation rather than padding to five.
7. Persist stage progress and candidate evidence transactionally as work completes; publish the final ranked result set atomically when validation succeeds. Expose partial stage state and retryable errors. A double-click, page reload or repeated request while active returns the same run; a deliberate click after completion starts a new run.

No recommendation claims “trending” without a measured time comparison or an explicit, clearly labeled proxy such as published recency plus unusually high views/day; unknown signals should remain unknown.

## 6. Interfaces and boundaries

The exact HTTP route names, migration conventions and frontend components should be mapped to the actual ContentGen repository during implementation planning. The conceptual operations are:

- `GET/PATCH project discovery settings`: list/modify/activate/manual-lock project keywords and exclusions.
- `POST keyword suggestions`: enqueue or execute a small local-AI suggestion task; inspect/accept suggestions separately.
- `GET graph overview/node/subgraph`: paged, project-scoped explorer with evidence and coverage summaries.
- `POST discover`: idempotently start or return existing active discovery run for a project.
- `GET discovery runs/:id`: persisted stage, provider status, candidates, evidence, error category, continuation/retry state.
- `POST idea decision`: save, dismiss (with optional reason), or start storyboard using existing ContentGen workflow.

All writes use server-side project validation. Keep AI inference, provider calls, quota control and graph normalization behind existing service/job boundaries. No browser-side secrets or new mandatory external service.

## 7. Failure handling and evaluation

- **Provider unavailable:** Continue with available evidence; label missing Trends/news/YouTube sources and reduce confidence. Do not invent absent observations.
- **Local AI malformed structured output:** Retry according to the existing bounded retry/fallback strategy; persist the failed stage and sanitized diagnostics. No runaway retry loop.
- **No/poor evidence:** Preserve the run with honest “insufficient evidence” outcome; do not fabricate five ideas.
- **Topic drift:** Test “House Math” against searches about homeownership economics, rejecting generic arithmetic and generic house tours.
- **Duplicate coverage:** Existing videos with different titles but same substantive premise must block repeats unless a genuinely new development changes the angle.
- **False graph relation:** A hallucinated causal link must remain hypothesized or be rejected; every fact-like connection requires traceable source evidence.
- **Stale evidence:** Old spikes are distinguishable from current trends using published and observed dates, not a timeless score.
- **Job interruption:** Restart resumes/retries from persisted stage without losing sources, double-consuming quota or duplicating results.
- **Security:** Restrict graph queries to the owning project, sanitize logs, enforce bounded source texts, handle untrusted news/video descriptions safely.

User acceptance test: Create a project named “House Math” with a description about homeowner economics; accept AI keywords and add one manual keyword; collect relevant source data; inspect source-backed subtopics and relationships; click “Discover 5 Ideas”; see up to five distinct relevant opportunities with evidence; save one and dismiss another; run discovery again and verify neither reappears unchanged. Confirm a project with no available Trends API still works and explicitly shows that source as unavailable.

Additional acceptance invariants: re-suggesting keywords must not overwrite a manually edited term; project A cannot read project B's nodes/edges; malformed-JSON extraction retries and resumes without duplicating evidence; an unsupported trend metric is never labeled measured growth; background collection/extraction never generates a batch of ideas without a click.

## 8. Rollout and non-goals

**Suggested delivery stages (each usable on its own):**

1. Project keywords and graph persistence; migration + user review/edit workflow.
2. Source-to-graph incremental ingestion, provenance, history and topic explorer.
3. Click-to-discover durable candidate generation, novelty checks, scoring, five-idea cards and storyboard handoff.
4. Refinement of graph visibility, relationship corrections, optional external trends adapters, ranking calibration and history comparisons.

**Non-goals for v1:** Neo4j or a second database; autonomous publishing; guaranteed virality; unsupported exact revenue predictions; hidden paid APIs; scraping around Google access restrictions; a mandatory complex graph visualization; always generating exactly five even with insufficient evidence.

## 9. Approach decision

| Approach | Trade-off | Decision |
| --- | --- | --- |
| AI topic tree | Cheapest but no evidence provenance or durable relationships | Rejected |
| SQLite evidence-backed property graph | Durable project intelligence, explainability and local-first operation without added service | **Chosen by user** |
| Dedicated graph DB | Rich graph tools but extra setup/runtime, migrations and synchronization | Rejected |

## 10. Implementation-planning caveat

The current source checkout was not available in the working environment during design. Before specifying exact file paths, HTTP routes, migrations or background-job APIs, inspect the current main branch and reuse existing primitives instead of building parallel research, job or source stores. This document describes intended behavior and data invariants, **not** a claim that the feature is implemented.
