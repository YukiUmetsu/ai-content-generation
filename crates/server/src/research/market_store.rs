//! Public market observations: bounded watchlists, durable search budget,
//! restart-safe leases, and short-lived API-derived snapshots.

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

const DAILY_SECONDS: i64 = 86_400;
const RETENTION_SECONDS: i64 = 30 * DAILY_SECONDS;
const MAX_SEARCH_CALLS: i64 = 20;
const MAX_ENABLED: i64 = 10;

fn manual_mode() -> String {
    "manual".into()
}
fn default_plan_source() -> String {
    "user-edited".into()
}

fn fallback_query(name: &str) -> String {
    let name = name.trim();
    if name.chars().count() >= 3 {
        name.to_string()
    } else {
        format!("{name} YouTube videos")
    }
}

#[derive(Debug, thiserror::Error)]
pub enum MarketError {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("invalid watchlist: {0}")]
    Invalid(String),
    #[error("watchlist not found")]
    NotFound,
    #[error("market data collection limit reached")]
    Limit,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketWatchlistDraft {
    pub name: String,
    pub query: String,
    pub region: String,
    pub language: String,
    pub enabled: bool,
    #[serde(default = "manual_mode")]
    pub query_mode: String,
    #[serde(default)]
    pub query_plan: Vec<String>,
    #[serde(default = "default_plan_source")]
    pub query_plan_source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketWatchlist {
    pub id: String,
    pub name: String,
    pub query: String,
    pub region: String,
    pub language: String,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub next_due_at: i64,
    pub last_finished_at: Option<i64>,
    pub backoff_until: i64,
    pub error_code: Option<String>,
    pub query_mode: String,
    pub query_plan: Vec<String>,
    pub query_plan_source: String,
    pub query_index: i64,
    pub query_plan_revision: i64,
    pub last_search_query: Option<String>,
    pub next_search_query: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketRun {
    pub id: String,
    pub watchlist_id: String,
    pub state: String,
    pub started_at: i64,
    pub effective_query: String,
    pub query_plan_revision: i64,
    /// Explicit one-off collection may use a watchlist without enabling its scheduler.
    /// False if the user disabled an enabled list after its collection was queued.
    pub allowed_while_disabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoObservation {
    pub video_id: String,
    pub title: String,
    pub channel_id: String,
    pub channel_title: String,
    pub published_at: String,
    pub duration_seconds: Option<i64>,
    pub view_count: Option<i64>,
    pub like_count: Option<i64>,
    pub comment_count: Option<i64>,
    pub subscriber_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketVideoRecord {
    #[serde(flatten)]
    pub video: VideoObservation,
    pub source_url: String,
    pub provider: &'static str,
    pub observed_at: i64,
    pub expires_at: i64,
}

/// A cached public video that overlaps the creator's subject. Matching words
/// explain the local lookup, not a recommendation score or factual evidence.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelatedMarketVideo {
    #[serde(flatten)]
    pub video: MarketVideoRecord,
    pub watchlist_name: String,
    pub matched_terms: Vec<String>,
}

fn validate(draft: &MarketWatchlistDraft) -> Result<(), MarketError> {
    let name = draft.name.trim();
    let query = draft.query.trim();
    if !(1..=80).contains(&name.chars().count()) {
        return Err(MarketError::Invalid("name must be 1–80 characters".into()));
    }
    if !matches!(draft.query_mode.as_str(), "auto" | "manual") {
        return Err(MarketError::Invalid(
            "queryMode must be manual or auto".into(),
        ));
    }
    if draft.query_mode == "manual" && !(3..=160).contains(&query.chars().count()) {
        return Err(MarketError::Invalid(
            "query must be 3–160 characters".into(),
        ));
    }
    if draft.query_mode == "auto" && !query.is_empty() {
        return Err(MarketError::Invalid(
            "automatic mode does not accept a manual search phrase".into(),
        ));
    }
    if draft.query_plan.len() > 8 {
        return Err(MarketError::Invalid(
            "queryPlan cannot exceed eight phrases".into(),
        ));
    }
    let mut seen = std::collections::HashSet::new();
    for phrase in &draft.query_plan {
        let text = phrase.trim();
        if !(3..=160).contains(&text.chars().count())
            || text.chars().any(char::is_control)
            || !seen.insert(text.to_lowercase())
        {
            return Err(MarketError::Invalid(
                "queryPlan requires unique phrases of 3–160 characters".into(),
            ));
        }
    }
    if draft.query_mode == "manual" && !draft.query_plan.is_empty() {
        return Err(MarketError::Invalid(
            "manual mode cannot have a rotating queryPlan".into(),
        ));
    }
    if !matches!(
        draft.query_plan_source.as_str(),
        "user-edited" | "local-model-generated" | "niche-name fallback"
    ) {
        return Err(MarketError::Invalid("invalid queryPlanSource".into()));
    }
    if draft.region.len() != 2 || !draft.region.bytes().all(|b| b.is_ascii_uppercase()) {
        return Err(MarketError::Invalid(
            "region must be a two-letter uppercase country code".into(),
        ));
    }
    if draft.language.len() != 2 || !draft.language.bytes().all(|b| b.is_ascii_lowercase()) {
        return Err(MarketError::Invalid(
            "language must be a two-letter lowercase code".into(),
        ));
    }
    if name.chars().chain(query.chars()).any(char::is_control) {
        return Err(MarketError::Invalid(
            "control characters are not permitted".into(),
        ));
    }
    Ok(())
}

fn fresh_id(db: &Connection, prefix: &str) -> Result<String, MarketError> {
    let random: String = db.query_row("SELECT lower(hex(randomblob(16)))", [], |row| row.get(0))?;
    Ok(format!("{prefix}_{random}"))
}

fn read_watchlist(row: &rusqlite::Row<'_>) -> rusqlite::Result<MarketWatchlist> {
    let query_mode: String = row.get(12)?;
    let plan_json: String = row.get(13)?;
    let query_plan: Vec<String> = serde_json::from_str(&plan_json).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(13, rusqlite::types::Type::Text, Box::new(err))
    })?;
    let stored_query: String = row.get(2)?;
    let name: String = row.get(1)?;
    let query_index: i64 = row.get(15)?;
    let next_search_query = if query_mode == "auto" && !query_plan.is_empty() {
        query_plan[(query_index as usize) % query_plan.len()].clone()
    } else if query_mode == "auto" {
        fallback_query(&name)
    } else {
        stored_query.clone()
    };
    Ok(MarketWatchlist {
        id: row.get(0)?,
        name,
        query: if query_mode == "auto" {
            String::new()
        } else {
            stored_query
        },
        region: row.get(3)?,
        language: row.get(4)?,
        enabled: row.get::<_, i64>(5)? == 1,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        next_due_at: row.get(8)?,
        last_finished_at: row.get(9)?,
        backoff_until: row.get(10)?,
        error_code: row.get(11)?,
        query_mode,
        query_plan,
        query_plan_source: row.get(14)?,
        query_index,
        query_plan_revision: row.get(16)?,
        last_search_query: row.get(17)?,
        next_search_query,
    })
}

const WATCHLIST_COLUMNS: &str = "id, name, query, region, language, enabled, created_at, updated_at, next_due_at, last_finished_at, backoff_until, error_code, query_mode, query_plan_json, query_plan_source, query_index, query_plan_revision, last_search_query";

pub fn create_watchlist(
    db: &Connection,
    draft: MarketWatchlistDraft,
    now: i64,
) -> Result<MarketWatchlist, MarketError> {
    validate(&draft)?;
    let txn = db.unchecked_transaction()?;
    if draft.enabled {
        let enabled: i64 = txn.query_row(
            "SELECT COUNT(*) FROM market_watchlists WHERE enabled = 1",
            [],
            |r| r.get(0),
        )?;
        if enabled >= MAX_ENABLED {
            return Err(MarketError::Limit);
        }
    }
    let id = fresh_id(&txn, "watch")?;
    let stored_query = if draft.query_mode == "auto" {
        fallback_query(&draft.name)
    } else {
        draft.query.trim().to_string()
    };
    let plan = serde_json::to_string(
        &draft
            .query_plan
            .iter()
            .map(|q| q.trim())
            .collect::<Vec<_>>(),
    )
    .map_err(|_| MarketError::Invalid("invalid queryPlan".into()))?;
    txn.execute(
        "INSERT INTO market_watchlists(id,name,query,region,language,enabled,created_at,updated_at,next_due_at,
         query_mode,query_plan_json,query_plan_source)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?7,?7,?8,?9,?10)",
        params![id, draft.name.trim(), stored_query, draft.region, draft.language,
                i64::from(draft.enabled), now, draft.query_mode, plan, draft.query_plan_source]
    )?;
    txn.commit()?;
    get_watchlist(db, &id)
}

