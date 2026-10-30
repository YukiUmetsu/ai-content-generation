//! Write-only local provider credential management. Access requires a strict
//! loopback Host/Origin pair and a single-use, unguessable session token.

use std::net::SocketAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::extract::{DefaultBodyLimit, Path, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::credentials::{ConnectionStatus, CredentialError, ProviderId};
use crate::error::ApiError;
use crate::state::AppState;

const SESSION_TTL: Duration = Duration::from_secs(300);
const MAX_SESSIONS: usize = 32;

#[derive(Debug, Default)]
pub struct SettingsSessions {
    active: Mutex<Vec<(String, Instant)>>,
}

impl SettingsSessions {
    fn issue(&self) -> Result<String, ApiError> {
        let mut entropy = [0_u8; 32];
        getrandom::getrandom(&mut entropy).map_err(|_| ApiError::Unavailable {
            message: "Secure local session could not be started".into(),
        })?;
        let token: String = entropy.iter().map(|byte| format!("{byte:02x}")).collect();
        let mut active = self.active.lock().map_err(|_| ApiError::Internal {
            message: "Local settings session failed".into(),
        })?;
        active.retain(|(_, expires)| *expires > Instant::now());
        if active.len() >= MAX_SESSIONS {
            active.remove(0);
        }
        active.push((token.clone(), Instant::now() + SESSION_TTL));
        Ok(token)
    }

    fn consume(&self, token: &str) -> bool {
        let Ok(mut active) = self.active.lock() else {
            return false;
        };
        active.retain(|(_, expires)| *expires > Instant::now());
        if let Some(index) = active.iter().position(|(candidate, _)| candidate == token) {
            active.swap_remove(index);
            return true;
        }
        false
    }
}

fn forbidden() -> ApiError {
    ApiError::Forbidden {
        message: "Local provider settings authorization failed".into(),
    }
}

/// Only fixed diagnostic identifiers are logged. Never interpolate a request
/// header, session token, credential, or operating-system error message here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AuthRejectionReason {
    HostMissing,
    HostUntrusted,
    OriginMismatch,
    OriginMissing,
    TokenMissing,
    TokenInvalidOrExpired,
}

impl AuthRejectionReason {
    fn code(self) -> &'static str {
        match self {
            Self::HostMissing => "host_missing_or_malformed",
            Self::HostUntrusted => "host_untrusted",
            Self::OriginMismatch => "origin_mismatch",
            Self::OriginMissing => "origin_missing_or_malformed",
            Self::TokenMissing => "session_token_missing_or_malformed",
            Self::TokenInvalidOrExpired => "session_token_invalid_expired_or_replayed",
        }
    }
}

fn reject(operation: &'static str, reason: AuthRejectionReason) -> ApiError {
    eprintln!(
        "WARN contentgen.settings.auth operation={operation} reason={}",
        reason.code()
    );
    forbidden()
}

/// Reject DNS-rebinding hosts, including anything that merely ends in localhost.
/// Vite forwards the browser Host unchanged, so it must match the trusted Origin.
fn validate_host_origin(headers: &HeaderMap) -> Result<String, AuthRejectionReason> {
    let host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .ok_or(AuthRejectionReason::HostMissing)?;
    let configured = std::env::var("CONTENTGEN_STUDIO_ORIGIN")
        .ok()
        .filter(|value| {
            value.strip_prefix("http://").is_some_and(|host| {
                host.parse::<SocketAddr>()
                    .is_ok_and(|addr| addr.ip().is_loopback())
            })
        });
    let origin = format!("http://{host}");
    let trusted = matches!(
        host,
        "127.0.0.1:8787" | "127.0.0.1:5173" | "localhost:8787" | "localhost:5173"
    ) || configured.as_deref() == Some(origin.as_str());
    if !trusted {
        return Err(AuthRejectionReason::HostUntrusted);
    }
    if let Some(header_origin) = headers.get(header::ORIGIN)
        && header_origin.to_str().ok() != Some(origin.as_str())
    {
        return Err(AuthRejectionReason::OriginMismatch);
    }
    Ok(origin)
}

