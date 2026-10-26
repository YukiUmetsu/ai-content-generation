use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use contentgen_server::{AppState, build_router, db};
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

async fn call(
    router: &axum::Router, method: Method, path: &str, bytes: Vec<u8>,
    editor: bool, origin: Option<&str>, host: &str,
) -> (StatusCode, Value, Vec<u8>) {
    let mut request = Request::builder().method(method).uri(path)
        .header("host", host).header("content-type", "application/zip");
    if editor { request = request.header("x-contentgen-character", "local-only"); }
    if let Some(origin) = origin { request = request.header("origin", origin); }
    let response = router.clone().oneshot(request.body(Body::from(bytes)).unwrap()).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes().to_vec();
    let json = serde_json::from_slice::<Value>(&bytes).unwrap_or(Value::Null);
    (status, json, bytes)
}

fn zip_fixture(tag: u8) -> Vec<u8> {
    // An inert ZIP signature and EOCD; the persistence boundary intentionally
    // doesn't claim to validate archive contents or trust the browser report.
    let mut bytes = b"PK\x03\x04".to_vec();
    bytes.push(tag);
    bytes.extend_from_slice(&[0_u8; 30]);
    bytes
}

#[tokio::test]
async fn drafts_persist_across_restart_are_immutable_and_scoped_to_a_project() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("contentgen.sqlite");
    let mut db = db::open(&path).unwrap();
    db::migrate(&mut db).unwrap();
    let app = build_router(AppState::new(path.clone()));
    let url = "/api/character-drafts?projectId=project-local&characterId=pip&revision=v1";
    let original = zip_fixture(1);
    assert_eq!(call(&app, Method::POST, url, original.clone(), false, None, "127.0.0.1:8787").await.0,
        StatusCode::FORBIDDEN);
    let (created, draft, _) = call(&app, Method::POST, url, original.clone(), true, None, "127.0.0.1:8787").await;
    assert_eq!(created, StatusCode::CREATED, "{draft:?}");
    assert_eq!(draft["projectId"], "project-local");
    assert_eq!(draft["characterId"], "pip");
    assert_eq!(draft["revision"], "v1");
    assert_eq!(draft["status"], "unverified");
    assert_eq!(draft["archiveSha256"].as_str().unwrap().len(), 64);

    let (duplicate, again, _) = call(&app, Method::POST, url, original.clone(), true, None, "127.0.0.1:8787").await;
    assert_eq!(duplicate, StatusCode::OK);
    assert_eq!(again["id"], draft["id"]);
    assert_eq!(call(&app, Method::POST, url, zip_fixture(2), true, None, "127.0.0.1:8787").await.0,
        StatusCode::CONFLICT);

    let restarted = build_router(AppState::new(path));
    let (listed, rows, _) = call(&restarted, Method::GET, "/api/character-drafts?projectId=project-local", vec![], false, None, "127.0.0.1:8787").await;
    assert_eq!(listed, StatusCode::OK);
    assert_eq!(rows["drafts"].as_array().unwrap().len(), 1);
    let other_project = call(&restarted, Method::GET, "/api/character-drafts?projectId=project-other", vec![], false, None, "127.0.0.1:8787").await;
    assert_eq!(other_project.1["drafts"].as_array().unwrap().len(), 0);
    let archive = format!("/api/character-drafts/{}/archive?projectId=project-local", draft["id"].as_str().unwrap());
    let (status, _, loaded) = call(&restarted, Method::GET, &archive, vec![], false, None, "127.0.0.1:8787").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(loaded, original);
    let foreign = archive.replace("project-local", "project-other");
    assert_eq!(call(&restarted, Method::GET, &foreign, vec![], false, None, "127.0.0.1:8787").await.0,
        StatusCode::NOT_FOUND);
    assert!(db.execute("UPDATE character_drafts SET revision='v2'", []).is_err());
    assert!(db.execute("DELETE FROM character_drafts", []).is_err());
}

#[tokio::test]
async fn imports_enforce_loopback_origin_mime_body_limit_and_safe_metadata() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("contentgen.sqlite");
    let mut db = db::open(&path).unwrap();
    db::migrate(&mut db).unwrap();
    let app = build_router(AppState::new(path));
    let url = "/api/character-drafts?projectId=project-local&characterId=pip&revision=v1";
    let original = zip_fixture(1);
    assert_eq!(call(&app, Method::POST, url, original.clone(), true, None, "external.example").await.0,
        StatusCode::FORBIDDEN);
    assert_eq!(call(&app, Method::POST, url, original.clone(), true, Some("https://malicious.example"), "127.0.0.1:8787").await.0,
        StatusCode::FORBIDDEN);
    assert_eq!(call(&app, Method::POST, url, b"not a zip".to_vec(), true, None, "127.0.0.1:8787").await.0,
        StatusCode::BAD_REQUEST);
    assert_eq!(call(&app, Method::POST, url, vec![0; 16 * 1024 * 1024 + 1], true, None, "127.0.0.1:8787").await.0,
        StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(call(&app, Method::POST,
        "/api/character-drafts?projectId=../outside&characterId=pip&revision=v1", original.clone(), true, None, "127.0.0.1:8787").await.0,
        StatusCode::BAD_REQUEST);
    assert_eq!(call(&app, Method::POST, url, original, true, Some("http://127.0.0.1:8787"), "127.0.0.1:8787").await.0,
        StatusCode::CREATED);
}
