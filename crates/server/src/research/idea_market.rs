//! Explicit, quota-limited YouTube comparisons for individual discovery ideas.
//! An assessment is public metadata, not evidence for factual claims or a
//! forecast of creator performance. The v1 research-readiness score is separate.

use std::collections::{HashMap, HashSet};

use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::Serialize;

use super::{
    market_store::VideoObservation,
    youtube_api::{AudienceQuestion, YoutubeClient},
};
use crate::state::AppState;

const DAY: i64 = 86_400;
const RETENTION: i64 = 30 * DAY;
const MIN_RETRY: i64 = 3_600;
const METRIC_VERSION: &str = "youtube-comparables-v1";
type StoredAssessment = (
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    i64,
    Option<i64>,
    Option<String>,
    i64,
);

#[derive(Debug, thiserror::Error)]
pub enum IdeaMarketError {
    #[error("local database operation failed")]
    Db(#[from] rusqlite::Error),
    #[error("invalid YouTube market query or format")]
    Invalid,
    #[error("idea not found in this discovery session")]
    NotFound,
    #[error("an assessment is running, or this idea was measured in the last hour")]
    Busy,
    #[error("the local daily YouTube search budget is exhausted")]
    Budget,
    #[error("unable to reserve a secure assessment identifier")]
    Identifier,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaMarketRun {
    pub id: String,
    pub idea_id: String,
    pub query: String,
    pub format: String,
    pub region: String,
    pub language: String,
    pub started_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaMarketVideo {
    pub video_id: String,
    pub title: String,
    pub channel_title: String,
    pub view_count: Option<i64>,
    pub published_at: String,
    pub source_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaMarketAssessment {
    pub run_id: String,
    pub state: String,
    pub query: String,
    pub search_queries: Vec<String>,
    pub format: String,
    pub metric_version: String,
    pub region: String,
    pub language: String,
    pub observed_at: Option<i64>,
    pub next_collection_at: i64,
    pub searched_videos: usize,
    pub sample_size: usize,
    pub distinct_channels: usize,
    pub median_views: Option<f64>,
    pub p75_views: Option<f64>,
    pub median_views_per_day: Option<f64>,
    pub recent_uploads90d: usize,
    /// Smoothed percentile *within this saved session and format*, not a forecast.
    pub comparison_score: Option<f64>,
    pub comparison_cohort_size: usize,
    /// Ratio to other public uploads from the same channel, mapped to 0-100.
    /// Not a virality probability; baseline may come from just one channel.
    pub channel_breakout_score: Option<f64>,
    pub channel_baseline_videos: usize,
    pub channel_baseline_channels: usize,
    /// Attributed source uploads supporting the per-channel comparison.
    pub channel_baseline_examples: Vec<IdeaMarketVideo>,
    /// Actual snapshot-to-snapshot count difference, NEVER age extrapolation.
    pub observed_7d_median_view_delta: Option<f64>,
    pub observed_7d_video_count: usize,
    pub observed_30d_median_view_delta: Option<f64>,
    pub observed_30d_video_count: usize,
    pub error_code: Option<String>,
    pub videos: Vec<IdeaMarketVideo>,
    pub audience_questions: Vec<AudienceQuestion>,
}

/// Atomically validate ownership and reserve the SAME quota as watchlist runs.
/// All reservations count even when Google rejects the request.
pub fn claim_assessment(
    db: &mut Connection,
    project: &str,
    session: &str,
    idea: &str,
    query: &str,
    format: &str,
    now: i64,
) -> Result<IdeaMarketRun, IdeaMarketError> {
    let query = query.trim();
    if !(3..=120).contains(&query.chars().count())
        || query.chars().any(char::is_control)
        || !matches!(format, "long" | "shorts")
        || !(1..=i64::MAX - RETENTION).contains(&now)
    {
        return Err(IdeaMarketError::Invalid);
    }
    let txn = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let exists: i64 = txn.query_row(
        "SELECT EXISTS(SELECT 1 FROM discovery_candidates c JOIN discovery_runs r ON r.id=c.run_id
         WHERE c.id=?1 AND c.project_id=?2 AND r.session_id=?3)",
        params![idea, project, session],
        |row| row.get(0),
    )?;
    if exists == 0 {
        return Err(IdeaMarketError::NotFound);
    }
    let recent: Option<(String, i64, i64)> = txn
        .query_row(
            "SELECT state,started_at,
             EXISTS(SELECT 1 FROM market_search_budget WHERE run_id=idea_market_runs.id)
             FROM idea_market_runs WHERE idea_id=?1
         ORDER BY started_at DESC,rowid DESC LIMIT 1",
            [idea],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    if recent.is_some_and(|(state, started, reserved)| {
        state == "running" || (reserved != 0 && now < started.saturating_add(MIN_RETRY))
    }) {
        return Err(IdeaMarketError::Busy);
    }
    let used: i64 = txn.query_row(
        "SELECT COUNT(*) FROM market_search_budget WHERE reserved_at>?1",
        [now - DAY],
        |row| row.get(0),
    )?;
    if used >= 20 {
        return Err(IdeaMarketError::Budget);
    }
    let mut bytes = [0u8; 12];
    getrandom::getrandom(&mut bytes).map_err(|_| IdeaMarketError::Identifier)?;
    let id = format!(
        "idea_market_{}",
        bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()
    );
    txn.execute(
        "INSERT INTO idea_market_runs(id,idea_id,query,format,metric_version,region,language,state,started_at)
         VALUES(?1,?2,?3,?4,?5,'US','en','running',?6)",
        params![id, idea, query, format, METRIC_VERSION, now],
    )?;
    txn.execute(
        "INSERT INTO market_search_budget(run_id,reserved_at) VALUES(?1,?2)",
        params![id, now],
    )?;
    txn.commit()?;
    Ok(IdeaMarketRun {
        id,
        idea_id: idea.into(),
        query: query.into(),
        format: format.into(),
        region: "US".into(),
        language: "en".into(),
        started_at: now,
    })
}

/// Reserve a follow-up query in the same 20-call/day pool used by watchlists.
/// Duplicate reservations are no-ops and never spend a second quota unit.
/// A restart cannot issue an already-reserved outbound call again.
pub fn reserve_additional_search(
    db: &mut Connection,
    run_id: &str,
    ordinal: i64,
    query: &str,
    now: i64,
) -> Result<bool, IdeaMarketError> {
    let query = query.trim();
    if !(1..=3).contains(&ordinal)
        || !(3..=120).contains(&query.chars().count())
        || query.chars().any(char::is_control)
        || now < DAY
    {
        return Err(IdeaMarketError::Invalid);
    }
    let txn = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let valid: i64 = txn.query_row(
        "SELECT EXISTS(SELECT 1 FROM idea_market_runs WHERE id=?1 AND state='running')",
        [run_id],
        |r| r.get(0),
    )?;
    if valid == 0 {
        return Err(IdeaMarketError::NotFound);
    }
    let existing: i64 = txn.query_row(
        "SELECT EXISTS(SELECT 1 FROM idea_market_search_queries WHERE run_id=?1 AND ordinal=?2)",
        params![run_id, ordinal],
        |r| r.get(0),
    )?;
    if existing != 0 {
        return Ok(false);
    }
    let used: i64 = txn.query_row(
        "SELECT COUNT(*) FROM market_search_budget WHERE reserved_at>?1",
        [now - DAY],
        |r| r.get(0),
    )?;
    if used >= 20 {
        return Ok(false);
    }
    let budget_id = format!("{run_id}_query_{ordinal}");
    txn.execute(
        "INSERT INTO market_search_budget(run_id,reserved_at) VALUES(?1,?2)",
        params![budget_id, now],
    )?;
    txn.execute(
        "INSERT INTO idea_market_search_queries(run_id,ordinal,query,reserved_at)
                 VALUES(?1,?2,?3,?4)",
        params![run_id, ordinal, query, now],
    )?;
    txn.commit()?;
    Ok(true)
}

fn record_followup_search(
    db: &Connection,
    run_id: &str,
    ordinal: i64,
    result: Result<usize, &str>,
) -> Result<(), IdeaMarketError> {
    let (count, reason) = match result {
        Ok(count) => (Some(count as i64), None),
        Err(code) => (None, Some(code)),
    };
    db.execute(
        "UPDATE idea_market_search_queries SET result_count=?3,error_code=?4
                WHERE run_id=?1 AND ordinal=?2",
        params![run_id, ordinal, count, reason],
    )?;
    Ok(())
}

/// Record why automatic discovery could not measure an idea *without spending*
/// YouTube quota. Manual recheck remains available as soon as credentials or
/// budget become available. A real observation always wins over a placeholder.
#[allow(clippy::too_many_arguments)] // Mirrors the quota-reserving claim's scoped ownership arguments.
pub fn record_unavailable_assessment(
    db: &mut Connection,
    project: &str,
    session: &str,
    idea: &str,
    query: &str,
    format: &str,
    error_code: &str,
    now: i64,
) -> Result<(), IdeaMarketError> {
    if !(3..=120).contains(&query.trim().chars().count())
        || !matches!(format, "long" | "shorts")
        || !matches!(
            error_code,
            "api_key_missing"
                | "credential_denied"
                | "credential_unavailable"
                | "budget_exhausted"
                | "collection_limit"
                | "provider_unavailable"
        )
        || now < 1
    {
        return Err(IdeaMarketError::Invalid);
    }
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let exists: i64 = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM discovery_candidates c JOIN discovery_runs r ON r.id=c.run_id
         WHERE c.id=?1 AND c.project_id=?2 AND r.session_id=?3)",
        params![idea, project, session],
        |row| row.get(0),
    )?;
    if exists == 0 {
        return Err(IdeaMarketError::NotFound);
    }
    let prior: Option<(String, Option<String>, i64)> = tx
        .query_row(
            "SELECT state,error_code,started_at FROM idea_market_runs WHERE idea_id=?1
         ORDER BY started_at DESC,rowid DESC LIMIT 1",
            [idea],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    if let Some((state, previous_reason, started)) = prior {
        // Never hide real measurements or a running paid reservation.
        if matches!(state.as_str(), "succeeded" | "running") {
            return Ok(());
        }
        // Preserve a recent reason unless the blocker changed (e.g. a key
        // was configured, but Google's quota is now exhausted). That new
        // reason must receive its own durable cooldown.
        if previous_reason.as_deref() == Some(error_code) && now < started.saturating_add(6 * 3_600)
        {
            return Ok(());
        }
    }
    let mut bytes = [0u8; 12];
    getrandom::getrandom(&mut bytes).map_err(|_| IdeaMarketError::Identifier)?;
    let id = format!(
        "idea_market_{}",
        bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()
    );
    tx.execute(
        "INSERT INTO idea_market_runs(id,idea_id,query,format,metric_version,region,language,
         state,started_at,finished_at,error_code)
         VALUES(?1,?2,?3,?4,?5,'US','en','failed',?6,?6,?7)",
        params![
            id,
            idea,
            query.trim(),
            format,
            METRIC_VERSION,
            now,
            error_code
        ],
    )?;
    tx.commit()?;
    Ok(())
}

/// Save every raw observation in API relevance order. Eligibility filters are
/// read-time and versionable; we do not delete weak/low-view search results.
pub fn complete_assessment(
    db: &Connection,
    run_id: &str,
    videos: &[VideoObservation],
    now: i64,
) -> Result<(), IdeaMarketError> {
    if videos.len() > 25 || !(1..=i64::MAX - RETENTION).contains(&now) {
        return Err(IdeaMarketError::Invalid);
    }
    let txn = db.unchecked_transaction()?;
    let running: i64 = txn.query_row(
        "SELECT EXISTS(SELECT 1 FROM idea_market_runs WHERE id=?1 AND state='running')",
        [run_id],
        |row| row.get(0),
    )?;
    if running == 0 {
        return Err(IdeaMarketError::NotFound);
    }
    let mut seen = HashSet::new();
    for video in videos {
        if !(1..=24).contains(&video.video_id.len())
            || !video
                .video_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            || !seen.insert(video.video_id.as_str())
            || video.title.len() > 400
            || video.channel_title.len() > 300
            || video.channel_id.len() > 128
            || video.published_at.len() > 64
            || video.view_count.is_some_and(|v| v < 0)
            || video.duration_seconds.is_some_and(|v| v < 0)
        {
            return Err(IdeaMarketError::Invalid);
        }
        txn.execute(
            "INSERT INTO idea_market_videos(run_id,video_id,title,channel_id,channel_title,
           published_at,duration_seconds,view_count,observed_at,expires_at)
           VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![
                run_id,
                video.video_id,
                video.title,
                video.channel_id,
                video.channel_title,
                video.published_at,
                video.duration_seconds,
                video.view_count,
                now,
                now + RETENTION
            ],
        )?;
        if let Some(views) = video.view_count {
            txn.execute(
                "INSERT OR IGNORE INTO idea_video_view_snapshots(video_id,observed_at,view_count)
                VALUES(?1,?2,?3)",
                params![video.video_id, now, views],
            )?;
        }
    }
    txn.execute(
        "UPDATE idea_market_runs SET state='succeeded',finished_at=?2,searched_videos=?3
      WHERE id=?1",
        params![run_id, now, videos.len()],
    )?;
    txn.commit()?;
    Ok(())
}

/// Durable, at-most-twice-daily cheap videos.list refresh reservation.
/// No search.list calls or synthetic views. A failed refresh still spends the
/// local refresh allowance, which prevents an error from creating a hot loop.
pub fn claim_video_refresh(
    db: &mut Connection,
    now: i64,
) -> Result<Option<(String, Vec<String>)>, IdeaMarketError> {
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let used: i64 = tx.query_row(
        "SELECT COUNT(*) FROM idea_video_refresh_reservations
        WHERE reserved_at>?1",
        [now - DAY],
        |r| r.get(0),
    )?;
    if used >= 2 {
        return Ok(None);
    }
    let mut query = tx.prepare(
        "SELECT s.video_id FROM idea_video_view_snapshots s
        JOIN idea_market_videos v ON v.video_id=s.video_id
        WHERE v.expires_at>?1 GROUP BY s.video_id
        HAVING MAX(s.observed_at)<=?2 ORDER BY MAX(s.observed_at),s.video_id LIMIT 25",
    )?;
    let ids = query
        .query_map(params![now, now - 7 * DAY], |r| r.get(0))?
        .collect::<Result<Vec<String>, _>>()?;
    drop(query);
    if ids.is_empty() {
        return Ok(None);
    }
    let mut bytes = [0u8; 12];
    getrandom::getrandom(&mut bytes).map_err(|_| IdeaMarketError::Identifier)?;
    let id = format!(
        "video_refresh_{}",
        bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()
    );
    tx.execute(
        "INSERT INTO idea_video_refresh_reservations(id,reserved_at,state)
        VALUES(?1,?2,'running')",
        params![id, now],
    )?;
    tx.commit()?;
    Ok(Some((id, ids)))
}

pub fn finish_video_refresh(
    db: &Connection,
    run_id: &str,
    requested: &[String],
    values: &[(String, i64)],
    result: Result<(), &str>,
    now: i64,
) -> Result<(), IdeaMarketError> {
    let tx = db.unchecked_transaction()?;
    let active: i64 = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM idea_video_refresh_reservations
        WHERE id=?1 AND state='running')",
        [run_id],
        |r| r.get(0),
    )?;
    if active == 0 {
        return Err(IdeaMarketError::NotFound);
    }
    if result.is_ok() {
        let mut seen = HashSet::new();
        for (id, views) in values {
            if *views < 0 || !requested.contains(id) || !seen.insert(id) {
                return Err(IdeaMarketError::Invalid);
            }
            tx.execute(
                "INSERT OR IGNORE INTO idea_video_view_snapshots(video_id,observed_at,view_count)
                VALUES(?1,?2,?3)",
                params![id, now, views],
            )?;
        }
    }
    let (state, reason) = match result {
        Ok(()) => ("succeeded", None),
        Err(code) => ("failed", Some(code)),
    };
    tx.execute(
        "UPDATE idea_video_refresh_reservations SET state=?2,error_code=?3 WHERE id=?1",
        params![run_id, state, reason],
    )?;
    tx.commit()?;
    Ok(())
}

