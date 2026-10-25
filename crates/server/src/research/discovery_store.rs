//! Idempotent click-initiated discovery runs, review decisions and novelty checks.
use super::discovery_projects::{self, DiscoveryError};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
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
    pub session_id: Option<String>,
    pub input_revision: String,
    pub input_snapshot: serde_json::Value,
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
    let session_id = super::sessions_store::ensure_legacy_session(db, project_id, now)?;
    start_or_get_active_for_session(db, project_id, &session_id, input_revision, now)
}

pub fn start_or_get_active_for_session(
    db: &mut Connection,
    project_id: &str,
    session_id: &str,
    input_revision: &str,
    now: i64,
) -> Result<DiscoveryRun, DiscoveryError> {
    if input_revision.len() > 180 {
        return Err(DiscoveryError::Invalid("Invalid snapshot revision".into()));
    }
    // BEGIN IMMEDIATE serializes the check and insert across server connections.
    // The partial unique index is a second line of defense against double-clicks.
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    exists(&tx, project_id)?;
    let scoped: i64 = tx.query_row("SELECT EXISTS(SELECT 1 FROM content_discovery_sessions WHERE id=?1 AND project_id=?2)",
        params![session_id,project_id],|r|r.get(0))?;
    if scoped == 0 { return Err(DiscoveryError::NotFound); }
    let active:Option<String>=tx.query_row("SELECT id FROM discovery_runs WHERE project_id=?1 AND session_id=?2 AND status IN ('queued','running','paused')",
        params![project_id,session_id],|r|r.get(0)).optional()?;
    if let Some(active) = active {
        return get_run(&tx, project_id, &active);
    }
    // The browser's project catalog is mirrored here before the creator clicks.
    // Freeze the *server-side* current values transactionally: Resume may not
    // replace these with a different browser's latest description/keywords.
    let (name, description, revision): (String, String, i64) = tx.query_row(
        "SELECT name,notes,snapshot_revision FROM discovery_projects WHERE id=?1",
        [project_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    let content: Vec<serde_json::Value> = {
        let mut statement = tx.prepare(
            "SELECT name,stage FROM discovery_project_content
            WHERE project_id=?1 AND active=1 ORDER BY id",
        )?;
        statement
            .query_map([project_id], |row| {
                Ok(serde_json::json!({
                    "name":row.get::<_,String>(0)?,"stage":row.get::<_,String>(1)?
                }))
            })?
            .collect::<Result<_, _>>()?
    };
    let keywords = discovery_projects::list_keywords(&tx, project_id)?;
    let graph_revision: i64 = tx.query_row(
        "SELECT COALESCE(MAX(updated_at),0) FROM kg_nodes WHERE project_id=?1",
        [project_id],
        |row| row.get(0),
    )?;
    let research_freshness: i64 = tx.query_row(
        "SELECT COALESCE(MAX(observed_at),0) FROM kg_sources WHERE project_id=?1",
        [project_id],
        |row| row.get(0),
    )?;
    let (platforms_json,settings_json):(String,String)=tx.query_row(
        "SELECT platforms_json,settings_snapshot_json FROM content_discovery_sessions
         WHERE id=?1 AND project_id=?2",params![session_id,project_id],
        |r|Ok((r.get(0)?,r.get(1)?)))?;
    let platforms:serde_json::Value=serde_json::from_str(&platforms_json)
        .map_err(|_|DiscoveryError::Invalid("Stored session platforms are invalid".into()))?;
    let session_settings:serde_json::Value=serde_json::from_str(&settings_json)
        .map_err(|_|DiscoveryError::Invalid("Stored session settings are invalid".into()))?;
    let pinned = session_id.starts_with("session_");
    let frozen_name = if pinned { session_settings.pointer("/project/name").and_then(serde_json::Value::as_str) } else { None }
        .map(str::to_owned).unwrap_or(name);
    let frozen_description = if pinned { session_settings.pointer("/project/description").and_then(serde_json::Value::as_str) } else { None }
        .map(str::to_owned).unwrap_or(description);
    let frozen_revision = if pinned { session_settings.pointer("/project/revision").and_then(serde_json::Value::as_i64) } else { None };
    let frozen_keywords = if pinned { session_settings.pointer("/project/keywords").cloned() } else { None };
    let snapshot = serde_json::json!({"version":1,"projectName":frozen_name,
        "ideaScoreVersion":super::sessions_store::IDEA_SCORE_VERSION_V1,
        "description":frozen_description,
        "content":content,"keywords":frozen_keywords.unwrap_or_else(||serde_json::json!(keywords)),
        "projectRevision":frozen_revision.unwrap_or(revision),
        "sessionId":session_id,"platforms":platforms,"sessionSettings":session_settings,
        "graphRevision":graph_revision,"researchFreshness":research_freshness,
        "providerAvailability":{"googleTrends":"best_effort_unofficial"}});
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
    tx.execute("INSERT INTO discovery_runs(id,project_id,session_id,input_revision,input_snapshot_json,status,stage,created_at,updated_at)
        VALUES (?1,?2,?3,?4,?5,'queued','queued',?6,?6)",params![id,project_id,session_id,input_revision,snapshot.to_string(),now])?;
    tx.commit()?;
    get_run(db, project_id, &id)
}

fn valid_stage_key(key: &str) -> bool {
    (2..=80).contains(&key.len())
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | ':' | '.'))
}

/// Append-only, project-scoped stage checkpoint. Replaying a completed stage
/// cannot overwrite the original evidence/candidate payload.
pub fn save_stage_artifact(
    db: &Connection,
    project_id: &str,
    run_id: &str,
    key: &str,
    value: &serde_json::Value,
    now: i64,
) -> Result<serde_json::Value, DiscoveryError> {
    let serialized = value.to_string();
    if !valid_stage_key(key) || serialized.len() > 80_000 {
        return Err(DiscoveryError::Invalid(
            "Invalid discovery artifact key or size".into(),
        ));
    }
    let status: Option<String> = db
        .query_row(
            "SELECT status FROM discovery_runs WHERE project_id=?1 AND id=?2",
            params![project_id, run_id],
            |row| row.get(0),
        )
        .optional()?;
    if !matches!(status.as_deref(), Some("queued" | "running" | "paused")) {
        return Err(DiscoveryError::NotFound);
    }
    db.execute(
        "INSERT INTO discovery_run_artifacts(project_id,run_id,stage_key,payload_json,created_at)
        SELECT project_id,id,?3,?4,?5 FROM discovery_runs
        WHERE project_id=?1 AND id=?2 AND status IN ('queued','running','paused')
        ON CONFLICT(run_id,stage_key) DO NOTHING",
        params![project_id, run_id, key, serialized, now],
    )?;
    load_stage_artifact(db, project_id, run_id, key)?.ok_or(DiscoveryError::NotFound)
}

pub fn load_stage_artifact(
    db: &Connection,
    project_id: &str,
    run_id: &str,
    key: &str,
) -> Result<Option<serde_json::Value>, DiscoveryError> {
    if !valid_stage_key(key) {
        return Err(DiscoveryError::Invalid(
            "Invalid discovery artifact key".into(),
        ));
    }
    let belongs: i64 = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM discovery_runs WHERE project_id=?1 AND id=?2)",
        params![project_id, run_id],
        |row| row.get(0),
    )?;
    if belongs == 0 {
        return Err(DiscoveryError::NotFound);
    }
    let stored: Option<String> = db
        .query_row(
            "SELECT payload_json FROM discovery_run_artifacts
        WHERE project_id=?1 AND run_id=?2 AND stage_key=?3",
            params![project_id, run_id, key],
            |row| row.get(0),
        )
        .optional()?;
    stored
        .map(|raw| {
            serde_json::from_str(&raw)
                .map_err(|_| DiscoveryError::Invalid("Invalid saved discovery artifact".into()))
        })
        .transpose()
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
    // A delayed/retried Node checkpoint cannot move a durable market phase
    // backward into candidate generation or reopen a paused collection.
    let current: Option<String> = db.query_row(
        "SELECT stage FROM discovery_runs WHERE project_id=?1 AND id=?2",
        params![project_id,run_id], |r| r.get(0),
    ).optional()?;
    if current.as_deref().is_some_and(|stage| stage.starts_with("measure_market")) {
        return Ok(());
    }
    let changed = db.execute(
        "UPDATE discovery_runs SET stage=?3,status='running',updated_at=?4,
        provider_health_json=COALESCE(?5,provider_health_json)
        WHERE project_id=?1 AND id=?2 AND status IN ('queued','running','paused')
          AND stage NOT LIKE 'measure_market%'",
        params![
            project_id,
            run_id,
            stage,
            now,
            health.map(serde_json::Value::to_string)
        ],
    )?;
    if changed == 0 {
        // The Node checkpoint may race the candidate finish transaction.
        // That transition must win atomically, even if the SELECT above
        // observed the previous generation stage.
        let actual: Option<String> = db.query_row(
            "SELECT stage FROM discovery_runs WHERE project_id=?1 AND id=?2",
            params![project_id,run_id], |r| r.get(0),
        ).optional()?;
        if actual.as_deref().is_some_and(|stage| stage.starts_with("measure_market")) {
            return Ok(());
        }
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

/// Only creator-approved graph aliases may unify different names for a topic.
/// This is deterministic, local and reversible; it never lets a model silently
/// declare that unrelated videos cover the same subject.
type TopicAlias = (Vec<String>, Vec<String>);

fn canonical_topic_text(aliases: &[TopicAlias], value: &str) -> String {
    let mut words: Vec<String> = value
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(str::to_owned)
        .collect();
    for (phrase, replacement) in aliases {
        let mut normalized = Vec::with_capacity(words.len());
        let mut position = 0;
        while position < words.len() {
            if words[position..].starts_with(phrase.as_slice()) {
                normalized.extend(replacement.iter().cloned());
                position += phrase.len();
            } else {
                normalized.push(words[position].clone());
                position += 1;
            }
        }
        words = normalized;
    }
    // Narrow, context-sensitive equivalences for homeowner insurance videos.
    if words.iter().any(|word| word == "insurance") {
        for word in &mut words {
            if matches!(word.as_str(), "rate" | "rates") {
                *word = "premium".into();
            } else if matches!(
                word.as_str(),
                "increase" | "increases" | "increased" | "increasing"
            ) {
                *word = "rise".into();
            }
        }
    }
    words.join(" ")
}

fn topic_aliases(db: &Connection, project_id: &str) -> Result<Vec<TopicAlias>, DiscoveryError> {
    let mut statement = db.prepare(
        "SELECT a.normalized,n.label FROM kg_node_aliases a
        JOIN kg_nodes n ON n.project_id=a.project_id AND n.id=a.node_id
        WHERE a.project_id=?1",
    )?;
    let mut aliases = statement
        .query_map([project_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(|(alias, label)| {
            (
                alias
                    .split(|c: char| !c.is_alphanumeric())
                    .filter(|word| !word.is_empty())
                    .map(str::to_owned)
                    .collect::<Vec<_>>(),
                label
                    .to_lowercase()
                    .split(|c: char| !c.is_alphanumeric())
                    .filter(|word| !word.is_empty())
                    .map(str::to_owned)
                    .collect::<Vec<_>>(),
            )
        })
        .filter(|(alias, canonical)| !alias.is_empty() && !canonical.is_empty())
        .collect::<Vec<_>>();
    aliases.sort_by_key(|alias| std::cmp::Reverse(alias.0.len()));
    Ok(aliases)
}

pub fn is_duplicate(
    db: &Connection,
    project_id: &str,
    title: &str,
    angle_key: &str,
) -> Result<bool, DiscoveryError> {
    exists(db, project_id)?;
    let aliases = topic_aliases(db, project_id)?;
    let title = canonical_topic_text(&aliases, title);
    let angle_key = canonical_topic_text(&aliases, angle_key);
    let mut content = db.prepare(
        // Previously indexed content remains an already-covered angle even when
        // it is no longer in the browser's current catalog snapshot.
        "SELECT name,notes FROM discovery_project_content WHERE project_id=?1",
    )?;
    for row in content.query_map([project_id], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    })? {
        let (name, notes) = row?;
        let name = canonical_topic_text(&aliases, &name);
        let notes = canonical_topic_text(&aliases, &notes);
        if similar(&title, &name)
            || similar(&angle_key, &name)
            || (!notes.is_empty() && similar(&angle_key, &notes))
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
        let name = canonical_topic_text(&aliases, &name);
        let angle = canonical_topic_text(&aliases, &angle);
        if similar(&title, &name) || similar(&angle_key, &angle) || similar(&title, &angle) {
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
    ) || candidates.len() > 100
    {
        return Err(DiscoveryError::Invalid(
            "Invalid result status or candidate count".into(),
        ));
    }
    let tx = db.transaction()?;
    let (project_id,session_id):(String,Option<String>)=tx.query_row("SELECT project_id,session_id FROM discovery_runs WHERE id=?1 AND status IN ('queued','running','paused')",
        [run_id],|r|Ok((r.get(0)?,r.get(1)?))).optional()?.ok_or(DiscoveryError::NotFound)?;
    let result_limit = if session_id.as_deref().is_some_and(|id| id.starts_with("session_")) { 100 } else { 5 };
    // Validate *before* persisting any candidate. A search lead is not evidence,
    // and observed_at is only the import time (not a video's publishing date).
    let mut ranked = Vec::new();
    for draft in candidates {
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
        let mut score = match draft.confidence.as_str() {
            "high" => 2,
            "medium" => 1,
            _ => 0,
        };
        let mut unique_sources = std::collections::HashSet::new();
        for source_id in &draft.source_ids {
            if !unique_sources.insert(source_id) {
                continue;
            }
            let evidence: Option<(String, String, Option<i64>)> = tx
                .query_row(
                    "SELECT evidence_state,provider,CAST(strftime('%s',published_at) AS INTEGER) FROM kg_sources
                WHERE project_id=?1 AND id=?2",
                    params![project_id, source_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .optional()?;
            let (state, provider, published_at) = evidence.ok_or_else(|| {
                DiscoveryError::Invalid("Candidate cites a missing or foreign source".into())
            })?;
            let measured = if provider == "youtube-data-api" {
                tx.query_row(
                    "SELECT EXISTS(SELECT 1 FROM kg_trend_observations
                    WHERE project_id=?1 AND source_id=?2 AND provider='youtube-data-api'
                    AND value IS NOT NULL)",
                    params![project_id, source_id],
                    |r| r.get::<_, i64>(0),
                )? != 0
            } else {
                false
            };
            if state != "captured" && !measured {
                return Err(DiscoveryError::Invalid(
                    "Candidate needs a captured source passage or measured public video observation".into()));
            }
            if unique_sources.len() <= 3 {
                score += if state == "captured" { 3 } else { 2 };
                if published_at.is_some_and(|published| {
                    published <= now && now.saturating_sub(published) <= 45 * 86400
                }) {
                    score += 2;
                }
            }
        }
        ranked.push((score, draft));
    }
    ranked.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then_with(|| a.1.angle_key.cmp(&b.1.angle_key))
    });
    // Reserve breadth across specific, already-known project topics before
    // filling the remaining slots from a dominant topic. This never
    // invents trending velocity, and low-confidence entries still retain
    // their honest confidence labels.
    let aliases = topic_aliases(&tx, &project_id)?;
    let topic_families: Vec<std::collections::HashSet<String>> = {
        let mut query = tx.prepare(
            "SELECT label FROM kg_nodes WHERE project_id=?1 AND kind='topic' ORDER BY id",
        )?;
        query
            .query_map([&project_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?
            .iter()
            .map(|label| tokens(&canonical_topic_text(&aliases, label)))
            .filter(|family| family.len() >= 2)
            .collect()
    };
    let mut family_counts = std::collections::HashMap::<usize, usize>::new();
    let mut prioritized = Vec::new();
    let mut deferred = Vec::new();
    for item in ranked {
        let idea_tokens = tokens(&canonical_topic_text(&aliases, &item.1.title));
        let family = topic_families
            .iter()
            .enumerate()
            .filter(|(_, topics)| topics.is_subset(&idea_tokens))
            .max_by_key(|(_, topics)| topics.len())
            .map(|(index, _)| index);
        if let Some(family) = family {
            let count = family_counts.entry(family).or_default();
            *count += 1;
            if *count > 2 {
                deferred.push(item);
                continue;
            }
        }
        prioritized.push(item);
    }
    prioritized.extend(deferred);
    let mut selected: Vec<(String, String)> = vec![];
    let mut rank = 0;
    for (_, draft) in prioritized {
        if rank >= result_limit {
            break;
        }
        // An idea with no source cannot be presented as an evidence-backed discovery.
        if draft.source_ids.is_empty() {
            continue;
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
        // Keep a bounded source version alongside each candidate even if
        // the project graph is refreshed later. Source leads alone are not
        // treated as verified factual passages.
        let mut unique_sources = std::collections::HashSet::new();
        for source_id in &draft.source_ids {
            if !unique_sources.insert(source_id) {
                continue;
            }
            tx.execute("INSERT INTO discovery_candidate_sources
                (candidate_id,source_id,provider,url,title,observed_at,published_at,evidence_state,passage)
                SELECT ?1,id,provider,url,title,observed_at,published_at,evidence_state,substr(passage,1,1000)
                FROM kg_sources WHERE id=?2 AND project_id=?3",
                params![id,source_id,project_id])?;
        }
    }
    let final_status = if status == "completed" && rank == 0 {
        "insufficient_evidence"
    } else {
        status
    };
    // A named editorial session includes provider measurements in the same
    // Discovery job. Candidates are durable already, but the job is NOT ready
    // to navigate until every bounded market attempt has finished or failed.
    let measure_market = final_status == "completed"
        && session_id.as_deref().is_some_and(|id| id.starts_with("session_"));
    if measure_market {
        tx.execute("UPDATE discovery_runs SET status='running',stage='measure_market',updated_at=?2,finished_at=NULL WHERE id=?1",
            params![run_id,now])?;
    } else {
        tx.execute("UPDATE discovery_runs SET status=?2,stage='completed',updated_at=?3,finished_at=?3 WHERE id=?1",
            params![run_id,final_status,now])?;
    }
    tx.commit()?;
    Ok(())
}

/// Atomically claim one saved Discovery result for automatic enrichment. The
/// two stages are a SQLite lease: other collectors cannot duplicate provider
/// requests while a claimant is alive; restart reconciles stale claims.
pub fn claim_pending_market_run(
    db: &mut Connection,
    now: i64,
) -> Result<Option<String>, DiscoveryError> {
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let run: Option<String> = tx.query_row(
        "SELECT id FROM discovery_runs WHERE status='running' AND stage='measure_market'
         ORDER BY updated_at ASC,id ASC LIMIT 1",
        [], |row| row.get(0),
    ).optional()?;
    if let Some(ref id) = run {
        tx.execute("UPDATE discovery_runs SET stage='measure_market_collecting',updated_at=?2
                    WHERE id=?1 AND status='running' AND stage='measure_market'",
            params![id,now])?;
    }
    tx.commit()?;
    Ok(run)
}

/// The collector can be interrupted after provider reservations were written;
/// reset only its run claim on restart. Per-provider durable reservations are
/// independently reconciled and never silently replayed.
pub fn recover_interrupted_market_runs(db: &Connection, now: i64) -> Result<(), DiscoveryError> {
    db.execute("UPDATE discovery_runs SET stage='measure_market',updated_at=?1
                WHERE status='running' AND stage='measure_market_collecting'", [now])?;
    Ok(())
}

/// Complete exactly one claimed run, preserving provider-level partial status.
/// A cancellation or pause wins over an in-flight provider response.
pub fn finish_market_run(
    db: &Connection,
    run_id: &str,
    summary: &serde_json::Value,
    now: i64,
) -> Result<bool, DiscoveryError> {
    if !summary.is_object() || summary.to_string().len() > 3_000 {
        return Err(DiscoveryError::Invalid("Invalid market summary".into()));
    }
    Ok(db.execute(
        "UPDATE discovery_runs
         SET status='completed',stage='completed',updated_at=?2,finished_at=?2,
         provider_health_json=json_set(provider_health_json,'$.market',json(?3))
         WHERE id=?1 AND status='running' AND stage='measure_market_collecting'",
        params![run_id, now, summary.to_string()],
    )? == 1)
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
        WHERE project_id=?1 AND id=?2 AND status IN ('queued','running','paused')
          AND stage NOT LIKE 'measure_market%'",
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
        "UPDATE discovery_runs SET status='paused',
         stage='interrupted',updated_at=?3
        WHERE project_id=?1 AND id=?2 AND status IN ('queued','running')
          AND stage NOT LIKE 'measure_market%'",
        params![project_id, run_id, now],
    )? == 0
    {
        // The Node orphan detector may have fetched the previous stage just
        // before Rust persisted candidates. Market work is Rust-owned and
        // cannot be abandoned merely because no Node generator is active.
        let stage: Option<String> = db.query_row(
            "SELECT stage FROM discovery_runs WHERE project_id=?1 AND id=?2 AND status='running'",
            params![project_id,run_id], |r| r.get(0),
        ).optional()?;
        if stage.as_deref().is_some_and(|value| value.starts_with("measure_market")) {
            return Ok(());
        }
        return Err(DiscoveryError::NotFound);
    }
    Ok(())
}

pub fn cancel_run(
    db: &Connection,
    project_id: &str,
    run_id: &str,
    now: i64,
) -> Result<(), DiscoveryError> {
    if db.execute(
        "UPDATE discovery_runs SET status='cancelled',stage='cancelled',updated_at=?3,finished_at=?3
        WHERE project_id=?1 AND id=?2 AND status IN ('queued','running','paused')",
        params![project_id,run_id,now],
    )? == 0 {
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
        "UPDATE discovery_runs SET
            status=CASE WHEN stage='measure_market_paused' THEN 'running' ELSE 'queued' END,
            stage=CASE WHEN stage='measure_market_paused' THEN 'measure_market' ELSE 'queued' END,
            error_code=NULL,updated_at=?3
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
    if !matches!(decision, "saved" | "dismissed" | "storyboard" | "selected")
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
    let base=db.query_row("SELECT id,project_id,input_revision,status,stage,created_at,updated_at,error_code,provider_health_json,input_snapshot_json,session_id
        FROM discovery_runs WHERE project_id=?1 AND id=?2",params![project_id,run_id],|r|Ok((
            r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,
            r.get::<_,String>(4)?,r.get::<_,i64>(5)?,r.get::<_,i64>(6)?,r.get::<_,Option<String>>(7)?,
            r.get::<_,String>(8)?,r.get::<_,String>(9)?,r.get::<_,Option<String>>(10)?))).optional()?.ok_or(DiscoveryError::NotFound)?;
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
        session_id: base.10,
        input_revision: base.2,
        input_snapshot: serde_json::from_str(&base.9)
            .unwrap_or_else(|_| serde_json::json!({"version":0})),
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

