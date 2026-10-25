use axum::body::Body;
use axum::http::{Method,Request,StatusCode};
use contentgen_server::{AppState,build_router,db};
use http_body_util::BodyExt;
use serde_json::{Value,json};
use tower::ServiceExt;

async fn call(router:&axum::Router,method:Method,path:&str,body:Value,authorized:bool)
    ->(StatusCode,Value) {
    let mut request=Request::builder().method(method).uri(path)
        .header("host","127.0.0.1:8787")
        .header("content-type","application/json");
    if authorized { request=request.header("x-contentgen-discovery","local-only"); }
    let response=router.clone().oneshot(request.body(Body::from(body.to_string())).unwrap()).await.unwrap();
    let status=response.status();
    let bytes=response.into_body().collect().await.unwrap().to_bytes();
    (status,serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

#[tokio::test]
async fn session_and_production_api_preserve_scope_and_return_expected_shapes() {
    let dir=tempfile::tempdir().unwrap();
    let path=dir.path().join("contentgen.sqlite");
    let mut conn=db::open(&path).unwrap();
    db::migrate(&mut conn).unwrap();
    let router=build_router(AppState::new(path.clone()));
    for project in ["brand-one","brand-two"] {
        let (code,_) = call(&router,Method::POST,
            &format!("/api/research/discovery/projects/{project}/sync"),
            json!({"id":project,"name":"Margin Atlas","updatedAt":1,"content":[]}),true).await;
        assert_eq!(code,StatusCode::OK);
    }
    let prefix="/api/research/discovery/projects/brand-one/sessions";
    let body=json!({"name":"Autumn topics","platforms":["youtube","tiktok"],
        "settingsSnapshot":{"version":1,"market":"US"}});
    assert_eq!(call(&router,Method::POST,prefix,body.clone(),false).await.0,StatusCode::FORBIDDEN);
    let (created,session)=call(&router,Method::POST,prefix,body,true).await;
    assert_eq!(created,StatusCode::OK,"{session:?}");
    let id=session["id"].as_str().unwrap();
    assert!(id.starts_with("session_"));
    assert_eq!(session["projectId"],"brand-one");
    assert_eq!(session["ideaCount"],0);
    assert_eq!(session["settingsSnapshot"]["market"],"US");
    assert_eq!(call(&router,Method::DELETE,
        "/api/research/discovery/projects/brand-one",json!({}),true).await.0,
        StatusCode::CONFLICT,"saved research must not be deleted through an implicit cascade");
    let (listed,payload)=call(&router,Method::GET,prefix,json!({}),false).await;
    assert_eq!(listed,StatusCode::OK);
    assert_eq!(payload["sessions"].as_array().unwrap().len(),1);
    let foreign=format!("/api/research/discovery/projects/brand-two/sessions/{id}");
    assert_eq!(call(&router,Method::GET,&foreign,json!({}),false).await.0,StatusCode::NOT_FOUND);
    let own=format!("{prefix}/{id}");
    let (changed,payload)=call(&router,Method::PATCH,&own,json!({"name":"Updated topics"}),true).await;
    assert_eq!(changed,StatusCode::OK,"{payload:?}");
    assert_eq!(payload["name"],"Updated topics");
    let (started,run)=call(&router,Method::POST,&format!("{own}/discover"),
        json!({"inputRevision":"rev-1"}),true).await;
    assert_eq!(started,StatusCode::OK,"{run:?}");
    assert_eq!(run["sessionId"],id);
    assert_eq!(call(&router,Method::GET,&format!("{own}/runs"),json!({}),false).await.1["runs"]
        .as_array().unwrap().len(),1);

    // Publishable source evidence is inserted through the same SQLite connection
    // that the local project-discovery API uses, with no external network calls.
    conn.execute("INSERT INTO kg_sources(id,project_id,provider,url,title,observed_at,passage,evidence_state)
        VALUES('source-one','brand-one','searxng','https://example.org/house-costs','House cost source',100,
        'Verified illustrative housing expenses','captured')",[]).unwrap();
    let run_id=run["id"].as_str().unwrap();
    let (finished,_) = call(&router,Method::POST,
        &format!("/api/research/discovery/projects/brand-one/runs/{run_id}/finish"),
        json!({"status":"completed","candidates":[{"title":"The hidden expenses of owning your first home",
            "hook":"The purchase price is only the beginning","premise":"Taxes, insurance and maintenance add up",
            "whyNow":"Buyers underestimate ownership costs","angleKey":"true-home-costs",
            "sourceIds":["source-one"],"confidence":"high"}]}),true).await;
    assert_eq!(finished,StatusCode::OK);
    let (found,ideas)=call(&router,Method::GET,&format!("{own}/ideas"),json!({}),false).await;
    assert_eq!(found,StatusCode::OK);
    let idea=&ideas["ideas"][0];
    assert_eq!(idea["opportunityScore"].as_f64(),Some(60.0));
    assert_eq!(idea["scoreVersion"],"evidence-readiness-v1");
    assert_eq!(idea["scoreInputs"]["audienceDemand"],"unknown");
    assert_eq!(idea["sources"][0]["title"],"House cost source");
    assert_eq!(idea["evidence"][0]["quote"],"Verified illustrative housing expenses");
    assert_eq!(idea["evidence"][0]["reviewStatus"],"unverified");
    let idea_id=idea["id"].as_str().unwrap();
    let market_path=format!("{own}/ideas/{idea_id}/market");
    let market_request=json!({"query":"hidden homeownership costs","format":"long"});
    assert_eq!(call(&router,Method::POST,&market_path,market_request.clone(),false).await.0,
        StatusCode::FORBIDDEN,"an unrelated web page cannot spend YouTube quota");
    assert_eq!(call(&router,Method::POST,&market_path,market_request,true).await.0,
        StatusCode::SERVICE_UNAVAILABLE,"without a configured key the backend must not collect");
    assert_eq!(conn.query_row("SELECT COUNT(*) FROM market_search_budget",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    let make=json!({"projectId":"brand-one","sessionId":id,"ideaId":idea_id,
        "brief":{"topic":"Homeownership expenses","title":"A better title",
            "angle":"The hidden costs","description":"Costs of ownership",
            "keywords":[],"platforms":["youtube","tiktok"]},
        "platforms":["youtube","tiktok"]});
    assert_eq!(call(&router,Method::POST,"/api/productions",make.clone(),false).await.0,StatusCode::FORBIDDEN);
    let (made,production)=call(&router,Method::POST,"/api/productions",make,true).await;
    assert_eq!(made,StatusCode::OK,"{production:?}");
    assert_eq!(production["projectId"],"brand-one");
    assert_eq!(production["sessionId"],id);
    let production_id=production["id"].as_str().unwrap();
    let (listed,output)=call(&router,Method::GET,"/api/productions?projectId=brand-one",json!({}),false).await;
    assert_eq!(listed,StatusCode::OK);
    assert_eq!(output["productions"].as_array().unwrap().len(),1);
    assert_eq!(call(&router,Method::GET,"/api/productions",json!({}),false).await.1["productions"]
        .as_array().unwrap().len(),1);
    assert_eq!(call(&router,Method::GET,&format!("/api/productions/{production_id}"),json!({}),false).await.0,StatusCode::OK);
    assert_eq!(conn.query_row("SELECT COUNT(*) FROM discovery_projects",[],|r|r.get::<_,i64>(0)).unwrap(),2);
}


#[tokio::test]
async fn missing_market_backfill_endpoint_requires_local_header_and_is_idempotent() {
    use contentgen_server::research::{
        discovery_projects::{self, ProjectSnapshot},
        discovery_store::{self, CandidateDraft},
        graph_store::{self, SourceDraft},
        sessions_store,
    };

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("backfill.sqlite");
    let mut conn = db::open(&path).unwrap();
    db::migrate(&mut conn).unwrap();
    discovery_projects::sync_project(&mut conn, &ProjectSnapshot {
        id: "brand-one".into(), name: "House Costs".into(), notes: "Housing".into(),
        updated_at: 1, content: vec![],
    }, 1).unwrap();
    let session = sessions_store::create_session(
        &conn, "brand-one", "Historical ideas", &["youtube".into()],
        &json!({"version":1}), 2,
    ).unwrap();
    let source = graph_store::import_source(&conn, "brand-one", SourceDraft {
        url: "https://example.org/house-costs".into(),
        title: "House costs".into(), provider: "captured-web".into(),
        published_at: None, observed_at: 2,
        passage: Some("Home ownership has maintenance expenses".into()),
    }).unwrap();
    let run = discovery_store::start_or_get_active_for_session(
        &mut conn, "brand-one", &session.id, "revision", 3,
    ).unwrap();
    discovery_store::finish_run(&mut conn, &run.id, vec![CandidateDraft {
        title: "Hidden expenses of home ownership".into(),
        hook: "Why does it cost more?".into(), premise: "Cost analysis".into(),
        why_now: "Household expenses".into(), angle_key: "hidden-expenses".into(),
        source_ids: vec![source], confidence: "medium".into(),
    }], "completed", 4).unwrap();
    // Simulate a session that finished before the market-enrichment worker existed.
    conn.execute("UPDATE discovery_runs SET status='completed',stage='completed'
                  WHERE id=?1", [&run.id]).unwrap();

    let router = build_router(AppState::new(path));
    let endpoint = format!("/api/research/discovery/projects/brand-one/sessions/{}/market/backfill", session.id);
    assert_eq!(call(&router, Method::POST, &endpoint, json!({}), false).await.0,
        StatusCode::FORBIDDEN);
    let foreign = endpoint.replace("/brand-one/", "/brand-two/");
    assert_eq!(call(&router, Method::POST, &foreign, json!({}), true).await.0,
        StatusCode::NOT_FOUND);
    let (code, body) = call(&router, Method::POST, &endpoint, json!({}), true).await;
    assert_eq!(code, StatusCode::ACCEPTED, "{body:?}");
    assert_eq!(body["state"], "queued");
    assert_eq!(body["queuedRunIds"][0], run.id);
    let (code, again) = call(&router, Method::POST, &endpoint, json!({}), true).await;
    assert_eq!(code, StatusCode::ACCEPTED);
    assert!(again["queuedRunIds"].as_array().unwrap().is_empty(),
        "repeated request must not queue another provider job");
}
