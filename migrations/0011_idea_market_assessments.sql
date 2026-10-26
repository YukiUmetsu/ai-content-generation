-- One opt-in YouTube search per saved idea. Reservations share the existing
-- market_search_budget and cannot be refunded by deleting a local snapshot.
CREATE TABLE idea_market_runs (
    id TEXT PRIMARY KEY NOT NULL,
    idea_id TEXT NOT NULL REFERENCES discovery_candidates(id) ON DELETE RESTRICT,
    query TEXT NOT NULL CHECK(length(query) BETWEEN 3 AND 120),
    format TEXT NOT NULL CHECK(format IN ('long','shorts')),
    metric_version TEXT NOT NULL CHECK(metric_version='youtube-comparables-v1'),
    region TEXT NOT NULL CHECK(region='US'),
    language TEXT NOT NULL CHECK(language='en'),
    state TEXT NOT NULL CHECK(state IN ('running','succeeded','failed')),
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    error_code TEXT,
    searched_videos INTEGER NOT NULL DEFAULT 0 CHECK(searched_videos BETWEEN 0 AND 25)
) STRICT;
CREATE INDEX idea_market_by_idea ON idea_market_runs(idea_id,started_at DESC,id DESC);
CREATE UNIQUE INDEX idea_market_one_running ON idea_market_runs(idea_id) WHERE state='running';

CREATE TABLE idea_market_videos (
    run_id TEXT NOT NULL REFERENCES idea_market_runs(id) ON DELETE CASCADE,
    video_id TEXT NOT NULL,
    title TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    channel_title TEXT NOT NULL,
    published_at TEXT NOT NULL,
    duration_seconds INTEGER,
    view_count INTEGER,
    observed_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY(run_id,video_id),
    CHECK(view_count IS NULL OR view_count >= 0)
) STRICT;
CREATE INDEX idea_market_video_expiry ON idea_market_videos(expires_at);
