use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use contentgen_server::credentials::{
    CredentialError, CredentialStore, ProviderCredentials, ProviderId,
};
use contentgen_server::{AppState, build_router};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

#[derive(Default)]
struct KeychainFixture(Mutex<HashMap<ProviderId, String>>);
impl CredentialStore for KeychainFixture {
    fn read(&self, provider: ProviderId) -> Result<Option<String>, CredentialError> {
        Ok(self.0.lock().unwrap().get(&provider).cloned())
    }
    fn put(&self, provider: ProviderId, key: &str) -> Result<(), CredentialError> {
        self.0.lock().unwrap().insert(provider, key.into());
        Ok(())
    }
    fn delete(&self, provider: ProviderId) -> Result<(), CredentialError> {
        self.0.lock().unwrap().remove(&provider);
        Ok(())
    }
}

fn setup() -> (axum::Router, Arc<KeychainFixture>) {
    let store = Arc::new(KeychainFixture::default());
    let state =
        AppState::with_credentials(":memory:", ProviderCredentials::new(store.clone(), None));
    (build_router(state), store)
}

async fn request(
    router: &axum::Router,
    method: Method,
    path: &str,
    payload: Option<Value>,
    origin: Option<&str>,
    token: Option<&str>,
) -> (StatusCode, Value, bool) {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header("host", "127.0.0.1:5173");
    if payload.is_some() {
        builder = builder.header("content-type", "application/json");
    }
    if let Some(origin) = origin {
        builder = builder.header("origin", origin);
    }
    if let Some(token) = token {
        builder = builder.header("x-contentgen-settings", token);
    }
    let body = payload.map_or_else(String::new, |value| value.to_string());
    let response = router
        .clone()
        .oneshot(builder.body(Body::from(body)).unwrap())
        .await
        .unwrap();
    let no_store = response
        .headers()
        .get("cache-control")
        .and_then(|x| x.to_str().ok())
        == Some("no-store");
    let code = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into_owned()))
    };
    (code, body, no_store)
}

