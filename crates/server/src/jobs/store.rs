//! Content-addressed artifact store.
//!
//! Bytes live under `<root>/sha256/<first two hex>/<digest>` and manifests live
//! in `artifact_manifests`. The digest alone determines the path, so a caller
//! cannot choose a location and cannot escape the store root. Records are
//! immutable: no update, delete, overwrite or eviction API exists.

use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use contentgen_core::Validate;
use contentgen_core::artifacts::{
    ArtifactManifest, ArtifactProducer, DigestAlgorithm, ProducerKind,
};
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde_json::Value;

use super::error::JobsError;

const MANIFEST_COLUMNS: &str =
    "id, schema_version, digest_algorithm, digest, size_bytes, media_type,
     producer_kind, producer_name, producer_version, metadata_json, created_at";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArtifactStore {
    root: PathBuf,
}

#[derive(Debug, Clone, PartialEq)]
pub enum PutOutcome {
    Stored(ArtifactManifest),
    AlreadyRecorded(ArtifactManifest),
}

impl ArtifactStore {
    pub fn new(root: impl Into<PathBuf>) -> Result<Self, JobsError> {
        let root = root.into();
        fs::create_dir_all(&root)?;
        let root = fs::canonicalize(root)?;
        Ok(Self { root })
    }

    pub fn from_db_path(db_path: &Path) -> Result<Self, JobsError> {
        let parent = db_path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .map_or_else(|| PathBuf::from("."), Path::to_path_buf);
        Self::new(parent.join("artifacts"))
    }

    pub fn root(&self) -> &Path {
        self.root.as_path()
    }

    pub fn path_for(&self, manifest: &ArtifactManifest) -> Result<PathBuf, JobsError> {
        manifest.validate()?;
        // The digest is validated as 64 lowercase hex characters above, so it
        // can only ever name two nested directories followed by one file.
        let digest = manifest.digest.as_str();
        let path = self.root.join("sha256").join(&digest[..2]).join(digest);
        if !path.starts_with(&self.root) {
            return Err(JobsError::Internal(
                "artifact path escaped the content-addressed store root".to_owned(),
            ));
        }
        Ok(path)
    }

    pub fn put(
        &self,
        conn: &mut Connection,
        manifest: &ArtifactManifest,
        bytes: &[u8],
    ) -> Result<PutOutcome, JobsError> {
        manifest.validate()?;
        if let Err(error) = manifest.verify_bytes(bytes) {
            return Err(JobsError::ArtifactDigestMismatch(error.to_string()));
        }
        let path = self.path_for(manifest)?;

        if let Some(existing) = load_manifest_by_id(conn, &manifest.id)? {
            if existing.digest != manifest.digest
                || existing.digest_algorithm != manifest.digest_algorithm
            {
                return Err(JobsError::ArtifactConflict(format!(
                    "artifact id '{}' already records digest {}",
                    existing.id, existing.digest
                )));
            }
            verify_existing_file(&path, &existing)?;
            return Ok(PutOutcome::AlreadyRecorded(existing));
        }

        if let Some(existing) =
            load_manifest_by_digest(conn, manifest.digest_algorithm, &manifest.digest)?
        {
            verify_existing_file(&path, &existing)?;
            return Ok(PutOutcome::AlreadyRecorded(existing));
        }

        let tmp_dir = self.root.join("tmp");
        fs::create_dir_all(&tmp_dir)?;
        let temp_path = write_temp_file(&tmp_dir, manifest, bytes)?;

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        // Create the destination with an atomic no-clobber link. If another
        // writer won the race, accept the file only when it still hashes to the
        // same content address.
        match fs::hard_link(&temp_path, &path) {
            Ok(()) => {
                fs::remove_file(&temp_path)?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                let verified = verify_existing_file(&path, manifest);
                let removed = fs::remove_file(&temp_path);
                verified?;
                removed?;
            }
            Err(error) => return Err(JobsError::Io(error)),
        }

        let transaction = conn.transaction()?;
        let insert = transaction.execute(
            "INSERT INTO artifact_manifests
                (id, schema_version, digest_algorithm, digest, size_bytes, media_type,
                 producer_kind, producer_name, producer_version, metadata_schema_version,
                 metadata_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?10, ?11)",
            params![
                manifest.id,
                i64::from(manifest.schema_version),
                digest_algorithm_code(manifest.digest_algorithm),
                manifest.digest,
                manifest.size_bytes as i64,
                manifest.media_type,
                producer_kind_code(manifest.producer.kind),
                manifest.producer.name,
                manifest.producer.version,
                serde_json::to_string(&manifest.metadata)?,
                manifest.created_at,
            ],
        );
        if let Err(error) = insert {
            // A concurrent writer may have recorded the same content address
            // after our lookup but before our insert. That is a benign
            // duplicate, not a server failure: verify and return the winner.
            if error.sqlite_error_code() == Some(rusqlite::ErrorCode::ConstraintViolation) {
                transaction.rollback()?;
                if let Some(existing) =
                    load_manifest_by_digest(conn, manifest.digest_algorithm, &manifest.digest)?
                {
                    verify_existing_file(&path, &existing)?;
                    return Ok(PutOutcome::AlreadyRecorded(existing));
                }
            }
            return Err(JobsError::Database(error));
        }
        transaction.commit()?;
        Ok(PutOutcome::Stored(manifest.clone()))
    }

