use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};

/// Schema version this binary writes, derived so it can never drift from the
/// migration list.
pub const MIGRATION_VERSION: i64 = MIGRATIONS[MIGRATIONS.len() - 1].version;

#[derive(Debug, Clone, Copy)]
pub struct Migration {
    pub version: i64,
    pub name: &'static str,
    pub sql: &'static str,
}

impl Migration {
    pub fn checksum(&self) -> String {
        contentgen_core::sha256_hex(self.sql.as_bytes())
    }
}

/// Ordered, additive migrations. Append new entries; never renumber or edit an
/// already-applied migration without a deliberate compatibility plan.
pub const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "0001_evidence_packaging_jobs",
        sql: include_str!("../../../migrations/0001_evidence_packaging_jobs.sql"),
    },
    Migration {
        version: 2,
        name: "0002_youtube_market_watchlists",
        sql: include_str!("../../../migrations/0002_youtube_market_watchlists.sql"),
    },
    Migration {
        version: 3,
        name: "0003_evidence_fts",
        sql: include_str!("../../../migrations/0003_evidence_fts.sql"),
    },
    Migration {
        version: 4,
        name: "0004_youtube_auto_discovery",
        sql: include_str!("../../../migrations/0004_youtube_auto_discovery.sql"),
    },
    Migration {
        version: 5,
        name: "0005_project_discovery",
        sql: include_str!("../../../migrations/0005_project_discovery.sql"),
    },
    Migration {
        version: 6,
        name: "0006_project_graph",
        sql: include_str!("../../../migrations/0006_project_graph.sql"),
    },
    Migration {
        version: 7,
        name: "0007_discovery_ideas",
        sql: include_str!("../../../migrations/0007_discovery_ideas.sql"),
    },
    Migration {
        version: 8,
        name: "0008_discovery_run_artifacts",
        sql: include_str!("../../../migrations/0008_discovery_run_artifacts.sql"),
    },
    Migration {
        version: 9,
        name: "0009_project_graph_guards",
        sql: include_str!("../../../migrations/0009_project_graph_guards.sql"),
    },
    Migration {
        version: 10,
        name: "0010_discovery_sessions_productions",
        sql: include_str!("../../../migrations/0010_discovery_sessions_productions.sql"),
    },
    Migration {
        version: 11,
        name: "0011_idea_market_assessments",
        sql: include_str!("../../../migrations/0011_idea_market_assessments.sql"),
    },
    Migration {
        version: 12,
        name: "0012_discovery_google_trends",
        sql: include_str!("../../../migrations/0012_discovery_google_trends.sql"),
    },
    Migration {
        version: 13,
        name: "0013_idea_market_search_queries",
        sql: include_str!("../../../migrations/0013_idea_market_search_queries.sql"),
    },
    Migration {
        version: 14,
        name: "0014_google_ads_idea_research",
        sql: include_str!("../../../migrations/0014_google_ads_idea_research.sql"),
    },
    Migration {
        version: 15,
        name: "0015_idea_channel_baselines",
        sql: include_str!("../../../migrations/0015_idea_channel_baselines.sql"),
    },
    Migration {
        version: 16,
        name: "0016_video_view_snapshots",
        sql: include_str!("../../../migrations/0016_video_view_snapshots.sql"),
    },
    Migration {
        version: 17,
        name: "0017_idea_audience_questions",
        sql: include_str!("../../../migrations/0017_idea_audience_questions.sql"),
    },
    Migration {
        version: 18,
        name: "0018_character_drafts",
        sql: include_str!("../../../migrations/0018_character_drafts.sql"),
    },
    Migration {
        version: 19,
        name: "0019_project_voice_favorites",
        sql: include_str!("../../../migrations/0019_project_voice_favorites.sql"),
    },
    Migration {
        version: 20,
        name: "0020_character_voice_bindings",
        sql: include_str!("../../../migrations/0020_character_voice_bindings.sql"),
    },
    Migration {
        version: 21,
        name: "0021_project_scene_cast",
        sql: include_str!("../../../migrations/0021_project_scene_cast.sql"),
    },
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MigrationReport {
    pub from_version: i64,
    pub to_version: i64,
    pub applied: Vec<i64>,
}

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("migration {version} checksum mismatch: stored {stored}, expected {expected}")]
    ChecksumMismatch {
        version: i64,
        stored: String,
        expected: String,
    },

    #[error("database schema version {found} is newer than this binary supports ({supported})")]
    UnsupportedSchemaVersion { found: i64, supported: i64 },

    #[error("migration list is not strictly increasing at version {version}")]
    MigrationOrder { version: i64 },

    #[error("database integrity check failed: {0}")]
    Integrity(String),
}

