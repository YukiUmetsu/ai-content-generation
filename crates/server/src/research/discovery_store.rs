//! Idempotent click-initiated discovery runs, review decisions and novelty checks.
use super::discovery_projects::DiscoveryError;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateDraft {
    pub title: String,
    pub hook: String,
    pub premise: String,
    pub why_now: String,
    pub angle_key: String,
    pub source_ids: Vec<String>,
    pub confidence: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub id: String,
    pub rank: i64,
    pub title: String,
    pub hook: String,
    pub premise: String,
    pub why_now: String,
    pub angle_key: String,
    pub source_ids: Vec<String>,
    pub confidence: String,
    pub decision: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryRun {
    pub id: String,
    pub project_id: String,
    pub input_revision: String,
    pub status: String,
    pub stage: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub error_code: Option<String>,
    pub provider_health: serde_json::Value,
    pub candidates: Vec<Candidate>,
}

fn exists(db: &Connection, project_id: &str) -> Result<(), DiscoveryError> {
    if db
        .query_row(
            "SELECT 1 FROM discovery_projects WHERE id=?1",
            [project_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some()
    {
        Ok(())
    } else {
        Err(DiscoveryError::NotFound)
    }
}

pub fn start_or_get_active(
    db: &mut Connection,
    project_id: &str,
    input_revision: &str,
    now: i64,
) -> Result<DiscoveryRun, DiscoveryError> {
    exists(db, project_id)?;
    if input_revision.len() > 180 {
        return Err(DiscoveryError::Invalid("Invalid snapshot revision".into()));
    }
    let active:Option<String>=db.query_row("SELECT id FROM discovery_runs WHERE project_id=?1 AND status IN ('queued','running','paused')",
        [project_id],|r|r.get(0)).optional()?;
    if let Some(active) = active {
        return get_run(db, project_id, &active);
    }
    let mut randomness = [0u8; 12];
    getrandom::getrandom(&mut randomness)
        .map_err(|_| DiscoveryError::Invalid("Unable to create secure run ID".into()))?;
    let id = format!(
        "discover_{}",
        randomness
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    );
    db.execute("INSERT INTO discovery_runs(id,project_id,input_revision,status,stage,created_at,updated_at)
        VALUES (?1,?2,?3,'queued','queued',?4,?4)",params![id,project_id,input_revision,now])?;
    get_run(db, project_id, &id)
}

pub fn checkpoint(
    db: &Connection,
    project_id: &str,
    run_id: &str,
    stage: &str,
    now: i64,
    health: Option<&serde_json::Value>,
) -> Result<(), DiscoveryError> {
    exists(db, project_id)?;
    if stage.len() > 80
        || !stage
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | ':'))
    {
        return Err(DiscoveryError::Invalid("Invalid discovery stage".into()));
    }
    let changed = db.execute(
        "UPDATE discovery_runs SET stage=?3,status='running',updated_at=?4,
        provider_health_json=COALESCE(?5,provider_health_json)
        WHERE project_id=?1 AND id=?2 AND status IN ('queued','running','paused')",
        params![
            project_id,
            run_id,
            stage,
            now,
            health.map(serde_json::Value::to_string)
        ],
    )?;
    if changed == 0 {
        return Err(DiscoveryError::NotFound);
    }
    Ok(())
}

fn tokens(value: &str) -> std::collections::HashSet<String> {
    value
        .split(|c: char| !c.is_alphanumeric())
        .filter_map(|word| {
            let stem = word.to_lowercase();
            if stem.len() < 3
                || [
                    "why",
                    "the",
                    "for",
                    "and",
                    "with",
                    "that",
                    "this",
                    "what",
                    "how",
                    "much",
                    "more",
                    "real",
                    "costly",
                    "expensive",
                    "hidden",
                    "worth",
                    "than",
                    "versus",
                    "price",
                ]
                .contains(&stem.as_str())
            {
                return None;
            }
            let stem = if stem.starts_with("replac") {
                "replace".into()
            } else if stem.starts_with("instal") {
                "install".into()
            } else if stem.starts_with("insur") {
                "insurance".into()
            } else if stem.starts_with("pump") {
                "pump".into()
            } else if stem.starts_with("cost") {
                "cost".into()
            } else if stem.ends_with('s') {
                stem.trim_end_matches('s').to_owned()
            } else {
                stem
            };
            Some(stem)
        })
        .collect()
}
fn similar(a: &str, b: &str) -> bool {
    let a = tokens(a);
    let b = tokens(b);
    if a.is_empty() || b.is_empty() {
        return false;
    }
    let common = a.intersection(&b).count();
    common >= 2 && (common as f64 / a.len().min(b.len()) as f64 >= 0.67)
}

pub fn is_duplicate(
    db: &Connection,
    project_id: &str,
    title: &str,
    angle_key: &str,
) -> Result<bool, DiscoveryError> {
    exists(db, project_id)?;
    let mut content = db.prepare(
        "SELECT name,notes FROM discovery_project_content WHERE project_id=?1 AND active=1",
    )?;
    for row in content.query_map([project_id], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    })? {
        let (name, notes) = row?;
        if similar(title, &name)
            || similar(angle_key, &name)
            || (!notes.is_empty() && similar(angle_key, &notes))
        {
            return Ok(true);
        }
    }
    let mut candidates = db.prepare(
        "SELECT title,angle_key FROM discovery_candidates WHERE project_id=?1
        AND decision IN ('saved','dismissed','storyboard')",
    )?;
    for row in candidates.query_map([project_id], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    })? {
        let (name, angle) = row?;
        if similar(title, &name) || similar(angle_key, &angle) || similar(title, &angle) {
            return Ok(true);
        }
    }
    Ok(false)
}

