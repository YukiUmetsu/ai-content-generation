//! Best-effort Google Trends observations for discovery ideas.
//!
//! Trends' 0-100 values are *independently normalized for each query*. Only
//! change within the same query over time is measured here; never treat these
//! numbers as search volume or compare absolute levels across different ideas.

use std::time::Duration;

use gtrend_rs::{
    ComparaisonElem, Request, TrendsClient, WidgetCategory, WidgetKeyword,
    enums::{Category, Country, Period, PredefinedPeriod, Property},
};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::Serialize;
use serde_json::Value;

const DAY: i64 = 86_400;
const WEEK: i64 = 7 * DAY;
const RETENTION: i64 = 30 * DAY;
const RECHECK_INTERVAL: i64 = 6 * 3_600;
const MAX_DAILY_REQUESTS: i64 = 12;
const VERSION: &str = "google-trends-momentum-v1";
const PROVIDER_TIMEOUT: Duration = Duration::from_secs(25);

#[derive(Debug, Clone, Copy, thiserror::Error)]
pub enum TrendsProviderError {
    #[error("Google Trends timed out")]
    Timeout,
    #[error("Google Trends rate-limited this app")]
    RateLimited,
    #[error("Google Trends is unavailable")]
    Unavailable,
    #[error("Google Trends returned unusable or insufficient observations")]
    InvalidPayload,
}

impl TrendsProviderError {
    pub fn code(self) -> &'static str {
        match self {
            Self::Timeout => "timeout",
            Self::RateLimited => "rate_limited",
            Self::Unavailable => "provider_unavailable",
            Self::InvalidPayload => "invalid_payload",
        }
    }
}

/// Strict provider boundary. The `gtrend-rs` client uses Google's unofficial
/// endpoints. Its errors may include full response bodies and the query, so
/// error contents MUST NOT be logged or forwarded to the UI.
pub async fn collect(run: &TrendRun) -> Result<Vec<TrendPoint>, TrendsProviderError> {
    let result = tokio::time::timeout(PROVIDER_TIMEOUT, async {
        let client = TrendsClient::try_default()
            .await
            .map_err(classify_provider_error)?;
        let request = Request::new(
            vec![ComparaisonElem {
                keyword: &run.query,
                geo: Country::US,
                time: Period::Predefined(PredefinedPeriod::OneYear),
            }],
            Category::All,
            Property::Web,
        )
        .map_err(|_| TrendsProviderError::InvalidPayload)?;
        let explore = client
            .explore(request)
            .await
            .map_err(classify_provider_error)?;
        let json = explore
            .get_widget_as_json(&WidgetKeyword::All, WidgetCategory::Timeseries)
            .await
            .map_err(classify_provider_error)?;
        parse_trends_timeseries(&json)
    })
    .await;
    match result {
        Ok(value) => value,
        Err(_) => Err(TrendsProviderError::Timeout),
    }
}

fn classify_provider_error(error: gtrend_rs::Error) -> TrendsProviderError {
    // Some library errors embed the entire response, including the query.
    // Inspect in memory only; never print, serialize, or store this string.
    let description = error.to_string().to_ascii_lowercase();
    if description.contains("429")
        || description.contains("rate limit")
        || description.contains("unusual traffic")
        || description.contains("too many requests")
    {
        TrendsProviderError::RateLimited
    } else {
        TrendsProviderError::Unavailable
    }
}

/// Google widgetdata/multiline response structure. Do not count a withheld
/// sample (`hasData=false`) as zero interest, and discard incomplete weeks.
fn parse_trends_timeseries(payload: &Value) -> Result<Vec<TrendPoint>, TrendsProviderError> {
    let timeline = payload
        .pointer("/default/timelineData")
        .and_then(Value::as_array)
        .ok_or(TrendsProviderError::InvalidPayload)?;
    let mut points = Vec::with_capacity(timeline.len().min(60));
    for item in timeline {
        if item.get("isPartial").and_then(Value::as_bool) == Some(true)
            || item.pointer("/hasData/0").and_then(Value::as_bool) == Some(false)
        {
            continue;
        }
        let timestamp = item
            .get("time")
            .and_then(Value::as_str)
            .and_then(|value| value.parse::<i64>().ok())
            .ok_or(TrendsProviderError::InvalidPayload)?;
        let value = item
            .pointer("/value/0")
            .and_then(Value::as_i64)
            .ok_or(TrendsProviderError::InvalidPayload)?;
        if timestamp <= 0 || !(0..=100).contains(&value) {
            return Err(TrendsProviderError::InvalidPayload);
        }
        points.push(TrendPoint { timestamp, value });
    }
    // A one-year query should have about 52 complete weekly observations.
    // Require two 13-week windows so seasonal noise is not disguised as data.
    if points.len() < 26 {
        return Err(TrendsProviderError::InvalidPayload);
    }
    if points.len() > 60 {
        points.drain(..points.len() - 60);
    }
    if points
        .windows(2)
        .any(|pair| pair[0].timestamp >= pair[1].timestamp)
        || !has_contiguous_recent_weeks(&points)
    {
        return Err(TrendsProviderError::InvalidPayload);
    }
    Ok(points)
}

