//! Creative/packaging lane extension point.
//!
//! Later work adds hypothesis authoring, validation and approval handlers here.

use axum::routing::get;
use axum::{Json, Router};
use serde_json::Value;

use crate::error::ApiError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/api/creative/packaging", get(packaging_not_implemented))
}

async fn packaging_not_implemented() -> Result<Json<Value>, ApiError> {
    Err(ApiError::not_implemented("creative.packaging"))
}
