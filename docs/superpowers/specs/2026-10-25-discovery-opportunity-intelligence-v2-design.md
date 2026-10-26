# Discovery Opportunity Intelligence v2 — Design

## Intent

Give a creator a useful, source-backed indication of a proposed video's opportunity without making a single title-matched YouTube search, three unrelated competing ideas, or an unreliable Google Trends response a prerequisite. Continue to distinguish observed market evidence from heuristic estimates and never present a score as a probability of virality.

## Approved scope

The user selected all three approaches: (A) provisional, confidence-labeled scoring with smaller samples; (B) intent-based multi-query YouTube research and cross-session/channel benchmarking; (C) optional Google Ads Keyword Planner search-volume and keyword-idea research. They additionally approved longitudinal video growth snapshots, channel-relative breakout analysis and official YouTube audience-question observations. Headless YouTube scraping was explicitly withdrawn.

## Constraints and existing surfaces

- Build on `idea_market`, `youtube_api`, `market_store`, `idea_trends`, `viral_potential` and the existing Discovery UI. Reuse Discovery's persisted lease/worker for this version and migrate it into the generic Jobs DAG as part of the separately planned unified-Jobs work. Do not create an independent paid-search worker or use a browser as a YouTube data source.
- Source observations carry query, exact video or keyword identifier, format, geography, provider/version, observed time, and expiry. Do not equate Google Search volume, Google Ads competition or bid estimates with YouTube search volume, organic competition or revenue.
- Keyword Planner uses Google's official current API (as of October 2026 the developer token is sunset), Google OAuth and the Google Cloud project's access level. Never store OAuth refresh tokens in SQLite, frontend state, job payloads or logs. Missing access produces a typed unavailable observation. No live paid-provider calls in tests.
- Stay under the existing shared per-day YouTube search reservation limit; dedupe video IDs within assessments and avoid repeating a saved measurement during cooldown. Cross-session query caching is a possible later enhancement. Additional `videos.list`, `channels.list`, `playlistItems.list` and `commentThreads.list` calls have independent bounded limits.
- Use only official API endpoints; comments are untrusted, read-only evidence of language/questions, never directly factual proof or a predictor of virality. Respect source retention and rights.
- Preserve the existing `evidence-readiness-v1` score and prior `viral-potential-v1` responses. Introduce explicit `v2` source coverage/confidence, with legacy parsing tests. Existing raw observations are never silently reinterpreted as new measurements.
- Separate long-form and Shorts. Public competitor impressions, CTR, watch-time and retention are unavailable; do not synthesize them.

## Architecture and behavior

1. Discovery derives one or two distinct viewer-intent queries by removing editorial hook words and optionally broadening a modifier. Saved query provenance is retained; project-keyword-based plans remain possible future work.
2. Search YouTube through the existing official API adapter; the second query is only reserved when the first is too sparse. Each request and combined assessment is capped, and video IDs are deduplicated. Broader query results remain subject to the same format and topic relevance checks at read time.
3. For selected relevant videos, measure channel-relative performance against other public uploads of comparable format and age. Persist observation snapshots; scheduled refreshes compute *observed* 7/30-day growth only when both timestamps exist. An initial run shows unknown growth, not a projection.
4. Google Ads `GenerateKeywordIdeas` expands genuine viewer phrases and exposes canonical keywords, monthly Google Search estimates, ad competition and cost ranges. Successful results refresh at monthly cadence; absence or errors never block YouTube-only evidence. `GenerateKeywordHistoricalMetrics` is not yet used.
5. For selected videos, `commentThreads.list` retrieves a bounded set of public comments. Heuristics or optional local AI detect repeated viewer questions and show attributed examples without treating them as quantitative search demand.
6. `opportunity-v2` separates quantitative score, state (`provisional`, `measured`, `insufficient_data`), confidence/coverage, component metrics, and evidence links. Small diverse samples and good historical anchors may produce provisional rankings; absent evidence or absent meaningful comparison anchors remains unknown. Never impute missing Trends/Ads as zero or 50.
7. Outbound calls run in Discovery's existing persisted and cancelable market-collection lease, with separate quota reservations, cooldown and partial provider failure isolation. No external calls are made from Select Idea mount; adding first-class provider nodes to the generic Jobs page is explicitly deferred until the unified-Jobs migration.

## UI

Show one compact Opportunity score and confidence label, a concise reason (`strong breakout evidence`, `limited comparable videos`), provider status, and evidence disclosure. Keep metrics clearly labeled YouTube vs Google Search. Show actual sources, sample sizes, freshness and missing-data causes on expansion; do not add duplicate headings, badges or synthetic percentage progress. Reuse existing components/Kumiki where available.

## Acceptance

- An exact-title search returning three videos from one channel automatically expands to alternative viewer-intent searches while staying within quota. Unrelated generic videos do not become valid comparables.
- A single eligible idea never blocks another idea's scoring solely because there are fewer than three ideas in the Discovery session. Sparse or single-channel evidence is explicitly provisional/low confidence, never a confident measured score.
- A saved video has no false 7-day growth metric until two dated public snapshots exist; a true increment is computed from observed counts. Channel baseline excludes the subject video and does not mix Shorts/long-form.
- Google Ads absent/denied/quota-exhausted returns a typed unavailable state, while YouTube-only observations remain usable. No secrets in SQLite or logs.
- Comments are bounded, sanitized, optional and attributed. Discovery market backfill handles retries/cancellation and process restart; first-class provider Jobs entries remain a follow-up in the unified-Jobs migration.
- Existing user data and API shapes migrate compatibly; offline fixtures, Rust unit/SQL/API tests, frontend typecheck/lint/tests/build, and visual state inspection complete before a final success claim. No GitHub Actions dependency.

## Approaches considered

- **Lower hard gates alone:** fast and cheap, but one channel can yield misleading rankings. Rejected as the sole solution; retained only as a confidence-aware fallback.
- **Multi-query YouTube + benchmarks:** best direct indicator of public YouTube opportunity, relatively inexpensive but requires durable snapshots and a nontrivial scoring version. Selected as the backbone.
- **Google Ads/Google Trends/community signals:** better query expansion and external interest; Google Search is not YouTube and some providers require approval/cost. Selected as optional supporting evidence, not a hard gate.

