-- Every extra official search call has an auditable reservation. The first
-- query continues to use idea_market_runs.query and its original reservation.
-- This table records subsequent search intents without changing old snapshots.
CREATE TABLE idea_market_search_queries (
    run_id TEXT NOT NULL REFERENCES idea_market_runs(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 1 AND 3),
    query TEXT NOT NULL CHECK(length(query) BETWEEN 3 AND 120),
    reserved_at INTEGER NOT NULL,
    result_count INTEGER CHECK(result_count BETWEEN 0 AND 25),
    error_code TEXT,
    PRIMARY KEY(run_id,ordinal)
) STRICT;
