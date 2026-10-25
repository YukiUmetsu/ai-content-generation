# Idea-level public YouTube evidence (2026-10-25)

## Decision

Preserve `evidence-readiness-v1` in saved discovery sessions. Introduce a **separate**
opt-in measured YouTube comparison attached to each idea. Never reinterpret a
research-readiness score as demand, nor fabricate search volume, CTR, retention,
RPM, or a forecast. Existing YouTube Data API v3 client and local quota budget
are authoritative; no automated browser scraping.

## Workflow

1. In Select Idea, show an editable, visible search phrase and a `Measure on YouTube`
   action per idea. Disable it when the local YouTube key is not configured, and
   show a concrete explanation. The user explicitly starts every provider call.
2. One API `search.list` (+ batched detail lookups) returns up to 25 videos per
   idea, with observed time, views, upload time, format, and channel. Reserve a
   search against the existing rolling 24-hour budget before the network call.
   Retry manually after failures; preserve a safe error code and prior snapshots.
3. Persist immutable bounded observations and query/region/format, with 30-day
   expiry, and recover interrupted jobs on restart. Do not leak credentials or
   external provider errors to saved metadata or logs.
4. Select Idea displays sample coverage, median and 75th percentile of observed
   views, observed recent-upload count, channel diversity, and median *lifetime*
   views per day (not seven-day velocity). Link to individual public videos.
   Exclude missing view counts, mismatched formats, irrelevant titles and a
   fourth+ result from any single channel. State coverage limitations.
5. Only compare ideas with >=8 usable videos and >=3 channels, and >=3 eligible
   ideas in the **same format and session**. Rank by median lifetime views/day;
   use a smoothed within-session percentile, with ties sharing midrank. This is
   a comparative descriptive score, not a prediction or conversion probability.
   Incomplete evidence means `unknown`, not 50.

## Data providers

- YouTube: official Data API v3, existing local keychain credential, capped by
  ContentGen's shared 20-search/24h budget. UI is never authorized to pass a key.
- Google Trends: an *optional separate signal* only. Its official API remains
  limited-alpha; its values are relative indices, not monthly search counts.
  The community `gtrend-rs` crate relies on undocumented endpoints and may be
  throttled. Do not add it as a mandatory dependency or make scoring depend on
  it. If official API access is granted, add an independently versioned adapter.
- A headless browser can be used to visually inspect ContentGen UI; bulk
  programmatic YouTube page collection is excluded by YouTube terms.

## Verification

Test migration and restart, quota concurrency, missing key, wrong session ID,
irrelevant or short videos, missing dates/counts, dominance by one channel,
unknown/expired comparisons, tied rankings, and frontend progress/error states.