fn observed_view_change(
    db: &Connection,
    video_id: &str,
    now: i64,
    minimum: i64,
    maximum: i64,
) -> Result<Option<f64>, rusqlite::Error> {
    let latest: Option<(i64, i64)> = db
        .query_row(
            "SELECT observed_at,view_count
        FROM idea_video_view_snapshots WHERE video_id=?1 AND observed_at>?2
        ORDER BY observed_at DESC LIMIT 1",
            params![video_id, now - 40 * DAY],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let Some((new_time, new_views)) = latest else {
        return Ok(None);
    };
    let old: Option<(i64, i64)> = db
        .query_row(
            "SELECT observed_at,view_count
        FROM idea_video_view_snapshots WHERE video_id=?1 AND observed_at<=?2
        AND observed_at>=?3 ORDER BY observed_at DESC LIMIT 1",
            params![video_id, new_time - minimum, new_time - maximum],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    Ok(old.map(|(_, views)| (new_views - views) as f64))
}

/// Persist a small, bounded, versioned public channel-upload sample. This can
/// be missing while the primary YouTube search remains successful.
pub fn save_channel_baselines(
    db: &Connection,
    run_id: &str,
    videos: &[VideoObservation],
    now: i64,
) -> Result<(), IdeaMarketError> {
    if videos.len() > 60 || now <= DAY {
        return Err(IdeaMarketError::Invalid);
    }
    let tx = db.unchecked_transaction()?;
    let mut seen = HashSet::new();
    for v in videos {
        if !seen.insert(v.video_id.as_str())
            || v.video_id.len() != 11
            || !v
                .video_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            || v.channel_id.len() > 128
            || v.title.len() > 400
            || v.channel_title.len() > 300
            || v.published_at.len() > 64
            || v.view_count.is_some_and(|count| count < 0)
        {
            return Err(IdeaMarketError::Invalid);
        }
        tx.execute(
            "INSERT INTO idea_market_channel_baselines(run_id,video_id,title,channel_id,channel_title,
            published_at,duration_seconds,view_count,observed_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                run_id,
                v.video_id,
                v.title,
                v.channel_id,
                v.channel_title,
                v.published_at,
                v.duration_seconds,
                v.view_count,
                now
            ],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn save_audience_questions(
    db: &Connection,
    run_id: &str,
    questions: &[AudienceQuestion],
    now: i64,
) -> Result<(), IdeaMarketError> {
    if questions.len() > 24 || now < DAY {
        return Err(IdeaMarketError::Invalid);
    }
    let tx = db.unchecked_transaction()?;
    let mut seen = HashSet::new();
    for value in questions {
        if !seen.insert(value.comment_id.as_str())
            || value.comment_id.is_empty()
            || value.comment_id.len() > 160
            || value.comment_id.chars().any(char::is_control)
            || value.video_id.len() != 11
            || value.question.len() > 240
            || value.question.len() < 10
            || !value.question.contains('?')
            || value.question.chars().any(char::is_control)
            || value.question.contains('@')
            || value.question.to_lowercase().contains("http")
        {
            return Err(IdeaMarketError::Invalid);
        }
        tx.execute(
            "INSERT OR IGNORE INTO idea_market_audience_questions
            (run_id,comment_id,video_id,question,observed_at) VALUES(?1,?2,?3,?4,?5)",
            params![
                run_id,
                value.comment_id,
                value.video_id,
                value.question,
                now
            ],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn fail_assessment(
    db: &Connection,
    run_id: &str,
    code: &str,
    now: i64,
) -> Result<(), IdeaMarketError> {
    // Persist a finite reviewed error code, never a provider body or the key.
    let reason = match code {
        "api_key_missing"
        | "permission"
        | "api_not_enabled"
        | "api_key_invalid"
        | "api_key_restricted"
        | "invalid_request"
        | "quota_exceeded"
        | "rate_limited"
        | "provider_unavailable"
        | "payload_invalid"
        | "interrupted"
        | "storage_failed" => code,
        _ => "provider_unavailable",
    };
    db.execute(
        "UPDATE idea_market_runs SET state='failed',finished_at=?2,error_code=?3
      WHERE id=?1 AND state='running'",
        params![run_id, now, reason],
    )?;
    Ok(())
}

pub fn reconcile_interrupted(db: &Connection, now: i64) -> Result<(), IdeaMarketError> {
    db.execute(
        "UPDATE idea_market_runs SET state='failed',finished_at=?1,error_code='interrupted'
       WHERE state='running'",
        [now],
    )?;
    Ok(())
}

pub fn prune_expired(db: &Connection, now: i64) -> Result<(), IdeaMarketError> {
    db.execute("DELETE FROM idea_market_videos WHERE expires_at<=?1", [now])?;
    db.execute(
        "DELETE FROM idea_market_audience_questions WHERE observed_at<=?1",
        [now - RETENTION],
    )?;
    db.execute(
        "DELETE FROM idea_video_view_snapshots WHERE observed_at<=?1",
        [now - 90 * DAY],
    )?;
    db.execute(
        "DELETE FROM idea_video_refresh_reservations WHERE reserved_at<=?1",
        [now - 90 * DAY],
    )?;
    Ok(())
}

fn topic_terms(query: &str) -> Vec<String> {
    const STOP: &[&str] = &[
        "the", "and", "for", "you", "your", "that", "what", "which", "from", "with", "costs",
        "does", "much", "this", "into", "more", "less", "about", "when", "why", "how", "are", "vs",
    ];
    let mut seen = HashSet::new();
    query
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| s.len() >= 3 && !STOP.contains(s) && seen.insert((*s).to_owned()))
        .map(ToOwned::to_owned)
        .collect()
}

fn percentile(sorted: &[f64], pct: f64) -> Option<f64> {
    if sorted.is_empty() {
        return None;
    }
    let at = (sorted.len() - 1) as f64 * pct;
    let base = at.floor() as usize;
    Some(sorted[base] + (sorted[at.ceil() as usize] - sorted[base]) * (at - base as f64))
}

pub fn latest_assessment(
    db: &Connection,
    idea: &str,
    now: i64,
) -> Result<Option<IdeaMarketAssessment>, IdeaMarketError> {
    let latest: Option<StoredAssessment> = db
        .query_row(
            "SELECT id,state,query,format,metric_version,region,language,started_at,finished_at,error_code,searched_videos
        FROM idea_market_runs WHERE idea_id=?1 ORDER BY started_at DESC,rowid DESC LIMIT 1",
            [idea],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                    r.get(8)?,
                    r.get(9)?,
                    r.get(10)?,
                ))
            },
        )
        .optional()?;
    let Some((
        run_id,
        state,
        query,
        format,
        metric_version,
        region,
        language,
        started,
        finished,
        error_code,
        searched,
    )) = latest
    else {
        return Ok(None);
    };
    let expired =
        state == "succeeded" && finished.is_some_and(|at| at.saturating_add(RETENTION) <= now);
    let charged: i64 = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM market_search_budget WHERE run_id=?1)",
        [&run_id],
        |row| row.get(0),
    )?;
    let mut result = IdeaMarketAssessment {
        run_id: run_id.clone(),
        state: if expired {
            "expired".into()
        } else {
            state.clone()
        },
        query: query.clone(),
        search_queries: vec![query.clone()],
        format: format.clone(),
        metric_version,
        region,
        language,
        observed_at: finished,
        next_collection_at: started.saturating_add(if charged != 0 { MIN_RETRY } else { 0 }),
        searched_videos: searched as usize,
        sample_size: 0,
        distinct_channels: 0,
        median_views: None,
        p75_views: None,
        median_views_per_day: None,
        recent_uploads90d: 0,
        comparison_score: None,
        comparison_cohort_size: 0,
        channel_breakout_score: None,
        channel_baseline_videos: 0,
        channel_baseline_channels: 0,
        channel_baseline_examples: vec![],
        observed_7d_median_view_delta: None,
        observed_7d_video_count: 0,
        observed_30d_median_view_delta: None,
        observed_30d_video_count: 0,
        error_code,
        videos: vec![],
        audience_questions: vec![],
    };
    if state != "succeeded" || expired {
        return Ok(Some(result));
    }
    let mut search_stmt = db.prepare(
        "SELECT query FROM idea_market_search_queries
        WHERE run_id=?1 ORDER BY ordinal",
    )?;
    let additional = search_stmt
        .query_map([&run_id], |r| r.get(0))?
        .collect::<Result<Vec<String>, _>>()?;
    result.search_queries.extend(additional);
    let mut question_query = db.prepare(
        "SELECT comment_id,video_id,question FROM idea_market_audience_questions
        WHERE run_id=?1 AND observed_at>?2 ORDER BY rowid LIMIT 24",
    )?;
    result.audience_questions = question_query
        .query_map(params![run_id, now - RETENTION], |r| {
            Ok(AudienceQuestion {
                comment_id: r.get(0)?,
                video_id: r.get(1)?,
                question: r.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let terms = topic_terms(&query);
    if terms.is_empty() {
        return Ok(Some(result));
    }
    let mut q = db.prepare(
        "SELECT video_id,title,channel_id,channel_title,published_at,
         duration_seconds,view_count,observed_at,CAST(strftime('%s',published_at) AS INTEGER)
         FROM idea_market_videos WHERE run_id=?1 AND expires_at>?2 ORDER BY rowid LIMIT 25",
    )?;
    let rows = q.query_map(params![run_id, now], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, String>(4)?,
            r.get::<_, Option<i64>>(5)?,
            r.get::<_, Option<i64>>(6)?,
            r.get::<_, i64>(7)?,
            r.get::<_, Option<i64>>(8)?,
        ))
    })?;
    let mut channel_counts: HashMap<String, usize> = HashMap::new();
    let mut view_values = vec![];
    let mut daily_values = vec![];
    let mut target_by_channel: HashMap<String, Vec<f64>> = HashMap::new();
    let mut candidate_ids = HashSet::new();
    let mut measured_7d = vec![];
    let mut measured_30d = vec![];
    for row in rows {
        let (
            id,
            title,
            channel_id,
            channel_title,
            published_at,
            duration,
            views,
            observed,
            published,
        ) = row?;
        let Some(views) = views else { continue };
        let Some(duration) = duration else { continue };
        if (format == "long" && duration < 180) || (format == "shorts" && duration > 180) {
            continue;
        }
        let lower = title.to_lowercase();
        let match_count = terms
            .iter()
            .filter(|term| lower.contains(term.as_str()))
            .count();
        if match_count < if terms.len() > 2 { 2 } else { 1 } {
            continue;
        }
        let Some(published) = published else { continue };
        let age = observed - published;
        if !(DAY..=365 * DAY).contains(&age) {
            continue;
        }
        let count = channel_counts.entry(channel_id.clone()).or_default();
        if *count >= 3 {
            continue;
        }
        *count += 1;
        candidate_ids.insert(id.clone());
        if let Some(change) = observed_view_change(db, &id, now, 6 * DAY, 10 * DAY)? {
            measured_7d.push(change);
        }
        if let Some(change) = observed_view_change(db, &id, now, 25 * DAY, 35 * DAY)? {
            measured_30d.push(change);
        }
        result.recent_uploads90d += usize::from(age <= 90 * DAY);
        view_values.push(views as f64);
        let views_per_day = views as f64 / (age as f64 / DAY as f64);
        daily_values.push(views_per_day);
        target_by_channel
            .entry(channel_id)
            .or_default()
            .push(views_per_day);
        result.videos.push(IdeaMarketVideo {
            video_id: id.clone(),
            title,
            channel_title,
            view_count: Some(views),
            published_at,
            source_url: format!("https://www.youtube.com/watch?v={id}"),
        });
    }
    view_values.sort_by(f64::total_cmp);
    daily_values.sort_by(f64::total_cmp);
    result.sample_size = view_values.len();
    result.distinct_channels = channel_counts.len();
    result.median_views = percentile(&view_values, 0.5);
    result.p75_views = percentile(&view_values, 0.75);
    result.median_views_per_day = percentile(&daily_values, 0.5);
    measured_7d.sort_by(f64::total_cmp);
    measured_30d.sort_by(f64::total_cmp);
    result.observed_7d_video_count = measured_7d.len();
    result.observed_30d_video_count = measured_30d.len();
    result.observed_7d_median_view_delta = percentile(&measured_7d, 0.5);
    result.observed_30d_median_view_delta = percentile(&measured_30d, 0.5);
    // Compare each usable target to other uploads from its OWN channel.
    // Age-normalized lifetime views/day is a proxy, not observed new growth.
    // A one-channel baseline supports a *provisional* score only.
    let mut baseline_by_channel: HashMap<String, Vec<f64>> = HashMap::new();
    let mut baseline_details: HashMap<String, Vec<IdeaMarketVideo>> = HashMap::new();
    let mut baseline_rows = db.prepare(
        "SELECT channel_id,video_id,title,channel_title,published_at,duration_seconds,view_count,
        observed_at,CAST(strftime('%s',published_at) AS INTEGER)
        FROM idea_market_channel_baselines WHERE run_id=?1",
    )?;
    let rows = baseline_rows.query_map([&run_id], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, String>(4)?,
            r.get::<_, Option<i64>>(5)?,
            r.get::<_, Option<i64>>(6)?,
            r.get::<_, i64>(7)?,
            r.get::<_, Option<i64>>(8)?,
        ))
    })?;
    for row in rows {
        let (channel, id, title, channel_title, published_at, duration, views, observed, published) =
            row?;
        if candidate_ids.contains(&id) || !target_by_channel.contains_key(&channel) {
            continue;
        }
        let (Some(duration), Some(views), Some(published)) = (duration, views, published) else {
            continue;
        };
        let age = observed - published;
        if !(DAY..=365 * DAY).contains(&age)
            || (format == "long" && duration < 180)
            || (format == "shorts" && duration > 180)
        {
            continue;
        }
        baseline_by_channel
            .entry(channel.clone())
            .or_default()
            .push(views as f64 / (age as f64 / DAY as f64));
        baseline_details
            .entry(channel)
            .or_default()
            .push(IdeaMarketVideo {
                video_id: id.clone(),
                title,
                channel_title,
                published_at,
                view_count: Some(views),
                source_url: format!("https://www.youtube.com/watch?v={id}"),
            });
    }
    let mut breakout_scores = vec![];
    for (channel, mut baseline) in baseline_by_channel {
        if baseline.len() < 3 {
            continue;
        }
        baseline.sort_by(f64::total_cmp);
        let middle = percentile(&baseline, 0.5).unwrap_or_default();
        if middle <= 0.0 {
            continue;
        }
        let mut target = target_by_channel.remove(&channel).unwrap_or_default();
        target.sort_by(f64::total_cmp);
        let target_median = percentile(&target, 0.5).unwrap_or_default();
        let ratio = ((target_median + 1.0) / (middle + 1.0)).clamp(0.01, 100.0);
        breakout_scores.push((50.0 + 20.0 * ratio.log2()).clamp(5.0, 95.0));
        result.channel_baseline_videos += baseline.len();
        result.channel_baseline_channels += 1;
        if let Some(examples) = baseline_details.remove(&channel) {
            result
                .channel_baseline_examples
                .extend(examples.into_iter().take(3));
            result.channel_baseline_examples.truncate(9);
        }
    }
    breakout_scores.sort_by(f64::total_cmp);
    result.channel_breakout_score = percentile(&breakout_scores, 0.5);
    Ok(Some(result))
}

