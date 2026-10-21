//! Vendor-neutral ContentGen domain documents.
//!
//! This crate owns typed/versioned JSON contracts and their validation. It has
//! no HTTP, SQLite, model-provider or rendering dependency, so later lanes can
//! reuse the same documents behind any adapter.

pub mod artifacts;
pub mod error;
pub mod evidence;
pub mod jobs;
pub mod packaging;

pub use artifacts::{
    ARTIFACT_SCHEMA_VERSION, ArtifactManifest, ArtifactProducer, DigestAlgorithm, ProducerKind,
    sha256_hex,
};
pub use error::DomainError;
pub use evidence::{
    EVIDENCE_SCHEMA_VERSION, EvidenceBundle, PassageLocator, RightsStatus, SourceKind,
    SourcePassage, SourceRecord, SourceVersion,
};
pub use jobs::{
    AttemptState, EdgeKind, JOBS_SCHEMA_VERSION, Job, JobAttempt, JobDag, JobEdge, JobNode,
    JobState, MAX_ATTEMPTS_LIMIT,
};
pub use packaging::{
    MetricProvenance, MetricProvenanceKind, MetricValue, PACKAGING_SCHEMA_VERSION,
    PackagingHypothesis, PackagingHypothesisSet, PackagingStatus, PackagingStrategy, PremisePayoff,
    PremiseSetup,
};

/// Validation implemented by every persisted domain document.
pub trait Validate {
    fn validate(&self) -> Result<(), DomainError>;
}
