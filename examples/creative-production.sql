-- ContentGen creative-production schema v1 (SPECIFICATION FIXTURE, NOT AN APPLIED MIGRATION).
-- Apply AFTER examples/core-schema.sql on a NEW disposable DB for review. Actual app
-- MUST split tables into ordered, transactional migrations and preflight existing DB.
-- SQLite >= 3.38 with JSON functions; FK enforcement is PER CONNECTION.
-- No destructive ALTER/DROP, no implicit migrations, no credential/blob storage.
PRAGMA foreign_keys = ON;

-- Stable brand identity and immutable approved revisions. Existing brands.tokens_json
-- and brands.voice_json remain legacy compatibility fields, not source-of-truth.
CREATE TABLE brand_kits (
 id TEXT PRIMARY KEY, brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE RESTRICT,
 name TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(id, brand_id), UNIQUE(brand_id, name)
);
CREATE TABLE brand_kit_revisions (
 id TEXT PRIMARY KEY, kit_id TEXT NOT NULL REFERENCES brand_kits(id) ON DELETE RESTRICT,
 revision INTEGER NOT NULL CHECK(revision > 0), schema_version INTEGER NOT NULL CHECK(schema_version > 0),
 kit_json TEXT NOT NULL CHECK(json_valid(kit_json)), content_sha256 TEXT NOT NULL CHECK(length(content_sha256) = 64),
 state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','approved')),
 approved_at TEXT, created_at TEXT NOT NULL,
 CHECK((state = 'approved') = (approved_at IS NOT NULL)),
 UNIQUE(kit_id, revision)
);
CREATE INDEX idx_brand_kit_revisions_kit ON brand_kit_revisions(kit_id, state, revision DESC);
CREATE TRIGGER brand_kit_approved_no_update BEFORE UPDATE ON brand_kit_revisions
 WHEN OLD.state = 'approved' BEGIN SELECT RAISE(ABORT, 'approved brand kit is immutable'); END;
CREATE TRIGGER brand_kit_approved_no_delete BEFORE DELETE ON brand_kit_revisions
 WHEN OLD.state = 'approved' BEGIN SELECT RAISE(ABORT, 'approved brand kit cannot be deleted'); END;

-- One pinned approved kit per project; no unreviewed cross-brand inheritance.
CREATE TABLE project_brand_kits (
 project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE RESTRICT,
 kit_revision_id TEXT NOT NULL REFERENCES brand_kit_revisions(id) ON DELETE RESTRICT,
 overrides_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(overrides_json)),
 updated_at TEXT NOT NULL
);
CREATE TRIGGER project_brand_match_insert BEFORE INSERT ON project_brand_kits BEGIN
 SELECT RAISE(ABORT, 'brand mismatch or brand kit not approved') WHERE NOT EXISTS (
  SELECT 1 FROM projects p JOIN brand_kits k ON k.brand_id = p.brand_id
  JOIN brand_kit_revisions kr ON kr.kit_id = k.id
  WHERE p.id = NEW.project_id AND kr.id = NEW.kit_revision_id AND kr.state = 'approved'
 );
END;
CREATE TRIGGER project_brand_match_update BEFORE UPDATE OF project_id, kit_revision_id ON project_brand_kits BEGIN
 SELECT RAISE(ABORT, 'brand mismatch or brand kit not approved') WHERE NOT EXISTS (
  SELECT 1 FROM projects p JOIN brand_kits k ON k.brand_id = p.brand_id
  JOIN brand_kit_revisions kr ON kr.kit_id = k.id
  WHERE p.id = NEW.project_id AND kr.id = NEW.kit_revision_id AND kr.state = 'approved'
 );
END;
-- Base project.brand_id can be edited; reject stale pinned cross-brand linkage.
CREATE TRIGGER project_brand_change_guard BEFORE UPDATE OF brand_id ON projects
 WHEN EXISTS (SELECT 1 FROM project_brand_kits pb JOIN brand_kit_revisions kr ON kr.id = pb.kit_revision_id
   JOIN brand_kits k ON k.id = kr.kit_id WHERE pb.project_id = OLD.id AND k.brand_id <> NEW.brand_id)
 BEGIN SELECT RAISE(ABORT, 'project change invalidates pinned brand kit'); END;

