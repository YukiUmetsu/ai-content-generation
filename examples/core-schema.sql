-- Reference schema from the previous detailed specification; split into versioned migrations before production use.
PRAGMA foreign_keys = ON;
CREATE TABLE brands (
 id TEXT PRIMARY KEY, name TEXT NOT NULL,
 tokens_json TEXT NOT NULL DEFAULT '{}', voice_json TEXT NOT NULL DEFAULT '{}',
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE projects (
 id TEXT PRIMARY KEY,
 brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE RESTRICT,
 parent_id TEXT REFERENCES projects(id) ON DELETE RESTRICT,
 name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0,
 default_language TEXT NOT NULL DEFAULT 'en',
 settings_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK(parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX idx_projects_tree ON projects(brand_id, parent_id, sort_order);
-- Defense-in-depth: brand consistency, including direct SQL writes.
CREATE TRIGGER project_parent_brand_insert BEFORE INSERT ON projects
WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'project parent brand mismatch')
  WHERE (SELECT brand_id FROM projects WHERE id=NEW.parent_id) <> NEW.brand_id;
END;
CREATE TRIGGER project_parent_cycle_update BEFORE UPDATE OF parent_id, brand_id ON projects
BEGIN
  SELECT RAISE(ABORT, 'project parent brand mismatch')
  WHERE NEW.parent_id IS NOT NULL AND
    (SELECT brand_id FROM projects WHERE id=NEW.parent_id) <> NEW.brand_id;
  SELECT RAISE(ABORT, 'project child brand mismatch')
  WHERE EXISTS (SELECT 1 FROM projects WHERE parent_id=NEW.id AND brand_id<>NEW.brand_id);
  SELECT RAISE(ABORT, 'project cycle')
  WHERE NEW.parent_id IS NOT NULL AND EXISTS (
    WITH RECURSIVE ancestor(id) AS (
      SELECT NEW.parent_id
      UNION ALL
      SELECT p.parent_id FROM projects p JOIN ancestor a ON p.id=a.id
      WHERE p.parent_id IS NOT NULL
    ) SELECT 1 FROM ancestor WHERE id=NEW.id
  );
END;

CREATE TABLE topics (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
 title TEXT NOT NULL, intent TEXT, status TEXT NOT NULL,
 score_json TEXT NOT NULL DEFAULT '{}', research_snapshot_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE contents (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
 topic_id TEXT REFERENCES topics(id), format TEXT NOT NULL, language TEXT NOT NULL,
 slug TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(project_id, language, slug)
);
CREATE TABLE content_versions (
 id TEXT PRIMARY KEY, content_id TEXT NOT NULL REFERENCES contents(id),
 revision INTEGER NOT NULL CHECK(revision > 0), document_schema TEXT NOT NULL,
 document_json TEXT NOT NULL, provenance_json TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(content_id, revision)
);
CREATE TABLE artifacts (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
 sha256 TEXT NOT NULL, path TEXT NOT NULL, mime_type TEXT NOT NULL,
 bytes INTEGER NOT NULL CHECK(bytes >= 0), meta_json TEXT NOT NULL DEFAULT '{}',
 ownership TEXT NOT NULL, retention TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE content_assets (
 content_version_id TEXT NOT NULL REFERENCES content_versions(id),
 artifact_id TEXT NOT NULL REFERENCES artifacts(id), role TEXT NOT NULL,
 placement_json TEXT NOT NULL DEFAULT '{}',
 PRIMARY KEY(content_version_id, artifact_id, role)
);
CREATE TABLE project_asset_links (
 project_id TEXT NOT NULL REFERENCES projects(id), artifact_id TEXT NOT NULL REFERENCES artifacts(id),
 role TEXT NOT NULL DEFAULT 'reference', approval_id TEXT,
 PRIMARY KEY(project_id, artifact_id, role)
);

-- Products are commerce-neutral catalog entities; no Stripe credentials/IDs as PKs.
CREATE TABLE products (
 id TEXT PRIMARY KEY, brand_id TEXT NOT NULL REFERENCES brands(id),
 kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
 metadata_json TEXT NOT NULL DEFAULT '{}', cover_artifact_id TEXT REFERENCES artifacts(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE product_project_links (
 product_id TEXT NOT NULL REFERENCES products(id), project_id TEXT NOT NULL REFERENCES projects(id),
 PRIMARY KEY(product_id, project_id)
);
CREATE TABLE product_variants (
 id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),
 sku TEXT, language TEXT, edition TEXT, format TEXT NOT NULL,
 metadata_json TEXT NOT NULL DEFAULT '{}', UNIQUE(product_id, sku)
);
CREATE TABLE product_releases (
 id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),
 version TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'draft',
 manifest_json TEXT NOT NULL, manifest_sha256 TEXT, approved_at TEXT,
 created_at TEXT NOT NULL, UNIQUE(product_id, version)
);
CREATE TABLE product_release_items (
 release_id TEXT NOT NULL REFERENCES product_releases(id),
 artifact_id TEXT NOT NULL REFERENCES artifacts(id),
 content_version_id TEXT REFERENCES content_versions(id),
 role TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(release_id, artifact_id, role)
);
-- Frozen approved/released products cannot be mutated in place.
CREATE TRIGGER frozen_product_release_update BEFORE UPDATE ON product_releases
WHEN OLD.state IN ('approved','released') AND
 (NEW.product_id<>OLD.product_id OR NEW.version<>OLD.version OR
  NEW.manifest_json<>OLD.manifest_json OR
  COALESCE(NEW.manifest_sha256,'')<>COALESCE(OLD.manifest_sha256,''))
BEGIN SELECT RAISE(ABORT,'approved product release is immutable'); END;
CREATE TRIGGER frozen_product_item_insert BEFORE INSERT ON product_release_items
WHEN (SELECT state FROM product_releases WHERE id=NEW.release_id) IN ('approved','released')
BEGIN SELECT RAISE(ABORT,'approved product release items are immutable'); END;
CREATE TRIGGER frozen_product_item_update BEFORE UPDATE ON product_release_items
WHEN (SELECT state FROM product_releases WHERE id=OLD.release_id) IN ('approved','released')
BEGIN SELECT RAISE(ABORT,'approved product release items are immutable'); END;
CREATE TRIGGER frozen_product_item_delete BEFORE DELETE ON product_release_items
WHEN (SELECT state FROM product_releases WHERE id=OLD.release_id) IN ('approved','released')
BEGIN SELECT RAISE(ABORT,'approved product release items are immutable'); END;
CREATE TABLE commercial_offerings (
 id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),
 variant_id TEXT REFERENCES product_variants(id),
 currency TEXT NOT NULL, amount_minor INTEGER NOT NULL CHECK(amount_minor >= 0),
 billing_type TEXT NOT NULL CHECK(billing_type IN ('one_time','recurring')),
 interval_unit TEXT, status TEXT NOT NULL DEFAULT 'draft',
 CHECK((billing_type='one_time' AND interval_unit IS NULL) OR
       (billing_type='recurring' AND interval_unit IN ('day','week','month','year')))
);
CREATE TABLE commerce_external_refs (
 id TEXT PRIMARY KEY, provider TEXT NOT NULL, environment TEXT NOT NULL,
 local_kind TEXT NOT NULL, local_id TEXT NOT NULL, external_kind TEXT NOT NULL,
 external_id TEXT NOT NULL, sync_state TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(provider, environment, external_kind, external_id)
);

-- Character identity independent of any one project's output images.
CREATE TABLE characters (
 id TEXT PRIMARY KEY, owner_brand_id TEXT REFERENCES brands(id),
 scope TEXT NOT NULL CHECK(scope IN ('workspace','brand')),
 status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK((scope='workspace' AND owner_brand_id IS NULL) OR
       (scope='brand' AND owner_brand_id IS NOT NULL))
);
CREATE TABLE character_project_links (
 character_id TEXT NOT NULL REFERENCES characters(id), project_id TEXT NOT NULL REFERENCES projects(id),
 rights_approval_id TEXT, PRIMARY KEY(character_id, project_id)
);
CREATE TABLE character_versions (
 id TEXT PRIMARY KEY, character_id TEXT NOT NULL REFERENCES characters(id),
 revision INTEGER NOT NULL CHECK(revision > 0), status TEXT NOT NULL,
 bible_schema TEXT NOT NULL, bible_json TEXT NOT NULL,
 reference_manifest_json TEXT NOT NULL DEFAULT '{}', approved_at TEXT, created_at TEXT NOT NULL,
 UNIQUE(character_id, revision)
);
CREATE TABLE character_names (
 id TEXT PRIMARY KEY, character_id TEXT NOT NULL REFERENCES characters(id),
 locale TEXT NOT NULL, display_name TEXT NOT NULL, normalized_name TEXT NOT NULL,
 kind TEXT NOT NULL, pronunciation TEXT, is_primary INTEGER NOT NULL DEFAULT 0,
 UNIQUE(character_id, locale, normalized_name, kind)
);
CREATE TABLE character_assets (
 character_version_id TEXT NOT NULL REFERENCES character_versions(id),
 artifact_id TEXT NOT NULL REFERENCES artifacts(id), role TEXT NOT NULL,
 pose TEXT, expression TEXT, outfit TEXT, view_angle TEXT, approved INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(character_version_id, artifact_id, role)
);
CREATE TABLE character_rigs (
 id TEXT PRIMARY KEY, character_version_id TEXT NOT NULL REFERENCES character_versions(id),
 renderer_kind TEXT NOT NULL, revision INTEGER NOT NULL,
 source_artifact_id TEXT NOT NULL REFERENCES artifacts(id),
 mapping_json TEXT NOT NULL, status TEXT NOT NULL, UNIQUE(character_version_id, renderer_kind, revision)
);
CREATE TABLE animation_clips (
 id TEXT PRIMARY KEY, rig_id TEXT NOT NULL REFERENCES character_rigs(id),
 name TEXT NOT NULL, animation_schema TEXT NOT NULL, animation_json TEXT NOT NULL,
 preview_artifact_id TEXT REFERENCES artifacts(id), created_at TEXT NOT NULL
);
CREATE TABLE character_voices (
 id TEXT PRIMARY KEY, character_id TEXT NOT NULL REFERENCES characters(id),
 locale TEXT NOT NULL, provider_profile_id TEXT, voice_ref TEXT NOT NULL,
 pronunciation_json TEXT NOT NULL DEFAULT '{}', rights_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE character_appearances (
 id TEXT PRIMARY KEY, character_version_id TEXT NOT NULL REFERENCES character_versions(id),
 content_version_id TEXT REFERENCES content_versions(id),
 thumbnail_version_id TEXT REFERENCES thumbnail_versions(id),
 scene_id TEXT, role TEXT NOT NULL,
 CHECK(content_version_id IS NOT NULL OR thumbnail_version_id IS NOT NULL)
);

-- Standalone thumbnails are allowed; keep brand/project scope explicit.
CREATE TABLE thumbnails (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
 source_content_id TEXT REFERENCES contents(id), status TEXT NOT NULL DEFAULT 'draft',
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE thumbnail_versions (
 id TEXT PRIMARY KEY, thumbnail_id TEXT NOT NULL REFERENCES thumbnails(id),
 revision INTEGER NOT NULL CHECK(revision > 0), variant_key TEXT NOT NULL,
 platform_profile TEXT NOT NULL, spec_schema TEXT NOT NULL, spec_json TEXT NOT NULL,
 rendered_artifact_id TEXT REFERENCES artifacts(id),
 status TEXT NOT NULL DEFAULT 'draft', is_default INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, approved_at TEXT,
 UNIQUE(thumbnail_id, variant_key, revision)
);
CREATE UNIQUE INDEX idx_thumbnail_one_default
 ON thumbnail_versions(thumbnail_id, platform_profile)
 WHERE is_default = 1 AND status = 'approved';

CREATE TABLE sources (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
 url TEXT, title TEXT, publisher TEXT, published_at TEXT, retrieved_at TEXT NOT NULL,
 raw_artifact_id TEXT, text_hash TEXT NOT NULL, rights_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE claims (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
 statement TEXT NOT NULL, status TEXT NOT NULL, valid_from TEXT, valid_to TEXT,
 confidence REAL, created_at TEXT NOT NULL
);
CREATE TABLE claim_evidence (
 claim_id TEXT NOT NULL REFERENCES claims(id), source_id TEXT NOT NULL REFERENCES sources(id),
 source_locator_json TEXT NOT NULL, relation TEXT NOT NULL,
 reviewed_at TEXT, PRIMARY KEY(claim_id, source_id, source_locator_json)
);
CREATE TABLE jobs (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
 workflow_type TEXT NOT NULL, state TEXT NOT NULL, spec_json TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, approved_at TEXT
);
CREATE TABLE steps (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id),
 name TEXT NOT NULL, state TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 0,
 input_hash TEXT, provider_profile_id TEXT, result_json TEXT,
 started_at TEXT, finished_at TEXT
);
CREATE TABLE step_dependencies (
 step_id TEXT NOT NULL REFERENCES steps(id), depends_on_id TEXT NOT NULL REFERENCES steps(id),
 PRIMARY KEY(step_id, depends_on_id), CHECK(step_id <> depends_on_id)
);
CREATE TABLE provider_profiles (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, config_json TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE graph_nodes (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
 kind TEXT NOT NULL, canonical_key TEXT NOT NULL, label TEXT NOT NULL,
 entity_ref_kind TEXT, entity_ref_id TEXT,
 attrs_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'proposed',
 UNIQUE(project_id, kind, canonical_key)
);
CREATE TABLE graph_edges (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
 src_id TEXT NOT NULL REFERENCES graph_nodes(id), dst_id TEXT NOT NULL REFERENCES graph_nodes(id),
 type TEXT NOT NULL, evidence_json TEXT NOT NULL DEFAULT '[]',
 valid_from TEXT, valid_to TEXT, status TEXT NOT NULL DEFAULT 'proposed'
);
CREATE TABLE qa_findings (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id),
 step_id TEXT REFERENCES steps(id), artifact_id TEXT REFERENCES artifacts(id),
 code TEXT NOT NULL, severity TEXT NOT NULL, status TEXT NOT NULL,
 evidence_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE approvals (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
 target_type TEXT NOT NULL, target_id TEXT NOT NULL, revision TEXT NOT NULL,
 action TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE publish_attempts (
 id TEXT PRIMARY KEY, content_version_id TEXT REFERENCES content_versions(id),
 product_release_id TEXT REFERENCES product_releases(id),
 thumbnail_version_id TEXT REFERENCES thumbnail_versions(id),
 destination TEXT NOT NULL, state TEXT NOT NULL, request_json TEXT NOT NULL,
 remote_ref TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK(content_version_id IS NOT NULL OR product_release_id IS NOT NULL OR thumbnail_version_id IS NOT NULL)
);
CREATE INDEX idx_content_topic ON contents(topic_id);
CREATE INDEX idx_claim_project_status ON claims(project_id, status);
CREATE INDEX idx_graph_edge_src ON graph_edges(src_id, type);
CREATE INDEX idx_graph_edge_dst ON graph_edges(dst_id, type);
CREATE INDEX idx_job_state ON jobs(state, updated_at);
CREATE INDEX idx_step_job_state ON steps(job_id, state);
CREATE INDEX idx_artifact_hash ON artifacts(sha256);
CREATE INDEX idx_character_versions ON character_versions(character_id, revision);
CREATE INDEX idx_character_names ON character_names(locale, normalized_name);
CREATE INDEX idx_product_releases ON product_releases(product_id, created_at);
CREATE INDEX idx_thumbnail_versions ON thumbnail_versions(thumbnail_id, platform_profile, status);