fn trusted_origin(headers: &HeaderMap, operation: &'static str) -> Result<String, ApiError> {
    validate_host_origin(headers).map_err(|reason| reject(operation, reason))
}

/// Reuse the same DNS-rebinding Host/Origin boundary for read/write local APIs.
/// Non-browser loopback workers legitimately omit Origin, so callers retain
/// their independent mutation header checks while every Host is validated.
pub(crate) fn require_local_host(
    headers: &HeaderMap,
    operation: &'static str,
) -> Result<(), ApiError> {
    trusted_origin(headers, operation).map(|_| ())
}

fn validate_mutation_origin(headers: &HeaderMap, origin: &str) -> Result<(), AuthRejectionReason> {
    if headers.get(header::ORIGIN).is_none() {
        return Err(AuthRejectionReason::OriginMissing);
    }
    if headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        != Some(origin)
    {
        return Err(AuthRejectionReason::OriginMismatch);
    }
    Ok(())
}

fn validate_session(
    headers: &HeaderMap,
    sessions: &SettingsSessions,
) -> Result<(), AuthRejectionReason> {
    let token = headers
        .get("x-contentgen-settings")
        .and_then(|value| value.to_str().ok())
        .ok_or(AuthRejectionReason::TokenMissing)?;
    if !sessions.consume(token) {
        return Err(AuthRejectionReason::TokenInvalidOrExpired);
    }
    Ok(())
}

fn require_mutation(
    headers: &HeaderMap,
    state: &AppState,
    operation: &'static str,
) -> Result<(), ApiError> {
    let origin = trusted_origin(headers, operation)?;
    validate_mutation_origin(headers, &origin).map_err(|reason| reject(operation, reason))?;
    validate_session(headers, state.settings_sessions()).map_err(|reason| reject(operation, reason))
}

fn keychain_reason(error: CredentialError) -> &'static str {
    match error {
        CredentialError::Denied => "access_denied",
        CredentialError::Unavailable => "unavailable",
        _ => "operation_failed",
    }
}

fn credential_error(error: CredentialError, operation: &'static str) -> ApiError {
    eprintln!(
        "ERROR contentgen.settings.keychain operation={operation} reason={}",
        keychain_reason(error)
    );
    match error {
        CredentialError::Denied => ApiError::Forbidden {
            message: "Keychain access was denied by the operating system".into(),
        },
        CredentialError::Unavailable => ApiError::Unavailable {
            message: "OS secure credential storage is unavailable".into(),
        },
        _ => ApiError::Unavailable {
            message: "Keychain operation failed".into(),
        },
    }
}

async fn no_store(request: axum::extract::Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/providers", get(providers))
        .route("/session", get(session))
        .route(
            "/providers/{provider}/key",
            axum::routing::put(save_key).delete(delete_key),
        )
        .layer(DefaultBodyLimit::max(1024))
        .layer(middleware::from_fn(no_store))
}

#[derive(Serialize)]
struct ProviderStatuses {
    providers: [ConnectionStatus; 2],
}

