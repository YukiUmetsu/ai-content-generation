use contentgen_core::artifacts::{ArtifactManifest, ArtifactProducer, DigestAlgorithm, sha256_hex};
use contentgen_core::evidence::{EvidenceBundle, PassageLocator};
use contentgen_core::jobs::{JobDag, JobEdge};
use contentgen_core::packaging::{
    MetricProvenance, MetricProvenanceKind, MetricValue, PackagingHypothesisSet, PackagingStrategy,
};
use contentgen_core::{DomainError, Validate};
use serde_json::json;

const ARTIFACT_JSON: &str = include_str!("../../../fixtures/foundation/artifact-manifest.json");
const ARTIFACT_BYTES: &[u8] = include_bytes!("../../../fixtures/foundation/artifact-bytes.txt");
const EVIDENCE_JSON: &str = include_str!("../../../fixtures/foundation/evidence-bundle.json");
const PACKAGING_JSON: &str =
    include_str!("../../../fixtures/foundation/packaging-hypothesis-set.json");
const JOB_JSON: &str = include_str!("../../../fixtures/foundation/job-dag.json");

fn artifact_fixture() -> ArtifactManifest {
    serde_json::from_str(ARTIFACT_JSON).expect("artifact fixture parses")
}

fn evidence_fixture() -> EvidenceBundle {
    serde_json::from_str(EVIDENCE_JSON).expect("evidence fixture parses")
}

fn packaging_fixture() -> PackagingHypothesisSet {
    serde_json::from_str(PACKAGING_JSON).expect("packaging fixture parses")
}

fn job_dag_fixture() -> JobDag {
    serde_json::from_str(JOB_JSON).expect("job fixture parses")
}

#[test]
fn fixture_documents_round_trip_and_validate() {
    let artifact = artifact_fixture();
    artifact.validate().expect("artifact fixture is valid");
    artifact
        .verify_bytes(ARTIFACT_BYTES)
        .expect("artifact fixture digest matches its bytes");
    let artifact_round_trip: ArtifactManifest =
        serde_json::from_str(&serde_json::to_string(&artifact).unwrap()).unwrap();
    assert_eq!(artifact, artifact_round_trip);

    let evidence = evidence_fixture();
    evidence.validate().expect("evidence fixture is valid");
    let evidence_round_trip: EvidenceBundle =
        serde_json::from_str(&serde_json::to_string(&evidence).unwrap()).unwrap();
    assert_eq!(evidence, evidence_round_trip);

    let packaging = packaging_fixture();
    packaging.validate().expect("packaging fixture is valid");
    assert_eq!(packaging.hypotheses.len(), 3);
    assert_eq!(
        packaging
            .hypotheses
            .iter()
            .map(|hypothesis| hypothesis.strategy)
            .collect::<std::collections::HashSet<_>>()
            .len(),
        3
    );
    let packaging_round_trip: PackagingHypothesisSet =
        serde_json::from_str(&serde_json::to_string(&packaging).unwrap()).unwrap();
    assert_eq!(packaging, packaging_round_trip);

    let job = job_dag_fixture();
    job.validate().expect("job DAG fixture is valid");
    let job_round_trip: JobDag =
        serde_json::from_str(&serde_json::to_string(&job).unwrap()).unwrap();
    assert_eq!(job, job_round_trip);
}

#[test]
fn artifact_manifest_rejects_non_content_addressed_values() {
    let mut manifest = artifact_fixture();
    manifest.digest = manifest.digest.to_uppercase();
    assert!(matches!(
        manifest.validate(),
        Err(DomainError::InvalidDigest { .. })
    ));

    let mut manifest = artifact_fixture();
    manifest.digest = "abc".to_owned();
    assert!(matches!(
        manifest.validate(),
        Err(DomainError::InvalidDigest { .. })
    ));

    let mut manifest = artifact_fixture();
    manifest.media_type = "not-a-media-type".to_owned();
    assert!(matches!(
        manifest.validate(),
        Err(DomainError::InvalidMediaType { .. })
    ));

    let mut manifest = artifact_fixture();
    manifest.digest = sha256_hex(b"different bytes");
    assert!(matches!(
        manifest.verify_bytes(ARTIFACT_BYTES),
        Err(DomainError::RuleViolation { .. })
    ));

    let manifest = ArtifactManifest::for_bytes(
        "art_computed_v1",
        "text/plain",
        ArtifactProducer {
            kind: contentgen_core::ProducerKind::Tool,
            name: "test".to_owned(),
            version: "1".to_owned(),
        },
        "2026-10-21T00:00:00Z",
        b"content",
    );
    manifest.validate().unwrap();
    assert_eq!(manifest.digest, sha256_hex(b"content"));
    assert_eq!(manifest.digest_algorithm, DigestAlgorithm::Sha256);
}

