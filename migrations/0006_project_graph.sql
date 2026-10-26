-- Project-owned evidence graph; numeric observations are dated and nullable.
CREATE TABLE kg_nodes (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES discovery_projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('topic','entity','question','event','source','content')),
    label TEXT NOT NULL,
    normalized TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(project_id,kind,normalized)
) STRICT;
CREATE INDEX kg_nodes_project_kind ON kg_nodes(project_id,kind);
CREATE VIRTUAL TABLE kg_node_search USING fts5(project_id UNINDEXED,node_id UNINDEXED,label,tokenize='unicode61');

CREATE TABLE kg_node_aliases (
    project_id TEXT NOT NULL REFERENCES discovery_projects(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL REFERENCES kg_nodes(id) ON DELETE CASCADE,
    normalized TEXT NOT NULL,
    alias TEXT NOT NULL,
    PRIMARY KEY(project_id, normalized)
) STRICT;

CREATE TABLE kg_sources (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES discovery_projects(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    published_at TEXT,
    observed_at INTEGER NOT NULL,
    passage TEXT,
    evidence_state TEXT NOT NULL CHECK(evidence_state IN ('lead_only','captured')),
    UNIQUE(project_id,provider,url)
) STRICT;

CREATE TABLE kg_edges (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES discovery_projects(id) ON DELETE CASCADE,
    from_node_id TEXT NOT NULL REFERENCES kg_nodes(id) ON DELETE CASCADE,
    to_node_id TEXT NOT NULL REFERENCES kg_nodes(id) ON DELETE CASCADE,
    relation TEXT NOT NULL CHECK(relation IN ('subtopic_of','related_to','affects','raises_question','mentions','covered_by')),
    status TEXT NOT NULL CHECK(status IN ('supported','hypothesized','rejected')),
    origin TEXT NOT NULL DEFAULT 'imported' CHECK(origin IN ('manual','imported','ai_inferred')),
    created_at INTEGER NOT NULL,
    UNIQUE(project_id,from_node_id,to_node_id,relation)
) STRICT;

CREATE TABLE kg_edge_evidence (
    edge_id TEXT NOT NULL REFERENCES kg_edges(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES kg_sources(id) ON DELETE CASCADE,
    assessment TEXT NOT NULL CHECK(assessment IN ('supports','contradicts','unknown')),
    passage_locator TEXT,
    PRIMARY KEY(edge_id,source_id)
) STRICT;

CREATE TABLE kg_trend_observations (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES discovery_projects(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL REFERENCES kg_nodes(id) ON DELETE CASCADE,
    source_id TEXT REFERENCES kg_sources(id) ON DELETE SET NULL,
    provider TEXT NOT NULL,
    metric TEXT NOT NULL,
    value REAL,
    unit TEXT NOT NULL,
    region TEXT,
    window_start TEXT,
    window_end TEXT,
    collected_at INTEGER NOT NULL,
    CHECK(value IS NULL OR value >= 0)
) STRICT;
CREATE INDEX kg_signals_project ON kg_trend_observations(project_id,node_id,metric,collected_at DESC);
