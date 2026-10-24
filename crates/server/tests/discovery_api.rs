use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use contentgen_server::{AppState, build_router, db};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

fn setup() -> (tempfile::TempDir, axum::Router) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("api.sqlite3");
    let mut conn = db::open(&path).unwrap();
    db::migrate(&mut conn).unwrap();
    (dir, build_router(AppState::new(path)))
}
async fn call(
    router: &axum::Router,
    method: Method,
    path: &str,
    body: Value,
    authorized: bool,
) -> (StatusCode, Value) {
    let mut req = Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json");
    if authorized {
        req = req.header("x-contentgen-discovery", "local-only");
    }
    let response = router
        .clone()
        .oneshot(req.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn discovery_api_prevents_untrusted_mutations_and_roundtrips_run_history() {
    let (_dir, router) = setup();
    let snapshot = json!({"id":"project-houses","name":"House Math","notes":"Economics of home ownership",
    "updatedAt":10,"content":[]});
    let path = "/api/research/discovery/projects/project-houses/sync";
    let (status, _) = call(&router, Method::POST, path, snapshot.clone(), false).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, created) = call(&router, Method::POST, path, snapshot, true).await;
    assert_eq!(status, StatusCode::OK, "{created:?}");
    assert_eq!(created["snapshotRevision"], 10);
    let (status, keywords) = call(
        &router,
        Method::PATCH,
        "/api/research/discovery/projects/project-houses/keywords",
        json!({"add":[{"text":"Roof replacement costs","kind":"topic","origin":"manual"}]}),
        true,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{keywords:?}");
    assert_eq!(keywords["keywords"].as_array().unwrap().len(), 1);
    let (status, graph) = call(
        &router,
        Method::GET,
        "/api/research/discovery/projects/project-houses/graph",
        json!({}),
        false,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{graph:?}");
    assert_eq!(graph["sources"].as_array().unwrap().len(), 0);
    let (status, run) = call(
        &router,
        Method::POST,
        "/api/research/discovery/projects/project-houses/discover",
        json!({"inputRevision":"version-1"}),
        true,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{run:?}");
    let run_id = run["id"].as_str().unwrap();
    let (status, completed) = call(
        &router,
        Method::POST,
        &format!("/api/research/discovery/projects/project-houses/runs/{run_id}/finish"),
        json!({"status":"insufficient_evidence","candidates":[]}),
        true,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{completed:?}");
    assert_eq!(completed["status"], "insufficient_evidence");
}
