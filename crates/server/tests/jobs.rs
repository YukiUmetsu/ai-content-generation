//! Integration tests for the persistent job DAG scheduler.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use contentgen_core::jobs::{AttemptState, JobDag, JobState};
use contentgen_core::{DomainError, Validate};
use contentgen_server::db;
use contentgen_server::jobs::JobsError;
use contentgen_server::jobs::scheduler::{
    self, JobProgress, JobSnapshot, NodeRequest, ReconciledAttempt, SubmitOutcome, SubmitRequest,
    fail_attempt, reconcile_orphans, submit, succeed_attempt,
};
use rusqlite::Connection;
use serde_json::json;

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(prefix: &str) -> Self {
        let root = std::env::var_os("CONTENTGEN_TEST_TMP")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir);
        let path = root.join(format!(
            "{prefix}-{}-{}",
            std::process::id(),
            TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        if path.exists() {
            std::fs::remove_dir_all(&path).expect("remove stale test directory");
        }
        std::fs::create_dir_all(&path).expect("create test directory");
        Self { path }
    }

    fn path(&self) -> &Path {
        self.path.as_path()
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn migrated_database(dir: &TestDir) -> Connection {
    let mut connection = db::open(dir.path().join("data.db")).expect("open temp database");
    db::migrate(&mut connection).expect("migrate temp database");
    connection
}

fn node(node_key: &str, depends_on: &[&str], max_attempts: u32) -> NodeRequest {
    NodeRequest {
        node_key: node_key.to_owned(),
        node_kind: "test".to_owned(),
        max_attempts,
        input: json!({"node": node_key}),
        depends_on: depends_on.iter().map(|key| (*key).to_owned()).collect(),
    }
}

fn request(job_kind: &str, idempotency_key: &str, nodes: Vec<NodeRequest>) -> SubmitRequest {
    SubmitRequest {
        job_kind: job_kind.to_owned(),
        idempotency_key: idempotency_key.to_owned(),
        nodes,
    }
}

fn created(connection: &mut Connection, request: &SubmitRequest) -> JobSnapshot {
    match submit(connection, request).expect("submit job") {
        SubmitOutcome::Created(snapshot) => snapshot,
        SubmitOutcome::Existing(_) => panic!("expected a newly created job"),
    }
}

fn node_id(dag: &JobDag, node_key: &str) -> String {
    dag.nodes
        .iter()
        .find(|node| node.node_key == node_key)
        .unwrap_or_else(|| panic!("node '{node_key}' is missing"))
        .id
        .clone()
}

fn node_state(dag: &JobDag, node_key: &str) -> JobState {
    dag.nodes
        .iter()
        .find(|node| node.node_key == node_key)
        .unwrap_or_else(|| panic!("node '{node_key}' is missing"))
        .state
}

fn count(connection: &Connection, table: &str) -> i64 {
    connection
        .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .expect("count rows")
}

#[test]
fn happy_dag_run_succeeds_in_dependency_order() {
    let dir = TestDir::new("contentgen-jobs-happy");
    let mut connection = migrated_database(&dir);
    let spec = request(
        "video-pipeline",
        "happy-dag-key",
        vec![
            node("extract", &[], 3),
            node("compose", &["extract"], 3),
            node("publish", &["compose"], 3),
        ],
    );
    let snapshot = created(&mut connection, &spec);
    assert_eq!(snapshot.dag.job.state, JobState::Running);
    assert_eq!(
        snapshot.progress,
        JobProgress {
            total: 3,
            pending: 2,
            ready: 1,
            running: 0,
            succeeded: 0,
            failed: 0,
            cancelled: 0,
        }
    );
    assert_eq!(node_state(&snapshot.dag, "extract"), JobState::Ready);
    assert_eq!(node_state(&snapshot.dag, "compose"), JobState::Pending);
    assert_eq!(node_state(&snapshot.dag, "publish"), JobState::Pending);

    let job_id = snapshot.dag.job.id.clone();
    let extract = node_id(&snapshot.dag, "extract");
    let compose = node_id(&snapshot.dag, "compose");
    let publish = node_id(&snapshot.dag, "publish");

    let error = scheduler::begin_attempt(&mut connection, &job_id, &compose)
        .expect_err("a dependent must not run before its dependency");
    assert!(matches!(error, JobsError::NodeNotReady));

    let attempt = scheduler::begin_attempt(&mut connection, &job_id, &extract).unwrap();
    let snapshot = succeed_attempt(&mut connection, &extract, &attempt.id, json!({"ok": 1}))
        .expect("succeed extract");
    assert_eq!(node_state(&snapshot.dag, "extract"), JobState::Succeeded);
    assert_eq!(node_state(&snapshot.dag, "compose"), JobState::Ready);
    assert_eq!(node_state(&snapshot.dag, "publish"), JobState::Pending);
    assert_eq!(snapshot.dag.job.state, JobState::Running);

    let attempt = scheduler::begin_attempt(&mut connection, &job_id, &compose).unwrap();
    let snapshot = succeed_attempt(&mut connection, &compose, &attempt.id, json!({"ok": 2}))
        .expect("succeed compose");
    assert_eq!(node_state(&snapshot.dag, "compose"), JobState::Succeeded);
    assert_eq!(node_state(&snapshot.dag, "publish"), JobState::Ready);
    assert_eq!(snapshot.dag.job.state, JobState::Running);

    let attempt = scheduler::begin_attempt(&mut connection, &job_id, &publish).unwrap();
    let snapshot = succeed_attempt(&mut connection, &publish, &attempt.id, json!({"ok": 3}))
        .expect("succeed publish");
    assert_eq!(snapshot.dag.job.state, JobState::Succeeded);
    assert_eq!(
        snapshot.progress,
        JobProgress {
            total: 3,
            pending: 0,
            ready: 0,
            running: 0,
            succeeded: 3,
            failed: 0,
            cancelled: 0,
        }
    );
    assert_eq!(snapshot.dag.attempts.len(), 3);
    assert!(
        snapshot
            .dag
            .attempts
            .iter()
            .all(|attempt| attempt.state == AttemptState::Succeeded)
    );
    snapshot.dag.validate().expect("snapshot must stay valid");
}

#[test]
fn retry_then_succeed_is_bounded() {
    let dir = TestDir::new("contentgen-jobs-retry");
    let mut connection = migrated_database(&dir);
    let spec = request("video-pipeline", "retry-key", vec![node("render", &[], 2)]);
    let snapshot = created(&mut connection, &spec);
    let job_id = snapshot.dag.job.id.clone();
    let render = node_id(&snapshot.dag, "render");

    let first = scheduler::begin_attempt(&mut connection, &job_id, &render).unwrap();
    assert_eq!(first.attempt_number, 1);
    let snapshot = fail_attempt(
        &mut connection,
        &render,
        &first.id,
        "transient_render_error",
        Some("the renderer exited with status 1"),
    )
    .expect("fail first attempt");
    assert_eq!(snapshot.dag.job.state, JobState::Running);
    assert_eq!(node_state(&snapshot.dag, "render"), JobState::Ready);
    assert_eq!(snapshot.dag.nodes[0].attempt_count, 1);
    assert_eq!(snapshot.dag.attempts.len(), 1);
    assert_eq!(snapshot.dag.attempts[0].state, AttemptState::Failed);

    let second = scheduler::begin_attempt(&mut connection, &job_id, &render).unwrap();
    assert_eq!(second.attempt_number, 2);
    let snapshot = succeed_attempt(&mut connection, &render, &second.id, json!({"frames": 42}))
        .expect("succeed second attempt");
    assert_eq!(node_state(&snapshot.dag, "render"), JobState::Succeeded);
    assert_eq!(snapshot.dag.job.state, JobState::Succeeded);
    assert_eq!(snapshot.dag.attempts.len(), 2);
    assert_eq!(
        snapshot
            .dag
            .attempts
            .iter()
            .filter(|attempt| attempt.state == AttemptState::Failed)
            .count(),
        1
    );
    assert_eq!(
        snapshot
            .dag
            .attempts
            .iter()
            .filter(|attempt| attempt.state == AttemptState::Succeeded)
            .count(),
        1
    );
    snapshot.dag.validate().expect("snapshot must stay valid");
}

#[test]
fn exhausted_retries_fail_run_and_block_descendants() {
    let dir = TestDir::new("contentgen-jobs-exhausted");
    let mut connection = migrated_database(&dir);
    let spec = request(
        "video-pipeline",
        "exhausted-key",
        vec![node("render", &[], 2), node("publish", &["render"], 2)],
    );
    let snapshot = created(&mut connection, &spec);
    let job_id = snapshot.dag.job.id.clone();
    let render = node_id(&snapshot.dag, "render");
    let publish = node_id(&snapshot.dag, "publish");

    let first = scheduler::begin_attempt(&mut connection, &job_id, &render).unwrap();
    fail_attempt(
        &mut connection,
        &render,
        &first.id,
        "transient_render_error",
        None,
    )
    .expect("fail first attempt");

    let second = scheduler::begin_attempt(&mut connection, &job_id, &render).unwrap();
    let snapshot = fail_attempt(
        &mut connection,
        &render,
        &second.id,
        "transient_render_error",
        None,
    )
    .expect("fail second attempt");

    assert_eq!(node_state(&snapshot.dag, "render"), JobState::Failed);
    assert_eq!(snapshot.dag.job.state, JobState::Failed);
    // Abandoned descendants are cancelled, never left as fake pending work.
    assert_eq!(node_state(&snapshot.dag, "publish"), JobState::Cancelled);
    let publish_node = snapshot
        .dag
        .nodes
        .iter()
        .find(|node| node.node_key == "publish")
        .unwrap();
    assert_eq!(publish_node.attempt_count, 0);
    assert!(
        snapshot
            .dag
            .attempts
            .iter()
            .all(|attempt| attempt.node_id == render)
    );
    assert_eq!(snapshot.progress.failed, 1);
    assert_eq!(snapshot.progress.pending, 0);
    assert_eq!(snapshot.progress.cancelled, 1);
    snapshot.dag.validate().expect("snapshot must stay valid");

    assert!(matches!(
        scheduler::begin_attempt(&mut connection, &job_id, &render),
        Err(JobsError::JobFinished)
    ));
    assert!(matches!(
        scheduler::begin_attempt(&mut connection, &job_id, &publish),
        Err(JobsError::JobFinished)
    ));
}

#[test]
fn terminal_failure_cancels_running_siblings() {
    let dir = TestDir::new("contentgen-jobs-fail-sibling");
    let mut connection = migrated_database(&dir);
    let spec = request(
        "video-pipeline",
        "fail-sibling-key",
        vec![node("encode", &[], 1), node("thumbnail", &[], 1)],
    );
    let snapshot = created(&mut connection, &spec);
    let job_id = snapshot.dag.job.id.clone();
    let encode = node_id(&snapshot.dag, "encode");
    let thumbnail = node_id(&snapshot.dag, "thumbnail");

    let encode_attempt = scheduler::begin_attempt(&mut connection, &job_id, &encode).unwrap();
    let thumbnail_attempt = scheduler::begin_attempt(&mut connection, &job_id, &thumbnail).unwrap();

    let snapshot = fail_attempt(
        &mut connection,
        &encode,
        &encode_attempt.id,
        "encoder_crashed",
        None,
    )
    .expect("exhausting the retry limit fails the job");

    assert_eq!(snapshot.dag.job.state, JobState::Failed);
    assert_eq!(node_state(&snapshot.dag, "encode"), JobState::Failed);
    assert_eq!(node_state(&snapshot.dag, "thumbnail"), JobState::Cancelled);
    assert_eq!(
        snapshot.progress,
        JobProgress {
            total: 2,
            pending: 0,
            ready: 0,
            running: 0,
            succeeded: 0,
            failed: 1,
            cancelled: 1,
        }
    );
    let sibling = snapshot
        .dag
        .attempts
        .iter()
        .find(|attempt| attempt.id == thumbnail_attempt.id)
        .expect("cancelled sibling attempt is still recorded");
    assert_eq!(sibling.state, AttemptState::Cancelled);
    assert!(sibling.finished_at.is_some());
    snapshot.dag.validate().expect("snapshot must stay valid");

    assert!(matches!(
        succeed_attempt(
            &mut connection,
            &thumbnail,
            &thumbnail_attempt.id,
            json!({"frame": 7})
        ),
        Err(JobsError::AttemptAlreadyFinished)
    ));
}

#[test]
fn cancel_marks_run_cancelled_not_progress() {
    let dir = TestDir::new("contentgen-jobs-cancel");
    let mut connection = migrated_database(&dir);
    let spec = request(
        "video-pipeline",
        "cancel-key",
        vec![node("render", &[], 3), node("publish", &["render"], 3)],
    );
    let snapshot = created(&mut connection, &spec);
    let job_id = snapshot.dag.job.id.clone();
    let render = node_id(&snapshot.dag, "render");

    let attempt = scheduler::begin_attempt(&mut connection, &job_id, &render).unwrap();
    let snapshot = scheduler::cancel_job(&mut connection, &job_id).expect("cancel job");
    assert_eq!(snapshot.dag.job.state, JobState::Cancelled);
    assert_eq!(node_state(&snapshot.dag, "render"), JobState::Cancelled);
    assert_eq!(node_state(&snapshot.dag, "publish"), JobState::Cancelled);
    assert_eq!(
        snapshot.progress,
        JobProgress {
            total: 2,
            pending: 0,
            ready: 0,
            running: 0,
            succeeded: 0,
            failed: 0,
            cancelled: 2,
        }
    );
    let cancelled_attempt = snapshot
        .dag
        .attempts
        .iter()
        .find(|candidate| candidate.id == attempt.id)
        .expect("attempt is still recorded");
    assert_eq!(cancelled_attempt.state, AttemptState::Cancelled);
    assert!(cancelled_attempt.finished_at.is_some());
    snapshot.dag.validate().expect("snapshot must stay valid");

    assert!(matches!(
        scheduler::begin_attempt(&mut connection, &job_id, &render),
        Err(JobsError::JobFinished)
    ));

    let again = scheduler::cancel_job(&mut connection, &job_id).expect("idempotent cancel");
    assert_eq!(again.dag.job.state, JobState::Cancelled);
    assert_eq!(again.progress, snapshot.progress);

    let done_request = request(
        "video-pipeline",
        "cancel-finished-key",
        vec![node("render", &[], 1)],
    );
    let done = created(&mut connection, &done_request);
    let done_job_id = done.dag.job.id.clone();
    let done_render = node_id(&done.dag, "render");
    let done_attempt =
        scheduler::begin_attempt(&mut connection, &done_job_id, &done_render).unwrap();
    succeed_attempt(
        &mut connection,
        &done_render,
        &done_attempt.id,
        json!({"ok": true}),
    )
    .expect("finish job");
    assert!(matches!(
        scheduler::cancel_job(&mut connection, &done_job_id),
        Err(JobsError::JobFinished)
    ));
}

#[test]
fn duplicate_idempotency_key_does_not_start_second_run() {
    let dir = TestDir::new("contentgen-jobs-idempotent");
    let mut connection = migrated_database(&dir);
    let spec = request(
        "video-pipeline",
        "duplicate-key",
        vec![node("render", &[], 2), node("publish", &["render"], 2)],
    );
    let first = created(&mut connection, &spec);
    let job_id = first.dag.job.id.clone();
    let jobs_before = count(&connection, "jobs");
    let nodes_before = count(&connection, "job_nodes");
    let attempts_before = count(&connection, "job_attempts");

    let second = submit(&mut connection, &spec).expect("duplicate submit");
    match second {
        SubmitOutcome::Existing(snapshot) => {
            assert_eq!(snapshot.dag.job.id, job_id);
            assert_eq!(snapshot.dag.nodes.len(), first.dag.nodes.len());
            assert_eq!(snapshot.dag.attempts.len(), first.dag.attempts.len());
        }
        SubmitOutcome::Created(_) => panic!("duplicate key must not create a second run"),
    }
    assert_eq!(count(&connection, "jobs"), jobs_before);
    assert_eq!(count(&connection, "job_nodes"), nodes_before);
    assert_eq!(count(&connection, "job_attempts"), attempts_before);

    let other = request(
        "video-pipeline",
        "different-key",
        vec![node("render", &[], 2), node("publish", &["render"], 2)],
    );
    let distinct = created(&mut connection, &other);
    assert_ne!(distinct.dag.job.id, job_id);
    assert_eq!(count(&connection, "jobs"), jobs_before + 1);

    // Reusing a key for a different kind of job must be rejected, not silently
    // answered with the unrelated existing job.
    let mismatched_kind = request(
        "audio-pipeline",
        "duplicate-key",
        vec![node("render", &[], 2)],
    );
    let error = submit(&mut connection, &mismatched_kind).expect_err("kind mismatch must fail");
    assert!(
        matches!(error, JobsError::IdempotencyConflict(_)),
        "expected IdempotencyConflict, got {error:?}"
    );
    assert_eq!(count(&connection, "jobs"), jobs_before + 1);
}

#[test]
fn cyclic_spec_is_refused_before_persisting() {
    let dir = TestDir::new("contentgen-jobs-cycle");
    let mut connection = migrated_database(&dir);
    let spec = request(
        "video-pipeline",
        "cycle-key",
        vec![node("a", &["b"], 2), node("b", &["a"], 2)],
    );

    let error = submit(&mut connection, &spec).expect_err("cycles must be refused");
    assert!(
        matches!(error, JobsError::Domain(DomainError::CycleDetected)),
        "expected CycleDetected, got {error:?}"
    );
    assert_eq!(count(&connection, "jobs"), 0);
    assert_eq!(count(&connection, "job_nodes"), 0);
    assert_eq!(count(&connection, "job_edges"), 0);
}

#[test]
fn empty_spec_is_refused_before_persisting() {
    let dir = TestDir::new("contentgen-jobs-empty");
    let mut connection = migrated_database(&dir);
    let spec = request("video-pipeline", "empty-key", Vec::new());

    let error = submit(&mut connection, &spec).expect_err("a job without nodes must be refused");
    assert!(
        matches!(error, JobsError::InvalidDocument(_)),
        "expected InvalidDocument, got {error:?}"
    );
    // A node-less job could never reach a terminal state, so nothing is stored.
    assert_eq!(count(&connection, "jobs"), 0);
    assert_eq!(count(&connection, "job_nodes"), 0);
}

#[test]
fn orphaned_running_attempt_is_reconciled_not_completed() {
    let dir = TestDir::new("contentgen-jobs-orphan");
    let mut connection = migrated_database(&dir);
    let spec = request("video-pipeline", "orphan-key", vec![node("render", &[], 2)]);
    let snapshot = created(&mut connection, &spec);
    let job_id = snapshot.dag.job.id.clone();
    let render = node_id(&snapshot.dag, "render");
    let attempt = scheduler::begin_attempt(&mut connection, &job_id, &render).unwrap();

    let reconciled = reconcile_orphans(&mut connection, Some(&job_id)).expect("reconcile");
    assert_eq!(
        reconciled,
        vec![ReconciledAttempt {
            attempt_id: attempt.id.clone(),
            node_id: render.clone(),
            job_id: job_id.clone(),
            state: AttemptState::Failed,
        }]
    );

    let snapshot = scheduler::snapshot(&connection, &job_id).expect("read snapshot");
    assert_ne!(snapshot.dag.job.state, JobState::Succeeded);
    assert_eq!(snapshot.dag.job.state, JobState::Running);
    assert_eq!(node_state(&snapshot.dag, "render"), JobState::Ready);
    let reconciled_attempt = snapshot
        .dag
        .attempts
        .iter()
        .find(|candidate| candidate.id == attempt.id)
        .unwrap();
    assert_eq!(reconciled_attempt.state, AttemptState::Failed);
    assert_eq!(
        reconciled_attempt.error_code.as_deref(),
        Some("orphaned_after_restart")
    );
    assert!(reconciled_attempt.finished_at.is_some());
    snapshot.dag.validate().expect("snapshot must stay valid");

    let second = reconcile_orphans(&mut connection, Some(&job_id)).expect("second reconcile");
    assert!(second.is_empty());
}

#[test]
fn completed_scene_job_survives_worker_restart_while_interrupted_scene_retries() {
    let dir = TestDir::new("contentgen-scene-worker-restart");
    let mut connection = migrated_database(&dir);
    let completed_spec = request(
        "video-narration-scene",
        "video-scene:narration:opening:content-sha",
        vec![node("narration-scene", &[], 3)],
    );
    let interrupted_spec = request(
        "video-render-segment",
        "video-scene:render:middle:content-sha",
        vec![node("render-segment", &[], 3)],
    );
    let complete = created(&mut connection, &completed_spec);
    let interrupted = created(&mut connection, &interrupted_spec);
    let complete_job = complete.dag.job.id.clone();
    let interrupted_job = interrupted.dag.job.id.clone();
    let complete_node = node_id(&complete.dag, "narration-scene");
    let interrupted_node = node_id(&interrupted.dag, "render-segment");
    let first = scheduler::begin_attempt(&mut connection, &complete_job, &complete_node).unwrap();
    succeed_attempt(
        &mut connection,
        &complete_node,
        &first.id,
        json!({"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}),
    )
    .unwrap();
    let unfinished =
        scheduler::begin_attempt(&mut connection, &interrupted_job, &interrupted_node).unwrap();
    // The worker exits without sending succeed/fail. SQLite remains intact.
    drop(connection);

    let mut restarted = migrated_database(&dir);
    let reconciled = reconcile_orphans(&mut restarted, None).unwrap();
    assert_eq!(reconciled.len(), 1);
    assert_eq!(reconciled[0].attempt_id, unfinished.id);
    let previous = scheduler::snapshot(&restarted, &complete_job).unwrap();
    assert_eq!(previous.dag.job.state, JobState::Succeeded);
    assert_eq!(previous.dag.attempts.len(), 1);
    assert_eq!(previous.dag.attempts[0].state, AttemptState::Succeeded);

    let retryable = scheduler::snapshot(&restarted, &interrupted_job).unwrap();
    assert_eq!(retryable.dag.job.state, JobState::Running);
    assert_eq!(
        node_state(&retryable.dag, "render-segment"),
        JobState::Ready
    );
    let retry = scheduler::begin_attempt(&mut restarted, &interrupted_job, &interrupted_node)
        .expect("new worker claims only the interrupted scene");
    assert_ne!(retry.id, unfinished.id);
    let final_state = succeed_attempt(
        &mut restarted,
        &interrupted_node,
        &retry.id,
        json!({"sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}),
    )
    .unwrap();
    assert_eq!(final_state.dag.job.state, JobState::Succeeded);
    assert_eq!(final_state.dag.attempts.len(), 2);
    assert_eq!(
        final_state
            .dag
            .attempts
            .iter()
            .find(|a| a.id == unfinished.id)
            .unwrap()
            .state,
        AttemptState::Failed
    );
    assert_eq!(
        final_state
            .dag
            .attempts
            .iter()
            .find(|a| a.id == retry.id)
            .unwrap()
            .state,
        AttemptState::Succeeded
    );
    assert_eq!(count(&restarted, "jobs"), 2);
}

#[test]
fn exhausted_single_scene_job_can_be_retried_without_restarting_other_scenes() {
    let dir = TestDir::new("contentgen-scene-retry");
    let mut connection = migrated_database(&dir);
    for kind in [
        "video-asset-download",
        "video-narration-scene",
        "video-render-segment",
    ] {
        let spec = request(kind, kind, vec![node("scene", &[], 1)]);
        let dag = created(&mut connection, &spec).dag;
        let id = node_id(&dag, "scene");
        let first = scheduler::begin_attempt(&mut connection, &dag.job.id, &id).unwrap();
        let failed = fail_attempt(&mut connection, &id, &first.id, "temporary_failure", None)
            .expect("exhausted scene should fail");
        assert_eq!(failed.dag.job.state, JobState::Failed);
        let retried = scheduler::retry_failed_video_job(&mut connection, &dag.job.id)
            .expect("the same scene is independently retryable");
        assert_eq!(retried.dag.job.state, JobState::Running);
        assert_eq!(retried.dag.nodes[0].max_attempts, 2);
        let second = scheduler::begin_attempt(&mut connection, &dag.job.id, &id).unwrap();
        let success =
            succeed_attempt(&mut connection, &id, &second.id, json!({"ok":true})).unwrap();
        assert_eq!(success.dag.job.state, JobState::Succeeded);
        assert_eq!(success.dag.attempts.len(), 2);
    }
}
