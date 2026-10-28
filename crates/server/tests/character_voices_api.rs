use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use contentgen_server::{AppState, build_router, db};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

async fn call(app: &axum::Router, method: Method, url: &str, data: Vec<u8>,
              content_type: &str, editor: bool, origin: Option<&str>) -> (StatusCode, Value) {
    let mut request = Request::builder().method(method).uri(url)
        .header("host", "127.0.0.1:8787").header("content-type", content_type);
    if editor {
        request = request.header(if content_type == "application/zip" {
            "x-contentgen-character"
        } else { "x-contentgen-character-voices" }, "local-only");
    }
    if let Some(origin) = origin { request = request.header("origin", origin); }
    let response = app.clone().oneshot(request.body(Body::from(data)).unwrap()).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap())
}

async fn create_draft(app: &axum::Router, project: &str, character: &str) -> Value {
    let url = format!("/api/character-drafts?projectId={project}&characterId={character}&revision=v1");
    let mut zip = b"PK\x03\x04".to_vec();
    zip.extend_from_slice(&[1_u8; 30]);
    let (status, draft) = call(app, Method::POST, &url, zip, "application/zip", true, None).await;
    assert_eq!(status, StatusCode::CREATED, "{draft:?}");
    draft
}

fn registry(project: &str, draft: &Value) -> Value {
    json!({"schemaVersion":1,"projectId":project,"bindings":[{
        "draftId":draft["id"],"characterId":draft["characterId"],"revision":draft["revision"],
        "voice":{"provider":"fish","voiceId":"6ab4c6b0f37f4243a99046478647be94",
            "name":"Fish default","gender":"unspecified","situation":"narration","language":"und"}
    }]})
}

async fn voices(app: &axum::Router, method: Method, project: &str, data: Value,
                editor: bool, origin: Option<&str>) -> (StatusCode, Value) {
    call(app, method, &format!("/api/character-voices/{project}"), data.to_string().into_bytes(),
        "application/json", editor, origin).await
}

#[tokio::test]
async fn character_voice_bindings_survive_restart_are_versioned_and_draft_scoped() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("contentgen.sqlite");
    let mut connection = db::open(&path).unwrap();
    db::migrate(&mut connection).unwrap();
    let app = build_router(AppState::new(path.clone()));
    let pip = create_draft(&app, "project-a", "pip").await;
    let quill = create_draft(&app, "project-a", "quill").await;
    let other = create_draft(&app, "project-b", "pip").await;
    assert_eq!(voices(&app, Method::GET, "project-a", json!({}), false, None).await.1,
        json!({"revision":0,"registry":null}));
    let first = registry("project-a", &pip);
    let request = json!({"revision":0,"registry":first});
    assert_eq!(voices(&app, Method::PUT, "project-a", request.clone(), false, None).await.0, StatusCode::FORBIDDEN);
    let created = voices(&app, Method::PUT, "project-a", request.clone(), true, None).await;
    assert_eq!(created.0, StatusCode::OK, "{:?}", created.1);
    assert_eq!(created.1["revision"], 1);
    assert_eq!(voices(&app, Method::PUT, "project-a", request, true, None).await.0, StatusCode::CONFLICT);

    let mut next = registry("project-a", &pip);
    let mut second = registry("project-a", &quill)["bindings"][0].clone();
    second["voice"]["provider"] = json!("local");
    second["voice"]["voiceId"] = json!("quill-voice");
    next["bindings"].as_array_mut().unwrap().push(second);
    let updated = voices(&app, Method::PUT, "project-a", json!({"revision":1,"registry":next}), true, None).await;
    assert_eq!(updated.0, StatusCode::OK);
    assert_eq!(updated.1["revision"], 2);
    let reopened = build_router(AppState::new(path));
    assert_eq!(voices(&reopened, Method::GET, "project-a", json!({}), false, None).await.1, updated.1);
    assert_eq!(voices(&reopened, Method::GET, "project-b", json!({}), false, None).await.1["registry"], Value::Null);
    assert_eq!(voices(&reopened, Method::PUT, "project-a", json!({"revision":1,"registry":registry("project-a",&pip)}), true, None).await.0, StatusCode::CONFLICT);
    assert_eq!(voices(&reopened, Method::PUT, "project-a", json!({"revision":2,"registry":registry("project-a",&other)}), true, None).await.0, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn character_voices_refuse_forged_drafts_duplicate_assignments_and_cross_origin_writes() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("contentgen.sqlite");
    let mut connection = db::open(&path).unwrap();
    db::migrate(&mut connection).unwrap();
    let app = build_router(AppState::new(path));
    let pip = create_draft(&app, "project-a", "pip").await;
    let valid = registry("project-a", &pip);
    let mut duplicate = valid.clone();
    duplicate["bindings"].as_array_mut().unwrap().push(valid["bindings"][0].clone());
    let mut wrong_revision = valid.clone();
    wrong_revision["bindings"][0]["revision"] = json!("v2");
    let mut wrong_voice = valid.clone();
    wrong_voice["bindings"][0]["voice"]["voiceId"] = json!("not-a-fish-id");
    for invalid in [duplicate, wrong_revision, wrong_voice, json!({"schemaVersion":2,"projectId":"project-a","bindings":[]})] {
        assert_eq!(voices(&app, Method::PUT, "project-a", json!({"revision":0,"registry":invalid}), true, None).await.0, StatusCode::BAD_REQUEST);
    }
    assert_eq!(voices(&app, Method::PUT, "project-a", json!({"revision":0,"registry":valid}), true, Some("https://evil.example")).await.0, StatusCode::FORBIDDEN);
    assert_eq!(voices(&app, Method::GET, "project-a", json!({}), false, None).await.1["revision"], 0);
}