-- Exact versioned local export policies, not eternal claims about platform limits.
CREATE TABLE delivery_profile_revisions (
 id TEXT PRIMARY KEY, platform TEXT NOT NULL, profile_key TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision > 0), width_px INTEGER NOT NULL CHECK(width_px > 0),
 height_px INTEGER NOT NULL CHECK(height_px > 0), fps_num INTEGER NOT NULL CHECK(fps_num > 0),
 fps_den INTEGER NOT NULL CHECK(fps_den > 0), settings_json TEXT NOT NULL CHECK(json_valid(settings_json)),
 content_sha256 TEXT NOT NULL CHECK(length(content_sha256) = 64),
 state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','approved')),
 approved_at TEXT, created_at TEXT NOT NULL,
 CHECK((state = 'approved') = (approved_at IS NOT NULL)),
 UNIQUE(platform, profile_key, revision)
);
CREATE TRIGGER profile_approved_no_update BEFORE UPDATE ON delivery_profile_revisions
 WHEN OLD.state = 'approved' BEGIN SELECT RAISE(ABORT, 'approved profile is immutable'); END;
CREATE TRIGGER profile_approved_no_delete BEFORE DELETE ON delivery_profile_revisions
 WHEN OLD.state = 'approved' BEGIN SELECT RAISE(ABORT, 'approved profile cannot be deleted'); END;

-- Logical voices and provider mappings; never persist API keys/biometric samples in JSON.
CREATE TABLE voice_profiles (
 id TEXT PRIMARY KEY, brand_id TEXT REFERENCES brands(id) ON DELETE RESTRICT,
 logical_name TEXT NOT NULL, locale TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(brand_id, logical_name, locale)
);
CREATE TABLE voice_profile_revisions (
 id TEXT PRIMARY KEY, voice_profile_id TEXT NOT NULL REFERENCES voice_profiles(id) ON DELETE RESTRICT,
 revision INTEGER NOT NULL CHECK(revision > 0), spec_json TEXT NOT NULL CHECK(json_valid(spec_json)),
 content_sha256 TEXT NOT NULL CHECK(length(content_sha256) = 64),
 state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','approved')),
 approved_at TEXT, created_at TEXT NOT NULL,
 CHECK((state = 'approved') = (approved_at IS NOT NULL)),
 UNIQUE(voice_profile_id, revision)
);
CREATE TRIGGER voice_approved_no_update BEFORE UPDATE ON voice_profile_revisions
 WHEN OLD.state = 'approved' BEGIN SELECT RAISE(ABORT, 'approved voice profile is immutable'); END;
CREATE TRIGGER voice_approved_no_delete BEFORE DELETE ON voice_profile_revisions
 WHEN OLD.state = 'approved' BEGIN SELECT RAISE(ABORT, 'approved voice profile cannot be deleted'); END;
CREATE TABLE voice_provider_mappings (
 id TEXT PRIMARY KEY, voice_revision_id TEXT NOT NULL REFERENCES voice_profile_revisions(id) ON DELETE RESTRICT,
 provider_profile_id TEXT REFERENCES provider_profiles(id) ON DELETE RESTRICT,
 adapter_kind TEXT NOT NULL CHECK(adapter_kind IN ('cloud_tts','local_tts','imported_audio','mock')),
 provider_voice_ref TEXT, options_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(options_json)),
 consent_state TEXT NOT NULL CHECK(consent_state IN ('unreviewed','granted','denied','not_applicable')),
 rights_state TEXT NOT NULL CHECK(rights_state IN ('unreviewed','approved','denied')),
 priority INTEGER NOT NULL DEFAULT 100, created_at TEXT NOT NULL,
 CHECK(adapter_kind <> 'cloud_tts' OR provider_profile_id IS NOT NULL),
 UNIQUE(voice_revision_id, adapter_kind, priority)
);

-- Per-asset licenses must be checked for each use (music/fonts/SFX/visuals).
CREATE TABLE asset_rights_reviews (
 id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE RESTRICT,
 use_scope TEXT NOT NULL CHECK(use_scope IN ('font','music','sfx','image','voice','video','other')),
 license_json TEXT NOT NULL CHECK(json_valid(license_json)),
 rights_state TEXT NOT NULL CHECK(rights_state IN ('unreviewed','approved','denied','expired')),
 reviewed_at TEXT, reviewer TEXT, source_url TEXT,
 CHECK(rights_state <> 'approved' OR (reviewed_at IS NOT NULL AND reviewer IS NOT NULL)),
 UNIQUE(artifact_id, use_scope, reviewed_at)
);
-- Review records are historical attestations; new rights decisions append a row.
CREATE TRIGGER rights_review_no_update BEFORE UPDATE ON asset_rights_reviews
 BEGIN SELECT RAISE(ABORT, 'rights review is append only'); END;
