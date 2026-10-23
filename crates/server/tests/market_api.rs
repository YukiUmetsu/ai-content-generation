use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use contentgen_server::research::{
    market_api::epoch_now,
    market_store::{self, MarketWatchlistDraft, VideoObservation},
};
use contentgen_server::{AppState, build_router, db};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

fn setup() -> (tempfile::TempDir, axum::Router) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("research.sqlite3");
    let mut connection = db::open(&path).unwrap();
    db::migrate(&mut connection).unwrap();
    drop(connection);
    (dir, build_router(AppState::new(path)))
}

async fn call(
    router: &axum::Router,
    method: Method,
    path: &str,
    body: Option<Value>,
    local: bool,
) -> (StatusCode, Value) {
    let mut req = Request::builder().method(method).uri(path);
    if body.is_some() {
        req = req.header("content-type", "application/json");
    }
    if local {
        req = req.header("x-contentgen-market", "local-only");
    }
    let req = req
        .body(Body::from(body.map_or_else(String::new, |x| x.to_string())))
        .unwrap();
    let response = router.clone().oneshot(req).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let payload = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap()
    };
    (status, payload)
}

#[tokio::test]
async fn watchlists_roundtrip_and_expose_source_aware_empty_results() {
    let (_dir, router) = setup();
    let draft = json!({"name":"House Math","query":"heat pump cost","region":"US","language":"en","enabled":false});
    let (status, created) = call(
        &router,
        Method::POST,
        "/api/research/market/watchlists",
        Some(draft.clone()),
        true,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created:?}");
    let id = created["id"].as_str().unwrap();
    let (status, listed) = call(
        &router,
        Method::GET,
        "/api/research/market/watchlists",
        None,
        false,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(listed["watchlists"].as_array().unwrap().len(), 1);
    let (status, videos) = call(
        &router,
        Method::GET,
        &format!("/api/research/market/watchlists/{id}/videos"),
        None,
        false,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(videos["videos"].as_array().unwrap().len(), 0);
    let mut changed_draft = draft.clone();
    changed_draft["enabled"] = json!(true);
    let (status, changed) = call(
        &router,
        Method::PATCH,
        &format!("/api/research/market/watchlists/{id}"),
        Some(changed_draft),
        true,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{changed:?}");
    assert_eq!(changed["enabled"], true);
    let (status, _) = call(
        &router,
        Method::DELETE,
        &format!("/api/research/market/watchlists/{id}"),
        None,
        true,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn mutations_require_local_header_and_missing_key_never_consumes_budget() {
    let (_dir, router) = setup();
    let draft = json!({"name":"House Math","query":"HVAC cost","region":"US","language":"en","enabled":true});
    let (status, _) = call(
        &router,
        Method::POST,
        "/api/research/market/watchlists",
        Some(draft.clone()),
        false,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (_, created) = call(
        &router,
        Method::POST,
        "/api/research/market/watchlists",
        Some(draft),
        true,
    )
    .await;
    let id = created["id"].as_str().unwrap();
    let (status, error) = call(
        &router,
        Method::POST,
        &format!("/api/research/market/watchlists/{id}/collect"),
        None,
        true,
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{error:?}");
    let (status, metrics) = call(
        &router,
        Method::GET,
        "/api/research/market/status",
        None,
        false,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(metrics["apiKeyConfigured"], false);
    assert_eq!(metrics["searchCallsLast24h"], 0);
}

#[tokio::test]
async fn related_is_read_only_local_cache_and_validates_the_topic() {
    let (dir, router) = setup();
    let db = db::open(dir.path().join("research.sqlite3")).unwrap();
    let now = epoch_now();
    let watch = market_store::create_watchlist(
        &db,
        MarketWatchlistDraft {
            name: "Home Energy".into(),
            query: "heat pump installation costs".into(),
            region: "US".into(),
            language: "en".into(),
            enabled: true,
        },
        now,
    )
    .unwrap();
    let run = market_store::claim_watchlist(&db, &watch.id, now, true)
        .unwrap()
        .unwrap();
    market_store::complete_run(
        &db,
        &run.id,
        &[VideoObservation {
            video_id: "heatABC1234".into(),
            title: "Heat Pump Installation Explained".into(),
            channel_id: "UCsample".into(),
            channel_title: "Example".into(),
            published_at: "2026-10-20T00:00:00Z".into(),
            duration_seconds: Some(320),
            view_count: Some(1200),
            like_count: None,
            comment_count: None,
            subscriber_count: None,
        }],
        now,
    )
    .unwrap();
    let budget = market_store::used_search_calls(&db, now).unwrap();
    let (status, body) = call(
        &router,
        Method::GET,
        "/api/research/market/related?topic=heat%20pump",
        None,
        false,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(body["videos"].as_array().unwrap().len(), 1);
    assert_eq!(body["videos"][0]["watchlistName"], "Home Energy");
    assert_eq!(
        body["videos"][0]["sourceUrl"],
        "https://www.youtube.com/watch?v=heatABC1234"
    );
    assert_eq!(body["videos"][0]["matchedTerms"], json!(["heat", "pump"]));
    assert_eq!(market_store::used_search_calls(&db, now).unwrap(), budget);
    let (status, _) = call(
        &router,
        Method::GET,
        "/api/research/market/related?topic=%20",
        None,
        false,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}
