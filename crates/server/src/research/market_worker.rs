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
        }
        let mut ticks = tokio::time::interval(Duration::from_secs(60));
        ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            ticks.tick().await;
            let Ok(key) = state.credentials().youtube_key() else {
                continue;
            };
            let Ok(client) = YoutubeClient::from_key(key) else {
                continue;
            };
            let Ok(db) = state.connect() else { continue };
            let now = epoch_now();
            let _ = market_store::prune_expired(&db, now);
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
    run_claim_with(state, run, move |watchlist| async move {
        client
            .collect(&watchlist.query, &watchlist.region, &watchlist.language)
            .await
    })
    .await;
}

async fn run_claim_with<F, Fut>(state: AppState, run: MarketRun, fetch: F)
where
    F: FnOnce(MarketWatchlist) -> Fut,
    Fut: Future<Output = Result<Vec<VideoObservation>, YoutubeError>>,
{
    let Ok(_permit) = state.market_semaphore().acquire_owned().await else {
        return;
    };
    let Ok(db) = state.connect() else { return };
    let Ok(watchlist) = market_store::get_watchlist(&db, &run.watchlist_id) else {
        return;
    };
    // Disabled/deleted while the run waited: don't make an external request.
    if !watchlist.enabled {
        let _ = market_store::fail_run(&db, &run.id, "disabled", epoch_now());
        return;
    }
    drop(db);
    let result = fetch(watchlist).await;
    if let Ok(db) = state.connect() {
        match result {
            Ok(observations) => {
                if market_store::complete_run(&db, &run.id, &observations, epoch_now()).is_err() {
                    let _ = market_store::fail_run(&db, &run.id, "storage_failed", epoch_now());
                }
            }
            Err(err) => {
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
            },
            epoch_now(),
        )
        .unwrap();
        (dir, AppState::new(path), watch.id)
    }

    #[tokio::test]
    async fn executing_a_claim_writes_real_fixture_observations_without_external_network() {
        let (_dir, state, id) = setup();
        let db = state.connect().unwrap();
        let run = market_store::claim_watchlist(&db, &id, epoch_now(), true)
            .unwrap()
            .unwrap();
        drop(db);
        run_claim_with(state.clone(), run, |_| async {
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
        run_claim_with(state, run, move |_| async move {
            capture.fetch_add(1, Ordering::SeqCst);
            Ok(Vec::new())
        })
        .await;
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }
}