CREATE TRIGGER rights_review_no_delete BEFORE DELETE ON asset_rights_reviews
 BEGIN SELECT RAISE(ABORT, 'rights review cannot be deleted'); END;
CREATE TABLE sound_assets (
 id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE RESTRICT,
 brand_id TEXT REFERENCES brands(id) ON DELETE RESTRICT,
 kind TEXT NOT NULL CHECK(kind IN ('sfx','music','ambience','sting')),
 semantic_category TEXT NOT NULL, rights_review_id TEXT NOT NULL REFERENCES asset_rights_reviews(id) ON DELETE RESTRICT,
 metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)), created_at TEXT NOT NULL
);
CREATE INDEX idx_sound_asset_category ON sound_assets(kind, semantic_category);
CREATE TRIGGER sound_asset_rights_match_insert BEFORE INSERT ON sound_assets BEGIN
 SELECT RAISE(ABORT, 'sound license review must reference source artifact') WHERE NOT EXISTS (
  SELECT 1 FROM asset_rights_reviews r WHERE r.id=NEW.rights_review_id AND r.artifact_id=NEW.artifact_id
    AND r.use_scope IN ('music','sfx')
 );
END;
CREATE TRIGGER sound_asset_rights_match_update BEFORE UPDATE OF artifact_id,rights_review_id ON sound_assets BEGIN
 SELECT RAISE(ABORT, 'sound license review must reference source artifact') WHERE NOT EXISTS (
  SELECT 1 FROM asset_rights_reviews r WHERE r.id=NEW.rights_review_id AND r.artifact_id=NEW.artifact_id
    AND r.use_scope IN ('music','sfx')
 );
END;
CREATE TABLE sonic_palette_revisions (
 id TEXT PRIMARY KEY, brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE RESTRICT,
 palette_key TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0),
 spec_json TEXT NOT NULL CHECK(json_valid(spec_json)),
 state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','approved')),
 approved_at TEXT, created_at TEXT NOT NULL,
 CHECK((state = 'approved') = (approved_at IS NOT NULL)),
 UNIQUE(brand_id,palette_key,revision)
);
CREATE TRIGGER sonic_approved_no_update BEFORE UPDATE ON sonic_palette_revisions
 WHEN OLD.state='approved' BEGIN SELECT RAISE(ABORT, 'approved sonic palette is immutable'); END;
CREATE TRIGGER sonic_approved_no_delete BEFORE DELETE ON sonic_palette_revisions
 WHEN OLD.state='approved' BEGIN SELECT RAISE(ABORT, 'approved sonic palette cannot be deleted'); END;

-- Creative decisions are authoring documents; Kumiki owns concrete keyframes.
CREATE TABLE market_video_snapshots (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 source_platform TEXT NOT NULL, external_video_id TEXT NOT NULL,
 title_snapshot TEXT NOT NULL, observed_at TEXT NOT NULL, published_at TEXT,
 public_views INTEGER CHECK(public_views IS NULL OR public_views >= 0),
 format TEXT NOT NULL CHECK(format IN ('long','short','unknown')),
 source_url TEXT NOT NULL, extra_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(extra_json)),
 UNIQUE(source_platform, external_video_id, observed_at)
);
CREATE INDEX idx_market_video_snapshot_project ON market_video_snapshots(project_id,observed_at DESC);
CREATE TABLE creative_briefs (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 content_id TEXT REFERENCES contents(id) ON DELETE RESTRICT,
 revision INTEGER NOT NULL CHECK(revision > 0),
 brand_kit_revision_id TEXT REFERENCES brand_kit_revisions(id) ON DELETE RESTRICT,
 brief_json TEXT NOT NULL CHECK(json_valid(brief_json)),
 evidence_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(evidence_json)),
 state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','approved')),
 created_at TEXT NOT NULL, approved_at TEXT,
 CHECK((state = 'approved') = (approved_at IS NOT NULL)),
 UNIQUE(project_id,id,revision)
);
CREATE TRIGGER brief_brand_match_insert BEFORE INSERT ON creative_briefs
 WHEN NEW.brand_kit_revision_id IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM projects p JOIN brand_kits k ON k.brand_id=p.brand_id
 JOIN brand_kit_revisions br ON br.kit_id=k.id AND br.state='approved'
 WHERE p.id=NEW.project_id AND br.id=NEW.brand_kit_revision_id)
 BEGIN SELECT RAISE(ABORT, 'brief brand kit mismatch/unapproved'); END;
