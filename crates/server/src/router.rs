use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;

use crate::state::AppState;

/// Shared router. Lane registration is intentionally fixed after the foundation
/// slice: later research, creative and jobs work extends its own module router.
pub fn build_router(state: AppState) -> Router {
    Router::<AppState>::new()
        .route("/healthz", get(healthz))
        .merge(crate::research::router())
        .merge(crate::creative::router())
        .merge(crate::jobs::router())
        .merge(crate::production_api::router())
        .merge(crate::character_drafts::router())
        .merge(crate::project_voices::router())
        .merge(crate::character_voices::router())
        .merge(crate::scene_cast::router())
        .nest("/api/settings", crate::settings::router())
        .with_state(state)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    status: &'static str,
    service: &'static str,
    version: &'static str,
}

async fn healthz() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        service: "contentgen-server",
        version: env!("CARGO_PKG_VERSION"),
    })
}
