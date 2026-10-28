//! Local-only project discovery API. Mutations require a non-simple header.

use axum::extract::{DefaultBodyLimit, Path, Query, Request, State};
use axum::http::HeaderMap;
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use super::discovery_projects::{self, DiscoveryError, KeywordPatch, ProjectSnapshot};
use super::discovery_store::{self, CandidateDraft};
use super::graph_store::{self, SourceDraft};
use super::market_api::epoch_now;
use super::sessions_api;
use crate::error::ApiError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .merge(sessions_api::router())
        .route("/projects/{id}", delete(delete_project))
        .route("/projects/{id}/sync", post(sync_project))
        .route(
            "/projects/{id}/keywords",
            get(keywords).patch(patch_keywords),
        )
        .route(
            "/projects/{id}/watchlists",
            get(watchlists).put(put_watchlists),
        )
        .route("/projects/{id}/graph", get(graph))
        .route("/projects/{id}/graph/search", get(graph_search))
        .route(
            "/projects/{id}/graph/nodes/{node_id}/aliases",
            post(add_graph_alias).delete(remove_graph_alias),
        )
        .route(
            "/projects/{id}/graph/edges/{edge_id}/correction",
            axum::routing::patch(correct_graph_edge),
        )
        .route("/projects/{id}/sources/import", post(import_sources))
        .route("/projects/{id}/sources/captured", post(captured_sources))
        .route("/projects/{id}/graph/batches", post(graph_batch))
        .route("/projects/{id}/graph/import-market", post(import_market))
        .route("/projects/{id}/discover", post(discover))
        .route("/projects/{id}/runs", get(runs))
        .route("/projects/{id}/runs/{run_id}", get(run))
        .route("/projects/{id}/runs/{run_id}/checkpoint", post(checkpoint))
        .route(
            "/projects/{id}/runs/{run_id}/artifacts/{key}",
            get(stage_artifact).post(save_artifact),
        )
        .route("/projects/{id}/runs/{run_id}/finish", post(finish))
        .route("/projects/{id}/runs/{run_id}/fail", post(fail))
        .route("/projects/{id}/runs/{run_id}/pause", post(pause))
        .route("/projects/{id}/runs/{run_id}/resume", post(resume))
        .route("/projects/{id}/runs/{run_id}/cancel", post(cancel))
        .route(
            "/projects/{id}/ideas/{candidate_id}/decision",
            post(idea_decision),
        )
        .layer(DefaultBodyLimit::max(320_000))
        .layer(middleware::from_fn(require_local_host))
}

async fn require_local_host(request: Request, next: Next) -> Result<Response, ApiError> {
    crate::settings::require_local_host(request.headers(), "discovery")?;
    Ok(next.run(request).await)
}

pub(crate) fn editor_header(headers: &HeaderMap) -> Result<(), ApiError> {
    if headers
        .get("x-contentgen-discovery")
        .and_then(|value| value.to_str().ok())
        == Some("local-only")
    {
        Ok(())
    } else {
        Err(ApiError::Forbidden {
            message: "Project discovery editing requires a local-only header".into(),
        })
    }
}

pub(crate) fn map_error(error: DiscoveryError) -> ApiError {
    match error {
        DiscoveryError::NotFound => ApiError::NotFound {
            message: "Discovery project not found".into(),
        },
        DiscoveryError::HasSavedResearch => ApiError::Conflict {
            message: "This Project has saved discovery sessions or productions. Preserve or explicitly manage that work before deleting the Project.".into(),
        },
        DiscoveryError::StaleSnapshot => ApiError::Conflict {
            message: "Server has a newer project snapshot".into(),
        },
        DiscoveryError::Invalid(message) => ApiError::InvalidDocument { message },
        DiscoveryError::Db(_) => ApiError::Internal {
            message: "Project discovery database operation failed".into(),
        },
    }
}

