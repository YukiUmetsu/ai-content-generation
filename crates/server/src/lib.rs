//! Local-only Axum server. The foundation slice exposes health plus three
//! registered-but-not-implemented lane routers.

pub mod creative;
pub mod db;
pub mod error;
pub mod jobs;
pub mod research;
pub mod router;
pub mod state;

pub use router::build_router;
pub use state::AppState;
