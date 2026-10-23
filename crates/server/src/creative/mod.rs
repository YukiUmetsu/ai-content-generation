//! Read the latest saved packaging hypothesis set. A new local library has no
//! packaging document; never substitute a synthetic example for user data.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use rusqlite::OptionalExtension;
use serde_json::Value;

use crate::error::ApiError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/api/creative/packaging", get(latest_packaging))
}

async fn latest_packaging(State(state): State<AppState>) -> Result<Response, ApiError> {
    let db = state.connect().map_err(|_| ApiError::Internal {
        message: "Could not open the local packaging database".into(),
    })?;
    let document: Option<String> = db.query_row(
        "SELECT document_json FROM packaging_hypothesis_sets
         ORDER BY created_at DESC, id DESC LIMIT 1",
        [],
        |row| row.get(0),
    ).optional().map_err(|_| ApiError::Internal {
        message: "Could not query the local packaging database".into(),
    })?;
    match document {
        Some(raw) => {
            let document: Value = serde_json::from_str(&raw).map_err(|_| ApiError::Internal {
                message: "Saved packaging document is invalid JSON".into(),
            })?;
            Ok(Json(document).into_response())
        }
        None => Ok(StatusCode::NO_CONTENT.into_response()),
    }
}
