use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use contentgen_server::{AppState, build_router, db};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

async fn call(app: &axum::Router, method: Method, project: &str, source: &str,
              payload: Value, authorized: bool, origin: Option<&str>) -> (StatusCode, Value) {
    let mut request = Request::builder().method(method)
        .uri(format!("/api/scene-cast/{project}/{source}"))
        .header("host", "127.0.0.1:8787")
        .header("content-type", "application/json");
    if authorized { request = request.header("x-contentgen-scene-cast", "local-only"); }
    if let Some(origin) = origin { request = request.header("origin", origin); }
    let response = app.clone().oneshot(request.body(Body::from(payload.to_string())).unwrap()).await.unwrap();
    let code = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (code, serde_json::from_slice(&bytes).unwrap())
}

fn cast(project: &str, source: &str) -> Value {
    json!({"schemaVersion":1,"projectId":project,"sourcePlanSha256":source,"assignments":[
        {"shotId":"hook","speaker":{"id":"pip","role":"character","provider":"fish",
            "voiceId":"6ab4c6b0f37f4243a99046478647be94"}},
        {"shotId":"closing","speaker":{"id":"pip","role":"character","provider":"fish",
            "voiceId":"6ab4c6b0f37f4243a99046478647be94"}}
    ]})
}

#[tokio::test]
async fn scene_cast_is_revisioned_source_scoped_and_survives_server_restart() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("contentgen.sqlite");
    let mut database = db::open(&path).unwrap();
    db::migrate(&mut database).unwrap();
    let project = "production-aaaaaaaaaaaaaaaaaaaaaaaa";
    let source = "a".repeat(64);
    let alternate = "b".repeat(64);
    let app = build_router(AppState::new(path.clone()));
    assert_eq!(call(&app, Method::GET, project, &source, json!({}), false, None).await.1,
        json!({"revision":0,"cast":null}));
    let request = json!({"revision":0,"cast":cast(project,&source)});
    assert_eq!(call(&app, Method::PUT, project, &source, request.clone(), false, None).await.0,
        StatusCode::FORBIDDEN);
    assert_eq!(call(&app, Method::PUT, project, &source, request.clone(), true, None).await.0,
        StatusCode::OK);
    assert_eq!(call(&app, Method::PUT, project, &source, request, true, None).await.0,
        StatusCode::CONFLICT);
    let mut revised = cast(project,&source);
    revised["assignments"].as_array_mut().unwrap().pop();
    let updated = call(&app, Method::PUT, project, &source,
        json!({"revision":1,"cast":revised}), true, None).await;
    assert_eq!(updated.0, StatusCode::OK);
    assert_eq!(updated.1["revision"], 2);
    let reopened = build_router(AppState::new(path));
    assert_eq!(call(&reopened, Method::GET, project, &source, json!({}), false, None).await.1,
        updated.1);
    assert_eq!(call(&reopened, Method::GET, project, &alternate, json!({}), false, None).await.1["cast"],
        Value::Null);
    assert_eq!(call(&reopened, Method::GET, "another-project", &source, json!({}), false, None).await.1["cast"],
        Value::Null);
}

#[tokio::test]
async fn scene_cast_rejects_invalid_voice_duplicate_shots_mismatched_source_and_forged_origin() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("contentgen.sqlite");
    let mut database = db::open(&path).unwrap();
    db::migrate(&mut database).unwrap();
    let app = build_router(AppState::new(path));
    let source = "c".repeat(64);
    let project = "project-one";
    let original = cast(project,&source);
    let mut duplicate = original.clone();
    duplicate["assignments"][1]["shotId"] = json!("hook");
    let mut switched = original.clone();
    switched["assignments"][1]["speaker"]["voiceId"] = json!("b".repeat(32));
    let mut wrong_provider = original.clone();
    wrong_provider["assignments"][0]["speaker"]["provider"] = json!("invalid");
    let mut extra_field = original.clone();
    extra_field["assignments"][0]["speaker"]["apiKey"] = json!("must-never-store");
    for invalid in [duplicate, switched, wrong_provider, extra_field,
        cast("another-project",&source), cast(project,&"d".repeat(64))] {
        assert_eq!(call(&app, Method::PUT, project, &source,
            json!({"revision":0,"cast":invalid}), true, None).await.0, StatusCode::BAD_REQUEST);
    }
    assert_eq!(call(&app, Method::PUT, project, &source,
        json!({"revision":0,"cast":original}), true, Some("https://other.example")).await.0,
        StatusCode::FORBIDDEN);
    assert_eq!(call(&app, Method::GET, project, &source, json!({}), false, None).await.1,
        json!({"revision":0,"cast":null}));
}
