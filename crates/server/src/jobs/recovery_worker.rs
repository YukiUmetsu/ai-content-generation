//! Lightweight SQLite maintenance for abandoned video-worker claims.
//!
//! This process never renders, transmits text, renews permissions or retries
//! media. It only makes expired attempts READY so a separately authorized
//! coordinator can resume valid, content-addressed work.

use std::time::Duration;

use crate::state::AppState;

use super::{JobsError, scheduler};

pub fn recover_once(state: &AppState) -> Result<usize, JobsError> {
    let mut db = state.connect()?;
    Ok(scheduler::reconcile_all_stale_video_attempts(&mut db)?.len())
}

pub fn spawn(state: AppState) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut ticks = tokio::time::interval(Duration::from_secs(30));
        ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            ticks.tick().await;
            match recover_once(&state) {
                Ok(count) if count > 0 => {
                    eprintln!("contentgen-server: recovered {count} interrupted video attempts");
                }
                Ok(_) => {}
                Err(_) => {
                    // Do not include database errors or private paths in logs.
                    // A failed sweep leaves every attempt unchanged and retries
                    // on the next bounded tick.
                    eprintln!("contentgen-server: video recovery sweep unavailable");
                }
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use contentgen_core::jobs::{AttemptState, JobState};
    use serde_json::json;

    use super::*;
    use crate::db;
    use crate::jobs::scheduler::{NodeRequest, SubmitOutcome, SubmitRequest};

    fn spec(kind: &str, key: &str, steps: &[(&str, &[&str])]) -> SubmitRequest {
        SubmitRequest {
            job_kind: kind.to_owned(),
            idempotency_key: key.to_owned(),
            nodes: steps
                .iter()
                .map(|(key, deps)| NodeRequest {
                    node_key: (*key).to_owned(),
                    node_kind: format!("{kind}.{key}"),
                    max_attempts: 3,
                    input: json!({}),
                    depends_on: deps.iter().map(|dep| (*dep).to_owned()).collect(),
                })
                .collect(),
        }
    }

    #[tokio::test]
    async fn periodic_recovery_rearms_only_expired_video_nodes_without_losing_completed_work() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("jobs.sqlite");
        let mut db = db::open(&path).unwrap();
        db::migrate(&mut db).unwrap();
        let request = spec(
            "video-production",
            "recovery-test-video",
            &[("plan", &[]), ("render", &["plan"])],
        );
        let SubmitOutcome::Created(saved) = scheduler::submit(&mut db, &request).unwrap() else {
            panic!("new production expected");
        };
        let job_id = &saved.dag.job.id;
        let plan = &saved
            .dag
            .nodes
            .iter()
            .find(|item| item.node_key == "plan")
            .unwrap()
            .id;
        let render = &saved
            .dag
            .nodes
            .iter()
            .find(|item| item.node_key == "render")
            .unwrap()
            .id;
        let plan_attempt = scheduler::begin_attempt(&mut db, job_id, plan).unwrap();
        scheduler::succeed_attempt(
            &mut db,
            plan,
            &plan_attempt.id,
            json!({"sha256":"a".repeat(64)}),
        )
        .unwrap();
        let interrupted = scheduler::begin_attempt(&mut db, job_id, render).unwrap();
        db.execute(
            "UPDATE job_nodes SET created_at = '2000-01-01T00:00:00Z',
             updated_at = '2000-01-01T00:00:00Z' WHERE id = ?1",
            [render],
        )
        .unwrap();

        // A live production and a legacy non-video task must never be touched
        // by the video recovery sweeper, even when timestamps are misleading.
        let live = spec(
            "video-render-segment",
            "recovery-test-live",
            &[("segment", &[])],
        );
        let SubmitOutcome::Created(live_job) = scheduler::submit(&mut db, &live).unwrap() else {
            panic!("new live worker expected");
        };
        let live_id = &live_job.dag.job.id;
        let live_node = &live_job.dag.nodes[0].id;
        let live_attempt = scheduler::begin_attempt(&mut db, live_id, live_node).unwrap();
        let unrelated = spec(
            "research-refresh",
            "recovery-test-research",
            &[("fetch", &[])],
        );
        let SubmitOutcome::Created(other_job) = scheduler::submit(&mut db, &unrelated).unwrap()
        else {
            panic!("new research job expected");
        };
        let other_id = &other_job.dag.job.id;
        let other_node = &other_job.dag.nodes[0].id;
        scheduler::begin_attempt(&mut db, other_id, other_node).unwrap();
        db.execute(
            "UPDATE job_nodes SET created_at = '2000-01-01T00:00:00Z',
             updated_at = '2000-01-01T00:00:00Z' WHERE id = ?1",
            [other_node],
        )
        .unwrap();
        drop(db);

        let state = AppState::new(&path);
        let handle = spawn(state.clone());
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let db = state.connect().unwrap();
                if scheduler::snapshot(&db, job_id)
                    .unwrap()
                    .dag
                    .nodes
                    .iter()
                    .any(|node| node.id == *render && node.state == JobState::Ready)
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("the initial automatic sweep must recover the interrupted attempt");
        handle.abort();
        let db = state.connect().unwrap();
        let result = scheduler::snapshot(&db, job_id).unwrap();
        assert_eq!(
            result
                .dag
                .nodes
                .iter()
                .find(|n| n.id == *plan)
                .unwrap()
                .state,
            JobState::Succeeded
        );
        assert_eq!(
            result
                .dag
                .attempts
                .iter()
                .find(|a| a.id == interrupted.id)
                .unwrap()
                .state,
            AttemptState::Failed
        );
        assert_eq!(
            result
                .dag
                .attempts
                .iter()
                .find(|a| a.id == interrupted.id)
                .unwrap()
                .error_code
                .as_deref(),
            Some("worker_lease_expired")
        );
        assert_eq!(
            scheduler::snapshot(&db, live_id).unwrap().dag.attempts[0].state,
            AttemptState::Running
        );
        assert_eq!(
            scheduler::snapshot(&db, other_id).unwrap().dag.nodes[0].state,
            JobState::Running
        );
        assert_eq!(
            scheduler::reconcile_all_stale_video_attempts(&mut state.connect().unwrap())
                .unwrap()
                .len(),
            0
        );
        // The active lease also remains owned by its original attempt.
        assert_eq!(
            scheduler::snapshot(&db, live_id).unwrap().dag.attempts[0].id,
            live_attempt.id
        );
    }

    #[test]
    fn exhausted_expired_video_attempt_fails_job_without_infinite_retries() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("jobs.sqlite");
        let mut db = db::open(&path).unwrap();
        db::migrate(&mut db).unwrap();
        let mut request = spec(
            "video-render-segment",
            "recovery-exhausted",
            &[("segment", &[])],
        );
        request.nodes[0].max_attempts = 1;
        let SubmitOutcome::Created(saved) = scheduler::submit(&mut db, &request).unwrap() else {
            panic!("new video job expected");
        };
        let job_id = &saved.dag.job.id;
        let node_id = &saved.dag.nodes[0].id;
        let first = scheduler::begin_attempt(&mut db, job_id, node_id).unwrap();
        db.execute(
            "UPDATE job_nodes SET created_at = '2000-01-01T00:00:00Z',
             updated_at = '2000-01-01T00:00:00Z' WHERE id = ?1",
            [node_id],
        )
        .unwrap();
        drop(db);
        let state = AppState::new(&path);
        assert_eq!(recover_once(&state).unwrap(), 1);
        assert_eq!(
            recover_once(&state).unwrap(),
            0,
            "a sweep must be idempotent"
        );
        let snapshot = scheduler::snapshot(&state.connect().unwrap(), job_id).unwrap();
        assert_eq!(snapshot.dag.job.state, JobState::Failed);
        assert_eq!(snapshot.dag.nodes[0].state, JobState::Failed);
        assert_eq!(snapshot.dag.attempts[0].id, first.id);
        assert_eq!(snapshot.dag.attempts[0].state, AttemptState::Failed);
    }
}
