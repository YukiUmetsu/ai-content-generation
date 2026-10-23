# Local YouTube Niche Intelligence Collector — Design

**Date:** 2026-10-23
**Status:** Implemented in `feat/local-youtube-market-collector` (local fixtures verified; live provider smoke test pending user API key)
**Scope:** One end-to-end, local-server-only ContentGen research slice
**Related contracts:** [Research/SEO](../../04-research-seo.md), [Data](../../03-data.md), [Video Performance System](../../15-video-performance-system.md), [Runtime](../../02-runtime.md)

## Problem and user outcome

ContentGen should automatically collect useful public YouTube market signals about the user's educational-video niches without a vidIQ subscription. The user runs ContentGen locally; collection happens **only while that local Rust server runs**. The user can see what was observed, choose a video idea, and take it into the existing Studio content catalog. The tool does not pretend that views reveal click-through rate, retention, ad revenue, search volume, or causal topic demand.

Example niches are **House Math** (home ownership costs/repairs) and **Margin Atlas** (finance/business), but all watchlists are user-defined, editable and disabled by default. No external paid services, hosted cron, auto-publishing, or hidden API calls.

## Chosen design

### Capture

1. In Research → **YouTube Intelligence**, user creates a niche watchlist with name, US/English target market, and one or more specific search phrases (MVP: one phrase per watchlist); chooses to enable collection.
2. User configures a YouTube Data API key in the local server environment via `CONTENTGEN_YOUTUBE_API_KEY`; the web UI only displays **configured / missing**, never the secret. No key in SQLite, localStorage, logs, or browser requests.
3. Server runs one Tokio background collection loop. On startup and then at bounded intervals it selects due enabled watchlists. A watchlist defaults to a daily refresh. Only server uptime counts; after downtime, one due run is eligible on next launch, with no backlog flood.
4. Discovery uses YouTube Data API `search.list` by keyword (up to 25 recent relevant videos), then batch `videos.list` for public views, likes/comments where supplied, duration/published date, and optionally `channels.list` for publicly exposed subscribers. The source video ID, watchlist/query, provider, observed timestamp, market/locale, and missing-value state are recorded. Never turn absent metrics into zero.
5. Responses are normalized and stored in dedicated SQLite market tables with idempotent `(watchlist, video, observed-at collection)` upserts. Immutable source URLs are rendered as links. Display observed public totals and freshness; separate manual editorial assessment from measured data.
6. UI shows watchlist states, last/next run, quota usage and errors, and observed video candidates. **Save as video idea** creates a real `LocalContent` entry at `stage: idea` in the existing Studio catalog and navigates to Content. It does **not** claim to have generated a research dossier, script, media file, or posted video.
7. A manual **Collect now** button runs one enabled watchlist through the same worker, respects all quotas, and gives a visible job status. UI can disable or delete watchlists and stop subsequent runs.

### Permission, lifecycle and limits

- External collection is opt-in per watchlist, requires a configured API key, and never starts because someone opened the Research tab.
- The collector is part of the existing loopback-only Rust server, not a separate daemon. Stop the server → stop work. In-flight calls have timeouts and shutdown cancellation; no OS launch agent or cloud schedule.
- Conservative default: one search per enabled watchlist per 24 hours, up to 10 active watchlists, up to 25 search results each. Persist a project-level `search.list` budget of 20 calls per rolling 24 hours for both auto/manual runs; reject requests rather than exceeding budget. Show provider quota/rate errors distinctly and back off.
- Add a 30-day TTL to public API-derived snapshots; prune at startup, before listing data, and during each collection cycle. If the server was off for weeks, expired observations must be hidden immediately. Retain user's independently authored content ideas, but do not copy durable API-derived competitor statistics into them.
- Avoid computed rankings, outlier scores, viral predictions, or cross-channel numerical comparisons under YouTube API derived-metric restrictions absent additional permission. Initially list candidate videos with transparent filters (recency, source, public view count) and editorial questions. This intentionally covers less than vidIQ's proprietary scoring layer.
- Never display or infer competitors' CTR, impressions, audience retention, RPM, real search volume, revenue, thumbnails' conversion rate, or estimated earning claims.
- Respect YouTube's developer/API policies; cache only permitted metadata, retain no scraped transcripts/thumbnails, link back to source, and keep provider/version timestamps.
- Network tests run against local fake HTTP endpoints only; no live API calls, credentials, charges or production data needed for CI.

