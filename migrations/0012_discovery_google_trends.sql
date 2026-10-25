-- Google Trends is a best-effort, unofficial provider of NORMALIZED search
-- interest (0-100). Each time series is scaled separately: values must never
-- be used as absolute volume or ranked directly against another query.
-- Reservations are durable to bound provider traffic even across restarts.
CREATE TABLE idea_trends_runs (
    id TEXT PRIMARY KEY NOT NULL,
    idea_id TEXT NOT NULL REFERENCES discovery_candidates(id) ON DELETE RESTRICT,
    query TEXT NOT NULL CHECK(length(query) BETWEEN 3 AND 120),
    metric_version TEXT NOT NULL CHECK(metric_version='google-trends-momentum-v1'),
    region TEXT NOT NULL CHECK(region='US'),
    state TEXT NOT NULL CHECK(state IN ('running','succeeded','failed','unavailable')),
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    observed_at INTEGER,
    error_code TEXT,
    points INTEGER NOT NULL DEFAULT 0 CHECK(points BETWEEN 0 AND 60),
    previous_mean REAL,
    recent_mean REAL,
    change_percent REAL,
    CHECK(previous_mean IS NULL OR previous_mean BETWEEN 0 AND 100),
    CHECK(recent_mean IS NULL OR recent_mean BETWEEN 0 AND 100)
) STRICT;
CREATE INDEX idea_trends_by_idea ON idea_trends_runs(idea_id,started_at DESC,id DESC);
CREATE INDEX idea_trends_by_time ON idea_trends_runs(started_at);
CREATE UNIQUE INDEX idea_trends_one_running ON idea_trends_runs(idea_id) WHERE state='running';

CREATE TABLE idea_trends_points (
    run_id TEXT NOT NULL REFERENCES idea_trends_runs(id) ON DELETE CASCADE,
    timestamp INTEGER NOT NULL,
    normalized_interest INTEGER NOT NULL CHECK(normalized_interest BETWEEN 0 AND 100),
    PRIMARY KEY(run_id,timestamp)
) STRICT;
