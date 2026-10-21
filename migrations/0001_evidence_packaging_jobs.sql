-- 0001_evidence_packaging_jobs.sql
--
-- Shared foundation for three parallel lanes:
--   * research/evidence  -> source_records, source_versions, source_passages
--   * creative/packaging -> packaging_hypothesis_sets, packaging_metric_provenance
--   * jobs/artifacts     -> jobs, job_nodes, job_edges, job_attempts, artifact_manifests
--
-- Additive only. Every table is STRICT and every foreign key is RESTRICT so
-- provenance cannot be silently re-pointed or deleted. Application code owns
-- DAG cycle detection, provider consent, metric measurement and claim truth.

CREATE TABLE artifact_manifests (
    id TEXT NOT NULL PRIMARY KEY,
    schema_version INTEGER NOT NULL CHECK (schema_version = 1),
    digest_algorithm TEXT NOT NULL DEFAULT 'sha256'
        CHECK (digest_algorithm = 'sha256'),
    digest TEXT NOT NULL
        CHECK (length(digest) = 64 AND digest NOT GLOB '*[^0-9a-f]*'),
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
    media_type TEXT NOT NULL
        CHECK (length(trim(media_type)) > 0 AND instr(media_type, '/') > 1),
    producer_kind TEXT NOT NULL
        CHECK (producer_kind IN ('human', 'tool', 'model', 'renderer', 'import', 'unknown')),
    producer_name TEXT NOT NULL CHECK (length(trim(producer_name)) > 0),
    producer_version TEXT NOT NULL CHECK (length(trim(producer_version)) > 0),
    metadata_schema_version INTEGER NOT NULL DEFAULT 1
        CHECK (metadata_schema_version > 0),
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
    created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0),
    UNIQUE (digest_algorithm, digest)
) STRICT;

CREATE TABLE source_records (
    id TEXT NOT NULL PRIMARY KEY,
    schema_version INTEGER NOT NULL CHECK (schema_version = 1),
    source_kind TEXT NOT NULL
        CHECK (source_kind IN ('web', 'pdf', 'note', 'rss', 'repository', 'test', 'other')),
    canonical_uri TEXT NOT NULL CHECK (length(trim(canonical_uri)) > 0),
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    publisher TEXT,
    rights_status TEXT NOT NULL
        CHECK (rights_status IN ('unknown', 'cleared', 'restricted', 'denied')),
    metadata_schema_version INTEGER NOT NULL DEFAULT 1
        CHECK (metadata_schema_version > 0),
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
    created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0),
    UNIQUE (canonical_uri)
) STRICT;

CREATE TABLE source_versions (
    id TEXT NOT NULL PRIMARY KEY,
    schema_version INTEGER NOT NULL CHECK (schema_version = 1),
    source_id TEXT NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
    content_sha256 TEXT NOT NULL
        CHECK (length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'),
    retrieved_at TEXT NOT NULL CHECK (length(trim(retrieved_at)) > 0),
    media_type TEXT NOT NULL CHECK (length(trim(media_type)) > 0),
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
    parser_version TEXT NOT NULL CHECK (length(trim(parser_version)) > 0),
    raw_artifact_id TEXT REFERENCES artifact_manifests(id) ON DELETE RESTRICT,
    metadata_schema_version INTEGER NOT NULL DEFAULT 1
        CHECK (metadata_schema_version > 0),
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
    created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0),
    UNIQUE (source_id, content_sha256, parser_version)
) STRICT;

CREATE TABLE source_passages (
    id TEXT NOT NULL PRIMARY KEY,
    schema_version INTEGER NOT NULL CHECK (schema_version = 1),
    source_version_id TEXT NOT NULL REFERENCES source_versions(id) ON DELETE RESTRICT,
    passage_order INTEGER NOT NULL CHECK (passage_order >= 0),
    locator_kind TEXT NOT NULL
        CHECK (locator_kind IN ('page', 'line', 'char_offset', 'dom', 'timestamp', 'section')),
    locator_json TEXT NOT NULL
        CHECK (json_valid(locator_json) AND json_type(locator_json) = 'object'),
    language TEXT NOT NULL CHECK (length(trim(language)) > 0),
    body TEXT NOT NULL CHECK (length(trim(body)) > 0),
    body_sha256 TEXT NOT NULL
        CHECK (length(body_sha256) = 64 AND body_sha256 NOT GLOB '*[^0-9a-f]*'),
    created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0),
    UNIQUE (source_version_id, passage_order)
) STRICT;

