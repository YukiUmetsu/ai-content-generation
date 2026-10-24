use contentgen_server::{
    db,
    research::{
        discovery_projects::{self, ProjectContentSnapshot, ProjectSnapshot},
        discovery_store,
        graph_store,
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
fn already_made_and_dismissed_angles_are_filtered_by_substance() {
    let mut db = ready();
    let source = graph_store::import_source(&db,"proj-houses",graph_store::SourceDraft {
        url:"https://example.org/heat-pump-cost".into(), title:"Heat pump cost overview".into(),
        provider:"search".into(), published_at:None, observed_at:100, passage:None,
    }).unwrap();
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
fn a_run_cannot_persist_an_uncited_idea_as_completed() {
    let mut db=ready();
    let run=discovery_store::start_or_get_active(&mut db,"proj-houses","revision",100).unwrap();
    discovery_store::finish_run(&mut db,&run.id,vec![discovery_store::CandidateDraft {
        title:"A new claim without a source".into(),hook:"An unsupported hook".into(),
        premise:"An unsupported premise".into(),why_now:"No evidence".into(),
        angle_key:"unsupported new issue".into(),source_ids:vec![],confidence:"high".into(),
    }],"completed",101).unwrap();
    let saved=discovery_store::get_run(&db,"proj-houses",&run.id).unwrap();
    assert_eq!(saved.status,"insufficient_evidence");
    assert!(saved.candidates.is_empty());
}
