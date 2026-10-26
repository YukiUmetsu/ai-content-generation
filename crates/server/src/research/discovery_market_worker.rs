//! Automatic market enrichment belongs to Discovery, not to the selection UI.
//! SQLite owns the run lease and every provider reservation; a failed provider
//! never holds the Discovery job open indefinitely.

use super::{
    discovery_store,
    google_ads::{self, AdsError, GoogleAdsClient},
    idea_market,
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
const MAX_GOOGLE_ADS_ATTEMPTS_PER_DISCOVERY: usize = 8;
const YOUTUBE_TIMEOUT: Duration = Duration::from_secs(150);
const TRENDS_TIMEOUT: Duration = Duration::from_secs(12);
const GOOGLE_ADS_TIMEOUT: Duration = Duration::from_secs(32);

fn query_plan_for_idea(title: &str) -> Vec<String> {
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
        "missing",
        "link",
        "secret",
        "shocking",
        "truth",
        "revealed",
        "in",
    ];
    let words = title
        .split(|character: char| !(character.is_alphanumeric() || character == '-'))
        .map(str::to_ascii_lowercase)
        .filter(|word| !word.is_empty() && !SKIP.contains(&word.as_str()))
        .take(9)
        .collect::<Vec<_>>();
    let mut queries = vec![];
    let base = words.join(" ");
    if base.chars().count() >= 3 {
        queries.push(base.chars().take(120).collect::<String>());
    }
    if words.len() >= 3 {
        // Broadening one modifier often exposes genuine viewer language while
        // preserving at least two subject words. Never fall back to generic
        // single-word queries such as "house" or "math".
        let modifier = words
            .iter()
            .position(|word| word == "file" || word == "files");
        let reduced = words
            .iter()
            .enumerate()
            .filter(|(index, _)| modifier.map_or(*index < words.len() - 1, |at| *index != at))
            .map(|(_, word)| word.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        if reduced.split_whitespace().count() >= 2 && !queries.iter().any(|query| query == &reduced)
        {
            queries.push(reduced.chars().take(120).collect());
        }
    }
    if queries.is_empty() && title.trim().chars().count() >= 3 {
        queries.push(title.trim().chars().take(120).collect::<String>());
    }
    queries
}

fn query_for_idea(title: &str) -> String {
    query_plan_for_idea(title)
        .into_iter()
        .next()
        .unwrap_or_default()
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
    eprintln!(
        "contentgen-server: discovery_market_job_started run_id={} kind={} ideas={}",
        run_id,
        if run.provider_health["marketBackfill"] == "queued" {
            "retry"
        } else {
            "initial"
        },
        run.candidates.len(),
    );
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
        Err(
            crate::credentials::CredentialError::Unavailable
            | crate::credentials::CredentialError::Other,
        ) => "credential_unavailable",
        _ => "api_key_missing",
    };
    let client = credential
        .ok()
        .and_then(|key| YoutubeClient::from_key(key).ok());
    let ads_client = GoogleAdsClient::from_env().ok();
    drop(db);

    let mut youtube_attempts = 0;
    let mut youtube_ok = 0;
    let mut trends_attempts = 0;
    let mut trends_ok = 0;
    let mut youtube_unknown = 0;
    let mut trends_unknown = 0;
    let mut blocked_trends: Option<&'static str> = None;
    let mut blocked_youtube: Option<&'static str> = None;
    let mut ads_attempts = 0;
    let mut ads_ok = 0;
    let mut ads_unknown = 0;
    let mut ads_blocked = false;

    for idea in &run.candidates {
        if !still_collecting(&state, run_id) {
            return;
        }
        let query_plan = query_plan_for_idea(&idea.title);
        let query = query_for_idea(&idea.title);
        if !(3..=120).contains(&query.chars().count()) {
            continue;
        }
        // A saved failed/unavailable attempt must not permanently suppress
        // collection. The same durable eligibility policy is used by the queue
        // and worker; successful or still-cooling-down data is reused.
        let (retry_youtube, retry_trends) = match state.connect() {
            Ok(db) => match discovery_store::market_retry_due(
                &db,
                &idea.id,
                epoch_now(),
                client.is_some(),
            ) {
                Ok(due) => due,
                Err(_) => return,
            },
            Err(_) => return,
        };
        let previous_youtube = state.connect().ok().and_then(|db| {
            idea_market::latest_assessment(&db, &idea.id, epoch_now())
                .ok()
                .flatten()
        });
        if let Some(observation) = previous_youtube.as_ref().filter(|_| !retry_youtube) {
            if observation.state == "succeeded" {
                youtube_ok += 1;
            } else {
                youtube_unknown += 1;
            }
        } else if client.is_none()
            || blocked_youtube.is_some()
            || youtube_attempts >= MAX_VIDEO_ATTEMPTS_PER_DISCOVERY
        {
            let reason = if client.is_none() {
                missing_key_reason
            } else {
                blocked_youtube.unwrap_or("collection_limit")
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
                        idea_market::run_assessment_with_queries(
                            state.clone(),
                            reserved.clone(),
                            video_client.clone(),
                            &query_plan[1..],
                        ),
                    )
                    .await;
                    if let Ok(db) = state.connect() {
                        let additional_calls: i64 = db
                            .query_row(
                                "SELECT COUNT(*) FROM idea_market_search_queries WHERE run_id=?1",
                                [&reserved.id],
                                |r| r.get(0),
                            )
                            .unwrap_or(0);
                        youtube_attempts += additional_calls as usize;
                    }
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
                    if let Some(code) = saved
                        .as_ref()
                        .and_then(|observation| observation.error_code.as_deref())
                        .filter(|code| should_circuit_youtube(code))
                    {
                        // A shared quota denial must cool down the remaining
                        // ideas for a full day, not trigger retries every 6h.
                        blocked_youtube =
                            Some(if matches!(code, "quota_exceeded" | "rate_limited") {
                                "budget_exhausted"
                            } else {
                                "provider_unavailable"
                            });
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

        // Google Ads is entirely optional. Its metrics are *Google Search*
        // keyword estimates; they never unblock or falsify YouTube demand.
        if let Some(ads) = ads_client.as_ref() {
            let latest = state
                .connect()
                .ok()
                .and_then(|db| google_ads::latest_assessment(&db, &idea.id).ok().flatten());
            let fresh = latest.as_ref().is_some_and(|saved| {
                epoch_now().saturating_sub(saved.observed_at)
                    < if saved.state == "succeeded" {
                        30 * 86_400
                    } else {
                        6 * 3_600
                    }
            });
            if fresh {
                if latest
                    .as_ref()
                    .is_some_and(|saved| saved.state == "succeeded")
                {
                    ads_ok += 1;
                } else {
                    ads_unknown += 1;
                }
            } else if ads_attempts < MAX_GOOGLE_ADS_ATTEMPTS_PER_DISCOVERY && !ads_blocked {
                ads_attempts += 1;
                let result = match tokio::time::timeout(
                    GOOGLE_ADS_TIMEOUT,
                    ads.generate_keyword_ideas(&query_plan),
                )
                .await
                {
                    Ok(value) => value,
                    Err(_) => Err(AdsError::Unavailable),
                };
                if let Err(error) = &result {
                    eprintln!(
                        "contentgen-server: google_ads_keyword_failure reason={}",
                        error.code()
                    );
                    ads_blocked = matches!(
                        error,
                        AdsError::Authentication
                            | AdsError::Permission
                            | AdsError::Quota
                            | AdsError::Unavailable
                    );
                    ads_unknown += 1;
                } else {
                    ads_ok += 1;
                }
                if let Ok(mut db) = state.connect() {
                    let _ = google_ads::save_assessment(
                        &mut db,
                        &idea.id,
                        &query,
                        result.as_ref().map(|items| items.as_slice()),
                        epoch_now(),
                    );
                }
            } else {
                ads_unknown += 1;
                // A finite per-run limit must not make skipped ideas look
                // permanently unobserved and trigger immediate requeue loops.
                if let Ok(mut db) = state.connect() {
                    let _ = google_ads::save_assessment(
                        &mut db,
                        &idea.id,
                        &query,
                        Err(&AdsError::CollectionLimit),
                        epoch_now(),
                    );
                }
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
        if let Some(observation) = previous_trends.as_ref().filter(|_| !retry_trends) {
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
        "googleAds": {"state":if ads_client.is_some() { "configured" } else { "not_configured" },
          "succeeded":ads_ok,"unavailable":ads_unknown,"attempts":ads_attempts},
    });
    if let Ok(db) = state.connect() {
        match discovery_store::finish_market_run(&db, run_id, &summary, epoch_now()) {
            Ok(true) => eprintln!(
                "contentgen-server: discovery_market_job_finished run_id={} state={} youtube_ok={} trends_ok={} youtube_attempts={} trends_attempts={}",
                run_id, state_name, youtube_ok, trends_ok, youtube_attempts, trends_attempts,
            ),
            Ok(false) => eprintln!(
                "contentgen-server: discovery_market_job_skipped run_id={} reason=cancelled_or_paused",
                run_id,
            ),
            Err(_) => eprintln!(
                "contentgen-server: discovery_market_job_failed run_id={} reason=database",
                run_id,
            ),
        }
    } else {
        eprintln!(
            "contentgen-server: discovery_market_job_failed run_id={} reason=database_unavailable",
            run_id,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn editorial_title_produces_distinct_viewer_searches_without_hook_words() {
        let queries = query_plan_for_idea("The Missing Link in Bookkeeping File Automation");
        assert_eq!(queries[0], "bookkeeping file automation");
        assert!(queries.contains(&"bookkeeping automation".to_owned()));
        assert!(queries.len() >= 2 && queries.len() <= 3);
        assert!(queries.iter().all(|query| !query.contains("missing link")));
    }

    #[test]
    fn short_specific_topic_does_not_expand_to_generic_single_word_searches() {
        let queries = query_plan_for_idea("Why Home Insulation Installation Costs More");
        assert_eq!(queries[0], "home insulation installation costs");
        assert!(
            queries
                .iter()
                .all(|query| query.split_whitespace().count() >= 2)
        );
        assert_eq!(
            queries
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len(),
            queries.len()
        );
    }

    #[test]
    fn search_expansion_preserves_topic_intent_and_bounded_queries() {
        assert_eq!(
            query_plan_for_idea("The Missing Link in Bookkeeping File Automation"),
            vec!["bookkeeping file automation", "bookkeeping automation"]
        );
        assert!(query_plan_for_idea("How To Save Money").len() <= 2);
    }

    #[test]
    fn secondary_search_reserves_shared_budget_only_once() {
        let (_dir, state, session_id, _) = setup();
        let mut db = state.connect().unwrap();
        let idea_id = sessions_store::list_ideas(&db, "proj-homes", &session_id).unwrap()[0]
            .candidate
            .id
            .clone();
        let reserved = idea_market::claim_assessment(
            &mut db,
            "proj-homes",
            &session_id,
            &idea_id,
            "home insulation installation costs",
            "long",
            epoch_now(),
        )
        .unwrap();
        assert!(
            idea_market::reserve_additional_search(
                &mut db,
                &reserved.id,
                1,
                "home insulation installation",
                epoch_now()
            )
            .unwrap()
        );
        assert!(
            !idea_market::reserve_additional_search(
                &mut db,
                &reserved.id,
                1,
                "home insulation installation",
                epoch_now()
            )
            .unwrap()
        );
        let uses: i64 = db
            .query_row("SELECT COUNT(*) FROM market_search_budget", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(uses, 2);
    }

    #[test]
    fn secondary_search_stops_at_shared_daily_limit() {
        let (_dir, state, session_id, _) = setup();
        let mut db = state.connect().unwrap();
        let idea_id = sessions_store::list_ideas(&db, "proj-homes", &session_id).unwrap()[0]
            .candidate
            .id
            .clone();
        let reserved = idea_market::claim_assessment(
            &mut db,
            "proj-homes",
            &session_id,
            &idea_id,
            "home insulation installation costs",
            "long",
            epoch_now(),
        )
        .unwrap();
        for index in 0..19 {
            db.execute(
                "INSERT INTO market_search_budget(run_id,reserved_at) VALUES(?1,?2)",
                rusqlite::params![format!("other-{index}"), epoch_now()],
            )
            .unwrap();
        }
        assert!(
            !idea_market::reserve_additional_search(
                &mut db,
                &reserved.id,
                1,
                "home insulation installation",
                epoch_now()
            )
            .unwrap()
        );
    }

    #[test]
    fn three_other_channel_uploads_produce_provisional_score_without_three_ideas() {
        let (_dir, state, session_id, _) = setup();
        let mut db = state.connect().unwrap();
        let idea_id = sessions_store::list_ideas(&db, "proj-homes", &session_id).unwrap()[0]
            .candidate
            .id
            .clone();
        let now = epoch_now();
        let run = idea_market::claim_assessment(
            &mut db,
            "proj-homes",
            &session_id,
            &idea_id,
            "home insulation installation costs",
            "long",
            now,
        )
        .unwrap();
        let observed_date = |age_days: i64| -> String {
            db.query_row(
                "SELECT strftime('%Y-%m-%dT%H:%M:%SZ',?1,'unixepoch')",
                [now - age_days * 86_400],
                |r| r.get(0),
            )
            .unwrap()
        };
        let mk = |id: &str, views: i64, days: i64| super::super::market_store::VideoObservation {
            video_id: id.into(),
            title: "Home insulation installation costs".into(),
            channel_id: "UChome".into(),
            channel_title: "Demo".into(),
            published_at: observed_date(days),
            duration_seconds: Some(500),
            view_count: Some(views),
            like_count: None,
            comment_count: None,
            subscriber_count: None,
        };
        let target = mk("abcABC12345", 30_000, 30);
        idea_market::save_channel_baselines(
            &db,
            &run.id,
            &[
                mk("otherAB1234", 3_000, 30),
                mk("otherAB1235", 3_600, 30),
                mk("otherAB1236", 4_000, 30),
            ],
            now,
        )
        .unwrap();
        idea_market::complete_assessment(&db, &run.id, &[target], now).unwrap();
        let assessment = idea_market::latest_assessment(&db, &idea_id, now)
            .unwrap()
            .unwrap();
        assert_eq!(assessment.sample_size, 1);
        assert_eq!(assessment.channel_baseline_videos, 3);
        assert_eq!(assessment.channel_baseline_channels, 1);
        assert_eq!(assessment.channel_baseline_examples.len(), 3);
        assert!(assessment.channel_baseline_examples.iter().all(|source| {
            source
                .source_url
                .starts_with("https://www.youtube.com/watch?v=")
                && source.title == "Home insulation installation costs"
        }));
        assert!(assessment.channel_breakout_score.unwrap() > 70.0);
        let potential = crate::research::viral_potential::assess(Some(&assessment), None);
        assert_eq!(potential.state, "provisional");
        assert!(potential.score.is_some());
    }

    #[test]
    fn google_ads_search_volume_is_saved_as_optional_separate_evidence() {
        let (_dir, state, session_id, _) = setup();
        let mut db = state.connect().unwrap();
        let idea_id = sessions_store::list_ideas(&db, "proj-homes", &session_id).unwrap()[0]
            .candidate
            .id
            .clone();
        assert!(
            google_ads::latest_assessment(&db, &idea_id)
                .unwrap()
                .is_none()
        );
        google_ads::save_assessment(
            &mut db,
            &idea_id,
            "home insulation costs",
            Ok(&[google_ads::KeywordIdea {
                keyword: "home insulation cost".into(),
                close_variants: vec!["insulation installation".into()],
                google_monthly_searches: Some(8100),
                advertiser_competition: Some("HIGH".into()),
                low_top_page_bid_micros: None,
                high_top_page_bid_micros: None,
            }]),
            epoch_now(),
        )
        .unwrap();
        let observation = google_ads::latest_assessment(&db, &idea_id)
            .unwrap()
            .unwrap();
        assert_eq!(observation.metric_version, "google-ads-search-keywords-v1");
        assert_eq!(observation.keywords[0].google_monthly_searches, Some(8100));
        let ideas = sessions_store::list_ideas(&db, "proj-homes", &session_id).unwrap();
        assert_eq!(
            ideas[0].google_ads.as_ref().unwrap().keywords[0].keyword,
            "home insulation cost"
        );
    }

    #[test]
    fn seven_day_growth_is_unknown_until_two_real_dated_snapshots_exist() {
        let (_dir, state, session_id, _) = setup();
        let mut db = state.connect().unwrap();
        let idea_id = sessions_store::list_ideas(&db, "proj-homes", &session_id).unwrap()[0]
            .candidate
            .id
            .clone();
        let now = epoch_now();
        let previous = now - 8 * 86_400;
        let run = idea_market::claim_assessment(
            &mut db,
            "proj-homes",
            &session_id,
            &idea_id,
            "home insulation installation costs",
            "long",
            previous,
        )
        .unwrap();
        let date: String = db
            .query_row(
                "SELECT strftime('%Y-%m-%dT%H:%M:%SZ',?1,'unixepoch')",
                [previous - 30 * 86_400],
                |r| r.get(0),
            )
            .unwrap();
        idea_market::complete_assessment(
            &db,
            &run.id,
            &[super::super::market_store::VideoObservation {
                video_id: "abcABC12345".into(),
                title: "Home insulation installation costs".into(),
                channel_id: "UChome".into(),
                channel_title: "Demo".into(),
                published_at: date,
                duration_seconds: Some(600),
                view_count: Some(12_000),
                like_count: None,
                comment_count: None,
                subscriber_count: None,
            }],
            previous,
        )
        .unwrap();
        let initial = idea_market::latest_assessment(&db, &idea_id, now)
            .unwrap()
            .unwrap();
        assert_eq!(initial.observed_7d_median_view_delta, None);
        let (refresh_id, ids) = idea_market::claim_video_refresh(&mut db, now)
            .unwrap()
            .unwrap();
        assert_eq!(ids, vec!["abcABC12345"]);
        idea_market::finish_video_refresh(
            &db,
            &refresh_id,
            &ids,
            &[("abcABC12345".into(), 15_600)],
            Ok(()),
            now,
        )
        .unwrap();
        let measured = idea_market::latest_assessment(&db, &idea_id, now)
            .unwrap()
            .unwrap();
        assert_eq!(measured.observed_7d_median_view_delta, Some(3600.0));
        assert_eq!(measured.observed_7d_video_count, 1);
        assert_eq!(measured.observed_30d_median_view_delta, None);
        assert!(
            idea_market::claim_video_refresh(&mut db, now)
                .unwrap()
                .is_none()
        );
    }

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
    async fn completed_session_with_no_market_observations_is_backfilled_once() {
        let (_dir, state, session_id, run_id) = setup();
        let mut db = state.connect().unwrap();
        // Simulate a completed session created before automatic market enrichment.
        db.execute(
            "UPDATE discovery_runs SET status='completed',stage='completed'
                    WHERE id=?1",
            [&run_id],
        )
        .unwrap();
        let queued = discovery_store::queue_missing_market_runs(
            &mut db,
            Some(("proj-homes", &session_id)),
            epoch_now(),
            false,
        )
        .unwrap();
        assert_eq!(queued, vec![run_id.clone()]);
        assert!(
            discovery_store::queue_missing_market_runs(
                &mut db,
                Some(("proj-homes", &session_id)),
                epoch_now(),
                false,
            )
            .unwrap()
            .is_empty(),
            "double-click must not enqueue twice"
        );
        let pending = discovery_store::get_run(&db, "proj-homes", &run_id).unwrap();
        assert_eq!(pending.stage, "measure_market");
        assert_eq!(pending.provider_health["marketBackfill"], "queued");
        drop(db);

        process_pending_with(state.clone(), |_run| async { Err("provider_unavailable") }).await;
        let mut db = state.connect().unwrap();
        let completed = discovery_store::get_run(&db, "proj-homes", &run_id).unwrap();
        assert_eq!(completed.status, "completed");
        assert_eq!(completed.provider_health["marketBackfill"], "completed");
        let ideas = sessions_store::list_ideas(&db, "proj-homes", &session_id).unwrap();
        assert!(ideas[0].market_assessment.is_some());
        assert!(ideas[0].google_trends.is_some());
        assert!(
            discovery_store::queue_missing_market_runs(
                &mut db,
                Some(("proj-homes", &session_id)),
                epoch_now(),
                false,
            )
            .unwrap()
            .is_empty(),
            "completed backfill must not loop"
        );
        let budget: i64 = db
            .query_row("SELECT COUNT(*) FROM market_search_budget", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(budget, 0, "missing YouTube key must not spend quota");
    }

    #[tokio::test]
    async fn backfill_serializes_multiple_completed_runs_in_one_session() {
        let (_dir, state, session_id, first_id) = setup();
        let mut db = state.connect().unwrap();
        let first = discovery_store::get_run(&db, "proj-homes", &first_id).unwrap();
        db.execute(
            "UPDATE discovery_runs SET status='completed',stage='completed'
                    WHERE id=?1",
            [&first_id],
        )
        .unwrap();
        let second = discovery_store::start_or_get_active_for_session(
            &mut db,
            "proj-homes",
            &session_id,
            "revision-2",
            104,
        )
        .unwrap();
        discovery_store::finish_run(
            &mut db,
            &second.id,
            vec![discovery_store::CandidateDraft {
                title: "The cost of replacing a water heater".into(),
                hook: "What will it cost?".into(),
                premise: "Compare water heater expenses".into(),
                why_now: "Maintenance costs are rising".into(),
                angle_key: "water-heater-expenses".into(),
                source_ids: first.candidates[0].source_ids.clone(),
                confidence: "medium".into(),
            }],
            "completed",
            105,
        )
        .unwrap();
        db.execute(
            "UPDATE discovery_runs SET status='completed',stage='completed'
                    WHERE id=?1",
            [&second.id],
        )
        .unwrap();
        let first_batch = discovery_store::queue_missing_market_runs(
            &mut db,
            Some(("proj-homes", &session_id)),
            epoch_now(),
            false,
        )
        .unwrap();
        assert_eq!(first_batch, vec![first_id.clone()]);
        assert!(
            discovery_store::queue_missing_market_runs(
                &mut db,
                Some(("proj-homes", &session_id)),
                epoch_now(),
                false,
            )
            .unwrap()
            .is_empty(),
            "only one active market job per session"
        );
        drop(db);

        process_pending_with(state.clone(), |_run| async { Err("provider_unavailable") }).await;
        let mut db = state.connect().unwrap();
        let second_batch = discovery_store::queue_missing_market_runs(
            &mut db,
            Some(("proj-homes", &session_id)),
            epoch_now(),
            false,
        )
        .unwrap();
        assert_eq!(second_batch, vec![second.id.clone()]);
        drop(db);
        process_pending_with(state.clone(), |_run| async { Err("provider_unavailable") }).await;
        let db = state.connect().unwrap();
        assert_eq!(
            discovery_store::get_run(&db, "proj-homes", &second.id)
                .unwrap()
                .status,
            "completed"
        );
        assert_eq!(
            sessions_store::list_ideas(&db, "proj-homes", &session_id)
                .unwrap()
                .len(),
            2
        );
    }

    #[tokio::test]
    async fn backfill_only_collects_missing_provider_and_preserves_saved_youtube() {
        let (_dir, state, session_id, run_id) = setup();
        process_pending_with(state.clone(), |_run| async { Err("provider_unavailable") }).await;
        let mut db = state.connect().unwrap();
        let ideas = sessions_store::list_ideas(&db, "proj-homes", &session_id).unwrap();
        db.execute(
            "DELETE FROM idea_trends_runs WHERE idea_id=?1",
            [&ideas[0].candidate.id],
        )
        .unwrap();
        let youtube_before: i64 = db
            .query_row("SELECT COUNT(*) FROM idea_market_runs", [], |row| {
                row.get(0)
            })
            .unwrap();
        let queued = discovery_store::queue_missing_market_runs(
            &mut db,
            Some(("proj-homes", &session_id)),
            epoch_now(),
            false,
        )
        .unwrap();
        assert_eq!(queued, vec![run_id]);
        drop(db);
        process_pending_with(state.clone(), |_run| async { Err("provider_unavailable") }).await;
        let db = state.connect().unwrap();
        let youtube_after: i64 = db
            .query_row("SELECT COUNT(*) FROM idea_market_runs", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(
            youtube_before, youtube_after,
            "saved YouTube result must be reused"
        );
        let trends_after: i64 = db
            .query_row("SELECT COUNT(*) FROM idea_trends_runs", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(trends_after, 1);
    }

    #[test]
    fn backfill_is_scoped_and_does_not_queue_active_or_archived_sessions() {
        let (_dir, state, session_id, run_id) = setup();
        let mut db = state.connect().unwrap();
        assert!(
            discovery_store::queue_missing_market_runs(
                &mut db,
                Some(("other-project", &session_id)),
                epoch_now(),
                false,
            )
            .is_err(),
            "cross-project session must not be writable"
        );
        assert!(
            discovery_store::queue_missing_market_runs(
                &mut db,
                Some(("proj-homes", &session_id)),
                epoch_now(),
                false,
            )
            .unwrap()
            .is_empty(),
            "initial market job is already active"
        );
        db.execute(
            "UPDATE discovery_runs SET status='completed',stage='completed'
                    WHERE id=?1",
            [&run_id],
        )
        .unwrap();
        db.execute(
            "UPDATE content_discovery_sessions SET archived_at=?2 WHERE id=?1",
            rusqlite::params![session_id, epoch_now()],
        )
        .unwrap();
        assert!(
            discovery_store::queue_missing_market_runs(&mut db, None, epoch_now(), false,)
                .unwrap()
                .is_empty(),
            "archived sessions must not be reactivated"
        );
    }

    #[tokio::test]
    async fn failed_google_trends_is_retried_after_cooldown_without_youtube_key() {
        let (_dir, state, session_id, run_id) = setup();
        process_pending_with(state.clone(), |_run| async { Err("provider_unavailable") }).await;
        let mut db = state.connect().unwrap();
        assert!(
            discovery_store::queue_missing_market_runs(
                &mut db,
                Some(("proj-homes", &session_id)),
                epoch_now(),
                false,
            )
            .unwrap()
            .is_empty(),
            "fresh provider failures must cool down"
        );
        db.execute(
            "UPDATE idea_trends_runs SET started_at=?1 WHERE state='failed'",
            [epoch_now() - 7 * 3_600],
        )
        .unwrap();
        db.execute(
            "UPDATE discovery_runs SET provider_health_json=json_set(
                provider_health_json,'$.marketBackfill','completed') WHERE id=?1",
            [&run_id],
        )
        .unwrap();
        let queued = discovery_store::queue_missing_market_runs(
            &mut db,
            Some(("proj-homes", &session_id)),
            epoch_now(),
            false,
        )
        .unwrap();
        assert_eq!(
            queued,
            vec![run_id.clone()],
            "Trends must retry independently of YouTube"
        );
        drop(db);

        let calls = Arc::new(AtomicUsize::new(0));
        let seen = calls.clone();
        process_pending_with(state.clone(), move |_run| {
            let seen = seen.clone();
            async move {
                seen.fetch_add(1, Ordering::SeqCst);
                Err("provider_unavailable")
            }
        })
        .await;
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "retry must actually invoke provider"
        );
        let db = state.connect().unwrap();
        let attempts: i64 = db
            .query_row("SELECT COUNT(*) FROM idea_trends_runs", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(attempts, 2, "retry must persist a new attempt");
        let youtube: i64 = db
            .query_row("SELECT COUNT(*) FROM market_search_budget", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(youtube, 0, "no YouTube key must not consume budget");
    }

    #[test]
    fn adding_youtube_key_requeues_previously_unavailable_assessment_immediately() {
        let (_dir, state, session_id, run_id) = setup();
        let db = state.connect().unwrap();
        let idea_id = sessions_store::list_ideas(&db, "proj-homes", &session_id).unwrap()[0]
            .candidate
            .id
            .clone();
        drop(db);
        let mut db = state.connect().unwrap();
        idea_market::record_unavailable_assessment(
            &mut db,
            "proj-homes",
            &session_id,
            &idea_id,
            "home insulation costs",
            "long",
            "api_key_missing",
            epoch_now(),
        )
        .unwrap();
        // Keep Trends fresh so only YouTube can make this run eligible.
        idea_trends::record_unavailable_assessment(
            &mut db,
            &idea_id,
            "home insulation costs",
            "rate_limited",
            epoch_now(),
        )
        .unwrap();
        db.execute(
            "UPDATE discovery_runs SET status='completed',stage='completed'
                    WHERE id=?1",
            [&run_id],
        )
        .unwrap();
        assert_eq!(
            discovery_store::market_retry_due(&db, &idea_id, epoch_now(), false).unwrap(),
            (false, false)
        );
        assert_eq!(
            discovery_store::market_retry_due(&db, &idea_id, epoch_now(), true).unwrap(),
            (true, false)
        );
        assert!(
            discovery_store::queue_missing_market_runs(
                &mut db,
                Some(("proj-homes", &session_id)),
                epoch_now(),
                false,
            )
            .unwrap()
            .is_empty()
        );
        assert_eq!(
            discovery_store::queue_missing_market_runs(
                &mut db,
                Some(("proj-homes", &session_id)),
                epoch_now(),
                true,
            )
            .unwrap(),
            vec![run_id]
        );
    }

    #[test]
    fn rate_limited_provider_attempts_wait_a_day_and_completed_data_is_preserved() {
        let (_dir, state, session_id, run_id) = setup();
        let mut db = state.connect().unwrap();
        let idea_id = sessions_store::list_ideas(&db, "proj-homes", &session_id).unwrap()[0]
            .candidate
            .id
            .clone();
        idea_market::record_unavailable_assessment(
            &mut db,
            "proj-homes",
            &session_id,
            &idea_id,
            "home insulation costs",
            "long",
            "budget_exhausted",
            epoch_now(),
        )
        .unwrap();
        idea_trends::record_unavailable_assessment(
            &mut db,
            &idea_id,
            "home insulation costs",
            "rate_limited",
            epoch_now(),
        )
        .unwrap();
        db.execute(
            "UPDATE discovery_runs SET status='completed',stage='completed'
                    WHERE id=?1",
            [&run_id],
        )
        .unwrap();
        assert_eq!(
            discovery_store::market_retry_due(&db, &idea_id, epoch_now(), true).unwrap(),
            (false, false)
        );
        db.execute(
            "UPDATE idea_market_runs SET started_at=?1 WHERE idea_id=?2",
            rusqlite::params![epoch_now() - 25 * 3_600, idea_id],
        )
        .unwrap();
        db.execute(
            "UPDATE idea_trends_runs SET started_at=?1 WHERE idea_id=?2",
            rusqlite::params![epoch_now() - 25 * 3_600, idea_id],
        )
        .unwrap();
        assert_eq!(
            discovery_store::market_retry_due(&db, &idea_id, epoch_now(), true).unwrap(),
            (true, true)
        );
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
