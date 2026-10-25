use contentgen_server::{
    db,
    research::{
        discovery_projects::{self, ProjectContentSnapshot, ProjectSnapshot},
        discovery_store, graph_store, sessions_store,
    },
};

fn ready() -> rusqlite::Connection {
    let mut db = db::open_in_memory().unwrap();
    db::migrate(&mut db).unwrap();
    discovery_projects::sync_project(
        &mut db,
        &ProjectSnapshot {
            id: "proj-houses".into(),
            name: "House Math".into(),
            notes: "Economic decisions for homeowners".into(),
            updated_at: 1,
            content: vec![ProjectContentSnapshot {
                id: "item-1".into(),
                name: "Why Replacing a Roof Costs So Much".into(),
                notes: "Roof cost breakdown".into(),
                kind: "video".into(),
                stage: "published".into(),
                created_at: "2026-10-10".into(),
            }],
        },
        100,
    )
    .unwrap();
    db
}

#[test]
fn named_discovery_waits_for_market_observations_before_becoming_ready() {
    let mut db = ready();
    let session = sessions_store::create_session(
        &db, "proj-houses", "October videos", &["youtube".into()],
        &serde_json::json!({"version":1}), 100,
    ).unwrap();
    let source = graph_store::import_source(&db, "proj-houses", graph_store::SourceDraft {
        url: "https://example.org/hvac-report".into(),
        title: "HVAC replacement report".into(),
        provider: "captured-web".into(),
        published_at: None,
        observed_at: 100,
        passage: Some("Furnace replacement prices differ according to equipment and installation.".into()),
    }).unwrap();
    let run = discovery_store::start_or_get_active_for_session(
        &mut db, "proj-houses", &session.id, "revision-1", 101,
    ).unwrap();
    discovery_store::finish_run(&mut db, &run.id, vec![discovery_store::CandidateDraft {
        title: "Why Replacing HVAC Equipment Gets Expensive".into(),
        hook: "What makes installation cost so much?".into(),
        premise: "Equipment and installation drive prices".into(),
        why_now: "Homeowners face replacement decisions".into(),
        angle_key: "hvac-installation-expense".into(),
        source_ids: vec![source], confidence: "medium".into(),
    }], "completed", 102).unwrap();
    let awaiting = discovery_store::get_run(&db, "proj-houses", &run.id).unwrap();
    assert_eq!(awaiting.status, "running", "Discovery must not auto-open unfinished scores");
    assert_eq!(awaiting.stage, "measure_market");
    assert_eq!(awaiting.candidates.len(), 1, "ideas must already be durably saved");
    let claimed = discovery_store::claim_pending_market_run(&mut db, 103).unwrap();
    assert_eq!(claimed.as_deref(), Some(run.id.as_str()));
    assert!(discovery_store::claim_pending_market_run(&mut db, 104).unwrap().is_none());
    assert!(discovery_store::fail_run(&db,"proj-houses",&run.id,"stage_failed",104).is_err(),
        "Late candidate-generator failures cannot invalidate persisted market collection");
    assert_eq!(discovery_store::get_run(&db,"proj-houses",&run.id).unwrap().status,"running");
    let summary = serde_json::json!({"youtube":"unavailable","googleTrends":"unavailable"});
    assert!(discovery_store::finish_market_run(&db, &run.id, &summary, 105).unwrap());
    let finished = discovery_store::get_run(&db, "proj-houses", &run.id).unwrap();
    assert_eq!(finished.status, "completed");
    assert_eq!(finished.stage, "completed");
    assert_eq!(finished.provider_health["market"], summary);
    assert!(!discovery_store::finish_market_run(&db, &run.id, &summary, 106).unwrap());
}