/// Assign *within-session and same-format* observed market percentiles.
/// Require three adequately sampled ideas so two observations do not receive
/// misleading 0/100 labels. Equal medians share the same mid-rank.
pub fn assign_session_percentiles(assessments: &mut [Option<IdeaMarketAssessment>]) {
    for format in ["long", "shorts"] {
        let mut eligible: Vec<(usize, f64)> = assessments
            .iter()
            .enumerate()
            .filter_map(|(i, a)| {
                let a = a.as_ref()?;
                if a.format != format
                    || a.state != "succeeded"
                    || a.sample_size < 8
                    || a.distinct_channels < 3
                {
                    return None;
                }
                let median = a.median_views_per_day?;
                (median.is_finite() && median >= 0.0).then_some((i, median))
            })
            .collect();
        if eligible.len() < 3 {
            continue;
        }
        eligible.sort_by(|a, b| a.1.total_cmp(&b.1));
        let n = eligible.len();
        for (id, value) in &eligible {
            let low = eligible.partition_point(|(_, v)| v < value);
            let high = eligible.partition_point(|(_, v)| v <= value);
            let midrank = (low + high + 1) as f64 / 2.0;
            let score = (100.0 * midrank / (n + 1) as f64).round();
            let item = assessments[*id].as_mut().unwrap();
            item.comparison_cohort_size = n;
            item.comparison_score = Some(score);
        }
    }
}

