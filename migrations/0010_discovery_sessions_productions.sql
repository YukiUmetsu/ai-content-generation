-- Durable research sessions are distinct from project/brand identity.
-- Legacy discovery runs remain intact and receive imported session links.
CREATE TABLE content_discovery_sessions (
    id TEXT NOT NULL PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES discovery_projects(id) ON DELETE RESTRICT,
    name TEXT NOT NULL DEFAULT '' CHECK(length(name) <= 160),
    platforms_json TEXT NOT NULL CHECK(json_valid(platforms_json) AND json_type(platforms_json) = 'array'),
    settings_snapshot_json TEXT NOT NULL CHECK(json_valid(settings_snapshot_json) AND json_type(settings_snapshot_json) = 'object'),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    archived_at INTEGER,
    UNIQUE(project_id,id)
) STRICT;
CREATE INDEX content_discovery_sessions_project ON content_discovery_sessions(project_id,created_at DESC);

ALTER TABLE discovery_runs ADD COLUMN session_id TEXT REFERENCES content_discovery_sessions(id) ON DELETE RESTRICT;

-- Do not guess which platform(s) were originally selected for legacy runs.
INSERT INTO content_discovery_sessions(id,project_id,name,platforms_json,settings_snapshot_json,created_at,updated_at)
SELECT 'legacy_'||id,project_id,'Imported discovery','[]',input_snapshot_json,created_at,updated_at
FROM discovery_runs;
UPDATE discovery_runs SET session_id='legacy_'||id WHERE session_id IS NULL;

DROP INDEX discovery_one_active;
CREATE UNIQUE INDEX discovery_one_active_session ON discovery_runs(session_id)
    WHERE status IN ('queued','running','paused');
CREATE INDEX discovery_runs_by_session ON discovery_runs(session_id,created_at DESC);

-- Legacy candidates remain immutable observations of individual runs, while
-- new sessions can retain more than five source-backed ideas per run.
DROP TRIGGER discovery_candidate_source_project_insert;
DROP TRIGGER discovery_candidate_source_project_update;
CREATE TABLE discovery_candidates_v10 (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES discovery_projects(id) ON DELETE RESTRICT,
    run_id TEXT NOT NULL REFERENCES discovery_runs(id) ON DELETE CASCADE,
    rank INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 100),
    title TEXT NOT NULL,
    hook TEXT NOT NULL,
    premise TEXT NOT NULL,
    why_now TEXT NOT NULL,
    angle_key TEXT NOT NULL,
    confidence TEXT NOT NULL CHECK(confidence IN ('low','medium','high')),
    source_ids_json TEXT NOT NULL CHECK(json_valid(source_ids_json)),
    decision TEXT CHECK(decision IN ('saved','dismissed','storyboard','selected')),
    decision_reason TEXT,
    decision_at INTEGER,
    UNIQUE(run_id,rank),
    UNIQUE(project_id,id)
) STRICT;
INSERT INTO discovery_candidates_v10
SELECT id,project_id,run_id,rank,title,hook,premise,why_now,angle_key,confidence,source_ids_json,
       decision,decision_reason,decision_at FROM discovery_candidates;
DROP TABLE discovery_candidates;
ALTER TABLE discovery_candidates_v10 RENAME TO discovery_candidates;
CREATE INDEX discovery_decisions ON discovery_candidates(project_id,decision);

CREATE TRIGGER discovery_candidate_source_project_insert BEFORE INSERT ON discovery_candidates
WHEN EXISTS(SELECT 1 FROM json_each(NEW.source_ids_json) j
    WHERE j.type!='text' OR NOT EXISTS(SELECT 1 FROM kg_sources s
        WHERE s.id=j.value AND s.project_id=NEW.project_id))
BEGIN SELECT RAISE(ABORT,'candidate cites foreign or missing source'); END;
CREATE TRIGGER discovery_candidate_source_project_update BEFORE UPDATE OF project_id,source_ids_json ON discovery_candidates
WHEN EXISTS(SELECT 1 FROM json_each(NEW.source_ids_json) j
    WHERE j.type!='text' OR NOT EXISTS(SELECT 1 FROM kg_sources s
        WHERE s.id=j.value AND s.project_id=NEW.project_id))
BEGIN SELECT RAISE(ABORT,'candidate cites foreign or missing source'); END;

-- Freeze a small source summary with each candidate so a later graph refresh
-- cannot silently change the evidence presented for this discovery.
CREATE TABLE discovery_candidate_sources (
    candidate_id TEXT NOT NULL REFERENCES discovery_candidates(id) ON DELETE RESTRICT,
    source_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    observed_at INTEGER NOT NULL,
    published_at TEXT,
    evidence_state TEXT NOT NULL CHECK(evidence_state IN ('lead_only','captured')),
    passage TEXT,
    PRIMARY KEY(candidate_id,source_id)
) STRICT;
INSERT INTO discovery_candidate_sources(candidate_id,source_id,provider,url,title,observed_at,published_at,evidence_state,passage)
SELECT c.id,s.id,s.provider,s.url,s.title,s.observed_at,s.published_at,s.evidence_state,substr(s.passage,1,1000)
FROM discovery_candidates c
JOIN json_each(c.source_ids_json) j ON j.type='text'
JOIN kg_sources s ON s.id=j.value AND s.project_id=c.project_id;

CREATE TABLE content_productions (
    id TEXT NOT NULL PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES discovery_projects(id) ON DELETE RESTRICT,
    session_id TEXT NOT NULL,
    idea_id TEXT NOT NULL,
    brief_json TEXT NOT NULL CHECK(json_valid(brief_json) AND json_type(brief_json)='object'),
    platforms_json TEXT NOT NULL CHECK(json_valid(platforms_json) AND json_type(platforms_json)='array'),
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','in_progress','ready','archived')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(project_id,session_id) REFERENCES content_discovery_sessions(project_id,id) ON DELETE RESTRICT,
    FOREIGN KEY(project_id,idea_id) REFERENCES discovery_candidates(project_id,id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX content_productions_by_project ON content_productions(project_id,created_at DESC);
CREATE INDEX content_productions_by_session ON content_productions(session_id,created_at DESC);
CREATE TRIGGER production_idea_session_insert BEFORE INSERT ON content_productions
WHEN NOT EXISTS(SELECT 1 FROM discovery_candidates c
    JOIN discovery_runs r ON r.id=c.run_id
    WHERE c.id=NEW.idea_id AND c.project_id=NEW.project_id AND r.session_id=NEW.session_id)
BEGIN SELECT RAISE(ABORT,'production idea does not belong to the discovery session'); END;
