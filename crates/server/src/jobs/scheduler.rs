//! Persistent job DAG scheduler.
//!
//! Every multi-row state transition runs inside one SQLite transaction so a
//! crash can never leave a half-written DAG. State changes are deliberately
//! small and explicit: `PENDING -> READY -> RUNNING -> SUCCEEDED | FAILED`,
//! with bounded `FAILED -> READY` retries and `CANCELLED` as a terminal outcome.

use std::collections::{HashMap, HashSet};

use contentgen_core::jobs::{EdgeKind, JobAttempt, JobDag, JobEdge, JobNode, JobState};
use contentgen_core::{AttemptState, Job, MAX_ATTEMPTS_LIMIT, Validate, sha256_hex};
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::error::JobsError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NodeRequest {
    pub node_key: String,
    pub node_kind: String,
    pub max_attempts: u32,
    pub input: Value,
    pub depends_on: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubmitRequest {
    pub job_kind: String,
    pub idempotency_key: String,
    pub nodes: Vec<NodeRequest>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum SubmitOutcome {
    Created(JobSnapshot),
    Existing(JobSnapshot),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobProgress {
    pub total: usize,
    pub pending: usize,
    pub ready: usize,
    pub running: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub cancelled: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct JobSnapshot {
    pub dag: JobDag,
    pub progress: JobProgress,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReconciledAttempt {
    pub attempt_id: String,
    pub node_id: String,
    pub job_id: String,
    pub state: AttemptState,
}

pub fn submit(conn: &mut Connection, request: &SubmitRequest) -> Result<SubmitOutcome, JobsError> {
    let job_id = derive_job_id(&request.job_kind, &request.idempotency_key);
    let transaction = conn.transaction()?;

    // Lookup happens inside the write transaction so a duplicate submission can
    // never slip between the check and the insert.
    if let Some(existing_id) = find_job_id_by_key(&transaction, &request.idempotency_key)? {
        transaction.commit()?;
        return existing_job(conn, &existing_id, request);
    }

    let now = now(&transaction)?;
    let dag = build_dag(request, &job_id, &now)?;

    let insert_job = transaction.execute(
        "INSERT INTO jobs
            (id, schema_version, job_kind, state, idempotency_key, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![
            dag.job.id,
            i64::from(dag.job.schema_version),
            dag.job.job_kind,
            job_state_code(dag.job.state),
            dag.job.idempotency_key,
            now,
        ],
    );

    if let Err(error) = insert_job {
        if is_constraint_violation(&error) {
            transaction.rollback()?;
            if let Some(existing_id) = find_job_id_by_key(conn, &request.idempotency_key)? {
                return existing_job(conn, &existing_id, request);
            }
        }
        return Err(JobsError::Database(error));
    }

    for node in &dag.nodes {
        transaction.execute(
            "INSERT INTO job_nodes
                (id, schema_version, job_id, node_key, node_kind, state, attempt_count,
                 max_attempts, idempotency_key, input_json, output_json, error_code,
                 created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, NULL, ?11, ?11)",
            params![
                node.id,
                i64::from(node.schema_version),
                node.job_id,
                node.node_key,
                node.node_kind,
                job_state_code(node.state),
                i64::from(node.attempt_count),
                i64::from(node.max_attempts),
                node.idempotency_key,
                serde_json::to_string(&node.input)?,
                now,
            ],
        )?;
    }

    for edge in &dag.edges {
        transaction.execute(
            "INSERT INTO job_edges
                (job_id, from_node_id, to_node_id, edge_kind, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                edge.job_id,
                edge.from_node_id,
                edge.to_node_id,
                edge_kind_code(edge.edge_kind),
                edge.created_at,
            ],
        )?;
    }

    transaction.commit()?;
    Ok(SubmitOutcome::Created(snapshot(conn, &job_id)?))
}

pub fn snapshot(conn: &Connection, job_id: &str) -> Result<JobSnapshot, JobsError> {
    let dag = load_dag(conn, job_id)?;
    let progress = progress_of(&dag.nodes);
    dag.validate()?;
    Ok(JobSnapshot { dag, progress })
}

pub fn list(conn: &Connection, state: Option<JobState>) -> Result<Vec<Job>, JobsError> {
    let state_code = state.map(job_state_code);
    let mut statement = conn.prepare(
        "SELECT id, schema_version, job_kind, state, idempotency_key, created_at, updated_at
         FROM jobs
         WHERE (?1 IS NULL OR state = ?1)
         ORDER BY created_at, id",
    )?;
    let jobs = statement
        .query_map(params![state_code], map_job)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(jobs)
}

pub fn ready_nodes(conn: &Connection, job_id: &str) -> Result<Vec<JobNode>, JobsError> {
    let mut statement = conn.prepare(
        "SELECT id, schema_version, job_id, node_key, node_kind, state, attempt_count,
                max_attempts, idempotency_key, input_json, output_json, error_code,
                created_at, updated_at
         FROM job_nodes
         WHERE job_id = ?1 AND state = 'READY'
         ORDER BY node_key, id",
    )?;
    let nodes = statement
        .query_map([job_id], map_node)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(nodes)
}

pub fn begin_attempt(
    conn: &mut Connection,
    job_id: &str,
    node_id: &str,
) -> Result<JobAttempt, JobsError> {
    let transaction = conn.transaction()?;
    let job = load_job(&transaction, job_id)?
        .ok_or_else(|| JobsError::NotFound(format!("job '{job_id}' was not found")))?;
    if is_terminal(job.state) {
        return Err(JobsError::JobFinished);
    }

    let node = load_node(&transaction, job_id, node_id)?
        .ok_or_else(|| JobsError::NotFound(format!("job node '{node_id}' was not found")))?;
    if node.state != JobState::Ready {
        return Err(JobsError::NodeNotReady);
    }
    if node.attempt_count >= node.max_attempts {
        return Err(JobsError::RetryLimitExceeded);
    }

    let now = now(&transaction)?;
    let attempt_number = node.attempt_count + 1;
    let attempt_id = derive_attempt_id(node_id, attempt_number);
    let attempt = JobAttempt {
        id: attempt_id,
        node_id: node_id.to_owned(),
        attempt_number,
        idempotency_key: format!("{node_id}/attempt/{attempt_number}"),
        state: AttemptState::Running,
        started_at: now.clone(),
        finished_at: None,
        error_code: None,
        error_detail: None,
        metadata: serde_json::Map::new(),
        created_at: now.clone(),
    };

    transaction.execute(
        "UPDATE job_nodes
         SET state = 'RUNNING', attempt_count = ?1, error_code = NULL, updated_at = ?2
         WHERE id = ?3",
        params![i64::from(attempt_number), now, node_id],
    )?;
    transaction.execute(
        "INSERT INTO job_attempts
            (id, node_id, attempt_number, idempotency_key, state, started_at, finished_at,
             error_code, error_detail, metadata_json, created_at)
         VALUES (?1, ?2, ?3, ?4, 'RUNNING', ?5, NULL, NULL, NULL, '{}', ?5)",
        params![
            attempt.id,
            attempt.node_id,
            i64::from(attempt.attempt_number),
            attempt.idempotency_key,
            now,
        ],
    )?;
    transaction.execute(
        "UPDATE jobs SET updated_at = ?1 WHERE id = ?2",
        params![now, job_id],
    )?;
    transaction.commit()?;
    Ok(attempt)
}

/// Renew a running attempt's lease. The exact attempt ID is the worker's
/// ownership token; a cancelled, superseded or completed worker cannot renew
/// the lease even if it still knows the job and node IDs.
pub fn heartbeat_attempt(
    conn: &mut Connection,
    job_id: &str,
    node_id: &str,
    attempt_id: &str,
) -> Result<(), JobsError> {
    let transaction = conn.transaction()?;
    let attempt = load_attempt(&transaction, attempt_id)?
        .ok_or_else(|| JobsError::NotFound(format!("job attempt '{attempt_id}' was not found")))?;
    if attempt.node_id != node_id {
        return Err(JobsError::NotFound(format!(
            "job attempt '{attempt_id}' does not belong to node '{node_id}'"
        )));
    }
    if attempt.state != AttemptState::Running {
        return Err(JobsError::AttemptAlreadyFinished);
    }
    let node = load_node(&transaction, job_id, node_id)?
        .ok_or_else(|| JobsError::NotFound(format!("job node '{node_id}' was not found")))?;
    if node.state != JobState::Running {
        return Err(JobsError::NodeNotReady);
    }
    let job = load_job(&transaction, job_id)?
        .ok_or_else(|| JobsError::NotFound(format!("job '{job_id}' was not found")))?;
    if is_terminal(job.state) {
        return Err(JobsError::JobFinished);
    }
    let time = now(&transaction)?;
    transaction.execute(
        "UPDATE job_nodes SET updated_at = ?1 WHERE id = ?2 AND state = 'RUNNING'",
        params![time, node_id],
    )?;
    transaction.execute(
        "UPDATE jobs SET updated_at = ?1 WHERE id = ?2 AND state = 'RUNNING'",
        params![time, job_id],
    )?;
    transaction.commit()?;
    Ok(())
}

pub fn succeed_attempt(
    conn: &mut Connection,
    node_id: &str,
    attempt_id: &str,
    output: Value,
) -> Result<JobSnapshot, JobsError> {
    let transaction = conn.transaction()?;
    let attempt = load_attempt(&transaction, attempt_id)?
        .ok_or_else(|| JobsError::NotFound(format!("job attempt '{attempt_id}' was not found")))?;
    if attempt.node_id != node_id {
        return Err(JobsError::NotFound(format!(
            "job attempt '{attempt_id}' does not belong to node '{node_id}'"
        )));
    }

    if let Some(state) = terminal_attempt_state(attempt.state) {
        if state == AttemptState::Succeeded {
            // Same outcome already committed: do not write a second artifact.
            transaction.commit()?;
            return snapshot(conn, &node_job_id(conn, node_id)?);
        }
        return Err(JobsError::AttemptAlreadyFinished);
    }

    let node = load_node_by_id(&transaction, node_id)?
        .ok_or_else(|| JobsError::NotFound(format!("job node '{node_id}' was not found")))?;
    let job = load_job(&transaction, &node.job_id)?
        .ok_or_else(|| JobsError::NotFound(format!("job '{}' was not found", node.job_id)))?;
    if is_terminal(job.state) {
        return Err(JobsError::JobFinished);
    }
    if node.state != JobState::Running {
        return Err(JobsError::Internal(format!(
            "attempt '{attempt_id}' is running but node '{node_id}' is not"
        )));
    }

    let now = now(&transaction)?;
    let output_json = serde_json::to_string(&output)?;
    transaction.execute(
        "UPDATE job_attempts
         SET state = 'SUCCEEDED', finished_at = ?1
         WHERE id = ?2 AND state = 'RUNNING'",
        params![now, attempt_id],
    )?;
    transaction.execute(
        "UPDATE job_nodes
         SET state = 'SUCCEEDED', output_json = ?1, error_code = NULL, updated_at = ?2
         WHERE id = ?3 AND state = 'RUNNING'",
        params![output_json, now, node_id],
    )?;
    refresh_successors(&transaction, &node.job_id, node_id, &now)?;

    let remaining: i64 = transaction.query_row(
        "SELECT count(*) FROM job_nodes WHERE job_id = ?1 AND state <> 'SUCCEEDED'",
        [node.job_id.as_str()],
        |row| row.get(0),
    )?;
    if remaining == 0 {
        transaction.execute(
            "UPDATE jobs SET state = 'SUCCEEDED', updated_at = ?1 WHERE id = ?2",
            params![now, node.job_id],
        )?;
    } else {
        transaction.execute(
            "UPDATE jobs SET updated_at = ?1 WHERE id = ?2",
            params![now, node.job_id],
        )?;
    }

    transaction.commit()?;
    snapshot(conn, &node.job_id)
}

pub fn fail_attempt(
    conn: &mut Connection,
    node_id: &str,
    attempt_id: &str,
    error_code: &str,
    error_detail: Option<&str>,
) -> Result<JobSnapshot, JobsError> {
    if error_code.trim().is_empty() {
        return Err(JobsError::InvalidDocument(
            "attempt error_code must not be blank".to_owned(),
        ));
    }
    if error_detail.is_some_and(|detail| detail.trim().is_empty()) {
        return Err(JobsError::InvalidDocument(
            "attempt error_detail must not be blank when supplied".to_owned(),
        ));
    }

    let transaction = conn.transaction()?;
    let attempt = load_attempt(&transaction, attempt_id)?
        .ok_or_else(|| JobsError::NotFound(format!("job attempt '{attempt_id}' was not found")))?;
    if attempt.node_id != node_id {
        return Err(JobsError::NotFound(format!(
            "job attempt '{attempt_id}' does not belong to node '{node_id}'"
        )));
    }

    if let Some(state) = terminal_attempt_state(attempt.state) {
        if state == AttemptState::Failed {
            transaction.commit()?;
            return snapshot(conn, &node_job_id(conn, node_id)?);
        }
        return Err(JobsError::AttemptAlreadyFinished);
    }

    let node = load_node_by_id(&transaction, node_id)?
        .ok_or_else(|| JobsError::NotFound(format!("job node '{node_id}' was not found")))?;
    let job = load_job(&transaction, &node.job_id)?
        .ok_or_else(|| JobsError::NotFound(format!("job '{}' was not found", node.job_id)))?;
    if is_terminal(job.state) {
        return Err(JobsError::JobFinished);
    }
    if node.state != JobState::Running {
        return Err(JobsError::Internal(format!(
            "attempt '{attempt_id}' is running but node '{node_id}' is not"
        )));
    }

    let now = now(&transaction)?;
    transaction.execute(
        "UPDATE job_attempts
         SET state = 'FAILED', finished_at = ?1, error_code = ?2, error_detail = ?3
         WHERE id = ?4 AND state = 'RUNNING'",
        params![now, error_code, error_detail, attempt_id],
    )?;

    let retryable = node.attempt_count < node.max_attempts;
    if retryable {
        transaction.execute(
            "UPDATE job_nodes
             SET state = 'READY', error_code = ?1, updated_at = ?2
             WHERE id = ?3 AND state = 'RUNNING'",
            params![error_code, now, node_id],
        )?;
        transaction.execute(
            "UPDATE jobs SET updated_at = ?1 WHERE id = ?2",
            params![now, node.job_id],
        )?;
    } else {
        transaction.execute(
            "UPDATE job_nodes
             SET state = 'FAILED', error_code = ?1, updated_at = ?2
             WHERE id = ?3 AND state = 'RUNNING'",
            params![error_code, now, node_id],
        )?;
        // A terminal job must never keep running or unstarted work behind it:
        // cancel every other outstanding node and attempt in the same
        // transaction so progress cannot keep reporting movement on a failed
        // job. The failed node stays FAILED rather than CANCELLED.
        cancel_outstanding_work(&transaction, &node.job_id, &now)?;
        transaction.execute(
            "UPDATE jobs SET state = 'FAILED', updated_at = ?1 WHERE id = ?2",
            params![now, node.job_id],
        )?;
    }

    transaction.commit()?;
    snapshot(conn, &node.job_id)
}

/// Explicitly re-arm an interrupted video production. Unlike automatic
/// attempts, this requires the local renderer to invoke it and immediately
/// claim the one newly READY step. All successful outputs and attempts remain.
pub fn retry_failed_video_job(
    conn: &mut Connection,
    job_id: &str,
) -> Result<JobSnapshot, JobsError> {
    let transaction = conn.transaction()?;
    let dag = load_dag(&transaction, job_id)?;
    if !matches!(
        dag.job.job_kind.as_str(),
        "video-production"
            | "video-asset-download"
            | "video-narration-scene"
            | "video-render-segment"
            | "video-thumbnail-concept"
    ) {
        return Err(JobsError::Forbidden);
    }
    if !matches!(dag.job.state, JobState::Failed | JobState::Cancelled) {
        return Err(JobsError::NodeNotReady);
    }
    let succeeded: HashSet<_> = dag
        .nodes
        .iter()
        .filter(|node| node.state == JobState::Succeeded)
        .map(|node| node.id.as_str())
        .collect();
    let now = now(&transaction)?;
    let mut ready = 0;
    for node in dag
        .nodes
        .iter()
        .filter(|node| node.state != JobState::Succeeded)
    {
        let dependencies_met = dag
            .edges
            .iter()
            .filter(|edge| edge.to_node_id == node.id)
            .all(|edge| succeeded.contains(edge.from_node_id.as_str()));
        let max_attempts = if dependencies_met && node.attempt_count >= node.max_attempts {
            if node.max_attempts >= contentgen_core::MAX_ATTEMPTS_LIMIT {
                return Err(JobsError::RetryLimitExceeded);
            }
            node.max_attempts + 1
        } else {
            node.max_attempts
        };
        if dependencies_met {
            ready += 1;
        }
        transaction.execute(
            "UPDATE job_nodes SET state = ?1, max_attempts = ?2, error_code = NULL,
                    output_json = NULL, updated_at = ?3 WHERE id = ?4",
            params![
                if dependencies_met { "READY" } else { "PENDING" },
                i64::from(max_attempts),
                now,
                node.id
            ],
        )?;
    }
    if ready != 1 {
        return Err(JobsError::InvalidDocument(
            "video production retry requires one ready step".to_owned(),
        ));
    }
    transaction.execute(
        "UPDATE jobs SET state = 'RUNNING', updated_at = ?1 WHERE id = ?2",
        params![now, job_id],
    )?;
    transaction.commit()?;
    snapshot(conn, job_id)
}

pub fn cancel_job(conn: &mut Connection, job_id: &str) -> Result<JobSnapshot, JobsError> {
    let transaction = conn.transaction()?;
    let job = load_job(&transaction, job_id)?
        .ok_or_else(|| JobsError::NotFound(format!("job '{job_id}' was not found")))?;

    match job.state {
        JobState::Succeeded | JobState::Failed => return Err(JobsError::JobFinished),
        JobState::Cancelled => {
            transaction.commit()?;
            return snapshot(conn, job_id);
        }
        JobState::Pending | JobState::Ready | JobState::Running => {}
    }

    let now = now(&transaction)?;
    transaction.execute(
        "UPDATE job_attempts
         SET state = 'CANCELLED', finished_at = ?1
         WHERE state = 'RUNNING'
           AND node_id IN (SELECT id FROM job_nodes WHERE job_id = ?2)",
        params![now, job_id],
    )?;
    transaction.execute(
        "UPDATE job_nodes
         SET state = 'CANCELLED', updated_at = ?1
         WHERE job_id = ?2 AND state IN ('PENDING', 'READY', 'RUNNING')",
        params![now, job_id],
    )?;
    transaction.execute(
        "UPDATE jobs SET state = 'CANCELLED', updated_at = ?1 WHERE id = ?2",
        params![now, job_id],
    )?;
    transaction.commit()?;
    snapshot(conn, job_id)
}

pub fn reconcile_orphans(
    conn: &mut Connection,
    job_id: Option<&str>,
) -> Result<Vec<ReconciledAttempt>, JobsError> {
    reconcile_attempts(conn, job_id, false)
}

/// Recover only worker attempts whose heartbeat has not been renewed for two
/// minutes. Unlike startup reconciliation, this is safe to call while other
/// Node workers are alive, and never touches unrelated research jobs.
pub fn reconcile_stale_video_attempts(
    conn: &mut Connection,
    job_id: &str,
) -> Result<Vec<ReconciledAttempt>, JobsError> {
    reconcile_attempts(conn, Some(job_id), true)
}

/// The background recovery sweep uses the same transactional eligibility
/// checks as an explicit worker retry. It touches only expired video attempts;
/// successful work and non-video Jobs are never rearmed by this sweep.
pub fn reconcile_all_stale_video_attempts(
    conn: &mut Connection,
) -> Result<Vec<ReconciledAttempt>, JobsError> {
    reconcile_attempts(conn, None, true)
}

fn reconcile_attempts(
    conn: &mut Connection,
    job_id: Option<&str>,
    stale_only: bool,
) -> Result<Vec<ReconciledAttempt>, JobsError> {
    let transaction = conn.transaction()?;
    let rows = {
        let mut statement = transaction.prepare(
            "SELECT a.id, a.node_id, n.job_id, n.attempt_count, n.max_attempts
             FROM job_attempts a
             JOIN job_nodes n ON n.id = a.node_id
             JOIN jobs j ON j.id = n.job_id
             WHERE a.state = 'RUNNING'
               AND (?1 IS NULL OR n.job_id = ?1)
               AND (?2 = 0 OR (j.job_kind LIKE 'video-%'
                 AND n.updated_at <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-120 seconds')))
             ORDER BY a.id",
        )?;
        statement
            .query_map(params![job_id, stale_only], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?
    };

    let now = now(&transaction)?;
    let detail = if stale_only {
        "Video generation was interrupted. Retry to resume using completed scenes."
    } else {
        "attempt was still running when the process restarted; \
         reconciled as failed instead of being assumed complete"
    };
    let code = if stale_only {
        "worker_lease_expired"
    } else {
        "orphaned_after_restart"
    };
    let mut reconciled = Vec::with_capacity(rows.len());
    for (attempt_id, node_id, owner_job_id, attempt_count, max_attempts) in rows {
        let changed = transaction.execute(
            "UPDATE job_attempts
             SET state = 'FAILED', finished_at = ?1,
                 error_code = ?2, error_detail = ?3
             WHERE id = ?4 AND state = 'RUNNING'",
            params![now, code, detail, attempt_id],
        )?;
        if changed == 0 {
            continue;
        }

        if attempt_count < max_attempts {
            transaction.execute(
                "UPDATE job_nodes
                 SET state = 'READY', error_code = ?3, updated_at = ?1
                 WHERE id = ?2",
                params![now, node_id, code],
            )?;
            transaction.execute(
                "UPDATE jobs SET updated_at = ?1 WHERE id = ?2",
                params![now, owner_job_id],
            )?;
        } else {
            transaction.execute(
                "UPDATE job_nodes
                 SET state = 'FAILED', error_code = ?3, updated_at = ?1
                 WHERE id = ?2",
                params![now, node_id, code],
            )?;
            cancel_outstanding_work(&transaction, &owner_job_id, &now)?;
            transaction.execute(
                "UPDATE jobs SET state = 'FAILED', updated_at = ?1 WHERE id = ?2",
                params![now, owner_job_id],
            )?;
        }

        reconciled.push(ReconciledAttempt {
            attempt_id,
            node_id,
            job_id: owner_job_id,
            state: AttemptState::Failed,
        });
    }

    transaction.commit()?;
    Ok(reconciled)
}

/// Cancel every node and attempt that is still outstanding for a job.
///
/// Used when a job reaches a terminal failure so no later worker can keep
/// executing (or report progress for) work that the job has already abandoned.
fn cancel_outstanding_work(
    transaction: &Connection,
    job_id: &str,
    now: &str,
) -> Result<(), JobsError> {
    transaction.execute(
        "UPDATE job_attempts
         SET state = 'CANCELLED', finished_at = ?1
         WHERE state = 'RUNNING'
           AND node_id IN (SELECT id FROM job_nodes WHERE job_id = ?2)",
        params![now, job_id],
    )?;
    transaction.execute(
        "UPDATE job_nodes
         SET state = 'CANCELLED', updated_at = ?1
         WHERE job_id = ?2 AND state IN ('PENDING', 'READY', 'RUNNING')",
        params![now, job_id],
    )?;
    Ok(())
}

fn existing_job(
    conn: &Connection,
    job_id: &str,
    request: &SubmitRequest,
) -> Result<SubmitOutcome, JobsError> {
    let job = load_job(conn, job_id)?
        .ok_or_else(|| JobsError::NotFound(format!("job '{job_id}' was not found")))?;
    if job.job_kind != request.job_kind {
        return Err(JobsError::IdempotencyConflict(format!(
            "key '{}' already belongs to job kind '{}'",
            request.idempotency_key, job.job_kind
        )));
    }
    Ok(SubmitOutcome::Existing(snapshot(conn, job_id)?))
}

fn build_dag(request: &SubmitRequest, job_id: &str, now: &str) -> Result<JobDag, JobsError> {
    if request.job_kind.trim().is_empty() {
        return Err(JobsError::InvalidDocument(
            "job_kind must not be blank".to_owned(),
        ));
    }
    if request.idempotency_key.trim().is_empty() {
        return Err(JobsError::InvalidDocument(
            "idempotency_key must not be blank".to_owned(),
        ));
    }
    if request.nodes.is_empty() {
        // A DAG without nodes could never reach a terminal state, so it must be
        // refused instead of being persisted as a job that can never finish.
        return Err(JobsError::InvalidDocument(
            "a job must declare at least one node".to_owned(),
        ));
    }

    let mut node_ids: HashMap<&str, String> = HashMap::new();
    for request_node in &request.nodes {
        if request_node.node_key.trim().is_empty() {
            return Err(JobsError::InvalidDocument(
                "node_key must not be blank".to_owned(),
            ));
        }
        if request_node.node_kind.trim().is_empty() {
            return Err(JobsError::InvalidDocument(
                "node_kind must not be blank".to_owned(),
            ));
        }
        if request_node.max_attempts == 0 || request_node.max_attempts > MAX_ATTEMPTS_LIMIT {
            return Err(JobsError::InvalidDocument(format!(
                "node '{}' max_attempts must be 1..={MAX_ATTEMPTS_LIMIT}",
                request_node.node_key
            )));
        }
        if node_ids
            .insert(
                request_node.node_key.as_str(),
                derive_node_id(job_id, &request_node.node_key),
            )
            .is_some()
        {
            return Err(JobsError::InvalidDocument(format!(
                "duplicate node_key '{}'",
                request_node.node_key
            )));
        }
        for dependency in &request_node.depends_on {
            if dependency == &request_node.node_key {
                return Err(JobsError::InvalidDocument(format!(
                    "node '{}' cannot depend on itself",
                    request_node.node_key
                )));
            }
            if !request
                .nodes
                .iter()
                .any(|candidate| &candidate.node_key == dependency)
            {
                return Err(JobsError::InvalidDocument(format!(
                    "node '{}' depends on unknown node '{}'",
                    request_node.node_key, dependency
                )));
            }
        }
    }

    let job = Job {
        schema_version: contentgen_core::JOBS_SCHEMA_VERSION,
        id: job_id.to_owned(),
        job_kind: request.job_kind.clone(),
        state: JobState::Running,
        idempotency_key: request.idempotency_key.clone(),
        created_at: now.to_owned(),
        updated_at: now.to_owned(),
    };

    let mut nodes = Vec::with_capacity(request.nodes.len());
    let mut edges = Vec::new();
    let mut seen_edges = HashSet::new();
    for request_node in &request.nodes {
        let node_id = node_ids
            .get(request_node.node_key.as_str())
            .expect("every node key was validated above")
            .clone();
        nodes.push(JobNode {
            schema_version: contentgen_core::JOBS_SCHEMA_VERSION,
            id: node_id.clone(),
            job_id: job_id.to_owned(),
            node_key: request_node.node_key.clone(),
            node_kind: request_node.node_kind.clone(),
            state: if request_node.depends_on.is_empty() {
                JobState::Ready
            } else {
                JobState::Pending
            },
            attempt_count: 0,
            max_attempts: request_node.max_attempts,
            idempotency_key: format!("{job_id}/{}", request_node.node_key),
            input: request_node.input.clone(),
            output: None,
            error_code: None,
            created_at: now.to_owned(),
            updated_at: now.to_owned(),
        });

        for dependency in &request_node.depends_on {
            let from_node_id = node_ids
                .get(dependency.as_str())
                .expect("every dependency was validated above")
                .clone();
            if !seen_edges.insert((from_node_id.clone(), node_id.clone())) {
                return Err(JobsError::InvalidDocument(format!(
                    "node '{}' lists dependency '{}' more than once",
                    request_node.node_key, dependency
                )));
            }
            edges.push(JobEdge {
                job_id: job_id.to_owned(),
                from_node_id,
                to_node_id: node_id.clone(),
                edge_kind: EdgeKind::Dependency,
                created_at: now.to_owned(),
            });
        }
    }

    let dag = JobDag {
        schema_version: contentgen_core::JOBS_SCHEMA_VERSION,
        job,
        nodes,
        edges,
        attempts: Vec::new(),
    };
    // Validation (including cycle detection) happens before any row is written.
    dag.validate()?;
    Ok(dag)
}

fn refresh_successors(
    transaction: &Connection,
    job_id: &str,
    from_node_id: &str,
    now: &str,
) -> Result<(), JobsError> {
    let successors = {
        let mut statement = transaction.prepare(
            "SELECT to_node_id FROM job_edges
             WHERE job_id = ?1 AND from_node_id = ?2 AND edge_kind = 'dependency'",
        )?;
        statement
            .query_map(params![job_id, from_node_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?
    };

    for successor in successors {
        let pending = transaction
            .query_row(
                "SELECT state FROM job_nodes WHERE id = ?1",
                [successor.as_str()],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if pending.as_deref() != Some("PENDING") {
            continue;
        }

        let unmet: i64 = transaction.query_row(
            "SELECT count(*)
             FROM job_edges e
             JOIN job_nodes n ON n.id = e.from_node_id
             WHERE e.job_id = ?1 AND e.to_node_id = ?2
               AND e.edge_kind = 'dependency' AND n.state <> 'SUCCEEDED'",
            params![job_id, successor],
            |row| row.get(0),
        )?;
        if unmet == 0 {
            transaction.execute(
                "UPDATE job_nodes SET state = 'READY', updated_at = ?1
                 WHERE id = ?2 AND state = 'PENDING'",
                params![now, successor],
            )?;
        }
    }
    Ok(())
}

fn progress_of(nodes: &[JobNode]) -> JobProgress {
    let mut progress = JobProgress {
        total: nodes.len(),
        pending: 0,
        ready: 0,
        running: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
    };
    for node in nodes {
        match node.state {
            JobState::Pending => progress.pending += 1,
            JobState::Ready => progress.ready += 1,
            JobState::Running => progress.running += 1,
            JobState::Succeeded => progress.succeeded += 1,
            JobState::Failed => progress.failed += 1,
            JobState::Cancelled => progress.cancelled += 1,
        }
    }
    progress
}

fn is_terminal(state: JobState) -> bool {
    matches!(
        state,
        JobState::Succeeded | JobState::Failed | JobState::Cancelled
    )
}

fn terminal_attempt_state(state: AttemptState) -> Option<AttemptState> {
    match state {
        AttemptState::Running => None,
        AttemptState::Succeeded | AttemptState::Failed | AttemptState::Cancelled => Some(state),
    }
}

fn node_job_id(conn: &Connection, node_id: &str) -> Result<String, JobsError> {
    conn.query_row(
        "SELECT job_id FROM job_nodes WHERE id = ?1",
        [node_id],
        |row| row.get::<_, String>(0),
    )
    .optional()?
    .ok_or_else(|| JobsError::NotFound(format!("job node '{node_id}' was not found")))
}

fn load_dag(conn: &Connection, job_id: &str) -> Result<JobDag, JobsError> {
    let job = load_job(conn, job_id)?
        .ok_or_else(|| JobsError::NotFound(format!("job '{job_id}' was not found")))?;

    let nodes = {
        let mut statement = conn.prepare(
            "SELECT id, schema_version, job_id, node_key, node_kind, state, attempt_count,
                    max_attempts, idempotency_key, input_json, output_json, error_code,
                    created_at, updated_at
             FROM job_nodes WHERE job_id = ?1 ORDER BY id",
        )?;
        statement
            .query_map([job_id], map_node)?
            .collect::<Result<Vec<_>, _>>()?
    };

    let edges = {
        let mut statement = conn.prepare(
            "SELECT job_id, from_node_id, to_node_id, edge_kind, created_at
             FROM job_edges WHERE job_id = ?1 ORDER BY from_node_id, to_node_id",
        )?;
        statement
            .query_map([job_id], map_edge)?
            .collect::<Result<Vec<_>, _>>()?
    };

    let attempts = {
        let mut statement = conn.prepare(
            "SELECT id, node_id, attempt_number, idempotency_key, state, started_at,
                    finished_at, error_code, error_detail, metadata_json, created_at
             FROM job_attempts
             WHERE node_id IN (SELECT id FROM job_nodes WHERE job_id = ?1)
             ORDER BY id",
        )?;
        statement
            .query_map([job_id], map_attempt)?
            .collect::<Result<Vec<_>, _>>()?
    };

    Ok(JobDag {
        schema_version: contentgen_core::JOBS_SCHEMA_VERSION,
        job,
        nodes,
        edges,
        attempts,
    })
}

fn load_job(conn: &Connection, job_id: &str) -> Result<Option<Job>, JobsError> {
    Ok(conn
        .query_row(
            "SELECT id, schema_version, job_kind, state, idempotency_key, created_at, updated_at
             FROM jobs WHERE id = ?1",
            [job_id],
            map_job,
        )
        .optional()?)
}

fn load_node(conn: &Connection, job_id: &str, node_id: &str) -> Result<Option<JobNode>, JobsError> {
    Ok(conn
        .query_row(
            "SELECT id, schema_version, job_id, node_key, node_kind, state, attempt_count,
                    max_attempts, idempotency_key, input_json, output_json, error_code,
                    created_at, updated_at
             FROM job_nodes WHERE id = ?1 AND job_id = ?2",
            params![node_id, job_id],
            map_node,
        )
        .optional()?)
}

fn load_node_by_id(conn: &Connection, node_id: &str) -> Result<Option<JobNode>, JobsError> {
    Ok(conn
        .query_row(
            "SELECT id, schema_version, job_id, node_key, node_kind, state, attempt_count,
                    max_attempts, idempotency_key, input_json, output_json, error_code,
                    created_at, updated_at
             FROM job_nodes WHERE id = ?1",
            [node_id],
            map_node,
        )
        .optional()?)
}

fn load_attempt(conn: &Connection, attempt_id: &str) -> Result<Option<JobAttempt>, JobsError> {
    Ok(conn
        .query_row(
            "SELECT id, node_id, attempt_number, idempotency_key, state, started_at,
                    finished_at, error_code, error_detail, metadata_json, created_at
             FROM job_attempts WHERE id = ?1",
            [attempt_id],
            map_attempt,
        )
        .optional()?)
}

fn find_job_id_by_key(conn: &Connection, key: &str) -> Result<Option<String>, JobsError> {
    Ok(conn
        .query_row(
            "SELECT id FROM jobs WHERE idempotency_key = ?1",
            [key],
            |row| row.get::<_, String>(0),
        )
        .optional()?)
}

fn map_job(row: &Row<'_>) -> rusqlite::Result<Job> {
    let state_text: String = row.get(3)?;
    let state = job_state_from_code(&state_text)
        .ok_or_else(|| invalid_enum(3, job_state_codes(), &state_text))?;
    Ok(Job {
        id: row.get(0)?,
        schema_version: row.get(1)?,
        job_kind: row.get(2)?,
        state,
        idempotency_key: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn map_node(row: &Row<'_>) -> rusqlite::Result<JobNode> {
    let state_text: String = row.get(5)?;
    let state = job_state_from_code(&state_text)
        .ok_or_else(|| invalid_enum(5, job_state_codes(), &state_text))?;
    let input_json: String = row.get(9)?;
    let output_json: Option<String> = row.get(10)?;
    Ok(JobNode {
        id: row.get(0)?,
        schema_version: row.get(1)?,
        job_id: row.get(2)?,
        node_key: row.get(3)?,
        node_kind: row.get(4)?,
        state,
        attempt_count: row.get(6)?,
        max_attempts: row.get(7)?,
        idempotency_key: row.get(8)?,
        input: serde_json::from_str(&input_json).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                9,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?,
        output: output_json
            .map(|json| {
                serde_json::from_str(&json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        10,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })
            })
            .transpose()?,
        error_code: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
    })
}

fn map_edge(row: &Row<'_>) -> rusqlite::Result<JobEdge> {
    let kind_text: String = row.get(3)?;
    let edge_kind = edge_kind_from_code(&kind_text)
        .ok_or_else(|| invalid_enum(3, edge_kind_codes(), &kind_text))?;
    Ok(JobEdge {
        job_id: row.get(0)?,
        from_node_id: row.get(1)?,
        to_node_id: row.get(2)?,
        edge_kind,
        created_at: row.get(4)?,
    })
}

fn map_attempt(row: &Row<'_>) -> rusqlite::Result<JobAttempt> {
    let state_text: String = row.get(4)?;
    let state = attempt_state_from_code(&state_text)
        .ok_or_else(|| invalid_enum(4, attempt_state_codes(), &state_text))?;
    let metadata_json: String = row.get(9)?;
    Ok(JobAttempt {
        id: row.get(0)?,
        node_id: row.get(1)?,
        attempt_number: row.get(2)?,
        idempotency_key: row.get(3)?,
        state,
        started_at: row.get(5)?,
        finished_at: row.get(6)?,
        error_code: row.get(7)?,
        error_detail: row.get(8)?,
        metadata: serde_json::from_str(&metadata_json).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                9,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?,
        created_at: row.get(10)?,
    })
}

fn invalid_enum(column: usize, allowed: &str, value: &str) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        column,
        rusqlite::types::Type::Text,
        Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("unknown value '{value}'; expected one of {allowed}"),
        )),
    )
}

fn now(conn: &Connection) -> Result<String, JobsError> {
    Ok(
        conn.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%SZ', 'now')", [], |row| {
            row.get(0)
        })?,
    )
}

fn is_constraint_violation(error: &rusqlite::Error) -> bool {
    error.sqlite_error_code() == Some(rusqlite::ErrorCode::ConstraintViolation)
}

fn digest_prefix(value: &str) -> String {
    sha256_hex(value.as_bytes())[..16].to_owned()
}

fn derive_job_id(job_kind: &str, idempotency_key: &str) -> String {
    format!(
        "job_{}",
        digest_prefix(&format!("{job_kind}\0{idempotency_key}"))
    )
}

fn derive_node_id(job_id: &str, node_key: &str) -> String {
    format!("node_{}", digest_prefix(&format!("{job_id}\0{node_key}")))
}

fn derive_attempt_id(node_id: &str, attempt_number: u32) -> String {
    format!(
        "att_{}",
        digest_prefix(&format!("{node_id}#{attempt_number}"))
    )
}

fn job_state_code(state: JobState) -> &'static str {
    match state {
        JobState::Pending => "PENDING",
        JobState::Ready => "READY",
        JobState::Running => "RUNNING",
        JobState::Succeeded => "SUCCEEDED",
        JobState::Failed => "FAILED",
        JobState::Cancelled => "CANCELLED",
    }
}

fn job_state_from_code(code: &str) -> Option<JobState> {
    match code {
        "PENDING" => Some(JobState::Pending),
        "READY" => Some(JobState::Ready),
        "RUNNING" => Some(JobState::Running),
        "SUCCEEDED" => Some(JobState::Succeeded),
        "FAILED" => Some(JobState::Failed),
        "CANCELLED" => Some(JobState::Cancelled),
        _ => None,
    }
}

fn job_state_codes() -> &'static str {
    "PENDING, READY, RUNNING, SUCCEEDED, FAILED, CANCELLED"
}

fn attempt_state_from_code(code: &str) -> Option<AttemptState> {
    match code {
        "RUNNING" => Some(AttemptState::Running),
        "SUCCEEDED" => Some(AttemptState::Succeeded),
        "FAILED" => Some(AttemptState::Failed),
        "CANCELLED" => Some(AttemptState::Cancelled),
        _ => None,
    }
}

fn attempt_state_codes() -> &'static str {
    "RUNNING, SUCCEEDED, FAILED, CANCELLED"
}

fn edge_kind_code(kind: EdgeKind) -> &'static str {
    match kind {
        EdgeKind::Dependency => "dependency",
        EdgeKind::Data => "data",
    }
}

fn edge_kind_from_code(code: &str) -> Option<EdgeKind> {
    match code {
        "dependency" => Some(EdgeKind::Dependency),
        "data" => Some(EdgeKind::Data),
        _ => None,
    }
}

fn edge_kind_codes() -> &'static str {
    "dependency, data"
}
