//! Jobs/artifact lane extension point.
//!
//! Later work adds DAG scheduling and content-addressed artifact storage here.

use axum::routing::get;
use axum::{Json, Router};
use serde_json::Value;

use crate::error::ApiError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/api/jobs", get(jobs_not_implemented))
}

async fn jobs_not_implemented() -> Result<Json<Value>, ApiError> {
    Err(ApiError::not_implemented("jobs.artifacts"))
}
