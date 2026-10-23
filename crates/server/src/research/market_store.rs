//! Public market observations: bounded watchlists, durable search budget,
//! restart-safe leases, and short-lived API-derived snapshots.

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

const DAILY_SECONDS: i64 = 86_400;
const RETENTION_SECONDS: i64 = 30 * DAILY_SECONDS;
const MAX_SEARCH_CALLS: i64 = 20;
const MAX_ENABLED: i64 = 10;

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
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketRun {
    pub id: String,
    pub watchlist_id: String,
    pub state: String,
    pub started_at: i64,
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

fn validate(draft: &MarketWatchlistDraft) -> Result<(), MarketError> {
    let name = draft.name.trim();
    let query = draft.query.trim();
    if !(1..=80).contains(&name.chars().count()) {
        return Err(MarketError::Invalid("name must be 1–80 characters".into()));
    }
    if !(3..=160).contains(&query.chars().count()) {
        return Err(MarketError::Invalid(
            "query must be 3–160 characters".into(),
        ));
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
    Ok(MarketWatchlist {
        id: row.get(0)?,
        name: row.get(1)?,
        query: row.get(2)?,
        region: row.get(3)?,
        language: row.get(4)?,
        enabled: row.get::<_, i64>(5)? == 1,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        next_due_at: row.get(8)?,
        last_finished_at: row.get(9)?,
        backoff_until: row.get(10)?,
        error_code: row.get(11)?,
    })
}

const WATCHLIST_COLUMNS: &str = "id, name, query, region, language, enabled, created_at, updated_at, next_due_at, last_finished_at, backoff_until, error_code";

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
    txn.execute(
        "INSERT INTO market_watchlists(id,name,query,region,language,enabled,created_at,updated_at,next_due_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?7,?7)",
        params![id, draft.name.trim(), draft.query.trim(), draft.region, draft.language, i64::from(draft.enabled), now]
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
    txn.execute(
        "UPDATE market_watchlists
         SET name=?2, query=?3, region=?4, language=?5, enabled=?6, updated_at=?7,
             next_due_at=CASE WHEN query!=?3 OR region!=?4 OR language!=?5 OR enabled=0 THEN ?7 ELSE next_due_at END,
             backoff_until=CASE WHEN query!=?3 OR region!=?4 OR language!=?5 THEN 0 ELSE backoff_until END
         WHERE id=?1",
        params![id, draft.name.trim(), draft.query.trim(), draft.region, draft.language, i64::from(draft.enabled), now]
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

/// Atomic per-watchlist lease and conservative project-level API budget reservation.
/// Returns None when disabled, not due, active, backing off, or at quota.
pub fn claim_watchlist(
    db: &Connection,
    watchlist_id: &str,
    now: i64,
    manual: bool,
) -> Result<Option<MarketRun>, MarketError> {
    let txn = db.unchecked_transaction()?;
    let w = get_watchlist(&txn, watchlist_id)?;
    if !w.enabled || w.backoff_until > now || (!manual && w.next_due_at > now) {
        return Ok(None);
    }
    let active: i64 = txn.query_row(
        "SELECT COUNT(*) FROM market_runs WHERE watchlist_id=?1 AND state='running'",
        [watchlist_id],
        |r| r.get(0),
    )?;
    let usage = used_search_calls(&txn, now)?;
    if active > 0 || usage >= MAX_SEARCH_CALLS {
        return Ok(None);
    }
    let id = fresh_id(&txn, "run")?;
    txn.execute(
        "INSERT INTO market_runs(id,watchlist_id,state,started_at) VALUES (?1,?2,'running',?3)",
        params![id, watchlist_id, now],
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
    Ok(Some(MarketRun {
        id,
        watchlist_id: watchlist_id.into(),
        state: "running".into(),
        started_at: now,
    }))
}

pub fn complete_run(
    db: &Connection,
    run_id: &str,
    observations: &[VideoObservation],
    now: i64,
) -> Result<(), MarketError> {
    let txn = db.unchecked_transaction()?;
    let watchlist_id: String = txn
        .query_row(
            "SELECT watchlist_id FROM market_runs WHERE id=?1 AND state='running'",
            [run_id],
            |r| r.get(0),
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
    txn.execute("UPDATE market_watchlists SET last_finished_at=?2, backoff_until=0, error_code=NULL WHERE id=?1",
        params![watchlist_id, now])?;
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
