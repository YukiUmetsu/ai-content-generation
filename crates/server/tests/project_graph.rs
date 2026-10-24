use contentgen_server::{
    db,
    research::{
        discovery_projects::{self, ProjectSnapshot},
        graph_store,
    },
};

fn db_project() -> rusqlite::Connection {
    let mut db = db::open_in_memory().unwrap();
    db::migrate(&mut db).unwrap();
    discovery_projects::sync_project(
        &mut db,
        &ProjectSnapshot {
            id: "home-costs".into(),
            name: "House Math".into(),
            notes: "Costs of home ownership".into(),
            updated_at: 1,
            content: vec![],
        },
        100,
    )
    .unwrap();
    db
}

#[test]
fn project_graph_rejects_unsupported_facts_and_leads_without_passages() {
    let db = db_project();
    let source = graph_store::import_source(
        &db,
        "home-costs",
        graph_store::SourceDraft {
            url: "https://example.com/insurance".into(),
            title: "Insurance costs".into(),
            provider: "search".into(),
            published_at: None,
            observed_at: 100,
            passage: None,
        },
    )
    .unwrap();
    let from = graph_store::upsert_node(&db, "home-costs", "topic", "Home insurance", 100).unwrap();
    let to = graph_store::upsert_node(&db, "home-costs", "topic", "Mortgage rates", 100).unwrap();
    assert!(
        graph_store::add_edge(
            &db,
            "home-costs",
            &from,
            &to,
            "affects",
            Some(&source),
            "supported",
            100
        )
        .is_err()
    );
    graph_store::add_edge(
        &db,
        "home-costs",
        &from,
        &to,
        "related_to",
        Some(&source),
        "hypothesized",
        100,
    )
    .unwrap();
    let graph = graph_store::overview(&db, "home-costs").unwrap();
    assert_eq!(graph.nodes.len(), 2);
    assert_eq!(graph.edges.len(), 1);
    assert_eq!(graph.edges[0].status, "hypothesized");
    assert!(graph_store::overview(&db, "not-home").is_err());
}

#[test]
fn graph_source_import_is_idempotent_and_aliases_scope_per_project() {
    let db = db_project();
    let node = graph_store::upsert_node(&db, "home-costs", "topic", "Home Insurance", 100).unwrap();
    assert_eq!(
        node,
        graph_store::upsert_node(&db, "home-costs", "topic", "  home insurance ", 101).unwrap()
    );
    let draft = graph_store::SourceDraft {
        url: "https://www.youtube.com/watch?v=testVideo1".into(),
        title: "Roof cost".into(),
        provider: "youtube-data-api".into(),
        published_at: Some("2026-10-20".into()),
        observed_at: 105,
        passage: None,
    };
    let first = graph_store::import_source(&db, "home-costs", draft.clone()).unwrap();
    assert_eq!(
        first,
        graph_store::import_source(&db, "home-costs", draft).unwrap()
    );
    assert_eq!(
        graph_store::overview(&db, "home-costs")
            .unwrap()
            .sources
            .len(),
        1
    );
}

#[test]
fn graph_support_requires_a_verbatim_quote_and_does_not_auto_promote_causality() {
    let db = db_project();
    let source=graph_store::import_source(&db,"home-costs",graph_store::SourceDraft {
        url:"https://example.com/roof-costs".into(),title:"Roof cost factors".into(),
        provider:"captured-web".into(),published_at:None,observed_at:100,
        passage:Some("Roof materials are part of the replacement cost estimate in this example.".into()),
    }).unwrap();
    let roof=graph_store::upsert_node(&db,"home-costs","topic","Roof materials",100).unwrap();
    let cost=graph_store::upsert_node(&db,"home-costs","topic","Replacement cost",100).unwrap();
    assert!(graph_store::add_edge_verified(&db,"home-costs",&roof,&cost,"related_to",Some(&source),"supported",
        Some("quote not present in the source"),100).is_err());
    assert!(graph_store::add_edge_verified(&db,"home-costs",&roof,&cost,"affects",Some(&source),"supported",
        Some("Roof materials are part of the replacement cost estimate"),100).is_err());
    assert!(graph_store::add_edge_verified(&db,"home-costs",&roof,&cost,"related_to",Some(&source),"supported",
        Some("Roof materials are part of the replacement cost estimate"),100).is_ok());
}
