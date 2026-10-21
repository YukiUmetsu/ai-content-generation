use std::collections::{BTreeMap, BTreeSet};

use axum::body::Body;
use axum::http::{Request, StatusCode};
use contentgen_core::artifacts::{
    ArtifactManifest, ArtifactProducer, DigestAlgorithm, ProducerKind,
};
use contentgen_core::evidence::{
    EvidenceBundle, PassageLocator, SourcePassage, SourceRecord, SourceVersion,
};
use contentgen_core::jobs::{
    AttemptState, EdgeKind, Job, JobAttempt, JobDag, JobEdge, JobNode, JobState,
};
use contentgen_core::packaging::PackagingHypothesisSet;
use contentgen_core::{Validate, sha256_hex};
use contentgen_server::{AppState, build_router, db};
use http_body_util::BodyExt;
use rusqlite::Connection;
use serde::de::DeserializeOwned;
use serde_json::Value;
use tower::ServiceExt;

const SEED_SQL: &str = include_str!("../../../fixtures/foundation/seed.sql");
const ARTIFACT_BYTES: &[u8] = include_bytes!("../../../fixtures/foundation/artifact-bytes.txt");

fn migrated() -> Connection {
    let mut connection = db::open_in_memory().expect("open in-memory database");
    db::migrate(&mut connection).expect("apply migrations");
    connection
}