pub fn finish_run(
    db: &mut Connection,
    run_id: &str,
    candidates: Vec<CandidateDraft>,
    status: &str,
    now: i64,
) -> Result<(), DiscoveryError> {
    if !matches!(
        status,
        "completed" | "insufficient_evidence" | "failed" | "cancelled"
    ) || candidates.len() > 20
    {
        return Err(DiscoveryError::Invalid(
            "Invalid result status or candidate count".into(),
        ));
    }
    let tx = db.transaction()?;
    let project_id:String=tx.query_row("SELECT project_id FROM discovery_runs WHERE id=?1 AND status IN ('queued','running','paused')",
        [run_id],|r|r.get(0)).optional()?.ok_or(DiscoveryError::NotFound)?;
    // Ranking uses source quality/freshness observations, never guessed view growth.
    let mut ranked = Vec::new();
    for draft in candidates {
        let mut score = match draft.confidence.as_str() {
            "high" => 2,
            "medium" => 1,
            _ => 0,
        };
        for source_id in &draft.source_ids {
            let evidence: Option<(String, i64)> = tx
                .query_row(
                    "SELECT evidence_state,observed_at FROM kg_sources
                WHERE project_id=?1 AND id=?2",
                    params![project_id, source_id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            if let Some((state, observed)) = evidence {
                score += 4;
                if state == "captured" {
                    score += 3;
                }
                if now.saturating_sub(observed) < 14 * 86400 {
                    score += 3;
                }
            }
        }
        ranked.push((score, draft));
    }
    ranked.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then_with(|| a.1.angle_key.cmp(&b.1.angle_key))
    });
    let mut selected: Vec<(String, String)> = vec![];
    let mut rank = 0;
    for (_, draft) in ranked {
        if rank >= 5 {
            break;
        }
        // An idea with no source cannot be presented as an evidence-backed discovery.
        if draft.source_ids.is_empty() {
            continue;
        }
        if draft.title.trim().len() < 6
            || draft.title.len() > 160
            || draft.hook.len() > 400
            || draft.premise.len() > 1000
            || draft.why_now.len() > 500
            || draft.angle_key.len() > 240
            || draft.source_ids.len() > 12
            || !matches!(draft.confidence.as_str(), "low" | "medium" | "high")
        {
            return Err(DiscoveryError::Invalid(
                "Candidate content exceeds bounded schema".into(),
            ));
        }
        let mut sources = std::collections::HashSet::new();
        for source_id in &draft.source_ids {
            if !sources.insert(source_id) {
                continue;
            }
            let count: i64 = tx.query_row(
                "SELECT COUNT(*) FROM kg_sources WHERE project_id=?1 AND id=?2",
                params![project_id, source_id],
                |r| r.get(0),
            )?;
            if count == 0 {
                return Err(DiscoveryError::Invalid(
                    "Candidate cites a missing or foreign source".into(),
                ));
            }
        }
        if is_duplicate(&tx, &project_id, &draft.title, &draft.angle_key)?
            || selected
                .iter()
                .any(|(title, key)| similar(&draft.title, title) || similar(&draft.angle_key, key))
        {
            continue;
        }
        selected.push((draft.title.clone(), draft.angle_key.clone()));
        rank += 1;
        let digest =
            contentgen_core::sha256_hex(format!("{run_id}:{rank}:{}", draft.angle_key).as_bytes());
        let id = format!("idea_{}", &digest[..24]);
        tx.execute("INSERT INTO discovery_candidates(id,project_id,run_id,rank,title,hook,premise,why_now,angle_key,confidence,source_ids_json)
            VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",params![id,project_id,run_id,rank,draft.title,
                draft.hook,draft.premise,draft.why_now,draft.angle_key,draft.confidence,serde_json::to_string(&draft.source_ids).unwrap_or_default()])?;
    }
    let final_status = if status == "completed" && rank == 0 {
        "insufficient_evidence"
    } else {
        status
    };
    tx.execute("UPDATE discovery_runs SET status=?2,stage='completed',updated_at=?3,finished_at=?3 WHERE id=?1",
        params![run_id,final_status,now])?;
    tx.commit()?;
    Ok(())
}