CREATE TRIGGER brief_brand_match_update BEFORE UPDATE OF project_id,brand_kit_revision_id ON creative_briefs
 WHEN NEW.brand_kit_revision_id IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM projects p JOIN brand_kits k ON k.brand_id=p.brand_id
 JOIN brand_kit_revisions br ON br.kit_id=k.id AND br.state='approved'
 WHERE p.id=NEW.project_id AND br.id=NEW.brand_kit_revision_id)
 BEGIN SELECT RAISE(ABORT, 'brief brand kit mismatch/unapproved'); END;
CREATE TRIGGER brief_content_project_insert BEFORE INSERT ON creative_briefs
 WHEN NEW.content_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM contents c WHERE c.id=NEW.content_id AND c.project_id=NEW.project_id)
 BEGIN SELECT RAISE(ABORT, 'brief content belongs to another project'); END;
CREATE TRIGGER brief_content_project_update BEFORE UPDATE OF project_id,content_id ON creative_briefs
 WHEN NEW.content_id IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM contents c WHERE c.id=NEW.content_id AND c.project_id=NEW.project_id)
 BEGIN SELECT RAISE(ABORT, 'brief content belongs to another project'); END;
CREATE TRIGGER brief_approved_no_update BEFORE UPDATE ON creative_briefs
 WHEN OLD.state='approved' BEGIN SELECT RAISE(ABORT, 'approved brief is immutable'); END;
CREATE TRIGGER brief_approved_no_delete BEFORE DELETE ON creative_briefs
 WHEN OLD.state='approved' BEGIN SELECT RAISE(ABORT, 'approved brief cannot be deleted'); END;

CREATE TABLE packaging_hypotheses (
 id TEXT PRIMARY KEY, brief_id TEXT NOT NULL REFERENCES creative_briefs(id) ON DELETE RESTRICT,
 variant_key TEXT NOT NULL, title TEXT NOT NULL,
 curiosity_kind TEXT NOT NULL, thumbnail_concept_json TEXT NOT NULL CHECK(json_valid(thumbnail_concept_json)),
 hook_json TEXT NOT NULL CHECK(json_valid(hook_json)), promise_json TEXT NOT NULL CHECK(json_valid(promise_json)),
 payoff_event_id TEXT NOT NULL, thumbnail_version_id TEXT REFERENCES thumbnail_versions(id) ON DELETE RESTRICT,
 state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','approved','rejected')),
 approved_at TEXT, created_at TEXT NOT NULL,
 CHECK(state <> 'approved' OR approved_at IS NOT NULL),
 UNIQUE(brief_id,variant_key)
);
CREATE TRIGGER hypothesis_approved_no_update BEFORE UPDATE ON packaging_hypotheses
 WHEN OLD.state='approved' BEGIN SELECT RAISE(ABORT, 'approved hypothesis is immutable'); END;
CREATE TRIGGER hypothesis_approved_no_delete BEFORE DELETE ON packaging_hypotheses
 WHEN OLD.state='approved' BEGIN SELECT RAISE(ABORT, 'approved hypothesis cannot be deleted'); END;

CREATE TABLE story_revisions (
 id TEXT PRIMARY KEY, brief_id TEXT NOT NULL REFERENCES creative_briefs(id) ON DELETE RESTRICT,
 hypothesis_id TEXT NOT NULL REFERENCES packaging_hypotheses(id) ON DELETE RESTRICT,
 revision INTEGER NOT NULL CHECK(revision > 0),
 format TEXT NOT NULL CHECK(format IN ('long','short')),
 story_json TEXT NOT NULL CHECK(json_valid(story_json)),
 schema_version INTEGER NOT NULL CHECK(schema_version > 0),
 content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64),
 state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','approved')),
 approved_at TEXT, created_at TEXT NOT NULL,
 CHECK((state = 'approved') = (approved_at IS NOT NULL)),
 UNIQUE(brief_id,format,revision)
);
CREATE TRIGGER story_hypothesis_match_insert BEFORE INSERT ON story_revisions BEGIN
 SELECT RAISE(ABORT, 'story hypothesis belongs to another brief') WHERE NOT EXISTS (
  SELECT 1 FROM packaging_hypotheses h WHERE h.id=NEW.hypothesis_id AND h.brief_id=NEW.brief_id
 );
END;
CREATE TRIGGER story_approved_no_update BEFORE UPDATE ON story_revisions
 WHEN OLD.state='approved' BEGIN SELECT RAISE(ABORT, 'approved story is immutable'); END;
