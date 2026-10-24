//! Deliberately small, source-aware YouTube Data API v3 client.
//! No arbitrary hosts exposed to the UI and no raw provider/key errors.

use std::collections::HashMap;
use std::time::Duration;

use serde_json::Value;

use super::market_store::VideoObservation;

const PRODUCTION_BASE: &str = "https://www.googleapis.com/youtube/v3";

#[derive(Debug, Clone, Copy, thiserror::Error)]
pub enum YoutubeError {
    #[error("YouTube API key is missing")]
    MissingKey,
    #[error("YouTube API refused the request")]
    Permission,
    #[error("YouTube Data API is not enabled for the Google Cloud project")]
    ApiNotEnabled,
    #[error("YouTube API key is invalid or expired")]
    InvalidKey,
    #[error("YouTube API key restrictions refused the server request")]
    KeyRestricted,
    #[error("YouTube API rejected the search parameters")]
    InvalidRequest,
    #[error("YouTube API search quota is exhausted")]
    Quota,
    #[error("YouTube API rate limit reached")]
    RateLimited,
    #[error("YouTube API is temporarily unavailable")]
    Unavailable,
    #[error("YouTube API returned invalid data")]
    InvalidPayload,
}

impl YoutubeError {
    pub fn code(self) -> &'static str {
        match self {
            Self::MissingKey => "api_key_missing",
            Self::Permission => "permission",
            Self::ApiNotEnabled => "api_not_enabled",
            Self::InvalidKey => "api_key_invalid",
            Self::KeyRestricted => "api_key_restricted",
            Self::InvalidRequest => "invalid_request",
            Self::Quota => "quota_exceeded",
            Self::RateLimited => "rate_limited",
            Self::Unavailable => "provider_unavailable",
            Self::InvalidPayload => "payload_invalid",
        }
    }
}

/// Diagnostics are composed exclusively from fixed, reviewed strings.
/// Never include the request URL, query, headers, credential, or Google response.
fn safe_failure_log(
    endpoint: &str,
    status: Option<reqwest::StatusCode>,
    error: YoutubeError,
) -> String {
    let stage = match endpoint {
        "search" => "search",
        "videos" => "videos",
        "channels" => "channels",
        _ => "unknown",
    };
    let http_status = status.map(|s| s.as_u16().to_string()).unwrap_or_else(|| "network".into());
    let advice = match error {
        YoutubeError::MissingKey => "configure_youtube_key",
        YoutubeError::Permission => "check_google_cloud_api_and_key_permissions",
        YoutubeError::ApiNotEnabled => "enable_youtube_data_api_v3",
        YoutubeError::InvalidKey => "replace_youtube_api_key",
        YoutubeError::KeyRestricted => "check_key_application_restrictions",
        YoutubeError::InvalidRequest => "check_request_parameters",
        YoutubeError::Quota => "check_google_cloud_youtube_quota",
        YoutubeError::RateLimited => "wait_for_provider_backoff",
        YoutubeError::Unavailable => "retry_provider_connection",
        YoutubeError::InvalidPayload => "check_provider_response_contract",
    };
    format!(
        "contentgen-server: youtube_api_failure endpoint={stage} http_status={http_status} reason={} action={advice}",
        error.code()
    )
}

fn log_failure(
    endpoint: &str,
    status: Option<reqwest::StatusCode>,
    error: YoutubeError,
) -> YoutubeError {
    eprintln!("{}", safe_failure_log(endpoint, status, error));
    error
}

#[derive(Clone)]
pub struct YoutubeClient {
    base: String,
    key: String,
    http: reqwest::Client,
}

impl YoutubeClient {
    pub fn from_env() -> Result<Self, YoutubeError> {
        let key = std::env::var("CONTENTGEN_YOUTUBE_API_KEY").unwrap_or_default();
        Self::from_key(key)
    }

    pub fn from_key(key: String) -> Result<Self, YoutubeError> {
        if key.trim().is_empty() {
            return Err(YoutubeError::MissingKey);
        }
        Ok(Self::new(PRODUCTION_BASE.into(), key))
    }

