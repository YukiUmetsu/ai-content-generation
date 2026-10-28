//! Nonsecret, per-source scene cast assignments. The compiled source hash pins
//! these choices to one storyboard, while render-time rights stay ephemeral.

use std::collections::{HashMap, HashSet};

use axum::extract::{DefaultBodyLimit, Path, Request, State};
use axum::http::{HeaderMap, StatusCode};
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::routing::get;
use axum::{Json, Router};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::error::ApiError;
use crate::project_voices::{valid_project, valid_text};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/scene-cast/{project_id}/{source_sha}",
            get(load).put(save),
        )
        .layer(DefaultBodyLimit::max(85 * 1024))
        .layer(middleware::from_fn(require_local_host))
}

async fn require_local_host(request: Request, next: Next) -> Result<Response, ApiError> {
    crate::settings::require_local_host(request.headers(), "scene_cast")?;
    Ok(next.run(request).await)
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Speaker {
    id: String,
    role: String,
    provider: String,
    voice_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Assignment {
    shot_id: String,
    speaker: Speaker,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Cast {
    schema_version: u8,
    project_id: String,
    source_plan_sha256: String,
    assignments: Vec<Assignment>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveRequest {
    revision: i64,
    cast: Cast,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    revision: i64,
    cast: Option<Cast>,
}

fn invalid(message: &str) -> ApiError {
    ApiError::InvalidDocument {
        message: message.into(),
    }
}

fn unavailable() -> ApiError {
    ApiError::Internal {
        message: "Scene cast storage is unavailable".into(),
    }
}

fn valid_sha(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

fn valid_identifier(value: &str) -> bool {
    (1..=80).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn validate(project_id: &str, source_sha: &str, cast: &Cast) -> Result<(), ApiError> {
    if !valid_project(project_id)
        || !valid_sha(source_sha)
        || cast.schema_version != 1
        || cast.project_id != project_id
        || cast.source_plan_sha256 != source_sha
        || cast.assignments.len() > 160
    {
        return Err(invalid(
            "Scene cast has an invalid project, source revision, version or size",
        ));
    }
    let mut shots = HashSet::new();
    let mut speakers: HashMap<&str, (&str, &str, &str)> = HashMap::new();
    for assignment in &cast.assignments {
        let voice = &assignment.speaker;
        if !valid_identifier(&assignment.shot_id)
            || !shots.insert(assignment.shot_id.as_str())
            || !valid_identifier(&voice.id)
            || !matches!(voice.role.as_str(), "narrator" | "character")
            || (voice.role == "narrator") != (voice.id == "narrator")
            || !matches!(voice.provider.as_str(), "local" | "fish")
            || !valid_text(&voice.voice_id, 128)
            || (voice.provider == "fish"
                && !(voice.voice_id.len() == 32 && valid_sha_fragment(&voice.voice_id)))
        {
            return Err(invalid(
                "Scene cast contains invalid, duplicated or unauthorized speaker fields",
            ));
        }
        let identity = (
            voice.role.as_str(),
            voice.provider.as_str(),
            voice.voice_id.as_str(),
        );
        if speakers
            .insert(voice.id.as_str(), identity)
            .is_some_and(|prior| prior != identity)
        {
            return Err(invalid(
                "A character cannot have inconsistent voices within one storyboard",
            ));
        }
    }
    Ok(())
}

fn valid_sha_fragment(value: &str) -> bool {
    value
        .bytes()
        .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

async fn load(
    State(state): State<AppState>,
    Path((project_id, source_sha)): Path<(String, String)>,
) -> Result<Json<Snapshot>, ApiError> {
    if !valid_project(&project_id) || !valid_sha(&source_sha) {
        return Err(invalid("Invalid scene cast identity"));
    }
    let snapshot = tokio::task::spawn_blocking(move || -> Result<Snapshot, ApiError> {
        let db = state.connect().map_err(|_| unavailable())?;
        let row: Option<(i64, String)> = db.query_row(
            "SELECT revision, cast_json FROM project_scene_cast WHERE project_id = ?1 AND source_plan_sha256 = ?2",
            params![project_id, source_sha], |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional().map_err(|_| unavailable())?;
        let Some((revision, json)) = row else { return Ok(Snapshot { revision: 0, cast: None }); };
        let cast: Cast = serde_json::from_str(&json).map_err(|_| unavailable())?;
        validate(&project_id, &source_sha, &cast).map_err(|_| unavailable())?;
        Ok(Snapshot { revision, cast: Some(cast) })
    }).await.map_err(|_| unavailable())??;
    Ok(Json(snapshot))
}

async fn save(
    State(state): State<AppState>,
    Path((project_id, source_sha)): Path<(String, String)>,
    headers: HeaderMap,
    Json(request): Json<SaveRequest>,
) -> Result<(StatusCode, Json<Snapshot>), ApiError> {
    if headers
        .get("x-contentgen-scene-cast")
        .and_then(|v| v.to_str().ok())
        != Some("local-only")
    {
        return Err(ApiError::Forbidden {
            message: "Scene cast editing requires a local editor header".into(),
        });
    }
    validate(&project_id, &source_sha, &request.cast)?;
    if !(0..2147483647).contains(&request.revision) {
        return Err(invalid("Invalid scene cast revision"));
    }
    let snapshot = tokio::task::spawn_blocking(move || -> Result<Snapshot, ApiError> {
        let db = state.connect().map_err(|_| unavailable())?;
        let json = serde_json::to_string(&request.cast).map_err(|_| unavailable())?;
        let changed = if request.revision == 0 {
            db.execute("INSERT INTO project_scene_cast (project_id, source_plan_sha256, revision, cast_json, updated_at)
                VALUES (?1, ?2, 1, ?3, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
                ON CONFLICT(project_id, source_plan_sha256) DO NOTHING",
                params![project_id, source_sha, json])
        } else {
            db.execute("UPDATE project_scene_cast SET revision = revision + 1,
                cast_json = ?3, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
                WHERE project_id = ?1 AND source_plan_sha256 = ?2 AND revision = ?4",
                params![project_id, source_sha, json, request.revision])
        }.map_err(|_| unavailable())?;
        if changed == 0 { return Err(ApiError::Conflict {
            message: "Scene voices changed in another editor. Reload before saving.".into(),
        }); }
        Ok(Snapshot { revision: request.revision + 1, cast: Some(request.cast) })
    }).await.map_err(|_| unavailable())??;
    Ok((StatusCode::OK, Json(snapshot)))
}
