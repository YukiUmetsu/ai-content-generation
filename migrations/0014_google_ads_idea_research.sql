-- Optional Google Ads data reflects Google Search demand, never YouTube demand.
-- OAuth refresh tokens/access tokens must NEVER be persisted in these tables.
CREATE TABLE google_ads_idea_runs (
    id TEXT PRIMARY KEY NOT NULL,
    idea_id TEXT NOT NULL REFERENCES discovery_candidates(id) ON DELETE RESTRICT,
    query TEXT NOT NULL CHECK(length(query) BETWEEN 3 AND 120),
    state TEXT NOT NULL CHECK(state IN ('succeeded','failed')),
    observed_at INTEGER NOT NULL,
    error_code TEXT
) STRICT;
CREATE INDEX google_ads_idea_latest ON google_ads_idea_runs(idea_id,observed_at DESC);

CREATE TABLE google_ads_keyword_observations (
    run_id TEXT NOT NULL REFERENCES google_ads_idea_runs(id) ON DELETE CASCADE,
    keyword TEXT NOT NULL CHECK(length(keyword) BETWEEN 3 AND 120),
    close_variants_json TEXT NOT NULL,
    monthly_google_searches INTEGER CHECK(monthly_google_searches IS NULL OR monthly_google_searches >= 0),
    advertiser_competition TEXT CHECK(advertiser_competition IS NULL OR advertiser_competition IN ('LOW','MEDIUM','HIGH')),
    low_top_page_bid_micros INTEGER,
    high_top_page_bid_micros INTEGER,
    PRIMARY KEY(run_id,keyword)
) STRICT;