CREATE TRIGGER story_approved_no_delete BEFORE DELETE ON story_revisions
 WHEN OLD.state='approved' BEGIN SELECT RAISE(ABORT, 'approved story cannot be deleted'); END;
CREATE TABLE story_beats (
 id TEXT PRIMARY KEY, story_revision_id TEXT NOT NULL REFERENCES story_revisions(id) ON DELETE RESTRICT,
 position INTEGER NOT NULL CHECK(position >= 0), semantic_event_id TEXT NOT NULL,
 objective TEXT NOT NULL, narration_text TEXT NOT NULL,
 visual_intent_json TEXT NOT NULL CHECK(json_valid(visual_intent_json)),
 evidence_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(evidence_json)),
 UNIQUE(story_revision_id,position), UNIQUE(story_revision_id,semantic_event_id)
);
CREATE TRIGGER story_beat_frozen_insert BEFORE INSERT ON story_beats
 WHEN (SELECT state FROM story_revisions WHERE id=NEW.story_revision_id)='approved'
 BEGIN SELECT RAISE(ABORT, 'approved story beats are immutable'); END;
CREATE TRIGGER story_beat_frozen_update BEFORE UPDATE ON story_beats
 WHEN (SELECT state FROM story_revisions WHERE id=OLD.story_revision_id)='approved'
   OR (SELECT state FROM story_revisions WHERE id=NEW.story_revision_id)='approved'
 BEGIN SELECT RAISE(ABORT, 'approved story beats are immutable'); END;
CREATE TRIGGER story_beat_frozen_delete BEFORE DELETE ON story_beats
 WHEN (SELECT state FROM story_revisions WHERE id=OLD.story_revision_id)='approved'
 BEGIN SELECT RAISE(ABORT, 'approved story beats are immutable'); END;

-- Versioned visual authoring adapters. Geometry/keyframes are compiled in Kumiki.
CREATE TABLE scene_documents (
 id TEXT PRIMARY KEY, story_revision_id TEXT NOT NULL REFERENCES story_revisions(id) ON DELETE RESTRICT,
 delivery_profile_id TEXT NOT NULL REFERENCES delivery_profile_revisions(id) ON DELETE RESTRICT,
 document_json TEXT NOT NULL CHECK(json_valid(document_json)),
 renderer_adapter TEXT NOT NULL, registry_pin TEXT NOT NULL,
 content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64),
 created_at TEXT NOT NULL
);
CREATE INDEX idx_scene_document_story_profile ON scene_documents(story_revision_id,delivery_profile_id);

-- Sample precision is canonical. A word-alignment artifact is optional.
CREATE TABLE audio_productions (
 id TEXT PRIMARY KEY, story_revision_id TEXT NOT NULL REFERENCES story_revisions(id) ON DELETE RESTRICT,
 voice_revision_id TEXT REFERENCES voice_profile_revisions(id) ON DELETE RESTRICT,
 sonic_palette_revision_id TEXT REFERENCES sonic_palette_revisions(id) ON DELETE RESTRICT,
 spec_json TEXT NOT NULL CHECK(json_valid(spec_json)),
 internal_sample_rate INTEGER NOT NULL CHECK(internal_sample_rate>0),
 state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','ready','approved')),
 created_at TEXT NOT NULL
);
CREATE TABLE speech_segments (
 id TEXT PRIMARY KEY, audio_production_id TEXT NOT NULL REFERENCES audio_productions(id) ON DELETE RESTRICT,
 story_beat_id TEXT NOT NULL REFERENCES story_beats(id) ON DELETE RESTRICT,
 audio_artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE RESTRICT,
 provider_mapping_id TEXT REFERENCES voice_provider_mappings(id) ON DELETE RESTRICT,
 alignment_artifact_id TEXT REFERENCES artifacts(id) ON DELETE RESTRICT,
 start_sample INTEGER NOT NULL CHECK(start_sample>=0), sample_count INTEGER NOT NULL CHECK(sample_count>0),
 sample_rate INTEGER NOT NULL CHECK(sample_rate>0),
 alignment_level TEXT NOT NULL CHECK(alignment_level IN ('none','segment','word','phoneme')),
 provenance_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(provenance_json)),
 UNIQUE(audio_production_id,story_beat_id)
);
CREATE TRIGGER speech_segment_story_match_insert BEFORE INSERT ON speech_segments BEGIN
 SELECT RAISE(ABORT, 'speech beat does not belong to audio story') WHERE NOT EXISTS (
  SELECT 1 FROM audio_productions a JOIN story_beats b ON b.story_revision_id=a.story_revision_id
  WHERE a.id=NEW.audio_production_id AND b.id=NEW.story_beat_id
 );
