use contentgen_server::{
    db,
    research::{
        discovery_projects::{self, ProjectSnapshot},
        discovery_store::{self, CandidateDraft},
        idea_market,
        market_store::VideoObservation,
        sessions_store,
    },
};

fn seeded() -> (rusqlite::Connection, String, String) {
    let mut db = db::open_in_memory().unwrap();
    db::migrate(&mut db).unwrap();
    discovery_projects::sync_project(
        &mut db,
        &ProjectSnapshot {
            id: "brand".into(),
            name: "Home ownership".into(),
            notes: "Repair costs".into(),
            updated_at: 1,
            content: vec![],
        },
        100,
    )
    .unwrap();
    let session = sessions_store::create_session(
        &db,
        "brand",
        "October ideas",
        &["youtube".into()],
        &serde_json::json!({"version":1}),
        101,
    )
    .unwrap();
    let run =
        sessions_store::start_or_get_active(&mut db, "brand", &session.id, "r1", 102).unwrap();
    db.execute("INSERT INTO kg_sources(id,project_id,provider,url,title,observed_at,passage,evidence_state)
        VALUES('source','brand','searxng','https://example.com/article','Article',100,'A dated captured source','captured')",[]).unwrap();
    sessions_store::finish_session_run(
        &mut db,
        "brand",
        &session.id,
        &run.id,
        vec![CandidateDraft {
            title: "Why roof repair costs so much".into(),
            hook: "Why?".into(),
            premise: "Explain roof repair".into(),
            why_now: "Recent costs".into(),
            angle_key: "roof-cost".into(),
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
    (db, session.id, idea_id)
}

fn video(n: usize, title: &str, duration: i64) -> VideoObservation {
    VideoObservation {
        video_id: format!("video{:06}", n),
        title: title.into(),
        channel_id: format!("channel-{}", n % 4),
        channel_title: format!("Channel {}", n % 4),
        published_at: "2026-10-01T00:00:00Z".into(),
        duration_seconds: Some(duration),
        view_count: Some(1_000 * (n as i64 + 1)),
        like_count: Some(5),
        comment_count: Some(2),
        subscriber_count: None,
    }
}

#[test]
fn numeric_sample_keeps_source_and_coverage_without_changing_v1() {
    let (mut db, session, idea) = seeded();
    let now = 1_792_886_400;
    assert!(
        idea_market::claim_assessment(
            &mut db,
            "brand",
            "wrong-session",
            &idea,
            "roof repair",
            "long",
            now
        )
        .is_err()
    );
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM market_search_budget", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    let run = idea_market::claim_assessment(
        &mut db,
        "brand",
        &session,
        &idea,
        "roof repair",
        "long",
        now,
    )
    .unwrap();
    let mut videos: Vec<_> = (0..12)
        .map(|n| video(n, "Roof repair costs explained", 420))
        .collect();
    videos.push(video(12, "Random cooking tutorial", 400));
    videos.push(video(13, "Roof repair shorts", 45));
    idea_market::complete_assessment(&db, &run.id, &videos, now + 5).unwrap();
    let assessment = idea_market::latest_assessment(&db, &idea, now + 6)
        .unwrap()
        .unwrap();
    assert_eq!(assessment.state, "succeeded");
    assert_eq!(assessment.searched_videos, 14);
    assert_eq!(assessment.sample_size, 12);
    assert_eq!(assessment.distinct_channels, 4);
    assert_eq!(assessment.median_views, Some(6_500.0));
    assert_eq!(assessment.p75_views, Some(9_250.0));
    assert!(assessment.median_views_per_day.unwrap() > 0.0);
    assert_eq!(
        assessment.comparison_score, None,
        "one idea is not a market cohort"
    );
    assert_eq!(
        sessions_store::list_ideas(&db, "brand", &session).unwrap()[0].opportunity_score,
        Some(50.0)
    );
    assert_eq!(
        sessions_store::list_ideas(&db, "brand", &session).unwrap()[0]
            .market_assessment
            .as_ref()
            .unwrap()
            .sample_size,
        12
    );
    assert_eq!(
        idea_market::latest_assessment(&db, &idea, now + 31 * 86400)
            .unwrap()
            .unwrap()
            .state,
        "expired"
    );
}

#[test]
fn insufficient_samples_are_unknown_and_new_runs_are_explicitly_rate_limited() {
    let (mut db, session, idea) = seeded();
    let now = 1_792_886_400;
    let run = idea_market::claim_assessment(
        &mut db,
        "brand",
        &session,
        &idea,
        "roof repair",
        "shorts",
        now,
    )
    .unwrap();
    assert!(
        idea_market::claim_assessment(
            &mut db,
            "brand",
            &session,
            &idea,
            "roof repair",
            "shorts",
            now
        )
        .is_err()
    );
    idea_market::complete_assessment(
        &db,
        &run.id,
        &[
            video(0, "Roof repair tips", 50),
            video(1, "Roof repair tips", 55),
            video(2, "Roof repair tips", 60),
        ],
        now + 1,
    )
    .unwrap();
    let snapshot = idea_market::latest_assessment(&db, &idea, now + 2)
        .unwrap()
        .unwrap();
    assert_eq!(snapshot.sample_size, 3);
    assert_eq!(snapshot.comparison_score, None);
    assert!(
        idea_market::claim_assessment(
            &mut db,
            "brand",
            &session,
            &idea,
            "roof repair",
            "shorts",
            now + 120
        )
        .is_err()
    );
    assert!(
        idea_market::claim_assessment(
            &mut db,
            "brand",
            &session,
            &idea,
            "roof repair",
            "shorts",
            now + 3600
        )
        .is_ok()
    );
}

#[test]
fn quota_is_shared_with_existing_watchlists_and_does_not_reserve_on_rejection() {
    let (mut db, session, idea) = seeded();
    let now = 1_792_886_400;
    for number in 0..20 {
        db.execute(
            "INSERT INTO market_search_budget(run_id,reserved_at) VALUES(?1,?2)",
            rusqlite::params![format!("watchlist-{number}"), now],
        )
        .unwrap();
    }
    assert!(matches!(
        idea_market::claim_assessment(
            &mut db,
            "brand",
            &session,
            &idea,
            "roof repair",
            "long",
            now
        ),
        Err(idea_market::IdeaMarketError::Budget)
    ));
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM idea_market_runs", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM market_search_budget", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        20
    );
    assert!(
        idea_market::claim_assessment(
            &mut db,
            "brand",
            &session,
            &idea,
            "roof repair",
            "long",
            now + 86_401
        )
        .is_ok()
    );
}

#[test]
fn channel_dominance_missing_counts_and_bad_dates_cannot_fabricate_a_market_score() {
    let (mut db, session, idea) = seeded();
    let now = 1_792_886_400;
    let run = idea_market::claim_assessment(
        &mut db,
        "brand",
        &session,
        &idea,
        "roof repair",
        "long",
        now,
    )
    .unwrap();
    let mut many: Vec<_> = (0..12).map(|n| video(n, "Roof repair tips", 400)).collect();
    for item in &mut many {
        item.channel_id = "same-channel".into();
    }
    many[0].view_count = None;
    many[1].published_at = "not-a-date".into();
    idea_market::complete_assessment(&db, &run.id, &many, now + 1).unwrap();
    let snapshot = idea_market::latest_assessment(&db, &idea, now + 2)
        .unwrap()
        .unwrap();
    assert_eq!(snapshot.sample_size, 3);
    assert_eq!(snapshot.distinct_channels, 1);
    assert_eq!(snapshot.comparison_score, None);
}

#[test]
fn cohort_percentiles_require_three_comparable_ideas_and_preserve_ties() {
    fn assessment(format: &str, rate: Option<f64>) -> Option<idea_market::IdeaMarketAssessment> {
        Some(idea_market::IdeaMarketAssessment {
            run_id: "run".into(),
            state: "succeeded".into(),
            query: "roof repair".into(),
            format: format.into(),
            metric_version: "youtube-comparables-v1".into(),
            region: "US".into(),
            language: "en".into(),
            observed_at: Some(1),
            next_collection_at: 3601,
            searched_videos: 12,
            sample_size: 9,
            distinct_channels: 4,
            median_views: Some(5000.0),
            p75_views: Some(10000.0),
            median_views_per_day: rate,
            recent_uploads90d: 9,
            comparison_score: None,
            comparison_cohort_size: 0,
            error_code: None,
            videos: vec![],
        })
    }
    let mut only_two = vec![
        assessment("long", Some(100.0)),
        assessment("long", Some(200.0)),
    ];
    idea_market::assign_session_percentiles(&mut only_two);
    assert!(
        only_two
            .iter()
            .all(|x| x.as_ref().unwrap().comparison_score.is_none())
    );
    let mut mixed = vec![
        assessment("long", Some(100.0)),
        assessment("long", Some(200.0)),
        assessment("long", Some(300.0)),
        assessment("shorts", Some(999.0)),
        assessment("long", None),
    ];
    idea_market::assign_session_percentiles(&mut mixed);
    assert_eq!(
        mixed
            .iter()
            .map(|x| x.as_ref().unwrap().comparison_score)
            .collect::<Vec<_>>(),
        vec![Some(25.0), Some(50.0), Some(75.0), None, None]
    );
    let mut ties = vec![assessment("long", Some(123.0)); 3];
    idea_market::assign_session_percentiles(&mut ties);
    assert!(
        ties.iter()
            .all(|x| x.as_ref().unwrap().comparison_score == Some(50.0))
    );
}
