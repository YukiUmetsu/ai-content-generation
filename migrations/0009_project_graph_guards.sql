-- Standard foreign keys validate existence, not that the referenced rows
-- belong to the same project. These guards also reject direct SQL mutations.
CREATE TRIGGER kg_alias_project_insert BEFORE INSERT ON kg_node_aliases
WHEN NOT EXISTS(SELECT 1 FROM kg_nodes WHERE id=NEW.node_id AND project_id=NEW.project_id)
BEGIN SELECT RAISE(ABORT,'graph alias references another project'); END;
CREATE TRIGGER kg_alias_project_update BEFORE UPDATE OF project_id,node_id ON kg_node_aliases
WHEN NOT EXISTS(SELECT 1 FROM kg_nodes WHERE id=NEW.node_id AND project_id=NEW.project_id)
BEGIN SELECT RAISE(ABORT,'graph alias references another project'); END;

CREATE TRIGGER kg_edge_project_insert BEFORE INSERT ON kg_edges
WHEN NOT EXISTS(SELECT 1 FROM kg_nodes WHERE id=NEW.from_node_id AND project_id=NEW.project_id)
  OR NOT EXISTS(SELECT 1 FROM kg_nodes WHERE id=NEW.to_node_id AND project_id=NEW.project_id)
BEGIN SELECT RAISE(ABORT,'graph edge references another project'); END;
CREATE TRIGGER kg_edge_project_update BEFORE UPDATE OF project_id,from_node_id,to_node_id ON kg_edges
WHEN NOT EXISTS(SELECT 1 FROM kg_nodes WHERE id=NEW.from_node_id AND project_id=NEW.project_id)
  OR NOT EXISTS(SELECT 1 FROM kg_nodes WHERE id=NEW.to_node_id AND project_id=NEW.project_id)
BEGIN SELECT RAISE(ABORT,'graph edge references another project'); END;

CREATE TRIGGER kg_edge_evidence_project_insert BEFORE INSERT ON kg_edge_evidence
WHEN NOT EXISTS(SELECT 1 FROM kg_edges e JOIN kg_sources s ON s.project_id=e.project_id
  WHERE e.id=NEW.edge_id AND s.id=NEW.source_id)
BEGIN SELECT RAISE(ABORT,'graph evidence references another project'); END;
CREATE TRIGGER kg_edge_evidence_project_update BEFORE UPDATE OF edge_id,source_id ON kg_edge_evidence
WHEN NOT EXISTS(SELECT 1 FROM kg_edges e JOIN kg_sources s ON s.project_id=e.project_id
  WHERE e.id=NEW.edge_id AND s.id=NEW.source_id)
BEGIN SELECT RAISE(ABORT,'graph evidence references another project'); END;

CREATE TRIGGER kg_signal_project_insert BEFORE INSERT ON kg_trend_observations
WHEN NOT EXISTS(SELECT 1 FROM kg_nodes WHERE id=NEW.node_id AND project_id=NEW.project_id)
  OR (NEW.source_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM kg_sources WHERE id=NEW.source_id AND project_id=NEW.project_id))
BEGIN SELECT RAISE(ABORT,'graph signal references another project'); END;
CREATE TRIGGER kg_signal_project_update BEFORE UPDATE OF project_id,node_id,source_id ON kg_trend_observations
WHEN NOT EXISTS(SELECT 1 FROM kg_nodes WHERE id=NEW.node_id AND project_id=NEW.project_id)
  OR (NEW.source_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM kg_sources WHERE id=NEW.source_id AND project_id=NEW.project_id))
BEGIN SELECT RAISE(ABORT,'graph signal references another project'); END;

CREATE TRIGGER discovery_candidate_source_project_insert BEFORE INSERT ON discovery_candidates
WHEN EXISTS(SELECT 1 FROM json_each(NEW.source_ids_json) j
  WHERE j.type!='text' OR NOT EXISTS(SELECT 1 FROM kg_sources s
    WHERE s.id=j.value AND s.project_id=NEW.project_id))
BEGIN SELECT RAISE(ABORT,'candidate cites foreign or missing source'); END;
CREATE TRIGGER discovery_candidate_source_project_update BEFORE UPDATE OF project_id,source_ids_json ON discovery_candidates
WHEN EXISTS(SELECT 1 FROM json_each(NEW.source_ids_json) j
  WHERE j.type!='text' OR NOT EXISTS(SELECT 1 FROM kg_sources s
    WHERE s.id=j.value AND s.project_id=NEW.project_id))
BEGIN SELECT RAISE(ABORT,'candidate cites foreign or missing source'); END;
