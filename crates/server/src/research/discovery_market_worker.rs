//! Automatic market enrichment belongs to Discovery, not to the selection UI.
//! SQLite owns the run lease and every provider reservation; a failed provider
//! never holds the Discovery job open indefinitely.

use super::{
    discovery_store, idea_market,
    idea_trends::{self, TrendPoint, TrendRun},
    market_api::epoch_now,
    youtube_api::YoutubeClient,
};
use crate::state::AppState;
use rusqlite::OptionalExtension;
use serde_json::json;
use std::future::Future;
use std::time::Duration;

/// A single run can reserve at most the existing shared YouTube daily budget.
/// The Google provider enforces a stricter 12/day local safety limit.
const MAX_VIDEO_ATTEMPTS_PER_DISCOVERY: usize = 20;
const MAX_TREND_ATTEMPTS_PER_DISCOVERY: usize = 12;
const YOUTUBE_TIMEOUT: Duration = Duration::from_secs(35);
const TRENDS_TIMEOUT: Duration = Duration::from_secs(12);

fn query_for_idea(title: &str) -> String {
    const SKIP: &[&str] = &[
        "how",
        "why",
        "what",
        "when",
        "where",
        "which",
        "the",
        "a",
        "an",
        "of",
        "is",
        "are",
        "for",
        "to",
        "and",
        "does",
        "do",
        "actually",
        "really",
        "your",
        "you",
        "so",
        "much",
        "than",
        "more",
        "less",
        "explained",
        "everyone",
        "knows",
    ];
    let relevant = title
        .split(|character: char| !(character.is_alphanumeric() || character == '-'))
        .filter(|word| !word.is_empty() && !SKIP.contains(&word.to_lowercase().as_str()))
        .take(9)
        .collect::<Vec<_>>()
        .join(" ");
    let query = if relevant.chars().count() >= 3 {
        relevant
    } else {
        title.to_owned()
    };
    query
        .chars()
        .take(120)
        .collect::<String>()
        .trim()
        .to_owned()
}

fn should_circuit_youtube(code: &str) -> bool {
    // Quota denial, key configuration errors and provider-wide failures
    // affect every topic; making more calls only wastes the shared budget.
    matches!(
        code,
        "quota_exceeded"
            | "rate_limited"
            | "api_key_invalid"
            | "api_key_restricted"
            | "api_not_enabled"
            | "permission"
            | "provider_unavailable"
            | "payload_invalid"
    )
}

/// Process any saved Discovery results awaiting quantitative observations.
pub async fn process_pending(state: AppState) {
    process_pending_with(state, |run| async move {
        idea_trends::collect(&run)
            .await
            .map_err(|error| error.code())
    })
    .await;
}

async fn process_pending_with<F, Fut>(state: AppState, trends: F)
where
    F: Fn(TrendRun) -> Fut + Clone,
    Fut: Future<Output = Result<Vec<TrendPoint>, &'static str>>,
{
    // Only one Discovery coordinator per local server may advance a market
    // stage at a time. The separate I/O semaphore below still serializes
    // individual YouTube and Google Trends requests with watchlist work.
    let Ok(_coordinator) = state.discovery_market_semaphore().acquire_owned().await else {
        return;
    };
    // Multiple caller paths (finish endpoint, periodic restart recovery) can
    // run simultaneously. An immediate SQLite transaction claims each run once.
    loop {
        let Ok(mut db) = state.connect() else { return };
        let Ok(claimed) = discovery_store::claim_pending_market_run(&mut db, epoch_now()) else {
            return;
        };
        let Some(run_id) = claimed else { return };
        drop(db);
        measure_run(state.clone(), &run_id, trends.clone()).await;
    }
}