    pub fn load(
        &self,
        conn: &Connection,
        artifact_id: &str,
    ) -> Result<(ArtifactManifest, Vec<u8>), JobsError> {
        let manifest = self.manifest(conn, artifact_id)?;
        let path = self.path_for(&manifest)?;
        let bytes = fs::read(&path).map_err(|error| {
            JobsError::ArtifactTampered(format!(
                "artifact '{}' bytes are missing or unreadable: {error}",
                manifest.id
            ))
        })?;
        manifest
            .verify_bytes(&bytes)
            .map_err(|error| JobsError::ArtifactTampered(error.to_string()))?;
        Ok((manifest, bytes))
    }

    pub fn manifest(
        &self,
        conn: &Connection,
        artifact_id: &str,
    ) -> Result<ArtifactManifest, JobsError> {
        load_manifest_by_id(conn, artifact_id)?
            .ok_or_else(|| JobsError::NotFound(format!("artifact '{artifact_id}' was not found")))
    }
}

/// Decode a caller-supplied hex string without adding a hex dependency.
pub fn decode_hex(text: &str) -> Result<Vec<u8>, JobsError> {
    if !text.len().is_multiple_of(2) {
        return Err(JobsError::InvalidDocument(
            "bytesHex must contain an even number of hexadecimal characters".to_owned(),
        ));
    }
    let bytes = text.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len() / 2);
    let mut index = 0;
    while index < bytes.len() {
        let high = hex_value(bytes[index]).ok_or_else(|| {
            JobsError::InvalidDocument("bytesHex contains a non-hexadecimal character".to_owned())
        })?;
        let low = hex_value(bytes[index + 1]).ok_or_else(|| {
            JobsError::InvalidDocument("bytesHex contains a non-hexadecimal character".to_owned())
        })?;
        decoded.push((high << 4) | low);
        index += 2;
    }
    Ok(decoded)
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn write_temp_file(
    tmp_dir: &Path,
    manifest: &ArtifactManifest,
    bytes: &[u8],
) -> Result<PathBuf, JobsError> {
    static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);
    for _ in 0..32 {
        let sequence = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = tmp_dir.join(format!(
            "{}-{}-{sequence}.tmp",
            manifest.digest,
            std::process::id()
        ));
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                if let Err(error) = file.write_all(bytes).and_then(|()| file.sync_all()) {
                    drop(file);
                    let _ = fs::remove_file(&path);
                    return Err(JobsError::Io(error));
                }
                return Ok(path);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(JobsError::Io(error)),
        }
    }
    Err(JobsError::Io(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        "could not allocate a unique artifact temp file",
    )))
}