CREATE TABLE packaging_hypothesis_sets (
    id TEXT NOT NULL PRIMARY KEY,
    schema_version INTEGER NOT NULL CHECK (schema_version = 1),
    project_ref TEXT NOT NULL CHECK (length(trim(project_ref)) > 0),
    status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'rejected')),
    premise_setup TEXT NOT NULL CHECK (length(trim(premise_setup)) > 0),
    premise_payoff TEXT NOT NULL CHECK (length(trim(premise_payoff)) > 0),
    hypothesis_count INTEGER NOT NULL CHECK (hypothesis_count BETWEEN 1 AND 3),
    document_json TEXT NOT NULL CHECK (json_valid(document_json)),
    document_sha256 TEXT NOT NULL
        CHECK (length(document_sha256) = 64 AND document_sha256 NOT GLOB '*[^0-9a-f]*'),
    created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0),
    approved_at TEXT,
    CHECK (json_extract(document_json, '$.schemaVersion') IS NOT NULL
        AND json_extract(document_json, '$.schemaVersion') = schema_version),
    CHECK (json_extract(document_json, '$.id') IS NOT NULL
        AND json_extract(document_json, '$.id') = id),
    CHECK (json_extract(document_json, '$.status') IS NOT NULL
        AND json_extract(document_json, '$.status') = status),
    CHECK (json_extract(document_json, '$.hypotheses') IS NOT NULL
        AND json_array_length(json_extract(document_json, '$.hypotheses')) = hypothesis_count),
    CHECK ((status = 'approved' AND approved_at IS NOT NULL)
        OR (status <> 'approved' AND approved_at IS NULL))
) STRICT;

CREATE TABLE packaging_metric_provenance (
    id TEXT NOT NULL PRIMARY KEY,
    hypothesis_set_id TEXT NOT NULL
        REFERENCES packaging_hypothesis_sets(id) ON DELETE RESTRICT,
    metric_key TEXT NOT NULL CHECK (length(trim(metric_key)) > 0),
    provenance TEXT NOT NULL
        CHECK (provenance IN ('measured', 'estimated', 'unknown')),
    value_type TEXT NOT NULL
        CHECK (value_type IN ('number', 'range', 'text', 'boolean', 'null')),
    numeric_value REAL,
    range_low REAL,
    range_high REAL,
    text_value TEXT,
    boolean_value INTEGER CHECK (boolean_value IS NULL OR boolean_value IN (0, 1)),
    unit TEXT,
    source_version_id TEXT REFERENCES source_versions(id) ON DELETE RESTRICT,
    observed_at TEXT,
    method TEXT,
    UNIQUE (hypothesis_set_id, metric_key),
    CHECK (
        (value_type = 'number' AND numeric_value IS NOT NULL AND range_low IS NULL
            AND range_high IS NULL AND text_value IS NULL AND boolean_value IS NULL)
        OR (value_type = 'range' AND numeric_value IS NULL AND range_low IS NOT NULL
            AND range_high IS NOT NULL AND range_low <= range_high
            AND text_value IS NULL AND boolean_value IS NULL)
        OR (value_type = 'text' AND numeric_value IS NULL AND range_low IS NULL
            AND range_high IS NULL AND text_value IS NOT NULL AND boolean_value IS NULL)
        OR (value_type = 'boolean' AND numeric_value IS NULL AND range_low IS NULL
            AND range_high IS NULL AND text_value IS NULL AND boolean_value IS NOT NULL)
        OR (value_type = 'null' AND numeric_value IS NULL AND range_low IS NULL
            AND range_high IS NULL AND text_value IS NULL AND boolean_value IS NULL)
    ),
    CHECK (
        (provenance = 'unknown' AND value_type = 'null'
            AND source_version_id IS NULL AND observed_at IS NULL)
        OR (provenance = 'measured' AND value_type <> 'null'
            AND source_version_id IS NOT NULL AND observed_at IS NOT NULL)
        OR (provenance = 'estimated' AND value_type <> 'null'
            AND method IS NOT NULL AND length(trim(method)) > 0)
    )
) STRICT;

