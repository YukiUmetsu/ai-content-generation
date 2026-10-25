use contentgen_server::{
    db,
    research::{
        discovery_projects::{self, ProjectSnapshot},
        discovery_store::{self, CandidateDraft},
        idea_trends::{self, TrendPoint},
        sessions_store,
    },
};

fn seeded() -> (rusqlite::Connection, String) {
    let mut db = db::open_in_memory().unwrap();
    db::migrate(&mut db).unwrap();
    discovery_projects::sync_project(
        &mut db,
        &ProjectSnapshot {
            id: "brand".into(),
            name: "House costs".into(),
            notes: "".into(),
            updated_at: 1,
            content: vec![],
        },
        100,
    )
    .unwrap();
    let session = sessions_store::create_session(
        &db,
        "brand",
        "Ideas",
        &["youtube".into()],
        &serde_json::json!({"version":1}),
        101,
    )
    .unwrap();
    let run = sessions_store::start_or_get_active(&mut db, "brand", &session.id, "revision", 102)
        .unwrap();
    db.execute("INSERT INTO kg_sources(id,project_id,provider,url,title,observed_at,passage,evidence_state)
        VALUES('source','brand','searxng','https://example.com','Title',100,'Captured source','captured')",[]).unwrap();
    sessions_store::finish_session_run(
        &mut db,
        "brand",
        &session.id,
        &run.id,
        vec![CandidateDraft {
            title: "Why roof repair is expensive".into(),
            hook: "Why?".into(),
            premise: "Explain repair".into(),
            why_now: "Repair budgets".into(),
            angle_key: "roof repair".into(),
            confidence: "medium".into(),
            source_ids: vec!["source".into()],
        }],
        "completed",
        103,
    )
    .unwrap();
    let idea_id = discovery_store::get_run(&db, "brand", &run.id)
        .unwrap()
        .candidates[0]
        .id
        .clone();
    (db, idea_id)
}

#[test]
fn persists_relative_google_search_interest_and_100_percent_momentum() {
    let (mut db, idea) = seeded();
    let now = 1_792_886_400;
    let run = idea_trends::claim_assessment(&mut db, &idea, "roof repair cost", now).unwrap();
    let points = (0..26)
        .map(|index| TrendPoint {
            timestamp: 1_700_000_000 + index * 7 * 86_400,
            value: if index < 13 { 10 } else { 20 },
        })
        .collect::<Vec<_>>();
    idea_trends::complete_assessment(&db, &run.id, &points, now + 1).unwrap();
    let observed = idea_trends::latest_assessment(&db, &idea, now + 1)
        .unwrap()
        .unwrap();
    assert_eq!(observed.state, "succeeded");
    assert_eq!(observed.query, "roof repair cost");
    assert_eq!(observed.region, "US");
    assert_eq!(observed.points, 26);
    assert_eq!(observed.previous_mean, Some(10.0));
    assert_eq!(observed.recent_mean, Some(20.0));
    assert_eq!(observed.change_percent, Some(100.0));
    assert_eq!(observed.error_code, None);
    let payload = serde_json::to_value(observed).unwrap();
    assert_eq!(payload["changePercent"], 100.0);
    assert_eq!(payload["metricVersion"], "google-trends-momentum-v1");
    let recorded: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM idea_trends_points WHERE run_id=?1",
            [&run.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        recorded, 26,
        "the raw normalized series must remain auditable"
    );
}

#[test]
fn tracks_provider_failure_without_fabricating_data_or_recollecting_immediately() {
    let (mut db, idea) = seeded();
    let now = 1_792_886_400;
    assert!(idea_trends::claim_assessment(&mut db, "nonexistent", "repair costs", now).is_err());
    let run = idea_trends::claim_assessment(&mut db, &idea, "repair costs", now).unwrap();
    assert!(idea_trends::claim_assessment(&mut db, &idea, "repair costs", now).is_err());
    idea_trends::fail_assessment(&db, &run.id, "rate_limited", now + 1).unwrap();
    let observed = idea_trends::latest_assessment(&db, &idea, now + 1)
        .unwrap()
        .unwrap();
    assert_eq!(observed.state, "failed");
    assert_eq!(observed.error_code.as_deref(), Some("rate_limited"));
    assert_eq!(observed.points, 0);
    assert_eq!(observed.change_percent, None);
    assert!(
        idea_trends::claim_assessment(&mut db, &idea, "repair costs", now + 2).is_err(),
        "provider backoff must be persisted"
    );
}

#[test]
fn zero_previous_interest_does_not_invent_infinite_growth() {
    let (mut db, idea) = seeded();
    let now = 1_792_886_400;
    let run = idea_trends::claim_assessment(&mut db, &idea, "roof repair", now).unwrap();
    let points = (0..26)
        .map(|index| TrendPoint {
            timestamp: 1_700_000_000 + index * 7 * 86_400,
            value: if index < 13 { 0 } else { 8 },
        })
        .collect::<Vec<_>>();
    idea_trends::complete_assessment(&db, &run.id, &points, now + 1).unwrap();
    let observed = idea_trends::latest_assessment(&db, &idea, now + 1)
        .unwrap()
        .unwrap();
    assert_eq!(observed.previous_mean, Some(0.0));
    assert_eq!(observed.recent_mean, Some(8.0));
    assert_eq!(observed.change_percent, None);
}

#[test]
fn quota_skip_is_visible_but_does_not_consume_provider_budget() {
    let (mut db, idea) = seeded();
    let now = 1_792_886_400;
    idea_trends::record_unavailable_assessment(
        &mut db,
        &idea,
        "roof replacement cost",
        "budget_exhausted",
        now,
    )
    .unwrap();
    let assessment = idea_trends::latest_assessment(&db, &idea, now)
        .unwrap()
        .unwrap();
    assert_eq!(assessment.state, "unavailable");
    assert_eq!(assessment.error_code.as_deref(), Some("budget_exhausted"));
    assert_eq!(assessment.observed_at, None);
    assert_eq!(assessment.change_percent, None);
    let used: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM idea_trends_runs WHERE state != 'unavailable'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(used, 0);
}

#[test]
fn restart_turns_running_trend_observation_into_explicit_interrupted_failure() {
    let (mut db, idea) = seeded();
    let now = 1_792_886_400;
    idea_trends::claim_assessment(&mut db, &idea, "roof replacement cost", now).unwrap();
    assert_eq!(idea_trends::reconcile_interrupted(&db, now + 1).unwrap(), 1);
    let assessment = idea_trends::latest_assessment(&db, &idea, now + 1)
        .unwrap()
        .unwrap();
    assert_eq!(assessment.state, "failed");
    assert_eq!(assessment.error_code.as_deref(), Some("interrupted"));
}
