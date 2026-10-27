-- Imported ZIPs are immutable, project-scoped drafts. Project IDs come from
-- the browser's authoritative local catalog, which is not guaranteed to be
-- mirrored into discovery_projects before the import happens.
CREATE TABLE character_drafts (
    id TEXT NOT NULL PRIMARY KEY,
    project_id TEXT NOT NULL CHECK (length(project_id) BETWEEN 1 AND 120),
    character_id TEXT NOT NULL CHECK (length(character_id) BETWEEN 1 AND 80),
    revision TEXT NOT NULL CHECK (length(revision) BETWEEN 1 AND 64),
    archive_artifact_id TEXT NOT NULL REFERENCES artifact_manifests(id) ON DELETE RESTRICT,
    archive_sha256 TEXT NOT NULL CHECK (length(archive_sha256) = 64),
    size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 22 AND 16777216),
    status TEXT NOT NULL DEFAULT 'unverified' CHECK (status = 'unverified'),
    created_at TEXT NOT NULL,
    UNIQUE (project_id, character_id, revision)
) STRICT;
CREATE INDEX character_drafts_by_project ON character_drafts(project_id, created_at DESC);
CREATE TRIGGER character_drafts_no_update BEFORE UPDATE ON character_drafts
BEGIN SELECT RAISE(ABORT, 'character drafts are immutable'); END;
CREATE TRIGGER character_drafts_no_delete BEFORE DELETE ON character_drafts
BEGIN SELECT RAISE(ABORT, 'character drafts are immutable'); END;
