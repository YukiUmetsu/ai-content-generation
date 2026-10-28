//! Jobs/artifact lane: persistent DAG scheduler plus content-addressed store.

pub mod error;
pub mod scheduler;
pub mod store;

pub use error::JobsError;

use axum::Json;
use axum::extract::rejection::{JsonRejection, QueryRejection};
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Router, http::HeaderValue};
use contentgen_core::artifacts::ArtifactManifest;
use contentgen_core::jobs::{Job, JobAttempt, JobEdge, JobNode, JobState};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::state::AppState;

use self::scheduler::{JobProgress, JobSnapshot, NodeRequest, SubmitOutcome, SubmitRequest};
use self::store::{ArtifactStore, PutOutcome};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/jobs", get(list_jobs).post(create_job))
        .route("/api/jobs/{job_id}", get(get_job))
        .route("/api/jobs/{job_id}/cancel", axum::routing::post(cancel_job))
        .route(
            "/api/jobs/{job_id}/retry",
            axum::routing::post(retry_video_job),
        )
        .route(
            "/api/jobs/{job_id}/recover-stale",
            axum::routing::post(recover_stale_video_job),
        )
        .route(
            "/api/jobs/{job_id}/nodes/{node_id}/start",
            axum::routing::post(start_attempt),
        )
        .route(
            "/api/jobs/{job_id}/nodes/{node_id}/heartbeat",
            axum::routing::post(heartbeat_attempt),
        )
        .route(
            "/api/jobs/{job_id}/nodes/{node_id}/succeed",
            axum::routing::post(succeed_attempt),
        )
        .route(
            "/api/jobs/{job_id}/nodes/{node_id}/fail",
            axum::routing::post(fail_attempt),
        )
        .route("/api/artifacts", axum::routing::post(put_artifact))
        .route("/api/artifacts/{artifact_id}", get(get_artifact))
        .route(
            "/api/artifacts/{artifact_id}/bytes",
            get(get_artifact_bytes),
        )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateJobBody {
    job_kind: String,
    idempotency_key: String,
    nodes: Vec<CreateNodeBody>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateNodeBody {
    node_key: String,
    node_kind: String,
    #[serde(default = "default_max_attempts")]
    max_attempts: u32,
    #[serde(default = "default_input")]
    input: Value,
    #[serde(default)]
    depends_on: Vec<String>,
}

fn default_max_attempts() -> u32 {
    3
}

fn default_input() -> Value {
    Value::Object(serde_json::Map::new())
}

impl CreateJobBody {
    fn into_request(self) -> SubmitRequest {
        SubmitRequest {
            job_kind: self.job_kind,
            idempotency_key: self.idempotency_key,
            nodes: self
                .nodes
                .into_iter()
                .map(|node| NodeRequest {
                    node_key: node.node_key,
                    node_kind: node.node_kind,
                    max_attempts: node.max_attempts,
                    input: node.input,
                    depends_on: node.depends_on,
                })
                .collect(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JobView {
    job: Job,
    nodes: Vec<JobNode>,
    edges: Vec<JobEdge>,
    attempts: Vec<JobAttempt>,
    progress: JobProgress,
}

impl JobView {
    fn from_snapshot(snapshot: JobSnapshot) -> Self {
        Self {
            job: snapshot.dag.job,
            nodes: snapshot.dag.nodes,
            edges: snapshot.dag.edges,
            attempts: snapshot.dag.attempts,
            progress: snapshot.progress,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SubmitView {
    created: bool,
    #[serde(flatten)]
    snapshot: JobView,
}

#[derive(Debug, Serialize)]
struct ListView {
    jobs: Vec<Job>,
}

#[derive(Debug, Deserialize)]
struct ListQuery {
    state: Option<String>,
}

async fn create_job(
    State(app_state): State<AppState>,
    body: Result<Json<CreateJobBody>, JsonRejection>,
) -> Result<(StatusCode, Json<SubmitView>), JobsError> {
    let Json(body) = body.map_err(|rejection| JobsError::InvalidDocument(rejection.body_text()))?;
    let request = body.into_request();
    let mut connection = app_state.connect()?;
    let outcome = scheduler::submit(&mut connection, &request)?;
    let (status, created, snapshot) = match outcome {
        SubmitOutcome::Created(snapshot) => (StatusCode::CREATED, true, snapshot),
        SubmitOutcome::Existing(snapshot) => (StatusCode::OK, false, snapshot),
    };
    Ok((
        status,
        Json(SubmitView {
            created,
            snapshot: JobView::from_snapshot(snapshot),
        }),
    ))
}

async fn list_jobs(
    State(app_state): State<AppState>,
    query: Result<Query<ListQuery>, QueryRejection>,
) -> Result<Json<ListView>, JobsError> {
    let Query(query) = query.map_err(|rejection| JobsError::InvalidQuery(rejection.body_text()))?;
    let state = query.state.as_deref().map(parse_job_state).transpose()?;
    let connection = app_state.connect()?;
    Ok(Json(ListView {
        jobs: scheduler::list(&connection, state)?,
    }))
}

async fn get_job(
    State(app_state): State<AppState>,
    Path(job_id): Path<String>,
) -> Result<Json<JobView>, JobsError> {
    let connection = app_state.connect()?;
    let snapshot = scheduler::snapshot(&connection, &job_id)?;
    Ok(Json(JobView::from_snapshot(snapshot)))
}

async fn cancel_job(
    State(app_state): State<AppState>,
    Path(job_id): Path<String>,
) -> Result<Json<JobView>, JobsError> {
    let mut connection = app_state.connect()?;
    let snapshot = scheduler::cancel_job(&mut connection, &job_id)?;
    Ok(Json(JobView::from_snapshot(snapshot)))
}

async fn retry_video_job(
    State(app_state): State<AppState>,
    headers: HeaderMap,
    Path(job_id): Path<String>,
) -> Result<Json<JobView>, JobsError> {
    require_worker(&headers)?;
    let mut db = app_state.connect()?;
    Ok(Json(JobView::from_snapshot(
        scheduler::retry_failed_video_job(&mut db, &job_id)?,
    )))
}

async fn recover_stale_video_job(
    State(app_state): State<AppState>,
    headers: HeaderMap,
    Path(job_id): Path<String>,
) -> Result<Json<JobView>, JobsError> {
    require_worker(&headers)?;
    let mut db = app_state.connect()?;
    scheduler::reconcile_stale_video_attempts(&mut db, &job_id)?;
    Ok(Json(JobView::from_snapshot(scheduler::snapshot(
        &db, &job_id,
    )?)))
}

/// The media worker runs in the same local installation, not in the browser.
/// It never sends provider keys to the persisted Jobs service. Browsers from
/// other origins cannot forge the custom worker header without CORS approval.
fn require_worker(headers: &HeaderMap) -> Result<(), JobsError> {
    let host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let loopback = host
        .strip_prefix("127.0.0.1:")
        .or_else(|| host.strip_prefix("localhost:"));
    if loopback
        .and_then(|port| port.parse::<u16>().ok())
        .filter(|port| *port > 0)
        .is_none()
        || headers.contains_key(header::ORIGIN)
        || headers.get("sec-fetch-site").is_some()
        || headers
            .get("x-contentgen-worker")
            .and_then(|value| value.to_str().ok())
            != Some("local-only")
    {
        return Err(JobsError::Forbidden);
    }
    Ok(())
}

fn owned_node(
    connection: &rusqlite::Connection,
    job_id: &str,
    node_id: &str,
) -> Result<(), JobsError> {
    let saved = scheduler::snapshot(connection, job_id)?;
    if !saved.dag.nodes.iter().any(|node| node.id == node_id) {
        return Err(JobsError::NotFound(format!(
            "node '{node_id}' does not belong to job '{job_id}'"
        )));
    }
    Ok(())
}

#[derive(Debug, Serialize)]
struct StartedAttempt {
    attempt: JobAttempt,
}

async fn start_attempt(
    State(app_state): State<AppState>,
    headers: HeaderMap,
    Path((job_id, node_id)): Path<(String, String)>,
) -> Result<(StatusCode, Json<StartedAttempt>), JobsError> {
    require_worker(&headers)?;
    let mut db = app_state.connect()?;
    let attempt = scheduler::begin_attempt(&mut db, &job_id, &node_id)?;
    Ok((StatusCode::CREATED, Json(StartedAttempt { attempt })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HeartbeatAttemptBody {
    attempt_id: String,
}

#[derive(Debug, Serialize)]
struct HeartbeatView {
    alive: bool,
}

async fn heartbeat_attempt(
    State(app_state): State<AppState>,
    headers: HeaderMap,
    Path((job_id, node_id)): Path<(String, String)>,
    body: Result<Json<HeartbeatAttemptBody>, JsonRejection>,
) -> Result<Json<HeartbeatView>, JobsError> {
    require_worker(&headers)?;
    let Json(body) = body.map_err(|error| JobsError::InvalidDocument(error.body_text()))?;
    let mut db = app_state.connect()?;
    scheduler::heartbeat_attempt(&mut db, &job_id, &node_id, &body.attempt_id)?;
    Ok(Json(HeartbeatView { alive: true }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SucceedAttemptBody {
    attempt_id: String,
    output: Value,
}

async fn succeed_attempt(
    State(app_state): State<AppState>,
    headers: HeaderMap,
    Path((job_id, node_id)): Path<(String, String)>,
    body: Result<Json<SucceedAttemptBody>, JsonRejection>,
) -> Result<Json<JobView>, JobsError> {
    require_worker(&headers)?;
    let Json(body) = body.map_err(|error| JobsError::InvalidDocument(error.body_text()))?;
    let mut db = app_state.connect()?;
    owned_node(&db, &job_id, &node_id)?;
    Ok(Json(JobView::from_snapshot(scheduler::succeed_attempt(
        &mut db,
        &node_id,
        &body.attempt_id,
        body.output,
    )?)))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FailAttemptBody {
    attempt_id: String,
    error_code: String,
    error_detail: Option<String>,
}

async fn fail_attempt(
    State(app_state): State<AppState>,
    headers: HeaderMap,
    Path((job_id, node_id)): Path<(String, String)>,
    body: Result<Json<FailAttemptBody>, JsonRejection>,
) -> Result<Json<JobView>, JobsError> {
    require_worker(&headers)?;
    let Json(body) = body.map_err(|error| JobsError::InvalidDocument(error.body_text()))?;
    if body.error_code.len() > 80
        || body
            .error_detail
            .as_deref()
            .is_some_and(|detail| detail.len() > 240)
    {
        return Err(JobsError::InvalidDocument(
            "bounded attempt error required".to_owned(),
        ));
    }
    let mut db = app_state.connect()?;
    owned_node(&db, &job_id, &node_id)?;
    Ok(Json(JobView::from_snapshot(scheduler::fail_attempt(
        &mut db,
        &node_id,
        &body.attempt_id,
        &body.error_code,
        body.error_detail.as_deref(),
    )?)))
}

fn parse_job_state(raw: &str) -> Result<JobState, JobsError> {
    match raw {
        "PENDING" => Ok(JobState::Pending),
        "READY" => Ok(JobState::Ready),
        "RUNNING" => Ok(JobState::Running),
        "SUCCEEDED" => Ok(JobState::Succeeded),
        "FAILED" => Ok(JobState::Failed),
        "CANCELLED" => Ok(JobState::Cancelled),
        other => Err(JobsError::InvalidQuery(format!(
            "unknown job state '{other}'; expected one of \
             PENDING, READY, RUNNING, SUCCEEDED, FAILED, CANCELLED"
        ))),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PutArtifactBody {
    manifest: ArtifactManifest,
    bytes_hex: String,
}

async fn put_artifact(
    State(app_state): State<AppState>,
    body: Result<Json<PutArtifactBody>, JsonRejection>,
) -> Result<(StatusCode, Json<ArtifactManifest>), JobsError> {
    let Json(body) = body.map_err(|rejection| JobsError::InvalidDocument(rejection.body_text()))?;
    let bytes = store::decode_hex(&body.bytes_hex)?;
    let mut connection = app_state.connect()?;
    let artifact_store = ArtifactStore::from_db_path(app_state.db_path())?;
    match artifact_store.put(&mut connection, &body.manifest, &bytes)? {
        PutOutcome::Stored(manifest) => Ok((StatusCode::CREATED, Json(manifest))),
        PutOutcome::AlreadyRecorded(manifest) => Ok((StatusCode::OK, Json(manifest))),
    }
}

async fn get_artifact(
    State(app_state): State<AppState>,
    Path(artifact_id): Path<String>,
) -> Result<Json<ArtifactManifest>, JobsError> {
    let connection = app_state.connect()?;
    let artifact_store = ArtifactStore::from_db_path(app_state.db_path())?;
    Ok(Json(artifact_store.manifest(&connection, &artifact_id)?))
}

async fn get_artifact_bytes(
    State(app_state): State<AppState>,
    Path(artifact_id): Path<String>,
) -> Result<Response, JobsError> {
    let connection = app_state.connect()?;
    let artifact_store = ArtifactStore::from_db_path(app_state.db_path())?;
    let (manifest, bytes) = artifact_store.load(&connection, &artifact_id)?;
    let content_type = HeaderValue::from_str(&manifest.media_type).map_err(|error| {
        JobsError::Internal(format!("stored artifact media type is invalid: {error}"))
    })?;
    let mut response = (StatusCode::OK, bytes).into_response();
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, content_type);
    Ok(response)
}