#[test]
fn interrupted_market_phase_can_be_recovered_without_recreating_candidates() {
    let mut db = ready();
    let session = sessions_store::create_session(&db, "proj-houses", "Recovery",
        &["youtube".into()], &serde_json::json!({"version":1}), 100).unwrap();
    let source = graph_store::import_source(&db, "proj-houses", graph_store::SourceDraft {
        url: "https://example.org/recovery".into(), title: "Insulation report".into(),
        provider: "captured-web".into(), published_at: None, observed_at: 100,
        passage: Some("Heat loss through insulation".into()),
    }).unwrap();
    let run = discovery_store::start_or_get_active_for_session(&mut db,"proj-houses",
        &session.id,"revision",101).unwrap();
    discovery_store::finish_run(&mut db,&run.id,vec![discovery_store::CandidateDraft {
        title: "Why Insulation Costs More Than Expected".into(), hook:"Cost".into(),
        premise:"Energy costs".into(), why_now:"Winter".into(), angle_key:"insulation-cost".into(),
        source_ids:vec![source], confidence:"medium".into(),
    }],"completed",102).unwrap();
    discovery_store::claim_pending_market_run(&mut db,103).unwrap();
    discovery_store::recover_interrupted_market_runs(&db,104).unwrap();
    assert_eq!(discovery_store::get_run(&db,"proj-houses",&run.id).unwrap().stage,"measure_market");
    discovery_store::pause_run(&db,"proj-houses",&run.id,105).unwrap();
    let resumed=discovery_store::get_run(&db,"proj-houses",&run.id).unwrap();
    assert_eq!(resumed.stage,"measure_market", "Node orphan pause is a no-op for Rust market work");
    assert_eq!(resumed.status,"running");
    assert_eq!(resumed.candidates.len(),1);
    assert_eq!(discovery_store::claim_pending_market_run(&mut db,107).unwrap(),Some(run.id.clone()));
    discovery_store::checkpoint(&db,"proj-houses",&run.id,"dedupe_rank",108,None).unwrap();
    assert_eq!(discovery_store::get_run(&db,"proj-houses",&run.id).unwrap().stage,
        "measure_market_collecting", "late Node checkpoints cannot restart completed candidate generation");
    discovery_store::cancel_run(&db,"proj-houses",&run.id,109).unwrap();
    assert!(!discovery_store::finish_market_run(&db,&run.id,&serde_json::json!({}),110).unwrap());
    assert_eq!(discovery_store::get_run(&db,"proj-houses",&run.id).unwrap().status,"cancelled");
}

