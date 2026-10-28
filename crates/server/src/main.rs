use std::error::Error;
use std::net::SocketAddr;
use std::path::PathBuf;

use contentgen_server::{AppState, build_router, db};

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let bind = std::env::var("CONTENTGEN_BIND")
        .unwrap_or_else(|_| "127.0.0.1:8787".to_owned())
        .parse::<SocketAddr>()?;
    if !bind.ip().is_loopback() {
        return Err("CONTENTGEN_BIND must be a loopback address (default 127.0.0.1:8787)".into());
    }

    let db_path = PathBuf::from(
        std::env::var("CONTENTGEN_DB").unwrap_or_else(|_| "data/contentgen.db".to_owned()),
    );
    if let Some(parent) = db_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent)?;
    }

    let mut connection = db::open(&db_path)?;
    let report = db::migrate(&mut connection)?;
    // Media rendering is currently an in-process local worker. After a crash
    // it cannot reclaim an orphaned attempt; reconcile before any new workers
    // launch so the Jobs page never reports phantom running work.
    let orphaned = contentgen_server::jobs::scheduler::reconcile_orphans(&mut connection, None)?;
    drop(connection);
    println!(
        "contentgen-server: database schema {} -> {} at {}",
        report.from_version,
        report.to_version,
        db_path.display()
    );
    if !orphaned.is_empty() {
        eprintln!(
            "contentgen-server: reconciled {} interrupted job attempts",
            orphaned.len()
        );
    }

    let listener = tokio::net::TcpListener::bind(bind).await?;
    println!("contentgen-server: listening on http://{bind}");
    let state = AppState::new(db_path);
    let collector = contentgen_server::research::market_worker::spawn(state.clone());
    let result = axum::serve(listener, build_router(state)).await;
    collector.abort();
    result?;
    Ok(())
}
