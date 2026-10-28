//! Nonsecret project-scoped voice favorites. IDs/tags are suggestions, not
//! provider authorization, voice rights, credentials, or synthesis requests.

use std::collections::HashSet;

use axum::extract::{DefaultBodyLimit, Path, Request, State};
use axum::http::{HeaderMap, StatusCode};
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::routing::get;
use axum::{Json, Router};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::error::ApiError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/project-voices/{project_id}", get(load).put(save))
        .layer(DefaultBodyLimit::max(16 * 1024))
        .layer(middleware::from_fn(require_local_host))
}

async fn require_local_host(request: Request, next: Next) -> Result<Response, ApiError> {
    crate::settings::require_local_host(request.headers(), "project_voices")?;
    Ok(next.run(request).await)
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Favorite {
    provider: String,
    voice_id: String,
    name: String,
    gender: String,
    situation: String,
    language: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Library {
    schema_version: u8,
    project_id: String,
    voices: Vec<Favorite>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveRequest {
    revision: i64,
    library: Library,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    revision: i64,
    library: Option<Library>,
}

fn invalid(message: &str) -> ApiError {
    ApiError::InvalidDocument {
        message: message.into(),
    }
}

fn unavailable() -> ApiError {
    ApiError::Internal {
        message: "Project voice storage is unavailable".into(),
    }
}

pub(crate) fn valid_project(value: &str) -> bool {
    (1..=160).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

pub(crate) fn valid_text(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value.trim() == value
        && !value.chars().any(char::is_control)
}

fn valid_language(value: &str) -> bool {
    if value == "und" {
        return true;
    }
    let mut subtags = value.split('-');
    let Some(first) = subtags.next() else {
        return false;
    };
    (2..=8).contains(&first.len())
        && first.bytes().all(|byte| byte.is_ascii_alphabetic())
        && subtags.all(|tag| {
            (1..=8).contains(&tag.len()) && tag.bytes().all(|byte| byte.is_ascii_alphanumeric())
        })
}

fn validate(project_id: &str, library: &Library) -> Result<(), ApiError> {
    if !valid_project(project_id)
        || library.schema_version != 1
        || library.project_id != project_id
        || library.voices.len() > 16
    {
        return Err(invalid(
            "Project voices contain an invalid project, version, or list size",
        ));
    }
    let mut seen = HashSet::new();
    for voice in &library.voices {
        if !valid_favorite(voice)
            || !seen.insert((voice.provider.as_str(), voice.voice_id.as_str()))
        {
            return Err(invalid(
                "Project voices contain invalid or duplicate voice IDs or tags",
            ));
        }
    }
    Ok(())
}

pub(crate) fn valid_favorite(voice: &Favorite) -> bool {
    matches!(voice.provider.as_str(), "fish" | "local")
        && valid_text(&voice.voice_id, 128)
        && (voice.provider != "fish"
            || (voice.voice_id.len() == 32
                && voice
                    .voice_id
                    .bytes()
                    .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())))
        && valid_text(&voice.name, 72)
        && matches!(
            voice.gender.as_str(),
            "unspecified" | "female" | "male" | "nonbinary"
        )
        && valid_text(&voice.situation, 48)
        && valid_text(&voice.language, 35)
        && valid_language(&voice.language)
}

async fn load(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Snapshot>, ApiError> {
    if !valid_project(&project_id) {
        return Err(invalid("Invalid project ID"));
    }
    let snapshot =
        tokio::task::spawn_blocking(move || -> Result<Snapshot, ApiError> {
            let db = state.connect().map_err(|_| unavailable())?;
            let row: Option<(i64, String)> = db.query_row(
            "SELECT revision, library_json FROM project_voice_favorites WHERE project_id = ?1",
            [&project_id], |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional().map_err(|_| unavailable())?;
            let Some((revision, json)) = row else {
                return Ok(Snapshot {
                    revision: 0,
                    library: None,
                });
            };
            let library: Library = serde_json::from_str(&json).map_err(|_| unavailable())?;
            validate(&project_id, &library).map_err(|_| unavailable())?;
            Ok(Snapshot {
                revision,
                library: Some(library),
            })
        })
        .await
        .map_err(|_| unavailable())??;
    Ok(Json(snapshot))
}

async fn save(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    headers: HeaderMap,
    Json(request): Json<SaveRequest>,
) -> Result<(StatusCode, Json<Snapshot>), ApiError> {
    if headers
        .get("x-contentgen-voices")
        .and_then(|v| v.to_str().ok())
        != Some("local-only")
    {
        return Err(ApiError::Forbidden {
            message: "Project voice editing requires a local editor header".into(),
        });
    }
    validate(&project_id, &request.library)?;
    if !(0..2147483647).contains(&request.revision) {
        return Err(invalid("Invalid project voice revision"));
    }
    let snapshot = tokio::task::spawn_blocking(move || {
        let db = state.connect().map_err(|_| unavailable())?;
        let json = serde_json::to_string(&request.library).map_err(|_| unavailable())?;
        let changed = if request.revision == 0 {
            db.execute("INSERT INTO project_voice_favorites (project_id, revision, library_json, updated_at)
                VALUES (?1, 1, ?2, strftime('%Y-%m-%dT%H:%M:%SZ','now')) ON CONFLICT(project_id) DO NOTHING",
                params![project_id, json])
        } else {
            db.execute("UPDATE project_voice_favorites SET revision = revision + 1,
                library_json = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
                WHERE project_id = ?1 AND revision = ?3",
                params![project_id, json, request.revision])
        }.map_err(|_| unavailable())?;
        if changed == 0 { return Err(ApiError::Conflict {
            message: "Project voices changed in another editor. Reload before saving.".into(),
        }); }
        Ok(Snapshot { revision: request.revision + 1, library: Some(request.library) })
    }).await.map_err(|_| unavailable())??;
    Ok((StatusCode::OK, Json(snapshot)))
}