pub fn get_watchlist(db: &Connection, id: &str) -> Result<MarketWatchlist, MarketError> {
    db.query_row(
        &format!("SELECT {WATCHLIST_COLUMNS} FROM market_watchlists WHERE id = ?1"),
        [id],
        read_watchlist,
    )
    .optional()?
    .ok_or(MarketError::NotFound)
}

pub fn list_watchlists(db: &Connection) -> Result<Vec<MarketWatchlist>, MarketError> {
    let mut q = db.prepare(&format!(
        "SELECT {WATCHLIST_COLUMNS} FROM market_watchlists ORDER BY created_at, id"
    ))?;
    let rows = q.query_map([], read_watchlist)?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

pub fn update_watchlist(
    db: &Connection,
    id: &str,
    draft: MarketWatchlistDraft,
    now: i64,
) -> Result<MarketWatchlist, MarketError> {
    validate(&draft)?;
    let txn = db.unchecked_transaction()?;
    let previous = get_watchlist(&txn, id)?;
    if draft.enabled && !previous.enabled {
        let enabled: i64 = txn.query_row(
            "SELECT COUNT(*) FROM market_watchlists WHERE enabled=1",
            [],
            |r| r.get(0),
        )?;
        if enabled >= MAX_ENABLED {
            return Err(MarketError::Limit);
        }
    }
    let stored_query = if draft.query_mode == "auto" {
        fallback_query(&draft.name)
    } else {
        draft.query.trim().to_string()
    };
    let plan = serde_json::to_string(
        &draft
            .query_plan
            .iter()
            .map(|q| q.trim())
            .collect::<Vec<_>>(),
    )
    .map_err(|_| MarketError::Invalid("invalid queryPlan".into()))?;
    let plan_changed = previous.query_mode != draft.query_mode
        || previous.query_plan != draft.query_plan
        || previous.name != draft.name.trim()
        || (draft.query_mode == "manual" && previous.query != draft.query.trim());
    txn.execute(
        "UPDATE market_watchlists
         SET name=?2, query=?3, region=?4, language=?5, enabled=?6, updated_at=?7,
             query_mode=?8, query_plan_json=?9, query_plan_source=?10,
             query_index=CASE WHEN ?11 THEN 0 ELSE query_index END,
             query_plan_revision=CASE WHEN ?11 THEN query_plan_revision+1 ELSE query_plan_revision END,
             next_due_at=CASE WHEN ?11 OR region!=?4 OR language!=?5 OR enabled=0 THEN ?7 ELSE next_due_at END,
             backoff_until=CASE WHEN ?11 OR region!=?4 OR language!=?5 THEN 0 ELSE backoff_until END
         WHERE id=?1",
        params![id, draft.name.trim(), stored_query, draft.region, draft.language,
                i64::from(draft.enabled), now, draft.query_mode, plan, draft.query_plan_source, plan_changed]
    )?;
    txn.commit()?;
    get_watchlist(db, id)
}

pub fn set_enabled(db: &Connection, id: &str, enabled: bool, now: i64) -> Result<(), MarketError> {
    let prior = get_watchlist(db, id)?;
    let _ = update_watchlist(
        db,
        id,
        MarketWatchlistDraft {
            name: prior.name,
            query: prior.query,
            region: prior.region,
            language: prior.language,
            enabled,
            query_mode: prior.query_mode,
            query_plan: prior.query_plan,
            query_plan_source: prior.query_plan_source,
        },
        now,
    )?;
    Ok(())
}

pub fn delete_watchlist(db: &Connection, id: &str) -> Result<(), MarketError> {
    if db.execute("DELETE FROM market_watchlists WHERE id=?1", [id])? == 0 {
        return Err(MarketError::NotFound);
    }
    Ok(())
}

pub fn list_due_watchlist_ids(db: &Connection, now: i64) -> Result<Vec<String>, MarketError> {
    let mut q = db.prepare(
        "SELECT id FROM market_watchlists
         WHERE enabled=1 AND next_due_at<=?1 AND backoff_until<=?1
         ORDER BY next_due_at, id LIMIT 10",
    )?;
    q.query_map([now], |r| r.get(0))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

pub fn used_search_calls(db: &Connection, now: i64) -> Result<i64, MarketError> {
    Ok(db.query_row(
        "SELECT COUNT(*) FROM market_search_budget WHERE reserved_at > ?1",
        [now - DAILY_SECONDS],
        |r| r.get(0),
    )?)
}

/// Explain why an explicit or scheduled collection could not reserve a search.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClaimBlocked {
    Disabled,
    Backoff {
        seconds: i64,
        last_error: Option<String>,
    },
    NotDue {
        seconds: i64,
    },
    InProgress,
    DailyBudget {
        seconds: i64,
    },
}

impl ClaimBlocked {
    pub fn message(&self) -> String {
        fn minutes(seconds: i64) -> i64 {
            ((seconds.max(1) + 59) / 60).max(1)
        }
        match self {
            Self::Disabled => "Daily collection is disabled for this watchlist.".into(),
            Self::Backoff {
                seconds,
                last_error,
            } => format!(
                "Collection is temporarily paused after {}. Try again in about {} minute(s).",
                last_error.as_deref().unwrap_or("a previous error"),
                minutes(*seconds)
            ),
            Self::NotDue { seconds } => format!(
                "Next scheduled collection is due in about {} minute(s).",
                minutes(*seconds)
            ),
            Self::InProgress => {
                "This watchlist is already collecting. Results refresh automatically.".into()
            }
            Self::DailyBudget { seconds } => format!(
                "The rolling 24-hour YouTube search budget (20 searches) is exhausted. Try again in about {} minute(s).",
                minutes(*seconds)
            ),
        }
    }
}

/// Atomic per-watchlist lease and conservative project-level API budget reservation.
/// Scheduled collections require an enabled watchlist. Explicit one-off actions
/// work even if the daily schedule is off, but obey backoff, lease and budget.
pub fn claim_watchlist_detailed(
    db: &Connection,
    watchlist_id: &str,
    now: i64,
    manual: bool,
) -> Result<Result<MarketRun, ClaimBlocked>, MarketError> {
    let txn = db.unchecked_transaction()?;
    let w = get_watchlist(&txn, watchlist_id)?;
    if !manual && !w.enabled {
        return Ok(Err(ClaimBlocked::Disabled));
    }
    if w.backoff_until > now {
        return Ok(Err(ClaimBlocked::Backoff {
            seconds: w.backoff_until - now,
            last_error: w.error_code,
        }));
    }
    if !manual && w.next_due_at > now {
        return Ok(Err(ClaimBlocked::NotDue {
            seconds: w.next_due_at - now,
        }));
    }
    let active: i64 = txn.query_row(
        "SELECT COUNT(*) FROM market_runs WHERE watchlist_id=?1 AND state='running'",
        [watchlist_id],
        |r| r.get(0),
    )?;
    if active > 0 {
        return Ok(Err(ClaimBlocked::InProgress));
    }
    let usage = used_search_calls(&txn, now)?;
    if usage >= MAX_SEARCH_CALLS {
        let earliest: Option<i64> = txn.query_row(
            "SELECT MIN(reserved_at) FROM market_search_budget WHERE reserved_at > ?1",
            [now - DAILY_SECONDS],
            |r| r.get(0),
        )?;
        return Ok(Err(ClaimBlocked::DailyBudget {
            seconds: (earliest.unwrap_or(now) + DAILY_SECONDS - now).max(1),
        }));
    }
    let id = fresh_id(&txn, "run")?;
    let effective_query = w.next_search_query.clone();
    txn.execute(
        "INSERT INTO market_runs(id,watchlist_id,state,started_at,effective_query,query_plan_revision)
         VALUES (?1,?2,'running',?3,?4,?5)",
        params![id, watchlist_id, now, effective_query, w.query_plan_revision],
    )?;
    txn.execute(
        "INSERT INTO market_search_budget(run_id,reserved_at) VALUES (?1,?2)",
        params![id, now],
    )?;
    txn.execute(
        "UPDATE market_watchlists SET next_due_at=?2, error_code=NULL WHERE id=?1",
        params![watchlist_id, now + DAILY_SECONDS],
    )?;
    txn.commit()?;
    Ok(Ok(MarketRun {
        id,
        watchlist_id: watchlist_id.into(),
        state: "running".into(),
        started_at: now,
        effective_query,
        query_plan_revision: w.query_plan_revision,
        allowed_while_disabled: manual && !w.enabled,
    }))
}

/// Preserve the optional-claim interface used by the automatic worker.
pub fn claim_watchlist(
    db: &Connection,
    watchlist_id: &str,
    now: i64,
    manual: bool,
) -> Result<Option<MarketRun>, MarketError> {
    Ok(claim_watchlist_detailed(db, watchlist_id, now, manual)?.ok())
}

pub fn complete_run(
    db: &Connection,
    run_id: &str,
    observations: &[VideoObservation],
    now: i64,
) -> Result<(), MarketError> {
    let txn = db.unchecked_transaction()?;
    let (watchlist_id, effective_query, plan_revision): (String, String, i64) = txn
        .query_row(
            "SELECT watchlist_id,effective_query,query_plan_revision FROM market_runs WHERE id=?1 AND state='running'",
            [run_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?
        .ok_or(MarketError::NotFound)?;
    for item in observations {
        if item.video_id.is_empty() || item.video_id.len() > 24 || item.title.len() > 400 {
            return Err(MarketError::Invalid(
                "invalid provider video metadata".into(),
            ));
        }
        txn.execute(
            "INSERT INTO market_video_observations
             (run_id,watchlist_id,video_id,title,channel_id,channel_title,published_at,duration_seconds,
              view_count,like_count,comment_count,subscriber_count,observed_at,expires_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
            params![run_id, watchlist_id, item.video_id, item.title, item.channel_id, item.channel_title,
                    item.published_at, item.duration_seconds, item.view_count, item.like_count, item.comment_count,
                    item.subscriber_count, now, now + RETENTION_SECONDS]
        )?;
    }
    txn.execute(
        "UPDATE market_runs SET state='succeeded', finished_at=?2, video_count=?3 WHERE id=?1",
        params![run_id, now, observations.len() as i64],
    )?;
    txn.execute(
        "UPDATE market_watchlists
        SET last_finished_at=?2, backoff_until=0, error_code=NULL,
            last_search_query=?3,
            query_index=CASE WHEN query_mode='auto' AND query_plan_json!='[]'
                   AND query_plan_revision=?4 THEN query_index+1 ELSE query_index END
        WHERE id=?1",
        params![watchlist_id, now, effective_query, plan_revision],
    )?;
    txn.commit()?;
    Ok(())
}

pub fn fail_run(
    db: &Connection,
    run_id: &str,
    error_code: &str,
    now: i64,
) -> Result<(), MarketError> {
    let backoff = if matches!(error_code, "quota_exceeded" | "rate_limited") {
        7200
    } else {
        900
    };
    let txn = db.unchecked_transaction()?;
    let watchlist_id: String = txn.query_row(
        "SELECT watchlist_id FROM market_runs WHERE id=?1",
        [run_id],
        |r| r.get(0),
    )?;
    txn.execute("UPDATE market_runs SET state='failed', error_code=?2, finished_at=?3 WHERE id=?1 AND state='running'",
        params![run_id, error_code, now])?;
    txn.execute("UPDATE market_watchlists SET backoff_until=?2, error_code=?3, last_finished_at=?4 WHERE id=?1",
        params![watchlist_id, now + backoff, error_code, now])?;
    txn.commit()?;
    Ok(())
}

pub fn reconcile_orphaned_runs(db: &Connection, now: i64) -> Result<(), MarketError> {
    let txn = db.unchecked_transaction()?;
    txn.execute(
        "UPDATE market_watchlists SET next_due_at=?1, backoff_until=?2, error_code='interrupted'
         WHERE id IN (SELECT watchlist_id FROM market_runs WHERE state='running')",
        params![now, now + 300],
    )?;
    txn.execute(
        "UPDATE market_runs SET state='failed', finished_at=?1, error_code='interrupted'
         WHERE state='running'",
        [now],
    )?;
    txn.commit()?;
    Ok(())
}

pub fn prune_expired(db: &Connection, now: i64) -> Result<usize, MarketError> {
    Ok(db.execute(
        "DELETE FROM market_video_observations WHERE expires_at<=?1",
        [now],
    )?)
}

pub fn count_all_observations(db: &Connection) -> Result<i64, MarketError> {
    Ok(
        db.query_row("SELECT COUNT(*) FROM market_video_observations", [], |r| {
            r.get(0)
        })?,
    )
}

pub fn list_observations(
    db: &Connection,
    watchlist_id: &str,
    now: i64,
) -> Result<Vec<MarketVideoRecord>, MarketError> {
    let mut q = db.prepare(
        "SELECT video_id,title,channel_id,channel_title,published_at,duration_seconds,
                view_count,like_count,comment_count,subscriber_count,observed_at,expires_at
         FROM market_video_observations
         WHERE watchlist_id=?1 AND expires_at>?2
         ORDER BY observed_at DESC, view_count DESC LIMIT 100",
    )?;
    q.query_map(params![watchlist_id, now], |row| {
        let video_id: String = row.get(0)?;
        Ok(MarketVideoRecord {
            source_url: format!("https://www.youtube.com/watch?v={video_id}"),
            provider: "youtube-data-api",
            video: VideoObservation {
                video_id,
                title: row.get(1)?,
                channel_id: row.get(2)?,
                channel_title: row.get(3)?,
                published_at: row.get(4)?,
                duration_seconds: row.get(5)?,
                view_count: row.get(6)?,
                like_count: row.get(7)?,
                comment_count: row.get(8)?,
                subscriber_count: row.get(9)?,
            },
            observed_at: row.get(10)?,
            expires_at: row.get(11)?,
        })
    })?
    .collect::<rusqlite::Result<Vec<_>>>()
    .map_err(Into::into)
}

/// Read-only, bounded cross-watchlist lookup. No provider request, quota
/// reservation, or persistent metadata is created by this operation.
pub fn find_related_observations(
    db: &Connection,
    topic: &str,
    now: i64,
) -> Result<Vec<RelatedMarketVideo>, MarketError> {
    use std::collections::HashSet;

    let topic = topic.trim();
    if topic.is_empty() || topic.chars().count() > 160 || topic.chars().any(char::is_control) {
        return Err(MarketError::Invalid(
            "topic must be 1–160 safe characters".into(),
        ));
    }
    const STOP: &[&str] = &[
        "the", "and", "for", "are", "you", "your", "that", "this", "which", "what", "why", "how",
        "with", "from", "does", "about", "versus", "was", "has", "have", "its", "not", "but",
        "can", "all", "into", "should", "when", "where", "who", "than", "their", "our", "will",
    ];
    let mut terms = Vec::new();
    for term in topic.to_lowercase().split(|c: char| !c.is_alphanumeric()) {
        if term.chars().count() >= 3 && !STOP.contains(&term) && !terms.contains(&term.to_owned()) {
            terms.push(term.to_owned());
        }
    }
    if terms.is_empty() {
        return Ok(Vec::new());
    }

    let mut query = db.prepare(
        "SELECT o.video_id,o.title,o.channel_id,o.channel_title,o.published_at,
                o.duration_seconds,o.view_count,o.like_count,o.comment_count,
                o.subscriber_count,o.observed_at,o.expires_at,w.name
         FROM market_video_observations o
         JOIN market_watchlists w ON w.id=o.watchlist_id
         WHERE o.expires_at>?1
         ORDER BY o.observed_at DESC,o.rowid DESC LIMIT 5000",
    )?;
    let rows = query.query_map([now], |row| {
        Ok((
            VideoObservation {
                video_id: row.get(0)?,
                title: row.get(1)?,
                channel_id: row.get(2)?,
                channel_title: row.get(3)?,
                published_at: row.get(4)?,
                duration_seconds: row.get(5)?,
                view_count: row.get(6)?,
                like_count: row.get(7)?,
                comment_count: row.get(8)?,
                subscriber_count: row.get(9)?,
            },
            row.get::<_, i64>(10)?,
            row.get::<_, i64>(11)?,
            row.get::<_, String>(12)?,
        ))
    })?;
    let mut seen = HashSet::new();
    let mut matches = Vec::new();
    for row in rows {
        let (video, observed_at, expires_at, watchlist_name) = row?;
        if !seen.insert(video.video_id.clone()) {
            continue;
        }
        let lower = video.title.to_lowercase();
        let matched_terms: Vec<String> = terms
            .iter()
            .filter(|term| lower.contains(term.as_str()))
            .cloned()
            .collect();
        let minimum = if terms.len() >= 3 { 2 } else { 1 };
        if matched_terms.len() < minimum {
            continue;
        }
        matches.push(RelatedMarketVideo {
            video: MarketVideoRecord {
                source_url: format!("https://www.youtube.com/watch?v={}", video.video_id),
                provider: "youtube-data-api",
                video,
                observed_at,
                expires_at,
            },
            watchlist_name,
            matched_terms,
        });
        if matches.len() == 12 {
            break;
        }
    }
    Ok(matches)
}
