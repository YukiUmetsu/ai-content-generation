//! Production identities link chosen research ideas back to their original brand.
//! They never implicitly create another Project.
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

use crate::research::discovery_projects::DiscoveryError;
use crate::research::sessions_store::{random_id, validate_platforms};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Production {
    pub id: String,
    pub project_id: String,
    pub session_id: String,
    pub idea_id: String,
    pub brief: serde_json::Value,
    pub platforms: Vec<String>,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

pub fn create_production(
    db: &Connection,
    project_id: &str,
    session_id: &str,
    idea_id: &str,
    brief: &serde_json::Value,
    platforms: &[String],
    now: i64,
) -> Result<Production, DiscoveryError> {
    validate_platforms(platforms)?;
    if !brief.is_object() || brief.to_string().len() > 24_000 || now < 0 {
        return Err(DiscoveryError::Invalid("Invalid production brief".into()));
    }
    let decision: Option<Option<String>> = db.query_row(
        "SELECT c.decision FROM discovery_candidates c JOIN discovery_runs r ON r.id=c.run_id
         JOIN content_discovery_sessions s ON s.id=r.session_id
         WHERE c.id=?1 AND c.project_id=?2 AND r.session_id=?3 AND s.project_id=?2",
        params![idea_id,project_id,session_id], |r| r.get(0),
    ).optional()?;
    match decision {
        None => return Err(DiscoveryError::NotFound),
        Some(Some(ref value)) if value == "dismissed" => {
            return Err(DiscoveryError::Invalid("Dismissed ideas cannot start productions".into()));
        }
        _ => {}
    }
    // Use readable hyphenated IDs accepted by existing production consumers.
    let id = random_id("production")?.replacen('_', "-", 1);
    let serialized_platforms = serde_json::to_string(platforms)
        .map_err(|_| DiscoveryError::Invalid("Cannot encode production platforms".into()))?;
    db.execute("INSERT INTO content_productions
        (id,project_id,session_id,idea_id,brief_json,platforms_json,created_at,updated_at)
        VALUES (?1,?2,?3,?4,?5,?6,?7,?7)",
        params![id,project_id,session_id,idea_id,brief.to_string(),serialized_platforms,now])?;
    get_production(db, &id)
}

pub fn get_production(db: &Connection, id: &str) -> Result<Production, DiscoveryError> {
    let stored = db.query_row("SELECT id,project_id,session_id,idea_id,brief_json,platforms_json,
            status,created_at,updated_at FROM content_productions WHERE id=?1",
        [id], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,
            r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?,
            r.get::<_,String>(6)?,r.get::<_,i64>(7)?,r.get::<_,i64>(8)?)))
        .optional()?.ok_or(DiscoveryError::NotFound)?;
    Ok(Production {
        id:stored.0,project_id:stored.1,session_id:stored.2,idea_id:stored.3,
        brief:serde_json::from_str(&stored.4).map_err(|_| DiscoveryError::Invalid("Stored production brief is invalid".into()))?,
        platforms:serde_json::from_str(&stored.5).map_err(|_| DiscoveryError::Invalid("Stored production platforms are invalid".into()))?,
        status:stored.6,created_at:stored.7,updated_at:stored.8,
    })
}

pub fn list_productions(db: &Connection, project_id: &str) -> Result<Vec<Production>, DiscoveryError> {
    let exists = db.query_row("SELECT 1 FROM discovery_projects WHERE id=?1", [project_id], |_r| Ok(()))
        .optional()?.is_some();
    if !exists { return Err(DiscoveryError::NotFound); }
    let ids = {
        let mut stmt = db.prepare("SELECT id FROM content_productions WHERE project_id=?1
            ORDER BY created_at DESC,id DESC LIMIT 200")?;
        let rows = stmt.query_map([project_id],|r|r.get::<_,String>(0))?;
        rows.collect::<Result<Vec<_>,_>>()?
    };
    ids.iter().map(|id|get_production(db,id)).collect()
}

pub fn list_all_productions(db: &Connection) -> Result<Vec<Production>, DiscoveryError> {
    let ids = {
        let mut stmt = db.prepare("SELECT id FROM content_productions ORDER BY created_at DESC,id DESC LIMIT 200")?;
        let rows = stmt.query_map([],|r|r.get::<_,String>(0))?;
        rows.collect::<Result<Vec<_>,_>>()?
    };
    ids.iter().map(|id|get_production(db,id)).collect()
}