END;
CREATE TRIGGER speech_segment_story_match_update BEFORE UPDATE OF audio_production_id,story_beat_id ON speech_segments BEGIN
 SELECT RAISE(ABORT, 'speech beat does not belong to audio story') WHERE NOT EXISTS (
  SELECT 1 FROM audio_productions a JOIN story_beats b ON b.story_revision_id=a.story_revision_id
  WHERE a.id=NEW.audio_production_id AND b.id=NEW.story_beat_id
 );
END;
CREATE TABLE audio_cues (
 id TEXT PRIMARY KEY, audio_production_id TEXT NOT NULL REFERENCES audio_productions(id) ON DELETE RESTRICT,
 sound_asset_id TEXT NOT NULL REFERENCES sound_assets(id) ON DELETE RESTRICT,
 semantic_event_id TEXT NOT NULL, start_sample INTEGER NOT NULL CHECK(start_sample>=0),
 duration_samples INTEGER NOT NULL CHECK(duration_samples>=0),
 gain_db REAL NOT NULL CHECK(gain_db BETWEEN -90 AND 18),
 mix_lane TEXT NOT NULL CHECK(mix_lane IN ('sfx','music','ambience','sting')),
 automation_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(automation_json))
);
CREATE INDEX idx_audio_cue_order ON audio_cues(audio_production_id,start_sample);
CREATE TABLE audio_mixes (
 id TEXT PRIMARY KEY, audio_production_id TEXT NOT NULL REFERENCES audio_productions(id) ON DELETE RESTRICT,
 mastered_artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE RESTRICT,
 measurement_json TEXT NOT NULL CHECK(json_valid(measurement_json)),
 tool_manifest_json TEXT NOT NULL CHECK(json_valid(tool_manifest_json)),
 content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64), created_at TEXT NOT NULL
);

-- Render variants and release snapshots have their own independent artifact IDs.
CREATE TABLE video_renders (
 id TEXT PRIMARY KEY, story_revision_id TEXT NOT NULL REFERENCES story_revisions(id) ON DELETE RESTRICT,
 brand_kit_revision_id TEXT NOT NULL REFERENCES brand_kit_revisions(id) ON DELETE RESTRICT,
 delivery_profile_id TEXT NOT NULL REFERENCES delivery_profile_revisions(id) ON DELETE RESTRICT,
 scene_document_id TEXT NOT NULL REFERENCES scene_documents(id) ON DELETE RESTRICT,
 audio_mix_id TEXT REFERENCES audio_mixes(id) ON DELETE RESTRICT,
 job_id TEXT REFERENCES jobs(id) ON DELETE RESTRICT,
 video_artifact_id TEXT REFERENCES artifacts(id) ON DELETE RESTRICT,
 render_manifest_json TEXT NOT NULL CHECK(json_valid(render_manifest_json)),
 status TEXT NOT NULL CHECK(status IN ('pending','running','failed','succeeded')),
 created_at TEXT NOT NULL, finished_at TEXT,
 CHECK(status <> 'succeeded' OR (video_artifact_id IS NOT NULL AND finished_at IS NOT NULL))
);
CREATE TRIGGER render_consistency_insert BEFORE INSERT ON video_renders BEGIN
 SELECT RAISE(ABORT, 'render scene/story/profile mismatch') WHERE NOT EXISTS (
  SELECT 1 FROM scene_documents s WHERE s.id=NEW.scene_document_id
  AND s.story_revision_id=NEW.story_revision_id AND s.delivery_profile_id=NEW.delivery_profile_id
 );
 SELECT RAISE(ABORT, 'render brand/story mismatch') WHERE NOT EXISTS (
  SELECT 1 FROM story_revisions s JOIN creative_briefs b ON b.id=s.brief_id
  JOIN projects p ON p.id=b.project_id
  JOIN brand_kits k ON k.brand_id=p.brand_id
  JOIN brand_kit_revisions kr ON kr.kit_id=k.id AND kr.state='approved'
  WHERE s.id=NEW.story_revision_id AND kr.id=NEW.brand_kit_revision_id
    AND (b.brand_kit_revision_id IS NULL OR b.brand_kit_revision_id=NEW.brand_kit_revision_id)
 );
 SELECT RAISE(ABORT, 'render audio/story mismatch') WHERE NEW.audio_mix_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM audio_mixes m JOIN audio_productions a ON a.id=m.audio_production_id
  WHERE m.id=NEW.audio_mix_id AND a.story_revision_id=NEW.story_revision_id
 );
