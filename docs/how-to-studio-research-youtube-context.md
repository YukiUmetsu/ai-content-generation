# Reuse accumulated YouTube videos in Studio Research

In the full local Studio (the web UI with the Rust API server), open **Research → Evidence**.
Type a subject into **Search stored evidence**, or open Research while a named video
project is active. ContentGen automatically looks for matching video titles across
**all existing local YouTube watchlists**. This is a local SQLite lookup: it does not
contact YouTube, require a configured API key for reads, or spend an API search call.

The **Related YouTube videos** cards show each video's original title and channel,
publication date, public views, duration, capturing watchlist, observation date,
matched topic words and an original YouTube link. Select up to five references,
optionally edit the audience, question, payoff and narrative approach, then select
**Create video project → Storyboard**.

The new project stores **only the selected YouTube links** as inspiration notes. It
does not copy provider statistics into the generated storyboard, quote competitor
scripts, automatically verify claims, render media or publish a video. Use the
independent evidence research workflow for factual verification.

If no videos are cached, open **Research → YouTube Intelligence**, add a watchlist,
explicitly enable it and collect while your local Rust server runs with
`CONTENTGEN_YOUTUBE_API_KEY` configured. The suggested heat-pump query is an easy
starting point, but the UI does **not** invent sample market data. Only unexpired
observations are displayed (the collector's retention limit is 30 days).

## Verification

From the repository root:

```bash
cargo test -p contentgen-server --test market_store --test market_api
pnpm --dir apps/web run test
pnpm --dir apps/web run lint
pnpm --dir apps/web run build
```

The automatic video context differs from the opt-in SearXNG source capture engine:
YouTube titles and views are **creative references**, not source-backed factual
evidence or estimates of future video performance.
