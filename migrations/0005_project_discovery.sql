-- Project-specific discovery mirror. The browser catalog remains authoritative.
CREATE TABLE discovery_projects (
    id TEXT NOT NULL PRIMARY KEY,
    name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
    notes TEXT NOT NULL DEFAULT '' CHECK(length(notes) <= 8000),
    snapshot_revision INTEGER NOT NULL CHECK(snapshot_revision >= 0),
    synced_at INTEGER NOT NULL
) STRICT;

CREATE TABLE discovery_project_content (
    project_id TEXT NOT NULL REFERENCES discovery_projects(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL,
    stage TEXT NOT NULL,
    created_at TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
    last_seen_at INTEGER NOT NULL,
    PRIMARY KEY(project_id, id)
) STRICT;
CREATE INDEX discovery_content_current ON discovery_project_content(project_id, active, stage);

CREATE TABLE discovery_project_keywords (
    id TEXT NOT NULL PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES discovery_projects(id) ON DELETE CASCADE,
    text TEXT NOT NULL CHECK(length(text) BETWEEN 2 AND 160),
    normalized TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('topic', 'query', 'exclusion')),
    origin TEXT NOT NULL CHECK(origin IN ('manual', 'model')),
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
    manual_lock INTEGER NOT NULL DEFAULT 0 CHECK(manual_lock IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(project_id, kind, normalized)
) STRICT;

-- Existing global watchlists are *never* automatically assigned to a project.
CREATE TABLE discovery_project_watchlists (
    project_id TEXT NOT NULL REFERENCES discovery_projects(id) ON DELETE CASCADE,
    watchlist_id TEXT NOT NULL REFERENCES market_watchlists(id) ON DELETE CASCADE,
    PRIMARY KEY(project_id, watchlist_id)
) STRICT;