/// Check cancellation, pause and user project deletion between provider calls.
fn still_collecting(state: &AppState, run_id: &str) -> bool {
    let Ok(db) = state.connect() else {
        return false;
    };
    db.query_row(
        "SELECT 1 FROM discovery_runs WHERE id=?1 AND status='running'
                  AND stage='measure_market_collecting'",
        [run_id],
        |_| Ok(()),
    )
    .optional()
    .ok()
    .flatten()
    .is_some()
}

async fn measure_run<F, Fut>(state: AppState, run_id: &str, trends: F)
where
    F: Fn(TrendRun) -> Fut,
    Fut: Future<Output = Result<Vec<TrendPoint>, &'static str>>,
{
    let Ok(db) = state.connect() else { return };
    let Ok(Some((project_id, session_id))) = db
        .query_row(
            "SELECT project_id,session_id FROM discovery_runs WHERE id=?1",
            [run_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .optional()
    else {
        return;
    };
    let Some(session_id) = session_id else { return };
    let Ok(run) = discovery_store::get_run(&db, &project_id, run_id) else {
        return;
    };
    let format = if run.input_snapshot["platforms"]
        .as_array()
        .is_some_and(|platforms| {
            platforms
                .iter()
                .any(|item| item.as_str() == Some("youtube_shorts"))
                && !platforms
                    .iter()
                    .any(|item| item.as_str() == Some("youtube"))
        }) {
        "shorts"
    } else {
        "long"
    };
    let credential = state.credentials().youtube_key();
    let missing_key_reason = match credential.as_ref() {
        Err(crate::credentials::CredentialError::Denied) => "credential_denied",
        Err(crate::credentials::CredentialError::Unavailable | crate::credentials::CredentialError::Other) => "credential_unavailable",
        _ => "api_key_missing",
    };
    let client = credential
        .ok()
        .and_then(|key| YoutubeClient::from_key(key).ok());
    drop(db);

    let mut youtube_attempts = 0;
    let mut youtube_ok = 0;
    let mut trends_attempts = 0;
    let mut trends_ok = 0;
    let mut youtube_unknown = 0;
    let mut trends_unknown = 0;
    let mut blocked_trends: Option<&'static str> = None;
    let mut blocked_youtube = false;

    for idea in &run.candidates {
        if !still_collecting(&state, run_id) {
            return;
        }
        let query = query_for_idea(&idea.title);
        if !(3..=120).contains(&query.chars().count()) {
            continue;
        }
        // Existing saved data (including an interrupted paid attempt) is reused
        // and never silently consumed twice on restart.
        let previous_youtube = state.connect().ok().and_then(|db| {
            idea_market::latest_assessment(&db, &idea.id, epoch_now())
                .ok()
                .flatten()
        });
        if let Some(observation) = previous_youtube {
            if observation.state == "succeeded" {
                youtube_ok += 1;
            } else {
                youtube_unknown += 1;
            }
        } else if client.is_none()
            || blocked_youtube
            || youtube_attempts >= MAX_VIDEO_ATTEMPTS_PER_DISCOVERY
        {
            let reason = if client.is_none() {
                missing_key_reason
            } else if blocked_youtube {
                "provider_unavailable"
            } else {
                "collection_limit"
            };
            if let Ok(mut db) = state.connect() {
                let _ = idea_market::record_unavailable_assessment(
                    &mut db,
                    &project_id,
                    &session_id,
                    &idea.id,
                    &query,
                    format,
                    reason,
                    epoch_now(),
                );
            }
            youtube_unknown += 1;
        } else if let (Ok(mut db), Some(video_client)) = (state.connect(), client.as_ref()) {
            match idea_market::claim_assessment(
                &mut db,
                &project_id,
                &session_id,
                &idea.id,
                &query,
                format,
                epoch_now(),
            ) {
                Ok(reserved) => {
                    youtube_attempts += 1;
                    drop(db);
                    let result = tokio::time::timeout(
                        YOUTUBE_TIMEOUT,
                        idea_market::run_assessment(
                            state.clone(),
                            reserved.clone(),
                            video_client.clone(),
                        ),
                    )
                    .await;
                    if result.is_err()
                        && let Ok(db) = state.connect()
                    {
                        let _ = idea_market::fail_assessment(
                            &db,
                            &reserved.id,
                            "provider_unavailable",
                            epoch_now(),
                        );
                    }
                    let saved = state.connect().ok().and_then(|db| {
                        idea_market::latest_assessment(&db, &idea.id, epoch_now())
                            .ok()
                            .flatten()
                    });
                    if saved
                        .as_ref()
                        .and_then(|observation| observation.error_code.as_deref())
                        .is_some_and(should_circuit_youtube)
                    {
                        blocked_youtube = true;
                    }
                    let succeeded =
                        saved.is_some_and(|observation| observation.state == "succeeded");
                    if succeeded {
                        youtube_ok += 1;
                    } else {
                        youtube_unknown += 1;
                    }
                }
                Err(idea_market::IdeaMarketError::Budget) => {
                    let _ = idea_market::record_unavailable_assessment(
                        &mut db,
                        &project_id,
                        &session_id,
                        &idea.id,
                        &query,
                        format,
                        "budget_exhausted",
                        epoch_now(),
                    );
                    youtube_unknown += 1;
                }
                Err(_) => youtube_unknown += 1,
            }
        }

        if !still_collecting(&state, run_id) {
            return;
        }
        let previous_trends = state.connect().ok().and_then(|db| {
            idea_trends::latest_assessment(&db, &idea.id, epoch_now())
                .ok()
                .flatten()
        });
        if let Some(observation) = previous_trends {
            if observation.state == "succeeded" {
                trends_ok += 1;
            } else {
                trends_unknown += 1;
            }
            continue;
        }
        let skipped = blocked_trends.or(if trends_attempts >= MAX_TREND_ATTEMPTS_PER_DISCOVERY {
            Some("collection_limit")
        } else {
            None
        });
        if let Some(code) = skipped {
            if let Ok(mut db) = state.connect() {
                let _ = idea_trends::record_unavailable_assessment(
                    &mut db,
                    &idea.id,
                    &query,
                    code,
                    epoch_now(),
                );
            }
            trends_unknown += 1;
            continue;
        }
        let Ok(mut db) = state.connect() else { return };
        match idea_trends::claim_assessment(&mut db, &idea.id, &query, epoch_now()) {
            Ok(reserved) => {
                trends_attempts += 1;
                drop(db);
                // The same semaphore guards manual YouTube measurements,
                // automatic watchlists, and Google Trends provider calls.
                let Ok(_permit) = state.market_semaphore().acquire_owned().await else {
                    return;
                };
                let result = tokio::time::timeout(TRENDS_TIMEOUT, trends(reserved.clone())).await;
                let provider_result = match result {
                    Ok(value) => value,
                    Err(_) => Err("timeout"),
                };
                drop(_permit);
                if let Ok(db) = state.connect() {
                    match provider_result {
                        Ok(values) => {
                            if idea_trends::complete_assessment(
                                &db,
                                &reserved.id,
                                &values,
                                epoch_now(),
                            )
                            .is_ok()
                            {
                                trends_ok += 1;
                            } else {
                                let _ = idea_trends::fail_assessment(
                                    &db,
                                    &reserved.id,
                                    "invalid_payload",
                                    epoch_now(),
                                );
                                trends_unknown += 1;
                            }
                        }
                        Err(code) => {
                            // A blocked endpoint must not be hammered 12 more
                            // times just because candidate generation succeeded.
                            if matches!(
                                code,
                                "rate_limited"
                                    | "provider_unavailable"
                                    | "timeout"
                                    | "network_error"
                                    | "invalid_payload"
                            ) {
                                blocked_trends = Some(if code == "rate_limited" {
                                    "rate_limited"
                                } else {
                                    "provider_unavailable"
                                });
                            }
                            let _ =
                                idea_trends::fail_assessment(&db, &reserved.id, code, epoch_now());
                            trends_unknown += 1;
                        }
                    }
                }
            }
            Err(idea_trends::TrendsStoreError::Budget) => {
                let _ = idea_trends::record_unavailable_assessment(
                    &mut db,
                    &idea.id,
                    &query,
                    "budget_exhausted",
                    epoch_now(),
                );
                trends_unknown += 1;
            }
            Err(_) => trends_unknown += 1,
        }
    }
    // Unknown values must not become synthetic 0/50. The job itself can finish
    // as a partial success, with source-specific details persisted per idea.
    let state_name = if youtube_unknown == 0 && trends_unknown == 0 {
        "measured"
    } else {
        "partial"
    };
    let summary = json!({
        "state": state_name,
        "youtube": {"succeeded":youtube_ok,"unavailable":youtube_unknown,"attempts":youtube_attempts},
        "googleTrends": {"succeeded":trends_ok,"unavailable":trends_unknown,"attempts":trends_attempts},
    });
    if let Ok(db) = state.connect() {
        let _ = discovery_store::finish_market_run(&db, run_id, &summary, epoch_now());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        credentials::{CredentialError, CredentialStore, ProviderCredentials, ProviderId},
        db,
        research::{
            discovery_projects::{self, ProjectSnapshot},
            discovery_store,
            graph_store::{self, SourceDraft},
            idea_market, sessions_store,
        },
    };
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    struct NoCredentials;
    impl CredentialStore for NoCredentials {
        fn read(&self, _provider: ProviderId) -> Result<Option<String>, CredentialError> {
            Ok(None)
        }
        fn put(&self, _provider: ProviderId, _key: &str) -> Result<(), CredentialError> {
            Err(CredentialError::Missing)
        }
        fn delete(&self, _provider: ProviderId) -> Result<(), CredentialError> {
            Err(CredentialError::Missing)
        }
    }

    fn setup() -> (tempfile::TempDir, AppState, String, String) {
        setup_n(1)
    }

    fn setup_n(count: usize) -> (tempfile::TempDir, AppState, String, String) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("discovery.sqlite3");
        let mut db = db::open(&path).unwrap();
        db::migrate(&mut db).unwrap();
        discovery_projects::sync_project(
            &mut db,
            &ProjectSnapshot {
                id: "proj-homes".into(),
                name: "Home Costs".into(),
                notes: "Household costs".into(),
                updated_at: 100,
                content: vec![],
            },
            100,
        )
        .unwrap();
        let session = sessions_store::create_session(
            &db,
            "proj-homes",
            "October videos",
            &["youtube".into()],
            &serde_json::json!({"version":1}),
            100,
        )
        .unwrap();
        let source = graph_store::import_source(
            &db,
            "proj-homes",
            SourceDraft {
                url: "https://example.org/insulation-cost".into(),
                title: "Insulation cost report".into(),
                provider: "captured-web".into(),
                published_at: None,
                observed_at: 100,
                passage: Some(
                    "Homeowner expenses include insulation, property taxes, and water heaters."
                        .into(),
                ),
            },
        )
        .unwrap();
        let run = discovery_store::start_or_get_active_for_session(
            &mut db,
            "proj-homes",
            &session.id,
            "revision-1",
            101,
        )
        .unwrap();
        let subjects = [
            (
                "Why Home Insulation Installation Costs More",
                "insulation-installation-costs",
            ),
            (
                "How Property Tax Assessments Change Annual Housing Bills",
                "property-tax-assessment",
            ),
            (
                "When Water Heater Replacement Becomes Expensive",
                "water-heater-replacement",
            ),
        ];
        let ideas = subjects[..count]
            .iter()
            .map(|(title, angle)| discovery_store::CandidateDraft {
                title: (*title).into(),
                hook: "Where does money go?".into(),
                premise: "Compare home expenses".into(),
                why_now: "Current household budget".into(),
                angle_key: (*angle).into(),
                source_ids: vec![source.clone()],
                confidence: "medium".into(),
            })
            .collect();
        discovery_store::finish_run(&mut db, &run.id, ideas, "completed", 102).unwrap();
        let state = AppState::with_credentials(
            path,
            ProviderCredentials::new(Arc::new(NoCredentials), None),
        );
        (dir, state, session.id, run.id)
    }

    #[tokio::test]
    async fn unavailable_providers_complete_discovery_with_durable_partial_evidence() {
        let (_dir, state, session_id, run_id) = setup();
        process_pending_with(state.clone(), |_run| async { Err("provider_unavailable") }).await;
        let db = state.connect().unwrap();
        let run = discovery_store::get_run(&db, "proj-homes", &run_id).unwrap();
        assert_eq!(
            run.status, "completed",
            "Unreachable provider must not strand a Discovery job"
        );
        assert_eq!(run.stage, "completed");
        assert_eq!(run.provider_health["market"]["state"], "partial");
        let ideas = sessions_store::list_ideas(&db, "proj-homes", &session_id).unwrap();
        assert_eq!(ideas.len(), 1);
        let youtube = idea_market::latest_assessment(
            &db,
            &ideas[0].candidate.id,
            super::super::market_api::epoch_now(),
        )
        .unwrap()
        .unwrap();
        assert_eq!(youtube.error_code.as_deref(), Some("api_key_missing"));
        assert!(youtube.comparison_score.is_none());
        let budget: i64 = db
            .query_row("SELECT COUNT(*) FROM market_search_budget", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(budget, 0, "Unavailable key must never spend YouTube quota");
    }

    #[tokio::test]
    async fn repeated_polling_does_not_reissue_discovery_measurements() {
        let (_dir, state, _session, _run) = setup();
        process_pending_with(state.clone(), |_run| async { Err("provider_unavailable") }).await;
        let db = state.connect().unwrap();
        let before: i64 = db
            .query_row("SELECT COUNT(*) FROM idea_market_runs", [], |row| {
                row.get(0)
            })
            .unwrap();
        drop(db);
        process_pending_with(state.clone(), |_run| async {
            panic!("terminal run must not call provider")
        })
        .await;
        let db = state.connect().unwrap();
        let after: i64 = db
            .query_row("SELECT COUNT(*) FROM idea_market_runs", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(before, after);
    }

    #[tokio::test]
    async fn trends_rate_limit_stops_network_calls_but_records_each_unavailable_idea() {
        let (_dir, state, session_id, run_id) = setup_n(3);
        let calls = Arc::new(AtomicUsize::new(0));
        let visits = calls.clone();
        process_pending_with(state.clone(), move |_run| {
            let counter = visits.clone();
            async move {
                counter.fetch_add(1, Ordering::SeqCst);
                Err("rate_limited")
            }
        })
        .await;
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "One Google throttle must open the circuit for this entire discovery"
        );
        let db = state.connect().unwrap();
        let run = discovery_store::get_run(&db, "proj-homes", &run_id).unwrap();
        assert_eq!(run.status, "completed");
        let ideas = sessions_store::list_ideas(&db, "proj-homes", &session_id).unwrap();
        assert_eq!(ideas.len(), 3);
        let unavailable: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM idea_trends_runs WHERE state='unavailable'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(unavailable, 2);
        let failed: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM idea_trends_runs WHERE state='failed'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(failed, 1);
    }

    #[test]
    fn systemic_youtube_failures_open_the_discovery_circuit() {
        for code in [
            "quota_exceeded",
            "rate_limited",
            "api_key_invalid",
            "api_key_restricted",
            "api_not_enabled",
            "permission",
            "provider_unavailable",
            "payload_invalid",
        ] {
            assert!(
                should_circuit_youtube(code),
                "Provider-wide failure must not spend another search: {code}"
            );
        }
        assert!(
            !should_circuit_youtube("invalid_request"),
            "A bad query for one idea need not prevent valid later ideas"
        );
    }
}
