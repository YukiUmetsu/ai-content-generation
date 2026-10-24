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
        .header("host", "127.0.0.1:8787")
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
async fn discovery_api_rejects_rebound_hosts_and_cross_origin_requests() {
    let (_dir, router) = setup();
    let project = "/api/research/discovery/projects/project-houses";
    let (created,_)=call(&router,Method::POST,&format!("{project}/sync"),
        json!({"id":"project-houses","name":"House Math","notes":"Local research", "updatedAt":1,"content":[]}),true).await;
    assert_eq!(created, StatusCode::OK);
    for (host, origin) in [
        (
            "attacker.example:8787",
            Some("http://attacker.example:8787"),
        ),
        ("127.0.0.1:8787", Some("https://attacker.example")),
    ] {
        let mut request = Request::builder()
            .method(Method::GET)
            .uri(format!("{project}/graph"))
            .header("host", host);
        if let Some(origin) = origin {
            request = request.header("origin", origin);
        }
        let response = router
            .clone()
            .oneshot(request.body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::FORBIDDEN,
            "untrusted host/origin must not read project graph"
        );
    }
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::DELETE)
                .uri(project)
                .header("host", "attacker.example:8787")
                .header("origin", "http://attacker.example:8787")
                .header("x-contentgen-discovery", "local-only")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        response.status(),
        StatusCode::FORBIDDEN,
        "known edit header cannot authorize rebound host"
    );
    let (still_here, _) = call(
        &router,
        Method::GET,
        &format!("{project}/graph"),
        json!({}),
        false,
    )
    .await;
    assert_eq!(still_here, StatusCode::OK);
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
    assert_eq!(run["inputSnapshot"]["projectName"], "House Math");
    assert_eq!(
        run["inputSnapshot"]["keywords"][0]["text"],
        "Roof replacement costs"
    );
    let run_id = run["id"].as_str().unwrap();
    let artifact_path = format!(
        "/api/research/discovery/projects/project-houses/runs/{run_id}/artifacts/source-query:0"
    );
    let (status, _) = call(
        &router,
        Method::POST,
        &artifact_path,
        json!({"artifact":{"count":2}}),
        false,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, stored) = call(
        &router,
        Method::POST,
        &artifact_path,
        json!({"artifact":{"count":2}}),
        true,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{stored:?}");
    let (status, read) = call(&router, Method::GET, &artifact_path, json!({}), false).await;
    assert_eq!(status, StatusCode::OK, "{read:?}");
    assert_eq!(read["artifact"], json!({"count":2}));
    let (status, unchanged) = call(
        &router,
        Method::POST,
        &artifact_path,
        json!({"artifact":{"count":900}}),
        true,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{unchanged:?}");
    assert_eq!(unchanged["artifact"], json!({"count":2}));
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

#[tokio::test]
async fn graph_alias_search_and_relationship_review_are_project_scoped_and_authorized() {
    let (_dir, router) = setup();
    let prefix = "/api/research/discovery/projects";
    for id in ["project-home", "project-other"] {
        let (status,_) = call(&router,Method::POST,&format!("{prefix}/{id}/sync"),
            json!({"id":id,"name":"Home Costs","notes":"Cost of homeownership","updatedAt":10,"content":[]}),true).await;
        assert_eq!(status, StatusCode::OK);
    }
    let (status,_) = call(&router,Method::POST,&format!("{prefix}/project-home/graph/batches"),
        json!({"nodes":[{"kind":"topic","label":"Home insurance"},{"kind":"topic","label":"Roof repairs"}],
          "edges":[{"fromKind":"topic","fromLabel":"Home insurance","toKind":"topic","toLabel":"Roof repairs",
              "relation":"related_to","status":"hypothesized","sourceId":null,"quote":null}]}),true).await;
    assert_eq!(status, StatusCode::OK);
    let (_, graph) = call(
        &router,
        Method::GET,
        &format!("{prefix}/project-home/graph"),
        json!({}),
        false,
    )
    .await;
    let node = graph["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["label"] == "Home insurance")
        .unwrap()["id"]
        .as_str()
        .unwrap();
    let edge = graph["edges"][0]["id"].as_str().unwrap();
    let aliases = format!("{prefix}/project-home/graph/nodes/{node}/aliases");
    let correction = format!("{prefix}/project-home/graph/edges/{edge}/correction");
    assert_eq!(
        call(
            &router,
            Method::POST,
            &aliases,
            json!({"alias":"Homeowners coverage"}),
            false
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &router,
            Method::POST,
            &aliases,
            json!({"alias":"Homeowners coverage"}),
            true
        )
        .await
        .0,
        StatusCode::OK
    );
    let (status, search) = call(
        &router,
        Method::GET,
        &format!("{prefix}/project-home/graph/search?q=homeowners"),
        json!({}),
        false,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{search:?}");
    assert_eq!(search["nodes"][0]["id"], node);
    assert_eq!(
        call(
            &router,
            Method::PATCH,
            &correction,
            json!({"status":"rejected"}),
            false
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &router,
            Method::PATCH,
            &correction,
            json!({"status":"rejected"}),
            true
        )
        .await
        .0,
        StatusCode::OK
    );
    let (_, updated) = call(
        &router,
        Method::GET,
        &format!("{prefix}/project-home/graph"),
        json!({}),
        false,
    )
    .await;
    assert_eq!(updated["edges"][0]["status"], "rejected");
    assert_eq!(updated["aliases"][0]["alias"], "Homeowners coverage");
    assert_eq!(
        call(
            &router,
            Method::PATCH,
            &format!("{prefix}/project-other/graph/edges/{edge}/correction"),
            json!({"status":"rejected"}),
            true
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(
            &router,
            Method::DELETE,
            &aliases,
            json!({"alias":"Homeowners coverage"}),
            true
        )
        .await
        .0,
        StatusCode::OK
    );
}
