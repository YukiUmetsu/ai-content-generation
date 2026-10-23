use contentgen_server::db;
use contentgen_server::research::market_store::{self, MarketWatchlistDraft, VideoObservation};

fn db_ready() -> rusqlite::Connection {
    let mut db = db::open_in_memory().unwrap();
    let report = db::migrate(&mut db).unwrap();
    assert_eq!(report.to_version, 2);
    db
}

fn draft(enabled: bool) -> MarketWatchlistDraft {
    MarketWatchlistDraft {
        name: "House Math".into(),
        query: "heat pump versus gas furnace total cost".into(),
        region: "US".into(),
        language: "en".into(),
        enabled,
    }
}

#[test]
fn migration_creates_market_tables_and_watchlists_validate_inputs() {
    let db = db_ready();
    let created = market_store::create_watchlist(&db, draft(false), 1_000_000).unwrap();
    assert!(!created.enabled);
    assert_eq!(created.region, "US");
    assert_eq!(market_store::list_watchlists(&db).unwrap().len(), 1);
    assert!(
        market_store::create_watchlist(
            &db,
            MarketWatchlistDraft {
                query: " ".into(),
                ..draft(true)
            },
            1_000_000
        )
        .is_err()
    );
    assert!(
        market_store::create_watchlist(
            &db,
            MarketWatchlistDraft {
                region: "america".into(),
                ..draft(true)
            },
            1_000_000
        )
        .is_err()
    );
}

#[test]
fn lease_and_api_budget_are_atomic_and_survive_failed_runs() {
    let db = db_ready();
    let watch = market_store::create_watchlist(&db, draft(true), 1_000_000).unwrap();
    let first = market_store::claim_watchlist(&db, &watch.id, 1_000_000, true).unwrap();
    assert!(first.is_some());
    assert!(
        market_store::claim_watchlist(&db, &watch.id, 1_000_000, true)
            .unwrap()
            .is_none()
    );
    assert_eq!(market_store::used_search_calls(&db, 1_000_000).unwrap(), 1);
    market_store::fail_run(&db, &first.unwrap().id, "provider_unavailable", 1_000_001).unwrap();
    assert!(
        market_store::claim_watchlist(&db, &watch.id, 1_000_002, false)
            .unwrap()
            .is_none()
    );
    assert_eq!(market_store::used_search_calls(&db, 1_000_002).unwrap(), 1);
}

#[test]
fn observations_retain_nullable_metrics_and_expire_after_thirty_days() {
    let db = db_ready();
    let watch = market_store::create_watchlist(&db, draft(true), 1_000_000).unwrap();
    let run = market_store::claim_watchlist(&db, &watch.id, 1_000_000, true)
        .unwrap()
        .unwrap();
    market_store::complete_run(
        &db,
        &run.id,
        &[VideoObservation {
            video_id: "aBc123ABC01".into(),
            title: "A heating cost comparison".into(),
            channel_id: "UC_example".into(),
            channel_title: "Example channel".into(),
            published_at: "2026-01-01T00:00:00Z".into(),
            duration_seconds: Some(320),
            view_count: Some(1200),
            like_count: None,
            comment_count: None,
            subscriber_count: None,
        }],
        1_000_010,
    )
    .unwrap();
    let rows = market_store::list_observations(&db, &watch.id, 1_000_011).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].video.like_count, None);
    assert_eq!(rows[0].video.view_count, Some(1200));
    assert_eq!(rows[0].provider, "youtube-data-api");
    assert!(
        market_store::list_observations(&db, &watch.id, 1_000_010 + 30 * 86400)
            .unwrap()
            .is_empty()
    );
    market_store::prune_expired(&db, 1_000_010 + 30 * 86400).unwrap();
    assert_eq!(market_store::count_all_observations(&db).unwrap(), 0);
}

#[test]
fn disabled_watchlists_never_claim_and_deleting_cascades_results() {
    let db = db_ready();
    let watch = market_store::create_watchlist(&db, draft(false), 1_000_000).unwrap();
    assert!(
        market_store::claim_watchlist(&db, &watch.id, 1_000_000, true)
            .unwrap()
            .is_none()
    );
    market_store::set_enabled(&db, &watch.id, true, 1_000_001).unwrap();
    let run = market_store::claim_watchlist(&db, &watch.id, 1_000_002, true)
        .unwrap()
        .unwrap();
    market_store::complete_run(&db, &run.id, &[], 1_000_003).unwrap();
    market_store::delete_watchlist(&db, &watch.id).unwrap();
    assert!(market_store::list_watchlists(&db).unwrap().is_empty());
}