#[test]
fn rejects_unsupported_schema_versions() {
    let mut artifact = artifact_fixture();
    artifact.schema_version = 2;
    assert!(matches!(
        artifact.validate(),
        Err(DomainError::UnsupportedSchemaVersion { .. })
    ));

    let mut evidence = evidence_fixture();
    evidence.schema_version = 0;
    assert!(matches!(
        evidence.validate(),
        Err(DomainError::UnsupportedSchemaVersion { .. })
    ));

    let mut packaging = packaging_fixture();
    packaging.schema_version = 2;
    assert!(matches!(
        packaging.validate(),
        Err(DomainError::UnsupportedSchemaVersion { .. })
    ));

    let mut job = job_dag_fixture();
    job.schema_version = 2;
    assert!(matches!(
        job.validate(),
        Err(DomainError::UnsupportedSchemaVersion { .. })
    ));
}

#[test]
fn timestamps_accept_only_one_canonical_utc_form() {
    // Only `YYYY-MM-DDTHH:MM:SSZ` is accepted: one spelling per instant so
    // string comparisons and SQLite TEXT ordering agree.
    for rejected in [
        "2026-10-21T00:00:00.500Z",
        "2026-10-21T00:00:00+00:00",
        "2026-10-21T00:00:00z",
        "2026-10-21 00:00:00Z",
        "2026-02-30T00:00:00Z",
        "2026-10-21T24:00:00Z",
        "2026-10-21T00:00:60Z",
    ] {
        let mut job = job_dag_fixture();
        job.job.updated_at = rejected.to_owned();
        assert!(
            matches!(job.validate(), Err(DomainError::InvalidTimestamp { .. })),
            "{rejected} must be rejected as a non-canonical timestamp"
        );
    }

    // A same-second fraction is now impossible, so equality and ordering of the
    // accepted form agree with chronological order.
    let mut job = job_dag_fixture();
    job.job.updated_at = job.job.created_at.clone();
    job.validate()
        .expect("equal timestamps are ordered, not reversed");

    let mut job = job_dag_fixture();
    job.attempts[0].finished_at = Some(job.attempts[0].started_at.clone());
    job.validate().expect("equal attempt timestamps are valid");

    let mut packaging = packaging_fixture();
    packaging.approved_at = Some(packaging.created_at.clone());
    packaging
        .validate()
        .expect("approval at the creation second is valid");
}

#[test]
fn evidence_rejects_broken_locators_and_provenance_links() {
    let mut evidence = evidence_fixture();
    evidence.source.title.clear();
    assert!(matches!(
        evidence.validate(),
        Err(DomainError::EmptyField { .. })
    ));

    let mut evidence = evidence_fixture();
    evidence.version.content_sha256 = "not-a-digest".to_owned();
    assert!(matches!(
        evidence.validate(),
        Err(DomainError::InvalidDigest { .. })
    ));

    let mut evidence = evidence_fixture();
    evidence.version.retrieved_at = "2026-10-21 00:00:00".to_owned();
    assert!(matches!(
        evidence.validate(),
        Err(DomainError::InvalidTimestamp { .. })
    ));

    let mut evidence = evidence_fixture();
    evidence.passages[0].locator = PassageLocator::CharOffset { start: 10, end: 10 };
    assert!(matches!(
        evidence.validate(),
        Err(DomainError::RuleViolation { .. })
    ));

    let mut evidence = evidence_fixture();
    evidence.passages[0].source_version_id = "srcv_other".to_owned();
    assert!(matches!(
        evidence.validate(),
        Err(DomainError::RuleViolation { .. })
    ));

    let mut evidence = evidence_fixture();
    evidence
        .source
        .metadata
        .insert("api_key".to_owned(), json!("should-not-be-stored"));
    assert!(matches!(
        evidence.validate(),
        Err(DomainError::SecretMaterial { .. })
    ));

    let mut evidence = evidence_fixture();
    evidence.passages[0].body.push_str(" tampered");
    assert!(
        matches!(evidence.validate(), Err(DomainError::RuleViolation { .. })),
        "a passage body must match its committed digest"
    );
}

