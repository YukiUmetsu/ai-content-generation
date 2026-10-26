//! Google Search keyword planning observations. Never a YouTube search-volume
//! estimate. OAuth credentials stay in the process environment, not SQLite.

use std::collections::HashSet;

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Debug, Clone, thiserror::Error)]
pub enum AdsError {
    #[error("Google Ads is not configured")]
    NotConfigured,
    #[error("Google Ads authentication failed")]
    Authentication,
    #[error("Google Ads access was denied")]
    Permission,
    #[error("Google Ads quota or rate limit reached")]
    Quota,
    #[error("Google Ads is temporarily unavailable")]
    Unavailable,
    #[error("Google Ads returned invalid data")]
    InvalidPayload,
    #[error("invalid Google Ads request")]
    InvalidRequest,
    #[error("Google Ads collection limit reached for this Discovery run")]
    CollectionLimit,
}

impl AdsError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotConfigured => "not_configured",
            Self::Authentication => "authentication",
            Self::Permission => "permission",
            Self::Quota => "rate_limited",
            Self::Unavailable => "provider_unavailable",
            Self::InvalidPayload => "invalid_payload",
            Self::InvalidRequest => "invalid_request",
            Self::CollectionLimit => "collection_limit",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeywordIdea {
    pub keyword: String,
    pub close_variants: Vec<String>,
    pub google_monthly_searches: Option<i64>,
    pub advertiser_competition: Option<String>,
    pub low_top_page_bid_micros: Option<i64>,
    pub high_top_page_bid_micros: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeywordAssessment {
    pub state: String,
    pub metric_version: &'static str,
    pub query: String,
    pub observed_at: i64,
    pub error_code: Option<String>,
    pub keywords: Vec<KeywordIdea>,
}

/// Save sanitized values atomically; no environment credentials or raw provider
/// responses can enter SQLite. Missing permission is a failure state, not zero.
pub fn save_assessment(
    db: &mut Connection,
    idea_id: &str,
    query: &str,
    result: Result<&[KeywordIdea], &AdsError>,
    now: i64,
) -> Result<(), rusqlite::Error> {
    let mut random = [0u8; 12];
    getrandom::getrandom(&mut random).map_err(|_| rusqlite::Error::InvalidQuery)?;
    let id = format!(
        "google_ads_{}",
        random
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    );
    let tx = db.transaction()?;
    let (state, error) = match result.as_ref() {
        Ok(_) => ("succeeded", None),
        Err(e) => ("failed", Some(e.code())),
    };
    tx.execute(
        "INSERT INTO google_ads_idea_runs(id,idea_id,query,state,observed_at,error_code)
                VALUES(?1,?2,?3,?4,?5,?6)",
        params![id, idea_id, query, state, now, error],
    )?;
    if let Ok(keywords) = result {
        for keyword in keywords.iter().take(50) {
            if keyword.keyword.len() > 120
                || keyword.keyword.len() < 3
                || keyword.google_monthly_searches.is_some_and(|v| v < 0)
            {
                continue;
            }
            tx.execute("INSERT OR IGNORE INTO google_ads_keyword_observations (
                    run_id,keyword,close_variants_json,monthly_google_searches,advertiser_competition,
                    low_top_page_bid_micros,high_top_page_bid_micros)
                    VALUES(?1,?2,?3,?4,?5,?6,?7)",params![id, keyword.keyword,
                    serde_json::to_string(&keyword.close_variants).unwrap_or_else(|_| "[]".into()),
                    keyword.google_monthly_searches,keyword.advertiser_competition,
                    keyword.low_top_page_bid_micros, keyword.high_top_page_bid_micros])?;
        }
    }
    tx.commit()
}