/// Merge relevance-order result sets without letting the first broad query
/// crowd a narrower follow-up out of the 25-row backward-compatible snapshot.
fn combine_query_results(
    primary: Vec<VideoObservation>,
    second: Vec<VideoObservation>,
) -> Vec<VideoObservation> {
    let mut combined = Vec::with_capacity(25);
    let mut seen = HashSet::new();
    for video in primary
        .iter()
        .take(13)
        .chain(second.iter().take(12))
        .chain(primary.iter().skip(13))
        .chain(second.iter().skip(12))
    {
        if combined.len() == 25 {
            break;
        }
        if seen.insert(video.video_id.as_str()) {
            combined.push(video.clone());
        }
    }
    combined
}

fn has_diverse_comparables(videos: &[VideoObservation], query: &str, format: &str) -> bool {
    let terms = topic_terms(query);
    let mut channels: HashMap<&str, usize> = HashMap::new();
    let relevant = videos
        .iter()
        .filter(|video| {
            let duration = video.duration_seconds.unwrap_or_default();
            if video.view_count.is_none()
                || (format == "long" && duration < 180)
                || (format == "shorts" && duration > 180)
            {
                return false;
            }
            let title = video.title.to_lowercase();
            let hits = terms
                .iter()
                .filter(|term| title.contains(term.as_str()))
                .count();
            if hits < if terms.len() > 2 { 2 } else { 1 } {
                return false;
            }
            // Read-time eligibility caps each channel at three videos; use
            // exactly that rule here, or a single prolific channel can
            // suppress a useful follow-up search.
            let count = channels.entry(video.channel_id.as_str()).or_default();
            if *count >= 3 {
                return false;
            }
            *count += 1;
            true
        })
        .count();
    relevant >= 8 && channels.len() >= 3
}

