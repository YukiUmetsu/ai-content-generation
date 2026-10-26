use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Semaphore;

use rusqlite::Connection;

use crate::credentials::ProviderCredentials;
use crate::db::{self, DbError};
use crate::settings::SettingsSessions;

/// Shared application state. Lanes receive this via `Router<AppState>` and must
/// open database connections through `connect()` so safety pragmas always run.
#[derive(Clone, Debug)]
pub struct AppState {
    db_path: Arc<PathBuf>,
    market_semaphore: Arc<Semaphore>,
    discovery_market_semaphore: Arc<Semaphore>,
    credentials: ProviderCredentials,
    settings_sessions: Arc<SettingsSessions>,
}

impl AppState {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self::with_credentials(path, ProviderCredentials::system())
    }

    pub fn with_credentials(path: impl Into<PathBuf>, credentials: ProviderCredentials) -> Self {
        Self {
            db_path: Arc::new(path.into()),
            market_semaphore: Arc::new(Semaphore::new(1)),
            discovery_market_semaphore: Arc::new(Semaphore::new(1)),
            credentials,
            settings_sessions: Arc::new(SettingsSessions::default()),
        }
    }

    pub fn db_path(&self) -> &Path {
        self.db_path.as_path()
    }

    pub fn connect(&self) -> Result<Connection, DbError> {
        db::open(self.db_path())
    }

    pub fn market_semaphore(&self) -> Arc<Semaphore> {
        self.market_semaphore.clone()
    }

    pub fn discovery_market_semaphore(&self) -> Arc<Semaphore> {
        self.discovery_market_semaphore.clone()
    }

    pub fn credentials(&self) -> &ProviderCredentials {
        &self.credentials
    }

    pub fn settings_sessions(&self) -> &SettingsSessions {
        &self.settings_sessions
    }
}
