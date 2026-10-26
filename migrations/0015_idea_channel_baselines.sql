-- Public channel uploads from the official channels/uploads-playlist APIs.
-- These are dated immutable observations and are not YouTube impressions.
CREATE TABLE idea_market_channel_baselines (
    run_id TEXT NOT NULL REFERENCES idea_market_runs(id) ON DELETE CASCADE,
    video_id TEXT NOT NULL,
    title TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    channel_title TEXT NOT NULL,
    published_at TEXT NOT NULL,
    duration_seconds INTEGER,
    view_count INTEGER,
    observed_at INTEGER NOT NULL,
    PRIMARY KEY(run_id,video_id)
) STRICT;
CREATE INDEX idea_market_channel_baseline_channel ON idea_market_channel_baselines(run_id,channel_id);