    fn new(base: String, key: String) -> Self {
        Self {
            base,
            key,
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(15))
                .build()
                .expect("HTTP client initialization"),
        }
    }

    #[cfg(test)]
    fn for_testing(base: String, key: &str) -> Self {
        Self::new(base, key.into())
    }

    async fn request(
        &self,
        endpoint: &str,
        params: &[(&str, String)],
    ) -> Result<Value, YoutubeError> {
        let response = self
            .http
            .get(format!("{}/{endpoint}", self.base))
            .header("x-goog-api-key", &self.key)
            .query(params)
            .send()
            .await
            .map_err(|_| log_failure(endpoint, None, YoutubeError::Unavailable))?;
        let status = response.status();
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err(log_failure(endpoint, Some(status), YoutubeError::RateLimited));
        }
        if matches!(
            status,
            reqwest::StatusCode::FORBIDDEN
                | reqwest::StatusCode::UNAUTHORIZED
                | reqwest::StatusCode::BAD_REQUEST
        ) {
            // Only classify known Google error codes locally. Never log or
            // persist the provider's raw message, URL or credential.
            let bytes = response.bytes().await
                .map_err(|_| log_failure(endpoint, Some(status), YoutubeError::Permission))?;
            return Err(log_failure(endpoint, Some(status), classify_youtube_error(status, &bytes)));
        }
        if !status.is_success() {
            return Err(log_failure(endpoint, Some(status), YoutubeError::Unavailable));
        }
        if response
            .content_length()
            .is_some_and(|size| size > 1_000_000)
        {
            return Err(log_failure(endpoint, Some(status), YoutubeError::InvalidPayload));
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|_| log_failure(endpoint, Some(status), YoutubeError::Unavailable))?;
        if bytes.len() > 1_000_000 {
            return Err(log_failure(endpoint, Some(status), YoutubeError::InvalidPayload));
        }
        serde_json::from_slice(&bytes)
            .map_err(|_| log_failure(endpoint, Some(status), YoutubeError::InvalidPayload))
    }

    pub async fn collect(
        &self,
        query: &str,
        region: &str,
        language: &str,
    ) -> Result<Vec<VideoObservation>, YoutubeError> {
        let search = self
            .request(
                "search",
                &[
                    ("part", "snippet".into()),
                    ("type", "video".into()),
                    ("q", query.into()),
                    ("maxResults", "25".into()),
                    ("order", "relevance".into()),
                    ("regionCode", region.into()),
                    ("relevanceLanguage", language.into()),
                ],
            )
            .await?;
        let items = search
            .get("items")
            .and_then(Value::as_array)
            .ok_or(YoutubeError::InvalidPayload)?;
        let mut video_ids: Vec<String> = Vec::new();
        for item in items {
            if let Some(id) = item.pointer("/id/videoId").and_then(Value::as_str)
                && valid_video_id(id)
                && !video_ids.iter().any(|x| x == id)
            {
                video_ids.push(id.into());
            }
        }
        if video_ids.is_empty() {
            return Ok(Vec::new());
        }
        let videos = self
            .request(
                "videos",
                &[
                    ("part", "snippet,statistics,contentDetails".into()),
                    ("id", video_ids.join(",")),
                    ("maxResults", "50".into()),
                ],
            )
            .await?;
        let items = videos
            .get("items")
            .and_then(Value::as_array)
            .ok_or(YoutubeError::InvalidPayload)?;
        let mut details: HashMap<String, VideoObservation> = HashMap::new();
        let mut channel_ids: Vec<String> = Vec::new();
        for item in items {
            let Some(video_id) = item.get("id").and_then(Value::as_str) else {
                continue;
            };
            if !valid_video_id(video_id) {
                continue;
            }
            let Some(title) = item.pointer("/snippet/title").and_then(Value::as_str) else {
                continue;
            };
            let Some(channel_id) = item.pointer("/snippet/channelId").and_then(Value::as_str)
            else {
                continue;
            };
            let Some(channel_title) = item
                .pointer("/snippet/channelTitle")
                .and_then(Value::as_str)
            else {
                continue;
            };
            let Some(published_at) = item.pointer("/snippet/publishedAt").and_then(Value::as_str)
            else {
                continue;
            };
            if !channel_ids.iter().any(|x| x == channel_id) {
                channel_ids.push(channel_id.into());
            }
            details.insert(
                video_id.into(),
                VideoObservation {
                    video_id: video_id.into(),
                    title: title.chars().take(400).collect(),
                    channel_id: channel_id.into(),
                    channel_title: channel_title.into(),
                    published_at: published_at.into(),
                    duration_seconds: item
                        .pointer("/contentDetails/duration")
                        .and_then(Value::as_str)
                        .and_then(duration_seconds),
                    view_count: count_at(item, "/statistics/viewCount"),
                    like_count: count_at(item, "/statistics/likeCount"),
                    comment_count: count_at(item, "/statistics/commentCount"),
                    subscriber_count: None,
                },
            );
        }
        if !channel_ids.is_empty() {
            let channels = self
                .request(
                    "channels",
                    &[
                        ("part", "statistics".into()),
                        ("id", channel_ids.join(",")),
                        ("maxResults", "50".into()),
                    ],
                )
                .await?;
            let channels = channels
                .get("items")
                .and_then(Value::as_array)
                .ok_or(YoutubeError::InvalidPayload)?;
            let subs: HashMap<&str, Option<i64>> = channels
                .iter()
                .filter_map(|channel| {
                    Some((
                        channel.get("id")?.as_str()?,
                        count_at(channel, "/statistics/subscriberCount"),
                    ))
                })
                .collect();
            for item in details.values_mut() {
                item.subscriber_count = subs.get(item.channel_id.as_str()).copied().flatten();
            }
        }
        Ok(video_ids
            .into_iter()
            .filter_map(|id| details.remove(&id))
            .collect())
    }
}