pub async fn run_assessment(state: AppState, run: IdeaMarketRun, client: YoutubeClient) {
    run_assessment_with_queries(state, run, client, &[]).await;
}

/// Extra queries are optional. Each actual extra search.list request requires
/// an atomic reservation; an unsuccessful expansion never discards the first
/// provider's successfully collected observations.
pub async fn run_assessment_with_queries(
    state: AppState,
    run: IdeaMarketRun,
    client: YoutubeClient,
    alternate_queries: &[String],
) {
    let Ok(_permit) = state.market_semaphore().acquire_owned().await else {
        return;
    };
    let result = client.collect(&run.query, &run.region, &run.language).await;
    let result = match result {
        Ok(primary) if !has_diverse_comparables(&primary, &run.query, &run.format) => {
            let mut results = primary;
            for (index, query) in alternate_queries.iter().take(2).enumerate() {
                if query.eq_ignore_ascii_case(&run.query) || query.trim().len() < 3 {
                    continue;
                }
                let reserved = state
                    .connect()
                    .ok()
                    .and_then(|mut db| {
                        reserve_additional_search(
                            &mut db,
                            &run.id,
                            (index + 1) as i64,
                            query,
                            super::market_api::epoch_now(),
                        )
                        .ok()
                    })
                    .unwrap_or(false);
                if !reserved {
                    continue;
                }
                let next = client.collect(query, &run.region, &run.language).await;
                if let Ok(db) = state.connect() {
                    let _ = record_followup_search(
                        &db,
                        &run.id,
                        (index + 1) as i64,
                        next.as_ref().map(Vec::len).map_err(|error| error.code()),
                    );
                }
                match next {
                    Ok(extra) => {
                        results = combine_query_results(results, extra);
                        if has_diverse_comparables(&results, &run.query, &run.format) {
                            break;
                        }
                    }
                    Err(error) => {
                        eprintln!(
                            "contentgen-server: idea_market_followup_failed run_id={} reason={}",
                            run.id,
                            error.code()
                        );
                        // A provider-wide failure should never provoke another
                        // search attempt in the same assessment.
                        break;
                    }
                }
            }
            Ok(results)
        }
        other => other,
    };
    if let Ok(videos) = &result {
        let mut channels: Vec<String> = vec![];
        for video in videos {
            if channels.len() == 3 {
                break;
            }
            if !channels.contains(&video.channel_id) {
                channels.push(video.channel_id.clone());
            }
        }
        // Channel enrichment consumes no search.list budget and cannot make
        // otherwise valid primary observations disappear on failure.
        match tokio::time::timeout(
            std::time::Duration::from_secs(25),
            client.channel_upload_baselines(&channels),
        )
        .await
        {
            Ok(Ok(baselines)) => {
                if let Ok(db) = state.connect() {
                    let _ = save_channel_baselines(
                        &db,
                        &run.id,
                        &baselines,
                        super::market_api::epoch_now(),
                    );
                }
            }
            Ok(Err(error)) => eprintln!(
                "contentgen-server: channel_baseline_failed run_id={} reason={}",
                run.id,
                error.code()
            ),
            Err(_) => eprintln!(
                "contentgen-server: channel_baseline_failed run_id={} reason=timeout",
                run.id
            ),
        }
    }
    if let Ok(db) = state.connect() {
        match result {
            Ok(videos) => {
                if complete_assessment(&db, &run.id, &videos, super::market_api::epoch_now())
                    .is_err()
                {
                    let _ = fail_assessment(
                        &db,
                        &run.id,
                        "storage_failed",
                        super::market_api::epoch_now(),
                    );
                } else {
                    drop(db);
                    let mut questions = Vec::new();
                    for video in videos.iter().take(2) {
                        let found = tokio::time::timeout(
                            std::time::Duration::from_secs(12),
                            client.public_questions(&video.video_id),
                        )
                        .await;
                        if let Ok(Ok(items)) = found {
                            questions.extend(items);
                        }
                    }
                    if !questions.is_empty()
                        && let Ok(db) = state.connect()
                    {
                        let _ = save_audience_questions(
                            &db,
                            &run.id,
                            &questions,
                            super::market_api::epoch_now(),
                        );
                    }
                }
            }
            Err(err) => {
                eprintln!(
                    "contentgen-server: idea_market_failed run_id={} reason={}",
                    run.id,
                    err.code()
                );
                let _ = fail_assessment(&db, &run.id, err.code(), super::market_api::epoch_now());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prolific_channel_cannot_hide_insufficient_diverse_comparables() {
        let mut videos = Vec::new();
        for index in 0..6 {
            let mut video = record(&format!("alpha{:0>6}", index));
            video.channel_id = "channel-alpha".into();
            videos.push(video);
        }
        for channel in ["channel-beta", "channel-gamma"] {
            let mut video = record(&format!("{}0000", channel));
            video.channel_id = channel.into();
            videos.push(video);
        }
        assert_eq!(videos.len(), 8);
        assert!(!has_diverse_comparables(
            &videos,
            "bookkeeping automation",
            "long"
        ));
    }

    fn record(id: &str) -> VideoObservation {
        VideoObservation {
            video_id: id.into(),
            title: "Bookkeeping automation guide".into(),
            channel_id: id.into(),
            channel_title: "Demo".into(),
            published_at: "2026-01-01T00:00:00Z".into(),
            duration_seconds: Some(500),
            view_count: Some(100),
            like_count: None,
            comment_count: None,
            subscriber_count: None,
        }
    }

    #[test]
    fn merges_distinct_queries_with_deduplication_and_fair_coverage() {
        let primary = (0..25)
            .map(|i| record(&format!("primary-{i:03}")))
            .collect();
        let secondary = std::iter::once(record("primary-000"))
            .chain((0..20).map(|i| record(&format!("secondary-{i:03}"))))
            .collect();
        let combined = combine_query_results(primary, secondary);
        assert_eq!(combined.len(), 25);
        assert_eq!(
            combined
                .iter()
                .map(|v| v.video_id.as_str())
                .collect::<HashSet<_>>()
                .len(),
            25
        );
        assert!(combined.iter().any(|v| v.video_id == "secondary-000"));
        assert!(combined.iter().any(|v| v.video_id == "primary-000"));
    }
}
