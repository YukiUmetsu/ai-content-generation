-- Project IDs are owned by the browser catalog until the project graph is
-- fully migrated. A foreign key to discovery_projects would lose valid voices.
-- Revision 0 denotes no server record; writes must compare the prior revision.
CREATE TABLE project_voice_favorites (
    project_id TEXT NOT NULL PRIMARY KEY CHECK (length(project_id) BETWEEN 1 AND 160),
    revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 2147483647),
    library_json TEXT NOT NULL CHECK (
        json_valid(library_json) AND json_type(library_json) = 'object' AND length(library_json) <= 16384
    ),
    updated_at TEXT NOT NULL
) STRICT;