fn table_names(connection: &Connection) -> BTreeSet<String> {
    let mut statement = connection
        .prepare(
            "SELECT name FROM sqlite_master
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )
        .unwrap();
    statement
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

fn column_names(connection: &Connection, table: &str) -> BTreeSet<String> {
    let mut statement = connection
        .prepare("SELECT name FROM pragma_table_info(?1)")
        .unwrap();
    statement
        .query_map([table], |row| row.get::<_, String>(0))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

fn trigger_names(connection: &Connection) -> BTreeSet<String> {
    let mut statement = connection
        .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
        .unwrap();
    statement
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

fn count(connection: &Connection, table: &str) -> i64 {
    connection
        .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .unwrap()
}

fn parse_enum<T: DeserializeOwned>(value: &str) -> T {
    serde_json::from_value(Value::String(value.to_owned())).unwrap()
}

fn parse_json<T: DeserializeOwned>(value: &str) -> T {
    serde_json::from_str(value).unwrap()
}

fn read_artifact(connection: &Connection) -> ArtifactManifest {
    connection
        .query_row(
            "SELECT id, schema_version, digest_algorithm, digest, size_bytes, media_type,
                    producer_kind, producer_name, producer_version, created_at, metadata_json
             FROM artifact_manifests WHERE id = ?1",
            ["art_foundation_sample_v1"],
            |row| {
                let digest_algorithm: DigestAlgorithm = parse_enum(&row.get::<_, String>(2)?);
                let producer_kind: ProducerKind = parse_enum(&row.get::<_, String>(6)?);
                let metadata: BTreeMap<String, Value> = parse_json(&row.get::<_, String>(10)?);
                Ok(ArtifactManifest {
                    schema_version: row.get(1)?,
                    id: row.get(0)?,
                    digest_algorithm,
                    digest: row.get(3)?,
                    size_bytes: row.get::<_, i64>(4)? as u64,
                    media_type: row.get(5)?,
                    producer: ArtifactProducer {
                        kind: producer_kind,
                        name: row.get(7)?,
                        version: row.get(8)?,
                    },
                    created_at: row.get(9)?,
                    metadata,
                })
            },
        )
        .unwrap()
}

fn read_evidence(connection: &Connection) -> EvidenceBundle {
    let (source, version, passages) = connection
        .query_row(
            "SELECT id, schema_version, source_kind, canonical_uri, title, publisher,
                    rights_status, created_at, metadata_json
             FROM source_records WHERE id = ?1",
            ["src_house_cost_fixture"],
            |row| {
                let source = SourceRecord {
                    schema_version: row.get(1)?,
                    id: row.get(0)?,
                    source_kind: parse_enum(&row.get::<_, String>(2)?),
                    canonical_uri: row.get(3)?,
                    title: row.get(4)?,
                    publisher: row.get(5)?,
                    rights_status: parse_enum(&row.get::<_, String>(6)?),
                    created_at: row.get(7)?,
                    metadata: parse_json(&row.get::<_, String>(8)?),
                };
                let version = connection
                    .query_row(
                        "SELECT id, schema_version, source_id, content_sha256, retrieved_at,
                                media_type, byte_size, parser_version, raw_artifact_id,
                                created_at, metadata_json
                         FROM source_versions WHERE source_id = ?1
                         ORDER BY retrieved_at DESC LIMIT 1",
                        [source.id.as_str()],
                        |row| {
                            Ok(SourceVersion {
                                schema_version: row.get(1)?,
                                id: row.get(0)?,
                                source_id: row.get(2)?,
                                content_sha256: row.get(3)?,
                                retrieved_at: row.get(4)?,
                                media_type: row.get(5)?,
                                byte_size: row.get::<_, i64>(6)? as u64,
                                parser_version: row.get(7)?,
                                raw_artifact_id: row.get(8)?,
                                created_at: row.get(9)?,
                                metadata: parse_json(&row.get::<_, String>(10)?),
                            })
                        },
                    )
                    .unwrap();
                let mut statement = connection
                    .prepare(
                        "SELECT id, schema_version, source_version_id, passage_order,
                                locator_json, language, body, body_sha256, created_at
                         FROM source_passages WHERE source_version_id = ?1
                         ORDER BY passage_order",
                    )
                    .unwrap();
                let passages: Vec<SourcePassage> = statement
                    .query_map([version.id.as_str()], |row| {
                        let locator: PassageLocator = parse_json(&row.get::<_, String>(4)?);
                        Ok(SourcePassage {
                            schema_version: row.get(1)?,
                            id: row.get(0)?,
                            source_version_id: row.get(2)?,
                            passage_order: row.get(3)?,
                            locator,
                            language: row.get(5)?,
                            body: row.get(6)?,
                            body_sha256: row.get(7)?,
                            created_at: row.get(8)?,
                        })
                    })
                    .unwrap()
                    .map(Result::unwrap)
                    .collect();
                Ok((source, version, passages))
            },
        )
        .unwrap();
    EvidenceBundle {
        schema_version: 1,
        source,
        version,
        passages,
    }
}

fn read_job_dag(connection: &Connection) -> JobDag {
    let job = connection
        .query_row(
            "SELECT id, schema_version, job_kind, state, idempotency_key, created_at, updated_at
             FROM jobs WHERE id = ?1",
            ["job_foundation_fixture_v1"],
            |row| {
                Ok(Job {
                    schema_version: row.get(1)?,
                    id: row.get(0)?,
                    job_kind: row.get(2)?,
                    state: parse_enum(&row.get::<_, String>(3)?),
                    idempotency_key: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            },
        )
        .unwrap();

    let mut node_statement = connection
        .prepare(
            "SELECT id, schema_version, job_id, node_key, node_kind, state, attempt_count,
                    max_attempts, idempotency_key, input_json, output_json, error_code,
                    created_at, updated_at
             FROM job_nodes WHERE job_id = ?1 ORDER BY id",
        )
        .unwrap();
    let nodes: Vec<JobNode> = node_statement
        .query_map([job.id.as_str()], |row| {
            let output: Option<String> = row.get(10)?;
            Ok(JobNode {
                schema_version: row.get(1)?,
                id: row.get(0)?,
                job_id: row.get(2)?,
                node_key: row.get(3)?,
                node_kind: row.get(4)?,
                state: parse_enum(&row.get::<_, String>(5)?),
                attempt_count: row.get(6)?,
                max_attempts: row.get(7)?,
                idempotency_key: row.get(8)?,
                input: parse_json(&row.get::<_, String>(9)?),
                output: output.map(|value| parse_json(&value)),
                error_code: row.get(11)?,
                created_at: row.get(12)?,
                updated_at: row.get(13)?,
            })
        })
        .unwrap()
        .map(Result::unwrap)
        .collect();

    let mut edge_statement = connection
        .prepare(
            "SELECT job_id, from_node_id, to_node_id, edge_kind, created_at
             FROM job_edges WHERE job_id = ?1 ORDER BY from_node_id, to_node_id",
        )
        .unwrap();
    let edges: Vec<JobEdge> = edge_statement
        .query_map([job.id.as_str()], |row| {
            Ok(JobEdge {
                job_id: row.get(0)?,
                from_node_id: row.get(1)?,
                to_node_id: row.get(2)?,
                edge_kind: parse_enum(&row.get::<_, String>(3)?),
                created_at: row.get(4)?,
            })
        })
        .unwrap()
        .map(Result::unwrap)
        .collect();

    let mut attempt_statement = connection
        .prepare(
            "SELECT id, node_id, attempt_number, idempotency_key, state, started_at,
                    finished_at, error_code, error_detail, metadata_json, created_at
             FROM job_attempts
             WHERE node_id IN (SELECT id FROM job_nodes WHERE job_id = ?1)
             ORDER BY id",
        )
        .unwrap();
    let attempts: Vec<JobAttempt> = attempt_statement
        .query_map([job.id.as_str()], |row| {
            Ok(JobAttempt {
                id: row.get(0)?,
                node_id: row.get(1)?,
                attempt_number: row.get(2)?,
                idempotency_key: row.get(3)?,
                state: parse_enum(&row.get::<_, String>(4)?),
                started_at: row.get(5)?,
                finished_at: row.get(6)?,
                error_code: row.get(7)?,
                error_detail: row.get(8)?,
                metadata: parse_json(&row.get::<_, String>(9)?),
                created_at: row.get(10)?,
            })
        })
        .unwrap()
        .map(Result::unwrap)
        .collect();

    JobDag {
        schema_version: 1,
        job,
        nodes,
        edges,
        attempts,
    }
}

#[test]
fn migrations_apply_in_order_to_fresh_database() {
    let mut connection = db::open_in_memory().unwrap();
    let foreign_keys: i64 = connection
        .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
        .unwrap();
    assert_eq!(foreign_keys, 1, "connections must enable foreign keys");

    let report = db::migrate(&mut connection).unwrap();
    assert_eq!(report.from_version, 0);
    assert_eq!(report.to_version, 1);
    assert_eq!(report.applied, vec![1]);
    assert_eq!(db::user_version(&connection).unwrap(), 1);

    let (name, checksum): (String, String) = connection
        .query_row(
            "SELECT name, checksum FROM schema_migrations WHERE version = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(name, "0001_evidence_packaging_jobs");
    assert_eq!(checksum, db::MIGRATIONS[0].checksum());

    let expected_tables: BTreeSet<String> = [
        "artifact_manifests",
        "job_attempts",
        "job_edges",
        "job_nodes",
        "jobs",
        "packaging_hypothesis_sets",
        "packaging_metric_provenance",
        "schema_migrations",
        "source_passages",
        "source_records",
        "source_versions",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect();
    assert_eq!(table_names(&connection), expected_tables);

    let expected_source_version_columns: BTreeSet<String> = [
        "id",
        "schema_version",
        "source_id",
        "content_sha256",
        "retrieved_at",
        "media_type",
        "byte_size",
        "parser_version",
        "raw_artifact_id",
        "metadata_schema_version",
        "metadata_json",
        "created_at",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect();
    assert_eq!(
        column_names(&connection, "source_versions"),
        expected_source_version_columns
    );
    assert!(column_names(&connection, "job_attempts").contains("idempotency_key"));
    assert!(column_names(&connection, "artifact_manifests").contains("digest"));
    assert!(column_names(&connection, "packaging_hypothesis_sets").contains("premise_setup"));
    assert!(column_names(&connection, "packaging_metric_provenance").contains("provenance"));

    let triggers = trigger_names(&connection);
    for expected in [
        "artifact_manifests_no_update",
        "source_versions_no_update",
        "source_passages_no_update",
        "packaging_approved_no_update",
        "packaging_metric_no_update_when_approved",
        "job_edges_same_job_insert",
        "job_attempts_retry_bound",
        "job_attempts_terminal_no_update",
    ] {
        assert!(triggers.contains(expected), "missing trigger {expected}");
    }

    let second = db::migrate(&mut connection).unwrap();
    assert_eq!(second.from_version, 1);
    assert_eq!(second.to_version, 1);
    assert!(second.applied.is_empty());

    let integrity: String = connection
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .unwrap();
    assert_eq!(integrity, "ok");
    let violations: i64 = connection
        .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(violations, 0);
}

#[test]
fn migration_rejects_tampered_checksums_and_newer_schemas() {
    let mut connection = migrated();
    connection
        .execute(
            "UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 1",
            [],
        )
        .unwrap();
    let error = db::migrate(&mut connection).unwrap_err();
    assert!(matches!(
        error,
        db::DbError::ChecksumMismatch { version: 1, .. }
    ));

    let mut newer = db::open_in_memory().unwrap();
    newer.pragma_update(None, "user_version", 2).unwrap();
    let error = db::migrate(&mut newer).unwrap_err();
    assert!(matches!(
        error,
        db::DbError::UnsupportedSchemaVersion {
            found: 2,
            supported: 1
        }
    ));
}

#[test]
fn fixture_inserts_and_reads_without_network() {
    let connection = migrated();
    connection.execute_batch(SEED_SQL).unwrap();

    assert_eq!(count(&connection, "artifact_manifests"), 1);
    assert_eq!(count(&connection, "source_records"), 1);
    assert_eq!(count(&connection, "source_versions"), 1);
    assert_eq!(count(&connection, "source_passages"), 1);
    assert_eq!(count(&connection, "packaging_hypothesis_sets"), 1);
    assert_eq!(count(&connection, "packaging_metric_provenance"), 4);
    assert_eq!(count(&connection, "jobs"), 1);
    assert_eq!(count(&connection, "job_nodes"), 3);
    assert_eq!(count(&connection, "job_edges"), 2);
    assert_eq!(count(&connection, "job_attempts"), 2);

    let manifest = read_artifact(&connection);
    manifest.validate().unwrap();
    manifest.verify_bytes(ARTIFACT_BYTES).unwrap();
    assert_eq!(manifest.digest, sha256_hex(ARTIFACT_BYTES));

    let evidence = read_evidence(&connection);
    evidence.validate().unwrap();
    assert_eq!(evidence.passages.len(), 1);
    assert_eq!(
        evidence.passages[0].locator,
        PassageLocator::Page { page: 1 }
    );

    let (document_json, document_sha): (String, String) = connection
        .query_row(
            "SELECT document_json, document_sha256
             FROM packaging_hypothesis_sets WHERE id = ?1",
            ["pkg_house_cost_fixture_v1"],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(document_sha, sha256_hex(document_json.as_bytes()));
    let packaging: PackagingHypothesisSet = parse_json(&document_json);
    packaging.validate().unwrap();
    assert_eq!(packaging.hypotheses.len(), 3);
    assert_ne!(
        packaging.hypotheses[0].strategy,
        packaging.hypotheses[1].strategy
    );
    assert_ne!(
        packaging.hypotheses[0].strategy,
        packaging.hypotheses[2].strategy
    );
    assert_ne!(
        packaging.hypotheses[1].strategy,
        packaging.hypotheses[2].strategy
    );

    let job = read_job_dag(&connection);
    job.validate().unwrap();
    assert_eq!(job.nodes.len(), 3);
    assert_eq!(job.edges.len(), 2);
    assert_eq!(job.attempts.len(), 2);
    assert!(matches!(job.job.state, JobState::Running));
    assert!(
        job.attempts
            .iter()
            .any(|attempt| matches!(attempt.state, AttemptState::Succeeded))
    );
    assert!(matches!(job.edges[0].edge_kind, EdgeKind::Dependency));
}

#[test]
fn schema_rejects_unsourced_metrics_and_mutating_provenance() {
    let connection = migrated();
    connection.execute_batch(SEED_SQL).unwrap();

    let artifact_update = connection.execute(
        "UPDATE artifact_manifests SET media_type = 'text/html'
         WHERE id = 'art_foundation_sample_v1'",
        [],
    );
    assert!(artifact_update.is_err(), "artifact manifests are immutable");

    let source_update = connection.execute(
        "UPDATE source_versions SET parser_version = 'tampered'
         WHERE id = 'srcv_house_cost_fixture_1'",
        [],
    );
    assert!(source_update.is_err(), "source versions are immutable");

    let approved_update = connection.execute(
        "UPDATE packaging_hypothesis_sets SET status = 'draft'
         WHERE id = 'pkg_house_cost_fixture_v1'",
        [],
    );
    assert!(
        approved_update.is_err(),
        "approved packaging sets are immutable"
    );

    let unsourced_metric = connection.execute(
        "INSERT INTO packaging_metric_provenance
            (id, hypothesis_set_id, metric_key, provenance, value_type, numeric_value)
         VALUES ('pkgmetric_unsourced', 'pkg_house_cost_fixture_v1',
                 'unsourced', 'measured', 'number', 1.0)",
        [],
    );
    assert!(
        unsourced_metric.is_err(),
        "measured metrics require a source and observation time"
    );

    let unknown_with_value = connection.execute(
        "INSERT INTO packaging_metric_provenance
            (id, hypothesis_set_id, metric_key, provenance, value_type, numeric_value)
         VALUES ('pkgmetric_unknown_value', 'pkg_house_cost_fixture_v1',
                 'unknown_with_value', 'unknown', 'number', 1.0)",
        [],
    );
    assert!(
        unknown_with_value.is_err(),
        "unknown metrics must not carry a value"
    );

    let uppercase_digest = "A".repeat(64);
    let bad_digest = connection.execute(
        "INSERT INTO artifact_manifests
            (id, schema_version, digest_algorithm, digest, size_bytes, media_type,
             producer_kind, producer_name, producer_version, metadata_schema_version,
             metadata_json, created_at)
         VALUES ('art_bad_digest', 1, 'sha256', ?1, 1, 'text/plain',
                 'tool', 'fixture', '1', 1, '{}', '2026-10-21T00:00:00Z')",
        [uppercase_digest],
    );
    assert!(bad_digest.is_err(), "digests must be lowercase SHA-256 hex");

    connection
        .execute(
            "INSERT INTO jobs
                (id, schema_version, job_kind, state, idempotency_key, created_at, updated_at)
             VALUES ('job_other', 1, 'other', 'PENDING', 'job-other', 
                     '2026-10-21T00:00:00Z', '2026-10-21T00:00:00Z')",
            [],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO job_nodes
                (id, schema_version, job_id, node_key, node_kind, state, attempt_count,
                 max_attempts, idempotency_key, input_json, created_at, updated_at)
             VALUES ('node_other', 1, 'job_other', 'other', 'other', 'PENDING', 0,
                     1, 'node-other', '{}', '2026-10-21T00:00:00Z', '2026-10-21T00:00:00Z')",
            [],
        )
        .unwrap();
    let cross_job_edge = connection.execute(
        "INSERT INTO job_edges (job_id, from_node_id, to_node_id, edge_kind, created_at)
         VALUES ('job_foundation_fixture_v1', 'node_research_fixture', 'node_other',
                 'dependency', '2026-10-21T00:00:00Z')",
        [],
    );
    assert!(cross_job_edge.is_err(), "edges must stay inside one job");

    let retry_overflow = connection.execute(
        "INSERT INTO job_attempts
            (id, node_id, attempt_number, idempotency_key, state, started_at, finished_at,
             metadata_json, created_at)
         VALUES ('attempt_overflow', 'node_research_fixture', 4, 'attempt-overflow',
                 'SUCCEEDED', '2026-10-21T00:00:00Z', '2026-10-21T00:00:01Z', '{}',
                 '2026-10-21T00:00:00Z')",
        [],
    );
    assert!(retry_overflow.is_err(), "retries are bounded");
}

#[tokio::test]
async fn router_registers_lane_stubs_and_health() {
    let app = build_router(AppState::new(":memory:"));

    for (path, feature) in [
        ("/api/research/evidence", "research.evidence"),
        ("/api/creative/packaging", "creative.packaging"),
        ("/api/jobs", "jobs.artifacts"),
    ] {
        let response = app
            .clone()
            .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_IMPLEMENTED);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let body: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["error"]["code"], "not_implemented");
        assert_eq!(body["error"]["feature"], feature);
    }

    let response = app
        .oneshot(
            Request::builder()
                .uri("/healthz")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["status"], "ok");
    assert_eq!(body["service"], "contentgen-server");
}