fn verify_existing_file(path: &Path, manifest: &ArtifactManifest) -> Result<(), JobsError> {
    let bytes = fs::read(path).map_err(|error| {
        JobsError::ArtifactTampered(format!(
            "artifact '{}' bytes are missing or unreadable: {error}",
            manifest.id
        ))
    })?;
    manifest
        .verify_bytes(&bytes)
        .map_err(|error| JobsError::ArtifactTampered(error.to_string()))
}

fn load_manifest_by_id(
    conn: &Connection,
    artifact_id: &str,
) -> Result<Option<ArtifactManifest>, JobsError> {
    let sql = format!("SELECT {MANIFEST_COLUMNS} FROM artifact_manifests WHERE id = ?1");
    Ok(conn
        .query_row(&sql, [artifact_id], map_manifest)
        .optional()?)
}

fn load_manifest_by_digest(
    conn: &Connection,
    algorithm: DigestAlgorithm,
    digest: &str,
) -> Result<Option<ArtifactManifest>, JobsError> {
    let sql = format!(
        "SELECT {MANIFEST_COLUMNS} FROM artifact_manifests
         WHERE digest_algorithm = ?1 AND digest = ?2"
    );
    Ok(conn
        .query_row(
            &sql,
            params![digest_algorithm_code(algorithm), digest],
            map_manifest,
        )
        .optional()?)
}

fn map_manifest(row: &Row<'_>) -> rusqlite::Result<ArtifactManifest> {
    let algorithm_text: String = row.get(2)?;
    let algorithm = digest_algorithm_from_code(&algorithm_text)
        .ok_or_else(|| invalid_enum(2, "sha256", &algorithm_text))?;
    let producer_kind_text: String = row.get(6)?;
    let producer_kind = producer_kind_from_code(&producer_kind_text).ok_or_else(|| {
        invalid_enum(
            6,
            "human, tool, model, renderer, import, unknown",
            &producer_kind_text,
        )
    })?;
    let metadata_json: String = row.get(9)?;
    let metadata: BTreeMap<String, Value> =
        serde_json::from_str(&metadata_json).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                9,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?;
    Ok(ArtifactManifest {
        id: row.get(0)?,
        schema_version: row.get(1)?,
        digest_algorithm: algorithm,
        digest: row.get(3)?,
        size_bytes: row.get::<_, i64>(4)? as u64,
        media_type: row.get(5)?,
        producer: ArtifactProducer {
            kind: producer_kind,
            name: row.get(7)?,
            version: row.get(8)?,
        },
        created_at: row.get(10)?,
        metadata,
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

fn digest_algorithm_code(algorithm: DigestAlgorithm) -> &'static str {
    match algorithm {
        DigestAlgorithm::Sha256 => "sha256",
    }
}

fn digest_algorithm_from_code(code: &str) -> Option<DigestAlgorithm> {
    match code {
        "sha256" => Some(DigestAlgorithm::Sha256),
        _ => None,
    }
}

fn producer_kind_code(kind: ProducerKind) -> &'static str {
    match kind {
        ProducerKind::Human => "human",
        ProducerKind::Tool => "tool",
        ProducerKind::Model => "model",
        ProducerKind::Renderer => "renderer",
        ProducerKind::Import => "import",
        ProducerKind::Unknown => "unknown",
    }
}

fn producer_kind_from_code(code: &str) -> Option<ProducerKind> {
    match code {
        "human" => Some(ProducerKind::Human),
        "tool" => Some(ProducerKind::Tool),
        "model" => Some(ProducerKind::Model),
        "renderer" => Some(ProducerKind::Renderer),
        "import" => Some(ProducerKind::Import),
        "unknown" => Some(ProducerKind::Unknown),
        _ => None,
    }
}
