# Automatic Market Signals Inside Discovery — Design

## Intent

When a creator starts Discovery, the job must generate ideas **and** collect comparable market evidence before declaring the result ready. Select Idea is a review screen; no per-idea measurement click should be necessary. The user specifically wants both public YouTube observations and Google Trends signals.

## Current system and defect

`apps/web/scripts/video-production/discovery-job-queue.mjs` generates candidates, then calls the Rust `/runs/{run}/finish` endpoint. The Rust endpoint persists ideas and marks Discovery complete. The new YouTube idea assessments exist behind a separate user-triggered `/ideas/{id}/market` endpoint, so completed discoveries display editorial research-readiness values without automatically collecting market signals.

## Approaches considered

1. **Discovery-owned enrichment (recommended).** Persist candidate ideas, enter a durable `measure_market` stage, automatically collect YouTube and Trends evidence, and finalize Discovery once each bounded attempt finishes or is explicitly skipped. Correct lifecycle and visible progress; requires a durable stage transition and worker recovery.
2. **Post-completion background enrichment.** Keep today's completion semantics and launch measurements opportunistically. Less work, but Select Idea can open before scores exist and the Jobs UI reports a misleading finished state.
3. **Browser-triggered batch on Select Idea mount.** Simple client change but fails for a closed tab, reloads can trigger needless provider calls, and it doesn't belong to Discovery.

## Proposed behavior

- Discovery produces candidates, freezes their sources, then checkpoints `measure_market` while the run is still active. The Jobs page displays progress and the existing automatic navigation to Select Idea happens only after the enrichment stage reaches a terminal result.
- Measurements run without additional clicks, for all new eligible ideas up to the existing **shared** YouTube quota of 20 search reservations in a rolling 24 hours. Prior observations can be reused only when provenance and query/format match. No retry on every page load.
- Rust performs outbound provider access; API keys stay in existing local credential storage. YouTube uses the official Data API with the current per-idea limits. Google Trends initially uses a bounded, best-effort Rust `gtrend-rs` adapter (the official API currently has restricted alpha enrollment).
- For Google Trends, record a time-bounded series, region, exact query, capture time, normalized interest, and an **within-term change or momentum statistic**. Google Trends' normalized values are not absolute keyword search volumes. Do not directly compare separately normalized absolute indices across different queries.
- Store source-specific statistics, provenance, failure codes, and versioned scoring inputs. The compact Select Idea card shows numeric YouTube comparison and Google Trends momentum separately, with a source-backed composite/rank only where comparable sample coverage justifies it; never default to 50.
- A missing API key, empty search sample, quota exhaustion, Trends 429/block page, temporary outage, cancellation, or interruption must be visible as a bounded `unavailable`/`partial` state—not a fabricated statistic and not a discovery that hangs forever.
- Preserve the optional manual refresh action for creators who later want updated data; it is not required for initial scoring.

## Constraints and open risks

- Each YouTube search consumes existing quota; cap requests and avoid duplicate attempts across restart/resume.
- The third-party Trends client is not an official Google API and may be throttled, blocked, or break. Isolate it behind a provider boundary, serialize/rate-limit its requests, apply timeouts, and avoid logging response bodies or credentials. It must never block otherwise usable Discovery output indefinitely.
- Do not mix channel audience, CTR, ad revenue, or Google keyword search volume into observed data: those numbers are not provided.
- Keep UI compact, keyboard/touch-accessible and reduced-motion aware. Do not restore previously removed redundant Discovery/Select Idea headers.

## Success criteria

1. One Discover click produces a visible market-enrichment job stage, and no Measure click is needed before Select Idea.
2. Reopening the session renders saved measured values without causing provider requests.
3. Data-backed metrics and unavailable/partial states survive reload and process restart.
4. Quota, rate limits, absent credentials, and provider failures are tested; no infinite pending state.
5. Rust tests, TypeScript typecheck, lint, frontend tests and production build pass locally without GitHub Actions.