END;
CREATE TRIGGER render_consistency_update BEFORE UPDATE OF story_revision_id,scene_document_id,delivery_profile_id,audio_mix_id ON video_renders BEGIN
 SELECT RAISE(ABORT, 'render scene/story/profile mismatch') WHERE NOT EXISTS (
  SELECT 1 FROM scene_documents s WHERE s.id=NEW.scene_document_id
  AND s.story_revision_id=NEW.story_revision_id AND s.delivery_profile_id=NEW.delivery_profile_id
 );
 SELECT RAISE(ABORT, 'render brand/story mismatch') WHERE NOT EXISTS (
  SELECT 1 FROM story_revisions s JOIN creative_briefs b ON b.id=s.brief_id
  JOIN projects p ON p.id=b.project_id
  JOIN brand_kits k ON k.brand_id=p.brand_id
  JOIN brand_kit_revisions kr ON kr.kit_id=k.id AND kr.state='approved'
  WHERE s.id=NEW.story_revision_id AND kr.id=NEW.brand_kit_revision_id
    AND (b.brand_kit_revision_id IS NULL OR b.brand_kit_revision_id=NEW.brand_kit_revision_id)
 );
 SELECT RAISE(ABORT, 'render audio/story mismatch') WHERE NEW.audio_mix_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM audio_mixes m JOIN audio_productions a ON a.id=m.audio_production_id
  WHERE m.id=NEW.audio_mix_id AND a.story_revision_id=NEW.story_revision_id
 );
END;
CREATE INDEX idx_video_render_story ON video_renders(story_revision_id,status,created_at);

CREATE TABLE video_release_revisions (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 render_id TEXT NOT NULL REFERENCES video_renders(id) ON DELETE RESTRICT,
 selected_hypothesis_id TEXT NOT NULL REFERENCES packaging_hypotheses(id) ON DELETE RESTRICT,
 thumbnail_version_id TEXT REFERENCES thumbnail_versions(id) ON DELETE RESTRICT,
 caption_artifact_id TEXT REFERENCES artifacts(id) ON DELETE RESTRICT,
 release_manifest_json TEXT NOT NULL CHECK(json_valid(release_manifest_json)),
 manifest_sha256 TEXT NOT NULL CHECK(length(manifest_sha256)=64),
 state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','approved')),
 approved_at TEXT, created_at TEXT NOT NULL,
 CHECK((state='approved') = (approved_at IS NOT NULL))
);
CREATE TRIGGER release_provenance_insert BEFORE INSERT ON video_release_revisions BEGIN
 SELECT RAISE(ABORT, 'release must select hypothesis from same story and project') WHERE NOT EXISTS (
  SELECT 1 FROM video_renders r
  JOIN story_revisions s ON s.id=r.story_revision_id
  JOIN creative_briefs b ON b.id=s.brief_id
  JOIN packaging_hypotheses h ON h.id=s.hypothesis_id AND h.brief_id=b.id
  WHERE r.id=NEW.render_id AND b.project_id=NEW.project_id
    AND h.id=NEW.selected_hypothesis_id AND r.status='succeeded'
 );
END;
CREATE TRIGGER release_provenance_update BEFORE UPDATE OF project_id,render_id,selected_hypothesis_id ON video_release_revisions BEGIN
 SELECT RAISE(ABORT, 'release must select hypothesis from same story and project') WHERE NOT EXISTS (
  SELECT 1 FROM video_renders r
  JOIN story_revisions s ON s.id=r.story_revision_id
  JOIN creative_briefs b ON b.id=s.brief_id
  JOIN packaging_hypotheses h ON h.id=s.hypothesis_id AND h.brief_id=b.id
  WHERE r.id=NEW.render_id AND b.project_id=NEW.project_id
    AND h.id=NEW.selected_hypothesis_id AND r.status='succeeded'
 );
END;
-- Approval requires every explicitly referenced release asset to have current
-- approved rights evidence. Completeness (all used assets listed) is checked
-- by the application release manifest validator, not provable from JSON here.
CREATE TRIGGER release_assets_rights_approval BEFORE UPDATE OF state ON video_release_revisions
 WHEN OLD.state='draft' AND NEW.state='approved' AND EXISTS (
  SELECT 1 FROM video_release_assets ra
  LEFT JOIN asset_rights_reviews rr ON rr.id=ra.rights_review_id
  WHERE ra.release_id=NEW.id AND (ra.rights_review_id IS NULL OR rr.rights_state<>'approved')
 ) BEGIN SELECT RAISE(ABORT, 'release assets require approved license reviews'); END;
