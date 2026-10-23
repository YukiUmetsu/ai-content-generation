//! Research/evidence lane extension point.
//!
//! Later work adds handlers and persistence here. The shared router only merges
//! `router()` and never needs to be edited again.

use axum::routing::get;
use axum::{Json, Router};
use serde_json::Value;

use crate::error::ApiError;
use crate::state::AppState;

pub mod market_api;
pub mod market_store;
pub mod market_worker;
pub mod youtube_api;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/research/evidence", get(evidence_not_implemented))
        .nest("/api/research/market", market_api::router())
}

async fn evidence_not_implemented() -> Result<Json<Value>, ApiError> {
    Err(ApiError::not_implemented("research.evidence"))
}
