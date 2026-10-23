-- Locally cached public YouTube observations; never store API keys here.
CREATE TABLE market_watchlists (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
    query TEXT NOT NULL CHECK(length(query) BETWEEN 3 AND 160),
    region TEXT NOT NULL CHECK(length(region) = 2),
    language TEXT NOT NULL CHECK(length(language) = 2),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    next_due_at INTEGER NOT NULL,
    last_finished_at INTEGER,
    backoff_until INTEGER NOT NULL DEFAULT 0,
    error_code TEXT
) STRICT;

CREATE TABLE market_runs (
    id TEXT PRIMARY KEY NOT NULL,
    watchlist_id TEXT NOT NULL REFERENCES market_watchlists(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK(state IN ('running', 'succeeded', 'failed')),
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    error_code TEXT,
    video_count INTEGER NOT NULL DEFAULT 0 CHECK(video_count >= 0)
) STRICT;
CREATE INDEX market_runs_watchlist ON market_runs(watchlist_id, started_at DESC);
CREATE UNIQUE INDEX market_one_active_run ON market_runs(watchlist_id) WHERE state = 'running';

-- Every reservation consumes one search.list call budget, even on failure.
CREATE TABLE market_search_budget (
    -- Intentionally independent of watchlists/runs: deleting a watchlist
    -- must not refund the daily API quota.
    run_id TEXT PRIMARY KEY NOT NULL,
    reserved_at INTEGER NOT NULL
) STRICT;
CREATE INDEX market_budget_time ON market_search_budget(reserved_at);

CREATE TABLE market_video_observations (
    run_id TEXT NOT NULL REFERENCES market_runs(id) ON DELETE CASCADE,
    watchlist_id TEXT NOT NULL REFERENCES market_watchlists(id) ON DELETE CASCADE,
    video_id TEXT NOT NULL,
    title TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    channel_title TEXT NOT NULL,
    published_at TEXT NOT NULL,
    duration_seconds INTEGER,
    view_count INTEGER,
    like_count INTEGER,
    comment_count INTEGER,
    subscriber_count INTEGER,
    observed_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (run_id, video_id),
    CHECK(view_count IS NULL OR view_count >= 0),
    CHECK(like_count IS NULL OR like_count >= 0),
    CHECK(comment_count IS NULL OR comment_count >= 0),
    CHECK(subscriber_count IS NULL OR subscriber_count >= 0)
) STRICT;
CREATE INDEX market_observation_fresh ON market_video_observations(watchlist_id, expires_at, observed_at DESC);
