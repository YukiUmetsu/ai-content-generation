//! Explicit, quota-limited YouTube comparisons for individual discovery ideas.
//! An assessment is public metadata, not evidence for factual claims or a
//! forecast of creator performance. The v1 research-readiness score is separate.

use std::collections::{HashMap, HashSet};

use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::Serialize;

use super::{market_store::VideoObservation, youtube_api::YoutubeClient};
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
    pub error_code: Option<String>,
    pub videos: Vec<IdeaMarketVideo>,
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
        || !matches!(error_code,
            "api_key_missing" | "credential_denied" | "credential_unavailable"
                | "budget_exhausted" | "collection_limit" | "provider_unavailable")
        || now < 1
    {
        return Err(IdeaMarketError::Invalid);
    }
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let exists: i64 = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM discovery_candidates c JOIN discovery_runs r ON r.id=c.run_id
         WHERE c.id=?1 AND c.project_id=?2 AND r.session_id=?3)",
        params![idea, project, session], |row| row.get(0),
    )?;
    if exists == 0 {
        return Err(IdeaMarketError::NotFound);
    }
    let prior: Option<(String, Option<String>, i64)> = tx.query_row(
        "SELECT state,error_code,started_at FROM idea_market_runs WHERE idea_id=?1
         ORDER BY started_at DESC,rowid DESC LIMIT 1",
        [idea], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).optional()?;
    if let Some((state, previous_reason, started)) = prior {
        // Never hide real measurements or a running paid reservation.
        if matches!(state.as_str(), "succeeded" | "running") {
            return Ok(());
        }
        // Preserve a recent reason unless the blocker changed (e.g. a key
        // was configured, but Google's quota is now exhausted). That new
        // reason must receive its own durable cooldown.
        if previous_reason.as_deref() == Some(error_code)
            && now < started.saturating_add(6 * 3_600)
        {
            return Ok(());
        }
    }
    let mut bytes = [0u8; 12];
    getrandom::getrandom(&mut bytes).map_err(|_| IdeaMarketError::Identifier)?;
    let id = format!("idea_market_{}",bytes.iter().map(|b| format!("{b:02x}")).collect::<String>());
    tx.execute(
        "INSERT INTO idea_market_runs(id,idea_id,query,format,metric_version,region,language,
         state,started_at,finished_at,error_code)
         VALUES(?1,?2,?3,?4,?5,'US','en','failed',?6,?6,?7)",
        params![id,idea,query.trim(),format,METRIC_VERSION,now,error_code],
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
    }
    txn.execute(
        "UPDATE idea_market_runs SET state='succeeded',finished_at=?2,searched_videos=?3
      WHERE id=?1",
        params![run_id, now, videos.len()],
    )?;
    txn.commit()?;
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
        [&run_id], |row| row.get(0),
    )?;
    let mut result = IdeaMarketAssessment {
        run_id: run_id.clone(),
        state: if expired {
            "expired".into()
        } else {
            state.clone()
        },
        query: query.clone(),
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
        error_code,
        videos: vec![],
    };
    if state != "succeeded" || expired {
        return Ok(Some(result));
    }
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
        let count = channel_counts.entry(channel_id).or_default();
        if *count >= 3 {
            continue;
        }
        *count += 1;
        result.recent_uploads90d += usize::from(age <= 90 * DAY);
        view_values.push(views as f64);
        daily_values.push(views as f64 / (age as f64 / DAY as f64));
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

pub async fn run_assessment(state: AppState, run: IdeaMarketRun, client: YoutubeClient) {
    let Ok(_permit) = state.market_semaphore().acquire_owned().await else {
        return;
    };
    let result = client.collect(&run.query, &run.region, &run.language).await;
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