pub fn fail_run(
    db: &Connection,
    project_id: &str,
    run_id: &str,
    code: &str,
    now: i64,
) -> Result<(), DiscoveryError> {
    if code.len() > 80 || !code.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err(DiscoveryError::Invalid(
            "Invalid diagnostic error code".into(),
        ));
    }
    if db.execute(
        "UPDATE discovery_runs SET status='failed',error_code=?3,updated_at=?4
        WHERE project_id=?1 AND id=?2 AND status IN ('queued','running','paused')",
        params![project_id, run_id, code, now],
    )? == 0
    {
        return Err(DiscoveryError::NotFound);
    }
    Ok(())
}

pub fn pause_run(
    db: &Connection,
    project_id: &str,
    run_id: &str,
    now: i64,
) -> Result<(), DiscoveryError> {
    if db.execute(
        "UPDATE discovery_runs SET status='paused',stage='interrupted',updated_at=?3
        WHERE project_id=?1 AND id=?2 AND status IN ('queued','running')",
        params![project_id, run_id, now],
    )? == 0
    {
        return Err(DiscoveryError::NotFound);
    }
    Ok(())
}

pub fn resume_run(
    db: &Connection,
    project_id: &str,
    run_id: &str,
    now: i64,
) -> Result<(), DiscoveryError> {
    if db.execute(
        "UPDATE discovery_runs SET status='queued',stage='queued',error_code=NULL,updated_at=?3
        WHERE project_id=?1 AND id=?2 AND status IN ('paused','failed')",
        params![project_id, run_id, now],
    )? == 0
    {
        return Err(DiscoveryError::NotFound);
    }
    Ok(())
}

pub fn decide(
    db: &Connection,
    project_id: &str,
    candidate_id: &str,
    decision: &str,
    reason: Option<&str>,
    now: i64,
) -> Result<(), DiscoveryError> {
    if !matches!(decision, "saved" | "dismissed" | "storyboard")
        || reason.is_some_and(|s| s.len() > 300)
    {
        return Err(DiscoveryError::Invalid("Invalid idea decision".into()));
    }
    if db.execute(
        "UPDATE discovery_candidates SET decision=?3,decision_reason=?4,decision_at=?5
        WHERE project_id=?1 AND id=?2",
        params![project_id, candidate_id, decision, reason, now],
    )? == 0
    {
        return Err(DiscoveryError::NotFound);
    }
    Ok(())
}

pub fn get_run(
    db: &Connection,
    project_id: &str,
    run_id: &str,
) -> Result<DiscoveryRun, DiscoveryError> {
    exists(db, project_id)?;
    let base=db.query_row("SELECT id,project_id,input_revision,status,stage,created_at,updated_at,error_code,provider_health_json
        FROM discovery_runs WHERE project_id=?1 AND id=?2",params![project_id,run_id],|r|Ok((
            r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,
            r.get::<_,String>(4)?,r.get::<_,i64>(5)?,r.get::<_,i64>(6)?,r.get::<_,Option<String>>(7)?,
            r.get::<_,String>(8)?))).optional()?.ok_or(DiscoveryError::NotFound)?;
    let mut stmt = db.prepare(
        "SELECT id,rank,title,hook,premise,why_now,angle_key,source_ids_json,confidence,decision
        FROM discovery_candidates WHERE run_id=?1 AND project_id=?2 ORDER BY rank",
    )?;
    let candidates = stmt
        .query_map(params![run_id, project_id], |r| {
            let source_ids_json: String = r.get(7)?;
            Ok(Candidate {
                id: r.get(0)?,
                rank: r.get(1)?,
                title: r.get(2)?,
                hook: r.get(3)?,
                premise: r.get(4)?,
                why_now: r.get(5)?,
                angle_key: r.get(6)?,
                source_ids: serde_json::from_str(&source_ids_json).unwrap_or_default(),
                confidence: r.get(8)?,
                decision: r.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(DiscoveryRun {
        id: base.0,
        project_id: base.1,
        input_revision: base.2,
        status: base.3,
        stage: base.4,
        created_at: base.5,
        updated_at: base.6,
        error_code: base.7,
        provider_health: serde_json::from_str(&base.8).unwrap_or_else(|_| serde_json::json!({})),
        candidates,
    })
}

pub fn list_runs(db: &Connection, project_id: &str) -> Result<Vec<DiscoveryRun>, DiscoveryError> {
    exists(db, project_id)?;
    let ids = {
        let mut stmt = db.prepare(
            "SELECT id FROM discovery_runs WHERE project_id=?1 ORDER BY created_at DESC LIMIT 30",
        )?;
        stmt.query_map([project_id], |r| r.get(0))?
            .collect::<Result<Vec<String>, _>>()?
    };
    ids.iter().map(|id| get_run(db, project_id, id)).collect()
}
