use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use contentgen_server::{AppState, build_router, db};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

async fn call(app: &axum::Router, method: Method, project: &str, body: Value,
              editor: bool, origin: Option<&str>) -> (StatusCode, Value) {
    let mut request = Request::builder().method(method)
        .uri(format!("/api/project-voices/{project}"))
        .header("host", "127.0.0.1:8787")
        .header("content-type", "application/json");
    if editor { request = request.header("x-contentgen-voices", "local-only"); }
    if let Some(origin) = origin { request = request.header("origin", origin); }
    let response = app.clone().oneshot(request.body(Body::from(body.to_string())).unwrap()).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap())
}

fn library(project: &str) -> Value {
    json!({"schemaVersion":1,"projectId":project,"voices":[
        {"provider":"fish","voiceId":"6ab4c6b0f37f4243a99046478647be94",
         "name":"Fish default","gender":"unspecified","situation":"narration","language":"und"}
    ]})
}

#[tokio::test]
async fn project_voice_favorites_survive_reopen_reject_stale_writes_and_isolate_projects() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("contentgen.sqlite");
    let mut connection = db::open(&path).unwrap();
    db::migrate(&mut connection).unwrap();
    let app = build_router(AppState::new(path.clone()));
    let empty = call(&app, Method::GET, "project-a", json!({}), false, None).await;
    assert_eq!(empty, (StatusCode::OK, json!({"revision":0,"library":null})));

    let write = json!({"revision":0,"library":library("project-a")});
    assert_eq!(call(&app, Method::PUT, "project-a", write.clone(), false, None).await.0, StatusCode::FORBIDDEN);
    let created = call(&app, Method::PUT, "project-a", write.clone(), true, None).await;
    assert_eq!(created.0, StatusCode::OK, "{:?}", created.1);
    assert_eq!(created.1["revision"], 1);
    assert_eq!(call(&app, Method::PUT, "project-a", write, true, None).await.0, StatusCode::CONFLICT);

    let mut edited = library("project-a");
    edited["voices"].as_array_mut().unwrap().push(json!({
        "provider":"local","voiceId":"secondary","name":"Dialogue",
        "gender":"female","situation":"conversation","language":"ja"}));
    edited["voices"].as_array_mut().unwrap().reverse();
    let changed = call(&app, Method::PUT, "project-a", json!({"revision":1,"library":edited}), true, None).await;
    assert_eq!(changed.0, StatusCode::OK);
    assert_eq!(changed.1["revision"], 2);
    assert_eq!(changed.1["library"]["voices"][0]["voiceId"], "secondary");

    // The state is disk-owned, not a previous router instance's process memory.
    let reopened = build_router(AppState::new(path));
    let loaded = call(&reopened, Method::GET, "project-a", json!({}), false, None).await;
    assert_eq!(loaded.1, changed.1);
    assert_eq!(call(&reopened, Method::GET, "project-b", json!({}), false, None).await.1["library"], Value::Null);
    assert_eq!(call(&reopened, Method::PUT, "project-a", json!({"revision":1,"library":library("project-a")}), true, None).await.0, StatusCode::CONFLICT);
    assert_eq!(call(&reopened, Method::PUT, "project-a", json!({"revision":2,"library":library("project-b")}), true, None).await.0, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn project_voices_validate_tags_revision_and_browser_origin_without_mutating_saved_data() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("contentgen.sqlite");
    let mut connection = db::open(&path).unwrap();
    db::migrate(&mut connection).unwrap();
    let app = build_router(AppState::new(path));
    let original = library("p1");
    for altered in [
        json!({"schemaVersion":2,"projectId":"p1","voices":[]}),
        json!({"schemaVersion":1,"projectId":"p1","voices":[original["voices"][0],original["voices"][0]]}),
        json!({"schemaVersion":1,"projectId":"p1","voices":[{"provider":"fish","voiceId":"not-a-fish-id","name":"No","gender":"female","situation":"narration","language":"en"}]}),
        json!({"schemaVersion":1,"projectId":"p1","voices":[{"provider":"local","voiceId":"ok","name":"Voice","gender":"female","situation":"test","language":"invalid locale!"}]}),
    ] {
        assert_eq!(call(&app, Method::PUT, "p1", json!({"revision":0,"library":altered}), true, None).await.0, StatusCode::BAD_REQUEST);
    }
    assert_eq!(call(&app, Method::PUT, "p1", json!({"revision":-1,"library":original}), true, None).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(call(&app, Method::PUT, "p1", json!({"revision":0,"library":library("p1")}), true, Some("https://attacker.example")).await.0, StatusCode::FORBIDDEN);
    assert_eq!(call(&app, Method::GET, "p1", json!({}), false, None).await.1["revision"], 0);
    assert_eq!(call(&app, Method::GET, "bad.project", json!({}), false, None).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(call(&app, Method::PUT, "p1", json!({"revision":0,"library":library("p1")}), true, None).await.0, StatusCode::OK);
}