CREATE TABLE jobs (
    id TEXT NOT NULL PRIMARY KEY,
    schema_version INTEGER NOT NULL CHECK (schema_version = 1),
    job_kind TEXT NOT NULL CHECK (length(trim(job_kind)) > 0),
    state TEXT NOT NULL
        CHECK (state IN ('PENDING', 'READY', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
    idempotency_key TEXT NOT NULL CHECK (length(trim(idempotency_key)) > 0),
    created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0),
    updated_at TEXT NOT NULL CHECK (length(trim(updated_at)) > 0),
    UNIQUE (idempotency_key)
) STRICT;

CREATE TABLE job_nodes (
    id TEXT NOT NULL PRIMARY KEY,
    schema_version INTEGER NOT NULL CHECK (schema_version = 1),
    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
    node_key TEXT NOT NULL CHECK (length(trim(node_key)) > 0),
    node_kind TEXT NOT NULL CHECK (length(trim(node_kind)) > 0),
    state TEXT NOT NULL
        CHECK (state IN ('PENDING', 'READY', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts INTEGER NOT NULL DEFAULT 3
        CHECK (max_attempts > 0 AND max_attempts <= 10),
    idempotency_key TEXT NOT NULL CHECK (length(trim(idempotency_key)) > 0),
    input_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(input_json)),
    output_json TEXT CHECK (output_json IS NULL OR json_valid(output_json)),
    error_code TEXT,
    created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0),
    updated_at TEXT NOT NULL CHECK (length(trim(updated_at)) > 0),
    UNIQUE (job_id, node_key),
    UNIQUE (job_id, idempotency_key),
    CHECK (attempt_count <= max_attempts)
) STRICT;

CREATE TABLE job_edges (
    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
    from_node_id TEXT NOT NULL REFERENCES job_nodes(id) ON DELETE RESTRICT,
    to_node_id TEXT NOT NULL REFERENCES job_nodes(id) ON DELETE RESTRICT,
    edge_kind TEXT NOT NULL DEFAULT 'dependency'
        CHECK (edge_kind IN ('dependency', 'data')),
    created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0),
    PRIMARY KEY (job_id, from_node_id, to_node_id),
    CHECK (from_node_id <> to_node_id)
) STRICT;

CREATE TABLE job_attempts (
    id TEXT NOT NULL PRIMARY KEY,
    node_id TEXT NOT NULL REFERENCES job_nodes(id) ON DELETE RESTRICT,
    attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
    idempotency_key TEXT NOT NULL CHECK (length(trim(idempotency_key)) > 0),
    state TEXT NOT NULL
        CHECK (state IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
    started_at TEXT NOT NULL CHECK (length(trim(started_at)) > 0),
    finished_at TEXT,
    error_code TEXT,
    error_detail TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
    created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0),
    UNIQUE (node_id, attempt_number),
    CHECK ((state = 'RUNNING' AND finished_at IS NULL)
        OR (state <> 'RUNNING' AND finished_at IS NOT NULL))
) STRICT;

CREATE INDEX idx_source_versions_source ON source_versions(source_id, retrieved_at DESC);
CREATE INDEX idx_source_passages_version ON source_passages(source_version_id, passage_order);
CREATE INDEX idx_packaging_sets_status ON packaging_hypothesis_sets(status, created_at DESC);
CREATE INDEX idx_packaging_metrics_set ON packaging_metric_provenance(hypothesis_set_id);
CREATE INDEX idx_jobs_state ON jobs(state, updated_at DESC);
CREATE INDEX idx_job_nodes_job_state ON job_nodes(job_id, state);
CREATE INDEX idx_job_edges_to ON job_edges(to_node_id);
CREATE INDEX idx_job_attempts_node ON job_attempts(node_id, attempt_number);

