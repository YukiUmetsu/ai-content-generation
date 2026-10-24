# Optional YouTube Search Phrase and Automatic Niche Discovery — Design

**Date:** 2026-10-23  
**Status:** Approved  
**Scope:** One ContentGen PR, preserving the local-only YouTube market collector

## Intent

The user wants to monitor a niche such as **House Math** without inventing a
YouTube search phrase first. A specific phrase remains useful for deliberate
keyword monitoring, but it must not be required to start discovering video
topics. The feature must produce honest, inspectable searches rather than
pretend to know search volume, virality, or future earnings.

## Approaches

1. **Fallback-only:** search for the niche's literal name when the phrase is
   blank. This needs little code but gives weak or misleading results for
   channel names such as House Math.
2. **Automatic niche discovery (chosen):** generate several distinct search
   phrases from the niche, show them to the user, and rotate one phrase per
   scheduled collection. Manual phrases remain exact, with no automatic
   expansion. This has more storage and validation work, but discovers a
   broader set of real video topics without raising API usage.

## User-facing behavior

- The add/edit form labels the field **Search phrase (optional)**. Entering a
  phrase creates/keeps **Track exact phrase** mode. Clearing it switches to
  **Explore niche automatically** mode. The selected mode is always visible.
- An automatic watchlist displays its current search plan, source
  (`local-model-generated`, `user-edited`, or `niche-name fallback`), last
  searched phrase, and next phrase. Users can edit/remove proposed phrases;
  the list must never become empty without a visible fallback.
- When a local Research model is configured, a deliberate local-only query
  generation request proposes 4–8 nonduplicate, bounded, specific YouTube
  searches from the niche name and optional description. It is a suggestion,
  not a claim of popularity. No YouTube videos or API credentials are sent to
  the model. The user can regenerate or edit the plan.
- A watchlist can still be saved and collected without any working AI model.
  In that case it uses the niche name as a clearly labeled fallback search
  until the user generates or edits a more useful plan. No cloud AI fallback.
- Existing watchlists retain their explicit phrase and manual mode, without
  losing their saved observations or history.

## Collector and storage

- Continue sending precisely **one** YouTube `search.list` query per run;
  scheduled and manual runs share the current durable budget (20 search calls
  in rolling 24 hours), at most 10 enabled watchlists, and daily refresh.
- Persist manual/automatic mode and an ordered, validated query plan. Advance
  the rotation cursor only after a completed successful run; failed runs use
  the same search until they succeed, without bypassing retry/backoff rules.
- Preserve the original `market_watchlists.query` constraint and existing
  records by adding additive schema fields/tables rather than a destructive
  SQLite table rebuild. In automatic mode, the existing `query` value serves
  as a nonempty compatibility fallback; the API represents the optional
  *manual* phrase as empty and exposes mode/plan separately.
- Store the effective searched phrase with each run for transparency. Keep
  observation freshness, 30-day expiration, rate-limit handling, source links,
  and policy restrictions unchanged.
- Changing niche name, manual phrase, or plan must update the next eligible
  collection without silently increasing the 24-hour budget or launching
  external collection while the watchlist is disabled.

## Boundaries and non-goals

- No scraper, hosted scheduler, paid vidIQ integration, new cloud provider, or
  automatic video publishing. No claims of real search demand, competitor CTR,
  RPM, earnings, or predicted views.
- The user's YouTube API key stays in the existing secure local credential
  path, never goes to the language model, and is never logged.
- Generated phrases are editorial search suggestions, not factual evidence.

## Acceptance checks

1. Create an automatic House Math watchlist with only a name; reload, edit,
   restart the server, and collect without an empty-query validation error.
2. When a local model is available, suggested queries are distinct and on
   topic; invalid model output is rejected, with a visible fallback that can
   still collect.
3. Different successful daily runs rotate queries; errors do not skip one;
   the YouTube API adapter receives the selected, nonempty phrase.
4. Create/edit an exact-phrase watchlist; it continues to search only that
   phrase. Existing pre-migration watchlists remain manual.
5. Disabled watchlists make no provider calls. Manual collection and automatic
   rotation never bypass the 20-calls/24h quota.
6. Web/UI tests, API/store/worker/provider fixture tests, TypeScript checks,
   production build, and relevant Rust tests pass locally; no live key needed.

## Implementation choice left to builder

Use the established local Research model settings and request validation,
existing Axum/SQLite migrations and job semantics, and the current watchlist
API. Keep all updates in one coherent PR without touching parallel Studio or
Evidence work.