### Components and boundaries

- `migrations/0002_youtube_market_watchlists.sql`: `market_watchlists`, `market_runs`, `market_video_observations`, API budget ledger and useful indexes. STRICT tables and bounded/checked input.
- `crates/server/src/research/`: typed domain + validation, SQLite store, API adapter, collector, HTTP endpoints. Reuse the `AppState` database path and Axum error patterns; do not shoehorn real worker execution into the existing persistent DAG state machine unless it genuinely becomes wired.
- `crates/server/src/main.rs`: spawn/own the collector during server lifetime with clean shutdown, as part of the existing server process.
- `apps/web/src/app/research-workspace.tsx` and new `youtube-intelligence-panel.tsx`: an actual watchlist/editor/results UI beside Evidence and Packaging; not a decorative placeholder.
- `apps/web/src/lib/api/{client,types}.ts`: typed, runtime-validated endpoints. `apps/web/src/app/shell.tsx` passes a tested save-idea callback through to existing catalog persistence.

### API contract (illustrative, finalized in tests)

- `GET /api/research/market/status` → `{ apiKeyConfigured, collecting, searchCallsLast24h, searchCallLimit, ... }`; never secret values.
- `GET /api/research/market/watchlists`, `POST /api/research/market/watchlists`, `PATCH /api/research/market/watchlists/{id}`, `DELETE /api/research/market/watchlists/{id}`.
- `POST /api/research/market/watchlists/{id}/collect` → queued/rejected status; API budget reserved atomically.
- `GET /api/research/market/watchlists/{id}/videos` → observed records with `observedAt`, `provider`, `visibility`, `nullable` public counters, and video URL. No fake performance score.
- All mutations validated for query length, locale, allowed frequency, max watchlists, and request size, with stable error envelopes; no API key in errors.

### Main data failure cases

- Missing API key: watchlist can be saved, collector never calls YouTube and UI explains setup.
- 403 quota exhaustion / 429 provider throttle: recorded safely as backoff status; no tight retries.
- Timeout, partial pages, deleted/private videos: run records error or skips missing IDs, never fabricates zero views, never wipes a previous valid observation just because this run failed.
- Server restarts mid-run: stale `running` row is reconciled, a later eligible attempt succeeds; no duplicate budget burn or runaway reruns.
- Two manual clicks and scheduler race: a per-watchlist collection lease and atomic budget reservation prevent duplicate simultaneous requests.
- Stale data: purged/hidden even if no scheduled collection occurred.
- User saves an idea: data catalog update is validated and durable, and contains only an authored new idea title + source link and human-editable notes; no competitor metric history.

## Later extensions (not part of MVP)

- Optional vidIQ MCP using its own opt-in credit budget, and an explicit display of which scores came from vidIQ.
- Own-channel OAuth Analytics for CTR, retention, watch time and real RPM (not competitor analytics).
- Google Trends / YouTube Studio trends where authorized; multi-query clusters and tracked channels; editorial opportunity reports once compliant data rights and baselines are established.

## Testing and acceptance

Run from a clean database, opt in with a fake provider, close/restart server, and confirm that one watchlist collects and displays real fixture data with provenance; manual button works; saving one observation makes an actual Content entry; disabled watchlists never make network requests; 30-day cleanup and 24h budget both enforce correctly. Run server Rust checks and web typecheck/tests/build. No claim of a live API smoke test without real credentials and the user's permission.

**Reference:** YouTube Data API [search](https://developers.google.com/youtube/v3/docs/search/list), [videos](https://developers.google.com/youtube/v3/docs/videos/list), [quota](https://developers.google.com/youtube/v3/determine_quota_cost), and [API Services Policies](https://developers.google.com/youtube/terms/developer-policies). Review provider policies again at implementation/release time.
