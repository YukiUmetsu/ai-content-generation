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
    let source = graph_store::import_source(
        &db,
        "home-costs",
        graph_store::SourceDraft {
            url: "https://example.com/roof-costs".into(),
            title: "Roof cost factors".into(),
            provider: "captured-web".into(),
            published_at: None,
            observed_at: 100,
            passage: Some(
                "Roof materials are part of the replacement cost estimate in this example.".into(),
            ),
        },
    )
    .unwrap();
    let roof = graph_store::upsert_node(&db, "home-costs", "topic", "Roof materials", 100).unwrap();
    let cost =
        graph_store::upsert_node(&db, "home-costs", "topic", "Replacement cost", 100).unwrap();
    assert!(
        graph_store::add_edge_verified(
            &db,
            "home-costs",
            &roof,
            &cost,
            "related_to",
            Some(&source),
            "supported",
            Some("quote not present in the source"),
            100
        )
        .is_err()
    );
    assert!(
        graph_store::add_edge_verified(
            &db,
            "home-costs",
            &roof,
            &cost,
            "affects",
            Some(&source),
            "supported",
            Some("Roof materials are part of the replacement cost estimate"),
            100
        )
        .is_err()
    );
    assert!(
        graph_store::add_edge_verified(
            &db,
            "home-costs",
            &roof,
            &cost,
            "related_to",
            Some(&source),
            "supported",
            Some("Roof materials are part of the replacement cost estimate"),
            100
        )
        .is_ok()
    );
    let graph = graph_store::overview(&db, "home-costs").unwrap();
    assert_eq!(graph.edge_evidence.len(), 1);
    assert_eq!(graph.edge_evidence[0].source_id, source);
    assert_eq!(graph.edge_evidence[0].assessment, "supports");
    assert_eq!(
        graph.edge_evidence[0].quote.as_deref(),
        Some("Roof materials are part of the replacement cost estimate")
    );
}

#[test]
fn later_weaker_extraction_cannot_discard_previously_verified_evidence() {
    let db = db_project();
    let passage = "The listed materials are part of the documented total roof replacement cost.";
    let source = graph_store::import_source(
        &db,
        "home-costs",
        graph_store::SourceDraft {
            url: "https://example.org/roof-verified".into(),
            title: "Cost evidence".into(),
            provider: "captured-web".into(),
            published_at: None,
            observed_at: 100,
            passage: Some(passage.into()),
        },
    )
    .unwrap();
    let materials =
        graph_store::upsert_node(&db, "home-costs", "topic", "Roof materials", 100).unwrap();
    let price =
        graph_store::upsert_node(&db, "home-costs", "topic", "Replacement price", 100).unwrap();
    let quote = "materials are part of the documented total roof replacement cost";
    graph_store::add_edge_verified(
        &db,
        "home-costs",
        &materials,
        &price,
        "related_to",
        Some(&source),
        "supported",
        Some(quote),
        100,
    )
    .unwrap();
    graph_store::add_edge_verified(
        &db,
        "home-costs",
        &materials,
        &price,
        "related_to",
        Some(&source),
        "hypothesized",
        None,
        101,
    )
    .unwrap();
    let graph = graph_store::overview(&db, "home-costs").unwrap();
    assert_eq!(graph.edges[0].status, "supported");
    assert_eq!(graph.edge_evidence[0].assessment, "supports");
    assert_eq!(graph.edge_evidence[0].quote.as_deref(), Some(quote));
}

#[test]
fn graph_rejects_relationships_with_invalid_node_kind_directions() {
    let db = db_project();
    let source =
        graph_store::upsert_node(&db, "home-costs", "source", "Public document", 100).unwrap();
    let topic =
        graph_store::upsert_node(&db, "home-costs", "topic", "Roof replacement", 100).unwrap();
    assert!(
        graph_store::add_edge(
            &db,
            "home-costs",
            &source,
            &topic,
            "subtopic_of",
            None,
            "hypothesized",
            100
        )
        .is_err()
    );
    assert!(
        graph_store::add_edge(
            &db,
            "home-costs",
            &source,
            &topic,
            "related_to",
            None,
            "hypothesized",
            100
        )
        .is_err()
    );
}

#[test]
fn captured_passages_are_reusable_for_later_clicks_without_exposing_lead_only_sources() {
    let db = db_project();
    let passage = "Existing public article: repairs require special materials and trained labor.";
    let captured = graph_store::import_source(
        &db,
        "home-costs",
        graph_store::SourceDraft {
            url: "https://example.com/captured".into(),
            title: "Captured article".into(),
            provider: "searxng".into(),
            published_at: None,
            observed_at: 101,
            passage: Some(passage.into()),
        },
    )
    .unwrap();
    graph_store::import_source(
        &db,
        "home-costs",
        graph_store::SourceDraft {
            url: "https://example.com/lead".into(),
            title: "Search preview".into(),
            provider: "searxng".into(),
            published_at: None,
            observed_at: 102,
            passage: None,
        },
    )
    .unwrap();
    let reusable = graph_store::captured_sources(&db, "home-costs").unwrap();
    assert_eq!(reusable.len(), 1);
    assert_eq!(reusable[0].id, captured);
    assert_eq!(reusable[0].passage, passage);
    assert_eq!(reusable[0].title, "Captured article");
    assert_eq!(reusable[0].url, "https://example.com/captured");
    assert_eq!(reusable[0].evidence_state, "captured");
    assert!(graph_store::captured_sources(&db, "other-project").is_err());
}

