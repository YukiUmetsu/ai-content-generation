use axum::body::Body;
use axum::http::{Request, StatusCode};
use contentgen_server::{AppState, build_router, db};
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

const SEED_SQL: &str = include_str!("../../../fixtures/foundation/seed.sql");

fn setup(seed: bool) -> (tempfile::TempDir, axum::Router) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("contentgen.sqlite");
    let mut db = db::open(&path).unwrap();
    db::migrate(&mut db).unwrap();
    if seed {
        db.execute_batch(SEED_SQL).unwrap();
    }
    drop(db);
    (directory, build_router(AppState::new(path)))
}

async fn get(router: &axum::Router, path: &str) -> (StatusCode, Option<Value>) {
    let response = router
        .clone()
        .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let parsed = (!body.is_empty()).then(|| serde_json::from_slice(&body).unwrap());
    (status, parsed)
}

#[tokio::test]
async fn empty_library_has_honest_search_and_packaging_states() {
    let (_directory, router) = setup(false);
    let (status, evidence) = get(&router, "/api/research/search?q=insulation&limit=20").await;
    assert_eq!(status, StatusCode::OK);
    let evidence = evidence.unwrap();
    assert_eq!(evidence["index"]["state"], "empty");
    assert_eq!(evidence["index"]["indexedPassageCount"], 0);
    assert_eq!(evidence["results"].as_array().unwrap().len(), 0);
    let (status, packaging) = get(&router, "/api/creative/packaging").await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert!(packaging.is_none());
}

#[tokio::test]
async fn search_returns_only_actually_stored_passages_with_source_provenance() {
    let (_directory, router) = setup(true);
    let (status, body) = get(&router, "/api/research/search?q=purchase%20price&limit=20").await;
    assert_eq!(status, StatusCode::OK);
    let evidence = body.unwrap();
    assert_eq!(evidence["index"]["state"], "ready");
    assert_eq!(evidence["index"]["sourcePassageCount"], 1);
    assert_eq!(evidence["index"]["indexedPassageCount"], 1);
    let results = evidence["results"].as_array().unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0]["passageId"], "psg_house_cost_fixture_p1");
    assert_eq!(results[0]["source"]["sourceKind"], "test");
    assert_eq!(
        results[0]["source"]["title"],
        "Illustrative house cost assumptions"
    );
    assert_eq!(results[0]["version"]["id"], "srcv_house_cost_fixture_1");
    assert_eq!(results[0]["locator"]["page"], 1);
    assert!(results[0]["bm25"].as_f64().unwrap().is_finite());
    assert_eq!(results[0]["claims"], serde_json::json!([]));
    assert_eq!(results[0]["numericValues"], serde_json::json!([]));
    assert_eq!(evidence["contradictions"], serde_json::json!([]));

    let (_, unrelated) = get(&router, "/api/research/search?q=watermelon").await;
    assert_eq!(unrelated.unwrap()["results"], serde_json::json!([]));
}

#[tokio::test]
async fn packaging_reads_real_saved_document_and_never_an_illustrative_default() {
    let (_directory, router) = setup(true);
    let (status, body) = get(&router, "/api/creative/packaging").await;
    assert_eq!(status, StatusCode::OK);
    let document = body.unwrap();
    assert_eq!(document["id"], "pkg_house_cost_fixture_v1");
    assert_eq!(document["hypotheses"].as_array().unwrap().len(), 3);
    assert_eq!(document["metrics"][0]["provenance"], "estimated");
}

#[tokio::test]
async fn search_rejects_invalid_limits_and_treats_metacharacters_as_literal_terms() {
    let (_directory, router) = setup(true);
    let (status, _) = get(&router, "/api/research/search?q=house&limit=9999").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, body) = get(
        &router,
        "/api/research/search?q=%22%20OR%20%2A%20%28house%29",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.unwrap()["results"].is_array());
}
