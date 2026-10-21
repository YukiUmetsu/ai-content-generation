-- PROPOSED additive schema for research, SEO intelligence and analytics.
-- Requires the baseline entities in examples/core-schema.sql; NOT an applied migration.
-- Use ordered, versioned migrations in actual Rust implementation.
PRAGMA foreign_keys = ON;

CREATE TABLE research_collections (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 name TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 visibility TEXT NOT NULL DEFAULT 'project' CHECK(visibility IN ('project','brand','workspace')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE research_collection_sources (
 collection_id TEXT NOT NULL REFERENCES research_collections(id) ON DELETE CASCADE,
 source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
 added_at TEXT NOT NULL,
 PRIMARY KEY(collection_id, source_id)
);
CREATE TABLE research_notes (
 id TEXT PRIMARY KEY,
 collection_id TEXT NOT NULL REFERENCES research_collections(id) ON DELETE CASCADE,
 source_snapshot_id TEXT REFERENCES source_snapshots(id) ON DELETE SET NULL,
 locator_json TEXT NOT NULL DEFAULT '{}', text TEXT NOT NULL,
 author_kind TEXT NOT NULL CHECK(author_kind IN ('user','agent')),
 status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE source_snapshots (
 id TEXT PRIMARY KEY,
 source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
 normalized_sha256 TEXT NOT NULL,
 normalization_version TEXT NOT NULL,
 retrieved_at TEXT NOT NULL,
 language TEXT,
 raw_artifact_id TEXT REFERENCES artifacts(id),
 rights_json TEXT NOT NULL DEFAULT '{}',
 extraction_json TEXT NOT NULL DEFAULT '{}',
 UNIQUE(source_id, normalization_version, normalized_sha256)
);
CREATE INDEX idx_source_snapshots_source_date ON source_snapshots(source_id, retrieved_at DESC);
CREATE TABLE source_passages (
 id INTEGER PRIMARY KEY,
 snapshot_id TEXT NOT NULL REFERENCES source_snapshots(id) ON DELETE CASCADE,
 passage_order INTEGER NOT NULL CHECK(passage_order >= 0),
 locator_json TEXT NOT NULL,
 body TEXT NOT NULL,
 content_sha256 TEXT NOT NULL,
 language TEXT,
 UNIQUE(snapshot_id, passage_order)
);
CREATE INDEX idx_source_passages_snapshot ON source_passages(snapshot_id, passage_order);
-- Search FTS first. Rebuildable derived index, not source of truth.
CREATE VIRTUAL TABLE source_passages_fts USING fts5(
 body, content='source_passages', content_rowid='id', tokenize='unicode61'
);
CREATE TRIGGER sp_ai AFTER INSERT ON source_passages BEGIN
 INSERT INTO source_passages_fts(rowid, body) VALUES(new.id, new.body);
END;
CREATE TRIGGER sp_ad AFTER DELETE ON source_passages BEGIN
 INSERT INTO source_passages_fts(source_passages_fts, rowid, body)
 VALUES('delete', old.id, old.body);
END;
CREATE TRIGGER sp_au AFTER UPDATE OF body ON source_passages BEGIN
 INSERT INTO source_passages_fts(source_passages_fts, rowid, body)
 VALUES('delete', old.id, old.body);
 INSERT INTO source_passages_fts(rowid, body) VALUES(new.id, new.body);
END;
CREATE TABLE research_questions (
 id TEXT PRIMARY KEY,
 collection_id TEXT NOT NULL REFERENCES research_collections(id) ON DELETE CASCADE,
 question TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
 created_at TEXT NOT NULL, resolved_at TEXT
);
CREATE TABLE research_runs (
 id TEXT PRIMARY KEY,
 collection_id TEXT REFERENCES research_collections(id),
 project_id TEXT NOT NULL REFERENCES projects(id),
 objective TEXT NOT NULL, provider TEXT,
 started_at TEXT NOT NULL, finished_at TEXT, state TEXT NOT NULL,
 budget_json TEXT NOT NULL DEFAULT '{}', result_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE research_run_evidence (
 run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
 passage_id INTEGER NOT NULL REFERENCES source_passages(id) ON DELETE RESTRICT,
 role TEXT NOT NULL, PRIMARY KEY(run_id, passage_id, role)
);

CREATE TABLE seo_keywords (
 id TEXT PRIMARY KEY,
 phrase TEXT NOT NULL,
 normalized_phrase TEXT NOT NULL,
 locale TEXT NOT NULL,
 country TEXT NOT NULL,
 search_engine TEXT NOT NULL DEFAULT 'google',
 intent TEXT, first_seen_at TEXT NOT NULL,
 UNIQUE(normalized_phrase, locale, country, search_engine)
);
CREATE TABLE seo_metric_snapshots (
 id TEXT PRIMARY KEY,
 keyword_id TEXT NOT NULL REFERENCES seo_keywords(id) ON DELETE RESTRICT,
 provider TEXT NOT NULL, provider_metric_schema TEXT NOT NULL,
 observed_at TEXT NOT NULL, region TEXT NOT NULL, device TEXT NOT NULL DEFAULT 'unspecified',
 search_volume INTEGER CHECK(search_volume IS NULL OR search_volume >= 0),
 volume_period TEXT, cpc_micros INTEGER, currency TEXT,
 paid_competition REAL CHECK(paid_competition IS NULL OR (paid_competition >= 0 AND paid_competition <= 1)),
 provider_organic_difficulty REAL,
 raw_artifact_id TEXT REFERENCES artifacts(id),
 details_json TEXT NOT NULL DEFAULT '{}',
 UNIQUE(keyword_id, provider, provider_metric_schema, observed_at, region, device)
);
CREATE INDEX idx_seo_keyword_metrics ON seo_metric_snapshots(keyword_id, observed_at DESC);
CREATE TABLE seo_serp_snapshots (
 id TEXT PRIMARY KEY,
 keyword_id TEXT NOT NULL REFERENCES seo_keywords(id) ON DELETE RESTRICT,
 provider TEXT NOT NULL, observed_at TEXT NOT NULL, device TEXT NOT NULL,
 location_code TEXT, response_sha256 TEXT NOT NULL,
 details_json TEXT NOT NULL DEFAULT '{}',
 UNIQUE(keyword_id, provider, observed_at, device, response_sha256)
);
CREATE TABLE seo_serp_results (
 snapshot_id TEXT NOT NULL REFERENCES seo_serp_snapshots(id) ON DELETE CASCADE,
 result_index INTEGER NOT NULL CHECK(result_index >= 1),
 result_kind TEXT NOT NULL, target_url TEXT, title TEXT, snippet TEXT,
 PRIMARY KEY(snapshot_id, result_index, result_kind)
);
CREATE TABLE seo_clusters (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
 locale TEXT NOT NULL, name TEXT NOT NULL, intent TEXT,
 status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL
);
CREATE TABLE seo_cluster_keywords (
 cluster_id TEXT NOT NULL REFERENCES seo_clusters(id) ON DELETE CASCADE,
 keyword_id TEXT NOT NULL REFERENCES seo_keywords(id),
 role TEXT NOT NULL DEFAULT 'supporting',
 PRIMARY KEY(cluster_id, keyword_id)
);
CREATE TABLE seo_content_targets (
 id TEXT PRIMARY KEY,
 cluster_id TEXT NOT NULL REFERENCES seo_clusters(id),
 topic_id TEXT REFERENCES topics(id), content_id TEXT REFERENCES contents(id),
 target_kind TEXT NOT NULL, intent_json TEXT NOT NULL DEFAULT '{}',
 status TEXT NOT NULL DEFAULT 'planned', reviewed_at TEXT
);
CREATE INDEX idx_seo_content_targets_content ON seo_content_targets(content_id);

CREATE TABLE analytics_import_runs (
 id TEXT PRIMARY KEY,
 provider TEXT NOT NULL, account_scope TEXT NOT NULL,
 period_start TEXT NOT NULL, period_end TEXT NOT NULL,
 status TEXT NOT NULL, completeness TEXT NOT NULL DEFAULT 'unknown',
 details_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE TABLE metric_observations (
 id TEXT PRIMARY KEY,
 import_run_id TEXT REFERENCES analytics_import_runs(id),
 content_id TEXT REFERENCES contents(id),
 provider TEXT NOT NULL, channel TEXT NOT NULL,
 metric TEXT NOT NULL, unit TEXT NOT NULL,
 window_start TEXT NOT NULL, window_end TEXT NOT NULL,
 dimensions_json TEXT NOT NULL DEFAULT '{}',
 dimensions_sha256 TEXT NOT NULL,
 value REAL NOT NULL, observed_at TEXT NOT NULL,
 UNIQUE(provider, channel, metric, window_start, window_end, dimensions_sha256, observed_at)
);
CREATE INDEX idx_metric_observations_content ON metric_observations(content_id, window_start DESC);
CREATE TABLE content_experiments (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id),
 content_id TEXT REFERENCES contents(id),
 hypothesis TEXT NOT NULL, target_metric TEXT NOT NULL,
 assignment_method TEXT NOT NULL, state TEXT NOT NULL,
 start_at TEXT, end_at TEXT,
 decision_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE experiment_variants (
 id TEXT PRIMARY KEY,
 experiment_id TEXT NOT NULL REFERENCES content_experiments(id) ON DELETE CASCADE,
 label TEXT NOT NULL, content_version_id TEXT REFERENCES content_versions(id),
 thumbnail_version_id TEXT REFERENCES thumbnail_versions(id),
 variant_json TEXT NOT NULL DEFAULT '{}',
 UNIQUE(experiment_id, label)
);
