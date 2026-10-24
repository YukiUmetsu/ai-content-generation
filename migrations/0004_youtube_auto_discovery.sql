-- Additive extension: retain existing watchlists, quotas and observations.
ALTER TABLE market_watchlists ADD COLUMN query_mode TEXT NOT NULL DEFAULT 'manual'
    CHECK(query_mode IN ('manual', 'auto'));
ALTER TABLE market_watchlists ADD COLUMN query_plan_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE market_watchlists ADD COLUMN query_plan_source TEXT NOT NULL DEFAULT 'user-edited';
ALTER TABLE market_watchlists ADD COLUMN query_index INTEGER NOT NULL DEFAULT 0
    CHECK(query_index >= 0);
ALTER TABLE market_watchlists ADD COLUMN query_plan_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE market_watchlists ADD COLUMN last_search_query TEXT;
ALTER TABLE market_runs ADD COLUMN effective_query TEXT;
ALTER TABLE market_runs ADD COLUMN query_plan_revision INTEGER NOT NULL DEFAULT 0;