fn has_contiguous_recent_weeks(points: &[TrendPoint]) -> bool {
    let Some(recent) = points.get(points.len().saturating_sub(26)..) else {
        return false;
    };
    recent.len() == 26 && recent.windows(2).all(|pair| {
        pair[1].timestamp.checked_sub(pair[0].timestamp) == Some(WEEK)
    })
}

#[derive(Debug, thiserror::Error)]
pub enum TrendsStoreError {
    #[error("local database operation failed")]
    Db(#[from] rusqlite::Error),
    #[error("invalid Google Trends query, observation, or timestamp")]
    Invalid,
    #[error("discovery idea or active Trends run not found")]
    NotFound,
    #[error("Google Trends was recently checked for this idea")]
    Busy,
    #[error("Google Trends daily safety budget reached")]
    Budget,
    #[error("unable to create a secure Google Trends observation identifier")]
    Identifier,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrendRun {
    pub id: String,
    pub idea_id: String,
    pub query: String,
    pub region: String,
    pub started_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrendPoint {
    pub timestamp: i64,
    /// Google's per-query normalized index, never absolute search count.
    pub value: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleTrendsAssessment {
    pub state: String,
    pub query: String,
    pub region: String,
    pub observed_at: Option<i64>,
    pub recent_mean: Option<f64>,
    pub previous_mean: Option<f64>,
    pub change_percent: Option<f64>,
    pub points: usize,
    pub metric_version: String,
    pub error_code: Option<String>,
}

/// Reserve a provider attempt before contacting the external service. This
/// enforces a global local-app budget independently of concurrent workers.
pub fn claim_assessment(
    db: &mut Connection,
    idea_id: &str,
    query: &str,
    now: i64,
) -> Result<TrendRun, TrendsStoreError> {
    let query = query.trim();
    if !(3..=120).contains(&query.chars().count())
        || query.chars().any(char::is_control)
        || idea_id.is_empty()
        || !(1..=i64::MAX - RETENTION).contains(&now)
    {
        return Err(TrendsStoreError::Invalid);
    }
    let transaction = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let exists: i64 = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM discovery_candidates WHERE id=?1)",
        [idea_id],
        |row| row.get(0),
    )?;
    if exists == 0 {
        return Err(TrendsStoreError::NotFound);
    }
    let recent: Option<(String, i64)> = transaction
        .query_row(
            "SELECT state,started_at FROM idea_trends_runs WHERE idea_id=?1
         ORDER BY started_at DESC,id DESC LIMIT 1",
            [idea_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if recent.is_some_and(|(state, started)| {
        state == "running" || now < started.saturating_add(RECHECK_INTERVAL)
    }) {
        return Err(TrendsStoreError::Busy);
    }
    let used: i64 = transaction.query_row(
        "SELECT COUNT(*) FROM idea_trends_runs WHERE started_at>?1 AND state!='unavailable'",
        [now - DAY],
        |row| row.get(0),
    )?;
    if used >= MAX_DAILY_REQUESTS {
        return Err(TrendsStoreError::Budget);
    }
    let mut bytes = [0u8; 12];
    getrandom::getrandom(&mut bytes).map_err(|_| TrendsStoreError::Identifier)?;
    let id = format!(
        "idea_trends_{}",
        bytes
            .iter()
            .map(|value| format!("{value:02x}"))
            .collect::<String>()
    );
    transaction.execute(
        "INSERT INTO idea_trends_runs(id,idea_id,query,metric_version,region,state,started_at)
         VALUES(?1,?2,?3,?4,'US','running',?5)",
        params![id, idea_id, query, VERSION, now],
    )?;
    transaction.commit()?;
    Ok(TrendRun {
        id,
        idea_id: idea_id.to_owned(),
        query: query.to_owned(),
        region: "US".into(),
        started_at: now,
    })
}

/// Persist provider observations and compute last-13 versus preceding-13
/// weekly points. A zero previous baseline has undefined percentage growth.
pub fn complete_assessment(
    db: &Connection,
    run_id: &str,
    points: &[TrendPoint],
    now: i64,
) -> Result<(), TrendsStoreError> {
    if !(26..=60).contains(&points.len())
        || !(1..=i64::MAX - RETENTION).contains(&now)
        || points
            .iter()
            .any(|point| point.timestamp <= 0 || !(0..=100).contains(&point.value))
        || points
            .windows(2)
            .any(|pair| pair[0].timestamp >= pair[1].timestamp)
        || !has_contiguous_recent_weeks(points)
    {
        return Err(TrendsStoreError::Invalid);
    }
    let transaction = db.unchecked_transaction()?;
    let active: i64 = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM idea_trends_runs WHERE id=?1 AND state='running')",
        [run_id],
        |row| row.get(0),
    )?;
    if active == 0 {
        return Err(TrendsStoreError::NotFound);
    }
    for point in points {
        transaction.execute(
            "INSERT INTO idea_trends_points(run_id,timestamp,normalized_interest)
             VALUES(?1,?2,?3)",
            params![run_id, point.timestamp, point.value],
        )?;
    }
    let previous_mean = points[points.len() - 26..points.len() - 13]
        .iter()
        .map(|point| point.value as f64)
        .sum::<f64>()
        / 13.0;
    let recent_mean = points[points.len() - 13..]
        .iter()
        .map(|point| point.value as f64)
        .sum::<f64>()
        / 13.0;
    let change_percent =
        (previous_mean > 0.0).then_some((recent_mean - previous_mean) * 100.0 / previous_mean);
    transaction.execute(
        "UPDATE idea_trends_runs SET state='succeeded',finished_at=?2,observed_at=?2,
         points=?3,previous_mean=?4,recent_mean=?5,change_percent=?6,error_code=NULL WHERE id=?1",
        params![
            run_id,
            now,
            points.len() as i64,
            previous_mean,
            recent_mean,
            change_percent
        ],
    )?;
    transaction.commit()?;
    Ok(())
}

/// Record only a small fixed error category. Provider messages can include
/// query text, full HTML responses, or device details and must not be stored.
pub fn fail_assessment(
    db: &Connection,
    run_id: &str,
    code: &str,
    now: i64,
) -> Result<(), TrendsStoreError> {
    if !(1..=i64::MAX - RETENTION).contains(&now) {
        return Err(TrendsStoreError::Invalid);
    }
    let code = safe_error_code(code);
    let updated = db.execute(
        "UPDATE idea_trends_runs SET state='failed',finished_at=?2,error_code=?3
         WHERE id=?1 AND state='running'",
        params![run_id, now, code],
    )?;
    if updated == 0 {
        return Err(TrendsStoreError::NotFound);
    }
    Ok(())
}

fn safe_error_code(code: &str) -> &'static str {
    match code {
        "rate_limited" => "rate_limited",
        "provider_unavailable" => "provider_unavailable",
        "invalid_payload" => "invalid_payload",
        "insufficient_sample" => "insufficient_sample",
        "timeout" => "timeout",
        "network_error" => "network_error",
        "interrupted" => "interrupted",
        "budget_exhausted" => "budget_exhausted",
        "no_public_endpoint" => "no_public_endpoint",
        "collection_limit" => "collection_limit",
        _ => "provider_unavailable",
    }
}

/// Durable reason for not contacting Trends, e.g. after a provider 429 or
/// when the local per-day safety cap has already been reached. These rows
/// cannot be mistaken for a successful measurement and cost zero calls.
pub fn record_unavailable_assessment(
    db: &mut Connection,
    idea_id: &str,
    query: &str,
    code: &str,
    now: i64,
) -> Result<(), TrendsStoreError> {
    let query = query.trim();
    if !(3..=120).contains(&query.chars().count())
        || query.chars().any(char::is_control)
        || !(1..=i64::MAX - RETENTION).contains(&now)
    {
        return Err(TrendsStoreError::Invalid);
    }
    let transaction = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let exists: i64 = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM discovery_candidates WHERE id=?1)",
        [idea_id],
        |row| row.get(0),
    )?;
    if exists == 0 {
        return Err(TrendsStoreError::NotFound);
    }
    let previous: Option<(String, String, i64)> = transaction
        .query_row(
            "SELECT state,query,started_at FROM idea_trends_runs WHERE idea_id=?1
         ORDER BY started_at DESC,id DESC LIMIT 1",
            [idea_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    if let Some((state, old_query, started)) = previous {
        if state == "running" {
            return Err(TrendsStoreError::Busy);
        }
        if query == old_query && now < started.saturating_add(RECHECK_INTERVAL) {
            // Preserve the true prior reason instead of appending repeated
            // synthetic failures on every worker retry or UI page visit.
            return Ok(());
        }
    }
    let mut bytes = [0u8; 12];
    getrandom::getrandom(&mut bytes).map_err(|_| TrendsStoreError::Identifier)?;
    let id = format!(
        "idea_trends_{}",
        bytes
            .iter()
            .map(|value| format!("{value:02x}"))
            .collect::<String>()
    );
    transaction.execute(
        "INSERT INTO idea_trends_runs(id,idea_id,query,metric_version,region,state,started_at,
         finished_at,error_code) VALUES(?1,?2,?3,?4,'US','unavailable',?5,?5,?6)",
        params![id, idea_id, query, VERSION, now, safe_error_code(code)],
    )?;
    transaction.commit()?;
    Ok(())
}