#[test]
fn discovery_runs_deduplicate_active_clicks_and_preserve_history() {
    let mut db = ready();
    let first =
        discovery_store::start_or_get_active(&mut db, "proj-houses", "input-a", 100).unwrap();
    let repeated =
        discovery_store::start_or_get_active(&mut db, "proj-houses", "input-a", 101).unwrap();
    assert_eq!(first.id, repeated.id);
    discovery_store::finish_run(&mut db, &first.id, vec![], "insufficient_evidence", 102).unwrap();
    let next =
        discovery_store::start_or_get_active(&mut db, "proj-houses", "input-a", 103).unwrap();
    assert_ne!(first.id, next.id);
    assert_eq!(
        discovery_store::list_runs(&db, "proj-houses")
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn selected_ideas_snapshot_each_distinct_captured_source_once() {
    let mut db = ready();
    let mut sources = Vec::new();
    for suffix in ["risk", "rebuilding"] {
        sources.push(graph_store::import_source(
            &db,
            "proj-houses",
            graph_store::SourceDraft {
                url: format!("https://example.org/insurance/{suffix}"),
                title: format!("Insurance {suffix} information"),
                provider: "captured-web".into(),
                published_at: None,
                observed_at: 100,
                passage: Some(format!("The {suffix} factor influences insurance decisions.")),
            },
        ).unwrap());
    }
    let run = discovery_store::start_or_get_active(&mut db, "proj-houses", "source-snapshots", 100).unwrap();
    discovery_store::finish_run(&mut db, &run.id, vec![discovery_store::CandidateDraft {
        title: "Why Home Insurance Renewals Change".into(),
        hook: "What changed since last year?".into(),
        premise: "Compare risks and rebuilding costs".into(),
        why_now: "Homeowner education".into(),
        angle_key: "insurance renewal and reconstruction changes".into(),
        source_ids: vec![sources[0].clone(), sources[0].clone(), sources[1].clone()],
        confidence: "high".into(),
    }], "completed", 101).unwrap();
    let ideas = discovery_store::get_run(&db, "proj-houses", &run.id).unwrap().candidates;
    assert_eq!(ideas.len(), 1);
    let distinct: i64 = db.query_row(
        "SELECT COUNT(DISTINCT source_id) FROM discovery_candidate_sources WHERE candidate_id=?1",
        [&ideas[0].id], |row| row.get(0),
    ).unwrap();
    let rows: i64 = db.query_row(
        "SELECT COUNT(*) FROM discovery_candidate_sources WHERE candidate_id=?1",
        [&ideas[0].id], |row| row.get(0),
    ).unwrap();
    assert_eq!(distinct, 2);
    assert_eq!(rows, 2, "Repeated citations must not create repeated frozen source records");
}

#[test]
fn discovery_run_freezes_server_inputs_even_after_project_and_keyword_edits() {
    let mut db = ready();
    discovery_projects::patch_keywords(
        &mut db,
        "proj-houses",
        discovery_projects::KeywordPatch {
            add: vec![discovery_projects::KeywordDraft {
                text: "home insurance premiums".into(),
                kind: "query".into(),
                origin: "manual".into(),
            }],
            ..Default::default()
        },
        101,
    )
    .unwrap();
    let initial =
        discovery_store::start_or_get_active(&mut db, "proj-houses", "rev-1", 102).unwrap();
    assert_eq!(initial.input_snapshot["version"], 1);
    assert_eq!(initial.input_snapshot["projectName"], "House Math");
    assert_eq!(
        initial.input_snapshot["content"][0]["name"],
        "Why Replacing a Roof Costs So Much"
    );
    assert_eq!(
        initial.input_snapshot["keywords"][0]["text"],
        "home insurance premiums"
    );
    assert!(initial.input_snapshot["graphRevision"].is_number());

    discovery_projects::sync_project(
        &mut db,
        &ProjectSnapshot {
            id: "proj-houses".into(),
            name: "Changed Brand".into(),
            notes: "Unrelated content".into(),
            updated_at: 2,
            content: vec![],
        },
        103,
    )
    .unwrap();
    discovery_projects::patch_keywords(
        &mut db,
        "proj-houses",
        discovery_projects::KeywordPatch {
            add: vec![discovery_projects::KeywordDraft {
                text: "random generic math".into(),
                kind: "query".into(),
                origin: "manual".into(),
            }],
            ..Default::default()
        },
        104,
    )
    .unwrap();
    let resumed = discovery_store::get_run(&db, "proj-houses", &initial.id).unwrap();
    assert_eq!(resumed.input_snapshot, initial.input_snapshot);
    assert_eq!(
        resumed.input_snapshot["keywords"].as_array().unwrap().len(),
        1
    );
}

#[test]
fn stage_artifacts_are_project_scoped_first_write_wins_and_survive_resume() {
    let mut db = ready();
    let run = discovery_store::start_or_get_active(&mut db, "proj-houses", "rev", 100).unwrap();
    let artifact = serde_json::json!({"query":"home insurance premiums","sourceCount":2});
    assert_eq!(
        discovery_store::save_stage_artifact(
            &db,
            "proj-houses",
            &run.id,
            "source-query:0",
            &artifact,
            101
        )
        .unwrap(),
        artifact
    );
    assert_eq!(
        discovery_store::save_stage_artifact(
            &db,
            "proj-houses",
            &run.id,
            "source-query:0",
            &serde_json::json!({"sourceCount":999}),
            102
        )
        .unwrap(),
        artifact
    );
    discovery_store::pause_run(&db, "proj-houses", &run.id, 103).unwrap();
    discovery_store::resume_run(&db, "proj-houses", &run.id, 104).unwrap();
    assert_eq!(
        discovery_store::load_stage_artifact(&db, "proj-houses", &run.id, "source-query:0")
            .unwrap(),
        Some(artifact)
    );
    assert!(
        discovery_store::load_stage_artifact(&db, "other-project", &run.id, "source-query:0")
            .is_err()
    );
    discovery_store::finish_run(&mut db, &run.id, vec![], "insufficient_evidence", 105).unwrap();
    assert!(
        discovery_store::save_stage_artifact(
            &db,
            "proj-houses",
            &run.id,
            "candidate-pool",
            &serde_json::json!([]),
            106
        )
        .is_err()
    );
    assert!(
        discovery_store::save_stage_artifact(
            &db,
            "proj-houses",
            &run.id,
            "../../unsafe",
            &serde_json::json!({}),
            106
        )
        .is_err()
    );
}

#[test]
fn already_made_and_dismissed_angles_are_filtered_by_substance() {
    let mut db = ready();
    let source = graph_store::import_source(
        &db,
        "proj-houses",
        graph_store::SourceDraft {
            url: "https://example.org/heat-pump-cost".into(),
            title: "Heat pump cost overview".into(),
            provider: "captured-web".into(),
            published_at: None,
            observed_at: 100,
            passage: Some(
                "Heat pump installation has an upfront equipment expense and labor expense.".into(),
            ),
        },
    )
    .unwrap();
    assert!(
        discovery_store::is_duplicate(
            &db,
            "proj-houses",
            "The Expensive Cost of Roof Replacement",
            "roof replacement cost breakdown"
        )
        .unwrap()
    );
    let run =
        discovery_store::start_or_get_active(&mut db, "proj-houses", "revision", 100).unwrap();
    discovery_store::finish_run(
        &mut db,
        &run.id,
        vec![discovery_store::CandidateDraft {
            title: "Why Heat Pumps Cost More Upfront".into(),
            hook: "Is the efficiency worth the installation?".into(),
            premise: "Initial equipment and labor costs".into(),
            why_now: "Evergreen household decision".into(),
            angle_key: "heat pump upfront installation expenses".into(),
            source_ids: vec![source],
            confidence: "low".into(),
        }],
        "completed",
        101,
    )
    .unwrap();
    let candidates = discovery_store::get_run(&db, "proj-houses", &run.id)
        .unwrap()
        .candidates;
    discovery_store::decide(
        &db,
        "proj-houses",
        &candidates[0].id,
        "dismissed",
        Some("covered already"),
        102,
    )
    .unwrap();
    assert!(
        discovery_store::is_duplicate(
            &db,
            "proj-houses",
            "The Price of Installing a Heat Pump",
            "heat pump upfront installation expenses"
        )
        .unwrap()
    );
}

#[test]
fn approved_graph_topic_aliases_prevent_repackaging_existing_videos() {
    let db = ready();
    let insurance =
        graph_store::upsert_node(&db, "proj-houses", "topic", "Home insurance", 100).unwrap();
    graph_store::add_alias(&db, "proj-houses", &insurance, "Homeowners coverage").unwrap();
    db.execute("INSERT INTO discovery_project_content (id,project_id,name,notes,kind,stage,created_at,active,last_seen_at)
        VALUES ('already-covered','proj-houses','Why Home Insurance Premiums Rise','','video','published','2026-10-20',1,100)",[]).unwrap();
    assert!(
        discovery_store::is_duplicate(
            &db,
            "proj-houses",
            "How Homeowners Coverage Rates Increase",
            "homeowners coverage premium drivers"
        )
        .unwrap()
    );
    assert!(
        !discovery_store::is_duplicate(
            &db,
            "proj-houses",
            "How Solar Panel Efficiency Works",
            "solar panel energy production"
        )
        .unwrap()
    );
    graph_store::remove_alias(&db, "proj-houses", &insurance, "Homeowners coverage").unwrap();
    assert!(
        !discovery_store::is_duplicate(
            &db,
            "proj-houses",
            "How Homeowners Coverage Rates Increase",
            "homeowners coverage premium drivers"
        )
        .unwrap()
    );
}

#[test]
fn five_suggestions_cover_multiple_existing_topic_families_before_repeating_one() {
    let mut db = ready();
    let source=graph_store::import_source(&db,"proj-houses",graph_store::SourceDraft {
        url:"https://example.org/coverage-review".into(),title:"Insurance and repair reference".into(),
        provider:"captured-web".into(),published_at:None,observed_at:100,
        passage:Some("Home insurance coverage, repair labor and roof maintenance are distinct homeowner expense decisions.".into()),
    }).unwrap();
    for label in ["Home insurance", "Roof repair"] {
        graph_store::upsert_node(&db, "proj-houses", "topic", label, 100).unwrap();
    }
    let titles = [
        (
            "Why Home Insurance Claims Take Months",
            "insurance claims settlement timeline",
        ),
        (
            "How Home Insurance Deductibles Work",
            "insurance deductible calculation guide",
        ),
        (
            "Will Home Insurance Cover Water Damage",
            "insurance damage exclusions explained",
        ),
        (
            "Home Insurance Policy Renewal Explained",
            "insurance annual renewal process",
        ),
        (
            "Home Insurance Cancellation Reasons Explained",
            "insurance cancellation underwriting process",
        ),
        (
            "How Roof Repair Labor Is Priced",
            "roof contractor labor estimates",
        ),
    ];
    let drafts = titles
        .iter()
        .enumerate()
        .map(|(index, (title, angle))| discovery_store::CandidateDraft {
            title: (*title).into(),
            hook: "Understand where your household expenses go".into(),
            premise: "Clear comparison of actual household cost mechanisms".into(),
            why_now: "Evergreen educational question".into(),
            angle_key: (*angle).into(),
            source_ids: vec![source.clone()],
            confidence: if index == 5 { "low" } else { "high" }.into(),
        })
        .collect();
    let run = discovery_store::start_or_get_active(&mut db, "proj-houses", "diversity-test", 100)
        .unwrap();
    discovery_store::finish_run(&mut db, &run.id, drafts, "completed", 101).unwrap();
    let ideas = discovery_store::get_run(&db, "proj-houses", &run.id)
        .unwrap()
        .candidates;
    assert_eq!(ideas.len(), 5);
    assert!(
        ideas
            .iter()
            .any(|idea| idea.title == "How Roof Repair Labor Is Priced"),
        "A distinct topic family should not be crowded out by five insurance angles"
    );
}

#[test]
fn search_leads_cannot_back_a_completed_discovery_idea_even_if_the_ids_exist() {
    let mut db = ready();
    let lead = graph_store::import_source(
        &db,
        "proj-houses",
        graph_store::SourceDraft {
            url: "https://example.org/roof-news".into(),
            title: "Search preview with no checked passage".into(),
            provider: "searxng".into(),
            published_at: None,
            observed_at: 100,
            passage: None,
        },
    )
    .unwrap();
    let run =
        discovery_store::start_or_get_active(&mut db, "proj-houses", "revision", 100).unwrap();
    let result = discovery_store::finish_run(
        &mut db,
        &run.id,
        vec![discovery_store::CandidateDraft {
            title: "Unexpected Insurance Changes".into(),
            hook: "What is changing for homeowners?".into(),
            premise: "Compare premium increases and policy coverage".into(),
            why_now: "Interesting search result".into(),
            angle_key: "insurance premium differences".into(),
            source_ids: vec![lead],
            confidence: "high".into(),
        }],
        "completed",
        101,
    );
    assert!(
        result.is_err(),
        "The server must independently reject unverified search leads"
    );
    assert!(
        discovery_store::get_run(&db, "proj-houses", &run.id)
            .unwrap()
            .candidates
            .is_empty()
    );
}

#[test]
fn dated_measured_youtube_observations_are_allowed_without_full_transcript() {
    let mut db = ready();
    let source = graph_store::import_source(
        &db,
        "proj-houses",
        graph_store::SourceDraft {
            url: "https://www.youtube.com/watch?v=validvid123".into(),
            title: "Heat pump efficiency comparison".into(),
            provider: "youtube-data-api".into(),
            published_at: Some("2026-10-20".into()),
            observed_at: 100,
            passage: None,
        },
    )
    .unwrap();
    let topic =
        graph_store::upsert_node(&db, "proj-houses", "topic", "Heat pump efficiency", 100).unwrap();
    db.execute("INSERT INTO kg_trend_observations(id,project_id,node_id,source_id,provider,metric,value,unit,collected_at)
        VALUES ('measured-1','proj-houses',?1,?2,'youtube-data-api','views',1000,'count',100)",
        rusqlite::params![topic,source]).unwrap();
    let run =
        discovery_store::start_or_get_active(&mut db, "proj-houses", "revision", 100).unwrap();
    discovery_store::finish_run(
        &mut db,
        &run.id,
        vec![discovery_store::CandidateDraft {
            title: "Heat Pump Efficiency Questions".into(),
            hook: "What makes the real-world difference?".into(),
            premise: "Explain the efficiency tradeoffs for household budgets".into(),
            why_now: "Measured public video discussion".into(),
            angle_key: "heat pump running efficiency comparison".into(),
            source_ids: vec![source],
            confidence: "medium".into(),
        }],
        "completed",
        101,
    )
    .unwrap();
    assert_eq!(
        discovery_store::get_run(&db, "proj-houses", &run.id)
            .unwrap()
            .candidates
            .len(),
        1
    );
}

#[test]
fn a_run_cannot_persist_an_uncited_idea_as_completed() {
    let mut db = ready();
    let run =
        discovery_store::start_or_get_active(&mut db, "proj-houses", "revision", 100).unwrap();
    discovery_store::finish_run(
        &mut db,
        &run.id,
        vec![discovery_store::CandidateDraft {
            title: "A new claim without a source".into(),
            hook: "An unsupported hook".into(),
            premise: "An unsupported premise".into(),
            why_now: "No evidence".into(),
            angle_key: "unsupported new issue".into(),
            source_ids: vec![],
            confidence: "high".into(),
        }],
        "completed",
        101,
    )
    .unwrap();
    let saved = discovery_store::get_run(&db, "proj-houses", &run.id).unwrap();
    assert_eq!(saved.status, "insufficient_evidence");
    assert!(saved.candidates.is_empty());
}

#[test]
fn cancelling_an_active_discovery_is_terminal_and_releases_the_project_slot() {
    let mut db = ready();
    let run =
        discovery_store::start_or_get_active(&mut db, "proj-houses", "revision", 100).unwrap();
    discovery_store::cancel_run(&db, "proj-houses", &run.id, 101).unwrap();
    let cancelled = discovery_store::get_run(&db, "proj-houses", &run.id).unwrap();
    assert_eq!(cancelled.status, "cancelled");
    assert!(
        discovery_store::checkpoint(&db, "proj-houses", &run.id, "analyze_signals", 102, None)
            .is_err()
    );
    assert!(discovery_store::finish_run(&mut db, &run.id, vec![], "completed", 103).is_err());
    let new_run =
        discovery_store::start_or_get_active(&mut db, "proj-houses", "new-revision", 104).unwrap();
    assert_ne!(new_run.id, run.id);
}

