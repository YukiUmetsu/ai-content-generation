-- This is a project-owned draft registry, not a voice license or cast approval.
-- Each PUT validates every draft ID + project + character + immutable revision
-- against character_drafts before committing this bounded document.
CREATE TABLE character_voice_bindings (
    project_id TEXT NOT NULL PRIMARY KEY CHECK (length(project_id) BETWEEN 1 AND 160),
    revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 2147483647),
    registry_json TEXT NOT NULL CHECK (
        json_valid(registry_json) AND json_type(registry_json) = 'object' AND length(registry_json) <= 200000
    ),
    updated_at TEXT NOT NULL
) STRICT;
