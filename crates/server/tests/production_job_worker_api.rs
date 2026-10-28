use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use contentgen_server::{AppState, build_router, db};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

async fn call(
    router: &axum::Router,
    method: Method,
    path: &str,
    body: Value,
    worker: bool,
) -> (StatusCode, Value) {
    let mut req = Request::builder()
        .method(method)
        .uri(path)
        .header("host", "127.0.0.1:8787")
        .header("content-type", "application/json");
    if worker {
        req = req.header("x-contentgen-worker", "local-only");
    }
    let response = router
        .clone()
        .oneshot(req.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let code = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (code, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

#[tokio::test]
async fn production_worker_attempts_are_durable_and_authorized() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("data.sqlite");
    let mut connection = db::open(&path).unwrap();
    db::migrate(&mut connection).unwrap();
    let app = build_router(AppState::new(path.clone()));
    let spec = json!({"jobKind":"video-production","idempotencyKey":"video-test-1","nodes":[
        {"nodeKey":"plan","nodeKind":"video.plan","maxAttempts":3,"input":{},"dependsOn":[]},
        {"nodeKey":"render","nodeKind":"video.render","maxAttempts":3,"input":{},"dependsOn":["plan"]}
    ]});
    let (status, created) = call(&app, Method::POST, "/api/jobs", spec, true).await;
    assert_eq!(status, StatusCode::CREATED, "{created:?}");
    let job = created["job"]["id"].as_str().unwrap();
    let plan = created["nodes"][0]["id"].as_str().unwrap();
    let render = created["nodes"][1]["id"].as_str().unwrap();
    let path_start = format!("/api/jobs/{job}/nodes/{plan}/start");
    assert_eq!(
        call(&app, Method::POST, &path_start, json!({}), false)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let (status, attempt) = call(&app, Method::POST, &path_start, json!({}), true).await;
    assert_eq!(status, StatusCode::CREATED, "{attempt:?}");
    let attempt_id = attempt["attempt"]["id"].as_str().unwrap();
    let (status, blocked) = call(
        &app,
        Method::POST,
        &format!("/api/jobs/{job}/nodes/{render}/start"),
        json!({}),
        true,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{blocked:?}");
    let finish = format!("/api/jobs/{job}/nodes/{plan}/succeed");
    let (status, updated) = call(
        &app,
        Method::POST,
        &finish,
        json!({"attemptId":attempt_id,"output":{"ok":true}}),
        true,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{updated:?}");
    assert_eq!(updated["nodes"][1]["state"], "READY");
    let restart = build_router(AppState::new(path));
    let (status, saved) = call(
        &restart,
        Method::GET,
        &format!("/api/jobs/{job}"),
        json!({}),
        false,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(saved["progress"]["succeeded"], 1);

    let (status, second) = call(
        &restart,
        Method::POST,
        &format!("/api/jobs/{job}/nodes/{render}/start"),
        json!({}),
        true,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{second:?}");
    let failed_attempt = second["attempt"]["id"].as_str().unwrap();
    let (status,failed)=call(&restart,Method::POST,
        &format!("/api/jobs/{job}/nodes/{render}/fail"),
        json!({"attemptId":failed_attempt,"errorCode":"voice_unavailable","errorDetail":"Voice service stopped"}),true).await;
    // The generic scheduler exposes bounded automatic retries when maxAttempts
    // permits them. Exhaust the second and third attempts to exercise explicit
    // production recovery and ensure earlier plan work remains succeeded.
    assert_eq!(status, StatusCode::OK, "{failed:?}");
    for _ in 0..2 {
        let (_, next) = call(
            &restart,
            Method::POST,
            &format!("/api/jobs/{job}/nodes/{render}/start"),
            json!({}),
            true,
        )
        .await;
        let next_id = next["attempt"]["id"].as_str().unwrap();
        let (code, _) = call(
            &restart,
            Method::POST,
            &format!("/api/jobs/{job}/nodes/{render}/fail"),
            json!({"attemptId":next_id,"errorCode":"voice_unavailable"}),
            true,
        )
        .await;
        assert_eq!(code, StatusCode::OK);
    }
    assert_eq!(
        call(
            &restart,
            Method::POST,
            &format!("/api/jobs/{job}/retry"),
            json!({}),
            false
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let (code, rearmed) = call(
        &restart,
        Method::POST,
        &format!("/api/jobs/{job}/retry"),
        json!({}),
        true,
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{rearmed:?}");
    assert_eq!(
        rearmed["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|n| n["state"] == "SUCCEEDED")
            .count(),
        1
    );
    assert_eq!(rearmed["progress"]["ready"], 1);
    assert_eq!(
        call(
            &restart,
            Method::POST,
            &format!("/api/jobs/{job}/retry"),
            json!({}),
            true
        )
        .await
        .0,
        StatusCode::CONFLICT,
        "only a terminal job can be retried"
    );
}
