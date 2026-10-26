//! Research/evidence lane extension point.
//!
//! Later work adds handlers and persistence here. The shared router only merges
//! `router()` and never needs to be edited again.

use axum::routing::get;
use axum::{Json, Router};
use serde_json::Value;

use crate::error::ApiError;
use crate::state::AppState;

pub mod discovery_api;
pub mod discovery_market_worker;
pub mod discovery_projects;
pub mod discovery_store;
pub mod evidence_api;
pub mod google_ads;
pub mod graph_store;
pub mod idea_market;
pub mod idea_trends;
pub mod market_api;
pub mod market_store;
pub mod market_worker;
pub mod sessions_api;
pub mod sessions_store;
pub mod viral_potential;
pub mod youtube_api;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/research/evidence", get(evidence_not_implemented))
        .nest("/api/research", evidence_api::router())
        .nest("/api/research/market", market_api::router())
        .nest("/api/research/discovery", discovery_api::router())
}

async fn evidence_not_implemented() -> Result<Json<Value>, ApiError> {
    Err(ApiError::not_implemented("research.evidence"))
}
