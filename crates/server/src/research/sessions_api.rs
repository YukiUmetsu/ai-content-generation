//! HTTP interface for independently resumable discovery sessions.
use axum::extract::{Path,State};
use axum::http::HeaderMap;
use axum::routing::{get,post};
use axum::{Json,Router};
use serde::{Deserialize,Serialize};

use super::{discovery_api::{editor_header,map_error},sessions_store};
use super::market_api::epoch_now;
use crate::error::ApiError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/projects/{id}/sessions",get(sessions).post(create))
        .route("/projects/{id}/sessions/{session_id}",get(session).patch(update))
        .route("/projects/{id}/sessions/{session_id}/discover",post(discover))
        .route("/projects/{id}/sessions/{session_id}/runs",get(runs))
        .route("/projects/{id}/sessions/{session_id}/ideas",get(ideas))
        .route("/projects/{id}/sessions/{session_id}/ideas/{idea_id}/decision",post(decide))
}

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Create {
    #[serde(default)]
    name:String,
    platforms:Vec<String>,
    #[serde(default)]
    settings_snapshot:Option<serde_json::Value>,
}
async fn create(Path(id):Path<String>,State(state):State<AppState>, headers:HeaderMap,
    Json(body):Json<Create>) -> Result<Json<sessions_store::DiscoverySession>,ApiError> {
    editor_header(&headers)?;
    let db=state.connect().map_err(|_|ApiError::Internal{message:"Discovery DB unavailable".into()})?;
    let snapshot=body.settings_snapshot.unwrap_or_else(||serde_json::json!({"version":1}));
    Ok(Json(sessions_store::create_session(&db,&id,&body.name,&body.platforms,&snapshot,epoch_now()).map_err(map_error)?))
}

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
struct Sessions { sessions:Vec<sessions_store::DiscoverySession> }
async fn sessions(Path(id):Path<String>,State(state):State<AppState>) -> Result<Json<Sessions>,ApiError> {
    let db=state.connect().map_err(|_|ApiError::Internal{message:"Discovery DB unavailable".into()})?;
    Ok(Json(Sessions{sessions:sessions_store::list_sessions(&db,&id).map_err(map_error)?}))
}
async fn session(Path((id,session_id)):Path<(String,String)>,State(state):State<AppState>)
    -> Result<Json<sessions_store::DiscoverySession>,ApiError> {
    let db=state.connect().map_err(|_|ApiError::Internal{message:"Discovery DB unavailable".into()})?;
    Ok(Json(sessions_store::get_session(&db,&id,&session_id).map_err(map_error)?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Update { name:Option<String>, archived:Option<bool> }
async fn update(Path((id,session_id)):Path<(String,String)>,State(state):State<AppState>,
    headers:HeaderMap,Json(body):Json<Update>) -> Result<Json<sessions_store::DiscoverySession>,ApiError> {
    editor_header(&headers)?;
    let db=state.connect().map_err(|_|ApiError::Internal{message:"Discovery DB unavailable".into()})?;
    Ok(Json(sessions_store::update_session(&db,&id,&session_id,body.name.as_deref(),body.archived,epoch_now()).map_err(map_error)?))
}

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Discover { input_revision:String }
async fn discover(Path((id,session_id)):Path<(String,String)>,State(state):State<AppState>,
    headers:HeaderMap,Json(body):Json<Discover>)
    -> Result<Json<super::discovery_store::DiscoveryRun>,ApiError> {
    editor_header(&headers)?;
    let mut db=state.connect().map_err(|_|ApiError::Internal{message:"Discovery DB unavailable".into()})?;
    Ok(Json(sessions_store::start_or_get_active(&mut db,&id,&session_id,&body.input_revision,epoch_now()).map_err(map_error)?))
}

#[derive(Serialize)]
struct Runs { runs:Vec<super::discovery_store::DiscoveryRun> }
async fn runs(Path((id,session_id)):Path<(String,String)>,State(state):State<AppState>)
    -> Result<Json<Runs>,ApiError> {
    let db=state.connect().map_err(|_|ApiError::Internal{message:"Discovery DB unavailable".into()})?;
    Ok(Json(Runs{runs:sessions_store::list_session_runs(&db,&id,&session_id).map_err(map_error)?}))
}

#[derive(Serialize)]
struct Ideas { ideas:Vec<sessions_store::SessionIdea> }
async fn ideas(Path((id,session_id)):Path<(String,String)>,State(state):State<AppState>)
    -> Result<Json<Ideas>,ApiError> {
    let db=state.connect().map_err(|_|ApiError::Internal{message:"Discovery DB unavailable".into()})?;
    Ok(Json(Ideas{ideas:sessions_store::list_ideas(&db,&id,&session_id).map_err(map_error)?}))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Decision { decision:String, reason:Option<String> }
async fn decide(Path((id,session_id,idea_id)):Path<(String,String,String)>,State(state):State<AppState>,
    headers:HeaderMap,Json(body):Json<Decision>) -> Result<Json<serde_json::Value>,ApiError> {
    editor_header(&headers)?;
    let db=state.connect().map_err(|_|ApiError::Internal{message:"Discovery DB unavailable".into()})?;
    sessions_store::decide_idea(&db,&id,&session_id,&idea_id,&body.decision,body.reason.as_deref(),epoch_now()).map_err(map_error)?;
    Ok(Json(serde_json::json!({"saved":true})))
}
