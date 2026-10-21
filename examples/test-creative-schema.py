#!/usr/bin/env python3
"""Disposable SQLite schema contract check; no network or dependencies.

Run: python3 examples/test-creative-schema.py
Loads the actual core/reference DDL and the additive creative-production DDL.
No existing database is opened or mutated.
"""
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parent
SCHEMAS = ("core-schema.sql", "creative-production.sql")
NOW = "2026-10-21T00:00:00Z"
SHA = "a" * 64

def must_fail(db: sqlite3.Connection, sql: str, args: tuple = ()) -> None:
    try:
        db.execute(sql, args)
    except sqlite3.IntegrityError:
        return
    raise AssertionError(f"Invalid write unexpectedly succeeded: {sql}")

def main() -> None:
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys=ON")
    assert db.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    for filename in SCHEMAS:
        db.executescript((ROOT / filename).read_text(encoding="utf-8"))
    db.execute("INSERT INTO brands(id,name,created_at,updated_at) VALUES('a','A',?,?)", (NOW, NOW))
    db.execute("INSERT INTO brands(id,name,created_at,updated_at) VALUES('b','B',?,?)", (NOW, NOW))
    for brand in ("a", "b"):
        db.execute(
            "INSERT INTO projects(id,brand_id,name,created_at,updated_at) VALUES(?,?,?,?,?)",
            (f"p-{brand}", brand, brand, NOW, NOW),
        )
        db.execute(
            "INSERT INTO artifacts(id,project_id,sha256,path,mime_type,bytes,ownership,retention,created_at) "
            "VALUES(?,?,?,?,?,?,?,?,?)",
            (f"art-{brand}", f"p-{brand}", SHA, f"/tmp/test-{brand}", "audio/wav", 3,
             "generated", "durable", NOW),
        )

    db.execute("INSERT INTO brand_kits(id,brand_id,name,created_at) VALUES('kit','a','House Math',?)", (NOW,))
    db.execute(
        "INSERT INTO brand_kit_revisions(id,kit_id,revision,schema_version,kit_json,content_sha256,"
        "state,approved_at,created_at) VALUES('kit1','kit',1,1,'{}',?,'approved',?,?)",
        (SHA, NOW, NOW),
    )
    db.execute(
        "INSERT INTO project_brand_kits(project_id,kit_revision_id,updated_at) "
        "VALUES('p-a','kit1',?)", (NOW,),
    )
    must_fail(db, "INSERT INTO project_brand_kits(project_id,kit_revision_id,updated_at) "
                  "VALUES('p-b','kit1',?)", (NOW,))
    must_fail(db, "UPDATE brand_kit_revisions SET kit_json='{}' WHERE id='kit1'")
    must_fail(db, "UPDATE projects SET brand_id='b' WHERE id='p-a'")
    must_fail(db, "INSERT INTO brand_kit_revisions(id,kit_id,revision,schema_version,kit_json,"
                  "content_sha256,created_at) VALUES('invalid','kit',2,1,'not-json',?,?)", (SHA, NOW))

    db.execute(
        "INSERT INTO delivery_profile_revisions(id,platform,profile_key,revision,width_px,height_px,"
        "fps_num,fps_den,settings_json,content_sha256,state,approved_at,created_at) "
        "VALUES('land','youtube','long',1,1920,1080,30,1,'{}',?,'approved',?,?)",
        (SHA, NOW, NOW),
    )
    db.execute(
        "INSERT INTO creative_briefs(id,project_id,revision,brand_kit_revision_id,brief_json,created_at) "
        "VALUES('brief','p-a',1,'kit1','{}',?)", (NOW,),
    )
    must_fail(
        db,
        "INSERT INTO creative_briefs(id,project_id,revision,brand_kit_revision_id,brief_json,created_at) "
        "VALUES('wrong-brief','p-b',1,'kit1','{}',?)", (NOW,),
    )
    db.execute(
        "INSERT INTO packaging_hypotheses(id,brief_id,variant_key,title,curiosity_kind,"
        "thumbnail_concept_json,hook_json,promise_json,payoff_event_id,created_at) "
        "VALUES('hyp','brief','a','Lifetime cost','magnitude','{}','{}','{}','reveal',?)", (NOW,),
    )
    db.execute(
        "INSERT INTO story_revisions(id,brief_id,hypothesis_id,revision,format,story_json,"
        "schema_version,content_sha256,created_at) VALUES('story','brief','hyp',1,'long','{}',1,?,?)",
        (SHA, NOW),
    )
    db.execute(
        "INSERT INTO story_beats(id,story_revision_id,position,semantic_event_id,objective,"
        "narration_text,visual_intent_json) VALUES('beat','story',0,'reveal','show total','cost','{}')"
    )
    db.execute("UPDATE story_revisions SET state='approved',approved_at=? WHERE id='story'", (NOW,))
    must_fail(db, "DELETE FROM story_beats WHERE id='beat'")

    db.execute(
        "INSERT INTO scene_documents(id,story_revision_id,delivery_profile_id,document_json,"
        "renderer_adapter,registry_pin,content_sha256,created_at) "
        "VALUES('scene','story','land','{}','kumiki','pin123',?,?)", (SHA, NOW),
    )
    db.execute(
        "INSERT INTO video_renders(id,story_revision_id,brand_kit_revision_id,delivery_profile_id,"
        "scene_document_id,video_artifact_id,render_manifest_json,status,created_at,finished_at) "
        "VALUES('render','story','kit1','land','scene','art-a','{}','succeeded',?,?)",
        (NOW, NOW),
    )
    must_fail(db, "UPDATE video_renders SET status='failed' WHERE id='render'")

    db.execute(
        "INSERT INTO video_release_revisions(id,project_id,render_id,selected_hypothesis_id,"
        "release_manifest_json,manifest_sha256,created_at) "
        "VALUES('release','p-a','render','hyp','{}',?,?)", (SHA, NOW),
    )
    db.execute(
        "INSERT INTO video_release_assets(release_id,artifact_id,role) VALUES('release','art-a','audio')"
    )
    must_fail(db, "UPDATE video_release_revisions SET state='approved',approved_at=? WHERE id='release'", (NOW,))
    db.execute("DELETE FROM video_release_assets WHERE release_id='release'")
    db.execute(
        "INSERT INTO asset_rights_reviews(id,artifact_id,use_scope,license_json,rights_state,reviewed_at,reviewer)"
        " VALUES('rights','art-a','video','{}','approved',?,?)", (NOW, "human"),
    )
    db.execute(
        "INSERT INTO video_release_assets(release_id,artifact_id,role,rights_review_id)"
        " VALUES('release','art-a','audio','rights')"
    )
    db.execute("UPDATE video_release_revisions SET state='approved',approved_at=? WHERE id='release'", (NOW,))
    must_fail(db, "DELETE FROM video_release_assets WHERE release_id='release'")
    must_fail(db, "UPDATE video_release_revisions SET release_manifest_json='{}' WHERE id='release'")
    must_fail(
        db,
        "INSERT INTO video_publication_attempts(id,release_id,destination,provider,idempotency_key,"
        "state,request_json,created_at,updated_at) "
        "VALUES('first','unknown','youtube','manual','same','prepared','{}',?,?)",
        (NOW, NOW),
    )
    db.execute(
        "INSERT INTO video_publication_attempts(id,release_id,destination,provider,idempotency_key,"
        "state,request_json,created_at,updated_at) "
        "VALUES('first','release','youtube','manual','same','prepared','{}',?,?)",
        (NOW, NOW),
    )
    must_fail(
        db,
        "INSERT INTO video_publication_attempts(id,release_id,destination,provider,idempotency_key,"
        "state,request_json,created_at,updated_at) "
        "VALUES('retry','release','youtube','manual','same','prepared','{}',?,?)",
        (NOW, NOW),
    )
    assert db.execute("PRAGMA foreign_key_check").fetchall() == []
    assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    print("PASS: core + creative DDL, approved immutability, brand/rights guards,")
    print("      timed story linkage, release snapshot, publication idempotency, FK/integrity")

if __name__ == "__main__":
    main()