CREATE TRIGGER video_release_frozen_update BEFORE UPDATE ON video_release_revisions
 WHEN OLD.state='approved' BEGIN SELECT RAISE(ABORT, 'approved video release is immutable'); END;
CREATE TRIGGER video_release_frozen_delete BEFORE DELETE ON video_release_revisions
 WHEN OLD.state='approved' BEGIN SELECT RAISE(ABORT, 'approved video release cannot be deleted'); END;
CREATE TABLE video_release_assets (
 release_id TEXT NOT NULL REFERENCES video_release_revisions(id) ON DELETE RESTRICT,
 artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE RESTRICT,
 role TEXT NOT NULL, rights_review_id TEXT REFERENCES asset_rights_reviews(id) ON DELETE RESTRICT,
 PRIMARY KEY(release_id,artifact_id,role)
);
CREATE TRIGGER video_asset_review_insert BEFORE INSERT ON video_release_assets
 WHEN NEW.rights_review_id IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM asset_rights_reviews rr WHERE rr.id=NEW.rights_review_id AND rr.artifact_id=NEW.artifact_id)
 BEGIN SELECT RAISE(ABORT, 'release rights review refers to another asset'); END;
CREATE TRIGGER video_asset_review_update BEFORE UPDATE OF artifact_id,rights_review_id ON video_release_assets
 WHEN NEW.rights_review_id IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM asset_rights_reviews rr WHERE rr.id=NEW.rights_review_id AND rr.artifact_id=NEW.artifact_id)
 BEGIN SELECT RAISE(ABORT, 'release rights review refers to another asset'); END;
CREATE TRIGGER video_asset_approved_insert BEFORE INSERT ON video_release_assets
 WHEN (SELECT state FROM video_release_revisions WHERE id=NEW.release_id) IN ('approved')
 BEGIN SELECT RAISE(ABORT, 'approved release assets are immutable'); END;
CREATE TRIGGER video_asset_approved_update BEFORE UPDATE ON video_release_assets
 WHEN (SELECT state FROM video_release_revisions WHERE id=OLD.release_id) IN ('approved')
 OR (SELECT state FROM video_release_revisions WHERE id=NEW.release_id) IN ('approved')
 BEGIN SELECT RAISE(ABORT, 'approved release assets are immutable'); END;
CREATE TRIGGER video_asset_approved_delete BEFORE DELETE ON video_release_assets
 WHEN (SELECT state FROM video_release_revisions WHERE id=OLD.release_id) IN ('approved')
 BEGIN SELECT RAISE(ABORT, 'approved release assets are immutable'); END;
-- Publishing is an auditable effect, not a mutation of an approved release.
CREATE TABLE video_publication_attempts (
 id TEXT PRIMARY KEY, release_id TEXT NOT NULL REFERENCES video_release_revisions(id) ON DELETE RESTRICT,
 destination TEXT NOT NULL, provider TEXT NOT NULL,
 idempotency_key TEXT NOT NULL, state TEXT NOT NULL
 CHECK(state IN ('prepared','submitted','succeeded','failed','cancelled')),
 remote_ref TEXT, request_json TEXT NOT NULL CHECK(json_valid(request_json)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(provider,destination,idempotency_key)
);
CREATE TRIGGER video_publication_requires_approval BEFORE INSERT ON video_publication_attempts
 WHEN NOT EXISTS (SELECT 1 FROM video_release_revisions r WHERE r.id=NEW.release_id AND r.state='approved')
 BEGIN SELECT RAISE(ABORT, 'publication requires approved immutable release'); END;
-- A successful renderer or mastered audio artifact is a production snapshot.
CREATE TRIGGER render_succeeded_immutable BEFORE UPDATE ON video_renders
 WHEN OLD.status='succeeded' BEGIN SELECT RAISE(ABORT, 'successful render snapshot is immutable'); END;
CREATE TRIGGER render_succeeded_no_delete BEFORE DELETE ON video_renders
 WHEN OLD.status='succeeded' BEGIN SELECT RAISE(ABORT, 'successful render snapshot cannot be deleted'); END;
CREATE TRIGGER mix_immutable_update BEFORE UPDATE ON audio_mixes
 BEGIN SELECT RAISE(ABORT, 'audio mixes are immutable artifacts'); END;
CREATE TRIGGER mix_immutable_delete BEFORE DELETE ON audio_mixes
 BEGIN SELECT RAISE(ABORT, 'audio mixes are immutable artifacts'); END;