CREATE TRIGGER artifact_manifests_no_update
BEFORE UPDATE ON artifact_manifests
BEGIN
    SELECT RAISE(ABORT, 'artifact manifests are immutable and content-addressed');
END;

CREATE TRIGGER artifact_manifests_no_delete
BEFORE DELETE ON artifact_manifests
BEGIN
    SELECT RAISE(ABORT, 'artifact manifests are immutable and content-addressed');
END;

CREATE TRIGGER source_versions_no_update
BEFORE UPDATE ON source_versions
BEGIN
    SELECT RAISE(ABORT, 'source versions are immutable');
END;

CREATE TRIGGER source_versions_no_delete
BEFORE DELETE ON source_versions
BEGIN
    SELECT RAISE(ABORT, 'source versions are immutable');
END;

CREATE TRIGGER source_passages_no_update
BEFORE UPDATE ON source_passages
BEGIN
    SELECT RAISE(ABORT, 'source passages are immutable once captured');
END;

CREATE TRIGGER source_passages_no_delete
BEFORE DELETE ON source_passages
BEGIN
    SELECT RAISE(ABORT, 'source passages are immutable once captured');
END;

CREATE TRIGGER packaging_approved_no_update
BEFORE UPDATE ON packaging_hypothesis_sets
WHEN OLD.status = 'approved'
BEGIN
    SELECT RAISE(ABORT, 'approved packaging hypothesis sets are immutable');
END;

CREATE TRIGGER packaging_approved_no_delete
BEFORE DELETE ON packaging_hypothesis_sets
WHEN OLD.status = 'approved'
BEGIN
    SELECT RAISE(ABORT, 'approved packaging hypothesis sets are immutable');
END;

CREATE TRIGGER packaging_metric_no_update_when_approved
BEFORE UPDATE ON packaging_metric_provenance
WHEN (SELECT status FROM packaging_hypothesis_sets WHERE id = OLD.hypothesis_set_id) = 'approved'
BEGIN
    SELECT RAISE(ABORT, 'approved packaging metric provenance is immutable');
END;

CREATE TRIGGER packaging_metric_no_delete_when_approved
BEFORE DELETE ON packaging_metric_provenance
WHEN (SELECT status FROM packaging_hypothesis_sets WHERE id = OLD.hypothesis_set_id) = 'approved'
BEGIN
    SELECT RAISE(ABORT, 'approved packaging metric provenance is immutable');
END;

CREATE TRIGGER job_edges_same_job_insert
BEFORE INSERT ON job_edges
WHEN NEW.job_id <> (SELECT job_id FROM job_nodes WHERE id = NEW.from_node_id)
    OR NEW.job_id <> (SELECT job_id FROM job_nodes WHERE id = NEW.to_node_id)
BEGIN
    SELECT RAISE(ABORT, 'job edge nodes must belong to the same job');
END;

CREATE TRIGGER job_edges_same_job_update
BEFORE UPDATE OF job_id, from_node_id, to_node_id ON job_edges
WHEN NEW.job_id <> (SELECT job_id FROM job_nodes WHERE id = NEW.from_node_id)
    OR NEW.job_id <> (SELECT job_id FROM job_nodes WHERE id = NEW.to_node_id)
BEGIN
    SELECT RAISE(ABORT, 'job edge nodes must belong to the same job');
END;

CREATE TRIGGER job_attempts_retry_bound
BEFORE INSERT ON job_attempts
WHEN NEW.attempt_number > (SELECT max_attempts FROM job_nodes WHERE id = NEW.node_id)
BEGIN
    SELECT RAISE(ABORT, 'attempt exceeds the bounded retry limit');
END;

CREATE TRIGGER job_attempts_terminal_no_update
BEFORE UPDATE ON job_attempts
WHEN OLD.state IN ('SUCCEEDED', 'FAILED', 'CANCELLED')
BEGIN
    SELECT RAISE(ABORT, 'finished job attempts are immutable');
END;

CREATE TRIGGER job_attempts_no_delete
BEFORE DELETE ON job_attempts
BEGIN
    SELECT RAISE(ABORT, 'job attempts are audit records and cannot be deleted');
END;
