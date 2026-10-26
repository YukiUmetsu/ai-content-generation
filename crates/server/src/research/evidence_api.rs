//! Read-only full-text search of the source passages actually persisted in SQLite.
//! This is distinct from generating new research drafts; an empty database is
//! reported as empty, and neither claims nor numbers are inferred from text.

use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use rusqlite::params;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::error::ApiError;
use crate::state::AppState;

#[derive(Deserialize)]
struct SearchQuery {
    q: String,
    #[serde(default = "default_limit")]
    limit: usize,
}

const fn default_limit() -> usize {
    20
}

fn query_terms(query: &str) -> Result<String, ApiError> {
    if query.trim().is_empty() || query.chars().count() > 500 {
        return Err(ApiError::InvalidDocument {
            message: "Evidence search query must contain 1–500 characters".into(),
        });
    }
    // FTS5 expressions are never interpolated directly from user input. Quoted
    // literal terms avoid operator injection and pathological nested queries.
    let tokens: Vec<String> = query
        .split(|c: char| !c.is_alphanumeric())
        .filter(|token| !token.is_empty())
        .take(24)
        .map(|term| format!("\"{term}\""))
        .collect();
    Ok(tokens.join(" OR "))
}

fn db_error(_: impl std::fmt::Display) -> ApiError {
    ApiError::Internal {
        message: "Local evidence search database operation failed".into(),
    }
}

fn parse_json(text: &str) -> Value {
    serde_json::from_str(text).unwrap_or(Value::Null)
}

pub fn router() -> Router<AppState> {
    Router::new().route("/search", get(search))
}

async fn search(
    Query(query): Query<SearchQuery>,
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiError> {
    if query.limit == 0 || query.limit > 20 {
        return Err(ApiError::InvalidDocument {
            message: "Evidence search limit must be 1–20".into(),
        });
    }
    let match_expression = query_terms(&query.q)?;
    let db = state.connect().map_err(db_error)?;
    let count: i64 = db
        .query_row("SELECT COUNT(*) FROM source_passages", [], |row| row.get(0))
        .map_err(db_error)?;
    let indexed: i64 = db
        .query_row("SELECT COUNT(*) FROM evidence_passages_fts", [], |row| {
            row.get(0)
        })
        .map_err(db_error)?;

    let mut results = Vec::new();
    if !match_expression.is_empty() && indexed > 0 {
        let mut statement = db
            .prepare(
                "SELECT p.id, p.schema_version, p.locator_json, p.language, p.body_sha256,
                    snippet(evidence_passages_fts, 0, '', '', '…', 32),
                    bm25(evidence_passages_fts),
                    s.id, s.source_kind, s.canonical_uri, s.title, s.publisher,
                    s.rights_status, s.created_at, s.metadata_json,
                    v.id, v.source_id, v.content_sha256, v.retrieved_at,
                    v.media_type, v.byte_size, v.parser_version,
                    v.raw_artifact_id, v.created_at, v.metadata_json
             FROM evidence_passages_fts
             JOIN source_passages p ON p.rowid = evidence_passages_fts.rowid
             JOIN source_versions v ON v.id = p.source_version_id
             JOIN source_records s ON s.id = v.source_id
             WHERE evidence_passages_fts MATCH ?1
             ORDER BY bm25(evidence_passages_fts), p.id LIMIT ?2",
            )
            .map_err(db_error)?;
        let rows = statement
            .query_map(params![match_expression, query.limit as i64], |row| {
                let source_metadata: String = row.get(14)?;
                let version_metadata: String = row.get(24)?;
                let source_uri: String = row.get(9)?;
                let rights: String = row.get(12)?;
                let version_id: String = row.get(15)?;
                let sha: String = row.get(17)?;
                let retrieved_at: String = row.get(18)?;
                let parser_version: String = row.get(21)?;
                let license_note = parse_json(&source_metadata)
                    .get("licenseNote")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                Ok(json!({
                    "schemaVersion": row.get::<_,i64>(1)?,
                    "passageId": row.get::<_,String>(0)?,
                    "rank": 0,
                    "bm25": row.get::<_,f64>(6)?,
                    "excerpt": row.get::<_,String>(5)?,
                    "locator": parse_json(&row.get::<_,String>(2)?),
                    "language": row.get::<_,String>(3)?,
                    "bodySha256": row.get::<_,String>(4)?,
                    "source": {
                        "id": row.get::<_,String>(7)?,
                        "sourceKind": row.get::<_,String>(8)?,
                        "canonicalUri": source_uri,
                        "title": row.get::<_,String>(10)?,
                        "publisher": row.get::<_,Option<String>>(11)?,
                        "rightsStatus": rights,
                        "createdAt": row.get::<_,String>(13)?,
                        "metadata": parse_json(&source_metadata),
                    },
                    "version": {
                        "id": version_id,
                        "sourceId": row.get::<_,String>(16)?,
                        "contentSha256": sha,
                        "retrievedAt": retrieved_at,
                        "mediaType": row.get::<_,String>(19)?,
                        "byteSize": row.get::<_,i64>(20)?,
                        "parserVersion": parser_version,
                        "rawArtifactId": row.get::<_,Option<String>>(22)?,
                        "createdAt": row.get::<_,String>(23)?,
                        "metadata": parse_json(&version_metadata),
                    },
                    "provenance": {
                        "sourceVersionId": version_id,
                        "canonicalUri": source_uri,
                        "retrievedAt": retrieved_at,
                        "rightsStatus": rights,
                        "licenseNote": license_note,
                        "contentSha256": sha,
                        "parserVersion": parser_version,
                    },
                    "claims": [],
                    "numericValues": [],
                }))
            })
            .map_err(db_error)?;
        for row in rows {
            let mut result = row.map_err(db_error)?;
            result["rank"] = json!(results.len() + 1);
            results.push(result);
        }
    }
    let state_name = if count == 0 {
        "empty"
    } else if count != indexed {
        "stale"
    } else {
        "ready"
    };
    let reason = if count == 0 {
        Some("index_empty")
    } else if count != indexed {
        Some("index_stale")
    } else if results.is_empty() {
        Some("no_matches")
    } else {
        None
    };
    Ok(Json(json!({
        "schemaVersion": 1,
        "query": query.q,
        "tokenizer": "unicode61",
        "index": {"state": state_name, "sourcePassageCount": count, "indexedPassageCount": indexed},
        "results": results,
        "contradictions": [],
        "degradation": reason.map(|reason| json!({"reason": reason, "hint": null})),
    })))
}
