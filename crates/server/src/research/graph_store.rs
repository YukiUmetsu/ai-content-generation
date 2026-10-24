//! SQLite topic graph with per-project identity and captured-passage provenance.
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use super::discovery_projects::DiscoveryError;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceDraft {
    pub url: String,
    pub title: String,
    pub provider: String,
    pub published_at: Option<String>,
    pub observed_at: i64,
    pub passage: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub id: String,
    pub kind: String,
    pub label: String,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub id: String,
    pub from_node_id: String,
    pub to_node_id: String,
    pub relation: String,
    pub status: String,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphSource {
    pub id: String,
    pub provider: String,
    pub title: String,
    pub url: String,
    pub published_at: Option<String>,
    pub observed_at: i64,
    pub evidence_state: String,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphSignal {
    pub source_id: Option<String>,
    pub metric: String,
    pub value: Option<f64>,
    pub unit: String,
    pub collected_at: i64,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphOverview {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub sources: Vec<GraphSource>,
    pub signals: Vec<GraphSignal>,
    pub topic_count: i64,
    pub source_count: i64,
    pub supported_edge_count: i64,
}

fn ident(parts: &[&str]) -> String {
    let digest = contentgen_core::sha256_hex(parts.join("\u{0}").as_bytes());
    format!("kg_{}", &digest[..30])
}
fn normalize(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}
fn valid_project(db: &Connection, project_id: &str) -> Result<(), DiscoveryError> {
    if db
        .query_row(
            "SELECT 1 FROM discovery_projects WHERE id=?1",
            [project_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some()
    {
        Ok(())
    } else {
        Err(DiscoveryError::NotFound)
    }
}

pub fn upsert_node(
    db: &Connection,
    project_id: &str,
    kind: &str,
    label: &str,
    now: i64,
) -> Result<String, DiscoveryError> {
    valid_project(db, project_id)?;
    if !matches!(
        kind,
        "topic" | "entity" | "question" | "event" | "source" | "content"
    ) || !(2..=240).contains(&label.trim().chars().count())
    {
        return Err(DiscoveryError::Invalid(
            "Invalid graph node kind or label".into(),
        ));
    }
    let clean = normalize(label);
    let key = clean.to_lowercase();
    let id = ident(&[project_id, kind, &key]);
    let inserted = db.execute(
        "INSERT OR IGNORE INTO kg_nodes(id,project_id,kind,label,normalized,created_at,updated_at)
        VALUES (?1,?2,?3,?4,?5,?6,?6)",
        params![id, project_id, kind, clean, key, now],
    )?;
    if inserted > 0 {
        db.execute(
            "INSERT INTO kg_node_search(project_id,node_id,label) VALUES (?1,?2,?3)",
            params![project_id, id, clean],
        )?;
    }
    Ok(id)
}

pub fn import_source(
    db: &Connection,
    project_id: &str,
    source: SourceDraft,
) -> Result<String, DiscoveryError> {
    valid_project(db, project_id)?;
    if !source.url.starts_with("https://")
        || source.url.len() > 2048
        || source.url.contains(char::is_whitespace)
        || source.title.trim().is_empty()
        || source.title.len() > 500
        || source.provider.is_empty()
        || source.provider.len() > 60
        || source.passage.as_ref().is_some_and(|x| x.len() > 16000)
    {
        return Err(DiscoveryError::Invalid("Invalid source metadata".into()));
    }
    let id = ident(&[project_id, &source.provider, &source.url]);
    let evidence_state = if source
        .passage
        .as_ref()
        .is_some_and(|p| !p.trim().is_empty())
    {
        "captured"
    } else {
        "lead_only"
    };
    db.execute("INSERT INTO kg_sources(id,project_id,provider,url,title,published_at,observed_at,passage,evidence_state)
        VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
        ON CONFLICT(project_id,provider,url) DO UPDATE SET title=excluded.title,
            observed_at=MAX(observed_at,excluded.observed_at),
            published_at=COALESCE(excluded.published_at,published_at),
            passage=COALESCE(excluded.passage,passage),
            evidence_state=CASE WHEN excluded.evidence_state='captured' THEN 'captured' ELSE evidence_state END",
        params![id,project_id,source.provider,source.url,source.title,source.published_at,
            source.observed_at,source.passage,evidence_state])?;
    Ok(id)
}

/// Kept positional for the research-store adapters; inputs are validated before SQL.
#[allow(clippy::too_many_arguments)]
pub fn add_edge(
    db: &Connection,
    project_id: &str,
    from: &str,
    to: &str,
    relation: &str,
    source_id: Option<&str>,
    status: &str,
    now: i64,
) -> Result<String, DiscoveryError> {
    add_edge_verified(db, project_id, from, to, relation, source_id, status, None, now)
}

/// Quote is a separate parameter to prevent inferred relationships from borrowing unsupported source text.
#[allow(clippy::too_many_arguments)]
pub fn add_edge_verified(
    db:&Connection,project_id:&str,from:&str,to:&str,relation:&str,source_id:Option<&str>,
    status:&str,quote:Option<&str>,now:i64,
) -> Result<String,DiscoveryError> {
    if !matches!(
        relation,
        "subtopic_of" | "related_to" | "affects" | "raises_question" | "mentions" | "covered_by"
    ) || !matches!(status, "supported" | "hypothesized" | "rejected")
        || from == to
    {
        return Err(DiscoveryError::Invalid("Invalid graph relationship".into()));
    }
    let valid: i64 = db.query_row(
        "SELECT COUNT(*) FROM kg_nodes WHERE project_id=?1 AND id IN (?2,?3)",
        params![project_id, from, to],
        |row| row.get(0),
    )?;
    if valid != 2 {
        return Err(DiscoveryError::Invalid(
            "Graph nodes must belong to the same project".into(),
        ));
    }
    let mut assessment = "unknown";
    if let Some(source_id) = source_id {
        let state: Option<(String,Option<String>)> = db
            .query_row(
                "SELECT evidence_state,passage FROM kg_sources WHERE project_id=?1 AND id=?2",
                params![project_id, source_id],
                |row| Ok((row.get(0)?,row.get(1)?)),
            )
            .optional()?;
        if state.is_none() {
            return Err(DiscoveryError::Invalid(
                "Source belongs to a different project".into(),
            ));
        }
        if let Some(("captured",Some(passage)))=state.as_ref().map(|(s,p)|(s.as_str(),p))
            && quote.is_some_and(|q|q.len()>=10&&q.len()<=600&&passage.contains(q)) {
                assessment="supports";
        }
    }
    if status=="supported" && relation=="affects" {
        return Err(DiscoveryError::Invalid("Causal relationships require manual verification".into()));
    }
    if status == "supported" && assessment != "supports" {
        return Err(DiscoveryError::Invalid(
            "Supported graph relationships require a verbatim captured passage".into(),
        ));
    }
    let id = ident(&[project_id, from, to, relation]);
    db.execute("INSERT INTO kg_edges(id,project_id,from_node_id,to_node_id,relation,status,origin,created_at)
        VALUES (?1,?2,?3,?4,?5,?6,'ai_inferred',?7)
        ON CONFLICT(project_id,from_node_id,to_node_id,relation) DO UPDATE
        SET status=CASE WHEN kg_edges.status='rejected' THEN 'rejected' ELSE excluded.status END",
        params![id,project_id,from,to,relation,status,now])?;
    if let Some(source_id) = source_id {
        db.execute("INSERT INTO kg_edge_evidence(edge_id,source_id,assessment,passage_locator)
            VALUES (?1,?2,?3,?4) ON CONFLICT(edge_id,source_id) DO UPDATE SET assessment=excluded.assessment,
                passage_locator=excluded.passage_locator",
            params![id,source_id,assessment,quote])?;
    }
    Ok(id)
}

pub fn overview(db: &Connection, project_id: &str) -> Result<GraphOverview, DiscoveryError> {
    valid_project(db, project_id)?;
    let mut nodes_query=db.prepare("SELECT id,kind,label FROM kg_nodes WHERE project_id=?1 ORDER BY updated_at DESC,id LIMIT 150")?;
    let nodes = nodes_query
        .query_map([project_id], |r| {
            Ok(GraphNode {
                id: r.get(0)?,
                kind: r.get(1)?,
                label: r.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut edges_query=db.prepare("SELECT id,from_node_id,to_node_id,relation,status FROM kg_edges WHERE project_id=?1 ORDER BY created_at DESC LIMIT 250")?;
    let edges = edges_query
        .query_map([project_id], |r| {
            Ok(GraphEdge {
                id: r.get(0)?,
                from_node_id: r.get(1)?,
                to_node_id: r.get(2)?,
                relation: r.get(3)?,
                status: r.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut sources_query = db.prepare(
        "SELECT id,provider,title,url,published_at,observed_at,evidence_state FROM kg_sources
        WHERE project_id=?1 ORDER BY observed_at DESC LIMIT 100",
    )?;
    let sources = sources_query
        .query_map([project_id], |r| {
            Ok(GraphSource {
                id: r.get(0)?,
                provider: r.get(1)?,
                title: r.get(2)?,
                url: r.get(3)?,
                published_at: r.get(4)?,
                observed_at: r.get(5)?,
                evidence_state: r.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut signal_query = db.prepare(
        "SELECT source_id,metric,value,unit,collected_at FROM kg_trend_observations
        WHERE project_id=?1 ORDER BY collected_at DESC LIMIT 100",
    )?;
    let signals = signal_query
        .query_map([project_id], |r| {
            Ok(GraphSignal {
                source_id: r.get(0)?,
                metric: r.get(1)?,
                value: r.get(2)?,
                unit: r.get(3)?,
                collected_at: r.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let topic_count = db.query_row(
        "SELECT COUNT(*) FROM kg_nodes WHERE project_id=?1",
        [project_id],
        |r| r.get(0),
    )?;
    let source_count = db.query_row(
        "SELECT COUNT(*) FROM kg_sources WHERE project_id=?1",
        [project_id],
        |r| r.get(0),
    )?;
    let supported_edge_count = db.query_row(
        "SELECT COUNT(*) FROM kg_edges WHERE project_id=?1 AND status='supported'",
        [project_id],
        |r| r.get(0),
    )?;
    Ok(GraphOverview {
        nodes,
        edges,
        sources,
        signals,
        topic_count,
        source_count,
        supported_edge_count,
    })
}

/// Import only observations from watchlists the user explicitly bound to this project.
/// Zero additional YouTube calls; figures remain dated, provider-specific observations.
pub fn import_market_observations(
    db: &mut Connection,
    project_id: &str,
    now: i64,
) -> Result<usize, DiscoveryError> {
    valid_project(db, project_id)?;
    let rows = {
        let mut stmt = db.prepare(
            "SELECT w.query,w.name,o.video_id,o.title,o.published_at,o.view_count,o.observed_at
            FROM market_video_observations o
            JOIN discovery_project_watchlists p ON p.watchlist_id=o.watchlist_id
            JOIN market_watchlists w ON w.id=o.watchlist_id
            WHERE p.project_id=?1 AND o.expires_at>?2 ORDER BY o.observed_at DESC LIMIT 250",
        )?;
        stmt.query_map(params![project_id, now], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, Option<i64>>(5)?,
                r.get::<_, i64>(6)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?
    };
    let mut imported = 0;
    for (query, name, video_id, title, published_at, views, observed_at) in rows {
        let topic = if query.trim().len() >= 3 { query } else { name };
        let topic_node = upsert_node(db, project_id, "topic", &topic, now)?;
        let source = import_source(
            db,
            project_id,
            SourceDraft {
                url: format!("https://www.youtube.com/watch?v={video_id}"),
                title: title.clone(),
                published_at: Some(published_at),
                provider: "youtube-data-api".into(),
                observed_at,
                passage: None,
            },
        )?;
        let video_node = upsert_node(db, project_id, "source", &title, now)?;
        add_edge(
            db,
            project_id,
            &video_node,
            &topic_node,
            "mentions",
            Some(&source),
            "hypothesized",
            now,
        )?;
        if let Some(views) = views {
            let id = ident(&[project_id, &source, "views", &observed_at.to_string()]);
            db.execute("INSERT OR IGNORE INTO kg_trend_observations(id,project_id,node_id,source_id,provider,metric,value,unit,region,window_start,window_end,collected_at)
                VALUES (?1,?2,?3,?4,'youtube-data-api','views',?5,'count',NULL,NULL,NULL,?6)",
                params![id,project_id,topic_node,source,views,observed_at])?;
        }
        imported += 1;
    }
    Ok(imported)
}
