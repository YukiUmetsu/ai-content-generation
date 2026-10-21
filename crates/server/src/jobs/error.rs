//! Module-local error type for the jobs/artifacts lane.
//!
//! The shared `ApiError` only knows three shapes, so this module owns the
//! domain-specific mapping (409/422/404) while still emitting exactly the same
//! `{"error": {code, message, feature}}` envelope.

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use contentgen_core::DomainError;
use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum JobsError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error(transparent)]
    Domain(#[from] DomainError),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("{0}")]
    NotFound(String),

    #[error("{0}")]
    InvalidDocument(String),

    #[error("{0}")]
    InvalidQuery(String),

    #[error("job is already finished and cannot change state")]
    JobFinished,

    #[error("idempotency key is already bound to a different job: {0}")]
    IdempotencyConflict(String),

    #[error("job node is not ready to run")]
    NodeNotReady,

    #[error("job node has exhausted its bounded retry limit")]
    RetryLimitExceeded,

    #[error("job attempt is already finished with a different outcome")]
    AttemptAlreadyFinished,

    #[error("artifact digest or size does not match the supplied bytes: {0}")]
    ArtifactDigestMismatch(String),

    #[error("artifact manifest conflicts with an immutable content-addressed record: {0}")]
    ArtifactConflict(String),

    #[error("artifact bytes no longer match their recorded digest: {0}")]
    ArtifactTampered(String),

    #[error("internal error: {0}")]
    Internal(String),
}

impl JobsError {
    fn status_and_code(&self) -> (StatusCode, &'static str) {
        match self {
            Self::NotFound(_) => (StatusCode::NOT_FOUND, "not_found"),
            Self::InvalidDocument(_) | Self::Domain(_) | Self::Json(_) => {
                (StatusCode::BAD_REQUEST, "invalid_document")
            }
            Self::InvalidQuery(_) => (StatusCode::BAD_REQUEST, "invalid_query"),
            Self::JobFinished => (StatusCode::CONFLICT, "job_already_finished"),
            Self::IdempotencyConflict(_) => (StatusCode::CONFLICT, "idempotency_conflict"),
            Self::NodeNotReady => (StatusCode::CONFLICT, "node_not_ready"),
            Self::RetryLimitExceeded => (StatusCode::CONFLICT, "retry_limit_exceeded"),
            Self::AttemptAlreadyFinished => (StatusCode::CONFLICT, "attempt_already_finished"),
            Self::ArtifactConflict(_) => (StatusCode::CONFLICT, "manifest_conflict"),
            Self::ArtifactDigestMismatch(_) => {
                (StatusCode::UNPROCESSABLE_ENTITY, "digest_mismatch")
            }
            Self::ArtifactTampered(_) => (StatusCode::INTERNAL_SERVER_ERROR, "artifact_tampered"),
            Self::Database(_) | Self::Io(_) | Self::Internal(_) => {
                (StatusCode::INTERNAL_SERVER_ERROR, "internal_error")
            }
        }
    }
}

impl From<crate::db::DbError> for JobsError {
    fn from(error: crate::db::DbError) -> Self {
        match error {
            crate::db::DbError::Sqlite(error) => Self::Database(error),
            other => Self::Internal(other.to_string()),
        }
    }
}

#[derive(Debug, Serialize)]
struct ErrorBody {
    code: &'static str,
    message: String,
    feature: Option<&'static str>,
}

#[derive(Debug, Serialize)]
struct ErrorEnvelope {
    error: ErrorBody,
}

impl IntoResponse for JobsError {
    fn into_response(self) -> Response {
        let (status, code) = self.status_and_code();
        let body = ErrorEnvelope {
            error: ErrorBody {
                code,
                message: self.to_string(),
                feature: None,
            },
        };
        (status, Json(body)).into_response()
    }
}
