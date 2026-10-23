use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use contentgen_core::DomainError;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorBody {
    pub code: &'static str,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub feature: Option<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ErrorEnvelope {
    pub error: ErrorBody,
}

#[derive(Debug, Clone)]
pub enum ApiError {
    NotImplemented { feature: &'static str },
    InvalidDocument { message: String },
    Internal { message: String },
    NotFound { message: String },
    Forbidden { message: String },
    Conflict { message: String },
    Unavailable { message: String },
    RateLimited { message: String },
}

impl ApiError {
    pub fn not_implemented(feature: &'static str) -> Self {
        Self::NotImplemented { feature }
    }
}

impl From<DomainError> for ApiError {
    fn from(error: DomainError) -> Self {
        Self::InvalidDocument {
            message: error.to_string(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, body) = match self {
            Self::NotImplemented { feature } => (
                StatusCode::NOT_IMPLEMENTED,
                ErrorBody {
                    code: "not_implemented",
                    message: format!("feature '{feature}' is registered but not implemented yet"),
                    feature: Some(feature),
                },
            ),
            Self::InvalidDocument { message } => (
                StatusCode::BAD_REQUEST,
                ErrorBody {
                    code: "invalid_document",
                    message,
                    feature: None,
                },
            ),
            Self::Internal { message } => (
                StatusCode::INTERNAL_SERVER_ERROR,
                ErrorBody {
                    code: "internal_error",
                    message,
                    feature: None,
                },
            ),
            Self::NotFound { message } => (
                StatusCode::NOT_FOUND,
                ErrorBody {
                    code: "not_found",
                    message,
                    feature: None,
                },
            ),
            Self::Forbidden { message } => (
                StatusCode::FORBIDDEN,
                ErrorBody {
                    code: "forbidden",
                    message,
                    feature: None,
                },
            ),
            Self::Conflict { message } => (
                StatusCode::CONFLICT,
                ErrorBody {
                    code: "conflict",
                    message,
                    feature: None,
                },
            ),
            Self::Unavailable { message } => (
                StatusCode::SERVICE_UNAVAILABLE,
                ErrorBody {
                    code: "unavailable",
                    message,
                    feature: None,
                },
            ),
            Self::RateLimited { message } => (
                StatusCode::TOO_MANY_REQUESTS,
                ErrorBody {
                    code: "rate_limited",
                    message,
                    feature: None,
                },
            ),
        };
        (status, Json(ErrorEnvelope { error: body })).into_response()
    }
}
