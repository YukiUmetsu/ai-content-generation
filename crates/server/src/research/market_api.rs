//! Loopback Research market API. Browser mutations require a non-simple header
//! so a third-party web page cannot trigger provider calls with an HTML form.

use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::{DefaultBodyLimit, Path, Query, State, rejection::JsonRejection};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use super::market_store::{self, MarketError, MarketWatchlistDraft};
use super::{market_worker, youtube_api::YoutubeClient};
use crate::error::ApiError;
use crate::state::AppState;

pub fn epoch_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn db_error(_: impl std::fmt::Display) -> ApiError {
    ApiError::Internal {
        message: "Local market database operation failed".into(),
    }
}
fn market_error(error: MarketError) -> ApiError {
    match error {
        MarketError::Invalid(message) => ApiError::InvalidDocument { message },
        MarketError::NotFound => ApiError::NotFound {
            message: "Watchlist not found".into(),
        },
        MarketError::Limit => ApiError::RateLimited {
            message: "Watchlist limit reached".into(),
        },
        MarketError::Db(err) => db_error(err),
    }
}

fn parse_watchlist_json(payload: Result<Json<MarketWatchlistDraft>, JsonRejection>) -> Result<MarketWatchlistDraft, ApiError> {
    payload.map(|Json(draft)| draft).map_err(|rejection| ApiError::MalformedJson {
        message: format!(
            "Invalid watchlist request JSON: {}. Make sure the browser and local Rust server are from the same build.",
            rejection.body_text()
        ),
    })
}

fn require_editor_header(headers: &HeaderMap) -> Result<(), ApiError> {
    if headers
        .get("x-contentgen-market")
        .and_then(|x| x.to_str().ok())
        == Some("local-only")
    {
        Ok(())
    } else {
        Err(ApiError::Forbidden {
            message: "Local market editing requires X-Contentgen-Market: local-only".into(),
        })
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/status", get(status))
        .route("/related", get(related))
        .route("/watchlists", get(watchlists).post(create))
        .route(
            "/watchlists/{id}",
            get(get_watchlist).patch(update).delete(delete_watchlist),
        )
        .route("/watchlists/{id}/videos", get(videos))
        .route("/watchlists/{id}/collect", post(collect))
        .layer(DefaultBodyLimit::max(2048))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RelatedQuery {
    topic: String,
}

#[derive(Serialize)]
struct RelatedList {
    videos: Vec<market_store::RelatedMarketVideo>,
}

async fn related(
    Query(query): Query<RelatedQuery>,
    State(state): State<AppState>,
) -> Result<Json<RelatedList>, ApiError> {
    let db = state.connect().map_err(db_error)?;
    Ok(Json(RelatedList {
        videos: market_store::find_related_observations(&db, &query.topic, epoch_now())
            .map_err(market_error)?,
    }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MarketStatus {
    api_key_configured: bool,
    collecting: bool,
    search_calls_last24h: i64,
    search_call_limit: i64,
}

async fn status(State(state): State<AppState>) -> Result<Json<MarketStatus>, ApiError> {
    let db = state.connect().map_err(db_error)?;
    let running: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM market_runs WHERE state='running'",
            [],
            |r| r.get(0),
        )
        .map_err(db_error)?;
    Ok(Json(MarketStatus {
        api_key_configured: state.credentials().youtube_status().configured,
        collecting: running > 0,
        search_calls_last24h: market_store::used_search_calls(&db, epoch_now())
            .map_err(market_error)?,
        search_call_limit: 20,
    }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WatchlistList {
    watchlists: Vec<market_store::MarketWatchlist>,
}

async fn watchlists(State(state): State<AppState>) -> Result<Json<WatchlistList>, ApiError> {
    let db = state.connect().map_err(db_error)?;
    Ok(Json(WatchlistList {
        watchlists: market_store::list_watchlists(&db).map_err(market_error)?,
    }))
}

async fn get_watchlist(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<market_store::MarketWatchlist>, ApiError> {
    let db = state.connect().map_err(db_error)?;
    Ok(Json(
        market_store::get_watchlist(&db, &id).map_err(market_error)?,
    ))
}

async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    payload: Result<Json<MarketWatchlistDraft>, JsonRejection>,
) -> Result<(StatusCode, Json<market_store::MarketWatchlist>), ApiError> {
    require_editor_header(&headers)?;
    let draft = parse_watchlist_json(payload)?;
    let db = state.connect().map_err(db_error)?;
    let value = market_store::create_watchlist(&db, draft, epoch_now()).map_err(market_error)?;
    Ok((StatusCode::CREATED, Json(value)))
}

async fn update(
    Path(id): Path<String>,
    State(state): State<AppState>,
    headers: HeaderMap,
    payload: Result<Json<MarketWatchlistDraft>, JsonRejection>,
) -> Result<Json<market_store::MarketWatchlist>, ApiError> {
    require_editor_header(&headers)?;
    let draft = parse_watchlist_json(payload)?;
    let db = state.connect().map_err(db_error)?;
    Ok(Json(
        market_store::update_watchlist(&db, &id, draft, epoch_now()).map_err(market_error)?,
    ))
}

async fn delete_watchlist(
    Path(id): Path<String>,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    require_editor_header(&headers)?;
    let db = state.connect().map_err(db_error)?;
    market_store::delete_watchlist(&db, &id).map_err(market_error)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize)]
struct VideoList {
    videos: Vec<market_store::MarketVideoRecord>,
}

async fn videos(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<VideoList>, ApiError> {
    let db = state.connect().map_err(db_error)?;
    market_store::get_watchlist(&db, &id).map_err(market_error)?;
    Ok(Json(VideoList {
        videos: market_store::list_observations(&db, &id, epoch_now()).map_err(market_error)?,
    }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QueuedRun {
    run_id: String,
    state: &'static str,
}

async fn collect(
    Path(id): Path<String>,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<(StatusCode, Json<QueuedRun>), ApiError> {
    require_editor_header(&headers)?;
    let key = state
        .credentials()
        .youtube_key()
        .map_err(|_| ApiError::Unavailable {
            message: "Configure a YouTube key in local Settings or the server environment".into(),
        })?;
    let client = YoutubeClient::from_key(key).map_err(|_| ApiError::Unavailable {
        message: "A valid YouTube key is required for collection".into(),
    })?;
    let db = state.connect().map_err(db_error)?;
    let run = market_store::claim_watchlist(&db, &id, epoch_now(), true)
        .map_err(market_error)?
        .ok_or_else(|| ApiError::Conflict {
            message:
                "Collection is disabled, in progress, backing off, or at its daily search budget"
                    .into(),
        })?;
    let response = QueuedRun {
        run_id: run.id.clone(),
        state: "queued",
    };
    tokio::spawn(market_worker::run_claim(state, run, client));
    Ok((StatusCode::ACCEPTED, Json(response)))
}