#[test]
fn raw_sql_cannot_attach_foreign_nodes_sources_or_evidence_to_a_project() {
    let mut db = db_project();
    discovery_projects::sync_project(
        &mut db,
        &ProjectSnapshot {
            id: "other".into(),
            name: "Another project".into(),
            notes: "Separate evidence".into(),
            updated_at: 1,
            content: vec![],
        },
        100,
    )
    .unwrap();
    let home = graph_store::upsert_node(&db, "home-costs", "topic", "Home costs", 100).unwrap();
    let foreign =
        graph_store::upsert_node(&db, "other", "topic", "Other project's topic", 100).unwrap();
    let home_source = graph_store::import_source(
        &db,
        "home-costs",
        graph_store::SourceDraft {
            url: "https://example.org/home".into(),
            title: "Local source".into(),
            provider: "captured-web".into(),
            published_at: None,
            observed_at: 100,
            passage: Some("A local source describes home ownership expenses.".into()),
        },
    )
    .unwrap();
    let foreign_source = graph_store::import_source(
        &db,
        "other",
        graph_store::SourceDraft {
            url: "https://example.org/other".into(),
            title: "Foreign source".into(),
            provider: "captured-web".into(),
            published_at: None,
            observed_at: 100,
            passage: Some("Separate evidence that belongs to another project.".into()),
        },
    )
    .unwrap();
    assert!(
        db.execute(
            "INSERT INTO kg_edges(id,project_id,from_node_id,to_node_id,relation,status,created_at)
        VALUES ('edge-foreign','home-costs',?1,?2,'related_to','hypothesized',100)",
            rusqlite::params![home, foreign]
        )
        .is_err()
    );
    assert!(
        db.execute(
            "INSERT INTO kg_node_aliases(project_id,node_id,normalized,alias)
        VALUES ('home-costs',?1,'foreign alias','Foreign alias')",
            [&foreign]
        )
        .is_err()
    );
    assert!(db.execute("INSERT INTO kg_trend_observations(id,project_id,node_id,source_id,provider,metric,value,unit,collected_at)
        VALUES ('trend-foreign','home-costs',?1,?2,'test','views',50,'count',100)",rusqlite::params![foreign,home_source]).is_err());
    let edge = graph_store::add_edge(
        &db,
        "home-costs",
        &home,
        &graph_store::upsert_node(&db, "home-costs", "topic", "Roof costs", 100).unwrap(),
        "related_to",
        None,
        "hypothesized",
        100,
    )
    .unwrap();
    assert!(
        db.execute(
            "INSERT INTO kg_edge_evidence(edge_id,source_id,assessment)
        VALUES (?1,?2,'unknown')",
            rusqlite::params![edge, foreign_source]
        )
        .is_err()
    );
    assert!(
        db.execute(
            "UPDATE kg_edges SET to_node_id=?1 WHERE id=?2",
            rusqlite::params![foreign, edge]
        )
        .is_err()
    );
}

#[test]
fn aliases_are_reversible_and_rejected_relations_resist_ai_reintroduction() {
    let db = db_project();
    let insurance =
        graph_store::upsert_node(&db, "home-costs", "topic", "Home insurance", 100).unwrap();
    graph_store::add_alias(&db, "home-costs", &insurance, "Homeowners insurance").unwrap();
    assert_eq!(
        graph_store::upsert_node(&db, "home-costs", "topic", "Homeowners insurance", 101).unwrap(),
        insurance
    );
    assert_eq!(
        graph_store::search_nodes(&db, "home-costs", "homeowners", 10).unwrap()[0].id,
        insurance
    );
    let roof = graph_store::upsert_node(&db, "home-costs", "topic", "Roof expenses", 100).unwrap();
    let edge = graph_store::add_edge(
        &db,
        "home-costs",
        &insurance,
        &roof,
        "related_to",
        None,
        "hypothesized",
        100,
    )
    .unwrap();
    graph_store::correct_edge(&db, "home-costs", &edge, "rejected").unwrap();
    graph_store::add_edge(
        &db,
        "home-costs",
        &insurance,
        &roof,
        "related_to",
        None,
        "hypothesized",
        102,
    )
    .unwrap();
    assert_eq!(
        graph_store::overview(&db, "home-costs").unwrap().edges[0].status,
        "rejected"
    );
    graph_store::remove_alias(&db, "home-costs", &insurance, "Homeowners insurance").unwrap();
    assert_ne!(
        graph_store::upsert_node(&db, "home-costs", "topic", "Homeowners insurance", 103).unwrap(),
        insurance
    );
}