async fn delete_project(
    Path(id): Path<String>,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    editor_header(&headers)?;
    let mut db = state.connect().map_err(|_| ApiError::Internal {
        message: "Project database unavailable".into(),
    })?;
    discovery_projects::delete_project(&mut db, &id).map_err(map_error)?;
    Ok(Json(serde_json::json!({"deleted":true})))
}

async fn sync_project(
    Path(id): Path<String>,
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(snapshot): Json<ProjectSnapshot>,
) -> Result<Json<discovery_projects::ProjectSummary>, ApiError> {
    editor_header(&headers)?;
    if id != snapshot.id {
        return Err(ApiError::InvalidDocument {
            message: "Project ID mismatch".into(),
        });
    }
    let mut db = state.connect().map_err(|_| ApiError::Internal {
        message: "Project database unavailable".into(),
    })?;
    let summary =
        discovery_projects::sync_project(&mut db, &snapshot, epoch_now()).map_err(map_error)?;
    Ok(Json(summary))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Keywords {
    keywords: Vec<discovery_projects::ProjectKeyword>,
}

async fn keywords(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Keywords>, ApiError> {
    let db = state.connect().map_err(|_| ApiError::Internal {
        message: "Project database unavailable".into(),
    })?;
    Ok(Json(Keywords {
        keywords: discovery_projects::list_keywords(&db, &id).map_err(map_error)?,
    }))
}

async fn patch_keywords(
    Path(id): Path<String>,
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(patch): Json<KeywordPatch>,
) -> Result<Json<Keywords>, ApiError> {
    editor_header(&headers)?;
    let mut db = state.connect().map_err(|_| ApiError::Internal {
        message: "Project database unavailable".into(),
    })?;
    Ok(Json(Keywords {
        keywords: discovery_projects::patch_keywords(&mut db, &id, patch, epoch_now())
            .map_err(map_error)?,
    }))
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Watchlists {
    watchlist_ids: Vec<String>,
}

async fn watchlists(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Watchlists>, ApiError> {
    let db = state.connect().map_err(|_| ApiError::Internal {
        message: "Project database unavailable".into(),
    })?;
    Ok(Json(Watchlists {
        watchlist_ids: discovery_projects::get_bound_watchlists(&db, &id).map_err(map_error)?,
    }))
}

async fn put_watchlists(
    Path(id): Path<String>,
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Watchlists>,
) -> Result<Json<Watchlists>, ApiError> {
    editor_header(&headers)?;
    let mut db = state.connect().map_err(|_| ApiError::Internal {
        message: "Project database unavailable".into(),
    })?;
    Ok(Json(Watchlists {
        watchlist_ids: discovery_projects::set_bound_watchlists(&mut db, &id, &body.watchlist_ids)
            .map_err(map_error)?,
    }))
}

async fn graph(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<graph_store::GraphOverview>, ApiError> {
    let db = state.connect().map_err(|_| ApiError::Internal {
        message: "Graph database unavailable".into(),
    })?;
    Ok(Json(graph_store::overview(&db, &id).map_err(map_error)?))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct GraphSearch {
    q: String,
}
async fn graph_search(
    Path(id): Path<String>,
    Query(query): Query<GraphSearch>,
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let db = state.connect().map_err(|_| ApiError::Internal {
        message: "Graph database unavailable".into(),
    })?;
    let nodes = graph_store::search_nodes(&db, &id, &query.q, 30).map_err(map_error)?;
    Ok(Json(serde_json::json!({"nodes":nodes})))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AliasInput {
    alias: String,
}
async fn add_graph_alias(
    Path((id, node_id)): Path<(String, String)>,
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<AliasInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    editor_header(&headers)?;
    let db = state.connect().map_err(|_| ApiError::Internal {
        message: "Graph database unavailable".into(),
    })?;
    graph_store::add_alias(&db, &id, &node_id, &body.alias).map_err(map_error)?;
    Ok(Json(serde_json::json!({"saved":true})))
}
async fn remove_graph_alias(
    Path((id, node_id)): Path<(String, String)>,
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<AliasInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    editor_header(&headers)?;
    let db = state.connect().map_err(|_| ApiError::Internal {
        message: "Graph database unavailable".into(),
    })?;
    graph_store::remove_alias(&db, &id, &node_id, &body.alias).map_err(map_error)?;
    Ok(Json(serde_json::json!({"saved":true})))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RelationCorrection {
    status: String,
}
async fn correct_graph_edge(
    Path((id, edge_id)): Path<(String, String)>,
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<RelationCorrection>,
) -> Result<Json<serde_json::Value>, ApiError> {
    editor_header(&headers)?;
    let db = state.connect().map_err(|_| ApiError::Internal {
        message: "Graph database unavailable".into(),
    })?;
    graph_store::correct_edge(&db, &id, &edge_id, &body.status).map_err(map_error)?;
    Ok(Json(serde_json::json!({"saved":true})))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceImport {
    sources: Vec<SourceDraft>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportResult {
    imported: usize,
}

async fn import_sources(
    Path(id): Path<String>,
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<SourceImport>,
) -> Result<Json<ImportResult>, ApiError> {
    editor_header(&headers)?;
    if input.sources.len() > 60 {
        return Err(ApiError::InvalidDocument {
            message: "Too many sources per import".into(),
        });
    }
    let db = state.connect().map_err(|_| ApiError::Internal {
        message: "Graph database unavailable".into(),
    })?;
    for source in &input.sources {
        graph_store::import_source(&db, &id, source.clone()).map_err(map_error)?;
    }
    Ok(Json(ImportResult {
        imported: input.sources.len(),
    }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CapturedSources {
    sources: Vec<graph_store::CapturedSource>,
}
async fn captured_sources(
    Path(id): Path<String>,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<CapturedSources>, ApiError> {
    editor_header(&headers)?;
    let db = state.connect().map_err(|_| ApiError::Internal {
        message: "Graph database unavailable".into(),
    })?;
    Ok(Json(CapturedSources {
        sources: graph_store::captured_sources(&db, &id).map_err(map_error)?,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NodeCandidate {
    kind: String,
    label: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EdgeCandidate {
    from_kind: String,
    from_label: String,
    to_kind: String,
    to_label: String,
    relation: String,
    status: String,
    source_id: Option<String>,
    quote: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GraphBatch {
    nodes: Vec<NodeCandidate>,
    edges: Vec<EdgeCandidate>,
}

async fn graph_batch(
    Path(id): Path<String>,
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<GraphBatch>,
) -> Result<Json<ImportResult>, ApiError> {
    editor_header(&headers)?;
    if input.nodes.len() > 60 || input.edges.len() > 30 {
        return Err(ApiError::InvalidDocument {
            message: "Graph batch is too large".into(),
        });
    }
    let mut db = state.connect().map_err(|_| ApiError::Internal {
        message: "Graph database unavailable".into(),
    })?;
    let tx = db.transaction().map_err(|_| ApiError::Internal {
        message: "Graph transaction unavailable".into(),
    })?;
    for node in &input.nodes {
        graph_store::upsert_node(&tx, &id, &node.kind, &node.label, epoch_now())
            .map_err(map_error)?;
    }
    for edge in &input.edges {
        let from =
            graph_store::upsert_node(&tx, &id, &edge.from_kind, &edge.from_label, epoch_now())
                .map_err(map_error)?;
        let to = graph_store::upsert_node(&tx, &id, &edge.to_kind, &edge.to_label, epoch_now())
            .map_err(map_error)?;
        graph_store::add_edge_verified(
            &tx,
            &id,
            &from,
            &to,
            &edge.relation,
            edge.source_id.as_deref(),
            &edge.status,
            edge.quote.as_deref(),
            epoch_now(),
        )
        .map_err(map_error)?;
    }
    tx.commit().map_err(|_| ApiError::Internal {
        message: "Graph transaction failed".into(),
    })?;
    Ok(Json(ImportResult {
        imported: input.nodes.len() + input.edges.len(),
    }))
}

async fn import_market(
    Path(id): Path<String>,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ImportResult>, ApiError> {
    editor_header(&headers)?;
    let mut db = state.connect().map_err(|_| ApiError::Internal {
        message: "Graph database unavailable".into(),
    })?;
    Ok(Json(ImportResult {
        imported: graph_store::import_market_observations(&mut db, &id, epoch_now())
            .map_err(map_error)?,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DiscoverRequest {
    input_revision: String,
}
async fn discover(
    Path(id): Path<String>,
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<DiscoverRequest>,
) -> Result<Json<discovery_store::DiscoveryRun>, ApiError> {
    editor_header(&headers)?;
    let mut db = state.connect().map_err(|_| ApiError::Internal {
        message: "Discovery database unavailable".into(),
    })?;
    Ok(Json(
        discovery_store::start_or_get_active(&mut db, &id, &body.input_revision, epoch_now())
            .map_err(map_error)?,
    ))
}
#[derive(Serialize)]
struct Runs {
    runs: Vec<discovery_store::DiscoveryRun>,
}
async fn runs(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Runs>, ApiError> {
    let db = state.connect().map_err(|_| ApiError::Internal {
        message: "Discovery database unavailable".into(),
    })?;
    Ok(Json(Runs {
        runs: discovery_store::list_runs(&db, &id).map_err(map_error)?,
    }))
}
async fn run(
    Path((id, run_id)): Path<(String, String)>,
    State(state): State<AppState>,
) -> Result<Json<discovery_store::DiscoveryRun>, ApiError> {
    let db = state.connect().map_err(|_| ApiError::Internal {
        message: "Discovery database unavailable".into(),
    })?;
    Ok(Json(
        discovery_store::get_run(&db, &id, &run_id).map_err(map_error)?,
    ))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Checkpoint {
    stage: String,
    provider_health: Option<serde_json::Value>,
}
async fn checkpoint(
    Path((id, run_id)): Path<(String, String)>,
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Checkpoint>,
) -> Result<Json<discovery_store::DiscoveryRun>, ApiError> {
    editor_header(&headers)?;
    let db = state.connect().map_err(|_| ApiError::Internal {
        message: "Discovery database unavailable".into(),
    })?;
    discovery_store::checkpoint(
        &db,
        &id,
        &run_id,
        &body.stage,
        epoch_now(),
        body.provider_health.as_ref(),
    )
    .map_err(map_error)?;
    Ok(Json(
        discovery_store::get_run(&db, &id, &run_id).map_err(map_error)?,
    ))
}
async fn stage_artifact(
    Path((id, run_id, key)): Path<(String, String, String)>,
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let db = state.connect().map_err(|_| ApiError::Internal {
        message: "Discovery database unavailable".into(),
    })?;
    let artifact =
        discovery_store::load_stage_artifact(&db, &id, &run_id, &key).map_err(map_error)?;
    Ok(Json(serde_json::json!({"artifact":artifact})))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SaveArtifact {
    artifact: serde_json::Value,
}
async fn save_artifact(
    Path((id, run_id, key)): Path<(String, String, String)>,
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SaveArtifact>,
) -> Result<Json<serde_json::Value>, ApiError> {
    editor_header(&headers)?;
    let db = state.connect().map_err(|_| ApiError::Internal {
        message: "Discovery database unavailable".into(),
    })?;
    let artifact =
        discovery_store::save_stage_artifact(&db, &id, &run_id, &key, &body.artifact, epoch_now())
            .map_err(map_error)?;
    Ok(Json(serde_json::json!({"artifact":artifact})))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Finish {
    status: String,
    candidates: Vec<CandidateDraft>,
}
async fn finish(
    Path((id, run_id)): Path<(String, String)>,
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Finish>,
) -> Result<Json<discovery_store::DiscoveryRun>, ApiError> {
    editor_header(&headers)?;
    let mut db = state.connect().map_err(|_| ApiError::Internal {
        message: "Discovery database unavailable".into(),
    })?;
    let known = discovery_store::get_run(&db, &id, &run_id).map_err(map_error)?;
    if known.status == "completed"
        || known.status == "insufficient_evidence"
        || matches!(
            known.stage.as_str(),
            "measure_market" | "measure_market_collecting" | "measure_market_paused"
        )
    {
        return Ok(Json(known));
    }
    discovery_store::finish_run(&mut db, &run_id, body.candidates, &body.status, epoch_now())
        .map_err(map_error)?;
    let saved = discovery_store::get_run(&db, &id, &run_id).map_err(map_error)?;
    drop(db);
    if saved.stage == "measure_market" {
        // Immediate collection keeps the UI responsive; the periodic collector
        // provides restart recovery when the process exits at this boundary.
        tokio::spawn(super::discovery_market_worker::process_pending(state));
    }
    Ok(Json(saved))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Failure {
    code: String,
}
async fn fail(
    Path((id, run_id)): Path<(String, String)>,
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Failure>,
) -> Result<Json<discovery_store::DiscoveryRun>, ApiError> {
    editor_header(&headers)?;
    let db = state.connect().map_err(|_| ApiError::Internal {
        message: "Discovery database unavailable".into(),
    })?;
    discovery_store::fail_run(&db, &id, &run_id, &body.code, epoch_now()).map_err(map_error)?;
    Ok(Json(
        discovery_store::get_run(&db, &id, &run_id).map_err(map_error)?,
    ))
}
async fn pause(
    Path((id, run_id)): Path<(String, String)>,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<discovery_store::DiscoveryRun>, ApiError> {
    editor_header(&headers)?;
    let db = state.connect().map_err(|_| ApiError::Internal {
        message: "Discovery database unavailable".into(),
    })?;
    discovery_store::pause_run(&db, &id, &run_id, epoch_now()).map_err(map_error)?;
    Ok(Json(
        discovery_store::get_run(&db, &id, &run_id).map_err(map_error)?,
    ))
}
async fn resume(
    Path((id, run_id)): Path<(String, String)>,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<discovery_store::DiscoveryRun>, ApiError> {
    editor_header(&headers)?;
    let db = state.connect().map_err(|_| ApiError::Internal {
        message: "Discovery database unavailable".into(),
    })?;
    discovery_store::resume_run(&db, &id, &run_id, epoch_now()).map_err(map_error)?;
    Ok(Json(
        discovery_store::get_run(&db, &id, &run_id).map_err(map_error)?,
    ))
}
async fn cancel(
    Path((id, run_id)): Path<(String, String)>,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<discovery_store::DiscoveryRun>, ApiError> {
    editor_header(&headers)?;
    let db = state.connect().map_err(|_| ApiError::Internal {
        message: "Discovery database unavailable".into(),
    })?;
    discovery_store::cancel_run(&db, &id, &run_id, epoch_now()).map_err(map_error)?;
    Ok(Json(
        discovery_store::get_run(&db, &id, &run_id).map_err(map_error)?,
    ))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Decision {
    decision: String,
    reason: Option<String>,
}
async fn idea_decision(
    Path((id, candidate_id)): Path<(String, String)>,
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Decision>,
) -> Result<Json<serde_json::Value>, ApiError> {
    editor_header(&headers)?;
    let db = state.connect().map_err(|_| ApiError::Internal {
        message: "Discovery database unavailable".into(),
    })?;
    discovery_store::decide(
        &db,
        &id,
        &candidate_id,
        &body.decision,
        body.reason.as_deref(),
        epoch_now(),
    )
    .map_err(map_error)?;
    Ok(Json(serde_json::json!({"saved":true})))
}
