//! Exactly one local-background collector. Nothing survives server shutdown.

use std::future::Future;
use std::time::Duration;

use super::market_api::epoch_now;
use super::market_store::{self, MarketRun, MarketWatchlist, VideoObservation};
use super::youtube_api::{YoutubeClient, YoutubeError};
use crate::state::AppState;

pub fn spawn(state: AppState) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        // Run once after restart, even if the user has disabled every watchlist.
        // Stale API-derived observations must not be displayed.
        if let Ok(db) = state.connect() {
            let _ = market_store::prune_expired(&db, epoch_now());
            let _ = market_store::reconcile_orphaned_runs(&db, epoch_now());
            let _ = super::idea_market::prune_expired(&db, epoch_now());
            let _ = super::idea_trends::prune_expired(&db, epoch_now());
            let _ = super::idea_market::reconcile_interrupted(&db, epoch_now());
            let _ = super::idea_trends::reconcile_interrupted(&db, epoch_now());
            let _ = super::discovery_store::recover_interrupted_market_runs(&db, epoch_now());
        }
        // Recover completed sessions created before automatic enrichment existed.
        // Queue only missing observations, once per run; never re-spend quota on
        // saved failed/unavailable attempts or on repeated polling.
        if let Ok(mut db) = state.connect() {
            if let Err(error) = super::discovery_store::queue_missing_market_runs(
                &mut db, None, epoch_now(),
                state.credentials().youtube_key().ok()
                    .and_then(|key| YoutubeClient::from_key(key).ok()).is_some(),
            ) {
                eprintln!("contentgen-server: market_backfill_queue_failed reason={error}");
            }
        }
        tokio::spawn(super::discovery_market_worker::process_pending(state.clone()));
        let mut ticks = tokio::time::interval(Duration::from_secs(60));
        ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            ticks.tick().await;
            // Enqueue historical gaps on every tick as well as at startup.
            // The persisted marker makes this idempotent across restarts.
            if let Ok(mut db) = state.connect() {
                if let Err(error) = super::discovery_store::queue_missing_market_runs(
                &mut db, None, epoch_now(),
                state.credentials().youtube_key().ok()
                    .and_then(|key| YoutubeClient::from_key(key).ok()).is_some(),
            ) {
                    eprintln!("contentgen-server: market_backfill_queue_failed reason={error}");
                }
            }
            // Discovery enrichment has its own completion state and must run
            // even if no YouTube key is configured (Google Trends is independent).
            tokio::spawn(super::discovery_market_worker::process_pending(state.clone()));
            let Ok(key) = state.credentials().youtube_key() else {
                continue;
            };
            let Ok(client) = YoutubeClient::from_key(key) else {
                continue;
            };
            let Ok(db) = state.connect() else { continue };
            let now = epoch_now();
            let _ = market_store::prune_expired(&db, now);
            let _ = super::idea_market::prune_expired(&db, now);
            let _ = super::idea_trends::prune_expired(&db, now);
            let Ok(due) = market_store::list_due_watchlist_ids(&db, now) else {
                continue;
            };
            for id in due {
                let Ok(Some(run)) = market_store::claim_watchlist(&db, &id, epoch_now(), false)
                else {
                    continue;
                };
                // Shared semaphore serializes automatic and manual collection.
                run_claim(state.clone(), run, client.clone()).await;
            }
        }
    })
}

pub async fn run_claim(state: AppState, run: MarketRun, client: YoutubeClient) {
    run_claim_with(state, run, move |watchlist, effective_query| async move {
        client
            .collect(&effective_query, &watchlist.region, &watchlist.language)
            .await
    })
    .await;
}