#[test]
fn packaging_rejects_unattributed_or_invented_metrics() {
    let mut packaging = packaging_fixture();
    packaging.metrics[2].source_version_id = None;
    assert!(matches!(
        packaging.validate(),
        Err(DomainError::RuleViolation { .. })
    ));

    let mut packaging = packaging_fixture();
    packaging.metrics[3].value = MetricValue::Number { value: 1.0 };
    assert!(matches!(
        packaging.validate(),
        Err(DomainError::RuleViolation { .. })
    ));

    let mut packaging = packaging_fixture();
    packaging.metrics[0].method = None;
    assert!(matches!(
        packaging.validate(),
        Err(DomainError::RuleViolation { .. })
    ));

    let mut packaging = packaging_fixture();
    packaging.metrics[0].metric_key = "viral_score".to_owned();
    assert!(matches!(
        packaging.validate(),
        Err(DomainError::ForbiddenMetric { .. })
    ));

    let mut packaging = packaging_fixture();
    packaging.metrics[0].value = MetricValue::Number {
        value: f64::INFINITY,
    };
    assert!(matches!(
        packaging.validate(),
        Err(DomainError::NonFiniteNumber { .. })
    ));

    let mut packaging = packaging_fixture();
    packaging.metrics[0].provenance = MetricProvenanceKind::Measured;
    packaging.metrics[0].observed_at = Some("2026-10-21T00:00:00Z".to_owned());
    packaging.metrics[0].source_version_id = Some("srcv_house_cost_fixture_1".to_owned());
    packaging.metrics[0].value = MetricValue::Number { value: 500000.0 };
    packaging
        .validate()
        .expect("measured metric with provenance is valid");

    let measured_without_source: MetricProvenance = MetricProvenance {
        metric_key: "measured_but_unsourced".to_owned(),
        provenance: MetricProvenanceKind::Measured,
        value: MetricValue::Text {
            value: "42".to_owned(),
        },
        unit: None,
        source_version_id: None,
        observed_at: Some("2026-10-21T00:00:00Z".to_owned()),
        method: None,
    };
    assert!(matches!(
        measured_without_source.validate(),
        Err(DomainError::RuleViolation { .. })
    ));
}

#[test]
fn packaging_rejects_three_hypotheses_that_are_not_distinct() {
    let mut packaging = packaging_fixture();
    packaging.hypotheses.pop();
    assert!(matches!(
        packaging.validate(),
        Err(DomainError::RuleViolation { .. })
    ));

    let mut packaging = packaging_fixture();
    packaging.hypotheses[1].strategy = PackagingStrategy::VisibleCostReversal;
    assert!(matches!(
        packaging.validate(),
        Err(DomainError::RuleViolation { .. })
    ));

    let mut packaging = packaging_fixture();
    packaging.hypotheses[0].title = packaging.hypotheses[1].title.clone();
    assert!(matches!(
        packaging.validate(),
        Err(DomainError::RuleViolation { .. })
    ));

    let mut packaging = packaging_fixture();
    packaging.hypotheses[0].payoff_event_id = "different-payoff".to_owned();
    assert!(matches!(
        packaging.validate(),
        Err(DomainError::RuleViolation { .. })
    ));

    let mut packaging = packaging_fixture();
    packaging.approved_at = None;
    assert!(matches!(
        packaging.validate(),
        Err(DomainError::RuleViolation { .. })
    ));

    let mut packaging = packaging_fixture();
    packaging.status = contentgen_core::packaging::PackagingStatus::Draft;
    packaging.approved_at = None;
    packaging
        .validate()
        .expect("draft without approval is valid");
}

#[test]
fn job_dag_rejects_cycles_cross_job_edges_and_retry_overflow() {
    let mut job = job_dag_fixture();
    job.edges.push(JobEdge {
        job_id: job.job.id.clone(),
        from_node_id: "node_render_fixture".to_owned(),
        to_node_id: "node_research_fixture".to_owned(),
        edge_kind: contentgen_core::EdgeKind::Dependency,
        created_at: "2026-10-21T00:00:00Z".to_owned(),
    });
    assert!(matches!(job.validate(), Err(DomainError::CycleDetected)));

    let mut job = job_dag_fixture();
    job.nodes[1].job_id = "job_other".to_owned();
    assert!(matches!(
        job.validate(),
        Err(DomainError::CrossJobReference)
    ));

    let mut job = job_dag_fixture();
    job.nodes[2].max_attempts = 11;
    assert!(matches!(
        job.validate(),
        Err(DomainError::RuleViolation { .. })
    ));

    let mut job = job_dag_fixture();
    job.attempts[0].attempt_number = 4;
    assert!(matches!(
        job.validate(),
        Err(DomainError::RetryLimitExceeded { .. })
    ));

    let mut job = job_dag_fixture();
    job.attempts[0].finished_at = None;
    assert!(matches!(
        job.validate(),
        Err(DomainError::RuleViolation { .. })
    ));

    let mut job = job_dag_fixture();
    job.attempts[0].attempt_number = 2;
    assert!(matches!(
        job.validate(),
        Err(DomainError::RuleViolation { .. })
    ));
}

#[test]
fn evidence_unknown_field_is_rejected_by_typed_documents() {
    let value: serde_json::Value = serde_json::from_str(EVIDENCE_JSON).unwrap();
    let mut object = value.as_object().unwrap().clone();
    object.insert("inventedField".to_owned(), json!(true));
    assert!(serde_json::from_value::<EvidenceBundle>(serde_json::Value::Object(object)).is_err());

    let packaging_value: serde_json::Value = serde_json::from_str(PACKAGING_JSON).unwrap();
    let mut object = packaging_value.as_object().unwrap().clone();
    object.insert("unexpected".to_owned(), json!(1));
    assert!(
        serde_json::from_value::<PackagingHypothesisSet>(serde_json::Value::Object(object))
            .is_err()
    );
}