pub fn latest_assessment(
    db: &Connection,
    idea_id: &str,
) -> Result<Option<KeywordAssessment>, rusqlite::Error> {
    let latest = db
        .query_row(
            "SELECT id,query,state,observed_at,error_code FROM google_ads_idea_runs
        WHERE idea_id=?1 ORDER BY observed_at DESC,rowid DESC LIMIT 1",
            [idea_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, Option<String>>(4)?,
                ))
            },
        )
        .optional()?;
    let Some((id, query, state, observed_at, error_code)) = latest else {
        return Ok(None);
    };
    let mut statement = db.prepare(
        "SELECT keyword,close_variants_json,monthly_google_searches,advertiser_competition,
        low_top_page_bid_micros,high_top_page_bid_micros FROM google_ads_keyword_observations
        WHERE run_id=?1 ORDER BY monthly_google_searches DESC,keyword ASC LIMIT 50",
    )?;
    let keywords = statement
        .query_map([id], |r| {
            let variants: String = r.get(1)?;
            Ok(KeywordIdea {
                keyword: r.get(0)?,
                close_variants: serde_json::from_str(&variants).unwrap_or_default(),
                google_monthly_searches: r.get(2)?,
                advertiser_competition: r.get(3)?,
                low_top_page_bid_micros: r.get(4)?,
                high_top_page_bid_micros: r.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Some(KeywordAssessment {
        state,
        metric_version: "google-ads-search-keywords-v1",
        query,
        observed_at,
        error_code,
        keywords,
    }))
}

/// Monthly refresh for saved Search-volume estimates; permission failures
/// cool down so an inaccessible provider is not hammered every minute.
pub fn needs_refresh(db: &Connection, idea_id: &str, now: i64) -> Result<bool, rusqlite::Error> {
    let latest = db
        .query_row(
            "SELECT state,error_code,observed_at FROM google_ads_idea_runs
            WHERE idea_id=?1 ORDER BY observed_at DESC,rowid DESC LIMIT 1",
            [idea_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()?;
    Ok(latest.is_none_or(|(state, code, time)| {
        let cooldown = if state == "succeeded" {
            30 * 86_400
        } else if code.as_deref() == Some("collection_limit") {
            86_400
        } else {
            6 * 3_600
        };
        now.saturating_sub(time) >= cooldown
    }))
}

pub fn prune_expired(db: &Connection, now: i64) -> Result<(), rusqlite::Error> {
    db.execute(
        "DELETE FROM google_ads_idea_runs WHERE observed_at<=?1",
        [now - 90 * 86_400],
    )?;
    Ok(())
}

#[derive(Clone)]
pub struct GoogleAdsClient {
    customer_id: String,
    manager_id: Option<String>,
    client_id: String,
    client_secret: String,
    refresh_token: String,
    oauth_endpoint: String,
    api_endpoint: String,
    http: reqwest::Client,
}

fn valid_customer(id: &str) -> bool {
    id.len() == 10 && id.bytes().all(|b| b.is_ascii_digit())
}

impl GoogleAdsClient {
    /// Entire provider is opt-in and cannot make an outbound request without
    /// explicit project-specific OAuth and a Google Ads customer ID.
    pub fn from_env() -> Result<Self, AdsError> {
        let customer = std::env::var("CONTENTGEN_GOOGLE_ADS_CUSTOMER_ID").unwrap_or_default();
        let manager = std::env::var("CONTENTGEN_GOOGLE_ADS_MANAGER_ID").ok();
        let client_id = std::env::var("CONTENTGEN_GOOGLE_ADS_CLIENT_ID").unwrap_or_default();
        let client_secret =
            std::env::var("CONTENTGEN_GOOGLE_ADS_CLIENT_SECRET").unwrap_or_default();
        let refresh_token =
            std::env::var("CONTENTGEN_GOOGLE_ADS_REFRESH_TOKEN").unwrap_or_default();
        Self::configured(
            customer,
            manager,
            client_id,
            client_secret,
            refresh_token,
            "https://oauth2.googleapis.com/token".into(),
            "https://googleads.googleapis.com/v26".into(),
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn configured(
        customer_id: String,
        manager_id: Option<String>,
        client_id: String,
        client_secret: String,
        refresh_token: String,
        oauth_endpoint: String,
        api_endpoint: String,
    ) -> Result<Self, AdsError> {
        if customer_id.is_empty()
            || client_id.is_empty()
            || client_secret.is_empty()
            || refresh_token.is_empty()
        {
            return Err(AdsError::NotConfigured);
        }
        if !valid_customer(&customer_id)
            || manager_id.as_deref().is_some_and(|id| !valid_customer(id))
        {
            return Err(AdsError::InvalidRequest);
        }
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(|_| AdsError::Unavailable)?;
        Ok(Self {
            customer_id,
            manager_id,
            client_id,
            client_secret,
            refresh_token,
            oauth_endpoint,
            api_endpoint,
            http,
        })
    }

    pub async fn generate_keyword_ideas(
        &self,
        phrases: &[String],
    ) -> Result<Vec<KeywordIdea>, AdsError> {
        if phrases.is_empty()
            || phrases.len() > 20
            || phrases.iter().any(|q| {
                q.trim().chars().count() < 3
                    || q.chars().count() > 120
                    || q.chars().any(char::is_control)
            })
        {
            return Err(AdsError::InvalidRequest);
        }
        let auth = self
            .http
            .post(&self.oauth_endpoint)
            .form(&[
                ("grant_type", "refresh_token"),
                ("client_id", &self.client_id),
                ("client_secret", &self.client_secret),
                ("refresh_token", &self.refresh_token),
            ])
            .send()
            .await
            .map_err(|_| AdsError::Unavailable)?;
        if !auth.status().is_success() {
            return Err(AdsError::Authentication);
        }
        let auth_body = auth.bytes().await.map_err(|_| AdsError::Unavailable)?;
        if auth_body.len() > 16_384 {
            return Err(AdsError::InvalidPayload);
        }
        let value: Value =
            serde_json::from_slice(&auth_body).map_err(|_| AdsError::InvalidPayload)?;
        let token = value
            .get("access_token")
            .and_then(Value::as_str)
            .filter(|token| !token.is_empty() && token.len() <= 4_096)
            .ok_or(AdsError::InvalidPayload)?;
        let mut request = self
            .http
            .post(format!(
                "{}/customers/{}:generateKeywordIdeas",
                self.api_endpoint, self.customer_id
            ))
            .bearer_auth(token)
            .json(&json!({
                "language": "languageConstants/1000",
                "geoTargetConstants": ["geoTargetConstants/2840"],
                "keywordPlanNetwork": "GOOGLE_SEARCH",
                "includeAdultKeywords": false,
                "pageSize": 50,
                "keywordSeed": {"keywords": phrases},
            }));
        if let Some(manager) = &self.manager_id {
            request = request.header("login-customer-id", manager);
        }
        let response = request.send().await.map_err(|_| AdsError::Unavailable)?;
        match response.status().as_u16() {
            401 => return Err(AdsError::Authentication),
            403 => return Err(AdsError::Permission),
            429 => return Err(AdsError::Quota),
            400 => return Err(AdsError::InvalidRequest),
            500..=599 => return Err(AdsError::Unavailable),
            200..=299 => {}
            _ => return Err(AdsError::Unavailable),
        }
        let bytes = response.bytes().await.map_err(|_| AdsError::Unavailable)?;
        if bytes.len() > 1_000_000 {
            return Err(AdsError::InvalidPayload);
        }
        parse_keyword_ideas(&bytes)
    }
}

fn count(value: Option<&Value>) -> Option<i64> {
    match value? {
        Value::String(s) => s.parse::<i64>().ok().filter(|x| *x >= 0),
        Value::Number(n) => n.as_i64().filter(|x| *x >= 0),
        _ => None,
    }
}

fn parse_keyword_ideas(bytes: &[u8]) -> Result<Vec<KeywordIdea>, AdsError> {
    let parsed: Value = serde_json::from_slice(bytes).map_err(|_| AdsError::InvalidPayload)?;
    let rows = parsed
        .get("results")
        .and_then(Value::as_array)
        .ok_or(AdsError::InvalidPayload)?;
    let mut seen = HashSet::new();
    let mut ideas = Vec::new();
    for row in rows.iter().take(50) {
        let Some(keyword) = row.get("text").and_then(Value::as_str) else {
            continue;
        };
        let keyword = keyword.trim();
        if keyword.len() > 120
            || keyword.len() < 3
            || keyword.chars().any(char::is_control)
            || !seen.insert(keyword.to_lowercase())
        {
            continue;
        }
        let metrics = row.get("keywordIdeaMetrics");
        let competition = metrics
            .and_then(|m| m.get("competition"))
            .and_then(Value::as_str)
            .filter(|v| matches!(*v, "LOW" | "MEDIUM" | "HIGH"))
            .map(str::to_owned);
        let close_variants = row
            .get("closeVariants")
            .and_then(Value::as_array)
            .map(|variants| {
                variants
                    .iter()
                    .take(10)
                    .filter_map(Value::as_str)
                    .filter(|v| v.len() < 120 && !v.chars().any(char::is_control))
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();
        ideas.push(KeywordIdea {
            keyword: keyword.into(),
            close_variants,
            google_monthly_searches: count(metrics.and_then(|m| m.get("avgMonthlySearches"))),
            advertiser_competition: competition,
            low_top_page_bid_micros: count(metrics.and_then(|m| m.get("lowTopOfPageBidMicros"))),
            high_top_page_bid_micros: count(metrics.and_then(|m| m.get("highTopOfPageBidMicros"))),
        });
    }
    Ok(ideas)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{Json, Router, http::HeaderMap, routing::post};
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    #[test]
    fn refresh_policy_distinguishes_monthly_success_six_hour_failure_and_daily_budget_skip() {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE discovery_candidates(id TEXT PRIMARY KEY);
            CREATE TABLE google_ads_idea_runs (
              id TEXT PRIMARY KEY, idea_id TEXT NOT NULL,
              query TEXT NOT NULL, state TEXT NOT NULL,
              observed_at INTEGER NOT NULL, error_code TEXT);
            CREATE TABLE google_ads_keyword_observations (
              run_id TEXT NOT NULL, keyword TEXT NOT NULL,
              close_variants_json TEXT NOT NULL,
              monthly_google_searches INTEGER, advertiser_competition TEXT,
              low_top_page_bid_micros INTEGER, high_top_page_bid_micros INTEGER,
              PRIMARY KEY(run_id,keyword));",
        )
        .unwrap();
        let now = 70 * 86_400;
        assert!(needs_refresh(&db, "idea", now).unwrap());
        save_assessment(
            &mut db,
            "idea",
            "bookkeeping automation",
            Err(&AdsError::Permission),
            now,
        )
        .unwrap();
        assert!(!needs_refresh(&db, "idea", now + 6 * 3_600 - 1).unwrap());
        assert!(needs_refresh(&db, "idea", now + 6 * 3_600).unwrap());
        save_assessment(
            &mut db,
            "idea",
            "bookkeeping automation",
            Err(&AdsError::CollectionLimit),
            now + 7 * 3_600,
        )
        .unwrap();
        assert!(!needs_refresh(&db, "idea", now + 30 * 3_600).unwrap());
        assert!(needs_refresh(&db, "idea", now + 7 * 3_600 + 86_400).unwrap());
        save_assessment(
            &mut db,
            "idea",
            "bookkeeping automation",
            Ok(&[]),
            now + 2 * 86_400,
        )
        .unwrap();
        assert!(!needs_refresh(&db, "idea", now + 20 * 86_400).unwrap());
        assert!(needs_refresh(&db, "idea", now + 32 * 86_400).unwrap());
    }

    #[test]
    fn parses_real_google_search_metrics_with_unknowns_and_deduplication() {
        let result = parse_keyword_ideas(br#"{"results":[
            {"text":"bookkeeping automation","closeVariants":["automated bookkeeping"],
              "keywordIdeaMetrics":{"avgMonthlySearches":"1200","competition":"MEDIUM","lowTopOfPageBidMicros":"500000"}},
            {"text":"BOOKKEEPING AUTOMATION","keywordIdeaMetrics":{"avgMonthlySearches":"800"}},
            {"text":"document workflows","keywordIdeaMetrics":{"competition":"UNSPECIFIED"}}
        ]}"#).unwrap();
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].google_monthly_searches, Some(1200));
        assert_eq!(result[0].close_variants, vec!["automated bookkeeping"]);
        assert_eq!(result[0].advertiser_competition.as_deref(), Some("MEDIUM"));
        assert_eq!(result[0].high_top_page_bid_micros, None);
        assert_eq!(result[1].google_monthly_searches, None);
        assert_eq!(result[1].advertiser_competition, None);
    }

    #[test]
    fn invalid_input_and_missing_oauth_do_not_become_zero_volume() {
        assert!(matches!(
            parse_keyword_ideas(b"{}"),
            Err(AdsError::InvalidPayload)
        ));
        assert!(matches!(
            GoogleAdsClient::configured(
                "".into(),
                None,
                "".into(),
                "".into(),
                "".into(),
                "".into(),
                "".into()
            ),
            Err(AdsError::NotConfigured)
        ));
        assert_eq!(AdsError::Permission.code(), "permission");
    }

    #[tokio::test]
    async fn oauth_and_keyword_planning_use_official_request_shapes_without_leaking_credentials() {
        let seen = Arc::new(AtomicUsize::new(0));
        let captured = seen.clone();
        let app = Router::new()
            .route(
                "/token",
                post(|| async { Json(json!({"access_token":"fixture-token"})) }),
            )
            .route(
                "/v26/customers/1234567890:generateKeywordIdeas",
                post(move |headers: HeaderMap, Json(body): Json<Value>| {
                    let captured = captured.clone();
                    async move {
                        captured.fetch_add(1, Ordering::SeqCst);
                        assert_eq!(
                            headers.get("authorization").unwrap(),
                            "Bearer fixture-token"
                        );
                        assert_eq!(body["keywordPlanNetwork"], "GOOGLE_SEARCH");
                        assert_eq!(body["geoTargetConstants"][0], "geoTargetConstants/2840");
                        assert_eq!(body["keywordSeed"]["keywords"][0], "bookkeeping automation");
                        Json(json!({"results":[{"text":"bookkeeping software",
                       "keywordIdeaMetrics":{"avgMonthlySearches":"5400","competition":"HIGH"}}]}))
                    }
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = GoogleAdsClient::configured(
            "1234567890".into(),
            None,
            "fake-client".into(),
            "private-client-secret".into(),
            "private-refresh-token".into(),
            format!("http://{address}/token"),
            format!("http://{address}/v26"),
        )
        .unwrap();
        let ideas = client
            .generate_keyword_ideas(&["bookkeeping automation".into()])
            .await
            .unwrap();
        server.abort();
        assert_eq!(seen.load(Ordering::SeqCst), 1);
        assert_eq!(ideas[0].google_monthly_searches, Some(5400));
    }

    #[tokio::test]
    async fn denied_keyword_planning_returns_sanitized_error() {
        let app = Router::new()
            .route(
                "/token",
                post(|| async { Json(json!({"access_token":"private-access-token"})) }),
            )
            .route(
                "/v26/customers/1234567890:generateKeywordIdeas",
                post(|| async {
                    (
                        axum::http::StatusCode::FORBIDDEN,
                        "provider response includes private-access-token",
                    )
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = GoogleAdsClient::configured(
            "1234567890".into(),
            None,
            "test".into(),
            "private-client-secret".into(),
            "private-refresh-token".into(),
            format!("http://{address}/token"),
            format!("http://{address}/v26"),
        )
        .unwrap();
        let error = client
            .generate_keyword_ideas(&["bookkeeping automation".into()])
            .await
            .unwrap_err();
        server.abort();
        assert_eq!(error.code(), "permission");
        assert!(!format!("{error:?}").contains("private"));
    }
}