async fn run_claim_with<F, Fut>(state: AppState, run: MarketRun, fetch: F)
where
    F: FnOnce(MarketWatchlist, String) -> Fut,
    Fut: Future<Output = Result<Vec<VideoObservation>, YoutubeError>>,
{
    let Ok(_permit) = state.market_semaphore().acquire_owned().await else {
        return;
    };
    let Ok(db) = state.connect() else { return };
    let Ok(watchlist) = market_store::get_watchlist(&db, &run.watchlist_id) else {
        return;
    };
    // Disabled automatic jobs are cancelled, but explicit one-off jobs that
    // were accepted while scheduling was off may still run.
    if !watchlist.enabled && !run.allowed_while_disabled {
        let _ = market_store::fail_run(&db, &run.id, "disabled", epoch_now());
        return;
    }
    drop(db);
    let result = fetch(watchlist, run.effective_query.clone()).await;
    if let Ok(db) = state.connect() {
        match result {
            Ok(observations) => {
                if market_store::complete_run(&db, &run.id, &observations, epoch_now()).is_err() {
                    let _ = market_store::fail_run(&db, &run.id, "storage_failed", epoch_now());
                }
            }
            Err(err) => {
                // Correlate provider diagnostics with an opaque generated run ID.
                // Do not log watchlist names, search phrases or raw provider errors.
                eprintln!(
                    "contentgen-server: youtube_collection_failed run_id={} reason={}",
                    run.id,
                    err.code()
                );
                let _ = market_store::fail_run(&db, &run.id, err.code(), epoch_now());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::market_store::{MarketWatchlistDraft, VideoObservation};
    use super::*;
    use crate::db;
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    fn setup() -> (tempfile::TempDir, AppState, String) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("watchlists.sqlite3");
        let mut db = db::open(&path).unwrap();
        db::migrate(&mut db).unwrap();
        let watch = market_store::create_watchlist(
            &db,
            MarketWatchlistDraft {
                name: "House Math".into(),
                query: "home repair".into(),
                region: "US".into(),
                language: "en".into(),
                enabled: true,
                query_mode: "manual".into(),
                query_plan: vec![],
                query_plan_source: "user-edited".into(),
            },
            epoch_now(),
        )
        .unwrap();
        (dir, AppState::new(path), watch.id)
    }

    #[tokio::test]
    async fn manual_collection_does_not_enable_the_background_scheduler() {
        let (_dir, state, id) = setup();
        let db = state.connect().unwrap();
        market_store::set_enabled(&db, &id, false, epoch_now()).unwrap();
        let run = market_store::claim_watchlist(&db, &id, epoch_now(), true)
            .unwrap()
            .unwrap();
        assert!(run.allowed_while_disabled);
        drop(db);
        run_claim_with(state.clone(), run, |_, query| async move {
            assert_eq!(query, "home repair");
            Ok(vec![])
        })
        .await;
        let db = state.connect().unwrap();
        let saved = market_store::get_watchlist(&db, &id).unwrap();
        assert!(
            !saved.enabled,
            "one-off collection must not activate daily scheduling"
        );
        assert!(saved.last_finished_at.is_some());
    }

    #[tokio::test]
    async fn automatic_search_uses_the_phrase_frozen_when_the_run_was_claimed() {
        let (_dir, state, id) = setup();
        let db = state.connect().unwrap();
        let previous = market_store::get_watchlist(&db, &id).unwrap();
        market_store::update_watchlist(
            &db,
            &id,
            MarketWatchlistDraft {
                name: previous.name,
                query: "".into(),
                region: previous.region,
                language: previous.language,
                enabled: true,
                query_mode: "auto".into(),
                query_plan: vec![
                    "roof installation cost".into(),
                    "home insurance rates".into(),
                ],
                query_plan_source: "user-edited".into(),
            },
            epoch_now(),
        )
        .unwrap();
        let run = market_store::claim_watchlist(&db, &id, epoch_now(), true)
            .unwrap()
            .unwrap();
        assert_eq!(run.effective_query, "roof installation cost");
        let watch = market_store::get_watchlist(&db, &id).unwrap();
        market_store::update_watchlist(
            &db,
            &id,
            MarketWatchlistDraft {
                name: watch.name,
                query: "".into(),
                region: watch.region,
                language: watch.language,
                enabled: true,
                query_mode: "auto".into(),
                query_plan: vec!["different phrase".into()],
                query_plan_source: "user-edited".into(),
            },
            epoch_now(),
        )
        .unwrap();
        drop(db);
        run_claim_with(state.clone(), run, |_, query| async move {
            assert_eq!(query, "roof installation cost");
            Ok(vec![])
        })
        .await;
        let db = state.connect().unwrap();
        let updated = market_store::get_watchlist(&db, &id).unwrap();
        assert_eq!(updated.next_search_query, "different phrase");
        assert_eq!(updated.query_index, 0);
    }

    #[tokio::test]
    async fn executing_a_claim_writes_real_fixture_observations_without_external_network() {
        let (_dir, state, id) = setup();
        let db = state.connect().unwrap();
        let run = market_store::claim_watchlist(&db, &id, epoch_now(), true)
            .unwrap()
            .unwrap();
        drop(db);
        run_claim_with(state.clone(), run, |_, _| async {
            Ok(vec![VideoObservation {
                video_id: "abcABC12345".into(),
                title: "Realistic fixture".into(),
                channel_id: "UCdemo".into(),
                channel_title: "Demo".into(),
                published_at: "2026-01-01T00:00:00Z".into(),
                duration_seconds: Some(120),
                view_count: Some(300),
                like_count: None,
                comment_count: None,
                subscriber_count: None,
            }])
        })
        .await;
        let db = state.connect().unwrap();
        assert_eq!(
            market_store::list_observations(&db, &id, epoch_now())
                .unwrap()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn disabling_before_execution_prevents_provider_calls() {
        let (_dir, state, id) = setup();
        let db = state.connect().unwrap();
        let run = market_store::claim_watchlist(&db, &id, epoch_now(), true)
            .unwrap()
            .unwrap();
        market_store::set_enabled(&db, &id, false, epoch_now()).unwrap();
        drop(db);
        let calls = Arc::new(AtomicUsize::new(0));
        let capture = calls.clone();
        run_claim_with(state, run, move |_, _| async move {
            capture.fetch_add(1, Ordering::SeqCst);
            Ok(Vec::new())
        })
        .await;
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }
}
