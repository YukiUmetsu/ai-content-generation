use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::Validate;
use crate::error::{
    DomainError, ensure_finite, ensure_identifier, ensure_schema_version, ensure_text,
    ensure_timestamp,
};

pub const PACKAGING_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PackagingStatus {
    Draft,
    Approved,
    Rejected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PackagingStrategy {
    VisibleCostReversal,
    MechanismCutaway,
    DecisionComparison,
    EverydayMystery,
    RiskEscape,
    RealityCheck,
    ConcreteReversal,
    CounterintuitiveMechanism,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PremiseSetup {
    pub question: String,
    pub audience_stakes: String,
    pub opening_promise: String,
    pub evidence_refs: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PremisePayoff {
    pub answer_event_id: String,
    pub payoff_statement: String,
    pub limitation: String,
    pub evidence_refs: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackagingHypothesis {
    pub hypothesis_id: String,
    pub title: String,
    pub strategy: PackagingStrategy,
    pub thumbnail_concept: String,
    pub opening_visual: String,
    pub payoff_event_id: String,
    pub claim_refs: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MetricProvenanceKind {
    Measured,
    Estimated,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MetricValue {
    Number { value: f64 },
    Range { low: f64, high: f64 },
    Text { value: String },
    Boolean { value: bool },
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MetricProvenance {
    pub metric_key: String,
    pub provenance: MetricProvenanceKind,
    pub value: MetricValue,
    #[serde(default)]
    pub unit: Option<String>,
    #[serde(default)]
    pub source_version_id: Option<String>,
    #[serde(default)]
    pub observed_at: Option<String>,
    #[serde(default)]
    pub method: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackagingHypothesisSet {
    pub schema_version: u32,
    pub id: String,
    pub project_ref: String,
    pub status: PackagingStatus,
    pub premise_setup: PremiseSetup,
    pub premise_payoff: PremisePayoff,
    pub hypotheses: Vec<PackagingHypothesis>,
    #[serde(default)]
    pub metrics: Vec<MetricProvenance>,
    pub created_at: String,
    #[serde(default)]
    pub approved_at: Option<String>,
}

impl MetricProvenance {
    pub fn validate(&self) -> Result<(), DomainError> {
        ensure_text("metric key", &self.metric_key)?;
        if is_forbidden_metric_key(&self.metric_key) {
            return Err(DomainError::ForbiddenMetric {
                metric_key: self.metric_key.clone(),
            });
        }
        if let Some(unit) = &self.unit {
            ensure_text("metric unit", unit)?;
        }
        if let Some(source_version_id) = &self.source_version_id {
            ensure_identifier("metric source_version_id", source_version_id)?;
        }
        if let Some(observed_at) = &self.observed_at {
            ensure_timestamp("metric observed_at", observed_at)?;
        }
        if let Some(method) = &self.method {
            ensure_text("metric method", method)?;
        }

        match (&self.provenance, &self.value) {
            (MetricProvenanceKind::Unknown, MetricValue::Unknown) => {
                if self.source_version_id.is_some() || self.observed_at.is_some() {
                    return Err(DomainError::RuleViolation {
                        message: format!(
                            "unknown metric '{}' must not claim a source or observation time",
                            self.metric_key
                        ),
                    });
                }
            }
            (MetricProvenanceKind::Measured, MetricValue::Unknown)
            | (MetricProvenanceKind::Estimated, MetricValue::Unknown) => {
                return Err(DomainError::RuleViolation {
                    message: format!(
                        "{} metric '{}' requires a concrete value",
                        self.provenance_label(),
                        self.metric_key
                    ),
                });
            }
            (MetricProvenanceKind::Measured, _) => {
                if self.source_version_id.is_none() || self.observed_at.is_none() {
                    return Err(DomainError::RuleViolation {
                        message: format!(
                            "measured metric '{}' requires source_version_id and observed_at",
                            self.metric_key
                        ),
                    });
                }
            }
            (MetricProvenanceKind::Estimated, _) => {
                if self
                    .method
                    .as_deref()
                    .is_none_or(|method| method.trim().is_empty())
                {
                    return Err(DomainError::RuleViolation {
                        message: format!(
                            "estimated metric '{}' requires a non-empty method",
                            self.metric_key
                        ),
                    });
                }
            }
            (MetricProvenanceKind::Unknown, _) => {
                return Err(DomainError::RuleViolation {
                    message: format!(
                        "unknown metric '{}' must serialize its value as unknown",
                        self.metric_key
                    ),
                });
            }
        }

        match &self.value {
            MetricValue::Number { value } => ensure_finite("metric number value", *value),
            MetricValue::Range { low, high } => {
                ensure_finite("metric range low", *low)?;
                ensure_finite("metric range high", *high)?;
                if low > high {
                    return Err(DomainError::RuleViolation {
                        message: format!("metric '{}' range requires low <= high", self.metric_key),
                    });
                }
                Ok(())
            }
            MetricValue::Text { value } => ensure_text("metric text value", value),
            MetricValue::Boolean { .. } | MetricValue::Unknown => Ok(()),
        }
    }

    fn provenance_label(&self) -> &'static str {
        match self.provenance {
            MetricProvenanceKind::Measured => "measured",
            MetricProvenanceKind::Estimated => "estimated",
            MetricProvenanceKind::Unknown => "unknown",
        }
    }
}

impl Validate for PackagingHypothesisSet {
    fn validate(&self) -> Result<(), DomainError> {
        ensure_schema_version(
            "packaging hypothesis set",
            self.schema_version,
            PACKAGING_SCHEMA_VERSION,
        )?;
        ensure_identifier("packaging hypothesis set id", &self.id)?;
        ensure_identifier("packaging project_ref", &self.project_ref)?;
        ensure_timestamp("packaging hypothesis set created_at", &self.created_at)?;

        ensure_text(
            "packaging premise setup question",
            &self.premise_setup.question,
        )?;
        ensure_text(
            "packaging premise audience stakes",
            &self.premise_setup.audience_stakes,
        )?;
        ensure_text(
            "packaging premise opening promise",
            &self.premise_setup.opening_promise,
        )?;
        ensure_identifier(
            "packaging payoff answer_event_id",
            &self.premise_payoff.answer_event_id,
        )?;
        ensure_text(
            "packaging premise payoff statement",
            &self.premise_payoff.payoff_statement,
        )?;
        ensure_text(
            "packaging premise payoff limitation",
            &self.premise_payoff.limitation,
        )?;
        for evidence_ref in self
            .premise_setup
            .evidence_refs
            .iter()
            .chain(&self.premise_payoff.evidence_refs)
        {
            ensure_identifier("packaging evidence ref", evidence_ref)?;
        }

        if self.hypotheses.is_empty() || self.hypotheses.len() > 3 {
            return Err(DomainError::RuleViolation {
                message: "a packaging hypothesis set must contain 1..=3 hypotheses".to_owned(),
            });
        }

        let mut hypothesis_ids = HashSet::new();
        let mut strategies = HashSet::new();
        let mut titles = HashSet::new();
        for hypothesis in &self.hypotheses {
            ensure_identifier("packaging hypothesis id", &hypothesis.hypothesis_id)?;
            ensure_text("packaging hypothesis title", &hypothesis.title)?;
            ensure_text(
                "packaging hypothesis thumbnail concept",
                &hypothesis.thumbnail_concept,
            )?;
            ensure_text(
                "packaging hypothesis opening visual",
                &hypothesis.opening_visual,
            )?;
            ensure_identifier(
                "packaging hypothesis payoff_event_id",
                &hypothesis.payoff_event_id,
            )?;
            if hypothesis.payoff_event_id != self.premise_payoff.answer_event_id {
                return Err(DomainError::RuleViolation {
                    message: format!(
                        "hypothesis '{}' must pay off the set answer_event_id '{}'",
                        hypothesis.hypothesis_id, self.premise_payoff.answer_event_id
                    ),
                });
            }
            for claim_ref in &hypothesis.claim_refs {
                ensure_identifier("packaging claim ref", claim_ref)?;
            }
            if !hypothesis_ids.insert(hypothesis.hypothesis_id.as_str()) {
                return Err(DomainError::RuleViolation {
                    message: format!(
                        "duplicate packaging hypothesis id '{}'",
                        hypothesis.hypothesis_id
                    ),
                });
            }
            if !strategies.insert(hypothesis.strategy) {
                return Err(DomainError::RuleViolation {
                    message: format!(
                        "hypothesis '{}' duplicates strategy '{}'",
                        hypothesis.hypothesis_id,
                        strategy_label(hypothesis.strategy)
                    ),
                });
            }
            let normalized_title = hypothesis.title.trim().to_lowercase();
            if !titles.insert(normalized_title) {
                return Err(DomainError::RuleViolation {
                    message: format!(
                        "hypothesis '{}' duplicates another working title",
                        hypothesis.hypothesis_id
                    ),
                });
            }
        }

        let mut metric_keys = HashSet::new();
        for metric in &self.metrics {
            metric.validate()?;
            if !metric_keys.insert(metric.metric_key.as_str()) {
                return Err(DomainError::RuleViolation {
                    message: format!("duplicate metric key '{}'", metric.metric_key),
                });
            }
        }

        match self.status {
            PackagingStatus::Approved => {
                let approved_at =
                    self.approved_at
                        .as_deref()
                        .ok_or_else(|| DomainError::RuleViolation {
                            message: "approved packaging hypothesis set requires approved_at"
                                .to_owned(),
                        })?;
                ensure_timestamp("packaging approved_at", approved_at)?;
                if approved_at < self.created_at.as_str() {
                    return Err(DomainError::RuleViolation {
                        message: "packaging approved_at must not precede created_at".to_owned(),
                    });
                }
                if self.hypotheses.len() < 3 {
                    return Err(DomainError::RuleViolation {
                        message: "approved packaging requires three distinct hypotheses".to_owned(),
                    });
                }
                if self.premise_setup.evidence_refs.is_empty()
                    || self.premise_payoff.evidence_refs.is_empty()
                {
                    return Err(DomainError::RuleViolation {
                        message: "approved packaging requires setup and payoff evidence refs"
                            .to_owned(),
                    });
                }
                if self
                    .hypotheses
                    .iter()
                    .any(|hypothesis| hypothesis.claim_refs.is_empty())
                {
                    return Err(DomainError::RuleViolation {
                        message: "approved packaging hypotheses require claim refs".to_owned(),
                    });
                }
            }
            PackagingStatus::Draft | PackagingStatus::Rejected => {
                if self.approved_at.is_some() {
                    return Err(DomainError::RuleViolation {
                        message: "only an approved packaging set may carry approved_at".to_owned(),
                    });
                }
            }
        }

        Ok(())
    }
}

fn is_forbidden_metric_key(metric_key: &str) -> bool {
    let normalized: String = metric_key
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect();
    [
        "viralscore",
        "virality",
        "viralprobability",
        "predictedctr",
        "guaranteedctr",
        "guaranteedviews",
    ]
    .iter()
    .any(|forbidden| normalized.contains(forbidden))
}

fn strategy_label(strategy: PackagingStrategy) -> &'static str {
    match strategy {
        PackagingStrategy::VisibleCostReversal => "visible-cost-reversal",
        PackagingStrategy::MechanismCutaway => "mechanism-cutaway",
        PackagingStrategy::DecisionComparison => "decision-comparison",
        PackagingStrategy::EverydayMystery => "everyday-mystery",
        PackagingStrategy::RiskEscape => "risk-escape",
        PackagingStrategy::RealityCheck => "reality-check",
        PackagingStrategy::ConcreteReversal => "concrete-reversal",
        PackagingStrategy::CounterintuitiveMechanism => "counterintuitive-mechanism",
    }
}
