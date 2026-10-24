# YouTube Intelligence: Search-first Explore
Date: 2026-10-23
Spec: user-approved search-first redesign from the ContentGen conversation.

## Behavior contract
- Explore is the default. One explicit user search fetches up to 25 public YouTube videos without a saved watchlist, SearXNG, or local LLM.
- Search requires an existing YouTube API key, uses the existing credential adapter, one shared 20-search/24h reservation, and the shared market semaphore.
- Input is a bounded safe 3–160 character keyword. Provider errors are sanitized. Results remain ephemeral; no direct-search video/metadata persistence.
- Explore offers client-side sample filters for publication date, minimum views, minimum channel subscribers, and sorting. Label these as filters of returned results, not comprehensive YouTube popularity/market metrics. Do not invent missing values.
- Save a query into a disabled watchlist explicitly, or save a linked video as an editable idea. Monitor remains available with all prior functionality. Local AI suggestions remain optional and confined to Monitor.
- Honor Japanese labels, keyboard/form/aria, empty/loading/error and no-key states.

## Plan
1. Add red tests for Explore as the default, explicit search with no watchlist/model request, filter and save actions. Existing monitoring tests should choose Monitor. Validate first failures are missing functionality.
2. Add red Rust tests for atomic standalone reservations reusing market_search_budget, daily cap, query validation and no watchlist persistence.
3. Implement Rust POST /api/research/market/explore; reuse YouTubeClient::collect; serialize observations as existing MarketVideoRecord; shared semaphore, budget and safe errors. No migration.
4. Extend typed frontend client with request and strict response parser; build Explore component; wire Explore/Monitor switch. Keep existing monitor logic and optional AI intact.
5. Run Rust and frontend tests/typecheck/build, lint, fmt/clippy where possible; inspect CI, review changes. If local private repository cannot be materialized, disclose what ran and use CI for authoritative verification.

## Review focus
- Untrusted query/credential never leaks in logs/errors or uncontrolled outbound URLs.
- Atomic budget reservations cannot race with watchlist workers.
- No surprise API calls on load, no watchlist/LLM dependency, and no direct-search persistence.
- Unknown counts remain unknown; filters only apply to bounded returned sample, and stale responses don't win.
- Existing Monitor workflows and EN/JA UI remain functional.
