use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::Validate;
use crate::error::{
    DomainError, ensure_identifier, ensure_metadata, ensure_schema_version, ensure_sha256,
    ensure_text, ensure_timestamp, ensure_uri,
};

pub const EVIDENCE_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    Web,
    Pdf,
    Note,
    Rss,
    Repository,
    Test,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RightsStatus {
    Unknown,
    Cleared,
    Restricted,
    Denied,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceRecord {
    pub schema_version: u32,
    pub id: String,
    pub source_kind: SourceKind,
    pub canonical_uri: String,
    pub title: String,
    #[serde(default)]
    pub publisher: Option<String>,
    pub rights_status: RightsStatus,
    pub created_at: String,
    #[serde(default)]
    pub metadata: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceVersion {
    pub schema_version: u32,
    pub id: String,
    pub source_id: String,
    pub content_sha256: String,
    pub retrieved_at: String,
    pub media_type: String,
    pub byte_size: u64,
    pub parser_version: String,
    #[serde(default)]
    pub raw_artifact_id: Option<String>,
    pub created_at: String,
    #[serde(default)]
    pub metadata: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PassageLocator {
    Page {
        page: u32,
    },
    Line {
        line: u32,
        #[serde(default)]
        column: Option<u32>,
    },
    CharOffset {
        start: u64,
        end: u64,
    },
    Dom {
        selector: String,
    },
    Timestamp {
        start_ms: u64,
        end_ms: u64,
    },
    Section {
        heading: String,
    },
}

impl PassageLocator {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Page { .. } => "page",
            Self::Line { .. } => "line",
            Self::CharOffset { .. } => "char_offset",
            Self::Dom { .. } => "dom",
            Self::Timestamp { .. } => "timestamp",
            Self::Section { .. } => "section",
        }
    }

    pub fn validate(&self) -> Result<(), DomainError> {
        match self {
            Self::Page { page } if *page == 0 => Err(DomainError::RuleViolation {
                message: "passage page must be greater than zero".to_owned(),
            }),
            Self::Line { line: 0, .. } => Err(DomainError::RuleViolation {
                message: "passage line must be greater than zero".to_owned(),
            }),
            Self::Line {
                column: Some(0), ..
            } => Err(DomainError::RuleViolation {
                message: "passage column must be greater than zero".to_owned(),
            }),
            Self::CharOffset { start, end } if start >= end => Err(DomainError::RuleViolation {
                message: "passage character offsets require start < end".to_owned(),
            }),
            Self::Timestamp { start_ms, end_ms } if start_ms >= end_ms => {
                Err(DomainError::RuleViolation {
                    message: "passage timestamps require start_ms < end_ms".to_owned(),
                })
            }
            Self::Dom { selector } | Self::Section { heading: selector } => {
                ensure_text("passage locator text", selector)
            }
            _ => Ok(()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourcePassage {
    pub schema_version: u32,
    pub id: String,
    pub source_version_id: String,
    pub passage_order: u32,
    pub locator: PassageLocator,
    pub language: String,
    pub body: String,
    pub body_sha256: String,
    pub created_at: String,
}

impl Validate for SourceRecord {
    fn validate(&self) -> Result<(), DomainError> {
        ensure_schema_version(
            "source record",
            self.schema_version,
            EVIDENCE_SCHEMA_VERSION,
        )?;
        ensure_identifier("source record id", &self.id)?;
        ensure_uri("source canonical URI", &self.canonical_uri)?;
        ensure_text("source title", &self.title)?;
        if let Some(publisher) = &self.publisher {
            ensure_text("source publisher", publisher)?;
        }
        ensure_timestamp("source created_at", &self.created_at)?;
        ensure_metadata("source record", &self.metadata)
    }
}

impl Validate for SourceVersion {
    fn validate(&self) -> Result<(), DomainError> {
        ensure_schema_version(
            "source version",
            self.schema_version,
            EVIDENCE_SCHEMA_VERSION,
        )?;
        ensure_identifier("source version id", &self.id)?;
        ensure_identifier("source version source_id", &self.source_id)?;
        ensure_sha256("source version content_sha256", &self.content_sha256)?;
        ensure_timestamp("source version retrieved_at", &self.retrieved_at)?;
        ensure_text("source version media_type", &self.media_type)?;
        ensure_text("source version parser_version", &self.parser_version)?;
        if let Some(artifact_id) = &self.raw_artifact_id {
            ensure_identifier("source version raw_artifact_id", artifact_id)?;
        }
        ensure_timestamp("source version created_at", &self.created_at)?;
        ensure_metadata("source version", &self.metadata)
    }
}

impl Validate for SourcePassage {
    fn validate(&self) -> Result<(), DomainError> {
        ensure_schema_version(
            "source passage",
            self.schema_version,
            EVIDENCE_SCHEMA_VERSION,
        )?;
        ensure_identifier("source passage id", &self.id)?;
        ensure_identifier("source passage source_version_id", &self.source_version_id)?;
        ensure_text("source passage language", &self.language)?;
        ensure_text("source passage body", &self.body)?;
        ensure_sha256("source passage body_sha256", &self.body_sha256)?;
        ensure_timestamp("source passage created_at", &self.created_at)?;
        self.locator.validate()
    }
}

/// One JSON document combining the records a research lane normally writes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvidenceBundle {
    pub schema_version: u32,
    pub source: SourceRecord,
    pub version: SourceVersion,
    pub passages: Vec<SourcePassage>,
}

impl Validate for EvidenceBundle {
    fn validate(&self) -> Result<(), DomainError> {
        ensure_schema_version(
            "evidence bundle",
            self.schema_version,
            EVIDENCE_SCHEMA_VERSION,
        )?;
        self.source.validate()?;
        self.version.validate()?;
        if self.version.source_id != self.source.id {
            return Err(DomainError::RuleViolation {
                message: "source version must reference the bundled source record".to_owned(),
            });
        }
        for passage in &self.passages {
            passage.validate()?;
            if passage.source_version_id != self.version.id {
                return Err(DomainError::RuleViolation {
                    message: "source passage must reference the bundled source version".to_owned(),
                });
            }
        }
        Ok(())
    }
}
