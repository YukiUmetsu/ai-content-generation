//! Project discovery is a bounded, one-way mirror of the browser catalog.
//! This store never edits the browser's local project or content records.

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum DiscoveryError {
    #[error("project not found")]
    NotFound,
    #[error("project has saved research or productions")]
    HasSavedResearch,
    #[error("invalid project discovery data: {0}")]
    Invalid(String),
    #[error("stale project snapshot")]
    StaleSnapshot,
    #[error("database operation failed: {0}")]
    Db(#[from] rusqlite::Error),
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectContentSnapshot {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub notes: String,
    pub kind: String,
    pub stage: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectSnapshot {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub notes: String,
    pub updated_at: i64,
    #[serde(default)]
    pub content: Vec<ProjectContentSnapshot>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub notes: String,
    pub snapshot_revision: i64,
    pub content_count: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KeywordDraft {
    pub text: String,
    pub kind: String,
    pub origin: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KeywordPatch {
    #[serde(default)]
    pub add: Vec<KeywordDraft>,
    #[serde(default)]
    pub remove: Vec<String>,
    #[serde(default)]
    pub disable: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectKeyword {
    pub id: String,
    pub text: String,
    pub kind: String,
    pub origin: String,
    pub active: bool,
    pub manual_lock: bool,
}

fn valid_id(id: &str) -> bool {
    (1..=128).contains(&id.len())
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-'))
}

fn normalize(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn project_exists(db: &Connection, id: &str) -> Result<bool, DiscoveryError> {
    Ok(db
        .query_row("SELECT 1 FROM discovery_projects WHERE id=?1", [id], |_| {
            Ok(())
        })
        .optional()?
        .is_some())
}

pub fn sync_project(
    db: &mut Connection,
    snapshot: &ProjectSnapshot,
    now: i64,
) -> Result<ProjectSummary, DiscoveryError> {
    if !valid_id(&snapshot.id)
        || !(1..=160).contains(&snapshot.name.trim().chars().count())
        || snapshot.notes.len() > 8000
        || snapshot.updated_at < 0
        || snapshot.content.len() > 2000
    {
        return Err(DiscoveryError::Invalid(
            "project id, name, notes or content count exceeds limits".into(),
        ));
    }
    for item in &snapshot.content {
        if !valid_id(&item.id)
            || item.name.trim().is_empty()
            || item.name.len() > 200
            || item.notes.len() > 4000
            || item.kind.len() > 50
            || item.stage.len() > 50
            || item.created_at.len() > 80
        {
            return Err(DiscoveryError::Invalid("invalid content index item".into()));
        }
    }
    let tx = db.transaction()?;
    let previous: Option<i64> = tx
        .query_row(
            "SELECT snapshot_revision FROM discovery_projects WHERE id=?1",
            [&snapshot.id],
            |row| row.get(0),
        )
        .optional()?;
    if previous.is_some_and(|old| snapshot.updated_at < old) {
        return Err(DiscoveryError::StaleSnapshot);
    }
    if !previous.is_some_and(|old| snapshot.updated_at == old) {
        tx.execute("INSERT INTO discovery_projects(id,name,notes,snapshot_revision,synced_at) VALUES (?1,?2,?3,?4,?5)
                    ON CONFLICT(id) DO UPDATE SET name=excluded.name,notes=excluded.notes,
                        snapshot_revision=excluded.snapshot_revision,synced_at=excluded.synced_at",
            params![snapshot.id, snapshot.name.trim(), snapshot.notes, snapshot.updated_at, now])?;
        tx.execute(
            "UPDATE discovery_project_content SET active=0 WHERE project_id=?1",
            [&snapshot.id],
        )?;
        for item in &snapshot.content {
            tx.execute("INSERT INTO discovery_project_content(project_id,id,name,notes,kind,stage,created_at,active,last_seen_at)
                VALUES (?1,?2,?3,?4,?5,?6,?7,1,?8) ON CONFLICT(project_id,id) DO UPDATE
                SET name=excluded.name,notes=excluded.notes,kind=excluded.kind,stage=excluded.stage,
                    active=1,last_seen_at=excluded.last_seen_at",
                params![snapshot.id, item.id, item.name, item.notes, item.kind, item.stage, item.created_at, now])?;
        }
    }
    let content_count = tx.query_row(
        "SELECT COUNT(*) FROM discovery_project_content WHERE project_id=?1 AND active=1",
        [&snapshot.id],
        |row| row.get::<_, i64>(0),
    )? as usize;
    tx.commit()?;
    Ok(ProjectSummary {
        id: snapshot.id.clone(),
        name: snapshot.name.clone(),
        notes: snapshot.notes.clone(),
        snapshot_revision: snapshot.updated_at,
        content_count,
    })
}

/// Only the browser's explicitly deleted project is removed. Retried deletes
/// are idempotent, and the manual FTS cleanup prevents orphaned virtual rows.
pub fn delete_project(db: &mut Connection, project_id: &str) -> Result<(), DiscoveryError> {
    if !valid_id(project_id) {
        return Err(DiscoveryError::Invalid(
            "Invalid project deletion target".into(),
        ));
    }
    let has_sessions: i64 = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM content_discovery_sessions WHERE project_id=?1)",
        [project_id], |row| row.get(0),
    )?;
    if has_sessions != 0 { return Err(DiscoveryError::HasSavedResearch); }
    let tx = db.transaction()?;
    tx.execute(
        "DELETE FROM kg_node_search WHERE project_id=?1",
        [project_id],
    )?;
    tx.execute("DELETE FROM discovery_projects WHERE id=?1", [project_id])?;
    tx.commit()?;
    Ok(())
}

pub fn list_keywords(
    db: &Connection,
    project_id: &str,
) -> Result<Vec<ProjectKeyword>, DiscoveryError> {
    if !project_exists(db, project_id)? {
        return Err(DiscoveryError::NotFound);
    }
    let mut statement = db.prepare(
        "SELECT id,text,kind,origin,active,manual_lock FROM discovery_project_keywords
        WHERE project_id=?1 ORDER BY kind, text COLLATE NOCASE",
    )?;
    let rows = statement.query_map([project_id], |row| {
        Ok(ProjectKeyword {
            id: row.get(0)?,
            text: row.get(1)?,
            kind: row.get(2)?,
            origin: row.get(3)?,
            active: row.get::<_, i64>(4)? != 0,
            manual_lock: row.get::<_, i64>(5)? != 0,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn patch_keywords(
    db: &mut Connection,
    project_id: &str,
    patch: KeywordPatch,
    now: i64,
) -> Result<Vec<ProjectKeyword>, DiscoveryError> {
    if !project_exists(db, project_id)? {
        return Err(DiscoveryError::NotFound);
    }
    if patch.add.len() > 40 || patch.remove.len() > 100 || patch.disable.len() > 100 {
        return Err(DiscoveryError::Invalid("keyword batch is too large".into()));
    }
    let mut normalized = Vec::with_capacity(patch.add.len());
    for draft in patch.add {
        let text = normalize(&draft.text);
        if !(2..=160).contains(&text.chars().count())
            || !matches!(draft.kind.as_str(), "topic" | "query" | "exclusion")
            || !matches!(draft.origin.as_str(), "manual" | "model")
        {
            return Err(DiscoveryError::Invalid(
                "keyword text, type or origin is invalid".into(),
            ));
        }
        normalized.push((text.to_lowercase(), text, draft.kind, draft.origin));
    }
    let tx = db.transaction()?;
    for id in patch.remove {
        tx.execute(
            "DELETE FROM discovery_project_keywords WHERE project_id=?1 AND id=?2",
            params![project_id, id],
        )?;
    }
    for id in patch.disable {
        tx.execute("UPDATE discovery_project_keywords SET active=0,updated_at=?3 WHERE project_id=?1 AND id=?2",
            params![project_id, id, now])?;
    }
    for (key, text, kind, origin) in normalized {
        let fingerprint =
            contentgen_core::sha256_hex(format!("{project_id}\0{kind}\0{key}").as_bytes());
        let id = format!("kw_{}", &fingerprint[..24]);
        tx.execute("INSERT INTO discovery_project_keywords(id,project_id,text,normalized,kind,origin,active,manual_lock,created_at,updated_at)
            VALUES (?1,?2,?3,?4,?5,?6,1,?7,?8,?8)
            ON CONFLICT(project_id,kind,normalized) DO UPDATE SET
                text=CASE WHEN manual_lock=1 AND excluded.origin='model' THEN text ELSE excluded.text END,
                origin=CASE WHEN manual_lock=1 AND excluded.origin='model' THEN origin ELSE excluded.origin END,
                manual_lock=CASE WHEN manual_lock=1 OR excluded.manual_lock=1 THEN 1 ELSE 0 END,
                active=CASE WHEN manual_lock=1 AND excluded.origin='model' THEN active ELSE 1 END,
                updated_at=excluded.updated_at",
            params![id, project_id, text, key, kind, origin, i64::from(origin=="manual"), now])?;
    }
    tx.commit()?;
    list_keywords(db, project_id)
}

pub fn get_bound_watchlists(
    db: &Connection,
    project_id: &str,
) -> Result<Vec<String>, DiscoveryError> {
    if !project_exists(db, project_id)? {
        return Err(DiscoveryError::NotFound);
    }
    let mut stmt = db.prepare("SELECT watchlist_id FROM discovery_project_watchlists WHERE project_id=?1 ORDER BY watchlist_id")?;
    Ok(stmt
        .query_map([project_id], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?)
}

pub fn set_bound_watchlists(
    db: &mut Connection,
    project_id: &str,
    watchlist_ids: &[String],
) -> Result<Vec<String>, DiscoveryError> {
    if !project_exists(db, project_id)? {
        return Err(DiscoveryError::NotFound);
    }
    if watchlist_ids.len() > 30 {
        return Err(DiscoveryError::Invalid(
            "too many watchlist mappings".into(),
        ));
    }
    let tx = db.transaction()?;
    tx.execute(
        "DELETE FROM discovery_project_watchlists WHERE project_id=?1",
        [project_id],
    )?;
    for id in watchlist_ids {
        if !valid_id(id) {
            return Err(DiscoveryError::Invalid("invalid watchlist id".into()));
        }
        tx.execute("INSERT OR IGNORE INTO discovery_project_watchlists(project_id,watchlist_id) VALUES (?1,?2)",
            params![project_id, id]).map_err(|err| if matches!(err, rusqlite::Error::SqliteFailure(_, _)) {
                DiscoveryError::Invalid("watchlist does not exist".into())
            } else { DiscoveryError::Db(err) })?;
    }
    tx.commit()?;
    get_bound_watchlists(db, project_id)
}
