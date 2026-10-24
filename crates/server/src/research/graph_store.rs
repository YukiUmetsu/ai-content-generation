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
pub struct GraphEdgeEvidence {
    pub edge_id: String,
    pub source_id: String,
    pub assessment: String,
    pub quote: Option<String>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphAlias {
    pub node_id: String,
    pub alias: String,
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
pub struct CapturedSource {
    pub id: String,
    pub passage: String,
    pub title: String,
    pub url: String,
    pub provider: String,
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
    pub aliases: Vec<GraphAlias>,
    pub edges: Vec<GraphEdge>,
    pub edge_evidence: Vec<GraphEdgeEvidence>,
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
    // Human-approved aliases resolve to the same durable node identity.
    if let Some(existing) = db
        .query_row(
            "SELECT a.node_id FROM kg_node_aliases a
        JOIN kg_nodes n ON n.id=a.node_id AND n.project_id=a.project_id
        WHERE a.project_id=?1 AND a.normalized=?2 AND n.kind=?3",
            params![project_id, key, kind],
            |row| row.get(0),
        )
        .optional()?
    {
        return Ok(existing);
    }
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

pub fn add_alias(
    db: &Connection,
    project_id: &str,
    node_id: &str,
    alias: &str,
) -> Result<(), DiscoveryError> {
    valid_project(db, project_id)?;
    let clean = normalize(alias);
    if !(2..=240).contains(&clean.chars().count()) {
        return Err(DiscoveryError::Invalid("Invalid graph alias".into()));
    }
    let normalized = clean.to_lowercase();
    let kind: String = db
        .query_row(
            "SELECT kind FROM kg_nodes WHERE project_id=?1 AND id=?2",
            params![project_id, node_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(DiscoveryError::NotFound)?;
    let duplicate: Option<String> = db
        .query_row(
            "SELECT id FROM kg_nodes WHERE project_id=?1 AND kind=?2 AND normalized=?3",
            params![project_id, kind, normalized],
            |row| row.get(0),
        )
        .optional()?;
    if duplicate.is_some_and(|id| id != node_id) {
        return Err(DiscoveryError::Invalid(
            "Alias already names another node".into(),
        ));
    }
    let bound: Option<String> = db
        .query_row(
            "SELECT node_id FROM kg_node_aliases WHERE project_id=?1 AND normalized=?2",
            params![project_id, normalized],
            |row| row.get(0),
        )
        .optional()?;
    if bound.is_some_and(|id| id != node_id) {
        return Err(DiscoveryError::Invalid(
            "Alias belongs to another node".into(),
        ));
    }
    db.execute(
        "INSERT INTO kg_node_aliases(project_id,node_id,normalized,alias)
        VALUES (?1,?2,?3,?4) ON CONFLICT(project_id,normalized) DO UPDATE SET alias=excluded.alias",
        params![project_id, node_id, normalized, clean],
    )?;
    Ok(())
}

pub fn remove_alias(
    db: &Connection,
    project_id: &str,
    node_id: &str,
    alias: &str,
) -> Result<(), DiscoveryError> {
    valid_project(db, project_id)?;
    if db.execute(
        "DELETE FROM kg_node_aliases WHERE project_id=?1 AND node_id=?2 AND normalized=?3",
        params![project_id, node_id, normalize(alias).to_lowercase()],
    )? == 0
    {
        return Err(DiscoveryError::NotFound);
    }
    Ok(())
}

pub fn search_nodes(
    db: &Connection,
    project_id: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<GraphNode>, DiscoveryError> {
    valid_project(db, project_id)?;
    let terms: Vec<_> = query
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.chars().count() >= 2)
        .take(4)
        .collect();
    if terms.is_empty() || query.len() > 200 || limit == 0 || limit > 50 {
        return Err(DiscoveryError::Invalid("Invalid graph search".into()));
    }
    let fts = terms
        .iter()
        .map(|term| format!("\"{term}\"*"))
        .collect::<Vec<_>>()
        .join(" AND ");
    let alias_match = format!("%{}%", terms.join(" ").to_lowercase());
    let mut statement=db.prepare("SELECT n.id,n.kind,n.label FROM kg_nodes n WHERE n.project_id=?1
        AND (n.id IN (SELECT f.node_id FROM kg_node_search f WHERE f.project_id=?1 AND f.label MATCH ?2)
          OR EXISTS(SELECT 1 FROM kg_node_aliases a WHERE a.node_id=n.id AND a.project_id=?1 AND a.normalized LIKE ?3))
        ORDER BY n.updated_at DESC,n.id LIMIT ?4")?;
    statement
        .query_map(params![project_id, fts, alias_match, limit as i64], |row| {
            Ok(GraphNode {
                id: row.get(0)?,
                kind: row.get(1)?,
                label: row.get(2)?,
            })
        })?
        .collect::<Result<_, _>>()
        .map_err(Into::into)
}

pub fn correct_edge(
    db: &Connection,
    project_id: &str,
    edge_id: &str,
    status: &str,
) -> Result<(), DiscoveryError> {
    valid_project(db, project_id)?;
    if !matches!(status, "rejected" | "hypothesized" | "supported") {
        return Err(DiscoveryError::Invalid(
            "Invalid graph review decision".into(),
        ));
    }
    if status == "supported" {
        let qualifies: i64 = db.query_row(
            "SELECT COUNT(*) FROM kg_edges e
            JOIN kg_edge_evidence p ON p.edge_id=e.id AND p.assessment='supports'
            WHERE e.project_id=?1 AND e.id=?2 AND e.relation!='affects'",
            params![project_id, edge_id],
            |row| row.get(0),
        )?;
        if qualifies == 0 {
            return Err(DiscoveryError::Invalid(
                "Cannot approve an unsupported graph relationship".into(),
            ));
        }
    }
    if db.execute(
        "UPDATE kg_edges SET status=?3,origin='manual' WHERE project_id=?1 AND id=?2",
        params![project_id, edge_id, status],
    )? == 0
    {
        return Err(DiscoveryError::NotFound);
    }
    Ok(())
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
    add_edge_verified(
        db, project_id, from, to, relation, source_id, status, None, now,
    )
}

/// Quote is a separate parameter to prevent inferred relationships from borrowing unsupported source text.
#[allow(clippy::too_many_arguments)]
pub fn add_edge_verified(
    db: &Connection,
    project_id: &str,
    from: &str,
    to: &str,
    relation: &str,
    source_id: Option<&str>,
    status: &str,
    quote: Option<&str>,
    now: i64,
) -> Result<String, DiscoveryError> {
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
    let node_kind = |id: &str| -> Result<String, DiscoveryError> {
        Ok(db.query_row(
            "SELECT kind FROM kg_nodes WHERE project_id=?1 AND id=?2",
            params![project_id, id],
            |row| row.get(0),
        )?)
    };
    let from_kind = node_kind(from)?;
    let to_kind = node_kind(to)?;
    let descriptive = |kind: &str| matches!(kind, "topic" | "entity" | "question" | "event");
    let operative = |kind: &str| matches!(kind, "topic" | "entity" | "event");
    let valid_direction = match relation {
        "subtopic_of" => from_kind == "topic" && to_kind == "topic",
        "raises_question" => operative(&from_kind) && to_kind == "question",
        "mentions" => matches!(from_kind.as_str(), "source" | "content") && descriptive(&to_kind),
        "covered_by" => {
            matches!(from_kind.as_str(), "topic" | "question" | "event") && to_kind == "content"
        }
        "affects" => operative(&from_kind) && operative(&to_kind),
        "related_to" => descriptive(&from_kind) && descriptive(&to_kind),
        _ => false,
    };
    if !valid_direction {
        return Err(DiscoveryError::Invalid(
            "Invalid graph relationship direction or node types".into(),
        ));
    }
    let mut assessment = "unknown";
    if let Some(source_id) = source_id {
        let state: Option<(String, Option<String>)> = db
            .query_row(
                "SELECT evidence_state,passage FROM kg_sources WHERE project_id=?1 AND id=?2",
                params![project_id, source_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        if state.is_none() {
            return Err(DiscoveryError::Invalid(
                "Source belongs to a different project".into(),
            ));
        }
        if let Some(("captured", Some(passage))) = state.as_ref().map(|(s, p)| (s.as_str(), p))
            && quote.is_some_and(|q| q.len() >= 10 && q.len() <= 600 && passage.contains(q))
        {
            assessment = "supports";
        }
    }
    if status == "supported" && relation == "affects" {
        return Err(DiscoveryError::Invalid(
            "Causal relationships require manual verification".into(),
        ));
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
        SET status=CASE WHEN kg_edges.origin='manual' OR kg_edges.status IN ('rejected','supported')
            THEN kg_edges.status ELSE excluded.status END",
        params![id,project_id,from,to,relation,status,now])?;
    if let Some(source_id) = source_id {
        db.execute("INSERT INTO kg_edge_evidence(edge_id,source_id,assessment,passage_locator)
            VALUES (?1,?2,?3,?4) ON CONFLICT(edge_id,source_id) DO UPDATE SET
                assessment=CASE WHEN kg_edge_evidence.assessment='supports' THEN 'supports' ELSE excluded.assessment END,
                passage_locator=CASE WHEN kg_edge_evidence.assessment='supports'
                    THEN kg_edge_evidence.passage_locator ELSE excluded.passage_locator END",
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
    let mut alias_query = db.prepare(
        "SELECT a.node_id,a.alias FROM kg_node_aliases a
        JOIN kg_nodes n ON n.id=a.node_id AND n.project_id=a.project_id
        WHERE a.project_id=?1 ORDER BY a.alias COLLATE NOCASE LIMIT 500",
    )?;
    let aliases = alias_query
        .query_map([project_id], |row| {
            Ok(GraphAlias {
                node_id: row.get(0)?,
                alias: row.get(1)?,
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
    let mut evidence_query = db.prepare(
        "SELECT e.edge_id,e.source_id,e.assessment,e.passage_locator
        FROM kg_edge_evidence e JOIN kg_edges g ON g.id=e.edge_id
        WHERE g.project_id=?1 ORDER BY g.created_at DESC,e.source_id LIMIT 500",
    )?;
    let edge_evidence = evidence_query
        .query_map([project_id], |r| {
            Ok(GraphEdgeEvidence {
                edge_id: r.get(0)?,
                source_id: r.get(1)?,
                assessment: r.get(2)?,
                quote: r.get(3)?,
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
        aliases,
        edges,
        edge_evidence,
        sources,
        signals,
        topic_count,
        source_count,
        supported_edge_count,
    })
}

/// Restricted to the local editor API. Bounded passages let later explicit
/// discovery clicks resume graph extraction without capturing the same page.
pub fn captured_sources(
    db: &Connection,
    project_id: &str,
) -> Result<Vec<CapturedSource>, DiscoveryError> {
    valid_project(db, project_id)?;
    let mut query = db.prepare(
        "SELECT id,substr(passage,1,10000),title,url,provider,published_at,observed_at,evidence_state FROM kg_sources
        WHERE project_id=?1 AND evidence_state='captured'
        AND passage IS NOT NULL AND length(passage)>=60
        ORDER BY observed_at DESC,id LIMIT 8",
    )?;
    let rows = query.query_map([project_id], |row| {
        Ok(CapturedSource {
            id: row.get(0)?,
            passage: row.get(1)?,
            title: row.get(2)?,
            url: row.get(3)?,
            provider: row.get(4)?,
            published_at: row.get(5)?,
            observed_at: row.get(6)?,
            evidence_state: row.get(7)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
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
