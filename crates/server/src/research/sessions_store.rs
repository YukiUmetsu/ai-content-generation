//! Durable discovery sessions. A session is not a Project and can own many runs.
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

use super::discovery_projects::DiscoveryError;
use super::discovery_store::{self, Candidate, CandidateDraft, DiscoveryRun};
use super::idea_market::{self, IdeaMarketAssessment};
use super::idea_trends::{self, GoogleTrendsAssessment};

/// Keep v1 semantics unchanged for saved runs; newer formulas must use a new
/// version and a separate evaluator rather than reinterpreting old scores.
pub(crate) const IDEA_SCORE_VERSION_V1: &str = "evidence-readiness-v1";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverySession {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub platforms: Vec<String>,
    pub settings_snapshot: serde_json::Value,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub archived_at: Option<i64>,
    pub idea_count: i64,
    pub last_run: Option<DiscoveryRun>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaSource {
    pub id: String,
    pub provider: String,
    pub url: String,
    pub title: String,
    pub observed_at: i64,
    pub published_at: Option<String>,
    pub evidence_state: String,
    pub passage: Option<String>,
}

/// This is a captured excerpt for drafting, NOT an independently verified
/// factual claim. Clients must keep reviewStatus=unverified until reviewed.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEvidence {
    pub claim_id: String,
    pub claim_text: String,
    pub source_id: String,
    pub source_url: String,
    pub quote: String,
    pub review_status: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionIdea {
    #[serde(flatten)]
    pub candidate: Candidate,
    pub session_id: String,
    pub run_id: String,
    pub opportunity_score: Option<f64>,
    pub score_version: Option<String>,
    pub score_inputs: serde_json::Value,
    pub platform_fit: serde_json::Value,
    pub sources: Vec<IdeaSource>,
    pub evidence: Vec<SessionEvidence>,
    pub market_assessment: Option<IdeaMarketAssessment>,
    pub google_trends: Option<GoogleTrendsAssessment>,
}

pub(crate) fn random_id(prefix: &str) -> Result<String, DiscoveryError> {
    let mut bytes = [0u8; 12];
    getrandom::getrandom(&mut bytes)
        .map_err(|_| DiscoveryError::Invalid("Unable to generate secure identifier".into()))?;
    Ok(format!("{prefix}_{}", bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()))
}

pub(crate) fn validate_platforms(platforms: &[String]) -> Result<(), DiscoveryError> {
    if platforms.is_empty() || platforms.len() > 7 {
        return Err(DiscoveryError::Invalid("Choose between one and seven platforms".into()));
    }
    let mut unique = std::collections::HashSet::new();
    for platform in platforms {
        if !matches!(platform.as_str(), "youtube" | "youtube_shorts" | "tiktok" | "instagram" | "facebook" | "blog" | "website")
            || !unique.insert(platform.as_str())
        {
            return Err(DiscoveryError::Invalid("Invalid or repeated platform".into()));
        }
    }
    Ok(())
}

fn project_exists(db: &Connection, project_id: &str) -> Result<(), DiscoveryError> {
    if db.query_row("SELECT 1 FROM discovery_projects WHERE id=?1", [project_id], |_| Ok(()))
        .optional()?.is_some() {
        Ok(())
    } else {
        Err(DiscoveryError::NotFound)
    }
}

pub fn create_session(
    db: &Connection,
    project_id: &str,
    name: &str,
    platforms: &[String],
    settings_snapshot: &serde_json::Value,
    now: i64,
) -> Result<DiscoverySession, DiscoveryError> {
    project_exists(db, project_id)?;
    validate_platforms(platforms)?;
    if name.chars().count() > 160 || !settings_snapshot.is_object()
        || settings_snapshot.to_string().len() > 16_000 || now < 0 {
        return Err(DiscoveryError::Invalid("Invalid session settings or name".into()));
    }
    if settings_snapshot.get("version").is_some_and(|value| value.as_u64() != Some(1)) {
        return Err(DiscoveryError::Invalid("Unsupported session settings version".into()));
    }
    let (project_name,project_notes,project_revision):(String,String,i64) = db.query_row(
        "SELECT name,notes,snapshot_revision FROM discovery_projects WHERE id=?1",
        [project_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
    let mut frozen_settings = settings_snapshot.clone();
    if frozen_settings.get("version").is_none() {
        frozen_settings["version"] = serde_json::json!(1);
    }
    let keywords=super::discovery_projects::list_keywords(db,project_id)?;
    let watchlist_ids=super::discovery_projects::get_bound_watchlists(db,project_id)?;
    frozen_settings["project"] = serde_json::json!({
        "name":project_name,"description":project_notes,"revision":project_revision,
        "keywords":keywords,"watchlistIds":watchlist_ids,
    });
    let id = random_id("session")?;
    let serialized_platforms = serde_json::to_string(platforms)
        .map_err(|_| DiscoveryError::Invalid("Cannot encode session platforms".into()))?;
    db.execute("INSERT INTO content_discovery_sessions
        (id,project_id,name,platforms_json,settings_snapshot_json,created_at,updated_at)
        VALUES (?1,?2,?3,?4,?5,?6,?6)",
        params![id,project_id,name.trim(),serialized_platforms,frozen_settings.to_string(),now])?;
    get_session(db, project_id, &id)
}

/// Legacy callers keep the old project-scoped click semantics, while their
/// new runs are linked to a stable imported session for compatibility.
pub fn ensure_legacy_session(
    db: &Connection,
    project_id: &str,
    now: i64,
) -> Result<String, DiscoveryError> {
    project_exists(db, project_id)?;
    // Migration assigns each old run a separate `legacy_<runId>` session.
    // An unfinished pre-migration run must keep its identity on the old API.
    let imported_active: Option<String> = db.query_row(
        "SELECT session_id FROM discovery_runs WHERE project_id=?1
         AND session_id LIKE 'legacy_%' AND status IN ('queued','running','paused')
         ORDER BY created_at DESC LIMIT 1",
        [project_id],|r|r.get(0),
    ).optional()?;
    if let Some(active) = imported_active { return Ok(active); }
    let id = format!("legacy_project_{project_id}");
    db.execute("INSERT OR IGNORE INTO content_discovery_sessions
        (id,project_id,name,platforms_json,settings_snapshot_json,created_at,updated_at)
        VALUES (?1,?2,'Legacy discovery','[]','{\"version\":0}',?3,?3)",
        params![id,project_id,now])?;
    Ok(id)
}

fn last_run(db: &Connection, project_id: &str, session_id: &str) -> Result<Option<DiscoveryRun>, DiscoveryError> {
    let id: Option<String> = db.query_row(
        "SELECT id FROM discovery_runs WHERE project_id=?1 AND session_id=?2
         ORDER BY created_at DESC,id DESC LIMIT 1",
        params![project_id,session_id], |r| r.get(0),
    ).optional()?;
    id.map(|id| discovery_store::get_run(db, project_id, &id)).transpose()
}

pub fn get_session(
    db: &Connection,
    project_id: &str,
    session_id: &str,
) -> Result<DiscoverySession, DiscoveryError> {
    let stored = db.query_row(
        "SELECT name,platforms_json,settings_snapshot_json,created_at,updated_at,archived_at
         FROM content_discovery_sessions WHERE id=?1 AND project_id=?2",
        params![session_id,project_id],
        |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,
            r.get::<_,i64>(3)?,r.get::<_,i64>(4)?,r.get::<_,Option<i64>>(5)?)),
    ).optional()?.ok_or(DiscoveryError::NotFound)?;
    let platforms = serde_json::from_str(&stored.1)
        .map_err(|_| DiscoveryError::Invalid("Stored session platforms are invalid".into()))?;
    let settings_snapshot = serde_json::from_str(&stored.2)
        .map_err(|_| DiscoveryError::Invalid("Stored session settings are invalid".into()))?;
    let last_run = last_run(db, project_id, session_id)?;
    let idea_count: i64 = db.query_row("SELECT COUNT(*) FROM discovery_candidates c
        JOIN discovery_runs r ON r.id=c.run_id
        WHERE r.session_id=?1 AND r.project_id=?2", params![session_id,project_id],|r|r.get(0))?;
    let status = if stored.5.is_some() {
        "archived".to_owned()
    } else if let Some(run) = &last_run {
        run.status.clone()
    } else {
        "ready".to_owned()
    };
    let updated_at = last_run.as_ref().map_or(stored.4, |run| stored.4.max(run.updated_at));
    Ok(DiscoverySession {
        id: session_id.into(),project_id: project_id.into(),name:stored.0,
        platforms,settings_snapshot,status,created_at:stored.3,updated_at,
        archived_at:stored.5,idea_count,last_run,
    })
}

pub fn list_sessions(db: &Connection, project_id: &str) -> Result<Vec<DiscoverySession>, DiscoveryError> {
    project_exists(db, project_id)?;
    let ids = {
        let mut statement = db.prepare(
            "SELECT id FROM content_discovery_sessions WHERE project_id=?1
             ORDER BY created_at DESC,id DESC LIMIT 100")?;
        let rows = statement.query_map([project_id], |r| r.get::<_,String>(0))?;
        rows.collect::<Result<Vec<_>,_>>()?
    };
    ids.iter().map(|id| get_session(db, project_id, id)).collect()
}

pub fn update_session(
    db: &Connection,
    project_id: &str,
    session_id: &str,
    name: Option<&str>,
    archived: Option<bool>,
    now: i64,
) -> Result<DiscoverySession, DiscoveryError> {
    if name.is_some_and(|v| v.chars().count() > 160) || now < 0 {
        return Err(DiscoveryError::Invalid("Invalid session name".into()));
    }
    let existing = get_session(db, project_id, session_id)?;
    let next_name = name.unwrap_or(&existing.name).trim();
    let archived_at = match archived {
        Some(true) => Some(existing.archived_at.unwrap_or(now)),
        Some(false) => None,
        None => existing.archived_at,
    };
    db.execute("UPDATE content_discovery_sessions SET name=?3,archived_at=?4,updated_at=?5
        WHERE id=?1 AND project_id=?2",params![session_id,project_id,next_name,archived_at,now])?;
    get_session(db, project_id, session_id)
}

pub fn start_or_get_active(
    db: &mut Connection,
    project_id: &str,
    session_id: &str,
    input_revision: &str,
    now: i64,
) -> Result<DiscoveryRun, DiscoveryError> {
    let session = get_session(db, project_id, session_id)?;
    if session.archived_at.is_some() {
        return Err(DiscoveryError::Invalid("Archived sessions cannot start new runs".into()));
    }
    discovery_store::start_or_get_active_for_session(db, project_id, session_id, input_revision, now)
}

pub fn list_session_runs(
    db: &Connection,
    project_id: &str,
    session_id: &str,
) -> Result<Vec<DiscoveryRun>, DiscoveryError> {
    get_session(db, project_id, session_id)?;
    let ids = {
        let mut statement = db.prepare(
            "SELECT id FROM discovery_runs WHERE project_id=?1 AND session_id=?2
             ORDER BY created_at DESC,id DESC LIMIT 100")?;
        let rows = statement.query_map(params![project_id,session_id], |r| r.get::<_,String>(0))?;
        rows.collect::<Result<Vec<_>,_>>()?
    };
    ids.iter().map(|id| discovery_store::get_run(db, project_id, id)).collect()
}

pub fn finish_session_run(
    db: &mut Connection, project_id: &str, session_id: &str, run_id: &str,
    candidates: Vec<CandidateDraft>, status: &str, now: i64,
) -> Result<(), DiscoveryError> {
    let belongs: i64 = db.query_row("SELECT EXISTS(SELECT 1 FROM discovery_runs
        WHERE id=?1 AND project_id=?2 AND session_id=?3)",
        params![run_id,project_id,session_id],|r|r.get(0))?;
    if belongs == 0 { return Err(DiscoveryError::NotFound); }
    discovery_store::finish_run(db, run_id, candidates, status, now)
}

/// This is an editorial *research-readiness* heuristic, not a forecast of
/// search demand, clicks, retention, revenue or the odds of a video succeeding.
/// Use only the immutable source excerpts saved with the candidate so older
/// sessions remain comparable if the live research graph changes later.
fn score_idea_v1(candidate: &Candidate, sources: &[IdeaSource]) -> (Option<f64>, serde_json::Value) {
    let mut unique = std::collections::HashSet::new();
    let mut captured_passages = 0u32;
    let mut public_video_leads = 0u32;
    for source in sources {
        if !unique.insert(source.id.as_str()) { continue; }
        if source.evidence_state == "captured"
            && source.passage.as_deref().is_some_and(|text| !text.trim().is_empty()) {
            captured_passages += 1;
        } else if source.provider == "youtube-data-api" && source.evidence_state == "lead_only" {
            // This is a recorded *lead*, not verified evidence of viewer demand.
            public_video_leads += 1;
        }
    }
    let source_points = (captured_passages.min(3) * 20 + public_video_leads.min(3) * 10).min(60);
    let confidence_points = match candidate.confidence.as_str() {
        "high" => 20, "medium" => 10, "low" => 5, _ => 0,
    };
    let editorial_points = u32::from(!candidate.hook.trim().is_empty()) * 8
        + u32::from(!candidate.premise.trim().is_empty()) * 8
        + u32::from(!candidate.why_now.trim().is_empty()) * 4;
    let score = if source_points > 0 {
        Some(f64::from(source_points + confidence_points + editorial_points))
    } else { None };
    (score, serde_json::json!({
        "capturedPassages": captured_passages,
        "publicVideoLeads": public_video_leads,
        "sourcePoints": source_points,
        "candidateConfidence": candidate.confidence,
        "confidencePoints": confidence_points,
        "editorialReadinessPoints": editorial_points,
        "audienceDemand": "unknown",
        "searchVolume": "unknown",
        "scoreMeaning": "Research readiness only; not predicted video performance",
    }))
}

pub fn list_ideas(
    db: &Connection, project_id: &str, session_id: &str,
) -> Result<Vec<SessionIdea>, DiscoveryError> {
    let runs = list_session_runs(db, project_id, session_id)?;
    let mut ideas = Vec::new();
    for run in runs {
        // Runs created before score versioning are grandfathered into v1.
        // A future v2 must dispatch to another evaluator, not rewrite v1.
        let score_version = run.input_snapshot.get("ideaScoreVersion")
            .and_then(serde_json::Value::as_str).unwrap_or(IDEA_SCORE_VERSION_V1);
        if score_version != IDEA_SCORE_VERSION_V1 {
            return Err(DiscoveryError::Invalid("Unsupported frozen idea scoring version".into()));
        }
        for candidate in run.candidates {
            let sources = {
                let mut stmt = db.prepare("SELECT source_id,provider,url,title,observed_at,published_at,evidence_state,passage
                    FROM discovery_candidate_sources WHERE candidate_id=?1 ORDER BY source_id")?;
                let rows = stmt.query_map([&candidate.id], |r| Ok(IdeaSource {
                    id:r.get(0)?,provider:r.get(1)?,url:r.get(2)?,title:r.get(3)?,
                    observed_at:r.get(4)?,published_at:r.get(5)?,evidence_state:r.get(6)?,passage:r.get(7)?,
                }))?;
                rows.collect::<Result<Vec<_>,_>>()?
            };
            let evidence = sources.iter().enumerate().filter_map(|(position, source)| {
                let passage = source.passage.as_deref()?.trim();
                if source.evidence_state != "captured" || passage.is_empty() { return None; }
                Some(SessionEvidence {
                    claim_id:format!("claim_{}_{}",candidate.id,position),
                    claim_text:passage.to_owned(),
                    source_id:source.id.clone(),source_url:source.url.clone(),
                    quote:passage.to_owned(),review_status:"unverified".into(),
                })
            }).collect();
            let (opportunity_score, score_inputs) = score_idea_v1(&candidate, &sources);
            ideas.push(SessionIdea {
                candidate,session_id:session_id.to_owned(),run_id:run.id.clone(),
                opportunity_score,score_version:Some(score_version.into()),
                score_inputs,platform_fit:serde_json::json!({}),sources,evidence,
                market_assessment:None,
                google_trends:None,
            });
        }
    }
    // Historical evidence-readiness values above remain unchanged. Market
    // ranking is separately dated and only comparable within this session.
    let mut assessments = ideas.iter().map(|idea| {
        idea_market::latest_assessment(db, &idea.candidate.id, super::market_api::epoch_now())
    }).collect::<Result<Vec<_>,_>>().map_err(|_| DiscoveryError::Invalid("Saved market assessments unavailable".into()))?;
    idea_market::assign_session_percentiles(&mut assessments);
    for (idea, assessment) in ideas.iter_mut().zip(assessments) {
        idea.market_assessment = assessment;
        idea.google_trends = idea_trends::latest_assessment(
            db, &idea.candidate.id, super::market_api::epoch_now(),
        ).map_err(|_| DiscoveryError::Invalid("Saved Google Trends assessment unavailable".into()))?;
    }
    Ok(ideas)
}

pub fn decide_idea(
    db: &Connection, project_id: &str, session_id: &str, idea_id: &str,
    decision: &str, reason: Option<&str>, now: i64,
) -> Result<(), DiscoveryError> {
    let belongs: i64 = db.query_row("SELECT EXISTS(SELECT 1 FROM discovery_candidates c
        JOIN discovery_runs r ON r.id=c.run_id
        WHERE c.id=?1 AND c.project_id=?2 AND r.session_id=?3)",
        params![idea_id,project_id,session_id],|r|r.get(0))?;
    if belongs == 0 { return Err(DiscoveryError::NotFound); }
    discovery_store::decide(db, project_id, idea_id, decision, reason, now)
}