/// An interrupted process must not leave a per-idea "running" lock forever.
/// We make the incomplete provider attempt explicit and keep its reservation.
pub fn reconcile_interrupted(db: &Connection, now: i64) -> Result<usize, TrendsStoreError> {
    if !(1..=i64::MAX - RETENTION).contains(&now) {
        return Err(TrendsStoreError::Invalid);
    }
    Ok(db.execute(
        "UPDATE idea_trends_runs SET state='failed',finished_at=?1,error_code='interrupted'
         WHERE state='running' AND started_at<=?1",
        [now],
    )?)
}

pub fn prune_expired(db: &Connection, now: i64) -> Result<usize, TrendsStoreError> {
    if !(1..=i64::MAX - RETENTION).contains(&now) {
        return Err(TrendsStoreError::Invalid);
    }
    Ok(db.execute(
        "DELETE FROM idea_trends_runs WHERE state!='running' AND started_at<=?1",
        [now - RETENTION],
    )?)
}

pub fn latest_assessment(
    db: &Connection,
    idea_id: &str,
    now: i64,
) -> Result<Option<GoogleTrendsAssessment>, TrendsStoreError> {
    db.query_row(
        "SELECT state,query,region,observed_at,recent_mean,previous_mean,change_percent,
                points,metric_version,error_code FROM idea_trends_runs
         WHERE idea_id=?1 AND started_at>?2 ORDER BY started_at DESC,id DESC LIMIT 1",
        params![idea_id, now.saturating_sub(RETENTION)],
        |row| {
            Ok(GoogleTrendsAssessment {
                state: row.get(0)?,
                query: row.get(1)?,
                region: row.get(2)?,
                observed_at: row.get(3)?,
                recent_mean: row.get(4)?,
                previous_mean: row.get(5)?,
                change_percent: row.get(6)?,
                points: row.get(7)?,
                metric_version: row.get(8)?,
                error_code: row.get(9)?,
            })
        },
    )
    .optional()
    .map_err(TrendsStoreError::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_only_real_google_interest_points_and_ignores_partial_current_week() {
        let timeline = (0..31)
            .map(|index| {
                serde_json::json!({
                    "time": (1_700_000_000_i64 + index * 604_800).to_string(),
                    "value": [if index < 14 { 24 } else { 38 }],
                    "hasData": [index != 2],
                    "isPartial": index == 30,
                })
            })
            .collect::<Vec<_>>();
        let series = serde_json::json!({"default":{"timelineData":timeline}});
        let points = parse_trends_timeseries(&series).unwrap();
        assert_eq!(points.len(), 29);
        assert_eq!(points[0].value, 24);
        assert_eq!(points.last().unwrap().value, 38);
        assert!(
            points
                .iter()
                .all(|p| p.timestamp != 1_700_000_000 + 2 * 604_800)
        );
    }

    #[test]
    fn rejects_malformed_or_empty_interest_series_instead_of_inventing_zeroes() {
        assert!(
            parse_trends_timeseries(&serde_json::json!({"default":{"timelineData":[]}})).is_err()
        );
        assert!(
            parse_trends_timeseries(
                &serde_json::json!({"default":{"timelineData":[{"time":"bad","value":[50]}]}})
            )
            .is_err()
        );
        assert!(parse_trends_timeseries(&serde_json::json!({"default":{"timelineData":[{"time":"123456789","value":[999]}]}})).is_err());
    }

    #[test]
    fn missing_recent_week_cannot_masquerade_as_a_thirteen_week_change() {
        let timeline = (0..28)
            .map(|index| serde_json::json!({
                "time": (1_700_000_000_i64 + index * WEEK).to_string(),
                "value": [30],
                "hasData": [index != 18],
                "isPartial": index == 27,
            }))
            .collect::<Vec<_>>();
        assert!(parse_trends_timeseries(&serde_json::json!({"default":{"timelineData":timeline}})).is_err());
    }
}
