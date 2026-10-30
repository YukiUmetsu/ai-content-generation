//! HTTP interface for independently resumable discovery sessions.
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use super::market_api::epoch_now;
use super::{
    discovery_api::{editor_header, map_error},
    discovery_store, sessions_store,
};
use super::{
    idea_market::{self, IdeaMarketError},
    youtube_api::YoutubeClient,
};
use crate::error::ApiError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/projects/{id}/sessions", get(sessions).post(create))
        .route(
            "/projects/{id}/sessions/{session_id}",
            get(session).patch(update),
        )
        .route(
            "/projects/{id}/sessions/{session_id}/discover",
            post(discover),
        )
        .route("/projects/{id}/sessions/{session_id}/runs", get(runs))
        .route("/projects/{id}/sessions/{session_id}/ideas", get(ideas))
        .route(
            "/projects/{id}/sessions/{session_id}/market/backfill",
            post(backfill_market),
        )
        .route(
            "/projects/{id}/sessions/{session_id}/ideas/{idea_id}/decision",
            post(decide),
        )
        .route(
            "/projects/{id}/sessions/{session_id}/ideas/{idea_id}/market",
            post(measure_market),
        )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Create {
    #[serde(default)]
    name: String,
    platforms: Vec<String>,
    #[serde(default)]
    settings_snapshot: Option<serde_json::Value>,
}
async fn create(
    Path(id): Path<String>,
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Create>,
) -> Result<Json<sessions_store::DiscoverySession>, ApiError> {
    editor_header(&headers)?;
    let db = state.connect().map_err(|_| ApiError::Internal {
        message: "Discovery DB unavailable".into(),
    })?;
    let snapshot = body
        .settings_snapshot
        .unwrap_or_else(|| serde_json::json!({"version":1}));
    Ok(Json(
        sessions_store::create_session(
            &db,
            &id,
            &body.name,
            &body.platforms,
            &snapshot,
            epoch_now(),
        )
        .map_err(map_error)?,
    ))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Sessions {
    sessions: Vec<sessions_store::DiscoverySession>,
}
async fn sessions(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Sessions>, ApiError> {
    let db = state.connect().map_err(|_| ApiError::Internal {
        message: "Discovery DB unavailable".into(),
    })?;
    Ok(Json(Sessions {
        sessions: sessions_store::list_sessions(&db, &id).map_err(map_error)?,
    }))
}
async fn session(
    Path((id, session_id)): Path<(String, String)>,
    State(state): State<AppState>,
) -> Result<Json<sessions_store::DiscoverySession>, ApiError> {
    let db = state.connect().map_err(|_| ApiError::Internal {
        message: "Discovery DB unavailable".into(),
    })?;
    Ok(Json(
        sessions_store::get_session(&db, &id, &session_id).map_err(map_error)?,
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Update {
    name: Option<String>,
    archived: Option<bool>,
}
async fn update(
    Path((id, session_id)): Path<(String, String)>,
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Update>,
) -> Result<Json<sessions_store::DiscoverySession>, ApiError> {
    editor_header(&headers)?;
    let db = state.connect().map_err(|_| ApiError::Internal {
        message: "Discovery DB unavailable".into(),
    })?;
    Ok(Json(
        sessions_store::update_session(
            &db,
            &id,
            &session_id,
            body.name.as_deref(),
            body.archived,
            epoch_now(),
        )
        .map_err(map_error)?,
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Discover {
    input_revision: String,
}
async fn discover(
    Path((id, session_id)): Path<(String, String)>,
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Discover>,
) -> Result<Json<super::discovery_store::DiscoveryRun>, ApiError> {
    editor_header(&headers)?;
    let mut db = state.connect().map_err(|_| ApiError::Internal {
        message: "Discovery DB unavailable".into(),
    })?;
    Ok(Json(
        sessions_store::start_or_get_active(
            &mut db,
            &id,
            &session_id,
            &body.input_revision,
            epoch_now(),
        )
        .map_err(map_error)?,
    ))
}

#[derive(Serialize)]
struct Runs {
    runs: Vec<super::discovery_store::DiscoveryRun>,
}
async fn runs(
    Path((id, session_id)): Path<(String, String)>,
    State(state): State<AppState>,
) -> Result<Json<Runs>, ApiError> {
    let db = state.connect().map_err(|_| ApiError::Internal {
        message: "Discovery DB unavailable".into(),
    })?;
    Ok(Json(Runs {
        runs: sessions_store::list_session_runs(&db, &id, &session_id).map_err(map_error)?,
    }))
}

#[derive(Serialize)]
struct Ideas {
    ideas: Vec<sessions_store::SessionIdea>,
}
async fn ideas(
    Path((id, session_id)): Path<(String, String)>,
    State(state): State<AppState>,
) -> Result<Json<Ideas>, ApiError> {
    let db = state.connect().map_err(|_| ApiError::Internal {
        message: "Discovery DB unavailable".into(),
    })?;
    Ok(Json(Ideas {
        ideas: sessions_store::list_ideas(&db, &id, &session_id).map_err(map_error)?,
    }))
}

/// Idempotent local request to start missing-observation collection immediately.
/// The periodic worker also queues the same work for sessions never opened in UI.
async fn backfill_market(
    Path((id, session_id)): Path<(String, String)>,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<(axum::http::StatusCode, Json<serde_json::Value>), ApiError> {
    editor_header(&headers)?;
    let mut db = state.connect().map_err(|_| ApiError::Internal {
        message: "Discovery DB unavailable".into(),
    })?;
    let youtube_ready = state
        .credentials()
        .youtube_key()
        .ok()
        .and_then(|key| YoutubeClient::from_key(key).ok())
        .is_some();
    let queued = discovery_store::queue_missing_market_runs(
        &mut db,
        Some((&id, &session_id)),
        epoch_now(),
        youtube_ready,
    )
    .map_err(map_error)?;
    let active: i64 = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM discovery_runs
         WHERE project_id=?1 AND session_id=?2 AND status='running'
           AND stage IN ('measure_market','measure_market_collecting'))",
            rusqlite::params![id, session_id],
            |row| row.get(0),
        )
        .map_err(|_| ApiError::Internal {
            message: "Cannot read Discovery market job status".into(),
        })?;
    let pending: i64 = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM discovery_runs
         WHERE project_id=?1 AND session_id=?2 AND status='running'
           AND stage='measure_market')",
            rusqlite::params![id, session_id],
            |row| row.get(0),
        )
        .map_err(|_| ApiError::Internal {
            message: "Cannot read pending Discovery market jobs".into(),
        })?;
    let status = if !queued.is_empty() {
        "queued"
    } else if active != 0 {
        "running"
    } else {
        "no_pending"
    };
    drop(db);
    // A job may already be queued after restart or another browser action.
    // Do not rely on this request having created it to wake the worker.
    if !queued.is_empty() || pending != 0 {
        tokio::spawn(super::discovery_market_worker::process_pending(state));
    }
    Ok((
        axum::http::StatusCode::ACCEPTED,
        Json(serde_json::json!({"state":status,"queuedRunIds":queued})),
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Decision {
    decision: String,
    reason: Option<String>,
}
async fn decide(
    Path((id, session_id, idea_id)): Path<(String, String, String)>,
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Decision>,
) -> Result<Json<serde_json::Value>, ApiError> {
    editor_header(&headers)?;
    let db = state.connect().map_err(|_| ApiError::Internal {
        message: "Discovery DB unavailable".into(),
    })?;
    sessions_store::decide_idea(
        &db,
        &id,
        &session_id,
        &idea_id,
        &body.decision,
        body.reason.as_deref(),
        epoch_now(),
    )
    .map_err(map_error)?;
    Ok(Json(serde_json::json!({"saved":true})))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MeasureMarket {
    query: String,
    format: String,
}

fn market_error(error: IdeaMarketError) -> ApiError {
    match error {
        IdeaMarketError::Invalid => ApiError::InvalidDocument {
            message: error.to_string(),
        },
        IdeaMarketError::NotFound => ApiError::NotFound {
            message: error.to_string(),
        },
        IdeaMarketError::Busy => ApiError::Conflict {
            message: error.to_string(),
        },
        IdeaMarketError::Budget => ApiError::RateLimited {
            message: error.to_string(),
        },
        _ => ApiError::Internal {
            message: "Cannot reserve local idea measurement".into(),
        },
    }
}

/// Explicit local action only. Never expose the configured provider key to JS.
async fn measure_market(
    Path((id, session_id, idea_id)): Path<(String, String, String)>,
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<MeasureMarket>,
) -> Result<(axum::http::StatusCode, Json<serde_json::Value>), ApiError> {
    editor_header(&headers)?;
    let mut db = state.connect().map_err(|_| ApiError::Internal {
        message: "Discovery DB unavailable".into(),
    })?;
    let key = state
        .credentials()
        .youtube_key()
        .map_err(|_| ApiError::Unavailable {
            message: "Configure a YouTube API key in local Settings before measuring ideas".into(),
        })?;
    let client = YoutubeClient::from_key(key).map_err(|_| ApiError::Unavailable {
        message: "A YouTube Data API key is required to collect comparison data".into(),
    })?;
    let run = idea_market::claim_assessment(
        &mut db,
        &id,
        &session_id,
        &idea_id,
        &body.query,
        &body.format,
        epoch_now(),
    )
    .map_err(market_error)?;
    tokio::spawn(idea_market::run_assessment(state, run.clone(), client));
    Ok((
        axum::http::StatusCode::ACCEPTED,
        Json(serde_json::json!({"runId":run.id,"state":"running"})),
    ))
}
