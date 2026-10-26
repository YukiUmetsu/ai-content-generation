-- Immutable public counters collected from videos.list at distinct times.
-- They measure observed changes, not extrapolated daily growth.
CREATE TABLE idea_video_view_snapshots (
    video_id TEXT NOT NULL,
    observed_at INTEGER NOT NULL,
    view_count INTEGER NOT NULL CHECK(view_count>=0),
    PRIMARY KEY(video_id,observed_at)
) STRICT;
CREATE INDEX idea_video_snapshots_time ON idea_video_view_snapshots(observed_at);

-- An independent bounded allowance for cheap videos.list counter refreshes;
-- does NOT consume the shared search.list quota pool.
CREATE TABLE idea_video_refresh_reservations (
    id TEXT PRIMARY KEY NOT NULL,
    reserved_at INTEGER NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('running','succeeded','failed')),
    error_code TEXT
) STRICT;
CREATE INDEX idea_video_refresh_recent ON idea_video_refresh_reservations(reserved_at);
