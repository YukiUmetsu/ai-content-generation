-- Revision-checked, nonsecret scene speaker assignments keyed to the exact
-- compiled source storyboard. Voice consent and provider credentials are never stored.
CREATE TABLE project_scene_cast (
    project_id TEXT NOT NULL CHECK (length(project_id) BETWEEN 1 AND 160),
    source_plan_sha256 TEXT NOT NULL CHECK (length(source_plan_sha256) = 64),
    revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 2147483647),
    cast_json TEXT NOT NULL CHECK (
        json_valid(cast_json) AND json_type(cast_json) = 'object' AND length(cast_json) <= 80000
    ),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (project_id, source_plan_sha256)
) STRICT;
