use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Semaphore;

use rusqlite::Connection;

use crate::db::{self, DbError};

/// Shared application state. Lanes receive this via `Router<AppState>` and must
/// open database connections through `connect()` so safety pragmas always run.
#[derive(Clone, Debug)]
pub struct AppState {
    db_path: Arc<PathBuf>,
    market_semaphore: Arc<Semaphore>,
}

impl AppState {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self {
            db_path: Arc::new(path.into()),
            market_semaphore: Arc::new(Semaphore::new(1)),
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
}
