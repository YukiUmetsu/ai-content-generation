use contentgen_server::{
    db,
    research::{
        discovery_projects::{self, ProjectSnapshot},
        discovery_store, sessions_store,
    },
    production_store,
};

fn ready() -> rusqlite::Connection {
    let mut conn = db::open_in_memory().unwrap();
    db::migrate(&mut conn).unwrap();
    for id in ["brand-one", "brand-two"] {
        discovery_projects::sync_project(
            &mut conn,
            &ProjectSnapshot {
                id: id.into(),
                name: "Margin Atlas".into(),
                notes: "Consumer finance explainer brand".into(),
                updated_at: 1,
                content: vec![],
            },
            100,
        )
        .unwrap();
    }
    conn
}

#[test]
fn migration_preserves_legacy_run_idea_and_reuses_its_active_run() {
    let mut conn = db::open_in_memory().unwrap();
    conn.execute_batch("CREATE TABLE schema_migrations (
        version INTEGER NOT NULL PRIMARY KEY,name TEXT NOT NULL UNIQUE,
        checksum TEXT NOT NULL,applied_at TEXT NOT NULL) STRICT;").unwrap();
    for migration in db::MIGRATIONS.iter().take(9) {
        conn.execute_batch(migration.sql).unwrap();
        conn.execute("INSERT INTO schema_migrations(version,name,checksum,applied_at) VALUES(?1,?2,?3,'2026-10-24')",
            rusqlite::params![migration.version,migration.name,migration.checksum()]).unwrap();
        conn.pragma_update(None,"user_version",migration.version).unwrap();
    }
    conn.execute("INSERT INTO discovery_projects(id,name,notes,snapshot_revision,synced_at)
        VALUES('project-old','Legacy brand','Legacy projects',1,1)",[]).unwrap();
    conn.execute("INSERT INTO kg_sources(id,project_id,provider,url,title,observed_at,passage,evidence_state)
        VALUES('old-source','project-old','searxng','https://example.org/old','Saved source',1,'Captured passage','captured')",[]).unwrap();
    conn.execute("INSERT INTO discovery_runs(id,project_id,input_revision,status,stage,created_at,updated_at)
        VALUES('old-active','project-old','old','queued','queued',1,1)",[]).unwrap();
    conn.execute("INSERT INTO discovery_candidates(id,project_id,run_id,rank,title,hook,premise,why_now,angle_key,confidence,source_ids_json)
        VALUES('old-idea','project-old','old-active',1,'Old evidence-backed idea','Hook','Premise','Relevant','old-angle','medium','[\"old-source\"]')",[]).unwrap();

    let report = db::migrate(&mut conn).unwrap();
    assert_eq!(report.from_version,9);
    assert_eq!(report.to_version,10);
    assert_eq!(discovery_store::get_run(&conn,"project-old","old-active").unwrap().candidates[0].id,"old-idea");
    let same = discovery_store::start_or_get_active(&mut conn,"project-old","old",10).unwrap();
    assert_eq!(same.id,"old-active","the legacy discover route must resume pre-migration active work");
    assert_eq!(sessions_store::list_sessions(&conn,"project-old").unwrap().len(),1);
}

#[test]
fn independent_sessions_and_runs_survive_reopening() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("content.sqlite3");
    let (first_id, second_id) = {
        let mut conn = db::open(&path).unwrap();
        db::migrate(&mut conn).unwrap();
        discovery_projects::sync_project(
            &mut conn,
            &ProjectSnapshot {
                id: "brand-one".into(),
                name: "Margin Atlas".into(),
                notes: "Finance".into(),
                updated_at: 1,
                content: vec![],
            },
            100,
        )
        .unwrap();
        let a = sessions_store::create_session(
            &conn,
            "brand-one",
            "October opportunities",
            &["youtube".into(), "youtube_shorts".into(), "tiktok".into()],
            &serde_json::json!({"version":1,"market":"US"}),
            101,
        )
        .unwrap();
        let b = sessions_store::create_session(
            &conn,
            "brand-one",
            "November opportunities",
            &["instagram".into()],
            &serde_json::json!({"version":1,"market":"CA"}),
            102,
        )
        .unwrap();
        assert_ne!(a.id, b.id);
        let run_a = sessions_store::start_or_get_active(&mut conn, "brand-one", &a.id, "a", 103)
            .unwrap();
        let run_b = sessions_store::start_or_get_active(&mut conn, "brand-one", &b.id, "b", 104)
            .unwrap();
        assert_ne!(run_a.id, run_b.id);
        assert_eq!(run_a.session_id.as_deref(), Some(a.id.as_str()));
        assert_eq!(run_b.session_id.as_deref(), Some(b.id.as_str()));
        assert_eq!(run_a.input_snapshot["platforms"],serde_json::json!(["youtube","youtube_shorts","tiktok"]));
        assert_eq!(run_a.input_snapshot["sessionSettings"]["market"],"US");
        (a.id, b.id)
    };
    let conn = db::open(&path).unwrap();
    let sessions = sessions_store::list_sessions(&conn, "brand-one").unwrap();
    assert_eq!(sessions.len(), 2);
    assert_eq!(sessions[0].id, second_id);
    assert_eq!(sessions[1].id, first_id);
    assert_eq!(sessions_store::list_session_runs(&conn, "brand-one", &first_id).unwrap().len(), 1);
    assert!(sessions_store::get_session(&conn, "brand-two", &first_id).is_err());
}

#[test]
fn session_run_keeps_the_brand_context_from_session_creation() {
    let mut conn=ready();
    let session=sessions_store::create_session(&conn,"brand-one","Original brand context",
        &["youtube".into()],&serde_json::json!({"version":1,"market":"US"}),101).unwrap();
    discovery_projects::sync_project(&mut conn,&ProjectSnapshot{
        id:"brand-one".into(),name:"Unrelated rebrand".into(),notes:"Changed audience".into(),
        updated_at:2,content:vec![],
    },102).unwrap();
    let run=sessions_store::start_or_get_active(&mut conn,"brand-one",&session.id,"revision-1",103).unwrap();
    assert_eq!(run.input_snapshot["projectName"],"Margin Atlas");
    assert_eq!(run.input_snapshot["description"],"Consumer finance explainer brand");
    assert_eq!(run.input_snapshot["sessionSettings"]["project"]["revision"],1);
    assert_eq!(run.input_snapshot["ideaScoreVersion"],"evidence-readiness-v1");
}

#[test]
fn unsupported_session_snapshot_version_is_rejected() {
    let conn=ready();
    assert!(sessions_store::create_session(&conn,"brand-one","Future contract",
        &["youtube".into()],&serde_json::json!({"version":99}),101).is_err());
}

#[test]
fn a_session_can_persist_more_than_five_distinct_evidence_backed_ideas() {
    let mut conn = ready();
    let session = sessions_store::create_session(
        &conn, "brand-one", "Home costs", &["youtube".into()], &serde_json::json!({"version":1}), 100,
    ).unwrap();
    let run = sessions_store::start_or_get_active(&mut conn, "brand-one", &session.id, "first", 101).unwrap();
    let mut drafts = Vec::new();
    let subjects = [
        "roof shingle replacements", "furnace heat exchangers", "solar inverter maintenance",
        "foundation concrete repairs", "insurance premium deductibles", "property tax assessments",
        "window glazing efficiency", "water heater corrosion",
    ];
    for (number, subject) in subjects.iter().enumerate() {
        let source_id = format!("source-{number}");
        conn.execute(
            "INSERT INTO kg_sources(id,project_id,provider,url,title,observed_at,passage,evidence_state)
             VALUES (?1,'brand-one','searxng',?2,?3,100,?4,'captured')",
            rusqlite::params![source_id, format!("https://example.org/evidence/{number}"), format!("Fact about topic {number}"), format!("Captured explanatory evidence for topic {number}")],
        ).unwrap();
        drafts.push(discovery_store::CandidateDraft {
            title: format!("Why {subject} cost homeowners more than expected"),
            hook: format!("What makes {subject} unexpectedly expensive"),
            premise: format!("A source-backed investigation into {subject}"),
            why_now: "Relevant to homeowners".into(),
            angle_key: subject.replace(' ', "-"),
            source_ids: vec![source_id],
            confidence: "medium".into(),
        });
    }
    sessions_store::finish_session_run(&mut conn, "brand-one", &session.id, &run.id, drafts, "completed", 102).unwrap();
    let ideas = sessions_store::list_ideas(&conn, "brand-one", &session.id).unwrap();
    assert_eq!(ideas.len(), 8);
    assert_eq!(ideas[0].sources.len(), 1);
    assert_eq!(ideas[0].sources[0].evidence_state, "captured");
    let first_source = ideas.iter().find(|idea| idea.sources[0].id == "source-0").unwrap();
    assert_eq!(first_source.evidence.len(), 1);
    assert_eq!(first_source.evidence[0].quote, "Captured explanatory evidence for topic 0");
    assert_eq!(first_source.evidence[0].review_status, "unverified");
    assert_eq!(ideas[0].opportunity_score, Some(50.0));
    assert_eq!(ideas[0].score_version.as_deref(), Some("evidence-readiness-v1"));
    assert_eq!(ideas[0].score_inputs["capturedPassages"], 1);
    assert_eq!(ideas[0].score_inputs["audienceDemand"], "unknown");
    sessions_store::decide_idea(&conn, "brand-one", &session.id, &ideas[0].candidate.id, "saved", None, 103).unwrap();
    assert_eq!(sessions_store::list_ideas(&conn, "brand-one", &session.id).unwrap()[0].candidate.decision.as_deref(), Some("saved"));
    sessions_store::decide_idea(&conn, "brand-one", &session.id, &ideas[0].candidate.id, "selected", None, 104).unwrap();
    assert_eq!(sessions_store::list_ideas(&conn, "brand-one", &session.id).unwrap()[0].candidate.decision.as_deref(), Some("selected"));
}

#[test]
fn scoring_uses_frozen_evidence_and_never_invents_audience_demand() {
    let mut conn = ready();
    let session = sessions_store::create_session(&conn, "brand-one", "Evidence review",
        &["youtube".into()], &serde_json::json!({"version":1}), 100).unwrap();
    let run = sessions_store::start_or_get_active(&mut conn, "brand-one", &session.id, "score", 101).unwrap();
    for (id, provider, state, passage) in [
        ("s1", "searxng", "captured", Some("Source one excerpt")),
        ("s2", "searxng", "captured", Some("Source two excerpt")),
        ("s3", "youtube-data-api", "lead_only", None),
        ("s4", "searxng", "captured", None),
    ] {
        conn.execute("INSERT INTO kg_sources(id,project_id,provider,url,title,observed_at,passage,evidence_state)
            VALUES (?1,'brand-one',?2,?3,'Source',100,?4,?5)",
            rusqlite::params![id,provider,format!("https://example.org/{id}"),passage,state]).unwrap();
    }
    // A public-video lead must actually have a measured observation to qualify for the run.
    let topic = contentgen_server::research::graph_store::upsert_node(
        &conn, "brand-one", "topic", "Insurance costs", 100).unwrap();
    conn.execute("INSERT INTO kg_trend_observations(id,project_id,node_id,source_id,provider,metric,value,unit,collected_at)
        VALUES ('observation','brand-one',?1,'s3','youtube-data-api','views',1000,'count',100)", [topic]).unwrap();
    sessions_store::finish_session_run(&mut conn, "brand-one", &session.id, &run.id,
        vec![
            discovery_store::CandidateDraft { title:"Insurance costs explained with multiple sources".into(),
                hook:"Why costs rise".into(),premise:"Explain each component".into(),
                why_now:"A timely homeowner question".into(),angle_key:"many-sources".into(),
                source_ids:vec!["s1".into(),"s2".into(),"s3".into()],confidence:"high".into() },
            discovery_store::CandidateDraft { title:"Solar battery repairs without a quoted source".into(),
                hook:"Unquoted".into(),premise:"No captured passage".into(),
                why_now:"Question".into(),angle_key:"no-passage".into(),
                source_ids:vec!["s4".into()],confidence:"high".into() },
        ], "completed", 102).unwrap();
    let ideas = sessions_store::list_ideas(&conn, "brand-one", &session.id).unwrap();
    let strong = ideas.iter().find(|i| i.candidate.angle_key == "many-sources").unwrap();
    assert_eq!(strong.opportunity_score, Some(90.0));
    assert_eq!(strong.score_inputs["capturedPassages"], 2);
    assert_eq!(strong.score_inputs["publicVideoLeads"], 1);
    assert_eq!(strong.score_inputs["sourcePoints"], 50);
    assert_eq!(strong.score_inputs["audienceDemand"], "unknown");
    assert!(strong.platform_fit.as_object().unwrap().is_empty());
    let unquoted = ideas.iter().find(|i| i.candidate.angle_key == "no-passage").unwrap();
    assert!(unquoted.opportunity_score.is_none(), "an empty passage is not usable evidence");
    assert_eq!(unquoted.score_inputs["capturedPassages"], 0);
    conn.execute("UPDATE kg_sources SET passage='Source changed after the run' WHERE id='s1'", []).unwrap();
    assert_eq!(sessions_store::list_ideas(&conn, "brand-one", &session.id).unwrap()
        .iter().find(|i| i.candidate.angle_key == "many-sources").unwrap().opportunity_score, Some(90.0));
}

#[test]
fn productions_preserve_brand_session_idea_links_and_reject_cross_project_input() {
    let mut conn = ready();
    let session = sessions_store::create_session(
        &conn, "brand-one", "Costs", &["youtube".into()], &serde_json::json!({"version":1}), 100,
    ).unwrap();
    let run = sessions_store::start_or_get_active(&mut conn, "brand-one", &session.id, "a", 101).unwrap();
    conn.execute(
        "INSERT INTO kg_sources(id,project_id,provider,url,title,observed_at,passage,evidence_state)
         VALUES ('source-house','brand-one','searxng','https://example.org/house','Housing expenses',100,'Captured costs','captured')", [],
    ).unwrap();
    sessions_store::finish_session_run(&mut conn, "brand-one", &session.id, &run.id,
        vec![discovery_store::CandidateDraft {
            title: "The real lifetime expenses of homeownership".into(),
            hook: "Your mortgage is only part of the bill".into(),
            premise: "Add tax, insurance, and maintenance costs".into(),
            why_now: "Relevant to buyers".into(),
            angle_key: "house-cost-truth".into(),
            source_ids: vec!["source-house".into()], confidence: "high".into(),
        }], "completed", 102).unwrap();
    let idea = &sessions_store::list_ideas(&conn, "brand-one", &session.id).unwrap()[0];
    let p1 = production_store::create_production(
        &conn, "brand-one", &session.id, &idea.candidate.id,
        &serde_json::json!({"topic":"Home lifetime costs","title":"Lifetime cost of a house",
            "angle":"actual costs","description":"Break down ownership costs","keywords":[],
            "platforms":["youtube"]}),
        &["youtube".into()], 103,
    ).unwrap();
    assert!(p1.id.starts_with("production-"),"Production IDs use the public identifier format");
    let p2 = production_store::create_production(
        &conn, "brand-one", &session.id, &idea.candidate.id,
        &serde_json::json!({"topic":"Home lifetime costs","title":"Home ownership costs, part two",
            "angle":"Unexpected expenses","description":"Second look at home costs\nIncluding taxes and maintenance","keywords":[],
            "platforms":["youtube"]}),
        &["youtube".into()], 104,
    ).unwrap();
    assert_ne!(p1.id, p2.id);
    assert_eq!(p1.project_id, "brand-one");
    assert_eq!(p1.session_id, session.id);
    assert_eq!(production_store::list_productions(&conn, "brand-one").unwrap().len(), 2);
    assert_eq!(production_store::list_all_productions(&conn).unwrap().len(), 2);
    assert!(production_store::create_production(
        &conn, "brand-two", &session.id, &idea.candidate.id,
        &serde_json::json!({"topic":"Invalid","title":"Invalid",
            "angle":"","description":"","keywords":[],"platforms":["youtube"]}),
        &["youtube".into()], 105,
    ).is_err());
    let valid = serde_json::json!({"topic":"Home lifetime costs","title":"Why homes cost more",
        "angle":"Tax, insurance and maintenance","description":"Evidence-first explainer",
        "keywords":["home cost"],"platforms":["youtube"]});
    assert!(production_store::create_production(&conn,"brand-one",&session.id,&idea.candidate.id,
        &serde_json::json!({}),&["youtube".into()],106).is_err(),
        "A malformed brief cannot be persisted and later crash the editor");
    assert!(production_store::create_production(&conn,"brand-one",&session.id,&idea.candidate.id,
        &valid,&["tiktok".into()],106).is_err(),
        "Productions cannot choose platforms outside their discovery session");
    assert!(production_store::create_production(&conn,"brand-one",&session.id,&idea.candidate.id,
        &valid,&["youtube".into(),"tiktok".into()],106).is_err(),
        "The request and the frozen brief must agree on platforms");
    assert_eq!(conn.query_row("SELECT COUNT(*) FROM discovery_projects", [], |r| r.get::<_,i64>(0)).unwrap(), 2);
}