/// Google returns both legacy errors[].reason and google.rpc.ErrorInfo
/// details[].reason. Only selected, sanitized reason families become stored
/// error codes: provider messages are never copied into the UI or logs.
fn classify_youtube_error(status: reqwest::StatusCode, body: &[u8]) -> YoutubeError {
    if body.len() > 32_768 {
        return YoutubeError::Permission;
    }
    let Ok(json) = serde_json::from_slice::<Value>(body) else {
        return YoutubeError::Permission;
    };
    let Some(error) = json.get("error") else {
        return YoutubeError::Permission;
    };
    let mut reasons: Vec<String> = Vec::new();
    if let Some(items) = error.get("errors").and_then(Value::as_array) {
        for item in items.iter().take(10) {
            if let Some(reason) = item.get("reason").and_then(Value::as_str) {
                reasons.push(reason.to_ascii_lowercase());
            }
        }
    }
    if let Some(details) = error.get("details").and_then(Value::as_array) {
        for detail in details.iter().take(10) {
            if let Some(reason) = detail.get("reason").and_then(Value::as_str) {
                reasons.push(reason.to_ascii_lowercase());
            }
        }
    }
    if let Some(reason) = error.get("status").and_then(Value::as_str) {
        reasons.push(reason.to_ascii_lowercase());
    }
    // Google can return only a human-readable message for some restrictions.
    // Match only known short patterns, never expose the message itself.
    let message = error.get("message").and_then(Value::as_str)
        .unwrap_or("").to_ascii_lowercase();
    if reasons.iter().any(|r| matches!(r.as_str(),
        "quotaexceeded" | "dailylimitexceeded" | "dailylimitexceededunreg"
        | "quota_exceeded" | "resource_exhausted"
    )) {
        return YoutubeError::Quota;
    }
    if reasons.iter().any(|r| matches!(r.as_str(),
        "ratelimitexceeded" | "userratelimitexceeded" | "rate_limit_exceeded"
    )) {
        return YoutubeError::RateLimited;
    }
    if reasons.iter().any(|r| matches!(r.as_str(),
        "accessnotconfigured" | "service_disabled" | "api_not_enabled"
    )) || (message.contains("youtube data api") && message.contains("disabled"))
        || message.contains("has not been used in project") {
        return YoutubeError::ApiNotEnabled;
    }
    if reasons.iter().any(|r| matches!(r.as_str(),
        "keyinvalid" | "api_key_invalid" | "api_key_expired"
    )) || message.contains("api key not valid")
        || message.contains("api key is invalid") {
        return YoutubeError::InvalidKey;
    }
    if reasons.iter().any(|r|
        r.starts_with("api_key_") && (r.ends_with("_blocked") || r == "api_key_service_blocked")
        || matches!(r.as_str(), "iprefererblocked" | "referernotallowed")
    ) || (message.contains("referer") && message.contains("blocked"))
        || (message.contains("api key") && message.contains("not authorized"))
    {
        return YoutubeError::KeyRestricted;
    }
    if status == reqwest::StatusCode::BAD_REQUEST {
        return YoutubeError::InvalidRequest;
    }
    YoutubeError::Permission
}

