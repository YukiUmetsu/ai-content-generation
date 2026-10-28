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

#[tokio::test]
async fn crashed_video_worker_is_recovered_only_after_its_lease_expires() {
    let temp = tempfile::tempdir().unwrap();
    let db_path = temp.path().join("jobs.sqlite");
    let mut connection = db::open(&db_path).unwrap();
    db::migrate(&mut connection).unwrap();
    let app = build_router(AppState::new(db_path));
    let (status, created) = call(
        &app,
        Method::POST,
        "/api/jobs",
        json!({"jobKind":"video-production","idempotencyKey":"lease-restart-test",
          "nodes":[{"nodeKey":"scene-a","nodeKind":"video.render","maxAttempts":3,
            "input":{},"dependsOn":[]}]}),
        true,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let job = created["job"]["id"].as_str().unwrap();
    let node = created["nodes"][0]["id"].as_str().unwrap();
    let start_path = format!("/api/jobs/{job}/nodes/{node}/start");
    let (_, first) = call(&app, Method::POST, &start_path, json!({}), true).await;
    let first_attempt = first["attempt"]["id"].as_str().unwrap();
    let heartbeat_path = format!("/api/jobs/{job}/nodes/{node}/heartbeat");
    let recover_path = format!("/api/jobs/{job}/recover-stale");

    assert_eq!(
        call(
            &app,
            Method::POST,
            &heartbeat_path,
            json!({"attemptId":first_attempt}),
            false
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(&app, Method::POST, &recover_path, json!({}), false)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &app,
            Method::POST,
            &heartbeat_path,
            json!({"attemptId":"not-the-owner"}),
            true
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );

    // A live worker refreshes an outdated timestamp without losing the node.
    connection
        .execute(
            "UPDATE job_nodes SET updated_at = '2000-01-01T00:00:00Z' WHERE id = ?1",
            [node],
        )
        .unwrap();
    assert_eq!(
        call(
            &app,
            Method::POST,
            &heartbeat_path,
            json!({"attemptId":first_attempt}),
            true
        )
        .await
        .0,
        StatusCode::OK
    );
    let (status, healthy) = call(&app, Method::POST, &recover_path, json!({}), true).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(healthy["nodes"][0]["state"], "RUNNING");

    // The worker is killed: after its lease expires, only its attempt is
    // failed; its node becomes READY for a new worker. An old worker cannot
    // commit output or renew ownership after that transactional recovery.
    connection
        .execute(
            "UPDATE job_nodes SET updated_at = '2000-01-01T00:00:00Z' WHERE id = ?1",
            [node],
        )
        .unwrap();
    let (status, recovered) = call(&app, Method::POST, &recover_path, json!({}), true).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(recovered["nodes"][0]["state"], "READY");
    assert_eq!(
        recovered["attempts"][0]["errorCode"],
        "worker_lease_expired"
    );
    assert_eq!(
        call(
            &app,
            Method::POST,
            &heartbeat_path,
            json!({"attemptId":first_attempt}),
            true
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        call(
            &app,
            Method::POST,
            &format!("/api/jobs/{job}/nodes/{node}/succeed"),
            json!({"attemptId":first_attempt,"output":{"incorrect":true}}),
            true
        )
        .await
        .0,
        StatusCode::CONFLICT
    );

    let (status, second) = call(&app, Method::POST, &start_path, json!({}), true).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_ne!(second["attempt"]["id"], first_attempt);
    assert_eq!(
        call(
            &app,
            Method::POST,
            &heartbeat_path,
            json!({"attemptId":second["attempt"]["id"]}),
            true
        )
        .await
        .0,
        StatusCode::OK
    );
}