/// Open a SQLite connection with the safety pragmas every connection needs.
pub fn open(path: impl AsRef<Path>) -> Result<Connection, DbError> {
    let connection = Connection::open(path)?;
    configure(&connection)?;
    Ok(connection)
}

pub fn open_in_memory() -> Result<Connection, DbError> {
    let connection = Connection::open_in_memory()?;
    configure(&connection)?;
    Ok(connection)
}

pub fn configure(connection: &Connection) -> Result<(), DbError> {
    connection.execute_batch("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")?;
    Ok(())
}

/// Apply every pending migration in order inside its own transaction, verify
/// checksums of already-applied migrations, then run SQLite integrity checks.
pub fn migrate(connection: &mut Connection) -> Result<MigrationReport, DbError> {
    configure(connection)?;
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER NOT NULL PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            checksum TEXT NOT NULL,
            applied_at TEXT NOT NULL
        ) STRICT;",
    )?;

    let from_version = user_version(connection)?;
    let supported = MIGRATIONS.last().map_or(0, |migration| migration.version);
    if from_version > supported {
        return Err(DbError::UnsupportedSchemaVersion {
            found: from_version,
            supported,
        });
    }
    let recorded_max: Option<i64> =
        connection.query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get(0)
        })?;
    if let Some(recorded) = recorded_max
        && recorded > supported
    {
        return Err(DbError::UnsupportedSchemaVersion {
            found: recorded,
            supported,
        });
    }

    let mut applied = Vec::new();
    let mut previous_version = 0_i64;
    for migration in MIGRATIONS {
        if migration.version <= previous_version {
            return Err(DbError::MigrationOrder {
                version: migration.version,
            });
        }
        previous_version = migration.version;

        let stored: Option<(String, String)> = connection
            .query_row(
                "SELECT name, checksum FROM schema_migrations WHERE version = ?1",
                [migration.version],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        if let Some((stored_name, stored_checksum)) = stored {
            let expected = migration.checksum();
            if stored_name != migration.name || stored_checksum != expected {
                return Err(DbError::ChecksumMismatch {
                    version: migration.version,
                    stored: stored_checksum,
                    expected,
                });
            }
            continue;
        }

        let transaction = connection.transaction()?;
        transaction.execute_batch(migration.sql)?;
        transaction.execute(
            "INSERT INTO schema_migrations (version, name, checksum, applied_at)
             VALUES (?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))",
            params![migration.version, migration.name, migration.checksum()],
        )?;
        transaction.pragma_update(None, "user_version", migration.version)?;
        transaction.commit()?;
        applied.push(migration.version);
    }

    verify(connection)?;
    Ok(MigrationReport {
        from_version,
        to_version: user_version(connection)?,
        applied,
    })
}

pub fn user_version(connection: &Connection) -> Result<i64, DbError> {
    Ok(connection.query_row("PRAGMA user_version", [], |row| row.get(0))?)
}

fn verify(connection: &Connection) -> Result<(), DbError> {
    let integrity: String = connection.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    if integrity != "ok" {
        return Err(DbError::Integrity(integrity));
    }

    let mut statement = connection.prepare("PRAGMA foreign_key_check")?;
    let mut rows = statement.query([])?;
    if let Some(row) = rows.next()? {
        let table: String = row.get(0)?;
        let rowid: i64 = row.get(1)?;
        return Err(DbError::Integrity(format!(
            "foreign key violation in table {table}, row {rowid}"
        )));
    }
    Ok(())
}
