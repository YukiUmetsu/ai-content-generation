use contentgen_server::research::market_store::{self, MarketWatchlistDraft};
use contentgen_server::{
    db,
    research::discovery_projects::{
        self, KeywordDraft, KeywordPatch, ProjectContentSnapshot, ProjectSnapshot,
    },
};

fn ready() -> rusqlite::Connection {
    let mut db = db::open_in_memory().unwrap();
    db::migrate(&mut db).unwrap();
    db
}

fn snapshot(revision: i64) -> ProjectSnapshot {
    ProjectSnapshot {
        id: "project_house".into(),
        name: "House Math".into(),
        notes: "Homeownership economics, costs and tradeoffs".into(),
        updated_at: revision,
        content: vec![ProjectContentSnapshot {
            id: "video_1".into(),
            name: "Why Roof Repairs Cost So Much".into(),
            notes: "Roof materials and labor".into(),
            kind: "video".into(),
            stage: "published".into(),
            created_at: "2026-10-01".into(),
        }],
    }
}

#[test]
fn discovery_projects_sync_is_idempotent_preserves_inactive_content_and_rejects_stale_snapshots() {
    let mut db = ready();
    assert_eq!(
        discovery_projects::sync_project(&mut db, &snapshot(10), 100)
            .unwrap()
            .content_count,
        1
    );
    let mut changed = snapshot(11);
    changed.content.clear();
    discovery_projects::sync_project(&mut db, &changed, 101).unwrap();
    assert_eq!(
        db.query_row(
            "SELECT COUNT(*) FROM discovery_project_content WHERE active=0",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    assert!(discovery_projects::sync_project(&mut db, &snapshot(9), 102).is_err());
    assert_eq!(
        discovery_projects::sync_project(&mut db, &changed, 103)
            .unwrap()
            .content_count,
        0
    );
}

#[test]
fn keywords_are_normalized_and_manual_entries_survive_model_suggestions() {
    let mut db = ready();
    discovery_projects::sync_project(&mut db, &snapshot(1), 100).unwrap();
    let manual = KeywordDraft {
        text: "  Home  Insurance ".into(),
        kind: "topic".into(),
        origin: "manual".into(),
    };
    let list = discovery_projects::patch_keywords(
        &mut db,
        "project_house",
        KeywordPatch {
            add: vec![manual],
            remove: vec![],
            disable: vec![],
        },
        101,
    )
    .unwrap();
    assert_eq!(list.len(), 1);
    let model = KeywordDraft {
        text: "home insurance".into(),
        kind: "topic".into(),
        origin: "model".into(),
    };
    let list = discovery_projects::patch_keywords(
        &mut db,
        "project_house",
        KeywordPatch {
            add: vec![model],
            remove: vec![],
            disable: vec![],
        },
        102,
    )
    .unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].origin, "manual");
    assert_eq!(list[0].text, "Home Insurance");
}

#[test]
fn watchlist_mapping_is_explicit_and_projects_are_isolated() {
    let mut db = ready();
    discovery_projects::sync_project(&mut db, &snapshot(1), 100).unwrap();
    let watch = market_store::create_watchlist(
        &db,
        MarketWatchlistDraft {
            name: "Heating".into(),
            query: "heat pump versus gas furnace cost".into(),
            region: "US".into(),
            language: "en".into(),
            enabled: false,
            query_mode: "manual".into(),
            query_plan: vec![],
            query_plan_source: "user-edited".into(),
        },
        100,
    )
    .unwrap();
    assert!(
        discovery_projects::get_bound_watchlists(&db, "project_house")
            .unwrap()
            .is_empty()
    );
    discovery_projects::set_bound_watchlists(&mut db, "project_house", std::slice::from_ref(&watch.id))
        .unwrap();
    assert_eq!(
        discovery_projects::get_bound_watchlists(&db, "project_house").unwrap(),
        vec![watch.id]
    );
    assert!(discovery_projects::set_bound_watchlists(&mut db, "missing", &["bad".into()]).is_err());
    assert!(
        db.query_row("PRAGMA foreign_key_check", [], |r| r.get::<_, String>(0))
            .err()
            .is_some()
    );
}