async fn session(router: &axum::Router) -> String {
    let (code, result, no_store) = request(
        router,
        Method::GET,
        "/api/settings/session",
        None,
        None,
        None,
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{result:?}");
    assert!(no_store);
    result["token"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn fish_credentials_are_write_only_and_replay_protected() {
    let (router, store) = setup();
    let fish_key = "fish-secret-do-not-return";
    for (provider, key) in [("fish", fish_key)] {
        let token = session(&router).await;
        let (code, saved, no_store) = request(
            &router,
            Method::PUT,
            &format!("/api/settings/providers/{provider}/key"),
            Some(json!({"key":key})),
            Some("http://127.0.0.1:5173"),
            Some(&token),
        )
        .await;
        assert_eq!(code, StatusCode::OK, "{saved:?}");
        assert!(no_store);
        assert_eq!(saved["id"], provider);
        assert_eq!(saved["source"], "keychain");
        assert!(!saved.to_string().contains(key));
        let (replayed, _, _) = request(
            &router,
            Method::DELETE,
            &format!("/api/settings/providers/{provider}/key"),
            None,
            Some("http://127.0.0.1:5173"),
            Some(&token),
        )
        .await;
        assert_eq!(replayed, StatusCode::FORBIDDEN);
    }
    let (_, statuses, _) = request(
        &router,
        Method::GET,
        "/api/settings/providers",
        None,
        None,
        None,
    )
    .await;
    assert_eq!(statuses["providers"].as_array().unwrap().len(), 2);
    assert_eq!(statuses["providers"][0]["source"], "missing");
    assert_eq!(statuses["providers"][1]["source"], "keychain");
    assert!(!statuses.to_string().contains(fish_key));
    assert_eq!(
        store.0.lock().unwrap().get(&ProviderId::Fish).unwrap(),
        fish_key
    );
    let token = session(&router).await;
    let (deleted, _, _) = request(
        &router,
        Method::DELETE,
        "/api/settings/providers/fish/key",
        None,
        Some("http://127.0.0.1:5173"),
        Some(&token),
    )
    .await;
    assert_eq!(deleted, StatusCode::NO_CONTENT);
    assert!(!store.0.lock().unwrap().contains_key(&ProviderId::Fish));
    let token = session(&router).await;
    let (denied, _, _) = request(
        &router,
        Method::PUT,
        "/api/settings/providers/pexels/key",
        Some(json!({"key":"not-supported"})),
        Some("http://127.0.0.1:5173"),
        Some(&token),
    )
    .await;
    assert_eq!(denied, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn credentials_are_write_only_and_status_reflects_mutations() {
    let (router, _store) = setup();
    let (code, before, no_store) = request(
        &router,
        Method::GET,
        "/api/settings/providers",
        None,
        None,
        None,
    )
    .await;
    assert_eq!(code, StatusCode::OK);
    assert!(no_store);
    assert_eq!(before["providers"][0]["source"], "missing");
    let key = "test-KEY-NEVER-RETURN-OR-LOG";
    let token = session(&router).await;
    let (code, after, no_store) = request(
        &router,
        Method::PUT,
        "/api/settings/providers/youtube/key",
        Some(json!({"key":key})),
        Some("http://127.0.0.1:5173"),
        Some(&token),
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{after:?}");
    assert!(no_store);
    assert_eq!(after["source"], "keychain");
    assert!(!after.to_string().contains(key));
    let (_, status, _) = request(
        &router,
        Method::GET,
        "/api/settings/providers",
        None,
        None,
        None,
    )
    .await;
    assert_eq!(status["providers"][0]["source"], "keychain");
    assert!(!status.to_string().contains(key));
    let token = session(&router).await;
    let (code, deleted, _) = request(
        &router,
        Method::DELETE,
        "/api/settings/providers/youtube/key",
        None,
        Some("http://127.0.0.1:5173"),
        Some(&token),
    )
    .await;
    assert_eq!(code, StatusCode::NO_CONTENT, "{deleted:?}");
    let (_, final_status, _) = request(
        &router,
        Method::GET,
        "/api/settings/providers",
        None,
        None,
        None,
    )
    .await;
    assert_eq!(final_status["providers"][0]["source"], "missing");
}

#[tokio::test]
async fn hostile_origin_missing_token_and_replay_are_rejected_before_keychain_access() {
    let (router, store) = setup();
    let key = json!({"key":"sentinel-never-stored"});
    let token = session(&router).await;
    for (origin, auth) in [
        (Some("https://evil.example"), Some(token.as_str())),
        (None, Some(token.as_str())),
        (Some("http://127.0.0.1:5173"), None),
        (Some("http://127.0.0.1:5173"), Some("wrong-token")),
    ] {
        let (code, body, no_store) = request(
            &router,
            Method::PUT,
            "/api/settings/providers/youtube/key",
            Some(key.clone()),
            origin,
            auth,
        )
        .await;
        assert_eq!(code, StatusCode::FORBIDDEN);
        assert_eq!(
            body,
            json!({"error":{"code":"forbidden","message":"Local provider settings authorization failed"}})
        );
        assert!(no_store);
    }
    assert!(!store.0.lock().unwrap().contains_key(&ProviderId::Youtube));
    let (code, _, _) = request(
        &router,
        Method::PUT,
        "/api/settings/providers/youtube/key",
        Some(key.clone()),
        Some("http://127.0.0.1:5173"),
        Some(&token),
    )
    .await;
    assert_eq!(code, StatusCode::OK);
    let (code, _, _) = request(
        &router,
        Method::PUT,
        "/api/settings/providers/youtube/key",
        Some(key),
        Some("http://127.0.0.1:5173"),
        Some(&token),
    )
    .await;
    assert_eq!(code, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn rejects_malformed_or_oversized_keys_without_echoing_secrets() {
    let (router, store) = setup();
    for value in [
        json!({"key":"short"}),
        json!({"key":"safe-secret", "unexpected":"data"}),
        json!({"key":"a".repeat(513)}),
    ] {
        let token = session(&router).await;
        let (code, body, _) = request(
            &router,
            Method::PUT,
            "/api/settings/providers/youtube/key",
            Some(value.clone()),
            Some("http://127.0.0.1:5173"),
            Some(&token),
        )
        .await;
        assert!(code.is_client_error());
        assert!(!body.to_string().contains("safe-secret"));
    }
    assert!(!store.0.lock().unwrap().contains_key(&ProviderId::Youtube));
    let (code, _, _) = request(
        &router,
        Method::PUT,
        "/api/settings/providers/not-youtube/key",
        Some(json!({"key":"test-secret"})),
        Some("http://127.0.0.1:5173"),
        Some(&session(&router).await),
    )
    .await;
    assert_eq!(code, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn session_token_is_not_issued_to_a_dns_rebinding_host_or_foreign_origin() {
    let (router, _) = setup();
    for (host, origin) in [
        ("127.0.0.1:5173.attacker.example", None),
        ("evil.example:5173", Some("http://127.0.0.1:5173")),
        ("127.0.0.1:5173", Some("https://evil.example")),
    ] {
        let mut builder = Request::builder()
            .method(Method::GET)
            .uri("/api/settings/session")
            .header("host", host);
        if let Some(origin) = origin {
            builder = builder.header("origin", origin);
        }
        let response = router
            .clone()
            .oneshot(builder.body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert_eq!(response.headers().get("cache-control").unwrap(), "no-store");
        let response_body = response.into_body().collect().await.unwrap().to_bytes();
        assert!(!String::from_utf8_lossy(&response_body).contains("token"));
    }
}
