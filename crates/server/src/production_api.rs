//! Project-owned productions created from selected discovery ideas.
use axum::extract::{Path, Query, Request, State};
use axum::http::HeaderMap;
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::error::ApiError;
use crate::production_store::{self, Production};
use crate::research::discovery_api::{editor_header, map_error};
use crate::research::market_api::epoch_now;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/productions", get(list).post(create))
        .route("/api/productions/{id}", get(get_one))
        .layer(middleware::from_fn(require_local_host))
}

async fn require_local_host(request: Request, next: Next) -> Result<Response, ApiError> {
    crate::settings::require_local_host(request.headers(), "production")?;
    Ok(next.run(request).await)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Create {
    project_id: String,
    session_id: String,
    idea_id: String,
    brief: serde_json::Value,
    platforms: Vec<String>,
}

async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Create>,
) -> Result<Json<Production>, ApiError> {
    editor_header(&headers)?;
    let db = state.connect().map_err(|_| ApiError::Internal {
        message: "Production DB unavailable".into(),
    })?;
    Ok(Json(
        production_store::create_production(
            &db,
            &body.project_id,
            &body.session_id,
            &body.idea_id,
            &body.brief,
            &body.platforms,
            epoch_now(),
        )
        .map_err(map_error)?,
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct QueryProject {
    project_id: Option<String>,
}
#[derive(Serialize)]
struct Productions {
    productions: Vec<Production>,
}
async fn list(
    Query(query): Query<QueryProject>,
    State(state): State<AppState>,
) -> Result<Json<Productions>, ApiError> {
    let db = state.connect().map_err(|_| ApiError::Internal {
        message: "Production DB unavailable".into(),
    })?;
    let productions = if let Some(project_id) = query.project_id {
        production_store::list_productions(&db, &project_id).map_err(map_error)?
    } else {
        production_store::list_all_productions(&db).map_err(map_error)?
    };
    Ok(Json(Productions { productions }))
}

async fn get_one(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Production>, ApiError> {
    let db = state.connect().map_err(|_| ApiError::Internal {
        message: "Production DB unavailable".into(),
    })?;
    Ok(Json(
        production_store::get_production(&db, &id).map_err(map_error)?,
    ))
}
