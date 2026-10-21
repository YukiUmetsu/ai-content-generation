use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::Validate;
use crate::error::{
    DomainError, ensure_identifier, ensure_media_type, ensure_metadata, ensure_schema_version,
    ensure_sha256, ensure_text, ensure_timestamp,
};

pub const ARTIFACT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DigestAlgorithm {
    Sha256,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProducerKind {
    Human,
    Tool,
    Model,
    Renderer,
    Import,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArtifactProducer {
    pub kind: ProducerKind,
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArtifactManifest {
    pub schema_version: u32,
    pub id: String,
    pub digest_algorithm: DigestAlgorithm,
    pub digest: String,
    pub size_bytes: u64,
    pub media_type: String,
    pub producer: ArtifactProducer,
    pub created_at: String,
    #[serde(default)]
    pub metadata: BTreeMap<String, Value>,
}

impl ArtifactManifest {
    /// Build a manifest whose digest and size are derived from the bytes, so a
    /// caller cannot invent a content address by hand.
    pub fn for_bytes(
        id: impl Into<String>,
        media_type: impl Into<String>,
        producer: ArtifactProducer,
        created_at: impl Into<String>,
        bytes: &[u8],
    ) -> Self {
        Self {
            schema_version: ARTIFACT_SCHEMA_VERSION,
            id: id.into(),
            digest_algorithm: DigestAlgorithm::Sha256,
            digest: sha256_hex(bytes),
            size_bytes: bytes.len() as u64,
            media_type: media_type.into(),
            producer,
            created_at: created_at.into(),
            metadata: BTreeMap::new(),
        }
    }

    pub fn verify_bytes(&self, bytes: &[u8]) -> Result<(), DomainError> {
        self.validate()?;
        if self.size_bytes != bytes.len() as u64 {
            return Err(DomainError::RuleViolation {
                message: format!(
                    "artifact '{}' size {} does not match supplied bytes length {}",
                    self.id,
                    self.size_bytes,
                    bytes.len()
                ),
            });
        }
        let actual = sha256_hex(bytes);
        if self.digest != actual {
            return Err(DomainError::RuleViolation {
                message: format!(
                    "artifact '{}' digest {} does not match supplied bytes {}",
                    self.id, self.digest, actual
                ),
            });
        }
        Ok(())
    }
}

impl Validate for ArtifactProducer {
    fn validate(&self) -> Result<(), DomainError> {
        ensure_text("artifact producer name", &self.name)?;
        ensure_text("artifact producer version", &self.version)
    }
}

impl Validate for ArtifactManifest {
    fn validate(&self) -> Result<(), DomainError> {
        ensure_schema_version(
            "artifact manifest",
            self.schema_version,
            ARTIFACT_SCHEMA_VERSION,
        )?;
        ensure_identifier("artifact manifest id", &self.id)?;
        ensure_sha256("artifact digest", &self.digest)?;
        if self.digest_algorithm != DigestAlgorithm::Sha256 {
            return Err(DomainError::RuleViolation {
                message: "artifact manifest must use sha256 content addressing".to_owned(),
            });
        }
        ensure_media_type("artifact media_type", &self.media_type)?;
        self.producer.validate()?;
        ensure_timestamp("artifact manifest created_at", &self.created_at)?;
        ensure_metadata("artifact manifest", &self.metadata)
    }
}

/// Lowercase hex SHA-256 of the supplied bytes.
pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut output = String::with_capacity(64);
    for byte in digest {
        use std::fmt::Write as _;
        write!(&mut output, "{byte:02x}").expect("writing to String cannot fail");
    }
    output
}