#[test]
fn twenty_searches_is_a_hard_rolling_budget_even_after_watchlist_deletion() {
    let db = db_ready();
    let now = 1_000_000;
    let first = market_store::create_watchlist(&db, draft(true), now).unwrap();
    for i in 0..20 {
        let run = market_store::claim_watchlist(&db, &first.id, now + i, true)
            .unwrap()
            .expect("remaining search budget");
        market_store::complete_run(&db, &run.id, &[], now + i).unwrap();
    }
    assert_eq!(market_store::used_search_calls(&db, now + 20).unwrap(), 20);
    assert!(
        market_store::claim_watchlist(&db, &first.id, now + 20, true)
            .unwrap()
            .is_none()
    );
    market_store::delete_watchlist(&db, &first.id).unwrap();
    let second = market_store::create_watchlist(&db, draft(true), now + 20).unwrap();
    assert!(
        market_store::claim_watchlist(&db, &second.id, now + 21, true)
            .unwrap()
            .is_none()
    );
    assert_eq!(market_store::used_search_calls(&db, now + 21).unwrap(), 20);
    assert_eq!(
        market_store::used_search_calls(&db, now + 86_420).unwrap(),
        0
    );
}

#[test]
fn related_videos_match_across_watchlists_dedupe_and_exclude_expired() {
    let db = db_ready();
    let now = 1_000_000;
    let first = market_store::create_watchlist(&db, draft(true), now).unwrap();
    let second = market_store::create_watchlist(
        &db,
        MarketWatchlistDraft {
            name: "Home Energy".into(),
            query: "heat pump operating costs".into(),
            ..draft(true)
        },
        now,
    )
    .unwrap();
    let sample = |video_id: &str, title: &str| VideoObservation {
        video_id: video_id.into(),
        title: title.into(),
        channel_id: "UCdemo".into(),
        channel_title: "Explainer".into(),
        published_at: "2026-01-01T00:00:00Z".into(),
        duration_seconds: Some(360),
        view_count: Some(123),
        like_count: None,
        comment_count: None,
        subscriber_count: None,
    };
    let run = market_store::claim_watchlist(&db, &first.id, now, true)
        .unwrap()
        .unwrap();
    market_store::complete_run(
        &db,
        &run.id,
        &[
            sample("pumpABC1234", "HEAT PUMP Installation Breakdown"),
            sample("roofABC1234", "Why a new roof costs so much"),
            sample("oldABC12345", "Gas Furnace: heating cost"),
        ],
        now + 1,
    )
    .unwrap();
    let run = market_store::claim_watchlist(&db, &second.id, now + 2, true)
        .unwrap()
        .unwrap();
    market_store::complete_run(
        &db,
        &run.id,
        &[
            sample("pumpABC1234", "Heat Pump Installation Explained"),
            sample("energyABC12", "Comparing gas furnace and heat pumps"),
        ],
        now + 3,
    )
    .unwrap();
    let budget = market_store::used_search_calls(&db, now + 4).unwrap();
    let rows =
        market_store::find_related_observations(&db, "HEAT PUMP vs GAS furnace!", now + 4).unwrap();
    assert_eq!(rows.len(), 3);
    assert_eq!(
        rows.iter()
            .filter(|x| x.video.video.video_id == "pumpABC1234")
            .count(),
        1
    );
    let duplicate = rows
        .iter()
        .find(|x| x.video.video.video_id == "pumpABC1234")
        .unwrap();
    assert_eq!(duplicate.watchlist_name, "Home Energy");
    assert!(duplicate.matched_terms.contains(&"heat".to_string()));
    assert_eq!(
        market_store::used_search_calls(&db, now + 4).unwrap(),
        budget
    );
    assert!(
        market_store::find_related_observations(&db, "unrelated", now + 4)
            .unwrap()
            .is_empty()
    );
    assert!(
        market_store::find_related_observations(&db, "heat pump", now + 3 + 30 * 86400)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn related_videos_reject_invalid_and_vague_topics() {
    let db = db_ready();
    assert!(market_store::find_related_observations(&db, " ", 1_000_000).is_err());
    assert!(market_store::find_related_observations(&db, &"x".repeat(161), 1_000_000).is_err());
    assert!(
        market_store::find_related_observations(&db, "the of is", 1_000_000)
            .unwrap()
            .is_empty()
    );
}