async fn providers(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ProviderStatuses>, ApiError> {
    trusted_origin(&headers, "provider_status")?;
    Ok(Json(ProviderStatuses {
        providers: [
            state.credentials().status(ProviderId::Youtube),
            state.credentials().status(ProviderId::Fish),
        ],
    }))
}

#[derive(Serialize)]
struct SessionToken {
    token: String,
}

async fn session(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<SessionToken>, ApiError> {
    trusted_origin(&headers, "issue_session")?;
    Ok(Json(SessionToken {
        token: state.settings_sessions().issue()?,
    }))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SaveKey {
    key: String,
}

async fn save_key(
    State(state): State<AppState>,
    Path(provider): Path<String>,
    headers: HeaderMap,
    Json(value): Json<SaveKey>,
) -> Result<Json<ConnectionStatus>, ApiError> {
    require_mutation(&headers, &state, "save_provider_key")?;
    let provider = ProviderId::from_slug(&provider).ok_or_else(forbidden)?;
    let key = &value.key;
    if key.len() < 8 || key.len() > 512 || key.trim() != key || key.chars().any(char::is_control) {
        return Err(ApiError::InvalidDocument {
            message: "Invalid provider API key format".into(),
        });
    }
    state
        .credentials()
        .put_key(provider, key)
        .map_err(|error| credential_error(error, "save_provider_key"))?;
    Ok(Json(state.credentials().status(provider)))
}

async fn delete_key(
    State(state): State<AppState>,
    Path(provider): Path<String>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    require_mutation(&headers, &state, "delete_provider_key")?;
    let provider = ProviderId::from_slug(&provider).ok_or_else(forbidden)?;
    state
        .credentials()
        .delete_key(provider)
        .map_err(|error| credential_error(error, "delete_provider_key"))?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers(host: Option<&str>, origin: Option<&str>, token: Option<&str>) -> HeaderMap {
        let mut headers = HeaderMap::new();
        if let Some(host) = host {
            headers.insert(header::HOST, host.parse().unwrap());
        }
        if let Some(origin) = origin {
            headers.insert(header::ORIGIN, origin.parse().unwrap());
        }
        if let Some(token) = token {
            headers.insert("x-contentgen-settings", token.parse().unwrap());
        }
        headers
    }

    #[test]
    fn host_and_origin_guards_explain_distinct_denials() {
        let missing = headers(None, None, None);
        assert_eq!(
            validate_host_origin(&missing),
            Err(AuthRejectionReason::HostMissing)
        );

        let hostile = headers(Some("127.0.0.1:5173.attacker.example"), None, None);
        assert_eq!(
            validate_host_origin(&hostile),
            Err(AuthRejectionReason::HostUntrusted)
        );

        let mismatch = headers(Some("127.0.0.1:5173"), Some("https://evil.example"), None);
        assert_eq!(
            validate_host_origin(&mismatch),
            Err(AuthRejectionReason::OriginMismatch)
        );

        let missing_origin = headers(Some("127.0.0.1:5173"), None, None);
        let accepted = validate_host_origin(&missing_origin).unwrap();
        assert_eq!(
            validate_mutation_origin(&missing_origin, &accepted),
            Err(AuthRejectionReason::OriginMissing)
        );
    }

    #[test]
    fn one_time_session_rejections_are_distinguishable_without_exposing_tokens() {
        let sessions = SettingsSessions::default();
        assert_eq!(
            validate_session(&headers(None, None, None), &sessions),
            Err(AuthRejectionReason::TokenMissing)
        );

        let token = sessions.issue().unwrap();
        assert_eq!(
            validate_session(&headers(None, None, Some("wrong-token")), &sessions),
            Err(AuthRejectionReason::TokenInvalidOrExpired)
        );
        assert!(validate_session(&headers(None, None, Some(&token)), &sessions).is_ok());
        assert_eq!(
            validate_session(&headers(None, None, Some(&token)), &sessions),
            Err(AuthRejectionReason::TokenInvalidOrExpired)
        );

        for reason in [
            AuthRejectionReason::HostMissing,
            AuthRejectionReason::HostUntrusted,
            AuthRejectionReason::OriginMismatch,
            AuthRejectionReason::OriginMissing,
            AuthRejectionReason::TokenMissing,
            AuthRejectionReason::TokenInvalidOrExpired,
        ] {
            let diagnostic = format!("reason={}", reason.code());
            assert!(!diagnostic.contains(&token));
            assert!(!diagnostic.contains("wrong-token"));
        }
    }

    #[test]
    fn keychain_error_labels_are_static_and_exclude_os_error_details() {
        assert_eq!(keychain_reason(CredentialError::Denied), "access_denied");
        assert_eq!(keychain_reason(CredentialError::Unavailable), "unavailable");
        assert_eq!(keychain_reason(CredentialError::Other), "operation_failed");
        assert_eq!(
            keychain_reason(CredentialError::Missing),
            "operation_failed"
        );
    }
}
