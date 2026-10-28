//! Nonsecret, version-pinned character voice assignments. These records do
//! not grant voice rights, approve a character rig, or launch a TTS job.

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
use crate::project_voices::{Favorite, valid_favorite, valid_project};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/character-voices/{project_id}", get(load).put(save))
        .layer(DefaultBodyLimit::max(200 * 1024))
        .layer(middleware::from_fn(require_local_host))
}

async fn require_local_host(request: Request, next: Next) -> Result<Response, ApiError> {
    crate::settings::require_local_host(request.headers(), "character_voices")?;
    Ok(next.run(request).await)
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Binding {
    draft_id: String,
    character_id: String,
    revision: String,
    voice: Favorite,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Registry {
    schema_version: u8,
    project_id: String,
    bindings: Vec<Binding>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveRequest {
    revision: i64,
    registry: Registry,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    revision: i64,
    registry: Option<Registry>,
}

fn invalid(message: &str) -> ApiError {
    ApiError::InvalidDocument {
        message: message.into(),
    }
}

fn unavailable() -> ApiError {
    ApiError::Internal {
        message: "Character voice storage is unavailable".into(),
    }
}

fn valid_label(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && !value.trim().is_empty()
        && !value
            .chars()
            .any(|c| c.is_control() || matches!(c, '/' | '\\'))
}

fn valid_draft_id(value: &str) -> bool {
    value
        .strip_prefix("character-draft-")
        .is_some_and(|suffix| {
            suffix.len() == 32
                && suffix
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        })
}

fn validate(project_id: &str, registry: &Registry) -> Result<(), ApiError> {
    if !valid_project(project_id)
        || registry.project_id != project_id
        || registry.schema_version != 1
        || registry.bindings.len() > 250
    {
        return Err(invalid(
            "Invalid character voice registry project, version, or size",
        ));
    }
    let mut seen = HashSet::new();
    for binding in &registry.bindings {
        if !valid_draft_id(&binding.draft_id)
            || !valid_label(&binding.character_id, 80)
            || !valid_label(&binding.revision, 64)
            || !valid_favorite(&binding.voice)
            || !seen.insert(binding.draft_id.as_str())
        {
            return Err(invalid(
                "Invalid or duplicate character draft voice binding",
            ));
        }
    }
    Ok(())
}

async fn load(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Snapshot>, ApiError> {
    if !valid_project(&project_id) {
        return Err(invalid("Invalid project ID"));
    }
    let snapshot = tokio::task::spawn_blocking(move || -> Result<Snapshot, ApiError> {
        let db = state.connect().map_err(|_| unavailable())?;
        let row: Option<(i64, String)> = db.query_row(
            "SELECT revision, registry_json FROM character_voice_bindings WHERE project_id = ?1",
            [&project_id], |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional().map_err(|_| unavailable())?;
        let Some((revision, json)) = row else {
            return Ok(Snapshot {
                revision: 0,
                registry: None,
            });
        };
        let registry: Registry = serde_json::from_str(&json).map_err(|_| unavailable())?;
        validate(&project_id, &registry).map_err(|_| unavailable())?;
        Ok(Snapshot {
            revision,
            registry: Some(registry),
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
        .get("x-contentgen-character-voices")
        .and_then(|v| v.to_str().ok())
        != Some("local-only")
    {
        return Err(ApiError::Forbidden {
            message: "Character voice editing requires a local editor header".into(),
        });
    }
    validate(&project_id, &request.registry)?;
    if !(0..2147483647).contains(&request.revision) {
        return Err(invalid("Invalid character voice revision"));
    }
    let snapshot = tokio::task::spawn_blocking(move || {
        let db = state.connect().map_err(|_| unavailable())?;
        // The browser catalog owns project identity, but a character mapping
        // may only point at a real, immutable ZIP draft in the same project.
        let mut find = db.prepare("SELECT 1 FROM character_drafts
            WHERE id = ?1 AND project_id = ?2 AND character_id = ?3 AND revision = ?4")
            .map_err(|_| unavailable())?;
        for binding in &request.registry.bindings {
            let exists: Option<i32> = find.query_row(params![binding.draft_id, project_id,
                binding.character_id, binding.revision], |row| row.get(0))
                .optional().map_err(|_| unavailable())?;
            if exists.is_none() { return Err(invalid("Character voice assignment references a missing or different-project draft")); }
        }
        drop(find);
        let json = serde_json::to_string(&request.registry).map_err(|_| unavailable())?;
        let changed = if request.revision == 0 {
            db.execute("INSERT INTO character_voice_bindings (project_id, revision, registry_json, updated_at)
                VALUES (?1, 1, ?2, strftime('%Y-%m-%dT%H:%M:%SZ','now')) ON CONFLICT(project_id) DO NOTHING",
                params![project_id, json])
        } else {
            db.execute("UPDATE character_voice_bindings SET revision = revision + 1,
                registry_json = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
                WHERE project_id = ?1 AND revision = ?3",
                params![project_id, json, request.revision])
        }.map_err(|_| unavailable())?;
        if changed == 0 { return Err(ApiError::Conflict {
            message: "Character voices changed in another editor. Reload before saving.".into(),
        }); }
        Ok(Snapshot { revision: request.revision + 1, registry: Some(request.registry) })
    }).await.map_err(|_| unavailable())??;
    Ok((StatusCode::OK, Json(snapshot)))
}
