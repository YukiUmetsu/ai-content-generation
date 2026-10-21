//! Integration tests for the content-addressed artifact store.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use contentgen_core::artifacts::ArtifactManifest;
use contentgen_core::{Validate, sha256_hex};
use contentgen_server::db;
use contentgen_server::jobs::JobsError;
use contentgen_server::jobs::store::{ArtifactStore, PutOutcome};
use rusqlite::Connection;

const MANIFEST_JSON: &str = include_str!("../../../fixtures/foundation/artifact-manifest.json");
const ARTIFACT_BYTES: &[u8] = include_bytes!("../../../fixtures/foundation/artifact-bytes.txt");

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

fn fixture_manifest() -> ArtifactManifest {
    serde_json::from_str(MANIFEST_JSON).expect("parse fixture manifest")
}

fn manifest_for(id: &str, bytes: &[u8]) -> ArtifactManifest {
    let fixture = fixture_manifest();
    ArtifactManifest::for_bytes(
        id,
        fixture.media_type,
        fixture.producer,
        fixture.created_at,
        bytes,
    )
}

fn count(connection: &Connection, table: &str) -> i64 {
    connection
        .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .expect("count rows")
}

fn regular_files(root: &Path) -> usize {
    fn walk(path: &Path, total: &mut usize) {
        let entries = std::fs::read_dir(path).expect("read artifact directory");
        for entry in entries {
            let entry = entry.expect("read artifact entry");
            let file_type = entry.file_type().expect("read artifact file type");
            if file_type.is_dir() {
                walk(&entry.path(), total);
            } else if file_type.is_file() {
                *total += 1;
            }
        }
    }
    let mut total = 0;
    walk(root, &mut total);
    total
}

#[test]
fn manifest_digest_mismatch_is_rejected() {
    let dir = TestDir::new("contentgen-artifacts-mismatch");
    let mut connection = migrated_database(&dir);
    let store = ArtifactStore::new(dir.path().join("artifacts")).expect("open artifact store");
    let manifest = fixture_manifest();
    manifest.validate().expect("fixture manifest is valid");

    let error = store
        .put(
            &mut connection,
            &manifest,
            b"not the recorded artifact bytes",
        )
        .expect_err("digest mismatch must be rejected");
    assert!(
        matches!(error, JobsError::ArtifactDigestMismatch(_)),
        "expected ArtifactDigestMismatch, got {error:?}"
    );
    assert_eq!(count(&connection, "artifact_manifests"), 0);
    assert_eq!(regular_files(store.root()), 0);
}

#[test]
fn identical_bytes_deduplicate_and_records_are_immutable() {
    let dir = TestDir::new("contentgen-artifacts-dedupe");
    let mut connection = migrated_database(&dir);
    let store = ArtifactStore::new(dir.path().join("artifacts")).expect("open artifact store");
    let manifest = fixture_manifest();

    match store
        .put(&mut connection, &manifest, ARTIFACT_BYTES)
        .expect("store fixture bytes")
    {
        PutOutcome::Stored(stored) => {
            assert_eq!(stored.digest, sha256_hex(ARTIFACT_BYTES));
            assert_eq!(stored.id, manifest.id);
        }
        PutOutcome::AlreadyRecorded(_) => panic!("first write must store"),
    }
    match store
        .put(&mut connection, &manifest, ARTIFACT_BYTES)
        .expect("store fixture bytes again")
    {
        PutOutcome::AlreadyRecorded(existing) => assert_eq!(existing.id, manifest.id),
        PutOutcome::Stored(_) => panic!("identical bytes must deduplicate"),
    }
    let alias = manifest_for("art_alias_review_v1", ARTIFACT_BYTES);
    match store
        .put(&mut connection, &alias, ARTIFACT_BYTES)
        .expect("same bytes under another id")
    {
        PutOutcome::AlreadyRecorded(existing) => assert_eq!(existing.id, manifest.id),
        PutOutcome::Stored(_) => panic!("the content address must deduplicate across ids"),
    }
    assert_eq!(count(&connection, "artifact_manifests"), 1);
    assert_eq!(regular_files(store.root()), 1);

    let conflicting = manifest_for(&manifest.id, b"a different artifact body with the same id");
    let error = store
        .put(
            &mut connection,
            &conflicting,
            b"a different artifact body with the same id",
        )
        .expect_err("same id with different bytes must conflict");
    assert!(
        matches!(error, JobsError::ArtifactConflict(_)),
        "expected ArtifactConflict, got {error:?}"
    );
    assert_eq!(count(&connection, "artifact_manifests"), 1);

    let update = connection.execute(
        "UPDATE artifact_manifests SET media_type = 'text/html' WHERE id = ?1",
        [manifest.id.as_str()],
    );
    assert!(
        update.is_err(),
        "artifact manifests are immutable in SQLite"
    );

    let (loaded, bytes) = store
        .load(&connection, &manifest.id)
        .expect("load fixture artifact");
    assert_eq!(loaded, manifest);
    assert_eq!(bytes, ARTIFACT_BYTES);
}

#[test]
fn tampered_bytes_are_detected_on_load() {
    let dir = TestDir::new("contentgen-artifacts-tamper");
    let mut connection = migrated_database(&dir);
    let store = ArtifactStore::new(dir.path().join("artifacts")).expect("open artifact store");
    let manifest = fixture_manifest();
    store
        .put(&mut connection, &manifest, ARTIFACT_BYTES)
        .expect("store fixture bytes");

    let path = store.path_for(&manifest).expect("content address");
    std::fs::write(&path, b"tampered on disk").expect("tamper with stored bytes");

    let error = store
        .load(&connection, &manifest.id)
        .expect_err("tampered bytes must be detected");
    assert!(
        matches!(error, JobsError::ArtifactTampered(_)),
        "expected ArtifactTampered, got {error:?}"
    );
    assert_eq!(count(&connection, "artifact_manifests"), 1);
    let (digest, media_type): (String, String) = connection
        .query_row(
            "SELECT digest, media_type FROM artifact_manifests WHERE id = ?1",
            [manifest.id.as_str()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("read unchanged manifest row");
    assert_eq!(digest, manifest.digest);
    assert_eq!(media_type, manifest.media_type);
}

#[test]
fn artifact_paths_stay_inside_the_root() {
    let dir = TestDir::new("contentgen-artifacts-paths");
    let store = ArtifactStore::new(dir.path().join("artifacts")).expect("open artifact store");
    let manifest = fixture_manifest();

    let first = store.path_for(&manifest).expect("first path");
    let second = store.path_for(&manifest).expect("second path");
    assert!(first.starts_with(store.root()));
    assert!(second.starts_with(store.root()));
    assert_eq!(first, second, "the same digest is deterministic");
    assert_eq!(
        first.file_name().and_then(|name| name.to_str()),
        Some(manifest.digest.as_str())
    );

    let other = manifest_for("art_other_v1", b"different content for a different digest");
    other.validate().expect("other manifest is valid");
    let other_path = store.path_for(&other).expect("other path");
    assert!(other_path.starts_with(store.root()));
    assert_ne!(first, other_path);
    assert_ne!(manifest.digest, other.digest);
}
