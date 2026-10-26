-- Every user click is a durable run; a partial unique index prevents doubles.
CREATE TABLE discovery_runs (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES discovery_projects(id) ON DELETE CASCADE,
    input_revision TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued','running','paused','completed','insufficient_evidence','failed','cancelled')),
    stage TEXT NOT NULL,
    provider_health_json TEXT NOT NULL DEFAULT '{}',
    error_code TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    finished_at INTEGER
) STRICT;
CREATE UNIQUE INDEX discovery_one_active ON discovery_runs(project_id)
    WHERE status IN ('queued','running','paused');
CREATE INDEX discovery_run_history ON discovery_runs(project_id,created_at DESC);

CREATE TABLE discovery_candidates (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES discovery_projects(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL REFERENCES discovery_runs(id) ON DELETE CASCADE,
    rank INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 5),
    title TEXT NOT NULL,
    hook TEXT NOT NULL,
    premise TEXT NOT NULL,
    why_now TEXT NOT NULL,
    angle_key TEXT NOT NULL,
    confidence TEXT NOT NULL CHECK(confidence IN ('low','medium','high')),
    source_ids_json TEXT NOT NULL CHECK(json_valid(source_ids_json)),
    decision TEXT CHECK(decision IN ('saved','dismissed','storyboard')),
    decision_reason TEXT,
    decision_at INTEGER,
    UNIQUE(run_id,rank)
) STRICT;
CREATE INDEX discovery_decisions ON discovery_candidates(project_id,decision);
