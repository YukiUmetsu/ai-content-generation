-- Immutable click-time inputs and bounded per-stage results make a resumed
-- discovery run reproducible without repeating completed paid/quota work.
ALTER TABLE discovery_runs ADD COLUMN input_snapshot_json TEXT NOT NULL
    DEFAULT '{"version":0}' CHECK(json_valid(input_snapshot_json));

CREATE UNIQUE INDEX discovery_run_project_key ON discovery_runs(project_id,id);
CREATE TABLE discovery_run_artifacts (
    project_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    stage_key TEXT NOT NULL CHECK(length(stage_key) BETWEEN 2 AND 80),
    payload_json TEXT NOT NULL CHECK(json_valid(payload_json) AND length(payload_json) <= 80000),
    created_at INTEGER NOT NULL,
    PRIMARY KEY(run_id,stage_key),
    FOREIGN KEY(project_id,run_id) REFERENCES discovery_runs(project_id,id) ON DELETE CASCADE
) STRICT;
