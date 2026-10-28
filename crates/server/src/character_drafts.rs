//! Preserve locally inspected character packages without claiming that their
//! rig, source-art rights, or archive contents have been server-validated.
//! The archive is inert, content-addressed, and never extracted or executed.

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Path, Query, Request, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use contentgen_core::artifacts::{ArtifactManifest, ArtifactProducer, ProducerKind};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::error::ApiError;
use crate::jobs::store::{ArtifactStore, PutOutcome};
use crate::state::AppState;

const MAX_ARCHIVE_SIZE: usize = 16 * 1024 * 1024;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/character-drafts", get(list).post(save))
        .route("/api/character-drafts/{id}/archive", get(archive))
        .layer(DefaultBodyLimit::max(MAX_ARCHIVE_SIZE))
        .layer(middleware::from_fn(require_local_host))
}

async fn require_local_host(request: Request, next: Next) -> Result<Response, ApiError> {
    crate::settings::require_local_host(request.headers(), "character_drafts")?;
    Ok(next.run(request).await)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DraftQuery {
    project_id: String,
    character_id: Option<String>,
    revision: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Draft {
    id: String,
    project_id: String,
    character_id: String,
    revision: String,
    archive_sha256: String,
    size_bytes: i64,
    status: String,
    created_at: String,
}

#[derive(Serialize)]
struct DraftList {
    drafts: Vec<Draft>,
}

fn valid_label(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && !value.trim().is_empty()
        && !value
            .chars()
            .any(|c| c.is_control() || matches!(c, '/' | '\\'))
}

fn validate_query(query: &DraftQuery, require_identity: bool) -> Result<(), ApiError> {
    if !valid_label(&query.project_id, 120) {
        return Err(invalid("projectId is missing or invalid"));
    }
    if require_identity && (query.character_id.is_none() || query.revision.is_none()) {
        return Err(invalid("characterId and revision are required"));
    }
    if query
        .character_id
        .as_deref()
        .is_some_and(|id| !valid_label(id, 80))
        || query
            .revision
            .as_deref()
            .is_some_and(|rev| !valid_label(rev, 64))
    {
        return Err(invalid("characterId or revision is invalid"));
    }
    Ok(())
}

fn invalid(message: &str) -> ApiError {
    ApiError::InvalidDocument {
        message: message.into(),
    }
}

fn unavailable() -> ApiError {
    ApiError::Internal {
        message: "Character draft storage failed".into(),
    }
}

fn row_draft(row: &rusqlite::Row<'_>) -> rusqlite::Result<Draft> {
    Ok(Draft {
        id: row.get(0)?,
        project_id: row.get(1)?,
        character_id: row.get(2)?,
        revision: row.get(3)?,
        archive_sha256: row.get(4)?,
        size_bytes: row.get(5)?,
        status: row.get(6)?,
        created_at: row.get(7)?,
    })
}

const SELECT_DRAFT: &str = "SELECT id, project_id, character_id, revision,
    archive_sha256, size_bytes, status, created_at FROM character_drafts";

async fn list(
    State(state): State<AppState>,
    Query(query): Query<DraftQuery>,
) -> Result<Json<DraftList>, ApiError> {
    validate_query(&query, false)?;
    let drafts =
        tokio::task::spawn_blocking(move || {
            let db = state.connect().map_err(|_| unavailable())?;
            let mut statement = db.prepare(&format!(
            "{SELECT_DRAFT} WHERE project_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 250"
        )).map_err(|_| unavailable())?;
            statement
                .query_map([query.project_id], row_draft)
                .map_err(|_| unavailable())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|_| unavailable())
        })
        .await
        .map_err(|_| unavailable())??;
    Ok(Json(DraftList { drafts }))
}

async fn save(
    State(state): State<AppState>,
    Query(query): Query<DraftQuery>,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<(StatusCode, Json<Draft>), ApiError> {
    if headers
        .get("x-contentgen-character")
        .and_then(|v| v.to_str().ok())
        != Some("local-only")
    {
        return Err(ApiError::Forbidden {
            message: "Character drafts require the local editor header".into(),
        });
    }
    validate_query(&query, true)?;
    if headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        != Some("application/zip")
    {
        return Err(invalid("Content-Type must be application/zip"));
    }
    if bytes.len() < 22 || bytes.len() > MAX_ARCHIVE_SIZE || !bytes.starts_with(b"PK\x03\x04") {
        return Err(invalid("Expected a nonempty ZIP package of at most 16 MiB"));
    }
    // This is a persistence endpoint, not a trusted ZIP validator. Frontend
    // inspection is advisory; no imported draft is render/publish approved.
    let (status, draft) = tokio::task::spawn_blocking(move || persist_draft(&state, query, &bytes))
        .await
        .map_err(|_| unavailable())??;
    Ok((status, Json(draft)))
}

fn persist_draft(
    state: &AppState,
    query: DraftQuery,
    bytes: &[u8],
) -> Result<(StatusCode, Draft), ApiError> {
    let mut db = state.connect().map_err(|_| unavailable())?;
    let project = query.project_id;
    let character = query.character_id.expect("validated characterId");
    let revision = query.revision.expect("validated revision");
    let digest = contentgen_core::sha256_hex(bytes);
    let existing: Option<Draft> = db
        .query_row(
            &format!(
                "{SELECT_DRAFT} WHERE project_id = ?1 AND character_id = ?2 AND revision = ?3"
            ),
            params![project, character, revision],
            row_draft,
        )
        .optional()
        .map_err(|_| unavailable())?;
    if let Some(existing) = existing {
        if existing.archive_sha256 == digest {
            return Ok((StatusCode::OK, existing));
        }
        return Err(ApiError::Conflict {
            message:
                "This character revision is immutable. Choose a new revision to save changed art."
                    .into(),
        });
    }
    let now: String = db
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%SZ','now')", [], |row| {
            row.get(0)
        })
        .map_err(|_| unavailable())?;
    let manifest = ArtifactManifest::for_bytes(
        format!("character-zip.{digest}"),
        "application/zip",
        ArtifactProducer {
            kind: ProducerKind::Import,
            name: "ContentGen Character Studio".into(),
            version: "1".into(),
        },
        now.clone(),
        bytes,
    );
    let store = ArtifactStore::from_db_path(state.db_path()).map_err(|_| unavailable())?;
    let artifact_id = match store
        .put(&mut db, &manifest, bytes)
        .map_err(|_| unavailable())?
    {
        PutOutcome::Stored(saved) | PutOutcome::AlreadyRecorded(saved) => saved.id,
    };
    let mut random = [0_u8; 16];
    getrandom::getrandom(&mut random).map_err(|_| unavailable())?;
    let id = format!(
        "character-draft-{}",
        random
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    );
    let result = db.execute(
        "INSERT INTO character_drafts (id,project_id,character_id,revision,archive_artifact_id,archive_sha256,size_bytes,status,created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,'unverified',?8)",
        params![id, project, character, revision, artifact_id, digest, bytes.len() as i64, now],
    );
    if let Err(error) = result {
        if error.sqlite_error_code() == Some(rusqlite::ErrorCode::ConstraintViolation) {
            return Err(ApiError::Conflict {
                message: "Character revision was saved concurrently; reload the project drafts."
                    .into(),
            });
        }
        return Err(unavailable());
    }
    let draft = Draft {
        id,
        project_id: project,
        character_id: character,
        revision,
        archive_sha256: digest,
        size_bytes: bytes.len() as i64,
        status: "unverified".into(),
        created_at: now,
    };
    Ok((StatusCode::CREATED, draft))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ArchiveQuery {
    project_id: String,
}

async fn archive(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<ArchiveQuery>,
) -> Result<Response, ApiError> {
    if !valid_label(&query.project_id, 120) || !valid_label(&id, 100) {
        return Err(invalid("Invalid draft or project ID"));
    }
    let bytes = tokio::task::spawn_blocking(move || {
        let db = state.connect().map_err(|_| unavailable())?;
        let artifact_id: String = db.query_row(
            "SELECT archive_artifact_id FROM character_drafts WHERE id = ?1 AND project_id = ?2",
            params![id, query.project_id], |row| row.get(0),
        ).optional().map_err(|_| unavailable())?.ok_or_else(|| ApiError::NotFound {
            message: "Character draft does not exist in this project".into(),
        })?;
        let store = ArtifactStore::from_db_path(state.db_path()).map_err(|_| unavailable())?;
        let (_, bytes) = store.load(&db, &artifact_id).map_err(|_| unavailable())?;
        Ok::<_, ApiError>(bytes)
    })
    .await
    .map_err(|_| unavailable())??;
    let mut response = bytes.into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/zip"),
    );
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static("attachment; filename=character-pack.zip"),
    );
    response.headers_mut().insert(
        HeaderName::from_static("x-content-type-options"),
        HeaderValue::from_static("nosniff"),
    );
    Ok(response)
}
