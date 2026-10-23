//! Write-only local provider credential management. Access requires a strict
//! loopback Host/Origin pair and a single-use, unguessable session token.

use std::net::SocketAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::extract::{DefaultBodyLimit, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::credentials::{ConnectionStatus, CredentialError};
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

/// Reject DNS-rebinding hosts, including anything that merely ends in localhost.
/// Vite forwards the browser Host unchanged, so it must match the trusted Origin.
fn trusted_origin(headers: &HeaderMap) -> Result<String, ApiError> {
    let host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(forbidden)?;
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
        return Err(forbidden());
    }
    if let Some(header_origin) = headers.get(header::ORIGIN)
        && header_origin.to_str().ok() != Some(origin.as_str())
    {
        return Err(forbidden());
    }
    Ok(origin)
}

fn require_mutation(headers: &HeaderMap, state: &AppState) -> Result<(), ApiError> {
    let origin = trusted_origin(headers)?;
    if headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        != Some(origin.as_str())
    {
        return Err(forbidden());
    }
    let token = headers
        .get("x-contentgen-settings")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(forbidden)?;
    if !state.settings_sessions().consume(token) {
        return Err(forbidden());
    }
    Ok(())
}

fn credential_error(error: CredentialError) -> ApiError {
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
            "/providers/youtube/key",
            axum::routing::put(save_key).delete(delete_key),
        )
        .layer(DefaultBodyLimit::max(1024))
        .layer(middleware::from_fn(no_store))
}

#[derive(Serialize)]
struct ProviderStatuses {
    providers: [ConnectionStatus; 1],
}

async fn providers(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ProviderStatuses>, ApiError> {
    trusted_origin(&headers)?;
    Ok(Json(ProviderStatuses {
        providers: [state.credentials().youtube_status()],
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
    trusted_origin(&headers)?;
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
    headers: HeaderMap,
    Json(value): Json<SaveKey>,
) -> Result<Json<ConnectionStatus>, ApiError> {
    require_mutation(&headers, &state)?;
    let key = &value.key;
    if key.len() < 8 || key.len() > 512 || key.trim() != key || key.chars().any(char::is_control) {
        return Err(ApiError::InvalidDocument {
            message: "Invalid YouTube API key format".into(),
        });
    }
    state
        .credentials()
        .put_youtube_key(key)
        .map_err(credential_error)?;
    Ok(Json(state.credentials().youtube_status()))
}

async fn delete_key(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    require_mutation(&headers, &state)?;
    state
        .credentials()
        .delete_youtube_key()
        .map_err(credential_error)?;
    Ok(StatusCode::NO_CONTENT)
}