fn count_at(item: &Value, path: &str) -> Option<i64> {
    item.pointer(path)
        .and_then(Value::as_str)?
        .parse::<i64>()
        .ok()
        .filter(|x| *x >= 0)
}

fn valid_video_id(id: &str) -> bool {
    id.len() == 11
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

/// Video duration is an ISO-8601 day/time span (no months/years).
fn duration_seconds(value: &str) -> Option<i64> {
    let mut remaining = value.strip_prefix('P')?;
    let mut seconds = 0_i64;
    let mut in_time = false;
    let mut number = String::new();
    while let Some(character) = remaining.chars().next() {
        remaining = &remaining[character.len_utf8()..];
        if character == 'T' && number.is_empty() && !in_time {
            in_time = true;
            continue;
        }
        if character.is_ascii_digit() {
            number.push(character);
            continue;
        }
        let n = number.parse::<i64>().ok()?;
        number.clear();
        let scale = match (character, in_time) {
            ('D', false) => 86_400,
            ('H', true) => 3_600,
            ('M', true) => 60,
            ('S', true) => 1,
            _ => return None,
        };
        seconds = seconds.checked_add(n.checked_mul(scale)?)?;
    }
    if !number.is_empty() {
        return None;
    }
    Some(seconds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::Json;
    use axum::Router;
    use axum::http::{HeaderMap, Uri};
    use axum::routing::get;
    use serde_json::json;

    #[test]
    fn parses_iso_8601_video_durations_without_guessing() {
        assert_eq!(duration_seconds("PT6M12S"), Some(372));
        assert_eq!(duration_seconds("PT1H5M"), Some(3900));
        assert_eq!(duration_seconds("PT0S"), Some(0));
        assert_eq!(duration_seconds("nonsense"), None);
    }

    #[tokio::test]
    async fn collects_public_video_details_and_keeps_missing_counts_unknown() {
        let app = Router::new()
            .route("/youtube/v3/search", get(|headers: HeaderMap, uri: Uri| async move {
                assert_eq!(headers.get("x-goog-api-key").unwrap(), "synthetic-key");
                assert!(!uri.query().unwrap_or("").contains("synthetic-key"));
                assert!(uri.query().unwrap_or("").contains("order=relevance"));
                Json(json!({"items":[
                    {"id":{"videoId":"abcABC12345"}},
                    {"id":{"videoId":"defDEF67890"}}
                ]}))
            }))
            .route("/youtube/v3/videos", get(|| async {
                Json(json!({"items":[
                    {"id":"abcABC12345",
                     "snippet":{"title":"Heating costs explained","channelId":"UCheat","channelTitle":"Demo",
                                "publishedAt":"2026-01-01T00:00:00Z"},
                     "contentDetails":{"duration":"PT6M12S"},
                     "statistics":{"viewCount":"5012","likeCount":"31"}},
                    {"id":"defDEF67890",
                     "snippet":{"title":"Second video","channelId":"UCnext","channelTitle":"Next",
                                "publishedAt":"2026-01-02T00:00:00Z"},
                     "contentDetails":{"duration":"PT1M"},
                     "statistics":{"viewCount":"102"}}
                ]}))
            }))
            .route("/youtube/v3/channels", get(|| async {
                Json(json!({"items":[
                    {"id":"UCheat","statistics":{"subscriberCount":"20000"}}
                ]}))
            }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let client =
            YoutubeClient::for_testing(format!("http://{addr}/youtube/v3"), "synthetic-key");
        let records = client.collect("heat pump", "US", "en").await.unwrap();
        server.abort();
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].duration_seconds, Some(372));
        assert_eq!(records[0].subscriber_count, Some(20000));
        assert_eq!(records[1].like_count, None);
        assert_eq!(records[1].subscriber_count, None);
    }

    #[test]
    fn classifies_known_google_errors_without_exposing_provider_messages_or_keys() {
        use reqwest::StatusCode;
        let examples = [
            (StatusCode::FORBIDDEN, json!({"error":{"errors":[{"reason":"accessNotConfigured"}],"message":"secret token sample"}}), "api_not_enabled"),
            (StatusCode::FORBIDDEN, json!({"error":{"details":[{"reason":"SERVICE_DISABLED"}]}}), "api_not_enabled"),
            (StatusCode::BAD_REQUEST, json!({"error":{"details":[{"reason":"API_KEY_INVALID"}]}}), "api_key_invalid"),
            (StatusCode::FORBIDDEN, json!({"error":{"details":[{"reason":"API_KEY_HTTP_REFERRER_BLOCKED"}]}}), "api_key_restricted"),
            (StatusCode::FORBIDDEN, json!({"error":{"message":"Requests from referer <empty> are blocked."}}), "api_key_restricted"),
            (StatusCode::FORBIDDEN, json!({"error":{"errors":[{"reason":"quotaExceeded"}]}}), "quota_exceeded"),
            (StatusCode::FORBIDDEN, json!({"error":{"errors":[{"reason":"userRateLimitExceeded"}]}}), "rate_limited"),
            (StatusCode::BAD_REQUEST, json!({"error":{"errors":[{"reason":"unexpectedParameter"}]}}), "invalid_request"),
            (StatusCode::FORBIDDEN, json!({"error":{"errors":[{"reason":"forbidden"}],"message":"private provider details"}}), "permission"),
        ];
        for (status, payload, expected) in examples {
            let err = classify_youtube_error(status, payload.to_string().as_bytes());
            assert_eq!(err.code(), expected);
            assert!(!format!("{err:?}").contains("secret"));
            assert!(!format!("{err:?}").contains("private provider"));
        }
    }

    #[test]
    fn safe_diagnostics_include_action_and_stage_but_never_untrusted_values() {
        use reqwest::StatusCode;
        let redacted = safe_failure_log(
            "search?key=AIza_private-secret&q=my-private-research",
            Some(StatusCode::FORBIDDEN),
            YoutubeError::KeyRestricted,
        );
        assert_eq!(
            redacted,
            "contentgen-server: youtube_api_failure endpoint=unknown http_status=403 reason=api_key_restricted action=check_key_application_restrictions"
        );
        assert!(!redacted.contains("AIza"));
        assert!(!redacted.contains("my-private-research"));
        for (stage, error, expected) in [
            ("search", YoutubeError::ApiNotEnabled, "enable_youtube_data_api_v3"),
            ("videos", YoutubeError::InvalidKey, "replace_youtube_api_key"),
            ("channels", YoutubeError::Quota, "check_google_cloud_youtube_quota"),
        ] {
            let line = safe_failure_log(stage, Some(StatusCode::FORBIDDEN), error);
            assert!(line.contains(&format!("endpoint={stage}")));
            assert!(line.contains(&format!("reason={}", error.code())));
            assert!(line.contains(&format!("action={expected}")));
        }
        let network = safe_failure_log("search", None, YoutubeError::Unavailable);
        assert!(network.contains("http_status=network"));
        assert!(!network.contains("https://"));
    }

    #[tokio::test]
    async fn quota_and_invalid_provider_payload_are_safe_errors() {
        let quota = Router::new().route(
            "/search",
            get(|| async { (axum::http::StatusCode::TOO_MANY_REQUESTS, "rate limit") }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, quota).await.unwrap();
        });
        let err = YoutubeClient::for_testing(format!("http://{addr}"), "do-not-log-key")
            .collect("x", "US", "en")
            .await
            .unwrap_err();
        server.abort();
        assert_eq!(err.code(), "rate_limited");
        assert!(!format!("{err:?}").contains("do-not-log-key"));
    }
}
