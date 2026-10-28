//! Local-only Axum server. The foundation slice exposes health plus three
//! registered-but-not-implemented lane routers.

pub mod character_drafts;
pub mod creative;
pub mod credentials;
pub mod db;
pub mod error;
pub mod jobs;
pub mod production_api;
pub mod production_store;
pub mod project_voices;
pub mod research;
pub mod router;
pub mod settings;
pub mod state;

pub use router::build_router;
pub use state::AppState;
