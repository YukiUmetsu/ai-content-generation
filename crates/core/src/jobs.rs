use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::Validate;
use crate::error::{
    DomainError, ensure_identifier, ensure_metadata_json, ensure_schema_version, ensure_text,
    ensure_timestamp,
};

pub const JOBS_SCHEMA_VERSION: u32 = 1;
pub const MAX_ATTEMPTS_LIMIT: u32 = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum JobState {
    Pending,
    Ready,
    Running,
    Succeeded,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AttemptState {
    Running,
    Succeeded,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EdgeKind {
    Dependency,
    Data,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Job {
    pub schema_version: u32,
    pub id: String,
    pub job_kind: String,
    pub state: JobState,
    pub idempotency_key: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobNode {
    pub schema_version: u32,
    pub id: String,
    pub job_id: String,
    pub node_key: String,
    pub node_kind: String,
    pub state: JobState,
    pub attempt_count: u32,
    pub max_attempts: u32,
    pub idempotency_key: String,
    #[serde(default)]
    pub input: Value,
    #[serde(default)]
    pub output: Option<Value>,
    #[serde(default)]
    pub error_code: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobEdge {
    pub job_id: String,
    pub from_node_id: String,
    pub to_node_id: String,
    pub edge_kind: EdgeKind,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobAttempt {
    pub id: String,
    pub node_id: String,
    pub attempt_number: u32,
    pub idempotency_key: String,
    pub state: AttemptState,
    pub started_at: String,
    #[serde(default)]
    pub finished_at: Option<String>,
    #[serde(default)]
    pub error_code: Option<String>,
    #[serde(default)]
    pub error_detail: Option<String>,
    #[serde(default)]
    pub metadata: serde_json::Map<String, Value>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobDag {
    pub schema_version: u32,
    pub job: Job,
    pub nodes: Vec<JobNode>,
    #[serde(default)]
    pub edges: Vec<JobEdge>,
    #[serde(default)]
    pub attempts: Vec<JobAttempt>,
}

impl Validate for Job {
    fn validate(&self) -> Result<(), DomainError> {
        ensure_schema_version("job", self.schema_version, JOBS_SCHEMA_VERSION)?;
        ensure_identifier("job id", &self.id)?;
        ensure_text("job kind", &self.job_kind)?;
        ensure_text("job idempotency key", &self.idempotency_key)?;
        ensure_timestamp("job created_at", &self.created_at)?;
        ensure_timestamp("job updated_at", &self.updated_at)?;
        if self.updated_at < self.created_at {
            return Err(DomainError::RuleViolation {
                message: "job updated_at must not precede created_at".to_owned(),
            });
        }
        Ok(())
    }
}

impl Validate for JobNode {
    fn validate(&self) -> Result<(), DomainError> {
        ensure_schema_version("job node", self.schema_version, JOBS_SCHEMA_VERSION)?;
        ensure_identifier("job node id", &self.id)?;
        ensure_identifier("job node job_id", &self.job_id)?;
        ensure_text("job node key", &self.node_key)?;
        ensure_text("job node kind", &self.node_kind)?;
        ensure_text("job node idempotency key", &self.idempotency_key)?;
        ensure_timestamp("job node created_at", &self.created_at)?;
        ensure_timestamp("job node updated_at", &self.updated_at)?;
        if self.updated_at < self.created_at {
            return Err(DomainError::RuleViolation {
                message: "job node updated_at must not precede created_at".to_owned(),
            });
        }
        if self.max_attempts == 0 || self.max_attempts > MAX_ATTEMPTS_LIMIT {
            return Err(DomainError::RuleViolation {
                message: format!("job node max_attempts must be 1..={MAX_ATTEMPTS_LIMIT}"),
            });
        }
        if self.attempt_count > self.max_attempts {
            return Err(DomainError::RetryLimitExceeded {
                attempt: self.attempt_count,
                max_attempts: self.max_attempts,
            });
        }
        if matches!(
            self.state,
            JobState::Running | JobState::Succeeded | JobState::Failed
        ) && self.attempt_count == 0
        {
            return Err(DomainError::RuleViolation {
                message: format!(
                    "job node '{}' is {:?} but has no attempts",
                    self.id, self.state
                ),
            });
        }
        if let Some(error_code) = &self.error_code {
            ensure_text("job node error_code", error_code)?;
        }
        Ok(())
    }
}

impl Validate for JobDag {
    fn validate(&self) -> Result<(), DomainError> {
        ensure_schema_version("job DAG", self.schema_version, JOBS_SCHEMA_VERSION)?;
        self.job.validate()?;

        let mut node_ids = HashSet::new();
        let mut node_keys = HashSet::new();
        let mut node_idempotency_keys = HashSet::new();
        for node in &self.nodes {
            node.validate()?;
            if node.job_id != self.job.id {
                return Err(DomainError::CrossJobReference);
            }
            if !node_ids.insert(node.id.as_str()) {
                return Err(DomainError::RuleViolation {
                    message: format!("duplicate job node id '{}'", node.id),
                });
            }
            if !node_keys.insert(node.node_key.as_str()) {
                return Err(DomainError::RuleViolation {
                    message: format!("duplicate job node key '{}'", node.node_key),
                });
            }
            if !node_idempotency_keys.insert(node.idempotency_key.as_str()) {
                return Err(DomainError::RuleViolation {
                    message: format!(
                        "duplicate job node idempotency key '{}'",
                        node.idempotency_key
                    ),
                });
            }
        }

        let mut edge_triples = HashSet::new();
        for edge in &self.edges {
            ensure_identifier("job edge job_id", &edge.job_id)?;
            ensure_identifier("job edge from_node_id", &edge.from_node_id)?;
            ensure_identifier("job edge to_node_id", &edge.to_node_id)?;
            ensure_timestamp("job edge created_at", &edge.created_at)?;
            if edge.job_id != self.job.id {
                return Err(DomainError::CrossJobReference);
            }
            if edge.from_node_id == edge.to_node_id {
                return Err(DomainError::RuleViolation {
                    message: "job edge cannot point at its own node".to_owned(),
                });
            }
            if !node_ids.contains(edge.from_node_id.as_str())
                || !node_ids.contains(edge.to_node_id.as_str())
            {
                return Err(DomainError::RuleViolation {
                    message: "job edge references an unknown node".to_owned(),
                });
            }
            if !edge_triples.insert((edge.from_node_id.as_str(), edge.to_node_id.as_str())) {
                return Err(DomainError::RuleViolation {
                    message: "duplicate job edge".to_owned(),
                });
            }
        }
        ensure_acyclic(&self.nodes, &self.edges)?;

        let mut attempts_per_node: HashMap<&str, u32> = HashMap::new();
        let mut attempt_ids = HashSet::new();
        let mut attempt_numbers = HashSet::new();
        for attempt in &self.attempts {
            validate_attempt(attempt, &self.nodes)?;
            if !attempt_ids.insert(attempt.id.as_str()) {
                return Err(DomainError::RuleViolation {
                    message: format!("duplicate job attempt id '{}'", attempt.id),
                });
            }
            if !attempt_numbers.insert((attempt.node_id.as_str(), attempt.attempt_number)) {
                return Err(DomainError::RuleViolation {
                    message: format!(
                        "duplicate attempt {} for node '{}'",
                        attempt.attempt_number, attempt.node_id
                    ),
                });
            }
            *attempts_per_node
                .entry(attempt.node_id.as_str())
                .or_default() += 1;
        }

        for node in &self.nodes {
            let recorded = attempts_per_node
                .get(node.id.as_str())
                .copied()
                .unwrap_or(0);
            if recorded != node.attempt_count {
                return Err(DomainError::RuleViolation {
                    message: format!(
                        "job node '{}' declares {} attempts but has {} attempt records",
                        node.id, node.attempt_count, recorded
                    ),
                });
            }
        }

        validate_job_state_consistency(&self.job, &self.nodes)
    }
}

fn validate_attempt(attempt: &JobAttempt, nodes: &[JobNode]) -> Result<(), DomainError> {
    ensure_identifier("job attempt id", &attempt.id)?;
    ensure_identifier("job attempt node_id", &attempt.node_id)?;
    ensure_text("job attempt idempotency key", &attempt.idempotency_key)?;
    ensure_timestamp("job attempt started_at", &attempt.started_at)?;
    ensure_timestamp("job attempt created_at", &attempt.created_at)?;
    if let Some(finished_at) = &attempt.finished_at {
        ensure_timestamp("job attempt finished_at", finished_at)?;
        if finished_at < &attempt.started_at {
            return Err(DomainError::RuleViolation {
                message: "job attempt finished_at must not precede started_at".to_owned(),
            });
        }
    }
    if let Some(error_code) = &attempt.error_code {
        ensure_text("job attempt error_code", error_code)?;
    }
    if let Some(error_detail) = &attempt.error_detail {
        ensure_text("job attempt error_detail", error_detail)?;
    }
    ensure_metadata_json("job attempt", &attempt.metadata)?;

    let node = nodes
        .iter()
        .find(|node| node.id == attempt.node_id)
        .ok_or_else(|| DomainError::RuleViolation {
            message: format!(
                "job attempt '{}' references unknown node '{}'",
                attempt.id, attempt.node_id
            ),
        })?;
    if attempt.attempt_number == 0 || attempt.attempt_number > node.max_attempts {
        return Err(DomainError::RetryLimitExceeded {
            attempt: attempt.attempt_number,
            max_attempts: node.max_attempts,
        });
    }
    if attempt.attempt_number > node.attempt_count {
        return Err(DomainError::RuleViolation {
            message: format!(
                "job attempt {} exceeds node '{}' attempt_count {}",
                attempt.attempt_number, node.id, node.attempt_count
            ),
        });
    }
    match (&attempt.state, &attempt.finished_at) {
        (AttemptState::Running, Some(_)) => Err(DomainError::RuleViolation {
            message: "running job attempt must not have finished_at".to_owned(),
        }),
        (AttemptState::Succeeded | AttemptState::Failed | AttemptState::Cancelled, None) => {
            Err(DomainError::RuleViolation {
                message: "finished job attempt requires finished_at".to_owned(),
            })
        }
        _ => Ok(()),
    }
}

fn ensure_acyclic(nodes: &[JobNode], edges: &[JobEdge]) -> Result<(), DomainError> {
    let mut index: HashMap<&str, usize> = HashMap::new();
    for (position, node) in nodes.iter().enumerate() {
        index.insert(node.id.as_str(), position);
    }
    let mut indegree = vec![0_usize; nodes.len()];
    let mut adjacency = vec![Vec::new(); nodes.len()];
    for edge in edges {
        let Some(&from) = index.get(edge.from_node_id.as_str()) else {
            continue;
        };
        let Some(&to) = index.get(edge.to_node_id.as_str()) else {
            continue;
        };
        adjacency[from].push(to);
        indegree[to] += 1;
    }

    let mut ready: Vec<usize> = indegree
        .iter()
        .enumerate()
        .filter_map(|(position, degree)| (*degree == 0).then_some(position))
        .collect();
    let mut visited = 0_usize;
    while let Some(position) = ready.pop() {
        visited += 1;
        for &next in &adjacency[position] {
            indegree[next] -= 1;
            if indegree[next] == 0 {
                ready.push(next);
            }
        }
    }
    if visited != nodes.len() {
        return Err(DomainError::CycleDetected);
    }
    Ok(())
}

fn validate_job_state_consistency(job: &Job, nodes: &[JobNode]) -> Result<(), DomainError> {
    match job.state {
        JobState::Succeeded if nodes.iter().any(|node| node.state != JobState::Succeeded) => {
            Err(DomainError::RuleViolation {
                message: "succeeded job requires every node to be succeeded".to_owned(),
            })
        }
        JobState::Failed if !nodes.iter().any(|node| node.state == JobState::Failed) => {
            Err(DomainError::RuleViolation {
                message: "failed job requires at least one failed node".to_owned(),
            })
        }
        JobState::Cancelled if nodes.iter().any(|node| node.state == JobState::Running) => {
            Err(DomainError::RuleViolation {
                message: "cancelled job must not have running nodes".to_owned(),
            })
        }
        _ => Ok(()),
    }
}
